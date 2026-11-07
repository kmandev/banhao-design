/**
 * DEC-061 D-03 / D-04 — the Phase 1 customer service fee:
 *
 *   5% of the food subtotal, never below ฿5, never above ฿15
 *   (percentage → floor → cap).
 *
 * Together these fully supersede DEC-036's fixed ฿5. DEC-047 (when the fee is
 * recognized as revenue) and DEC-048 (the fee is refunded in an eligible full
 * refund) are unchanged, and both already read the amount stored on the order,
 * never this function.
 *
 * ## Base
 *
 * The food subtotal only — the same validated `subtotal_satang` the order
 * stores and the commission is resolved against. Delivery fee and discount are
 * not part of it (D-03 says "of food subtotal"; no promotion engine exists).
 *
 * ## Rounding
 *
 * D-03 requires integer-satang semantics and states no other rounding, so the
 * fee keeps satang precision: 5% of ฿150 is ฿7.50, exactly as the D-03/D-04
 * comparison matrix in `docs/Q-002-OWNER-DECISION-PACK.md` §8A.3 shows it.
 * The only fraction 5% can produce is below one satang (a subtotal that is not
 * a multiple of 20 satang). That fraction is rounded half-up to the nearest
 * satang. This is deliberately **not** D-02's whole-baht rule: D-02 governs
 * the commission only, and borrowing it here would move a customer-facing fee
 * by up to 50 satang on a rule nobody chose for it.
 *
 * ## Authority
 *
 * Runs once per order, at creation, in `OrderPricingService.resolveOrderFees`.
 * `create_order()` stores the amount (never a rate) and the column is
 * immutable afterwards, so a later change here never alters an existing order.
 * The rate, floor and cap are private for the same reason as the commission
 * rate: a value that can be imported can end up computed twice, or in a client.
 */
const SERVICE_FEE_RATE_PERCENT = 5;
const SERVICE_FEE_FLOOR_SATANG = 500; // ฿5 — D-03
const SERVICE_FEE_CAP_SATANG = 1500; // ฿15 — D-04

/**
 * The service fee for one order's food subtotal, in integer satang.
 *
 * Integer arithmetic only (CON-003): `foodSubtotalSatang × 5` is exact for
 * every realistic order, and the single half-up division by 100 is floored at
 * once, so no float ever holds money.
 *
 * @throws if `foodSubtotalSatang` is not a non-negative integer — order
 *   creation then fails before `create_order()` is called, so no order is
 *   priced on a guess.
 */
export function calculateServiceFeeSatang(foodSubtotalSatang: number): number {
  if (!Number.isSafeInteger(foodSubtotalSatang) || foodSubtotalSatang < 0) {
    throw new Error(
      `food subtotal must be a non-negative integer satang amount, got ${String(foodSubtotalSatang)}`,
    );
  }

  // round_half_up(foodSubtotalSatang × 5 / 100), in integers.
  const percentageSatang = Math.floor((foodSubtotalSatang * SERVICE_FEE_RATE_PERCENT + 50) / 100);

  return Math.min(SERVICE_FEE_CAP_SATANG, Math.max(SERVICE_FEE_FLOOR_SATANG, percentageSatang));
}
