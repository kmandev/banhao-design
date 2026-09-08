import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentInitiationResponse } from '@banhao/validation';
import { emailSchema, uuidSchema } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type { PaymentProvider } from './payment-provider.interface';
import { CUSTOMER_EMAIL_SOURCE } from './customer-email-source';
import type { CustomerEmailSource } from './customer-email-source';

/** `orders`, the columns this service reads/writes for payment initiation. */
interface OrderPaymentRow {
  id: string;
  order_number: string;
  grand_total_satang: number;
  customer_id: string;
  state: string;
}

/** `payments`, as selected back for the response. */
interface PaymentRow {
  id: string;
  payment_reference: string;
  state: string;
  amount_satang: number;
  currency: string;
}

/** `payment_attempts`, the columns resumption/regeneration need to branch and act on. */
interface PaymentAttemptRow {
  id: string;
  attempt_no: number;
  state: string;
  qr_payload: string | null;
  expires_at: string | null;
}

/**
 * The fields `toResponse` actually reads off an attempt — every call site has
 * at least this much.
 *
 * `hosted_instructions_url` is deliberately **not** a `payment_attempts`
 * column (DEC-055 Addendum A left it out to avoid a migration this task did
 * not need) — it exists only in memory, threaded through from a fresh
 * `CreatePaymentResult.presentation.hostedInstructionsUrl` on the two call
 * sites that actually call the provider (`initializePayment`,
 * `regenerateAttempt`). A response built from a plain DB read
 * (`PaymentAttemptRow` — every idempotent/resumed read, and a losing
 * regeneration's read-back of the winner's attempt) never carries it, because
 * nothing persists it. This is a known, accepted limitation: the field is
 * optional and present only on the request that minted it.
 */
type AttemptPresentation = Pick<PaymentAttemptRow, 'qr_payload' | 'expires_at'> & {
  hosted_instructions_url?: string;
};

/**
 * How long a payment attempt (QR) stays valid — BANHAO's own policy
 * (DEC-055 Addendum A), computed here and only here. Matches the pre-existing
 * 10-minute window `NullPaymentProvider` used to invent for itself; moving it
 * here changes nothing about the duration, only who decides it. Never read
 * off a provider result — `CreatePaymentResult.presentation` carries no
 * expiry field at all.
 */
export const PAYMENT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function computeAttemptExpiresAt(): string {
  return new Date(Date.now() + PAYMENT_ATTEMPT_TTL_MS).toISOString();
}

/**
 * Payment states from which a repeat call to this endpoint must regenerate a
 * new attempt (QR) rather than return the existing one — `PAYMENT_LIFECYCLE.md`
 * § 3's mermaid `EXPIRED --> PENDING` / `FAILED --> PENDING` edges, both
 * `ACCEPTED`.
 */
const REGENERABLE_PAYMENT_STATES = new Set(['EXPIRED', 'FAILED']);

/**
 * Payment states from which this endpoint must reject outright — money has
 * moved (`SUCCESS`) or is moving (`REFUND_*`), and this endpoint's whole job
 * is *initiating* payment, never re-initiating it. `docs/BANHAO-APP-ARCHITECTURE-V1.md`
 * § 6's own operations table names this exact rejection `PAYMENT_ALREADY_SUCCEEDED`
 * for the endpoint, not a broader "payment not payable" — kept distinct from
 * `ORDER_NOT_PAYABLE`, which is about the *order's* state, not the payment's.
 */
const ALREADY_SUCCEEDED_PAYMENT_STATES = new Set(['SUCCESS', 'REFUND_PENDING', 'REFUND_PROCESSING', 'REFUNDED']);

/**
 * `POST /api/v1/orders/:id/payment` (Phase F-1, extended for attempt
 * regeneration — DEC-029).
 *
 * Moves `CREATED → PENDING_PAYMENT` (DEC-019) and creates the `payments` +
 * `payment_attempts` pair that represents "a QR has been issued" (the
 * `CREATED → PENDING` edge in `docs/PAYMENT_LIFECYCLE.md` § 3's payment state
 * machine — a payment is created already at `PENDING`, not left at `CREATED`,
 * because issuing the QR is this call's whole point).
 *
 * ## Pricing — extends DEC-035/DEC-036's own discipline
 *
 * The only money value read here is `orders.grand_total_satang`, already
 * locked in by `OrderPricingService` at order creation. The request carries no
 * amount, no method, no fee — there is nothing for a client to legitimately
 * choose (Phase 1 is online-only, DEC-016), so nothing is accepted.
 *
 * ## Idempotency — DEC-028
 *
 * `payments_order_id_key` is the natural key V1.1 §8's idempotency map names
 * for this exact operation. A second call for the same order — a genuine
 * retry, a double-tap, or two concurrent requests racing — must read back the
 * same payment, never create a second one and never error as if something
 * were wrong. Three paths converge on that one guarantee:
 *
 * 1. The common case: the order is already `PENDING_PAYMENT` (this service's
 *    own prior call put it there) and a `payments` row already exists —
 *    read it back, branching on the payment's own state (see
 *    `resumePayment`) rather than always returning it unconditionally.
 * 2. The narrow crash-recovery case: the order reached `PENDING_PAYMENT` but
 *    the process died before the `payments` row was written. This service is
 *    the *only* writer of that transition, so finding the order there with no
 *    payment yet is safe to complete, not a new transition — self-heals by
 *    finishing initialization now.
 * 3. The true race: two requests both reach case 2 at once. The
 *    `payments_order_id_key` unique constraint lets exactly one `INSERT`
 *    through; the loser catches the `23505` and reads back the winner's row.
 *    The same pattern — attempt the guarded write, catch `23505`, read back
 *    the winner, never a prior `SELECT` as the authority — is reused by
 *    `regenerateAttempt` for `payment_attempts_payment_attempt_no_key`.
 *
 * ## Atomicity
 *
 * The order's own state transition is one guarded conditional `UPDATE` —
 * `state = 'CREATED'` repeated in the `WHERE` clause, never a prior `SELECT`
 * to decide (ADR-003), matching `OrdersService`'s own transitions. The
 * `payments`/`payment_attempts` inserts that follow are separate statements,
 * not one transaction — this codebase has no cross-table transaction
 * mechanism outside `create_order()`'s dedicated RPC, and case 2 above exists
 * precisely to make that gap self-healing rather than silently broken. The
 * same gap applies to `regenerateAttempt`'s own attempt-insert-then-payment-
 * update pair — see that method's own comment.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(CUSTOMER_EMAIL_SOURCE) private readonly emailSource: CustomerEmailSource,
  ) {}

  /**
   * Resolves and validates the customer's authoritative payment email
   * (DEC-056) — server-side, from `CustomerEmailSource`, never Supabase Auth
   * and never a JWT claim. Fails closed on anything short of a valid email:
   * absent, empty, or malformed are all the same outcome, and none is ever
   * substituted with a synthetic or client-supplied value.
   *
   * Called first, before any other step of `createPayment` — before the
   * order even transitions — so a missing email never leaves an order
   * stranded at `PENDING_PAYMENT` with nothing to show for it, and so this
   * one check protects every provider `PaymentsService` will ever call, not
   * only Stripe.
   */
  private async resolveAuthoritativeEmail(userId: string): Promise<string> {
    const rawEmail = await this.emailSource.resolve(userId);
    const parsed = emailSchema.safeParse(rawEmail ?? '');

    if (!parsed.success) {
      throw new DomainError('CUSTOMER_EMAIL_REQUIRED', {
        message: 'No valid customer email available to initiate payment',
      });
    }

    return parsed.data;
  }

  async createPayment(user: AuthenticatedUser, orderId: string): Promise<PaymentInitiationResponse> {
    const email = await this.resolveAuthoritativeEmail(user.id);

    const { data: transitioned, error } = await this.supabase.admin
      .from('orders')
      .update({ state: 'PENDING_PAYMENT' })
      .eq('id', orderId)
      .eq('customer_id', user.id)
      .eq('state', 'CREATED')
      .select('id, order_number, grand_total_satang')
      .maybeSingle<Pick<OrderPaymentRow, 'id' | 'order_number' | 'grand_total_satang'>>();

    if (error) {
      this.fail('order transition', orderId, error.message);
    }

    if (transitioned) {
      await this.writeOrderHistory(orderId, user.id);
      return this.initializePayment(
        transitioned.id,
        transitioned.order_number,
        transitioned.grand_total_satang,
        email,
      );
    }

    return this.recoverOrRejectInitiation(user, orderId, email);
  }

  /**
   * Runs only when the guarded `UPDATE` above matched 0 rows — diagnostic,
   * never what decides whether the transition happened (that was already
   * decided). Ownership is checked here and folds to a uniform `NOT_FOUND`
   * for both "does not exist" and "belongs to someone else", matching
   * `AddressesService`'s and `OrdersService.customerCancel`'s own precedent —
   * telling the two apart would confirm the existence of another customer's
   * order to anyone who guessed an id.
   */
  private async recoverOrRejectInitiation(
    user: AuthenticatedUser,
    orderId: string,
    email: string,
  ): Promise<PaymentInitiationResponse> {
    const { data: order } = await this.supabase.admin
      .from('orders')
      .select('id, customer_id, order_number, grand_total_satang, state')
      .eq('id', orderId)
      .maybeSingle<OrderPaymentRow>();

    if (!order || order.customer_id !== user.id) {
      throw new DomainError('NOT_FOUND', { message: 'Order not found' });
    }

    if (order.state !== 'PENDING_PAYMENT') {
      throw new DomainError('ORDER_NOT_PAYABLE', { details: { currentState: order.state } });
    }

    const found = await this.fetchPaymentWithAttempt(order.id);
    if (!found) {
      // Case 2 from the class doc comment: legitimately PENDING_PAYMENT, no
      // payment row yet. Complete initialization rather than error.
      return this.initializePayment(order.id, order.order_number, order.grand_total_satang, email);
    }

    return this.resumePayment(order.id, found.payment, found.attempt, email);
  }

  /**
   * Branches an existing `payments` row by state — the exact contract
   * `docs/BANHAO-APP-ARCHITECTURE-V1.md` § 6's operations table already
   * documents for a repeat call to this endpoint:
   *
   * - `SUCCESS` / `REFUND_PENDING` / `REFUND_PROCESSING` / `REFUNDED` →
   *   reject with `PAYMENT_ALREADY_SUCCEEDED`. Checked first and
   *   unconditionally — no attempt lookup, no write, regardless of
   *   `attempt`'s own state.
   * - `PENDING` / `PROCESSING` → return the existing (live) attempt
   *   unchanged. This preserves F-1's original idempotent-retry behavior
   *   exactly; it does not re-check the attempt's own `expires_at`, because
   *   `PaymentAttemptExpiryService` is what keeps `payments.state` truthful
   *   — by the time a tick has run, an attempt whose window passed has
   *   already moved `payments.state` to `EXPIRED`, which is handled below.
   * - `EXPIRED` / `FAILED` → regenerate (`regenerateAttempt`), per
   *   `PAYMENT_LIFECYCLE.md` § 3's `EXPIRED --> PENDING` / `FAILED --> PENDING`
   *   edges.
   * - Anything else (`CREATED`, `CANCELLED`, the dormant `CASH_*` states) is
   *   unreachable from any writer in this codebase today — `initializePayment`
   *   always inserts `payments` already at `PENDING`, and nothing sets
   *   `payments.state` to `CANCELLED` or a cash state anywhere. Encountering
   *   one here is a genuine "should never happen" condition: logged and
   *   surfaced as `INTERNAL_ERROR`, never silently folded into either branch
   *   above — reclassifying an unmodeled state as "already succeeded" or as
   *   "safe to regenerate" would be exactly the kind of undocumented policy
   *   this codebase's own conventions forbid.
   */
  private async resumePayment(
    orderId: string,
    payment: PaymentRow,
    attempt: PaymentAttemptRow | null,
    email: string,
  ): Promise<PaymentInitiationResponse> {
    if (ALREADY_SUCCEEDED_PAYMENT_STATES.has(payment.state)) {
      throw new DomainError('PAYMENT_ALREADY_SUCCEEDED', { details: { currentState: payment.state } });
    }

    if (payment.state === 'PENDING' || payment.state === 'PROCESSING') {
      return this.toResponse(payment, attempt);
    }

    if (REGENERABLE_PAYMENT_STATES.has(payment.state)) {
      return this.regenerateAttempt(orderId, payment, attempt, email);
    }

    this.logger.error(
      `payment ${payment.id} for order ${orderId} is in an unmodeled state for resumption: ${payment.state}`,
    );
    throw new DomainError('INTERNAL_ERROR', { message: 'Payment is in an unexpected state' });
  }

  /**
   * Fetches the `payments` row for an order together with its current
   * (highest `attempt_no`) `payment_attempts` row — the same "latest
   * attempt" relationship `PaymentAttemptExpiryService` uses to decide which
   * attempt speaks for a payment. Returns `null` only when no `payments` row
   * exists yet (case 2 in the class doc comment); a `payments` row with no
   * attempt yet is not expected but is represented as `attempt: null` rather
   * than assumed impossible.
   */
  private async fetchPaymentWithAttempt(
    orderId: string,
  ): Promise<{ payment: PaymentRow; attempt: PaymentAttemptRow | null } | null> {
    const { data: payment } = await this.supabase.admin
      .from('payments')
      .select('id, payment_reference, state, amount_satang, currency')
      .eq('order_id', orderId)
      .maybeSingle<PaymentRow>();

    if (!payment) {
      return null;
    }

    const { data: attempt } = await this.supabase.admin
      .from('payment_attempts')
      .select('id, attempt_no, state, qr_payload, expires_at')
      .eq('payment_id', payment.id)
      .order('attempt_no', { ascending: false })
      .limit(1)
      .maybeSingle<PaymentAttemptRow>();

    return { payment, attempt: attempt ?? null };
  }

  /**
   * Used only by `initializePayment`'s own duplicate-insert fallback (case 3
   * in the class doc comment) — a same-instant race on `payments_order_id_key`
   * for a payment that was, by construction, *just* created and so cannot yet
   * be in any state `resumePayment` would branch differently on. Reads back
   * and returns as-is, deliberately without state branching.
   */
  private async readExistingPayment(orderId: string): Promise<PaymentInitiationResponse | null> {
    const found = await this.fetchPaymentWithAttempt(orderId);
    return found ? this.toResponse(found.payment, found.attempt) : null;
  }

  /**
   * `EXPIRED` / `FAILED` → new attempt → `PENDING` — the "Regenerate QR" row
   * in `docs/BANHAO-APP-ARCHITECTURE-V1.md` § 8's idempotency map, keyed by
   * `(payment_id, attempt_no)`.
   *
   * ## Ordering — the provider call may not be idempotent for every binding
   *
   * `idempotencyKey` here is `${orderId}:${nextAttemptNo}` (DEC-055 clause 8)
   * — a deterministic, attempt-specific key, never a repeat of the initial
   * attempt's `orderId` alone. `StripePaymentProvider` honours this properly
   * (verified: the same key replays the same PaymentIntent; a different key
   * mints a new one — `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` § 6), so two
   * regenerations racing each other with the *same* `nextAttemptNo` converge
   * on the *same* Stripe PaymentIntent rather than minting two.
   *
   * `NullPaymentProvider.createPayment` still ignores `idempotencyKey`
   * entirely and mints a fresh `providerPaymentId` (and QR) on every call —
   * it cannot be relied on to return the same result for two concurrent calls
   * with the same key. Two regenerations racing each other against the null
   * provider therefore both successfully call it and both obtain a
   * *distinct*, individually valid QR before either writes anything; only one
   * write wins below. **This is a known, accepted limitation of the null
   * provider specifically**: the loser's provider call is wasted work, never
   * a wasted write, and — because `NullPaymentProvider` makes no real network
   * call and moves no real money (DEC-APP-007) — it costs nothing. This is
   * dev/test-only behaviour, not a gap in the production Stripe path.
   *
   * ## Concurrency — the unique constraint is the sole authority
   *
   * `nextAttemptNo` is *read*, never trusted as the safe value — the `INSERT`
   * that follows is what decides, via `payment_attempts_payment_attempt_no_key`
   * (never a prior `SELECT` as the authority, matching every guarded write in
   * this codebase). A losing `INSERT` reads back the winner's attempt and
   * returns it, exactly mirroring `initializePayment`'s own case-3 handling
   * of `payments_order_id_key`.
   *
   * ## The attempt-insert / payment-update gap
   *
   * These are two separate statements, not one transaction (the same gap
   * `initializePayment`'s own class comment documents for `payments` +
   * `payment_attempts`). If the `payments` guarded `UPDATE` affects 0 rows —
   * something else moved `payments.state` between this method's insert and
   * update — the newly-inserted attempt is **not** discarded (`payment_attempts`
   * is append-only, DEC-014); the method instead re-reads and reports the
   * payment's actual current state.
   *
   * ## `provider_payment_id`
   *
   * Overwritten with the new attempt's provider id (Option A from this
   * task's own recon: `payments.provider_payment_id` tracks the *current*
   * attempt's provider identifier, not a history of every attempt's). This
   * is mutable — `payments_enforce_immutable_columns` does not cover it.
   * Consequence, deliberately accepted and not fixed here: a late webhook
   * addressed to a superseded attempt's provider id no longer matches any
   * `payments` row once regeneration overwrites this column, and resolves as
   * `UNMATCHED_EVENT` under `PaymentEventProcessingService`'s existing,
   * unmodified lookup (`payments` keyed by `(provider, provider_payment_id)`
   * — never `payment_attempts.provider_attempt_id`, which this method also
   * does not populate, for the same reason: nothing reads it). Fixing this
   * would mean changing F-2b's resolution path, explicitly out of this
   * task's boundary.
   */
  private async regenerateAttempt(
    orderId: string,
    payment: PaymentRow,
    currentAttempt: PaymentAttemptRow | null,
    email: string,
  ): Promise<PaymentInitiationResponse> {
    const nextAttemptNo = (currentAttempt?.attempt_no ?? 0) + 1;

    let result;
    try {
      result = await this.provider.createPayment({
        // CRITICAL — never `orderId` alone here. A regenerated attempt must
        // get its own deterministic key, or a real provider (Stripe) would
        // treat this as a replay of the *first* attempt and hand back its
        // now-stale payment intent instead of issuing a new one — defeating
        // the entire point of regeneration. See this method's own class doc
        // comment ("Ordering — the provider call is NOT idempotent here") and
        // DEC-055 clause 8.
        idempotencyKey: `${orderId}:${nextAttemptNo}`,
        orderId,
        paymentReference: payment.payment_reference,
        amount: { amount: payment.amount_satang, currency: 'THB' },
        method: 'PROMPTPAY_QR',
        webhookUrl: `/webhooks/payments/${this.provider.name}`,
        email,
      });
    } catch (cause) {
      this.logger.error(
        `PaymentProvider.createPayment failed while regenerating attempt ${nextAttemptNo} for order ${orderId}: ${(cause as Error).message}`,
      );
      throw new DomainError('PROVIDER_UNAVAILABLE', { message: 'Payment provider unavailable' });
    }

    // Expiry is BANHAO's own policy, computed once here — never read off
    // `result.presentation` (DEC-055 Addendum A: the provider contract
    // carries no expiry field at all). Only set when there is a presentation
    // to expire, mirroring the original null-together-with-qr_payload
    // symmetry: an attempt with no QR has nothing for a countdown to guard.
    const attemptExpiresAt = result.presentation ? computeAttemptExpiresAt() : null;

    const { data: insertedAttempt, error: insertError } = await this.supabase.admin
      .from('payment_attempts')
      .insert({
        payment_id: payment.id,
        attempt_no: nextAttemptNo,
        state: 'PENDING',
        qr_payload: result.presentation?.imageUrl ?? null,
        expires_at: attemptExpiresAt,
      })
      .select('id, attempt_no, state, qr_payload, expires_at')
      .maybeSingle<PaymentAttemptRow>();

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        // Lost the attempt_no race — a concurrent regeneration already won.
        // Read back its attempt rather than retrying: the winner's write is
        // exactly as valid as ours would have been (DEC-028). This is a plain
        // DB read, so — correctly — it never carries a hostedInstructionsUrl
        // from *our* wasted provider call (see AttemptPresentation's own doc
        // comment).
        const found = await this.fetchPaymentWithAttempt(orderId);
        if (found) {
          return this.toResponse(found.payment, found.attempt);
        }
      }
      this.fail('payment attempt regeneration', orderId, insertError.message);
    }

    if (!insertedAttempt) {
      this.logger.error(`payment attempt regeneration insert returned no row for order ${orderId}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payment regeneration returned no result' });
    }

    // Merges the DB-confirmed row with the hostedInstructionsUrl this exact
    // provider call just returned — never persisted (no column exists for
    // it, DEC-055 Addendum A), so it must be carried through here rather than
    // read back from `insertedAttempt` alone.
    const attemptPresentation: AttemptPresentation = {
      ...insertedAttempt,
      hosted_instructions_url: result.presentation?.hostedInstructionsUrl,
    };

    const { data: transitioned, error: paymentUpdateError } = await this.supabase.admin
      .from('payments')
      .update({ state: 'PENDING', provider_payment_id: result.providerPaymentId })
      .eq('id', payment.id)
      .in('state', ['EXPIRED', 'FAILED'])
      .select('id, payment_reference, state, amount_satang, currency')
      .maybeSingle<PaymentRow>();

    if (paymentUpdateError) {
      this.logger.error(
        `payments PENDING transition failed while regenerating attempt ${nextAttemptNo} for order ${orderId}: ${paymentUpdateError.message}`,
      );
      return this.toResponse(payment, attemptPresentation);
    }

    if (transitioned) {
      return this.toResponse(transitioned, attemptPresentation);
    }

    // 0 rows: payments.state moved between the insert above and this UPDATE
    // (the documented gap — see this method's own doc comment). Self-heal by
    // reporting the payment's actual current state, never by assuming either
    // outcome.
    const { data: current } = await this.supabase.admin
      .from('payments')
      .select('id, payment_reference, state, amount_satang, currency')
      .eq('id', payment.id)
      .maybeSingle<PaymentRow>();

    return this.toResponse(current ?? payment, attemptPresentation);
  }

  private async initializePayment(
    orderId: string,
    orderNumber: string,
    grandTotalSatang: number,
    email: string,
  ): Promise<PaymentInitiationResponse> {
    // Computed before the provider call (not after, as originally written) so
    // it can be attached to the provider's own request metadata — Stripe's
    // adapter cross-references it onto the PaymentIntent for a human reading
    // the Stripe Dashboard, exactly as a BANHAO log or support ticket would.
    const paymentReference = `PAY-${orderNumber}`;

    let result;
    try {
      result = await this.provider.createPayment({
        idempotencyKey: orderId,
        orderId,
        paymentReference,
        amount: { amount: grandTotalSatang, currency: 'THB' },
        // The provider's own PaymentMethod vocabulary ('PROMPTPAY_QR' | 'CASH')
        // is finer than payments.method ('ONLINE' | 'CASH') — Phase 1 is
        // online-only (DEC-016) and the only online rail is PromptPay QR, so
        // this is a fixed value, not a client choice.
        method: 'PROMPTPAY_QR',
        webhookUrl: `/webhooks/payments/${this.provider.name}`,
        // DEC-056: resolved and validated by `resolveAuthoritativeEmail`
        // before this method was ever called — never re-derived here.
        email,
      });
    } catch (cause) {
      this.logger.error(
        `PaymentProvider.createPayment failed for order ${orderId}: ${(cause as Error).message}`,
      );
      throw new DomainError('PROVIDER_UNAVAILABLE', { message: 'Payment provider unavailable' });
    }

    const { data: payment, error } = await this.supabase.admin
      .from('payments')
      .insert({
        order_id: orderId,
        payment_reference: paymentReference,
        state: 'PENDING',
        method: 'ONLINE',
        amount_satang: grandTotalSatang,
        currency: 'THB',
        provider: this.provider.name,
        provider_payment_id: result.providerPaymentId,
      })
      .select('id, payment_reference, state, amount_satang, currency')
      .maybeSingle<PaymentRow>();

    if (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.readExistingPayment(orderId);
        if (existing) {
          return existing;
        }
      }
      this.fail('payment insert', orderId, error.message);
    }

    if (!payment) {
      this.logger.error(`payment insert returned no row for order ${orderId}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payment initiation returned no result' });
    }

    // Expiry is BANHAO's own policy (DEC-055 Addendum A), computed once here
    // — never read off `result.presentation`, which carries no expiry field
    // at all. Only set when there is a presentation to expire.
    const attemptRow: AttemptPresentation = {
      qr_payload: result.presentation?.imageUrl ?? null,
      expires_at: result.presentation ? computeAttemptExpiresAt() : null,
      hosted_instructions_url: result.presentation?.hostedInstructionsUrl,
    };

    const { error: attemptError } = await this.supabase.admin.from('payment_attempts').insert({
      payment_id: payment.id,
      attempt_no: 1,
      state: 'PENDING',
      qr_payload: attemptRow.qr_payload,
      expires_at: attemptRow.expires_at,
    });

    if (attemptError) {
      this.fail('payment attempt insert', orderId, attemptError.message);
    }

    return this.toResponse(payment, attemptRow);
  }

  private toResponse(payment: PaymentRow, attempt: AttemptPresentation | null): PaymentInitiationResponse {
    return {
      paymentId: payment.id,
      paymentReference: payment.payment_reference,
      state: payment.state,
      amountSatang: payment.amount_satang,
      currency: payment.currency,
      // `expiresAt` here is `payment_attempts.expires_at` — BANHAO's own
      // attempt-lifecycle clock (DEC-055 Addendum A) — never a value read
      // off a provider result. `hostedInstructionsUrl` is present only when
      // this exact call minted it (see AttemptPresentation's own comment);
      // omitted, not `undefined`, when absent, so it never appears in the
      // wire response at all.
      qr:
        attempt?.qr_payload && attempt.expires_at
          ? {
              type: 'QR_CODE',
              imageUrl: attempt.qr_payload,
              expiresAt: attempt.expires_at,
              ...(attempt.hosted_instructions_url
                ? { hostedInstructionsUrl: attempt.hosted_instructions_url }
                : {}),
            }
          : undefined,
    };
  }

  private async writeOrderHistory(orderId: string, actorId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('order_status_history').insert({
      order_id: orderId,
      from_state: 'CREATED',
      to_state: 'PENDING_PAYMENT',
      actor_type: 'CUSTOMER',
      actor_id: actorId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(`order_status_history insert failed for order ${orderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payment initiation history failed' });
    }
  }

  private fail(operation: string, orderId: string, message: string): never {
    this.logger.error(`Payment ${operation} failed for order ${orderId}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: 'Payment initiation failed' });
  }
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
