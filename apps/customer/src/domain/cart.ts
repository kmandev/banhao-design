/**
 * Customer App cart domain — the production contract (Phase D / D-2).
 *
 * These types describe what the **deployed schema actually holds**
 * (`supabase/migrations/20260811000004_cart_domain.sql`), not what the mock
 * fixtures happened to carry. They replace the cart half of `src/mocks/types.ts`:
 * no production module may import `CartLine` from `src/mocks/` any more.
 *
 * Money is integer satang throughout (CON-003) — never a float, never Baht.
 *
 * ## A cart is not a contract
 *
 * The `carts` table comment says it outright: *"Not a contract — cart_items
 * carries no price snapshot; the order is where prices freeze."* That single
 * fact shapes this whole module:
 *
 * - Nothing here is stored money. `basePriceSatang` and `priceDeltaSatang` are
 *   read live from the catalog on every load, so a cart shows today's price
 *   rather than the price at the moment it was filled.
 * - The totals below are therefore **indicative display arithmetic**, not an
 *   authority. The server re-prices at `POST /cart/validate` (D-6) and the
 *   order snapshot is what actually becomes binding (Phase E).
 *
 * ## Fields deliberately ABSENT — DEC-D-01
 *
 * There is no delivery fee, service fee, discount, or grand total in this
 * module, and no function that computes one. Delivery and service fee are now
 * resolved amounts (DEC-035, DEC-036), but resolution is `OrderPricingService`'s
 * job at order creation (Phase E), not this Phase D cart module's — discount
 * (BQ-030) and commission (Q-010) remain OPEN regardless. UX-SPEC § C-09 is
 * explicit that a fee whose amount is not knowable *here* renders as
 * `คำนวณเมื่อยืนยัน` — "calculated at confirmation" — *"rather than a number
 * the app invented"*.
 *
 * `subtotalSatang` is the one total that exists here, because it is the only
 * one derivable from data the customer app can actually read.
 */

import type { Satang } from '@banhao/types';

/**
 * One option chosen on a cart line (`cart_item_options`, joined to
 * `menu_options` for the label and delta).
 *
 * `id` is the join row; `menuOptionId` is what the customer picked. Both are
 * kept because removing a selection needs the former while re-selecting needs
 * the latter.
 */
export interface CartOptionSelection {
  /** `cart_item_options.id`. */
  id: string;
  /** `menu_options.id`. */
  menuOptionId: string;
  label: string;
  priceDeltaSatang: Satang;
}

/**
 * One configured line in the cart (`cart_items`).
 *
 * `name`, `basePriceSatang` and `isAvailable` are **not** columns on
 * `cart_items` — they are read live from `menu_items` when the cart is loaded.
 * `isAvailable` is the catalog's own field, carried through unchanged: there is
 * deliberately no second notion of availability in this domain (PC-Q-001).
 */
export interface CartLine {
  /** `cart_items.id` — the identity of *this configuration*, not the menu item. */
  id: string;
  menuItemId: string;
  /** Live from `menu_items.name`. */
  name: string;
  /** Live from `menu_items.base_price_satang`. */
  basePriceSatang: Satang;
  /** Live from `menu_items.is_available` — the catalog's field, not a new one. */
  isAvailable: boolean;
  quantity: number;
  /** Empty string when the customer left no note; never null in the domain. */
  note: string;
  options: CartOptionSelection[];
}

/**
 * The customer's single open cart (`carts`).
 *
 * One per user — `carts_user_id_key` is a UNIQUE constraint on `user_id`, so
 * "the cart" is always unambiguous. Scoped to exactly one restaurant (DEC-017),
 * which the composite foreign keys make structurally impossible to violate.
 */
export interface Cart {
  id: string;
  /** `carts.restaurant_id` — the single restaurant this cart belongs to. */
  shopId: string;
  lines: CartLine[];
  /**
   * Lines that exist in the database but whose menu item could not be read.
   *
   * This is not a defensive nicety: RLS hides items that were archived or whose
   * restaurant left `ACTIVE` after the line was added, so a real cart can
   * genuinely contain a line the catalog will no longer describe. Such a line
   * cannot be named or priced, so it is not in `lines` — but dropping it
   * silently would shrink the customer's cart with no explanation, so its id
   * surfaces here instead. Presenting it is D-9 work; losing it is not an
   * option at any point.
   */
  unresolvedLineIds: string[];
}

/** The price of one line's chosen options, before quantity. */
export function optionsDeltaSatang(line: CartLine): Satang {
  return line.options.reduce((sum, option) => sum + option.priceDeltaSatang, 0);
}

/**
 * What one line costs at today's prices.
 *
 * Integer satang throughout — `quantity` is a whole number and both price
 * components are integers, so this never leaves integer arithmetic.
 */
export function lineTotalSatang(line: CartLine): Satang {
  return (line.basePriceSatang + optionsDeltaSatang(line)) * line.quantity;
}

/**
 * The food subtotal — the *only* total this domain computes (DEC-D-01).
 *
 * Indicative until `POST /cart/validate` (D-6) re-prices it server-side. Fees
 * and discounts are not added here and must not be added here.
 */
export function cartSubtotalSatang(cart: Cart): Satang {
  return cart.lines.reduce((sum, line) => sum + lineTotalSatang(line), 0);
}

/** Total number of individual items, summing quantities rather than lines. */
export function cartItemCount(cart: Cart): number {
  return cart.lines.reduce((count, line) => count + line.quantity, 0);
}

/** The chosen option labels, in stored order, for one-line display. */
export function optionLabels(line: CartLine): string[] {
  return line.options.map((option) => option.label);
}

/** An empty cart for a given restaurant — used before the first line is saved. */
export function emptyCart(id: string, shopId: string): Cart {
  return { id, shopId, lines: [], unresolvedLineIds: [] };
}
