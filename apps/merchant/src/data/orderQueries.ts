import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantOrderSummary, OrderState } from '../domain/order';

/** `orders.state`'s own CHECK-constrained vocabulary — see `domain/order.ts`'s `OrderState`. */
const ORDER_STATES: readonly OrderState[] = [
  'CREATED',
  'PENDING_PAYMENT',
  'PAID',
  'MERCHANT_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'DELIVERING',
  'DELIVERED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'MERCHANT_REJECTED',
  'CANCELLED',
  'DELIVERY_FAILED',
];

/**
 * Columns selected from `orders` for the Order Board (M2-DATA-001) — exactly
 * `MerchantOrderSummary`'s fields, nothing from `order_items` /
 * `order_item_options` / `order_status_history`, and never `select('*')`.
 */
const ORDER_BOARD_COLUMNS =
  'id, order_number, state, restaurant_id, recipient_name_snapshot, recipient_phone_snapshot, grand_total_satang, placed_at, accepted_at, ready_at, picked_up_at';

/**
 * Raw row shape from the `orders` read above. Kept separate from
 * `MerchantOrderSummary` so a PostgREST column rename only touches this file
 * and its mapper, per the pattern `restaurantMembershipQueries.ts` and
 * `apps/driver/src/data` already establish.
 *
 * Exported (M-2.4) so `useOrderRealtime` can validate and map a Realtime
 * `postgres_changes` `record`/`new` payload through this same row shape and
 * `toMerchantOrderSummary`, rather than a second, independent mapping
 * implementation.
 */
export interface OrderBoardRow {
  id: string;
  order_number: string;
  state: string;
  restaurant_id: string;
  recipient_name_snapshot: string;
  recipient_phone_snapshot: string;
  grand_total_satang: number;
  placed_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
}

/**
 * Structural guard for an unknown payload before it is trusted as an
 * `OrderBoardRow` (M-2.4). A Realtime `postgres_changes` `new`/`record` is
 * untyped `{ [key: string]: any }` on the wire — this is the one place that
 * checks it actually has the shape `toMerchantOrderSummary` assumes, so a
 * malformed or unexpected payload is rejected rather than silently
 * fabricating a `MerchantOrderSummary` with `undefined` fields.
 */
export function isOrderBoardRow(value: unknown): value is OrderBoardRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;

  const nullableString = (v: unknown) => v === null || typeof v === 'string';

  return (
    typeof row.id === 'string' &&
    typeof row.order_number === 'string' &&
    typeof row.state === 'string' &&
    ORDER_STATES.includes(row.state as OrderState) &&
    typeof row.restaurant_id === 'string' &&
    typeof row.recipient_name_snapshot === 'string' &&
    typeof row.recipient_phone_snapshot === 'string' &&
    typeof row.grand_total_satang === 'number' &&
    typeof row.placed_at === 'string' &&
    nullableString(row.accepted_at) &&
    nullableString(row.ready_at) &&
    nullableString(row.picked_up_at)
  );
}

/**
 * The current restaurant's order-board projection (M-2.3).
 *
 * `restaurant_id = restaurantId` is an explicit query scope, not the
 * authorization boundary — `orders_select_merchant`
 * (`using (is_restaurant_member(restaurant_id))`,
 * `20260811000011_rls_policies.sql`) is what actually decides which rows a
 * caller may read; this filter only narrows a many-restaurant merchant's
 * request to the one board they're viewing. `restaurantId` must come from an
 * already-membership-checked source (`useRestaurantScope`'s
 * `currentRestaurantId`, never `getStoredRestaurantId()` directly) — this
 * function does not, and cannot, re-verify membership itself.
 *
 * Ordered `placed_at desc` — newest first, the same convention
 * `apps/customer/src/data/orderQueries.ts`'s `fetchOrderHistory` already
 * uses, and served by the deployed `orders_restaurant_state_idx
 * (restaurant_id, state)` / `orders_customer_idx (customer_id, placed_at
 * desc)` pair having a live precedent for a `placed_at`-ordered read.
 *
 * No state filtering here — which lifecycle states belong in which board
 * column is a presentation decision the board layer owns (M2-DATA-001), not
 * this query's.
 */
export async function fetchRestaurantOrders(
  client: SupabaseClient,
  restaurantId: string,
): Promise<OrderBoardRow[]> {
  const { data, error } = await client
    .from('orders')
    .select(ORDER_BOARD_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('placed_at', { ascending: false })
    .returns<OrderBoardRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

export function toMerchantOrderSummary(row: OrderBoardRow): MerchantOrderSummary {
  return {
    id: row.id,
    orderNumber: row.order_number,
    state: row.state as OrderState,
    restaurantId: row.restaurant_id,
    recipientNameSnapshot: row.recipient_name_snapshot,
    recipientPhoneSnapshot: row.recipient_phone_snapshot,
    grandTotalSatang: row.grand_total_satang,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
  };
}
