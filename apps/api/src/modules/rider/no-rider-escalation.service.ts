import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { DISPATCHABLE_DELIVERY_STATES } from './dispatch-policy';

/**
 * DEC-022's locked timing (Phase H final-gap product decision): 5-minute
 * initial search window before the customer is told, 8-minute decision point
 * (the 5-minute notice plus a 3-minute extension) after which an operator
 * handles it manually. Constants, not configuration, for the same reason
 * `dispatch-policy.ts`'s own DEC-037 numbers are: an approved decision belongs
 * in code that cites it, not in an environment variable, until Phase I gives
 * it an admin surface to be administered from.
 */
export const NO_RIDER_NOTICE_SECONDS = 5 * 60;
export const NO_RIDER_DECISION_SECONDS = 8 * 60;

const NO_RIDER_EVENT_TYPE = 'OrderNoRiderFound';
const NO_RIDER_AGGREGATE_TYPE = 'delivery';

type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';

/** H-3 locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching every other H-3 writer's own established precedent rather than a shared cross-module resolver. */
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

/** `deliveries`, the columns this check needs. */
interface SearchingDeliveryRow {
  id: string;
  created_at: string;
  order_id: string;
}

export interface NoRiderEscalationResult {
  /** Deliveries that just crossed the 5-minute threshold and got their `OrderNoRiderFound` event written this round. */
  escalated: number;
  /** Already-escalated deliveries that have now also crossed the 8-minute decision point — logged for an operator, never auto-cancelled. */
  decisionPointReached: number;
  skipped: number;
  failed: number;
}

/**
 * DEC-022's no-rider escalation — the Phase H final-audit gap: a delivery
 * still `RIDER_SEARCHING`/`RIDER_REASSIGNING` past the initial window gets
 * exactly one `OrderNoRiderFound` outbox event (CUSTOMER recipient), and —
 * past the decision point — is logged for an operator, never auto-cancelled
 * ("cancellation is a decision, never a timeout" — `docs/RIDER_LIFECYCLE.md`
 * § 7).
 *
 * Runs from `POST /internal/tick`, alongside but independently of
 * `DispatchService`'s own round — same "no scheduler of its own" reasoning
 * (DEC-APP-010's single 60-second cron) and deliberately kept as its own
 * service rather than folded into `DispatchService`: that service's job is
 * broadcasting offers, this one's is a read-only elapsed-time check, and nothing about the
 * shape of one has to compile with the shape of the other.
 *
 * `deliveries.created_at` is the authoritative search-start clock — the same
 * timestamp `DispatchService.offerDelivery`'s `roundNumberFor` already treats
 * as "when this delivery's search began" (its own header comment). No second
 * clock is introduced.
 *
 * ## Idempotency without a migration
 *
 * `deliveries` has no "already notified" column, and this slice adds none —
 * a schema change is explicitly out of scope. The `outbox` table is itself
 * the durable record of what has already been sent, so a batch existence
 * check against it (`OrderNoRiderFound` rows already present for this
 * round's candidate ids) is the dedup key; only the deliveries missing one
 * get a new row. This is a read-then-write, unlike every other H-3 writer's
 * unique-constraint-or-guarded-UPDATE discipline (ADR-003) — flagged, not
 * hidden: `outbox` carries no unique constraint on
 * `(aggregate_type, aggregate_id, event_type)`, and adding one is exactly the
 * kind of migration this slice must not make. Under DEC-APP-010's single
 * 60-second-cron scheduler, two ticks racing this check is not the everyday
 * case a guarded UPDATE defends against elsewhere; a rare duplicate customer
 * notification here is a low-severity outcome (no money, no state change),
 * consistent with H-3's own already-accepted "notification loss/duplication
 * is flagged, not hidden" precedent (`OrdersService.create`'s own header). The
 * existence-check read itself is fail-closed: if it errors, every candidate
 * is treated as already escalated rather than risk a duplicate notification.
 */
@Injectable()
export class NoRiderEscalationService {
  private readonly logger = new Logger(NoRiderEscalationService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Runs one check. Called once per tick. A repeated normal (sequential)
   * tick is deduplicated by the outbox existence check below — genuinely
   * concurrent executions are not: see the class header's "Idempotency
   * without a migration" section for the exact guarantee.
   */
  async run(): Promise<NoRiderEscalationResult> {
    const now = new Date();
    const searching = await this.listOverdueSearchingDeliveries(now);

    if (searching.length === 0) {
      return { escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 };
    }

    const alreadyEscalated = await this.listAlreadyEscalatedIds(searching.map((d) => d.id));

    let escalated = 0;
    let decisionPointReached = 0;
    let skipped = 0;
    let failed = 0;

    for (const delivery of searching) {
      const elapsedMs = now.getTime() - new Date(delivery.created_at).getTime();

      if (alreadyEscalated.has(delivery.id)) {
        skipped++;
        if (elapsedMs >= NO_RIDER_DECISION_SECONDS * 1000) {
          decisionPointReached++;
          this.logger.warn(
            `Delivery ${delivery.id} (order ${delivery.order_id}) has been searching for ` +
              `${Math.floor(elapsedMs / 60000)} minute(s) — past the 8-minute decision point, ` +
              'awaiting operator handling (DEC-022). Never auto-cancelled.',
          );
        }
        continue;
      }

      const ok = await this.writeNoRiderOutboxEvent(delivery);
      if (ok) escalated++;
      else failed++;
    }

    return { escalated, decisionPointReached, skipped, failed };
  }

  /**
   * `deliveries` still searching whose `created_at` is already past the
   * 5-minute notice window — the same `DISPATCHABLE_DELIVERY_STATES` filter
   * `DispatchService.listDispatchableDeliveries` uses, plus the elapsed-time
   * bound this check adds on top.
   */
  private async listOverdueSearchingDeliveries(now: Date): Promise<SearchingDeliveryRow[]> {
    const noticeThreshold = new Date(now.getTime() - NO_RIDER_NOTICE_SECONDS * 1000).toISOString();

    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, created_at, order_id')
      .in('state', [...DISPATCHABLE_DELIVERY_STATES])
      .lt('created_at', noticeThreshold)
      .returns<SearchingDeliveryRow[]>();

    if (error) {
      this.logger.error(`Failed to list overdue searching deliveries: ${error.message}`);
      return [];
    }

    return data ?? [];
  }

  private async listAlreadyEscalatedIds(deliveryIds: string[]): Promise<Set<string>> {
    const { data, error } = await this.supabase.admin
      .from('outbox')
      .select('aggregate_id')
      .eq('aggregate_type', NO_RIDER_AGGREGATE_TYPE)
      .eq('event_type', NO_RIDER_EVENT_TYPE)
      .in('aggregate_id', deliveryIds)
      .returns<{ aggregate_id: string }[]>();

    if (error) {
      this.logger.error(`Failed to check existing ${NO_RIDER_EVENT_TYPE} outbox rows: ${error.message}`);
      return new Set(deliveryIds);
    }

    return new Set((data ?? []).map((row) => row.aggregate_id));
  }

  /**
   * The outbox write itself — ADR-005, same best-effort discipline every
   * other H-3 writer documents on itself: logged and swallowed on failure
   * (reported as `failed`, not thrown), so one bad delivery in a batch never
   * costs the rest of the round their notice.
   */
  private async writeNoRiderOutboxEvent(delivery: SearchingDeliveryRow): Promise<boolean> {
    const recipients = await this.resolveRecipients(delivery.order_id);

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: NO_RIDER_AGGREGATE_TYPE,
      aggregate_id: delivery.id,
      event_type: NO_RIDER_EVENT_TYPE,
      payload: { recipients },
    });

    if (error) {
      this.logger.error(
        `outbox insert failed for ${NO_RIDER_EVENT_TYPE} (delivery ${delivery.id}): ${error.message}`,
      );
      return false;
    }

    return true;
  }

  /**
   * CUSTOMER only, at H-5's own explicit minimum — no OPERATOR entry is
   * written: `OutboxDispatchService` already skips `OPERATOR` recipients as
   * unsupported in Phase H, and no operator identity exists in the schema to
   * name one with. The 8-minute decision point is represented by this
   * service's own log line above, not by a second recipient here.
   */
  private async resolveRecipients(orderId: string): Promise<OutboxRecipient[]> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('customer_id')
      .eq('id', orderId)
      .maybeSingle<{ customer_id: string }>();

    if (error) {
      this.logger.error(
        `${NO_RIDER_EVENT_TYPE} recipient resolution: orders read failed for order ${orderId}: ${error.message}`,
      );
      return [];
    }

    if (!data) {
      return [];
    }

    return [{ recipientId: data.customer_id, recipientType: 'CUSTOMER' }];
  }
}
