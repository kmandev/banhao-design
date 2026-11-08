import { Injectable, Logger } from '@nestjs/common';
import type { PaymentSummaryResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';

interface OrderRow {
  id: string;
  order_number: string;
}

interface PaymentRow {
  id: string;
  payment_reference: string;
  state: string;
  method: string;
  amount_satang: number;
  provider_payment_id: string | null;
}

interface RefundRow {
  state: string;
  amount_satang: number;
  created_at: string;
  completed_at: string | null;
}

/**
 * The customer's read of their own order's payment and refund (C-12g / C-12h).
 *
 * `payments` and `refunds` grant nothing to `authenticated` — they are
 * API-only by design — so the customer app cannot read them and was showing
 * sample figures instead. This service is the narrow window: ownership is
 * checked in the query (`customer_id = caller`), an order that is not the
 * caller's is indistinguishable from one that does not exist, and only fields
 * safe to show leave the server. The provider's payment id is cut to its last
 * four characters, which is what the design itself shows ("····8F2A").
 *
 * Read-only. It changes no state and confirms nothing (CON-002).
 */
@Injectable()
export class PaymentSummaryService {
  private readonly logger = new Logger(PaymentSummaryService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getSummary(user: AuthenticatedUser, orderId: string): Promise<PaymentSummaryResponse> {
    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('id, order_number')
      .eq('id', orderId)
      .eq('customer_id', user.id)
      .maybeSingle<OrderRow>();

    if (orderError) this.fail('order read', orderId, orderError.message);
    if (!order) throw new DomainError('NOT_FOUND', { message: 'Order not found' });

    const { data: payment, error: paymentError } = await this.supabase.admin
      .from('payments')
      .select('id, payment_reference, state, method, amount_satang, provider_payment_id')
      .eq('order_id', order.id)
      .maybeSingle<PaymentRow>();

    if (paymentError) this.fail('payment read', orderId, paymentError.message);
    if (!payment) return { orderNumber: order.order_number, payment: null, refund: null };

    const { data: refunds, error: refundError } = await this.supabase.admin
      .from('refunds')
      .select('state, amount_satang, created_at, completed_at')
      .eq('payment_id', payment.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .returns<RefundRow[]>();

    if (refundError) this.fail('refund read', orderId, refundError.message);
    const refund = refunds?.[0] ?? null;

    return {
      orderNumber: order.order_number,
      payment: {
        paymentReference: payment.payment_reference,
        state: payment.state,
        method: payment.method,
        amountSatang: payment.amount_satang,
        providerRefTail: payment.provider_payment_id ? payment.provider_payment_id.slice(-4).toUpperCase() : null,
      },
      refund: refund
        ? {
            state: refund.state,
            amountSatang: refund.amount_satang,
            requestedAt: refund.created_at,
            completedAt: refund.completed_at,
          }
        : null,
    };
  }

  private fail(operation: string, orderId: string, message: string): never {
    this.logger.error(`Payment summary ${operation} failed for order ${orderId}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: 'Payment summary unavailable' });
  }
}
