import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { calculateFoodSubtotalCommissionSatang } from './commission-pricing';

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
 * ## Ledger posting — DEC-043
 *
 * A confirmed `PAID` order now posts exactly one ledger group representing
 * `Merchant → commission → BANHAO` (DEC-025's direction, DEC-043's now-locked
 * 8%-of-food-subtotal rate): `MERCHANT_PAYABLE` debited and `PLATFORM_REVENUE`
 * credited by the same commission amount, so the group sums to zero on its
 * own (DEC-034 — the group is the unit the zero-sum assertion runs over).
 * `postCommissionLedger` runs on both the fresh transition and the
 * already-PAID self-heal branch of `completeSuccessSideEffects` — the exact
 * two places money is confirmed settled — anchored on
 * `commission:<paymentId>:<providerTransactionId>`, so a duplicate delivery
 * of the same event, or a retry of a partially-completed one, can never post
 * the group twice (the same DEC-030 identity `payment_transactions` already
 * uses). It deliberately does **not** run for `SURPLUS_PAYMENT` or
 * `LATE_PAYMENT` — a payment that never (or no longer) genuinely settles this
 * order commits no commission. **Delivery fee and its rider side are
 * untouched: `RIDER_PAYABLE` is not posted here, and BQ-029 (rider earnings)
 * is not resolved by this or any other part of this service.**
 *
 * ## What this service deliberately does NOT do
 *
 * No refund of any kind — Q-020's mechanism does not exist. For
 * `LATE_PAYMENT` and `SURPLUS_PAYMENT`, this service **only detects and
 * records** a `reconciliation_cases` row — DEC-029 and DEC-030 both leave
 * the business resolution `OPEN`; inventing one here would be exactly the
 * kind of undocumented decision this codebase's own conventions forbid. A
 * `payment.failed` event opens no reconciliation case either — a failed
 * payment attempt is an ordinary, expected outcome the state machine already
 * models (`PAYMENT_LIFECYCLE.md`'s own `FAILED --> PENDING : retry` edge,
 * already reachable via `PaymentsService.regenerateAttempt`), not an anomaly
 * requiring operator review. No `RIDER_PAYABLE`, no `CUSTOMER_PAYMENT`, no
 * delivery-fee-to-rider posting — those require BQ-029, which is `OPEN` and
 * out of scope here.
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

      // This exact event's transaction was already recorded — DEC-030's own
      // anchor: a conflict on THIS event's own provider_transaction_id can
      // only mean THIS event, not a distinct one. Two different reasons land
      // here, and they must be told apart, not both funneled into
      // `completeSuccessSideEffects`:
      //
      //  (a) A genuine retry of this same event whose earlier run recorded
      //      the transaction but did not finish every downstream step
      //      (self-heal — every step in `completeSuccessSideEffects` is
      //      independently guarded, so calling it again is safe).
      //  (b) This event was already correctly classified `SURPLUS_PAYMENT`
      //      by an earlier run whose `reconciliation_cases` insert then
      //      failed — the case must be recreated, and
      //      `completeSuccessSideEffects` must NOT run: a surplus payment
      //      touches no attempt/order state, exactly as the fresh-insert
      //      branch above already decided before its own INSERT stopped
      //      being "fresh" on this retry.
      //
      // Told apart by asking which transaction was recorded FIRST for this
      // payment: if it is this event's own, (a); if it belongs to a
      // different event, (b). This is a read for classification only — it
      // does not replace the INSERT-conflict as DEC-030's uniqueness
      // authority (that remains exactly the check above), the same way the
      // "order already PAID" branch below already reads `orders` to
      // classify self-heal vs. late payment without becoming the
      // concurrency authority for the order transition itself.
      if (payment.state === 'SUCCESS') {
        const { data: earliestTransaction } = await this.supabase.admin
          .from('payment_transactions')
          .select('provider_transaction_id')
          .eq('payment_id', payment.id)
          .order('occurred_at', { ascending: true })
          .limit(1)
          .maybeSingle<{ provider_transaction_id: string }>();

        if (earliestTransaction && earliestTransaction.provider_transaction_id !== providerTransactionId) {
          await this.openCase('SURPLUS_PAYMENT', {
            paymentEventId: event.id,
            paymentId: payment.id,
            orderId: payment.order_id,
          });
          return;
        }
      }

      await this.completeSuccessSideEffects(event.id, payment, attempt, providerTransactionId);
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

    await this.completeSuccessSideEffects(event.id, payment, attempt, providerTransactionId);
  }

  /**
   * `payments → SUCCESS`, `payment_attempts → SUCCESS`, guarded
   * `orders PENDING_PAYMENT → PAID`, `order_status_history`, and the
   * commission ledger group (DEC-043 — see this file's own doc comment).
   * Every write here is individually guarded (state-in-WHERE, or the
   * ledger's own `group_key` uniqueness) so calling this twice for the same
   * payment — the self-heal retry path above — never double-applies
   * anything; a step already done simply matches 0 rows, or a unique
   * conflict, and is skipped.
   */
  private async completeSuccessSideEffects(
    eventId: string,
    payment: PaymentRow,
    attempt: PaymentAttemptRow | null,
    providerTransactionId: string,
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
      .select('id, customer_id, restaurant_id')
      .maybeSingle<{ id: string; customer_id: string; restaurant_id: string }>();

    if (orderError) {
      throw new Error(`orders PAID transition failed: ${orderError.message}`);
    }

    if (transitionedOrder) {
      await this.writeOrderHistory(payment.order_id);
      await this.postCommissionLedger(payment, providerTransactionId);
      // H-3 — fires only on the guarded-UPDATE winner (this branch), so a
      // self-heal retry of this same event (the earlier-run-already-recorded
      // path a few lines up) never reaches here and never double-notifies.
      await this.writePaymentSucceededOutboxEvent(transitionedOrder);
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
      // Correctly PAID — but was it THIS transition's own history row that
      // put it there, or did the process crash between the orders UPDATE
      // committing and the order_status_history INSERT committing (the
      // known F-2b crash window)? `writeOrderHistory` is not itself
      // idempotent (no unique constraint models "one row per transition" —
      // deliberately not added here, no migration), so existence is
      // checked first, narrowly, only on this already-rare self-heal path.
      await this.ensureOrderHistoryRecorded(payment.order_id);
      await this.postCommissionLedger(payment, providerTransactionId);
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

  /**
   * Self-heals the `order_status_history` crash window (F-2b): only called
   * from the "order already correctly PAID" branch of
   * `completeSuccessSideEffects`, after the guarded `orders` UPDATE has
   * already matched 0 rows for THIS event's own attempt — i.e. exactly the
   * narrow, already-rare retry path where the crash window matters. Checks
   * for the specific `PENDING_PAYMENT → PAID` row before writing, so a
   * retry that finds the row already present (the normal case: this
   * event's own earlier run wrote it, or a different event already did)
   * writes nothing.
   */
  private async ensureOrderHistoryRecorded(orderId: string): Promise<void> {
    const { data: existing, error } = await this.supabase.admin
      .from('order_status_history')
      .select('id')
      .eq('order_id', orderId)
      .eq('from_state', 'PENDING_PAYMENT')
      .eq('to_state', 'PAID')
      .maybeSingle<{ id: string }>();

    if (error) {
      throw new Error(`order_status_history existence check failed: ${error.message}`);
    }

    if (existing) {
      return;
    }

    await this.writeOrderHistory(orderId);
  }

  /**
   * DEC-043 — posts the `Merchant → commission → BANHAO` ledger group for a
   * confirmed `PAID` order: `MERCHANT_PAYABLE` debited and `PLATFORM_REVENUE`
   * credited by the same 8%-of-food-subtotal commission amount, so the group
   * sums to zero on its own. Commission is derived from `orders.subtotal_satang`
   * — the food subtotal only, never delivery fee, service fee, discount or
   * the grand total — read fresh from the (immutable) order row, never from
   * the client or from `payment.amount_satang`.
   *
   * Anchored on `commission:<paymentId>:<providerTransactionId>` — the same
   * event identity `payment_transactions.provider_transaction_id` already
   * uses for DEC-030 — via `ledger_entry_groups.group_key`'s own unique
   * constraint (`20260811000007_ledger_domain.sql`), so a duplicate delivery
   * of the same event, or a retry of a partially-completed one, can never
   * post the group twice. No `RIDER_PAYABLE`, no `CUSTOMER_PAYMENT`: the
   * delivery fee's rider side is BQ-029, `OPEN`, and out of scope.
   */
  private async postCommissionLedger(payment: PaymentRow, providerTransactionId: string): Promise<void> {
    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('id, restaurant_id, subtotal_satang')
      .eq('id', payment.order_id)
      .maybeSingle<{ id: string; restaurant_id: string; subtotal_satang: number }>();

    if (orderError) {
      throw new Error(`orders read for commission ledger failed: ${orderError.message}`);
    }
    if (!order) {
      throw new Error(`orders read for commission ledger found no row for ${payment.order_id}`);
    }

    const { data: restaurant, error: restaurantError } = await this.supabase.admin
      .from('restaurants')
      .select('merchant_id')
      .eq('id', order.restaurant_id)
      .maybeSingle<{ merchant_id: string }>();

    if (restaurantError) {
      throw new Error(`restaurants read for commission ledger failed: ${restaurantError.message}`);
    }
    if (!restaurant) {
      throw new Error(`restaurants read for commission ledger found no row for ${order.restaurant_id}`);
    }

    const commissionSatang = calculateFoodSubtotalCommissionSatang(order.subtotal_satang);
    const groupKey = `commission:${payment.id}:${providerTransactionId}`;

    const { data: group, error: groupError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .insert({ group_key: groupKey, order_id: order.id, kind: 'MERCHANT_COMMISSION' })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (groupError) {
      if (!isUniqueViolation(groupError)) {
        throw new Error(`ledger_entry_groups insert failed: ${groupError.message}`);
      }

      // Already posted by an earlier run of this same event (self-heal), OR
      // the group committed but the entries insert below did not (the same
      // class of narrow crash window `ensureOrderHistoryRecorded` already
      // handles for order_status_history) — told apart, and completed if
      // needed, by ensureCommissionEntriesRecorded.
      await this.ensureCommissionEntriesRecorded(groupKey, restaurant.merchant_id, commissionSatang);
      return;
    }

    if (!group) {
      throw new Error('ledger_entry_groups insert returned no row');
    }

    await this.insertCommissionEntries(group.id, restaurant.merchant_id, commissionSatang);
  }

  private async ensureCommissionEntriesRecorded(
    groupKey: string,
    merchantId: string,
    commissionSatang: number,
  ): Promise<void> {
    const { data: existingGroup, error: groupReadError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id')
      .eq('group_key', groupKey)
      .maybeSingle<{ id: string }>();

    if (groupReadError) {
      throw new Error(`ledger_entry_groups read failed: ${groupReadError.message}`);
    }
    if (!existingGroup) {
      throw new Error(`ledger_entry_groups read found no row for group_key ${groupKey}`);
    }

    const { data: existingEntries, error: entriesReadError } = await this.supabase.admin
      .from('ledger_entries')
      .select('id')
      .eq('group_id', existingGroup.id)
      .returns<{ id: string }[]>();

    if (entriesReadError) {
      throw new Error(`ledger_entries existence check failed: ${entriesReadError.message}`);
    }
    if (existingEntries && existingEntries.length > 0) {
      return;
    }

    await this.insertCommissionEntries(existingGroup.id, merchantId, commissionSatang);
  }

  /** `MERCHANT_PAYABLE` debited, `PLATFORM_REVENUE` credited, by the same amount — sums to zero (DEC-034). */
  private async insertCommissionEntries(
    groupId: string,
    merchantId: string,
    commissionSatang: number,
  ): Promise<void> {
    const { error } = await this.supabase.admin.from('ledger_entries').insert([
      {
        group_id: groupId,
        account: 'MERCHANT_PAYABLE',
        party_type: 'MERCHANT',
        party_id: merchantId,
        amount_satang: -commissionSatang,
      },
      {
        group_id: groupId,
        account: 'PLATFORM_REVENUE',
        party_type: 'PLATFORM',
        party_id: null,
        amount_satang: commissionSatang,
      },
    ]);

    if (error) {
      throw new Error(`ledger_entries insert failed: ${error.message}`);
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

  /**
   * H-3 — `PaymentSucceeded`, CUSTOMER + MERCHANT. Reads `restaurants`/
   * `merchants` directly, extending this service's own already-established
   * precedent of reading/writing `orders` directly from the payments module
   * (see `completeSuccessSideEffects` above) one relationship further, per
   * the H-3 contract's explicit instruction to use the existing order/
   * restaurant/merchant-owner relationship. Never throws: a resolution
   * failure omits that recipient, and a total failure to write the outbox
   * row is logged and swallowed — the payment has already succeeded and
   * already been reported; a lost notification must never turn that into a
   * failed webhook-processing attempt (which would also mean expensive
   * event-claim churn on retry).
   */
  private async writePaymentSucceededOutboxEvent(order: {
    id: string;
    customer_id: string;
    restaurant_id: string;
  }): Promise<void> {
    const recipients: OutboxRecipient[] = [{ recipientId: order.customer_id, recipientType: 'CUSTOMER' }];

    const merchantOwnerId = await this.resolveMerchantOwnerId(order.restaurant_id);
    if (merchantOwnerId) {
      recipients.push({ recipientId: merchantOwnerId, recipientType: 'MERCHANT' });
    }

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: 'order',
      aggregate_id: order.id,
      event_type: 'PaymentSucceeded',
      payload: { recipients },
    });

    if (error) {
      this.logger.error(`outbox insert failed for PaymentSucceeded (order ${order.id}): ${error.message}`);
    }
  }

  /** `restaurants.merchant_id -> merchants.owner_user_id` — see `writePaymentSucceededOutboxEvent`'s own comment on why this module reads these tables directly. */
  private async resolveMerchantOwnerId(restaurantId: string): Promise<string | null> {
    const { data: restaurant, error: restaurantError } = await this.supabase.admin
      .from('restaurants')
      .select('merchant_id')
      .eq('id', restaurantId)
      .maybeSingle<{ merchant_id: string }>();

    if (restaurantError || !restaurant) {
      this.logger.error(
        `Merchant-owner resolution: restaurants read failed for ${restaurantId}: ${restaurantError?.message ?? 'not found'}`,
      );
      return null;
    }

    const { data: merchant, error: merchantError } = await this.supabase.admin
      .from('merchants')
      .select('owner_user_id')
      .eq('id', restaurant.merchant_id)
      .maybeSingle<{ owner_user_id: string }>();

    if (merchantError || !merchant) {
      this.logger.error(
        `Merchant-owner resolution: merchants read failed for restaurant ${restaurantId}: ${merchantError?.message ?? 'not found'}`,
      );
      return null;
    }

    return merchant.owner_user_id;
  }
}

/** H-3 locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching `isUniqueViolation`'s own established precedent in this codebase rather than a shared cross-module resolver. */
type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
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
