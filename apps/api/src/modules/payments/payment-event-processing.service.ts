import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/** How many unprocessed `payment_events` one tick claims work from at most. */
const BATCH_SIZE = 25;

type ReconciliationKind = 'UNMATCHED_EVENT' | 'AMOUNT_MISMATCH' | 'LATE_PAYMENT' | 'SURPLUS_PAYMENT';

/** `payment_events`, the columns a claimed row needs for processing. */
interface ClaimedEventRow {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  raw_payload: unknown;
}

/** The one event type this service has ever recognized — the existing, unchanged success path. */
const SUCCEEDED_EVENT_TYPE = 'payment.succeeded';

/** `PROCESSING --> FAILED : provider reports failure` — `PAYMENT_LIFECYCLE.md` § 3. */
const FAILED_EVENT_TYPE = 'payment.failed';

/** `payments`, the columns processing needs. */
interface PaymentRow {
  id: string;
  order_id: string;
  amount_satang: number;
  state: string;
}

/** `payment_attempts`, the columns processing needs. */
interface PaymentAttemptRow {
  id: string;
  state: string;
}

/**
 * Phase 2 payment-event processing (F-2b) — ADR-008.
 *
 * Runs from `POST /internal/tick` (`TickController`), never synchronously
 * inside `WebhooksController` — that controller's whole job (F-2a) is
 * ingest-only: verify a signature, persist one `payment_events` row, return.
 * This service is what turns a persisted, verified event into
 * `payments`/`payment_attempts`/`payment_transactions`/`orders` state,
 * exactly the split V1.1 §8 describes ("Phase 1 — ingest" / "Phase 2 —
 * process").
 *
 * ## Claiming — the guarded UPDATE is the sole concurrency authority
 *
 * `processOne` claims a `payment_events` row with a single conditional
 * `UPDATE … SET processed_at = now() WHERE id = … AND processed_at IS NULL`,
 * matching every other transition in this codebase (never a prior `SELECT`
 * to decide). Exactly one caller can win a given row; the loser sees 0 rows
 * and simply skips it. If the claimed row's processing throws an *unexpected*
 * error, the claim is explicitly released (`processed_at` set back to
 * `null`, `processing_error` recorded) so the next tick retries it — a
 * definitively classified outcome (success, or any of the four
 * reconciliation kinds below) is never released, because it does not need
 * to be reprocessed.
 *
 * ## The money-movement anchor — DEC-030
 *
 * `payment_transactions.provider_transaction_id` (mapped 1:1 from
 * `provider_event_id` — see `handleResolvedEvent`'s own comment) is the
 * single source of truth for "has this exact event's money already been
 * durably recorded." It is checked by *attempting the insert*, never a prior
 * `SELECT` — a unique-constraint conflict there means either a genuine retry
 * of this same event (self-heal: finish whatever downstream steps did not
 * yet run) or, when the payment was already `SUCCESS` from a *different*
 * event, a real DEC-030 surplus.
 *
 * ## Event type — `payment.succeeded` vs `payment.failed`
 *
 * `event_type` (persisted verbatim from `WebhooksController`'s own
 * `providerEvent`, F-2a) decides the branch: `payment.succeeded` runs the
 * original F-2b money path unchanged; `payment.failed` runs
 * `handleFailureEvent` — `PAYMENT_LIFECYCLE.md` § 3's
 * `PROCESSING --> FAILED : provider reports failure` edge, closing the one
 * state-machine transition F-2b never handled (every claimed event was
 * previously treated as a success regardless of its actual type — a
 * correctness gap, not a deliberate simplification). Any other event type is
 * genuinely unrecognized: this throws rather than guessing, so the claim is
 * released for retry/investigation (see `processOne`) instead of either
 * silently recording money that may not exist or silently discarding a
 * signal that might.
 *
 * ## What this service deliberately does NOT do
 *
 * No `ledger_entry_groups`, no `ledger_entries`, no commission, no
 * merchant/rider/platform payable posting — DEC-025's own consequences
 * clause forbids writing that code until Q-010/BQ-028 (commission rate)
 * resolves. No refund of any kind — Q-020's mechanism does not exist. For
 * `LATE_PAYMENT` and `SURPLUS_PAYMENT`, this service **only detects and
 * records** a `reconciliation_cases` row — DEC-029 and DEC-030 both leave
 * the business resolution `OPEN`; inventing one here would be exactly the
 * kind of undocumented decision this codebase's own conventions forbid. A
 * `payment.failed` event opens no reconciliation case either — a failed
 * payment attempt is an ordinary, expected outcome the state machine already
 * models (`PAYMENT_LIFECYCLE.md`'s own `FAILED --> PENDING : retry` edge,
 * already reachable via `PaymentsService.regenerateAttempt`), not an anomaly
 * requiring operator review.
 */
@Injectable()
export class PaymentEventProcessingService {
  private readonly logger = new Logger(PaymentEventProcessingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Claims and processes up to `BATCH_SIZE` unprocessed events. Called once per tick. */
  async processPendingEvents(): Promise<{ processed: number; skipped: number }> {
    const { data: pending, error } = await this.supabase.admin
      .from('payment_events')
      .select('id')
      .is('processed_at', null)
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`Failed to list pending payment_events: ${error.message}`);
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
   * claim was released for retry — never throws itself, so a batch loop
   * never aborts partway through on one bad event.
   */
  async processOne(eventId: string): Promise<'processed' | 'skipped'> {
    const { data: claimed, error: claimError } = await this.supabase.admin
      .from('payment_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', eventId)
      .is('processed_at', null)
      .select('id, provider, provider_event_id, event_type, raw_payload')
      .maybeSingle<ClaimedEventRow>();

    if (claimError) {
      this.logger.error(`Failed to claim payment_event ${eventId}: ${claimError.message}`);
      return 'skipped';
    }

    if (!claimed) {
      // Already claimed by a concurrent tick, already processed, or the id
      // does not exist — every case is a legitimate skip, not an error.
      return 'skipped';
    }

    try {
      await this.handleClaimedEvent(claimed);
      return 'processed';
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`payment_event ${eventId} processing failed, releasing claim for retry: ${message}`);

      const { error: releaseError } = await this.supabase.admin
        .from('payment_events')
        .update({ processed_at: null, processing_error: message })
        .eq('id', eventId);

      if (releaseError) {
        this.logger.error(`Failed to release claim on payment_event ${eventId}: ${releaseError.message}`);
      }

      return 'skipped';
    }
  }

  private async handleClaimedEvent(event: ClaimedEventRow): Promise<void> {
    const providerPaymentId = readString(event.raw_payload, 'providerPaymentId');

    if (!providerPaymentId) {
      await this.openCase('UNMATCHED_EVENT', { paymentEventId: event.id });
      return;
    }

    const { data: payment, error: paymentError } = await this.supabase.admin
      .from('payments')
      .select('id, order_id, amount_satang, state')
      .eq('provider', event.provider)
      .eq('provider_payment_id', providerPaymentId)
      .maybeSingle<PaymentRow>();

    if (paymentError) {
      throw new Error(`payments lookup failed: ${paymentError.message}`);
    }

    if (!payment) {
      await this.openCase('UNMATCHED_EVENT', { paymentEventId: event.id });
      return;
    }

    // Best-effort audit metadata — never the concurrency authority for
    // anything below. `payment_events.payment_id` starts null (F-2a); once
    // resolved, recording the match costs nothing and helps a human reading
    // the table, per the column's own migration comment.
    const { error: linkError } = await this.supabase.admin
      .from('payment_events')
      .update({ payment_id: payment.id })
      .eq('id', event.id);
    if (linkError) {
      this.logger.error(`payment_events.payment_id backfill failed for ${event.id}: ${linkError.message}`);
    }

    if (event.event_type === FAILED_EVENT_TYPE) {
      await this.handleFailureEvent(event, payment);
      return;
    }

    if (event.event_type !== SUCCEEDED_EVENT_TYPE) {
      throw new Error(`Unrecognized payment_events.event_type "${event.event_type}" for event ${event.id}`);
    }

    const eventAmountSatang = readAmount(event.raw_payload, 'amountSatang');
    if (eventAmountSatang === undefined || eventAmountSatang !== payment.amount_satang) {
      await this.openCase('AMOUNT_MISMATCH', {
        paymentEventId: event.id,
        paymentId: payment.id,
        orderId: payment.order_id,
      });
      return;
    }

    const { data: attempt } = await this.supabase.admin
      .from('payment_attempts')
      .select('id, state')
      .eq('payment_id', payment.id)
      .order('attempt_no', { ascending: false })
      .limit(1)
      .maybeSingle<PaymentAttemptRow>();

    await this.recordTransactionAndComplete(event, payment, attempt ?? null);
  }

  /**
   * `payment.failed` — `payments PENDING/PROCESSING → FAILED`,
   * `payment_attempts PENDING → FAILED` (the current/latest attempt only).
   * No money moved (no `payment_transactions` row — there is nothing to
   * record), no `orders` mutation (`FAILED` pairs with `PENDING_PAYMENT`
   * unchanged, `PAYMENT_LIFECYCLE.md` § 3's state table), no ledger, no
   * reconciliation case. Both writes are individually guarded
   * (state-in-`WHERE`), so a duplicate delivery of the same failure event —
   * or a retry after this method's own release-on-error path — never
   * double-applies anything; an already-`FAILED` payment/attempt simply
   * matches 0 rows and is silently skipped, the same idempotent-retry
   * discipline `completeSuccessSideEffects` already follows for the success
   * path.
   */
  private async handleFailureEvent(event: ClaimedEventRow, payment: PaymentRow): Promise<void> {
    const failureReason = readString(event.raw_payload, 'reason');

    const { error: paymentError } = await this.supabase.admin
      .from('payments')
      .update({ state: 'FAILED', failed_at: new Date().toISOString(), failure_reason: failureReason ?? null })
      .eq('id', payment.id)
      .in('state', ['PENDING', 'PROCESSING']);

    if (paymentError) {
      throw new Error(`payments FAILED transition failed: ${paymentError.message}`);
    }

    const { data: attempt } = await this.supabase.admin
      .from('payment_attempts')
      .select('id')
      .eq('payment_id', payment.id)
      .order('attempt_no', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (!attempt) {
      return;
    }

    const { error: attemptError } = await this.supabase.admin
      .from('payment_attempts')
      .update({ state: 'FAILED', failure_reason: failureReason ?? null })
      .eq('id', attempt.id)
      .eq('state', 'PENDING');

    if (attemptError) {
      throw new Error(`payment_attempts FAILED transition failed: ${attemptError.message}`);
    }
  }

  /**
   * The DEC-030 anchor. `provider_transaction_id` is the event's own
   * `provider_event_id` — documented intentionally: in this simulated
   * one-event/one-transaction model there is exactly one money movement per
   * event, so reusing the identity costs nothing and gives the two
   * idempotency mechanisms (`payment_events`' event uniqueness,
   * `payment_transactions`' transaction uniqueness) the same anchor. A real
   * provider's webhook may report several transactions per event (a partial
   * capture, a correction) — that reconciliation is Phase F′ work, once a
   * real provider exists to define the actual shape.
   */
  private async recordTransactionAndComplete(
    event: ClaimedEventRow,
    payment: PaymentRow,
    attempt: PaymentAttemptRow | null,
  ): Promise<void> {
    const providerTransactionId = event.provider_event_id;

    const { data: transaction, error: txError } = await this.supabase.admin
      .from('payment_transactions')
      .insert({
        payment_id: payment.id,
        payment_attempt_id: attempt?.id ?? null,
        direction: 'IN',
        amount_satang: payment.amount_satang,
        provider_transaction_id: providerTransactionId,
      })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (txError) {
      if (!isUniqueViolation(txError)) {
        throw new Error(`payment_transactions insert failed: ${txError.message}`);
      }

      // This exact event's transaction was already recorded — a genuine
      // retry of this same event (self-heal: run whatever downstream step
      // did not yet complete; every step below is independently guarded, so
      // this is safe to attempt again unconditionally) or a concurrent
      // claim that already finished. Never re-classified as surplus: a
      // conflict on THIS event's own transaction id can only mean THIS
      // event, not a distinct one.
      await this.completeSuccessSideEffects(event.id, payment, attempt);
      return;
    }

    if (!transaction) {
      throw new Error('payment_transactions insert returned no row');
    }

    if (payment.state === 'SUCCESS') {
      // A genuinely new, distinct transaction against an already-successful
      // payment (DEC-030). The money is recorded above; nothing else moves,
      // and no refund/auto-resolution is attempted — the policy is OPEN.
      await this.openCase('SURPLUS_PAYMENT', {
        paymentEventId: event.id,
        paymentId: payment.id,
        orderId: payment.order_id,
      });
      return;
    }

    await this.completeSuccessSideEffects(event.id, payment, attempt);
  }

  /**
   * `payments → SUCCESS`, `payment_attempts → SUCCESS`, guarded
   * `orders PENDING_PAYMENT → PAID`, `order_status_history`. Every write
   * here is individually guarded (state-in-WHERE) so calling this twice for
   * the same payment — the self-heal retry path above — never double-applies
   * anything; a step already done simply matches 0 rows and is skipped.
   */
  private async completeSuccessSideEffects(
    eventId: string,
    payment: PaymentRow,
    attempt: PaymentAttemptRow | null,
  ): Promise<void> {
    const now = new Date().toISOString();

    const { error: paymentError } = await this.supabase.admin
      .from('payments')
      .update({ state: 'SUCCESS', succeeded_at: now })
      .eq('id', payment.id)
      .in('state', ['PENDING', 'PROCESSING']);
    if (paymentError) {
      throw new Error(`payments state update failed: ${paymentError.message}`);
    }

    if (attempt) {
      const { error: attemptError } = await this.supabase.admin
        .from('payment_attempts')
        .update({ state: 'SUCCESS' })
        .eq('id', attempt.id)
        .eq('state', 'PENDING');
      if (attemptError) {
        throw new Error(`payment_attempts state update failed: ${attemptError.message}`);
      }
    }

    const { data: transitionedOrder, error: orderError } = await this.supabase.admin
      .from('orders')
      .update({ state: 'PAID', paid_at: now })
      .eq('id', payment.order_id)
      .eq('state', 'PENDING_PAYMENT')
      .select('id')
      .maybeSingle<{ id: string }>();

    if (orderError) {
      throw new Error(`orders PAID transition failed: ${orderError.message}`);
    }

    if (transitionedOrder) {
      await this.writeOrderHistory(payment.order_id);
      return;
    }

    // The order did not move. Distinguish "already correctly PAID" (this
    // same event's own earlier, partially-completed run — nothing wrong,
    // nothing to record) from "genuinely moved on" (DEC-029's late-payment
    // shape — money arrived for an order life-cycle that already ended
    // elsewhere).
    const { data: currentOrder } = await this.supabase.admin
      .from('orders')
      .select('id, state')
      .eq('id', payment.order_id)
      .maybeSingle<{ id: string; state: string }>();

    if (currentOrder?.state === 'PAID') {
      return;
    }

    await this.openCase('LATE_PAYMENT', {
      paymentEventId: eventId,
      paymentId: payment.id,
      orderId: payment.order_id,
    });
  }

  private async writeOrderHistory(orderId: string): Promise<void> {
    const { error } = await this.supabase.admin.from('order_status_history').insert({
      order_id: orderId,
      from_state: 'PENDING_PAYMENT',
      to_state: 'PAID',
      actor_type: 'WEBHOOK',
      // No user/profile initiated this — a webhook has no actor_id. No
      // correlation_id either: payment_events carries none, and tick
      // processing runs outside any HTTP request's correlation context.
      actor_id: null,
      reason: null,
      correlation_id: null,
    });

    if (error) {
      throw new Error(`order_status_history insert failed: ${error.message}`);
    }
  }

  private async openCase(
    kind: ReconciliationKind,
    refs: { paymentEventId?: string; paymentId?: string; orderId?: string },
  ): Promise<void> {
    const { error } = await this.supabase.admin.from('reconciliation_cases').insert({
      kind,
      payment_event_id: refs.paymentEventId ?? null,
      payment_id: refs.paymentId ?? null,
      order_id: refs.orderId ?? null,
    });

    if (error) {
      throw new Error(`reconciliation_cases insert failed (${kind}): ${error.message}`);
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

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
