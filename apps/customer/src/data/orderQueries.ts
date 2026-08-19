/**
 * Supabase order-detail queries (Phase E-3B.1).
 *
 * **Direct client → Supabase reads, under RLS** (DEC-APP-008). Order tracking
 * is one of the reads DEC-APP-008 names explicitly as belonging on this path,
 * not behind the NestJS API — the deployed `orders_select_customer` /
 * `order_items_select_customer` / `order_item_options_select_customer` /
 * `order_status_history_select_customer` policies exist precisely to be read
 * this way (`customer_id = auth.uid()`). There is no `GET /api/v1/orders/:id`
 * and this file does not add one.
 *
 * Ownership is enforced by RLS alone — no query here filters by customer id,
 * the same way `catalogQueries.ts` does not re-filter `status`/`archived_at`.
 * A row that is not RLS-visible (someone else's order, or a nonexistent id)
 * simply does not come back; `fetchOrder` returns `null` for both, which is
 * the safe, indistinguishable not-found behaviour the read layer can offer
 * without a server round trip.
 *
 * Errors always throw, exactly as `catalogQueries.ts` documents: a failed
 * read must never be returned as an empty result.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
  OrderStatusHistoryRow,
} from './orderMappers';

const ORDER_COLUMNS =
  'id, order_number, state, payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang, recipient_name_snapshot, recipient_phone_snapshot, delivery_address_snapshot, placed_at';

const ORDER_ITEM_COLUMNS =
  'id, order_id, menu_item_id, item_name_snapshot, unit_price_satang, quantity, line_total_satang, note';

const ORDER_ITEM_OPTION_COLUMNS =
  'id, order_item_id, group_name_snapshot, option_name_snapshot, price_delta_satang';

const ORDER_STATUS_HISTORY_COLUMNS = 'to_state, occurred_at, reason';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Order ${operation} failed: ${message}`);
}

/**
 * The order itself, or `null` if it does not exist or is not the caller's own
 * (RLS makes the two indistinguishable, which is the safe behaviour here).
 */
export async function fetchOrder(
  client: SupabaseClient,
  orderId: string,
): Promise<OrderRow | null> {
  const { data, error } = await client
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('id', orderId)
    .maybeSingle<OrderRow>();

  if (error) raise('detail', error.message);
  return data;
}

/** Every line of the order, in creation order (no `sort_order` column exists on `order_items`). */
export async function fetchOrderItems(
  client: SupabaseClient,
  orderId: string,
): Promise<OrderItemRow[]> {
  const { data, error } = await client
    .from('order_items')
    .select(ORDER_ITEM_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .returns<OrderItemRow[]>();

  if (error) raise('items', error.message);
  return data ?? [];
}

/** Every selected option across a batch of order lines, one query for the whole order. */
export async function fetchOrderItemOptions(
  client: SupabaseClient,
  orderItemIds: string[],
): Promise<OrderItemOptionRow[]> {
  if (orderItemIds.length === 0) return [];

  const { data, error } = await client
    .from('order_item_options')
    .select(ORDER_ITEM_OPTION_COLUMNS)
    .in('order_item_id', orderItemIds)
    .returns<OrderItemOptionRow[]>();

  if (error) raise('item options', error.message);
  return data ?? [];
}

/**
 * The append-only audit trail (REQ-002), chronological. This is the sole
 * source for the customer-facing timeline — nothing here infers a transition
 * from a milestone timestamp on `orders`.
 */
export async function fetchOrderStatusHistory(
  client: SupabaseClient,
  orderId: string,
): Promise<OrderStatusHistoryRow[]> {
  const { data, error } = await client
    .from('order_status_history')
    .select(ORDER_STATUS_HISTORY_COLUMNS)
    .eq('order_id', orderId)
    .order('occurred_at', { ascending: true })
    .returns<OrderStatusHistoryRow[]>();

  if (error) raise('status history', error.message);
  return data ?? [];
}
