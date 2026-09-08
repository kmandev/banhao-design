import { Inject, Injectable, Logger } from '@nestjs/common';
import type { InitiateRefundRequest, InitiateRefundResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.interface';
import type { PaymentProvider } from '../payments/payment-provider.interface';

/** `orders`, the columns eligibility needs. */
interface OrderRefundRow {
  id: string;
  state: string;
  cause_code: string | null;
}

/** `payments`, the columns a refund call needs. */
interface PaymentRefundRow {
  id: string;
  payment_reference: string;
  state: string;
  amount_satang: number;
  provider_payment_id: string | null;
}

/** `refunds`, the columns this service reads/writes. */
interface RefundRow {
  id: string;
  payment_id: string;
  state: string;
  amount_satang: number;
  provider_refund_id: string | null;
}

/**
 * DEC-053's own post-pickup failure causes that produce **no** refund of any
 * kind (`docs/DECISIONS.md` DEC-053 § 5 table) — a customer-caused failure
 * retains the customer's payment in full. Every other cause row
 * (`RIDER_CAUSED`, `MERCHANT_CAUSED`, `PLATFORM_CAUSED`, `INDETERMINATE`) is
 * "full eligible refund", which this service treats as the default once the
 * order state itself is `DELIVERY_FAILED`.
 */
const NON_REFUNDABLE_DELIVERY_FAILURE_CAUSES = new Set(['CUSTOMER_UNREACHABLE', 'CUSTOMER_REFUSED']);

/**
 * Q-020 Slice 1 — refund initiation (DEC-057 mechanism, DEC-058 authority,
 * DEC-059 full-refund accounting). Operator-controlled only
 * (`SupervisorController`'s class-level `@Roles('OPERATOR', 'ADMIN')`); this
 * service itself trusts that guard and performs no further role check.
 *
 * ## What this service does NOT do — read before extending it
 *
 * This is Slice 1 only. It creates a local `refunds` row and makes one real
 * Stripe refund call. It explicitly does **not**:
 *
 * - process `refund.created`/`refund.updated`/`refund.failed`/`charge.refunded`
 *   webhooks, or verify provider status at all — that is Slice 2 (DEC-057 §5),
 * - run a reconciliation sweep (DEC-057 §6),
 * - post any DEC-049 ledger reversal — `CUSTOMER_PAYMENT`, `SERVICE_FEE_REVENUE`
 *   and `MERCHANT_COMMISSION` (DEC-059) are all deferred to the slice that
 *   implements finality, because a reversal may only post once a refund is
 *   verified `REFUNDED` (DEC-049 § 5), which nothing in this file can ever
 *   determine from a synchronous API response alone (DEC-057 § 2/§ 8),
 * - implement partial refund in any form (DEC-057 § 1 — full refund only;
 *   `BQ-031` remains open and untouched),
 * - touch `payments.state` or `orders.state` in any way — this service reads
 *   both, and writes neither.
 *
 * ## Eligibility — reads DEC-050/DEC-053 as already-locked facts, decides nothing new
 *
 * An order is refund-eligible only if it is `CANCELLED` (DEC-050 — every
 * permitted cancellation in Phase 1 is a full refund; there is no partial
 * cancellation-driven refund to distinguish) or `DELIVERY_FAILED` with a
 * cause that is **not** one of DEC-053's two no-refund causes
 * (`CUSTOMER_UNREACHABLE`, `CUSTOMER_REFUSED`). This service invents no new
 * eligibility rule — it is a direct, mechanical reading of decisions already
 * locked before this slice existed.
 *
 * ## Duplicate protection — the existing `refunds_reference_key` unique
 * constraint, no migration
 *
 * `refunds` has no unique constraint on `payment_id` (a real, pre-existing
 * schema gap — see this service's own recon). Rather than add one (forbidden
 * in this slice), `refund_reference` is derived **deterministically** from
 * the payment's own reference (`REFUND-<payment_reference>`), so two
 * concurrent initiation attempts against the *same* payment collide on
 * `refunds_reference_key` exactly as `payments_order_id_key` and
 * `payment_attempts_payment_attempt_no_key` already make every other
 * natural key in this codebase collide (ADR-003 — the guarded write is the
 * concurrency authority, never a prior read). The loser reads back the
 * winner's row rather than erroring, and — because Phase 1 has no concept of
 * a second legitimate refund per payment — that same reused row is also the
 * mechanism a genuine retry uses to safely re-attempt a previously failed
 * Stripe call (see § "Idempotency" below). `payment_id` itself still has a
 * `not null` foreign key to `payments`, so a refund can never exist
 * detached from a real, settled payment.
 *
 * ## Idempotency — `refunds.id` as the sole Stripe idempotency key (DEC-057 § 7)
 *
 * `refunds.provider_refund_id` is the signal for "Stripe has already
 * acknowledged this refund at least once": if it is already set, this
 * service returns the existing row without calling Stripe again — a
 * duplicate initiation request is never a duplicate Stripe call. If it is
 * `null` (the row was just created, or a prior attempt never reached Stripe,
 * or a prior attempt reached Stripe but failed), the Stripe call is made (or
 * retried) using `refunds.id` as the idempotency key — deterministic and
 * stable across every retry of this exact logical refund, per DEC-057 § 7 and
 * proven live in the Q-020 Stripe Refund Sandbox Spike (the same key with the
 * same parameters replays the original result; it is never regenerated).
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async initiateRefund(
    user: AuthenticatedUser,
    orderId: string,
    request: InitiateRefundRequest,
  ): Promise<InitiateRefundResponse> {
    const order = await this.loadOrder(orderId);
    this.assertOrderRefundEligible(order);

    const payment = await this.loadPayment(orderId);
    this.assertPaymentRefundable(payment);

    const refundReference = `REFUND-${payment.payment_reference}`;
    const refund = await this.createOrReuseRefund(payment, refundReference, request.reason, user.id);

    if (refund.state === 'REFUNDED') {
      throw new DomainError('REFUND_ALREADY_EXISTS', {
        message: 'This payment has already been refunded',
        details: { refundId: refund.id, state: refund.state },
      });
    }

    // Already acknowledged by Stripe on an earlier call — a duplicate
    // initiation request (concurrent or retried) never reaches Stripe twice.
    if (refund.provider_refund_id) {
      return this.toResponse(orderId, payment, refund);
    }

    let providerRefundId: string;
    try {
      const result = await this.provider.refund({
        idempotencyKey: refund.id,
        providerPaymentId: this.requireProviderPaymentId(payment),
        // 'THB' literal, matching PaymentsService's own precedent
        // (createPayment/regenerateAttempt) — Phase 1 has exactly one
        // currency; it is never read off a DB column as a variable.
        amount: { amount: refund.amount_satang, currency: 'THB' },
        reason: request.reason,
      });
      providerRefundId = result.providerRefundId;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`Refund provider call failed for refund ${refund.id} (payment ${payment.id}): ${message}`);
      await this.markFailed(refund.id);
      throw new DomainError('PROVIDER_UNAVAILABLE', { message: 'Refund provider unavailable' });
    }

    const updated = await this.markPending(refund.id, providerRefundId);
    return this.toResponse(orderId, payment, updated ?? { ...refund, provider_refund_id: providerRefundId });
  }

  private async loadOrder(orderId: string): Promise<OrderRefundRow> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, state, cause_code')
      .eq('id', orderId)
      .maybeSingle<OrderRefundRow>();

    if (error) {
      this.logger.error(`orders read failed for refund eligibility (order ${orderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Order lookup failed' });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Order not found' });
    }
    return data;
  }

  /** DEC-050 (any `CANCELLED` order) / DEC-053 (`DELIVERY_FAILED`, non-customer-caused). No other order state qualifies. */
  private assertOrderRefundEligible(order: OrderRefundRow): void {
    if (order.state === 'CANCELLED') {
      return;
    }

    if (order.state === 'DELIVERY_FAILED' && !NON_REFUNDABLE_DELIVERY_FAILURE_CAUSES.has(order.cause_code ?? '')) {
      return;
    }

    throw new DomainError('ORDER_NOT_REFUND_ELIGIBLE', {
      details: { currentState: order.state, causeCode: order.cause_code },
    });
  }

  private async loadPayment(orderId: string): Promise<PaymentRefundRow> {
    const { data, error } = await this.supabase.admin
      .from('payments')
      .select('id, payment_reference, state, amount_satang, provider_payment_id')
      .eq('order_id', orderId)
      .maybeSingle<PaymentRefundRow>();

    if (error) {
      this.logger.error(`payments read failed for refund eligibility (order ${orderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payment lookup failed' });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Payment not found' });
    }
    return data;
  }

  /** Only a settled (`SUCCESS`) payment with a real, positive, settled amount can be refunded. */
  private assertPaymentRefundable(payment: PaymentRefundRow): void {
    if (payment.state !== 'SUCCESS' || payment.amount_satang <= 0) {
      throw new DomainError('PAYMENT_NOT_REFUNDABLE', { details: { currentState: payment.state } });
    }
  }

  /** `payments.provider_payment_id` is nullable in the schema; a `SUCCESS` payment always has one in practice — asserted, not assumed, so a genuinely inconsistent row fails closed rather than reaching the provider with `null`. */
  private requireProviderPaymentId(payment: PaymentRefundRow): string {
    if (!payment.provider_payment_id) {
      this.logger.error(`payment ${payment.id} is SUCCESS with no provider_payment_id`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Payment has no provider identity' });
    }
    return payment.provider_payment_id;
  }

  /**
   * Insert-first, never a prior `SELECT` to decide (ADR-003) — see this
   * class's own doc comment on why `refund_reference` is the deterministic
   * anchor a concurrent or retried call collides on.
   */
  private async createOrReuseRefund(
    payment: PaymentRefundRow,
    refundReference: string,
    reason: string,
    requestedBy: string,
  ): Promise<RefundRow> {
    const { data: inserted, error: insertError } = await this.supabase.admin
      .from('refunds')
      .insert({
        payment_id: payment.id,
        refund_reference: refundReference,
        amount_satang: payment.amount_satang,
        reason,
        requested_by: requestedBy,
        approved_by: requestedBy,
      })
      .select('id, payment_id, state, amount_satang, provider_refund_id')
      .maybeSingle<RefundRow>();

    if (!insertError) {
      if (!inserted) {
        this.logger.error(`refunds insert returned no row for payment ${payment.id}`);
        throw new DomainError('INTERNAL_ERROR', { message: 'Refund creation returned no result' });
      }
      return inserted;
    }

    if (!isUniqueViolation(insertError)) {
      this.logger.error(`refunds insert failed for payment ${payment.id}: ${insertError.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Refund creation failed' });
    }

    const { data: existing, error: readError } = await this.supabase.admin
      .from('refunds')
      .select('id, payment_id, state, amount_satang, provider_refund_id')
      .eq('refund_reference', refundReference)
      .maybeSingle<RefundRow>();

    if (readError || !existing) {
      this.logger.error(
        `refunds read-back failed after a duplicate insert for payment ${payment.id}: ${readError?.message ?? 'no row'}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Refund lookup failed' });
    }

    return existing;
  }

  /** Guarded — never overwrites an already-`REFUNDED` row, matching every other guarded write in this codebase (state repeated in `WHERE`, never a prior read deciding). */
  private async markFailed(refundId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('refunds')
      .update({ state: 'REFUND_FAILED' })
      .eq('id', refundId)
      .neq('state', 'REFUNDED');

    if (error) {
      this.logger.error(`refunds REFUND_FAILED transition failed for refund ${refundId}: ${error.message}`);
    }
  }

  /**
   * DEC-057 § 2/§ 8: this is the local "we asked, we're waiting to hear back"
   * state — never `REFUNDED`. It is deliberately the same target state
   * regardless of whether Stripe's own (unread, per DEC-057 § 7) status was
   * `requires_action`, `pending`, or even `succeeded` — this service has no
   * way to distinguish them (the adapter returns only `providerRefundId`),
   * and DEC-057 forbids inferring finality from the synchronous call
   * succeeding at all.
   */
  private async markPending(refundId: string, providerRefundId: string): Promise<RefundRow | null> {
    const { data, error } = await this.supabase.admin
      .from('refunds')
      .update({ state: 'REFUND_PENDING', provider: this.provider.name, provider_refund_id: providerRefundId })
      .eq('id', refundId)
      .neq('state', 'REFUNDED')
      .select('id, payment_id, state, amount_satang, provider_refund_id')
      .maybeSingle<RefundRow>();

    if (error) {
      this.logger.error(`refunds REFUND_PENDING transition failed for refund ${refundId}: ${error.message}`);
      return null;
    }
    return data;
  }

  private toResponse(orderId: string, payment: PaymentRefundRow, refund: RefundRow): InitiateRefundResponse {
    return {
      refundId: refund.id,
      orderId,
      paymentId: payment.id,
      state: refund.state,
      amountSatang: refund.amount_satang,
      ...(refund.provider_refund_id ? { providerRefundId: refund.provider_refund_id } : {}),
    };
  }
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
