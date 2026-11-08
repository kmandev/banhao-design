import type { Logger } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';

/** DEC-069 §1 — the two refund events a customer is told about. Their wording lives in `customer-notification-copy.ts`. */
export type RefundCustomerEvent = 'RefundInitiated' | 'RefundSucceeded';

/**
 * Writes one outbox event telling the order's customer about their refund.
 *
 * - **Once per refund per event.** A retried initiation or a re-delivered
 *   provider webhook would otherwise notify twice, so an existing row for the
 *   same `(refund, event)` is checked first. Two exactly concurrent writers
 *   could still both insert; the cost is one duplicate message, never money.
 * - **Never throws.** The refund itself has already happened by the time this
 *   runs; a notification that cannot be written is logged, not allowed to
 *   fail the refund path that called it.
 * - Carries ids only: the customer as recipient and the order id so the
 *   notification opens the right order. No amount (the text says none).
 */
export async function notifyCustomerOfRefund(
  supabase: SupabaseService,
  logger: Logger,
  event: RefundCustomerEvent,
  refundId: string,
  orderId: string,
): Promise<void> {
  try {
    const { data: existing, error: existingError } = await supabase.admin
      .from('outbox')
      .select('id')
      .eq('aggregate_id', refundId)
      .eq('event_type', event)
      .limit(1)
      .returns<{ id: string }[]>();
    if (existingError) throw new Error(`outbox read failed: ${existingError.message}`);
    if ((existing ?? []).length > 0) return;

    const { data: order, error: orderError } = await supabase.admin
      .from('orders')
      .select('customer_id')
      .eq('id', orderId)
      .maybeSingle<{ customer_id: string }>();
    if (orderError || !order) throw new Error(`order read failed: ${orderError?.message ?? 'no row'}`);

    const { error } = await supabase.admin.from('outbox').insert({
      aggregate_type: 'refund',
      aggregate_id: refundId,
      event_type: event,
      payload: { recipients: [{ recipientId: order.customer_id, recipientType: 'CUSTOMER' }], orderId },
    });
    if (error) throw new Error(`outbox insert failed: ${error.message}`);
  } catch (cause) {
    logger.error(
      `${event} customer notification not written for refund ${refundId} (order ${orderId}): ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
