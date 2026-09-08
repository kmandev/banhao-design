import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { BATCH_SIZE } from './payment-event-processing.service';

/** `payment_events`, the columns a claimed refund-domain row needs. */
interface ClaimedRefundEventRow {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  raw_payload: unknown;
}

/** `refunds`, the columns finality processing needs. */
interface RefundRow {
  id: string;
  payment_id: string;
  state: string;
  amount_satang: number;
}

/** `payments`, the columns cross-validation needs. */
interface PaymentRow {
  id: string;
  order_id: string;
  amount_satang: number;
  provider_payment_id: string | null;
}

/** BANHAO's own normalized event names — must match `StripePaymentProvider.normalizeEvent` exactly. */
const REFUND_STATUS_EVENT_TYPE = 'refund.status_reported';
const REFUND_CHARGE_AGGREGATE_EVENT_TYPE = 'refund.charge_aggregate';

/** DEC-057 §4 — the locked, exhaustive provider-status → local-state mapping. Nothing else may ever set `refunds.state` from a provider event. */
const STATE_BY_PROVIDER_STATUS: Record<string, string> = {
  PENDING: 'REFUND_PENDING',
  REQUIRES_ACTION: 'REFUND_REQUESTED',
  SUCCEEDED: 'REFUNDED',
  FAILED: 'REFUND_FAILED',
  CANCELED: 'REFUND_REJECTED',
};

/**
 * Q-020 Slice 2 — refund webhook finality (DEC-057 §2/§4/§5; DEC-058's
 * authority boundary and DEC-059's ledger reversal are both untouched by
 * this file — see "What this service deliberately does NOT do" below).
 *
 * Runs from `POST /internal/tick` (`TickController`), never synchronously
 * inside `WebhooksController` — that controller stays exactly what Slice 1
 * left it: ingest-only, provider-agnostic, unaware refunds exist at all. A
 * refund event is just another verified `payment_events` row to it.
 *
 * ## A second consumer of the same table, not a second architecture
 *
 * `PaymentEventProcessingService` is not modified by this slice — zero lines
 * changed, verified by this session's own diff audit. Refund events instead
 * get their own claim loop over the identical `payment_events` table,
 * filtered to `event_type LIKE 'refund.%'`, using the exact same guarded
 * `UPDATE … WHERE id = … AND processed_at IS NULL` claim `processOne` already
 * uses for payment events — the same concurrency authority, the same
 * never-a-prior-SELECT discipline, the same oldest-first `BATCH_SIZE` batch
 * shape (`BATCH_SIZE` itself is imported, not redefined). Two independent
 * claim loops touching one table is safe because the claim is a single
 * atomic conditional `UPDATE` per row — there is no window in which both
 * loops could win the same row. This shape was chosen over folding refund
 * handling into `PaymentEventProcessingService` itself for the same reason
 * `PaymentAttemptExpiryService`, `NoRiderEscalationService`, and every other
 * tick phase are their own service: one focused class per concern, and zero
 * regression risk to the already-large, ledger-critical payment path this
 * slice must not touch (DEC-059).
 *
 * ## Matching — `provider_refund_id` first, payment association second
 *
 * A claimed event is matched to a local `refunds` row by
 * `(provider, provider_refund_id)` — the same unique index
 * (`refunds_provider_refund_idx`) Slice 1 already populates via
 * `RefundService.markPending`. Once found, the refund's own `payment_id` is
 * read and that payment's `provider_payment_id` is compared against the
 * event's own — never the reverse (never search by payment first), because
 * `provider_refund_id` is the one identity DEC-057 §7 names as the durable
 * external anchor for a specific refund. Every failure to match — a missing
 * `providerRefundId`, an unknown one, a payment-identity conflict, or an
 * amount conflict — fails closed: no `refunds.state` write of any kind, ever
 * (§ "Fail-closed anomalies" below).
 *
 * ## Fail-closed anomalies — recorded, never guessed past
 *
 * `payment_events.processing_error` is the audit trail for every anomaly
 * this service finds, exactly the column `PaymentEventProcessingService`'s
 * own `markUnsupportedEventType` already uses for the same purpose. No
 * `reconciliation_cases` row is opened — that table's `kind` CHECK has no
 * refund-specific value, and adding one is a migration this slice is not
 * authorized to make (DEC-057 § 6 names reconciliation as a *future*,
 * design-deferred capability). The claim stays held (`processed_at` is not
 * cleared) for every anomaly here, because each one is a permanent fact
 * about the event's own immutable `raw_payload` — a missing id, an unknown
 * refund, a mismatched amount — that a retry can never resolve differently.
 * Only a genuine transient failure (a Supabase read/write erroring) throws
 * and releases the claim, matching `PaymentEventProcessingService.processOne`
 * exactly.
 *
 * ## Finality — DEC-057 §4's table, and nothing else may write `refunds.state`
 *
 * `STATE_BY_PROVIDER_STATUS` is that table verbatim. The provider-neutral
 * `status` this reads was already computed by `StripePaymentProvider`'s own
 * `normalizeEvent` at ingest time (DEC-057 §5: `event.data.object.status` is
 * the evidence, never `event.type` alone) — this service never sees a Stripe
 * status literal or calls the Stripe SDK. `REFUNDED` is reached only when
 * `status = SUCCEEDED` *and* the amount check above already passed; it is
 * the first and only point in this codebase that may ever set it, and this
 * slice posts no ledger entry when it does (DEC-059 is Slice 3).
 *
 * ## Terminal protection and idempotency (DEC-057 §2, this slice's own scope)
 *
 * `REFUNDED`, `REFUND_FAILED` and `REFUND_REJECTED` are all treated as
 * terminal — every guarded transition below excludes all three via chained
 * `.neq('state', …)` filters, the identical guard shape
 * `RefundService.markFailed`/`markPending` already use for `REFUNDED` alone.
 * `REFUNDED`'s terminality is DEC-057 §2's own explicit point. `REFUND_FAILED`
 * and `REFUND_REJECTED` are extended the same treatment because neither
 * DEC-057 nor the Q-020 Stripe Refund Sandbox Spike documents any Stripe
 * workflow that revives a failed or Stripe-cancelled refund, and inventing
 * one here would be exactly the kind of undocumented policy this codebase's
 * conventions forbid — a judgement call this service's own tests and this
 * slice's final report both call out explicitly, not a silent assumption.
 * The practical effect: a late-arriving or reordered webhook can advance a
 * refund forward through `REFUND_REQUESTED`/`REFUND_PENDING`, but can never
 * move it backward out of, or past, any of the three terminal states — the
 * guarded `UPDATE` simply matches zero rows on a re-delivery or a
 * stale/out-of-order event, which is not an error, produces no duplicate
 * side effect, and needs no separate idempotency table.
 *
 * ## What this service deliberately does NOT do
 *
 * No DEC-049/DEC-059 ledger reversal of any kind — `ledger_entry_groups` and
 * `ledger_entries` are never read or written anywhere in this file. No
 * `reconciliation_cases` row (see above). No notification, no customer UI,
 * no AI command, no retry scheduler, no partial refund, no second Stripe API
 * call — this service only ever reads `refunds`/`payments` and writes
 * `refunds.state`/`payment_events.processing_error`/`payment_events.payment_id`.
 */
@Injectable()
export class RefundEventProcessingService {
  private readonly logger = new Logger(RefundEventProcessingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Claims and processes up to `BATCH_SIZE` unprocessed refund-domain events. Called once per tick. */
  async processPendingEvents(): Promise<{ processed: number; skipped: number }> {
    const { data: pending, error } = await this.supabase.admin
      .from('payment_events')
      .select('id')
      .is('processed_at', null)
      .like('event_type', 'refund.%')
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`Failed to list pending refund payment_events: ${error.message}`);
      return { processed: 0, skipped: 0 };
    }

    let processed = 0;
    let skipped = 0;

    for (const row of pending ?? []) {
      const outcome = await this.processOne(row.id);
      if (outcome === 'processed') {
        processed++;
      } else {
        skipped++;
      }
    }

    return { processed, skipped };
  }

  /**
   * Claims one event by id and processes it. Returns `'skipped'` for an
   * already-claimed/nonexistent event, or when processing threw and the
   * claim was released for retry — never throws itself, matching
   * `PaymentEventProcessingService.processOne` exactly.
   */
  async processOne(eventId: string): Promise<'processed' | 'skipped'> {
    const { data: claimed, error: claimError } = await this.supabase.admin
      .from('payment_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('processed_at', null)
      .select('id, provider, provider_event_id, event_type, raw_payload')
      .maybeSingle<ClaimedRefundEventRow>();

    if (claimError) {
      this.logger.error(`Failed to claim refund payment_event ${eventId}: ${claimError.message}`);
      return 'skipped';
    }

    if (!claimed) {
      return 'skipped';
    }

    try {
      await this.handleClaimedEvent(claimed);
      return 'processed';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`refund payment_event ${eventId} processing failed, releasing claim for retry: ${message}`);

      const { error: releaseError } = await this.supabase.admin
        .from('payment_events')
        .update({ processed_at: null, processing_error: message })
        .eq('id', eventId);

      if (releaseError) {
        this.logger.error(`Failed to release claim on refund payment_event ${eventId}: ${releaseError.message}`);
      }

      return 'skipped';
    }
  }

  private async handleClaimedEvent(event: ClaimedRefundEventRow): Promise<void> {
    if (event.event_type === REFUND_CHARGE_AGGREGATE_EVENT_TYPE) {
      await this.markInert(
        event.id,
        'charge.refunded is a derived aggregate signal (DEC-057 §5) — never used to identify or finalize a specific refund.',
      );
      return;
    }

    if (event.event_type !== REFUND_STATUS_EVENT_TYPE) {
      await this.markInert(
        event.id,
        `Unsupported refund payment_events.event_type "${event.event_type}" — no handler exists for it; recorded as terminal, not retried.`,
      );
      return;
    }

    const providerRefundId = readString(event.raw_payload, 'providerRefundId');
    if (!providerRefundId) {
      await this.markAnomaly(
        event.id,
        'Refund status event carried no providerRefundId — cannot be matched to a local refund. No state transition.',
      );
      return;
    }

    const { data: refund, error: refundError } = await this.supabase.admin
      .from('refunds')
      .select('id, payment_id, state, amount_satang')
      .eq('provider', event.provider)
      .eq('provider_refund_id', providerRefundId)
      .maybeSingle<RefundRow>();

    if (refundError) {
      throw new Error(`refunds lookup failed: ${refundError.message}`);
    }
    if (!refund) {
      await this.markAnomaly(
        event.id,
        `No local refund found for provider "${event.provider}" refund "${providerRefundId}". No state transition.`,
      );
      return;
    }

    const { data: payment, error: paymentError } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, amount_satang, provider_payment_id')
      .eq('id', refund.payment_id)
      .maybeSingle<PaymentRow>();

    if (paymentError) {
      throw new Error(`payments lookup failed for refund ${refund.id}: ${paymentError.message}`);
    }
    if (!payment) {
      await this.markAnomaly(
        event.id,
        `Refund ${refund.id} references payment ${refund.payment_id}, which does not exist. No state transition.`,
      );
      return;
    }

    // Best-effort audit metadata — never the concurrency or matching
    // authority for anything above or below, same precedent
    // `PaymentEventProcessingService.handleClaimedEvent` already sets.
    const { error: linkError } = await this.supabase.admin
      .from('payment_events')
      .update({ payment_id: payment.id })
      .eq('id', event.id);
    if (linkError) {
      this.logger.error(`payment_events.payment_id backfill failed for ${event.id}: ${linkError.message}`);
    }

    const eventProviderPaymentId = readString(event.raw_payload, 'providerPaymentId');
    if (!eventProviderPaymentId || eventProviderPaymentId !== payment.provider_payment_id) {
      await this.markAnomaly(
        event.id,
        `Refund ${refund.id}'s provider payment identity conflicts with this event's — expected ` +
          `"${payment.provider_payment_id ?? 'null'}", event carried "${eventProviderPaymentId ?? 'null'}". No state transition.`,
      );
      return;
    }

    const eventAmountSatang = readAmount(event.raw_payload, 'amountSatang');
    if (
      eventAmountSatang === undefined ||
      eventAmountSatang !== payment.amount_satang ||
      eventAmountSatang !== refund.amount_satang
    ) {
      await this.markAnomaly(
        event.id,
        `Refund ${refund.id} amount mismatch — event reported ${eventAmountSatang ?? 'undefined'} satang, ` +
          `payment/refund amount is ${payment.amount_satang} satang. No state transition, no ledger entry.`,
      );
      return;
    }

    const providerStatus = readString(event.raw_payload, 'status');
    const targetState = providerStatus ? STATE_BY_PROVIDER_STATUS[providerStatus] : undefined;
    if (!targetState) {
      await this.markAnomaly(
        event.id,
        `Refund ${refund.id} — unrecognized/missing provider status "${providerStatus ?? 'null'}"; ` +
          'no local state has a safe mapping for it. No state transition.',
      );
      return;
    }

    await this.transitionRefund(refund.id, targetState);
  }

  /**
   * Guarded exactly like `RefundService.markFailed`/`markPending` — state
   * repeated in `WHERE`, never a prior read deciding — extended to exclude
   * all three terminal states (see this class's own doc comment). Zero rows
   * matched is the expected, non-error outcome for a duplicate delivery, a
   * stale/out-of-order event, or a refund that has already reached a
   * terminal state some other way.
   */
  private async transitionRefund(refundId: string, targetState: string): Promise<void> {
    const update: Record<string, unknown> = { state: targetState };
    if (targetState === 'REFUNDED') {
      update.completed_at = new Date().toISOString();
    }

    const { error } = await this.supabase.admin
      .from('refunds')
      .update(update)
      .eq('id', refundId)
      .neq('state', 'REFUNDED')
      .neq('state', 'REFUND_FAILED')
      .neq('state', 'REFUND_REJECTED');

    if (error) {
      throw new Error(`refunds ${targetState} transition failed for refund ${refundId}: ${error.message}`);
    }
  }

  /** A recognized event this service deliberately never acts on (charge.refunded) or has no handler for. Terminal, audited, never retried. */
  private async markInert(eventId: string, message: string): Promise<void> {
    this.logger.log(`refund payment_event ${eventId}: ${message}`);
    await this.writeProcessingError(eventId, message);
  }

  /** A genuine matching/validation failure — fails closed, no state transition. Terminal, audited, never retried (the event's own raw_payload is immutable, so a retry would find the identical anomaly). */
  private async markAnomaly(eventId: string, message: string): Promise<void> {
    this.logger.error(`refund payment_event ${eventId}: ${message}`);
    await this.writeProcessingError(eventId, message);
  }

  private async writeProcessingError(eventId: string, message: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('payment_events')
      .update({ processing_error: message })
      .eq('id', eventId);

    if (error) {
      this.logger.error(`payment_events.processing_error write failed for ${eventId}: ${error.message}`);
    }
  }
}

function readString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function readAmount(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
