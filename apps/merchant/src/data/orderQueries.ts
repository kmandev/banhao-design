import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantOrderSummary, OrderState } from '../domain/order';
import type {
  MerchantOrderDetail,
  MerchantOrderHistoryEntry,
  MerchantOrderItem,
  MerchantOrderItemOption,
  OrderStatusActorType,
} from '../domain/orderDetail';

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

// ---------------------------------------------------------------------------
// Order detail (M-04) — design
// `docs/design/BANHAO M-04 Merchant Order Detail Panel.dc.html` §01/§08/§09
// (M04-D11). One embedded PostgREST select across `orders`, `order_items`,
// `order_item_options` and `order_status_history` — all four already carry a
// merchant SELECT policy (`orders_select_merchant`,
// `order_items_select_merchant`, `order_item_options_select_merchant`,
// `order_status_history_select_merchant`,
// `20260811000011_rls_policies.sql`), scoped by `is_restaurant_member`. No
// API endpoint, no new migration, no RLS change (M-04's "no change expected"
// list).
//
// `state` is selected — matching the design's own literal query fixture
// verbatim — but deliberately not carried into `MerchantOrderDetail`: the
// panel's header chip reads `state` from the live board row
// (`MerchantOrderSummary`, already reconciled by `useOrderBoard`), never
// from this fetch, so a value fetched here would only invite staleness bugs
// (design §01 region A, F-04).
// ---------------------------------------------------------------------------

const ORDER_DETAIL_COLUMNS = `
  id, order_number, state, restaurant_id,
  recipient_name_snapshot, recipient_phone_snapshot,
  delivery_address_snapshot, delivery_landmark,
  payment_method, subtotal_satang, delivery_fee_satang,
  service_fee_satang, discount_satang, grand_total_satang,
  placed_at, accepted_at, ready_at, picked_up_at,
  order_items ( id, item_name_snapshot, quantity, unit_price_satang,
                line_total_satang, note,
                order_item_options ( id, group_name_snapshot,
                                     option_name_snapshot,
                                     price_delta_satang ) ),
  order_status_history ( id, to_state, actor_type, reason, occurred_at )
`;

interface OrderDetailItemOptionRow {
  id: string;
  group_name_snapshot: string;
  option_name_snapshot: string;
  price_delta_satang: number;
}

interface OrderDetailItemRow {
  id: string;
  item_name_snapshot: string;
  quantity: number;
  unit_price_satang: number;
  line_total_satang: number;
  note: string | null;
  order_item_options: OrderDetailItemOptionRow[];
}

interface OrderDetailHistoryRow {
  id: string;
  to_state: string;
  actor_type: string;
  reason: string | null;
  occurred_at: string;
}

/** Raw row shape from the embedded detail select — kept separate from `MerchantOrderDetail`, same rationale as `OrderBoardRow`. */
export interface OrderDetailRow {
  id: string;
  order_number: string;
  state: string;
  restaurant_id: string;
  recipient_name_snapshot: string;
  recipient_phone_snapshot: string;
  delivery_address_snapshot: string;
  delivery_landmark: string | null;
  payment_method: string;
  subtotal_satang: number;
  delivery_fee_satang: number;
  service_fee_satang: number;
  discount_satang: number;
  grand_total_satang: number;
  placed_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  order_items: OrderDetailItemRow[];
  order_status_history: OrderDetailHistoryRow[];
}

/**
 * One order's full detail, scoped to both the order id and the caller's
 * current restaurant (M-04's application-level guard, alongside — never
 * instead of — the RLS policies above). `restaurantId` must already be a
 * membership-verified value, same requirement as `fetchRestaurantOrders`.
 *
 * `.single()` — matching the design's literal query — so a nonexistent id, a
 * cross-restaurant id the `.eq('restaurant_id', …)` filter excludes, or an
 * id RLS would have hidden anyway all resolve the same honest way: zero rows
 * is a PostgREST error, thrown below, not a silently empty detail. There is
 * no legitimate reason for a card the merchant just clicked to resolve to
 * nothing.
 */
export async function fetchOrderDetail(
  client: SupabaseClient,
  orderId: string,
  restaurantId: string,
): Promise<OrderDetailRow> {
  const { data, error } = await client
    .from('orders')
    .select(ORDER_DETAIL_COLUMNS)
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .order('occurred_at', { referencedTable: 'order_status_history', ascending: true })
    .single<OrderDetailRow>();

  if (error) throw new Error(error.message);
  return data;
}

function toMerchantOrderItemOption(row: OrderDetailItemOptionRow): MerchantOrderItemOption {
  return {
    id: row.id,
    groupNameSnapshot: row.group_name_snapshot,
    optionNameSnapshot: row.option_name_snapshot,
    priceDeltaSatang: row.price_delta_satang,
  };
}

function toMerchantOrderItem(row: OrderDetailItemRow): MerchantOrderItem {
  return {
    id: row.id,
    nameSnapshot: row.item_name_snapshot,
    quantity: row.quantity,
    unitPriceSatang: row.unit_price_satang,
    lineTotalSatang: row.line_total_satang,
    note: row.note,
    options: row.order_item_options.map(toMerchantOrderItemOption),
  };
}

function toMerchantOrderHistoryEntry(row: OrderDetailHistoryRow): MerchantOrderHistoryEntry {
  return {
    id: row.id,
    // `to_state` is the CHECK-constrained vocabulary; a value outside it can
    // only appear if the constraint itself changes, matching the same
    // widening precedent `apps/customer/src/data/orderMappers.ts` documents.
    toState: row.to_state as OrderState,
    actorType: row.actor_type as OrderStatusActorType,
    reason: row.reason,
    occurredAt: row.occurred_at,
  };
}

export function toMerchantOrderDetail(row: OrderDetailRow): MerchantOrderDetail {
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    restaurantId: row.restaurant_id,
    recipientNameSnapshot: row.recipient_name_snapshot,
    recipientPhoneSnapshot: row.recipient_phone_snapshot,
    deliveryAddressSnapshot: row.delivery_address_snapshot,
    deliveryLandmark: row.delivery_landmark,
    paymentMethod: row.payment_method as 'ONLINE' | 'CASH',
    subtotalSatang: row.subtotal_satang,
    deliveryFeeSatang: row.delivery_fee_satang,
    serviceFeeSatang: row.service_fee_satang,
    discountSatang: row.discount_satang,
    grandTotalSatang: row.grand_total_satang,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
    items: row.order_items.map(toMerchantOrderItem),
    statusHistory: row.order_status_history.map(toMerchantOrderHistoryEntry),
  };
}
