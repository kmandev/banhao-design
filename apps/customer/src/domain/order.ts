/**
 * Customer App order domain — the production contract (Phase E-3B.1).
 *
 * These types describe what the **deployed schema actually holds**
 * (`supabase/migrations/20260811000005_order_domain.sql`). They are the only
 * order vocabulary in the app: the pre-DEC-019 12-state mock pair that used to
 * sit in `src/mocks/types.ts` (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`,
 * `COMPLETED`, `NO_DRIVER` — names CLAUDE.md forbids in new work) is deleted,
 * having outlived its last reader. This file is the source for the real
 * order-history, detail, and tracking reads.
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
 * One row of the customer's own order history (C-16), as the list needs it.
 *
 * Deliberately a summary, not a trimmed `OrderDetail`: the history list reads
 * four tables' worth of nothing — it needs the order row plus each line's name
 * and quantity, and nothing else. Fetching full option snapshots and status
 * history for every row to then discard them would be an N+1 in service of
 * data the card never renders.
 *
 * `items` stays structured rather than a pre-joined `"A ×2, B ×1"` string:
 * that string is a wording choice (the `×` and the separator both come from
 * the design), and this module holds facts. `summariseItems` in
 * `lib/orderDisplay.ts` owns the wording.
 */
export interface OrderHistoryEntry {
  orderId: string;
  orderNumber: string;
  state: OrderState;
  paymentMethod: OrderPaymentMethod;
  restaurantNameSnapshot: string;
  grandTotalSatang: Satang;
  /** `orders.placed_at`, ISO-8601 as PostgREST returns `timestamptz`. */
  placedAt: string;
  items: { nameSnapshot: string; quantity: number }[];
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
  restaurantNameSnapshot: string;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  deliveryAddressSnapshot: string;
  /** `orders.delivery_landmark` — nullable; not every address has one. */
  deliveryLandmark: string | null;
  placedAt: string;
  /**
   * `orders.prep_minutes` (M-05) — the preparation time the merchant named
   * for THIS order when accepting it, in minutes. `null` when none was
   * recorded, which is permanently true of every order accepted before M-05
   * shipped; the caption is then simply not rendered.
   *
   * **Not an ETA.** It is a kitchen's estimate of its own work, and prep time
   * plus delivery time is not an arrival time. It must never be presented as
   * a countdown, a delivery ETA, a rider ETA or a promised delivery time, and
   * it is not `orders.quoted_eta_minutes` or `restaurants.avg_prep_minutes`.
   */
  prepMinutes: number | null;
  /**
   * `orders.customer_quoted_prep_minutes` (AC-04 / DEC-042) — the
   * preparation estimate the platform showed this customer, in force when
   * they placed the order: the restaurant's busy estimate if it was Busy,
   * its normal estimate otherwise. Captured by `create_order()` and
   * immutable afterwards, so a later mode change cannot rewrite what the
   * customer was told.
   *
   * `null` when no estimate was recorded — every order placed before this
   * column existed, permanently, and any order placed at a restaurant with
   * no estimate to show (AV-E5). Never substitute the restaurant's current
   * value for a null: that is the live number, not the historical one.
   *
   * **Not `prepMinutes`.** That is the merchant's own answer for this order,
   * given later, at accept time (M-05). The two are different actors
   * answering at different moments and may legitimately differ. **Not an
   * ETA** either — the same prohibition `prepMinutes` carries applies here
   * in full.
   */
  customerQuotedPrepMinutes: number | null;
  items: OrderLineItem[];
  /**
   * The append-only audit trail. Fetched and modelled here because it is part
   * of what an order *is*, but **not rendered by C-19** — the design canvas's
   * screen 19 has no timeline, and UX-SPEC §9.3 assigns the Timeline component
   * to "Customer tracking, admin order detail". C-14 is its customer-facing
   * home and will consume this field when it is converted off its mock states.
   */
  statusHistory: OrderStatusEvent[];
}
