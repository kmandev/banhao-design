/**
 * DEC-061 D-01: the Phase 1 merchant commission is **10% of the food
 * subtotal**, rounded to the nearest whole baht. This supersedes DEC-043's
 * rate only; DEC-043's base and D-02's rounding rule are preserved unchanged.
 * The base is the food subtotal only. Delivery fee, service fee and any
 * discount are excluded.
 *
 * This is the single canonical commission implementation (D-02). It runs
 * exactly once per order, at order creation (`OrderPricingService.
 * resolveOrderCommission`), and the result is frozen into
 * `order_commission_snapshots` (D-01 order-time snapshot). Payment
 * confirmation reads that stored amount and never calls this function, so a
 * later change to this rate can never alter an already-created order's
 * commission.
 *
 * Deliberately private: nothing outside this file may reuse the rate, because
 * the server is the only pricing authority (DEC-E-01) and a rate that can be
 * imported elsewhere is a rate that can end up computed twice, or in a client
 * bundle.
 */
const COMMISSION_RATE_NUMERATOR = 10; // 10%, i.e. 10/100 — never a float literal.

/**
 * Computes the commission owed on one order's food subtotal.
 *
 * Integer-only arithmetic throughout (CON-003): `foodSubtotalSatang * 10`
 * stays an exact integer for every realistic order size, and the single
 * round-half-up division by `10000` (100 satang/baht × the rate's own /100)
 * is the only place a fraction could appear. It is immediately floored, so no
 * float ever represents a monetary value.
 *
 * `foodSubtotalSatang` must be a non-negative integer, the same value
 * `orders.subtotal_satang`'s CHECK constraint enforces
 * (`20260811000005_order_domain.sql`). A negative or non-integer input is
 * rejected rather than guessed at. At order creation this makes commission
 * resolution fail closed before `create_order()` is ever called.
 *
 * @throws if `foodSubtotalSatang` is not a non-negative integer.
 */
export function calculateFoodSubtotalCommissionSatang(foodSubtotalSatang: number): number {
  if (!Number.isInteger(foodSubtotalSatang) || foodSubtotalSatang < 0) {
    throw new Error(
      `food subtotal must be a non-negative integer satang amount, got ${String(foodSubtotalSatang)}`,
    );
  }

  // round_to_whole_baht(foodSubtotalSatang × 10%), entirely in integers:
  //   rawSatang = foodSubtotalSatang × 10 / 100
  //   commissionBaht = round_half_up(rawSatang / 100)
  //                  = floor((foodSubtotalSatang × 10 + 5000) / 10000)
  const commissionBaht = Math.floor((foodSubtotalSatang * COMMISSION_RATE_NUMERATOR + 5000) / 10000);

  return commissionBaht * 100;
}
