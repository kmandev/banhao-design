import type { Satang } from '@banhao/types';
import type { OrderState } from './order';

/**
 * Merchant Order Detail domain (M-04) — design
 * `docs/design/BANHAO M-04 Merchant Order Detail Panel.dc.html` §01/§08.
 *
 * Everything here is a stored or write-once-snapshot column from
 * `order_items`, `order_item_options` and `order_status_history`
 * (`supabase/migrations/20260811000005_order_domain.sql`), read under the
 * merchant SELECT policies already granted on all three
 * (`20260811000011_rls_policies.sql`). Nothing is computed: `order_items` and
 * `order_item_options` carry `reject_mutation()` triggers and can never
 * change after creation, and `orders_total_check` is what actually enforces
 * `grand_total_satang`, not this file.
 *
 * `OrderState` and the actor vocabulary are sourced independently from the
 * same CHECK constraints `domain/order.ts` already reads, never imported
 * from another app's `src` (M2-TYPE-001).
 */

export type OrderStatusActorType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR' | 'SYSTEM' | 'WEBHOOK';

/** One selected option, snapshotted at order creation (`order_item_options`). */
export interface MerchantOrderItemOption {
  id: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  priceDeltaSatang: Satang;
}

/** One order line, snapshotted at order creation (`order_items`) — write-once. */
export interface MerchantOrderItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  unitPriceSatang: Satang;
  lineTotalSatang: Satang;
  note: string | null;
  options: MerchantOrderItemOption[];
}

/**
 * One row of the append-only audit trail (`order_status_history`, REQ-002).
 * `fromState` is fetched by nothing here — the design's region E explicitly
 * marks it "not shown" (§03), so it has no place in this type.
 */
export interface MerchantOrderHistoryEntry {
  id: string;
  toState: OrderState;
  actorType: OrderStatusActorType;
  reason: string | null;
  occurredAt: string;
}

/**
 * The panel's fetched detail for one order — deliberately without `state`.
 *
 * The header chip is read from the live board row (`MerchantOrderSummary`
 * already in `useOrderBoard`'s reconciled state), never from this snapshot —
 * design §01/§08: "Read from the live board row, not the detail fetch" and
 * F-04, "The state shown in the panel is the same value the card shows, at
 * every moment." A `state` column fetched here would tempt exactly the bug
 * that rule exists to prevent: rendering a value that can go stale the
 * instant a Realtime event lands while the panel is open.
 */
export interface MerchantOrderDetail {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  recipientNameSnapshot: string;
  recipientPhoneSnapshot: string;
  deliveryAddressSnapshot: string;
  /** `orders.delivery_landmark` — nullable; not every address has one. */
  deliveryLandmark: string | null;
  paymentMethod: 'ONLINE' | 'CASH';
  subtotalSatang: Satang;
  deliveryFeeSatang: Satang;
  serviceFeeSatang: Satang;
  discountSatang: Satang;
  grandTotalSatang: Satang;
  placedAt: string;
  /** `orders.accepted_at` — null until `MERCHANT_ACCEPTED`. */
  acceptedAt: string | null;
  /** `orders.ready_at` — null until `READY_FOR_PICKUP`. */
  readyAt: string | null;
  /** `orders.picked_up_at` — null until `PICKED_UP`. */
  pickedUpAt: string | null;
  items: MerchantOrderItem[];
  /** Chronological ascending by `occurred_at` (§03/§08) — the append-only trail, never reconstructed. */
  statusHistory: MerchantOrderHistoryEntry[];
}
