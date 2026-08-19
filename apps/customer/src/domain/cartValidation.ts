/**
 * Cart revalidation — the customer-side contract (Phase D · checkout
 * revalidation).
 *
 * V1.1 §15's Phase D done-when is *"a stale cart cannot become an order"*, and
 * UX-SPEC § C-10 says how: *"Server-side revalidation runs on press; a price
 * change or unavailable item returns the customer to a clearly-marked diff, not
 * a generic failure."*
 *
 * These types describe what `POST /api/v1/cart/validate` actually returns
 * (`apps/api/src/modules/cart/cart.service.ts`), mapped into the customer's own
 * vocabulary. As everywhere else in this app, money is integer satang.
 *
 * ## No fee, no total — DEC-D-01
 *
 * The server deliberately returns a **subtotal only**; delivery fee, service
 * fee and discount are still OPEN (BQ-026, BQ-027, BQ-030) and are not computed
 * anywhere. Nothing here reintroduces them.
 */

import type { Satang } from '@banhao/types';

/** One line as the server re-priced it. */
export interface ValidatedCartLine {
  cartItemId: string;
  menuItemId: string;
  quantity: number;
  /** Base price + available option deltas, before quantity. */
  unitPriceSatang: Satang;
  lineSubtotalSatang: Satang;
}

/** A cart the server accepted. */
export interface CartValidation {
  cartId: string | null;
  restaurantId: string | null;
  /** Server-authoritative food subtotal. The only total that exists (DEC-D-01). */
  subtotalSatang: Satang;
  lines: ValidatedCartLine[];
}

/** One line whose live price no longer matches what the customer was shown. */
export interface PriceChange {
  cartItemId: string;
  wasSatang: Satang;
  nowSatang: Satang;
}

/** One line that can no longer be ordered. */
export interface UnavailableItem {
  cartItemId: string;
  menuItemId: string;
}

/**
 * Why a cart was refused.
 *
 * Modelled as a discriminated union rather than a bare error so the screen can
 * render the *specific* diff UX-SPEC § 13 requires for each — `ราคามีการ
 * เปลี่ยนแปลง` with old → new per line, or the marked `วันนี้หมด` diff — instead
 * of collapsing both into one generic failure.
 */
export type CartConflict =
  | { kind: 'PRICE_CHANGED'; changes: PriceChange[] }
  | { kind: 'ITEM_UNAVAILABLE'; items: UnavailableItem[] };

/**
 * A conflict the server named, raised so a caller cannot mistake it for a
 * transport failure. Anything that is *not* one of these must fail closed.
 */
export class CartConflictError extends Error {
  readonly conflict: CartConflict;

  constructor(conflict: CartConflict) {
    super(conflict.kind);
    this.name = 'CartConflictError';
    this.conflict = conflict;
  }
}

/** What the client believed a line cost, so the server can detect drift. */
export interface ExpectedLine {
  cartItemId: string;
  expectedUnitPriceSatang: Satang;
}
