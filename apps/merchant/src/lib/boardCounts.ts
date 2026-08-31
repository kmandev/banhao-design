/**
 * Board-level counts for the header chrome (M-03 arrival alerting) — design
 * `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html` §01/§02: the
 * `ออเดอร์วันนี้ N` header badge and the tab-title waiting count.
 *
 * Both are derived purely from `useOrderBoard`'s already-restaurant-scoped
 * `orders` snapshot — no new query, no new endpoint. `fetchRestaurantOrders`
 * (`../data/orderQueries.ts`) is unbounded (every order the restaurant has
 * ever had, not just today's or the board's three active columns), which is
 * exactly what makes a client-side "today" filter here correct: the data
 * needed to answer "how many orders came in today" is already present in
 * every fetch, it is simply not pre-filtered by the repository.
 */

import type { MerchantOrderSummary } from '../domain/order';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/**
 * `YYYY-MM-DD` in Asia/Bangkok. `Intl.DateTimeFormat` with an explicit
 * `timeZone`, not manual `+7` arithmetic — the same technique
 * `orderBoardDisplay.ts`'s `formatClockTime` and
 * `apps/customer/src/lib/orderDisplay.ts`'s `bangkokDateParts` already use,
 * so this does not introduce a second way of reading a Bangkok wall-clock
 * date. `null` for an unparseable instant.
 */
function bangkokDateKey(ms: number): string | null {
  if (Number.isNaN(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));

  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Whether two instants fall on the same Bangkok calendar day. Deliberately
 * not a UTC date-string comparison — Buntharik is UTC+7, so an instant close
 * to midnight can be "today" in one zone and "tomorrow"/"yesterday" in the
 * other, and the merchant's "today" is always the Bangkok one.
 */
export function isBangkokSameDay(aMs: number, bMs: number): boolean {
  const a = bangkokDateKey(aMs);
  const b = bangkokDateKey(bMs);
  return a !== null && a === b;
}

/**
 * `ออเดอร์วันนี้ N` — every order in `orders` placed on the current Bangkok
 * calendar day, in any state. This is a daily total, not a board-column
 * count: it deliberately includes orders that have already left the board
 * (`DELIVERED`, `CANCELLED`, …), matching the design's own header badge,
 * which sits above and separate from the three column headers' own counts.
 */
export function countTodayOrders(orders: readonly MerchantOrderSummary[], nowMs: number): number {
  let count = 0;
  for (const order of orders) {
    const placedAtMs = Date.parse(order.placedAt);
    if (!Number.isNaN(placedAtMs) && isBangkokSameDay(placedAtMs, nowMs)) count += 1;
  }
  return count;
}

/**
 * The tab-title / arrival-alert waiting count — orders still in `PAID`,
 * awaiting the merchant's accept/reject decision. Intentionally the same
 * membership `boardColumnForState` assigns to the NEW column (including an
 * expired-but-still-`PAID` card, which still needs `ติดต่อผู้ดูแลระบบ`
 * attention and has not left the board) — this does not introduce a second,
 * narrower definition of "waiting" than the column the merchant is already
 * looking at.
 */
export function countWaitingOrders(orders: readonly MerchantOrderSummary[]): number {
  let count = 0;
  for (const order of orders) {
    if (order.state === 'PAID') count += 1;
  }
  return count;
}
