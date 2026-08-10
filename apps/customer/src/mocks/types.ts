/**
 * Customer App domain types.
 *
 * These follow the generic entity model from DEC-005 / REQ-004 — Merchant,
 * Product, Order, Delivery, Driver — so Phase 2–4 (Parcel, Ride, Shopping) can
 * reuse the same shapes. `Shop` and `MenuItem` are the Food-phase names for
 * Merchant and Product.
 *
 * Money is always integer satang (@banhao/types Money) — never floats (CON-003).
 *
 * These live here rather than in @banhao/types because no backend contract
 * exists for them yet; the real schema arrives with the domain migrations in a
 * later step. Promoting them to @banhao/types is the natural move at that
 * point.
 */

import type { Satang } from '@banhao/types';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'primary';

export interface Category {
  id: string;
  icon: string;
  name: string;
}

/** Merchant, in Food-phase naming. */
export interface Shop {
  id: string;
  name: string;
  /** The design uses an emoji glyph where a photo would go. */
  glyph: string;
  rating: string;
  reviewCount: number;
  cuisine: string;
  distanceKm: number;
  etaMinutes: string;
  deliveryFeeSatang: Satang;
  badge?: { label: string; tone: BadgeTone };
  isOpen: boolean;
  openingHours: string;
  addressLine: string;
}

export interface MenuOption {
  id: string;
  label: string;
  priceDeltaSatang: Satang;
}

export interface MenuOptionGroup {
  id: string;
  title: string;
  required: boolean;
  options: MenuOption[];
}

/** Product, in Food-phase naming. */
export interface MenuItem {
  id: string;
  shopId: string;
  name: string;
  description?: string;
  priceSatang: Satang;
  glyph: string;
  section: string;
  optionGroups?: MenuOptionGroup[];
}

export interface Address {
  id: string;
  label: string;
  glyph: string;
  line: string;
  isDefault: boolean;
}

/**
 * Order state, mirroring the 12-state Order State Machine in
 * docs/ARCHITECTURE.md. Kept separate from payment state (CON-001).
 */
export type OrderState =
  | 'NEW'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'DRIVER_ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'COMPLETED'
  | 'NO_DRIVER'
  | 'PAYMENT_FAILED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * Payment state, mirroring the 12-state Payment State Machine.
 * Deliberately a separate type from OrderState — CON-001 forbids merging them.
 */
export type PaymentState =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUND_PROCESSING'
  | 'REFUNDED'
  | 'CASH_PENDING'
  | 'CASH_COLLECTED';

export type PaymentMethod = 'PROMPTPAY' | 'CASH';

export interface OrderSummary {
  id: string;
  shopName: string;
  glyph: string;
  orderState: OrderState;
  placedAt: string;
  itemSummary: string;
  totalSatang: Satang;
  paymentMethod: PaymentMethod;
}

export interface AppNotification {
  id: string;
  glyph: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

/** A line in the local cart. Options are resolved to labels for display. */
export interface CartLine {
  /** Stable key for this configured line, not the menu item id. */
  lineId: string;
  menuItemId: string;
  shopId: string;
  name: string;
  basePriceSatang: Satang;
  optionLabels: string[];
  optionsDeltaSatang: Satang;
  note: string;
  quantity: number;
}
