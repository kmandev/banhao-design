import { Injectable, Logger } from '@nestjs/common';
import { DELIVERY_CONTACT_ATTEMPTS_REQUIRED } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  ARRIVAL_TIMEOUT_DELIVERY_STATE,
  ARRIVAL_TIMEOUT_ORDER_STATE,
  ARRIVAL_TIMEOUT_SECONDS,
  arrivalTimeoutCutoff,
} from './arrival-timeout-policy';

/** `deliveries`, the columns this check needs. No money column is selected. */
interface ArrivedDeliveryRow {
  id: string;
  order_id: string;
  rider_id: string | null;
  arrived_at: string | null;
}

/** `orders`, the one column the eligibility pairing needs. */
interface OrderStateRow {
  id: string;
  state: string;
}

export interface ArrivalTimeoutEscalationResult {
  /** Deliveries past DEC-053's five-minute wait that this round examined. */
  examined: number;
  /** Deliveries that crossed the threshold and got their escalation row written this round. */
  escalated: number;
  /** Already escalated, or no longer eligible once live order state was checked. */
  skipped: number;
  failed: number;
}

/**
 * The `audit_logs.action` this escalation is recorded under.
 *
 * Deliberately **not** an `AI_OPS_*` action: those are Phase J agent
 * escalations and the supervisor inbox selects on that prefix together with
 * `actor_type = 'AI'`. This is a deterministic elapsed-time check with no
 * agent, no projection and no model behind it, so it is neither, and the
 * operator reads it through `GET …/deliveries/awaiting-failure` instead.
 */
export const ARRIVAL_TIMEOUT_ACTION = 'DELIVERY_ARRIVAL_TIMEOUT';

/**
 * DEC-053 § 3's five-minute customer-arrival wait, as a tick phase — BQ-017
 * Slice #3.
 *
 * A delivery that has been `ARRIVED` for at least
 * {@link ARRIVAL_TIMEOUT_SECONDS} is a case that needs a person. This service
 * records that fact, durably and exactly once, and stops.
 *
 * ## Escalation only. It cannot fail a delivery, and that is structural
 *
 * **This service issues no `UPDATE` of any kind.** It reads `deliveries`,
 * reads `orders`, reads `delivery_contact_attempts`, and writes one
 * append-only `audit_logs` row. There is no code path here that changes a
 * delivery state, an order state, a failure cause, an assignment, a rider's
 * availability, or any financial row — not disabled, absent. Automatic
 * failure is therefore impossible by construction rather than by a flag
 * somebody could flip.
 *
 * That is DEC-053 § 2 enforced where it matters: *"the operator is the
 * authority that declares the failure"*. A timer that could declare one would
 * make the operator's authority advisory, and the cause it would have to
 * invent selects an economic outcome (DEC-053 § 5) that no automated process
 * may choose. The same reasoning `NoRiderEscalationService` records for
 * DEC-022 — *"cancellation is a decision, never a timeout"*.
 *
 * ## Eligibility is the failure command's own precondition set, minus the
 * operator
 *
 * `deliveries.state = ARRIVED`, `arrived_at` present and at least five minutes
 * old, and `orders.state = DELIVERING`. The shared constants come from
 * {@link ARRIVAL_TIMEOUT_SECONDS} and friends, so this phase and
 * `DeliveryFailureService` cannot drift — an operator must never be shown a
 * case the command would then refuse.
 *
 * The contact-attempt count is **reported, not required**. DEC-053 makes two
 * attempts a precondition of *resolution*, not of *attention*: a delivery
 * sitting at the customer's door with zero attempts recorded is arguably the
 * case an operator most needs to see. The count travels in the escalation's
 * `after` payload so the operator knows whether the rider has done their part.
 *
 * ## Idempotency, and its honest bound
 *
 * One `audit_logs` row per `(action, delivery)`. Before writing, the batch's
 * existing rows are read in one query and already-escalated deliveries are
 * skipped, so a delivery that stays eligible for an hour produces one
 * escalation rather than sixty.
 *
 * This is a read-then-write, not a unique constraint, and the limit is the
 * same one `AiAuditService.alreadyHandled` and `NoRiderEscalationService`
 * document for themselves: sequential re-runs are suppressed, two *genuinely
 * concurrent* ticks are not, because `audit_logs` carries no unique
 * constraint on `(action, entity_id)` and adding one is a migration this slice
 * is not authorized to make. Under DEC-APP-010's single 60-second cron that
 * race is not the everyday case, and its worst outcome is a duplicate
 * read-only audit row — no money, no state change, no notification. Flagged
 * rather than hidden.
 *
 * The existence check is **fail-closed**: if it errors, every candidate is
 * treated as already escalated, so a database problem produces silence rather
 * than a burst of duplicates.
 *
 * ## Never throws
 *
 * Same contract every phase sharing `POST /internal/tick` documents on itself.
 * `TickController` has no per-phase try/catch, so a phase that threw would
 * cost every phase after it in the same invocation.
 */
@Injectable()
export class ArrivalTimeoutEscalationService {
  private readonly logger = new Logger(ArrivalTimeoutEscalationService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async run(): Promise<ArrivalTimeoutEscalationResult> {
    const empty: ArrivalTimeoutEscalationResult = {
      examined: 0,
      escalated: 0,
      skipped: 0,
      failed: 0,
    };

    const now = new Date();
    const overdue = await this.listOverdueArrivedDeliveries(now);

    if (overdue.length === 0) {
      return empty;
    }

    const alreadyEscalated = await this.listAlreadyEscalatedIds(overdue.map((d) => d.id));
    const deliveringOrders = await this.listDeliveringOrderIds(overdue.map((d) => d.order_id));

    let escalated = 0;
    let skipped = 0;
    let failed = 0;

    for (const delivery of overdue) {
      if (alreadyEscalated.has(delivery.id)) {
        skipped++;
        continue;
      }

      // The order-state half of eligibility, from live state rather than from
      // the delivery row. An order that ended some other way is not a case an
      // operator can act on with the failure command.
      if (!deliveringOrders.has(delivery.order_id)) {
        skipped++;
        continue;
      }

      const ok = await this.writeEscalation(delivery, now);
      if (ok) escalated++;
      else failed++;
    }

    return { examined: overdue.length, escalated, skipped, failed };
  }

  /**
   * `deliveries` that are `ARRIVED` and whose customer-arrival anchor is at
   * least five minutes old.
   *
   * `arrived_at` is the anchor DEC-054 locked — never `picked_up_at`,
   * `assigned_at`, `created_at`, or the merchant-arrival moment, which has no
   * timestamp at all. A row with a null `arrived_at` cannot satisfy
   * `.lte(...)` and is therefore excluded by the query itself rather than by a
   * check that could be forgotten.
   *
   * Served by `deliveries_arrived_idx`, the partial index Slice #1 created for
   * exactly this scan.
   */
  private async listOverdueArrivedDeliveries(now: Date): Promise<ArrivedDeliveryRow[]> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, order_id, rider_id, arrived_at')
      .eq('state', ARRIVAL_TIMEOUT_DELIVERY_STATE)
      .lte('arrived_at', arrivalTimeoutCutoff(now))
      .returns<ArrivedDeliveryRow[]>();

    if (error) {
      this.logger.error(`Failed to list overdue ARRIVED deliveries: ${error.message}`);
      return [];
    }

    return data ?? [];
  }

  /** Which of these deliveries already carry an escalation. Fail-closed — see the header. */
  private async listAlreadyEscalatedIds(deliveryIds: string[]): Promise<Set<string>> {
    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('entity_id')
      .eq('action', ARRIVAL_TIMEOUT_ACTION)
      .eq('entity_type', 'delivery')
      .in('entity_id', deliveryIds)
      .returns<{ entity_id: string }[]>();

    if (error) {
      this.logger.error(
        `Failed to check existing ${ARRIVAL_TIMEOUT_ACTION} audit rows; treating all as escalated: ${error.message}`,
      );
      return new Set(deliveryIds);
    }

    return new Set((data ?? []).map((row) => row.entity_id));
  }

  /** Which of these orders are still `DELIVERING`. No money column is selected. */
  private async listDeliveringOrderIds(orderIds: string[]): Promise<Set<string>> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, state')
      .in('id', orderIds)
      .eq('state', ARRIVAL_TIMEOUT_ORDER_STATE)
      .returns<OrderStateRow[]>();

    if (error) {
      this.logger.error(
        `Failed to read order states for arrival-timeout escalation; skipping this round: ${error.message}`,
      );
      return new Set();
    }

    return new Set((data ?? []).map((row) => row.id));
  }

  /**
   * The escalation itself — one append-only `audit_logs` row.
   *
   * `actor_type = 'SYSTEM'` with `source = 'worker'`, matching
   * `ProofPhotoRetentionService.writeAuditRecord`, the existing precedent for
   * a tick phase recording what it did. Not `'AI'`: there is no agent, no
   * projection and no model here, and attributing a plain elapsed-time check
   * to an agent would re-create exactly the attribution gap AI-01 closed. Not
   * `'OPERATOR'`: no person acted, and
   * `audit_logs_operator_reason_check` would in any case demand a reason
   * written by one.
   *
   * `after` carries ids, states, the anchor and the counts an operator needs
   * to triage — **no amount, fee, payout or refund**, matching the projection
   * discipline the supervisor contract § 7 imposes. It carries no
   * `failure_cause` either: none exists yet, and DEC-053 § 2 reserves that
   * choice for the operator.
   *
   * Best-effort: a write failure is counted and logged, never thrown, so one
   * bad delivery in a batch does not cost the rest of the round their
   * escalation.
   */
  private async writeEscalation(delivery: ArrivedDeliveryRow, now: Date): Promise<boolean> {
    const waitedSeconds = delivery.arrived_at
      ? Math.floor((now.getTime() - new Date(delivery.arrived_at).getTime()) / 1000)
      : null;

    const contactAttempts = await this.countContactAttempts(delivery.id);

    const { error } = await this.supabase.admin.from('audit_logs').insert({
      actor_type: 'SYSTEM',
      actor_id: null,
      action: ARRIVAL_TIMEOUT_ACTION,
      entity_type: 'delivery',
      entity_id: delivery.id,
      before: null,
      after: {
        orderId: delivery.order_id,
        deliveryState: ARRIVAL_TIMEOUT_DELIVERY_STATE,
        orderState: ARRIVAL_TIMEOUT_ORDER_STATE,
        arrivedAt: delivery.arrived_at,
        waitedSeconds,
        waitSecondsRequired: ARRIVAL_TIMEOUT_SECONDS,
        contactAttempts,
        contactAttemptsRequired: DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
        // States what the operator must now do, so the record cannot be
        // misread as the system having done it.
        awaitingOperatorResolution: true,
      },
      reason:
        `Delivery has been ARRIVED at the customer for ${ARRIVAL_TIMEOUT_SECONDS / 60} minutes ` +
        `(DEC-053 § 3) with ${contactAttempts}/${DELIVERY_CONTACT_ATTEMPTS_REQUIRED} contact attempts recorded. ` +
        'Awaiting operator resolution — never auto-failed.',
      source: 'worker',
    });

    if (error) {
      this.logger.error(
        `audit_logs insert failed for ${ARRIVAL_TIMEOUT_ACTION} (delivery ${delivery.id}): ${error.message}`,
      );
      return false;
    }

    this.logger.warn(
      `Delivery ${delivery.id} (order ${delivery.order_id}) has been ARRIVED for ` +
        `${waitedSeconds === null ? 'an unknown time' : `${Math.floor(waitedSeconds / 60)} minute(s)`} — ` +
        `past DEC-053's ${ARRIVAL_TIMEOUT_SECONDS / 60}-minute wait, awaiting operator resolution. Never auto-failed.`,
    );

    return true;
  }

  /** Reported in the escalation, never required by it — see the header. */
  private async countContactAttempts(deliveryId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('delivery_contact_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_id', deliveryId);

    if (error) {
      this.logger.error(`Contact attempt count failed for delivery ${deliveryId}: ${error.message}`);
      return 0;
    }

    return count ?? 0;
  }
}
