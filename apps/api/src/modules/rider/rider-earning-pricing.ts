import { computeRiderEarningSatang } from '@banhao/validation';

/**
 * DEC-071 (DEC-061 D-05/D-06) — the rider's earning for a completed delivery:
 * 80% of that order's own delivery fee, rounded half-up to the satang, never
 * below ฿12. Replaces DEC-044's flat ฿12 for every delivery that completes from
 * now on; a legacy ฿10 order still earns exactly ฿12 (80% of ฿10 is ฿8, the
 * floor lifts it), so nothing changes for orders created before DEC-071.
 *
 * Called once per delivery, at completion, and snapshotted into
 * `deliveries.rider_earning_satang` in the same statement as `DELIVERED`.
 */
export function resolveRiderEarningSatang(orderDeliveryFeeSatang: number): number {
  if (!Number.isSafeInteger(orderDeliveryFeeSatang) || orderDeliveryFeeSatang < 0) {
    throw new Error(`delivery fee must be a non-negative integer satang amount, got ${String(orderDeliveryFeeSatang)}`);
  }
  return computeRiderEarningSatang(orderDeliveryFeeSatang);
}

/**
 * The second line of a delivery's rider-earning ledger group: what the
 * difference between the order's delivery fee and the rider's earning means.
 *
 * - earning > fee — only a legacy ฿10 order (DEC-045): BANHAO covers the
 *   shortfall, `PLATFORM_WRITE_OFF +(earning − fee)` — exactly the old +200.
 * - fee > earning — every order under DEC-071 (fee ≥ ฿15): the remainder is
 *   BANHAO's delivery margin, `PLATFORM_REVENUE +(fee − earning)`, the same
 *   account and sign the service fee uses (DEC-047).
 * - equal — nothing to post. Under DEC-071 this cannot happen (a ฿15 fee earns
 *   ฿12 and leaves ฿3); it is handled rather than assumed away.
 */
export function resolveDeliveryMarginEntry(
  orderDeliveryFeeSatang: number,
  riderEarningSatang: number,
): { account: 'PLATFORM_WRITE_OFF' | 'PLATFORM_REVENUE'; amountSatang: number } | null {
  if (riderEarningSatang > orderDeliveryFeeSatang) {
    return { account: 'PLATFORM_WRITE_OFF', amountSatang: riderEarningSatang - orderDeliveryFeeSatang };
  }
  if (orderDeliveryFeeSatang > riderEarningSatang) {
    return { account: 'PLATFORM_REVENUE', amountSatang: orderDeliveryFeeSatang - riderEarningSatang };
  }
  return null;
}
