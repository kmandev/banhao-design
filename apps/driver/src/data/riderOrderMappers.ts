/**
 * Database row → domain mappers for the rider's read path (Phase G, V1.1 §15).
 *
 * Row shapes here are exactly the projection of the three deployed
 * `rider_order_*` views (`supabase/migrations/20260811000012_rider_order_views.sql`),
 * never the base `orders`/`order_items`/`order_item_options` tables — a
 * rider's own policy on those tables no longer exists (the same migration
 * drops it), so a row shape wider than a view's own column list could never
 * actually be fetched. Same two rules `apps/customer/src/data/orderMappers.ts`
 * holds to:
 *
 * 1. **Nothing is invented.** A mapper's only job is renaming columns, never
 *    filling in a value the row doesn't have.
 * 2. **No money field.** Neither the row shapes nor the mappers below carry
 *    a `*_satang` column, `payment_method`, or any other financial field —
 *    none of the three views project one (see `domain/riderOrder.ts`).
 */

import type {
  RiderOrderDetail,
  RiderOrderItemOption,
  RiderOrderLineItem,
} from '../domain/riderOrder';

/** `rider_order_view` — the full column list that view projects. */
export interface RiderOrderRow {
  id: string;
  order_number: string;
  state: string;
  restaurant_id: string;
  restaurant_name_snapshot: string;
  delivery_address_snapshot: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_landmark: string | null;
  recipient_name_snapshot: string;
  recipient_phone_snapshot: string;
  distance_m: number | null;
  quoted_eta_minutes: number | null;
  placed_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `rider_order_item_view` — the full column list that view projects. */
export interface RiderOrderItemRow {
  id: string;
  order_id: string;
  item_name_snapshot: string;
  quantity: number;
  note: string | null;
  created_at: string;
}

/** `rider_order_item_option_view` — the full column list that view projects. */
export interface RiderOrderItemOptionRow {
  id: string;
  order_item_id: string;
  group_name_snapshot: string;
  option_name_snapshot: string;
  created_at: string;
}

export function toRiderOrderItemOption(row: RiderOrderItemOptionRow): RiderOrderItemOption {
  return {
    id: row.id,
    groupNameSnapshot: row.group_name_snapshot,
    optionNameSnapshot: row.option_name_snapshot,
    createdAt: row.created_at,
  };
}

export function toRiderOrderLineItem(
  row: RiderOrderItemRow,
  options: RiderOrderItemOption[],
): RiderOrderLineItem {
  return {
    id: row.id,
    nameSnapshot: row.item_name_snapshot,
    quantity: row.quantity,
    note: row.note,
    createdAt: row.created_at,
    options,
  };
}

export function toRiderOrderDetail(row: RiderOrderRow, items: RiderOrderLineItem[]): RiderOrderDetail {
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    state: row.state,
    restaurantId: row.restaurant_id,
    restaurantNameSnapshot: row.restaurant_name_snapshot,
    deliveryAddressSnapshot: row.delivery_address_snapshot,
    deliveryLat: row.delivery_lat,
    deliveryLng: row.delivery_lng,
    deliveryLandmark: row.delivery_landmark,
    recipientNameSnapshot: row.recipient_name_snapshot,
    recipientPhoneSnapshot: row.recipient_phone_snapshot,
    distanceM: row.distance_m,
    quotedEtaMinutes: row.quoted_eta_minutes,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}
