/**
 * Whether a restaurant is inside its opening hours at a given instant.
 *
 * `docs/BUSINESS_RULES.md`: "Restaurant opening hours govern whether orders
 * may be placed" — `ACCEPTED`. The customer app has always derived this for
 * display (`apps/customer/src/lib/openingHours.ts`); this is the same rule in a
 * form the API can enforce, so a cart filled while the shop was open cannot be
 * checked out after it closes.
 *
 * The rule, identical to the customer app's `isOpenNow`:
 *
 * - evaluated in **Asia/Bangkok** wall-clock time, where `opens_at`/`closes_at`
 *   were written;
 * - `day_of_week` is **0 = Sunday … 6 = Saturday**;
 * - each window is half-open `[opens_at, closes_at)` — the closing minute is
 *   already closed;
 * - several windows on one day (a lunch/dinner split) are each honoured;
 * - a day with no window is closed, and so is a restaurant with no hours at all;
 * - a `temporarily_closed_until` in the future closes the shop regardless.
 *
 * Overnight windows are not handled because the schema cannot store one
 * (`check (closes_at > opens_at)`).
 *
 * What this deliberately does **not** do: the order cutoff of "closing time
 * minus preparation time" is BQ-007 and only `PROPOSED`, so an order is
 * accepted up to the closing minute itself.
 *
 * Pure and clock-injected, so it is testable without mocking time.
 */

export interface OpeningWindowRow {
  /** 0 = Sunday … 6 = Saturday. */
  day_of_week: number;
  /** `HH:MM` or `HH:MM:SS`. */
  opens_at: string;
  closes_at: string;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function bangkokMoment(now: Date): { dayOfWeek: number; minutes: number } | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';

  const dayOfWeek = WEEKDAY_INDEX[part('weekday')];
  const hour = Number.parseInt(part('hour'), 10);
  const minute = Number.parseInt(part('minute'), 10);
  if (dayOfWeek === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return null;

  // `hour12: false` can render midnight as "24" in some ICU versions.
  return { dayOfWeek, minutes: (hour % 24) * 60 + minute };
}

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) return null;
  const hours = Number.parseInt(match[1] as string, 10);
  const minutes = Number.parseInt(match[2] as string, 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * True only when `now` falls inside one of today's windows and no temporary
 * closure is in force. Anything unreadable (a malformed time, an invalid
 * closure timestamp's absence of meaning) resolves toward **closed** for that
 * window, never toward open.
 */
export function isRestaurantOpenAt(
  hours: readonly OpeningWindowRow[],
  temporarilyClosedUntil: string | null,
  now: Date,
): boolean {
  if (temporarilyClosedUntil) {
    const until = Date.parse(temporarilyClosedUntil);
    if (!Number.isNaN(until) && until > now.getTime()) return false;
  }

  const moment = bangkokMoment(now);
  if (!moment) return false;

  return hours.some((window) => {
    if (window.day_of_week !== moment.dayOfWeek) return false;
    const opens = toMinutes(window.opens_at);
    const closes = toMinutes(window.closes_at);
    if (opens === null || closes === null) return false;
    return moment.minutes >= opens && moment.minutes < closes;
  });
}
