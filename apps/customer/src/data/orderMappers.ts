/**
 * Database row → domain mappers for order detail (Phase E-3B.1).
 *
 * Same two rules `catalogMappers.ts` holds to:
 *
 * 1. **Satang stays an integer.** Every `*_satang` column is Postgres
 *    `bigint`; it arrives as a JS number and is passed through untouched.
 * 2. **Nothing is invented.** These are write-once snapshots
 *    (`orders_enforce_immutable_columns()`, `reject_mutation()` triggers) —
 *    a mapper's only job is renaming columns, never filling in a value the
 *    row doesn't have.
 */

import type {
  OrderDetail,
  OrderHistoryEntry,
  OrderItemOption,
  OrderLineItem,
  OrderPaymentMethod,
  OrderState,
  OrderStatusEvent,
} from '../domain/order';

// --- row shapes, exactly as selected by orderQueries -----------------------

export interface OrderRow {
  id: string;
  order_number: string;
  state: string;
  payment_method: string;
  subtotal_satang: number;
  delivery_fee_satang: number;
  service_fee_satang: number;
  discount_satang: number;
  grand_total_satang: number;
  restaurant_name_snapshot: string;
  recipient_name_snapshot: string;
  recipient_phone_snapshot: string;
  delivery_address_snapshot: string;
  delivery_landmark: string | null;
  placed_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name_snapshot: string;
  unit_price_satang: number;
  quantity: number;
  line_total_satang: number;
  note: string | null;
}

export interface OrderItemOptionRow {
  id: string;
  order_item_id: string;
  group_name_snapshot: string;
  option_name_snapshot: string;
  price_delta_satang: number;
}

export interface OrderStatusHistoryRow {
  to_state: string;
  occurred_at: string;
  reason: string | null;
}

/** The subset of `orders` the history list selects — see `ORDER_HISTORY_COLUMNS`. */
export interface OrderHistoryRow {
  id: string;
  order_number: string;
  state: string;
  payment_method: string;
  restaurant_name_snapshot: string;
  grand_total_satang: number;
  placed_at: string;
}

export function toOrderHistoryEntry(
  row: OrderHistoryRow,
  items: { nameSnapshot: string; quantity: number }[],
): OrderHistoryEntry {
  return {
    orderId: row.id,
    orderNumber: row.order_number,
    state: row.state as OrderState,
    paymentMethod: row.payment_method as OrderPaymentMethod,
    restaurantNameSnapshot: row.restaurant_name_snapshot,
    grandTotalSatang: row.grand_total_satang,
    placedAt: row.placed_at,
    items,
  };
}

export function toOrderItemOption(row: OrderItemOptionRow): OrderItemOption {
  return {
    id: row.id,
    groupNameSnapshot: row.group_name_snapshot,
    optionNameSnapshot: row.option_name_snapshot,
    priceDeltaSatang: row.price_delta_satang,
  };
}

export function toOrderLineItem(row: OrderItemRow, options: OrderItemOption[]): OrderLineItem {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    nameSnapshot: row.item_name_snapshot,
    unitPriceSatang: row.unit_price_satang,
    quantity: row.quantity,
    lineTotalSatang: row.line_total_satang,
    note: row.note,
    options,
  };
}

export function toOrderStatusEvent(row: OrderStatusHistoryRow): OrderStatusEvent {
  return {
    // `state` is the CHECK-constrained vocabulary (domain/order.ts) — a row
    // could in principle carry a value outside it only if the constraint
    // itself changes, in which case the cast is the honest place to widen.
    toState: row.to_state as OrderState,
    occurredAt: row.occurred_at,
    reason: row.reason,
  };
}

export function toOrderDetail(
  order: OrderRow,
  items: OrderLineItem[],
  statusHistory: OrderStatusEvent[],
): OrderDetail {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    state: order.state as OrderState,
    paymentMethod: order.payment_method as OrderPaymentMethod,
    subtotalSatang: order.subtotal_satang,
    deliveryFeeSatang: order.delivery_fee_satang,
    serviceFeeSatang: order.service_fee_satang,
    discountSatang: order.discount_satang,
    grandTotalSatang: order.grand_total_satang,
    restaurantNameSnapshot: order.restaurant_name_snapshot,
    recipientNameSnapshot: order.recipient_name_snapshot,
    recipientPhoneSnapshot: order.recipient_phone_snapshot,
    deliveryAddressSnapshot: order.delivery_address_snapshot,
    deliveryLandmark: order.delivery_landmark,
    placedAt: order.placed_at,
    items,
    statusHistory,
  };
}
