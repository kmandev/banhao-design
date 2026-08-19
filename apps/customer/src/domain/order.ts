/**
 * Customer App order domain — the production contract (Phase E-3B.1).
 *
 * These types describe what the **deployed schema actually holds**
 * (`supabase/migrations/20260811000005_order_domain.sql`), not the mock
 * `OrderSummary`/`OrderState` in `src/mocks/types.ts` — that pair carries the
 * superseded 12-state machine (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`,
 * `COMPLETED`, `NO_DRIVER`) and CLAUDE.md forbids using those names in new
 * work. `OrdersScreen`/`OrderTrackingScreen` keep using the mock pair
 * unchanged — this file exists alongside it for the real order-detail read
 * path, the same way `domain/catalog.ts` sits alongside the old catalog mock
 * types without replacing them in one sweep.
 *
 * Money is integer satang throughout (CON-003) — never a float, never Baht.
 *
 * `OrderState` is exactly the CHECK constraint on `orders.state`: the nine
 * `DEC-019` core states plus the five exception states, which
 * `docs/ORDER_LIFECYCLE.md` §3 still marks PROPOSED / not yet approved. There
 * is no `CONFIRMED` state (docs/DECISIONS.md line 2259) and no `REJECTED`
 * (the schema's own name is `MERCHANT_REJECTED`).
 */

import type { Satang } from '@banhao/types';

export type OrderState =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'MERCHANT_ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXPIRED'
  | 'MERCHANT_REJECTED'
  | 'CANCELLED'
  | 'DELIVERY_FAILED';

export type OrderPaymentMethod = 'ONLINE' | 'CASH';

/** One selected option, snapshotted at order creation (`order_item_options`). */
export interface OrderItemOption {
  id: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  priceDeltaSatang: Satang;
}

/** One order line, snapshotted at order creation (`order_items`) — write-once. */
export interface OrderLineItem {
  id: string;
  /** Nullable: `order_items.menu_item_id` is `ON DELETE SET NULL` on purpose — the snapshot is the truth. */
  menuItemId: string | null;
  nameSnapshot: string;
  unitPriceSatang: Satang;
  quantity: number;
  lineTotalSatang: Satang;
  note: string | null;
  options: OrderItemOption[];
}

/** One row of the append-only audit trail (`order_status_history`, REQ-002). */
export interface OrderStatusEvent {
  toState: OrderState;
  occurredAt: string;
  reason: string | null;
}

/**
 * A single order, as the customer who placed it may read it.
 *
 * Every field below is either a stored column or a write-once snapshot —
 * nothing here is derived from a live re-read of `menu_items`, matching
 * `orders_enforce_immutable_columns()`'s own guarantee that a printed order
 * shows what the customer actually agreed to.
 */
export interface OrderDetail {
  orderId: string;
  orderNumber: string;
  state: OrderState;
  paymentMethod: OrderPaymentMethod;
  subtotalSatang: Satang;
  deliveryFeeSatang: Satang;
  serviceFeeSatang: Satang;
  discountSatang: Satang;
  grandTotalSatang: Satang;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  deliveryAddressSnapshot: string;
  placedAt: string;
  items: OrderLineItem[];
  statusHistory: OrderStatusEvent[];
}
