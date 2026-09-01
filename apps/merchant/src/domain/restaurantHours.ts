import type { DayOfWeek, HoursInterval } from '@banhao/validation';

/**
 * M-12 Opening Hours domain.
 *
 * Thin on purpose: the contract types live in `@banhao/validation`
 * (`DayOfWeek`, `HoursInterval`, `RestaurantHoursDay`) because the API and the
 * merchant app must agree on them, and re-declaring them here would give the
 * same shape two homes. What this module adds is the merchant-side *form*
 * shape, which the wire contract deliberately does not have.
 */

/**
 * One day as the form holds it.
 *
 * `isOpen` exists here and nowhere in the database. A closed day is a day with
 * no rows (M12-D04) — but a merchant who toggles a day off by accident must
 * get their times back when they toggle it on again, so the form keeps them
 * while `isOpen` is false and simply contributes no rows at save. Losing them
 * on a tap would make the switch dangerous.
 */
export interface HoursDayDraft {
  dayOfWeek: DayOfWeek;
  isOpen: boolean;
  intervals: HoursInterval[];
}

/** All seven, always, in 0 = Sunday … 6 = Saturday order. */
export type WeeklyHoursDraft = HoursDayDraft[];
