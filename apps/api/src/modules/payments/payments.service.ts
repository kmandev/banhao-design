import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentInitiationResponse } from '@banhao/validation';
import { uuidSchema } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import type { PaymentProvider } from './payment-provider.interface';

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

/** `payment_attempts`, the columns the response's `qr` field needs. */
interface PaymentAttemptRow {
  qr_payload: string | null;
  expires_at: string | null;
}

/**
 * `POST /api/v1/orders/:id/payment` (Phase F-1).
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
 *    read it back.
 * 2. The narrow crash-recovery case: the order reached `PENDING_PAYMENT` but
 *    the process died before the `payments` row was written. This service is
 *    the *only* writer of that transition, so finding the order there with no
 *    payment yet is safe to complete, not a new transition — self-heals by
 *    finishing initialization now.
 * 3. The true race: two requests both reach case 2 at once. The
 *    `payments_order_id_key` unique constraint lets exactly one `INSERT`
 *    through; the loser catches the `23505` and reads back the winner's row.
 *
 * ## Atomicity
 *
 * The order's own state transition is one guarded conditional `UPDATE` —
 * `state = 'CREATED'` repeated in the `WHERE` clause, never a prior `SELECT`
 * to decide (ADR-003), matching `OrdersService`'s own transitions. The
 * `payments`/`payment_attempts` inserts that follow are separate statements,
 * not one transaction — this codebase has no cross-table transaction
 * mechanism outside `create_order()`'s dedicated RPC, and case 2 above exists
 * precisely to make that gap self-healing rather than silently broken.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async createPayment(user: AuthenticatedUser, orderId: string): Promise<PaymentInitiationResponse> {
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
      return this.initializePayment(transitioned.id, transitioned.order_number, transitioned.grand_total_satang);
    }

    return this.recoverOrRejectInitiation(user, orderId);
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

    const existing = await this.readExistingPayment(order.id);
    if (existing) {
      return existing;
    }

    // Case 2 from the class doc comment: legitimately PENDING_PAYMENT, no
    // payment row yet. Complete initialization rather than error.
    return this.initializePayment(order.id, order.order_number, order.grand_total_satang);
  }

  private async readExistingPayment(orderId: string): Promise<PaymentInitiationResponse | null> {
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
      .select('qr_payload, expires_at')
      .eq('payment_id', payment.id)
      .order('attempt_no', { ascending: false })
      .limit(1)
      .maybeSingle<PaymentAttemptRow>();

    return this.toResponse(payment, attempt);
  }

  private async initializePayment(
    orderId: string,
    orderNumber: string,
    grandTotalSatang: number,
  ): Promise<PaymentInitiationResponse> {
    let result;
    try {
      result = await this.provider.createPayment({
        idempotencyKey: orderId,
        orderId,
        amount: { amount: grandTotalSatang, currency: 'THB' },
        // The provider's own PaymentMethod vocabulary ('PROMPTPAY_QR' | 'CASH')
        // is finer than payments.method ('ONLINE' | 'CASH') — Phase 1 is
        // online-only (DEC-016) and the only online rail is PromptPay QR, so
        // this is a fixed value, not a client choice.
        method: 'PROMPTPAY_QR',
        // No webhook route exists yet (Phase F session 2) and the null
        // provider makes no network call, so this is a placeholder path, not
        // live configuration.
        webhookUrl: `/webhooks/payments/${this.provider.name}`,
      });
    } catch (cause) {
      this.logger.error(
        `PaymentProvider.createPayment failed for order ${orderId}: ${(cause as Error).message}`,
      );
      throw new DomainError('PROVIDER_UNAVAILABLE', { message: 'Payment provider unavailable' });
    }

    const paymentReference = `PAY-${orderNumber}`;

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

    const attemptRow: PaymentAttemptRow = {
      qr_payload: result.presentation?.value ?? null,
      expires_at: result.presentation?.expiresAt ?? null,
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

  private toResponse(payment: PaymentRow, attempt: PaymentAttemptRow | null): PaymentInitiationResponse {
    return {
      paymentId: payment.id,
      paymentReference: payment.payment_reference,
      state: payment.state,
      amountSatang: payment.amount_satang,
      currency: payment.currency,
      qr:
        attempt?.qr_payload && attempt.expires_at
          ? { value: attempt.qr_payload, expiresAt: attempt.expires_at }
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
