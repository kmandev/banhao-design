/**
 * DEC-043 — the Phase 1 merchant commission: **8% of the food subtotal**,
 * rounded to the nearest whole baht. Base is food subtotal only
 * (`orders.subtotal_satang`) — delivery fee (DEC-023/DEC-035) and service fee
 * (DEC-024/DEC-036) are excluded by DEC-043's own explicit base clause, and
 * so is any discount, since `orders.subtotal_satang` is captured before
 * `discount_satang` is applied. Deliberately private: nothing outside this
 * file may reuse it, matching `OrderPricingService`'s own established
 * precedent for DEC-035/036 — the server is the only pricing authority
 * (DEC-E-01) and a rate that can be imported elsewhere is a rate that can
 * end up computed twice, or in a client bundle.
 */
const COMMISSION_RATE_NUMERATOR = 8; // 8%, i.e. 8/100 — never a float literal.

/**
 * Computes the commission owed on one order's food subtotal.
 *
 * Integer-only arithmetic throughout (CON-003): `foodSubtotalSatang * 8` stays
 * an exact integer for every realistic order size, and the single
 * round-half-up division by `10000` (100 satang/baht × the rate's own /100)
 * is the only place a fraction could appear — it is immediately floored, so
 * no float ever represents a monetary value.
 *
 * `foodSubtotalSatang` must be the value already enforced non-negative by
 * `orders.subtotal_satang`'s own CHECK constraint
 * (`20260811000005_order_domain.sql`). A negative or non-integer input is
 * rejected rather than guessed at — the same "throw rather than guess"
 * convention `PaymentEventProcessingService.handleClaimedEvent` already
 * applies to an unrecognized event type.
 *
 * @throws if `foodSubtotalSatang` is not a non-negative integer.
 */
export function calculateFoodSubtotalCommissionSatang(foodSubtotalSatang: number): number {
  if (!Number.isInteger(foodSubtotalSatang) || foodSubtotalSatang < 0) {
    throw new Error(
      `food subtotal must be a non-negative integer satang amount, got ${String(foodSubtotalSatang)}`,
    );
  }

  // round_to_whole_baht(foodSubtotalSatang × 8%), entirely in integers:
  //   rawSatang = foodSubtotalSatang × 8 / 100
  //   commissionBaht = round_half_up(rawSatang / 100)
  //                  = floor((foodSubtotalSatang × 8 + 5000) / 10000)
  const commissionBaht = Math.floor((foodSubtotalSatang * COMMISSION_RATE_NUMERATOR + 5000) / 10000);

  return commissionBaht * 100;
}
