import { z } from 'zod';
import { satangSchema, uuidSchema } from './common';

/**
 * One line's expected price, as the client last displayed it.
 *
 * Shared between `POST /api/v1/cart/validate` (Phase D / D-6) and
 * `POST /api/v1/orders` (Phase E-2) — both compare a client-held price
 * against the live catalog and raise `PRICE_CHANGED` on a mismatch, and both
 * must mean exactly the same thing by "expected", so this is defined once.
 */
export const expectedLineSchema = z
  .object({
    cartItemId: uuidSchema,
    /** Unit price the client last displayed: base price + selected option deltas, before quantity. */
    expectedUnitPriceSatang: satangSchema,
  })
  .strict();

export type ExpectedLine = z.infer<typeof expectedLineSchema>;

/**
 * `POST /api/v1/cart/validate` request body (Phase D / D-6).
 *
 * The cart itself carries no price — `cart_items` has no such column, by
 * design (`supabase/migrations/20260811000004_cart_domain.sql`). The server is
 * always authoritative for the returned subtotal; `expectedLines` exists only
 * so `PRICE_CHANGED` (UX-SPEC § 13: `ราคามีการเปลี่ยนแปลง` + old → new per
 * line) has an "old" to compare against — the customer app already holds it,
 * having read it live from the catalog itself (DEC-APP-008) at whatever moment
 * it last rendered the cart. Nothing here is persisted; omitting the field
 * skips the comparison and still returns a fully server-computed subtotal.
 */
export const cartValidateRequestSchema = z
  .object({
    expectedLines: z.array(expectedLineSchema).optional(),
  })
  .strict();

export type CartValidateRequest = z.infer<typeof cartValidateRequestSchema>;
