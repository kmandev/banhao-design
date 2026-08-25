/**
 * Driver App order domain — the rider's own read contract (Phase G, V1.1 §15).
 *
 * Every field here is projected by one of the three deployed
 * `rider_order_*` views (`rider_order_view`, `rider_order_item_view`,
 * `rider_order_item_option_view` —
 * `supabase/migrations/20260811000012_rider_order_views.sql`), never the
 * base `orders`/`order_items`/`order_item_options` tables, which carry no
 * rider `SELECT` policy at all as of that same migration.
 *
 * **Deliberately money-free.** None of the three views project any
 * `*_satang` column, `payment_method`, `customer_id`, `address_id`,
 * `menu_item_id` or `menu_option_id` — a rider has no operational need for
 * the order's price breakdown (Phase 1 is online-payment-only, DEC-016),
 * and this file adds none of them back. See the migration's own header for
 * the full argument, including the query-error oracle `security_barrier`
 * closes.
 */

export interface RiderOrderItemOption {
  id: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  createdAt: string;
}

export interface RiderOrderLineItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  options: RiderOrderItemOption[];
}

/**
 * The order currently assigned to the caller, as `rider_order_view` +
 * `rider_order_item_view` + `rider_order_item_option_view` project it.
 *
 * `state` is `orders.state`'s own CHECK-constrained vocabulary — the same
 * one `apps/customer/src/domain/order.ts` types as `OrderState`. Left as
 * `string` here rather than duplicating that union: a rider only ever sees a
 * subset of it (from `MERCHANT_ACCEPTED`, once a delivery row exists, onward
 * — `is_assigned_order_rider()` is false before that), and the two apps'
 * unions would otherwise have to be kept in lockstep by hand for a
 * distinction no rider screen needs to make yet.
 */
export interface RiderOrderDetail {
  orderId: string;
  orderNumber: string;
  state: string;
  restaurantId: string;
  restaurantNameSnapshot: string;
  deliveryAddressSnapshot: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryLandmark: string | null;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  distanceM: number | null;
  quotedEtaMinutes: number | null;
  placedAt: string;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: RiderOrderLineItem[];
}
