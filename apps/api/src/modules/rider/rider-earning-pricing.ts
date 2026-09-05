/**
 * DEC-044 — the Phase 1 rider earning: a flat **1,200 satang (฿12) per
 * completed delivery**. No distance, base, or zone component; no surge or
 * peak-hour bonus; no minimum guarantee; no tips; no rider-side platform fee.
 * Deliberately private: nothing outside this file may reuse it, matching
 * `OrderPricingService`'s established precedent for DEC-035/036 and
 * `commission-pricing.ts`'s for DEC-043 — the server is the only pricing
 * authority (DEC-E-01), and a rate that can be imported elsewhere is a rate
 * that can end up computed twice, or in a client bundle.
 */
const RIDER_EARNING_SATANG = 1200;

/**
 * Resolves the rider earning amount that applies to a delivery completing
 * **right now**.
 *
 * ## The future-configuration seam
 *
 * DEC-044 records that this amount is intended to become Admin-configurable
 * later. This function is that seam: every caller resolves the amount
 * through here rather than the literal `1200`, so a future authoritative
 * configuration source can replace this function's body without touching any
 * call site. **No configuration table, API, or service exists yet** — DEC-044
 * explicitly does not authorize building one, and none is invented here.
 *
 * ## Why this alone does not violate historical stability
 *
 * This function returns the *current* effective amount — it is deliberately
 * NOT the source of truth for a delivery that has already completed. The
 * caller (`DeliveryCompletionService.claimCompletion`) calls this once, at
 * the moment of completion, and the result is written into
 * `deliveries.rider_earning_satang` in that same guarded UPDATE — an
 * immutable snapshot from that point on. A later call to this function
 * returning a different value (once a real configuration source exists)
 * changes what a *newly completing* delivery earns; it cannot and does not
 * change what an already-`DELIVERED` delivery earned, because nothing ever
 * re-reads this function for a delivery that already has a value.
 */
export function resolveRiderEarningSatang(): number {
  return RIDER_EARNING_SATANG;
}
