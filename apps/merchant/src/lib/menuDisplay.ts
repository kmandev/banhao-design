import type { Satang } from '@banhao/types';
import type { DayOfWeek } from '@banhao/validation';
import type { MenuSection } from '../domain/menu';

/**
 * Presentation helpers for M-11 and M-12 — pure functions, no React, no data
 * access, so each one is testable on its own. The same shape
 * `orderBoardDisplay.ts` established.
 */

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

// ---------------------------------------------------------------------------
// Money — baht in, satang stored (M11-D05)
// ---------------------------------------------------------------------------

/** `6500` → `"65.00"`. The merchant unit; `฿` is rendered by the field, not typed. */
export function satangToBahtInput(satang: Satang): string {
  return (satang / 100).toFixed(2);
}

export type PriceParseResult =
  | { ok: true; satang: number }
  | { ok: false; reason: 'REQUIRED' | 'NOT_A_NUMBER' | 'NEGATIVE' | 'TOO_PRECISE' };

/**
 * Parses a baht string to integer satang, or says exactly why it cannot.
 *
 * Three separate refusals rather than one, because M-11 §05 gives each its own
 * message: an empty field, a negative price, and more precision than satang
 * can hold. A number is never silently rounded — a merchant who typed `65.555`
 * gets told, not given `65.56` they did not choose.
 *
 * `Math.round` on the final multiply is not a rounding decision: it repairs
 * binary floating point (`65.7 * 100 === 6569.999999999999`) after the
 * two-decimal check has already proven the value is exact in satang.
 */
export function parseBahtToSatang(input: string): PriceParseResult {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return { ok: false, reason: 'REQUIRED' };

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return { ok: false, reason: 'NOT_A_NUMBER' };
  if (trimmed.startsWith('-')) return { ok: false, reason: 'NEGATIVE' };

  const [, decimals = ''] = trimmed.split('.');
  if (decimals.length > 2) return { ok: false, reason: 'TOO_PRECISE' };

  const baht = Number(trimmed);
  if (!Number.isFinite(baht)) return { ok: false, reason: 'NOT_A_NUMBER' };

  return { ok: true, satang: Math.round(baht * 100) };
}

/** `1000` → `"+฿10.00"`, `-500` → `"−฿5.00"`, `0` → `"+฿0"`. */
export function formatPriceDelta(satang: number): string {
  if (satang === 0) return '+฿0';
  const sign = satang < 0 ? '−' : '+';
  return `${sign}฿${(Math.abs(satang) / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Menu overview counts
// ---------------------------------------------------------------------------

export interface MenuSummary {
  itemCount: number;
  unavailableCount: number;
}

export function summariseMenu(sections: MenuSection[]): MenuSummary {
  const items = sections.flatMap((section) => section.items);
  return {
    itemCount: items.length,
    unavailableCount: items.filter((item) => !item.isAvailable).length,
  };
}

// ---------------------------------------------------------------------------
// Today, in Asia/Bangkok
// ---------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, DayOfWeek> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Which `day_of_week` it is right now in Bangkok.
 *
 * Resolved through `Intl` in the shop's zone, **not** `Date.getDay()`: a
 * tablet with a wrong timezone would otherwise highlight the wrong row, and a
 * merchant reading the wrong day off this screen is the exact failure it
 * exists to prevent. DEC-E-03 already set this precedent for the order number.
 *
 * `Intl` rather than a fixed +07:00 offset for the reason
 * `apps/customer/src/lib/openingHours.ts` gives: Thailand has no DST today,
 * but hard-coding an offset is the kind of assumption that survives until it
 * does not.
 */
export function bangkokDayOfWeek(now: Date): DayOfWeek {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    weekday: 'short',
  })
    .formatToParts(now)
    .find((part) => part.type === 'weekday')?.value;

  return WEEKDAY_INDEX[weekday ?? 'Sun'] ?? 0;
}
