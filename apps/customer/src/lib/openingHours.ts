/**
 * Opening-hours derivation (Phase C / C-4).
 *
 * `isOpen` is not a column. It is derived from three things: the restaurant's
 * `restaurant_hours` rows, its `temporarily_closed_until` timestamp, and the
 * current time — evaluated in **Asia/Bangkok**, because that is where the shop
 * and the customer both are and where `opens_at`/`closes_at` were written.
 * Deriving it against the device's local zone would put a shop on the wrong
 * side of its own opening time for anyone travelling.
 *
 * Pure and clock-injectable: every function takes `now`, so the behaviour is
 * deterministic and unit-testable without mocking global time.
 *
 * ## Overnight windows are not representable
 *
 * The schema enforces `check (closes_at > opens_at)`, so a window like
 * 18:00–02:00 cannot be stored at all. This module therefore does **not**
 * implement wrap-past-midnight logic: doing so would invent support the
 * database cannot express, and would silently mis-handle the day boundary for
 * data that can never arrive. A shop trading past midnight needs a schema
 * decision first.
 */

import type { OpeningWindow } from '../domain/catalog';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/** Minutes since midnight, and the weekday, as observed in Bangkok. */
export interface BangkokMoment {
  /** 0 = Sunday … 6 = Saturday, matching `restaurant_hours.day_of_week`. */
  dayOfWeek: number;
  minutesSinceMidnight: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Projects an instant into Bangkok wall-clock terms.
 *
 * Uses `Intl` rather than a fixed +07:00 offset so the conversion stays correct
 * if the runtime's zone data ever changes; Thailand has no DST today, but
 * hard-coding an offset is the kind of assumption that survives until it does
 * not.
 */
export function toBangkokMoment(now: Date): BangkokMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const lookup = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const hour = Number.parseInt(lookup('hour'), 10);
  const minute = Number.parseInt(lookup('minute'), 10);
  const dayOfWeek = WEEKDAY_INDEX[lookup('weekday')] ?? 0;

  return {
    dayOfWeek,
    // `hour12: false` can render midnight as "24" in some ICU versions.
    minutesSinceMidnight: (hour % 24) * 60 + minute,
  };
}

/** Parses `HH:MM` or `HH:MM:SS` into minutes since midnight. */
export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) return null;

  const hours = Number.parseInt(match[1] as string, 10);
  const minutes = Number.parseInt(match[2] as string, 10);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/** `09:00:00` → `09:00`. Display form drops seconds, which are always zero. */
function formatTime(time: string): string {
  return time.slice(0, 5);
}

/** The windows that apply on the given Bangkok weekday, in opening order. */
export function windowsForDay(hours: OpeningWindow[], dayOfWeek: number): OpeningWindow[] {
  return hours
    .filter((window) => window.dayOfWeek === dayOfWeek)
    .sort((a, b) => (parseTimeToMinutes(a.opensAt) ?? 0) - (parseTimeToMinutes(b.opensAt) ?? 0));
}

/**
 * Whether a temporary closure is in force at `now`.
 *
 * A timestamp in the past means the closure has expired and is ignored; a
 * timestamp in the future means the shop is shut until then, regardless of its
 * regular hours.
 */
export function isTemporarilyClosed(
  temporarilyClosedUntil: string | null,
  now: Date,
): boolean {
  if (!temporarilyClosedUntil) return false;

  const until = Date.parse(temporarilyClosedUntil);
  if (Number.isNaN(until)) return false;

  return until > now.getTime();
}

/**
 * Whether the shop is taking orders right now.
 *
 * Open at `opens_at`, closed at `closes_at` — the interval is half-open
 * `[opens_at, closes_at)`. A customer who taps at exactly the closing minute is
 * treated as too late, which is the honest reading: the kitchen has stopped.
 */
export function isOpenNow(
  hours: OpeningWindow[],
  temporarilyClosedUntil: string | null,
  now: Date,
): boolean {
  if (isTemporarilyClosed(temporarilyClosedUntil, now)) return false;

  const moment = toBangkokMoment(now);

  return windowsForDay(hours, moment.dayOfWeek).some((window) => {
    const opens = parseTimeToMinutes(window.opensAt);
    const closes = parseTimeToMinutes(window.closesAt);
    if (opens === null || closes === null) return false;

    return moment.minutesSinceMidnight >= opens && moment.minutesSinceMidnight < closes;
  });
}

/**
 * Today's hours as a display string, e.g. `09:00 - 20:00`, or several windows
 * joined by `,` when a shop closes for the afternoon. Null when the shop does
 * not open at all today — the caller decides what to say about that, since the
 * wording is a UX-SPEC concern rather than a data one.
 */
export function formatTodayHours(hours: OpeningWindow[], now: Date): string | null {
  const windows = windowsForDay(hours, toBangkokMoment(now).dayOfWeek);
  if (windows.length === 0) return null;

  return windows
    .map((window) => `${formatTime(window.opensAt)} - ${formatTime(window.closesAt)}`)
    .join(', ');
}

/**
 * M-13. Whether a Paused restaurant should read as orderable.
 *
 * Deliberately not folded into `isOpenNow`: `isOpen` stays exactly what it
 * always was — hours plus `temporarily_closed_until` — because a Paused shop
 * is explicitly "not closed for the day" and must never share the ordinary
 * closed badge/copy a customer would read as "back at 10:00 tomorrow". Busy
 * changes nothing here; a Busy restaurant is fully orderable whenever it
 * would otherwise be open.
 */
function isOrderableGivenOpen(isOpen: boolean, availabilityMode: RestaurantAvailabilityMode): boolean {
  return isOpen && availabilityMode !== 'PAUSED';
}

/** M-13. `restaurants.availability_mode` — Normal/Busy/Paused, distinct from order state. */
export type RestaurantAvailabilityMode = 'NORMAL' | 'BUSY' | 'PAUSED';

/** Every derived value the shop mapper needs, in one call — the single availability derivation. */
export function deriveAvailability(
  hours: OpeningWindow[],
  temporarilyClosedUntil: string | null,
  availabilityMode: RestaurantAvailabilityMode,
  now: Date = new Date(),
): { isOpen: boolean; todayHours: string | null; isOrderable: boolean } {
  const isOpen = isOpenNow(hours, temporarilyClosedUntil, now);
  return {
    isOpen,
    todayHours: formatTodayHours(hours, now),
    isOrderable: isOrderableGivenOpen(isOpen, availabilityMode),
  };
}

/**
 * The next moment the regular weekly schedule opens, at or after `now`.
 *
 * Scans today first, then up to a full week forward, so a shop that is closed
 * right now but opens later today (a lunch/dinner split) is not skipped ahead
 * to tomorrow — and a shop open on only one day of the week, already passed
 * today, correctly wraps to that same day next week rather than reporting
 * nothing. Returns null only when the restaurant has no hours at all.
 *
 * Deliberately ignores `temporarily_closed_until`: a closure unrelated to the
 * weekly schedule (a burst pipe, a funeral) has no natural "next window" to
 * report, and UX-SPEC does not define copy for that case separately from the
 * generic closed state — inventing one here would be a guess, not a derivation.
 */
export function nextOpening(
  hours: OpeningWindow[],
  now: Date,
): { daysAhead: number; time: string } | null {
  if (hours.length === 0) return null;

  const moment = toBangkokMoment(now);

  // 0..7 inclusive: day 7 is today's own weekday one week out, which is what
  // lets a shop open on a single day per week wrap correctly once that day's
  // window has already passed this week.
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const dayOfWeek = (moment.dayOfWeek + daysAhead) % 7;

    for (const window of windowsForDay(hours, dayOfWeek)) {
      const opens = parseTimeToMinutes(window.opensAt);
      if (opens === null) continue;

      // Today, only a window that has not yet opened counts as "next" — one
      // already in progress is "open now", not something to announce as coming.
      // A week from now is a different day, so this check does not re-apply.
      if (daysAhead === 0 && opens <= moment.minutesSinceMidnight) continue;

      return { daysAhead, time: formatTime(window.opensAt) };
    }
  }

  return null;
}

const THAI_WEEKDAY_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * `เปิด 08:00 พรุ่งนี้` — the exact phrasing UX-SPEC § 13 uses for a closed
 * restaurant ("Restaurant closed | C-07 | `ร้านปิดอยู่ · เปิด 08:00 พรุ่งนี้`").
 * Null when there is nothing to report (no hours at all).
 */
export function formatNextOpening(hours: OpeningWindow[], now: Date): string | null {
  const next = nextOpening(hours, now);
  if (!next) return null;

  const targetWeekday = (toBangkokMoment(now).dayOfWeek + next.daysAhead) % 7;
  const day =
    next.daysAhead === 0
      ? 'วันนี้'
      : next.daysAhead === 1
        ? 'พรุ่งนี้'
        : `วัน${THAI_WEEKDAY_NAMES[targetWeekday]}`;

  return `เปิด ${next.time} ${day}`;
}
