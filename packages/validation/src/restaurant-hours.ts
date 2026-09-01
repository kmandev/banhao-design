import { z } from 'zod';

/**
 * M-12 Opening Hours — the weekly schedule contract.
 *
 * ## Days
 *
 * `day_of_week` is **0 = Sunday … 6 = Saturday**. This is not a new choice:
 * `apps/customer/src/lib/openingHours.ts`, `ShopScreen.tsx`'s weekday labels
 * and `supabase/seed-dev/catalog_dev_seed.sql` all already state it, and the
 * customer app's "open now" derivation has shipped against it. M-12's own
 * artifact left it as M12-Q-01 because the migration carries no comment; the
 * repository answers it, and this module is where that answer is written down
 * once for every layer.
 *
 * ## Times
 *
 * `opens_at` and `closes_at` are `time` columns — wall clock, Asia/Bangkok by
 * business convention, with no timezone attached and no conversion anywhere.
 * `HH:MM` on the wire; PostgREST renders the column as `HH:MM:SS`, which
 * {@link normaliseTimeOfDay} trims on the way in.
 *
 * ## Closed days
 *
 * There is no `is_closed` column. A closed day is a day with no intervals, and
 * that is the whole representation (M12-D04). The per-day switch in the UI is
 * an affordance over presence, not a field.
 */

/** 0 = Sunday … 6 = Saturday, matching `restaurant_hours.day_of_week`. */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const dayOfWeekSchema = z
  .number()
  .int()
  .min(0)
  .max(6) as z.ZodType<DayOfWeek, z.ZodTypeDef, number>;

/**
 * `HH:MM`, 24-hour, minutes 00–59 — M-12 §04's `รูปแบบเวลา` rule.
 *
 * Hours are 00–23 and not 24: `24:00` is a legal `time` value in Postgres but
 * would be a closing time no clock displays, and the design's own examples are
 * all within the day.
 */
export const TIME_OF_DAY_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const timeOfDaySchema = z.string().regex(TIME_OF_DAY_PATTERN, 'Time must be HH:MM, 24-hour');

/**
 * Trims a stored `HH:MM:SS` to the `HH:MM` the contract and the UI use.
 *
 * Seconds are never meaningful here — nothing in the product opens at
 * 08:00:30 — and carrying them into form state would make an untouched field
 * compare unequal to itself and mark the whole week dirty on load.
 */
export function normaliseTimeOfDay(value: string): string {
  return value.slice(0, 5);
}

/** Minutes since midnight, for ordering and overlap comparisons. */
export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export const hoursIntervalSchema = z
  .object({
    opensAt: timeOfDaySchema,
    closesAt: timeOfDaySchema,
  })
  .strict();

export type HoursInterval = z.infer<typeof hoursIntervalSchema>;

/**
 * `PUT /api/v1/merchant/restaurants/:restaurantId/hours` request body.
 *
 * The **whole week**, always. M12-D01: the table is replaced wholesale on
 * edit, so a per-day request would silently rewrite the other six days.
 *
 * A day with an empty `intervals` array is closed, and so is a day omitted
 * from the array entirely — both produce no rows. The UI sends all seven for
 * legibility; the contract accepts either.
 */
export const replaceRestaurantHoursSchema = z
  .object({
    days: z
      .array(
        z
          .object({
            dayOfWeek: dayOfWeekSchema,
            intervals: z.array(hoursIntervalSchema),
          })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .refine(
    (value) => new Set(value.days.map((day) => day.dayOfWeek)).size === value.days.length,
    { message: 'Each day of week may appear at most once', path: ['days'] },
  );

export type ReplaceRestaurantHoursInput = z.infer<typeof replaceRestaurantHoursSchema>;

export interface RestaurantHoursDay {
  dayOfWeek: DayOfWeek;
  intervals: HoursInterval[];
}

export interface RestaurantHoursResponse {
  restaurantId: string;
  days: RestaurantHoursDay[];
}

// ---------------------------------------------------------------------------
// The seven validation rules — M-12 §04
// ---------------------------------------------------------------------------

/**
 * Why these are codes and not Thai strings.
 *
 * DEC-APP-012 keeps user-facing copy in each app's own copy module, keyed by
 * code. A shared package that returned Thai prose would put merchant copy in
 * the API's dependency tree and give the same sentence two homes. The UI maps
 * these to the exact wording M-12 §04 specifies; the API returns them as
 * `details`, so a client that trusts the server still gets a precise reason.
 *
 * The first five are the database's own rules restated. `OVERLAPPING` and
 * `DUPLICATE` are **not** database rules — no unique or exclusion constraint
 * exists on `(restaurant_id, day_of_week)`, which M-12 §11 C-03 records and
 * M12-Q-02 leaves open. They are enforced here, in shared code, so the client
 * and the API agree; that is a guard, not a guarantee about data written by
 * some other path.
 */
export const HOURS_VALIDATION_CODES = [
  'MISSING_TIME',
  'INVALID_TIME_FORMAT',
  'EQUAL_TIMES',
  'OVERNIGHT_UNSUPPORTED',
  'CLOSES_BEFORE_OPENS',
  'OVERLAPPING_INTERVALS',
  'DUPLICATE_INTERVAL',
] as const;

export type HoursValidationCode = (typeof HOURS_VALIDATION_CODES)[number];

export interface HoursValidationIssue {
  dayOfWeek: DayOfWeek;
  /** Index into that day's `intervals` array. */
  intervalIndex: number;
  code: HoursValidationCode;
}

/** One day's intervals, as the form holds them — times may be empty while editing. */
export interface DraftHoursDay {
  dayOfWeek: DayOfWeek;
  intervals: { opensAt: string; closesAt: string }[];
}

/**
 * Every M-12 §04 rule, in one place, for one week.
 *
 * Returns every issue rather than the first, so the footer can say how many
 * intervals are wrong and the first invalid field can take focus.
 *
 * ## On `OVERNIGHT_UNSUPPORTED` versus `CLOSES_BEFORE_OPENS`
 *
 * Both are the same input condition — a closing time earlier than the opening
 * time — and no rule can tell a typo apart from a shop that genuinely trades
 * 18:00 to 02:00. M12-D06 settles which message to show: *"A shop that
 * genuinely trades 18:00–02:00 has not made an input error. The message says
 * the case is not yet supported rather than blaming the entry."* So a strictly
 * earlier closing time reports `OVERNIGHT_UNSUPPORTED`, and equal times — which
 * cannot be an overnight span — report `EQUAL_TIMES`. `CLOSES_BEFORE_OPENS`
 * remains in the vocabulary because it is what the database's own
 * `restaurant_hours_span_check` means, and the API reports it when a write is
 * rejected below this function.
 */
export function validateWeeklyHours(days: DraftHoursDay[]): HoursValidationIssue[] {
  const issues: HoursValidationIssue[] = [];

  for (const day of days) {
    const seen = new Map<string, number>();

    day.intervals.forEach((interval, intervalIndex) => {
      const issue = (code: HoursValidationCode): void => {
        issues.push({ dayOfWeek: day.dayOfWeek, intervalIndex, code });
      };

      const opens = interval.opensAt.trim();
      const closes = interval.closesAt.trim();

      // Rule 1 — both times required once a day is open.
      if (opens === '' || closes === '') {
        issue('MISSING_TIME');
        return;
      }

      // Rule 5 — HH:MM, 24-hour. Checked before any comparison, since
      // comparing unparseable strings would produce a second, misleading error.
      if (!TIME_OF_DAY_PATTERN.test(opens) || !TIME_OF_DAY_PATTERN.test(closes)) {
        issue('INVALID_TIME_FORMAT');
        return;
      }

      const opensMinutes = timeToMinutes(opens);
      const closesMinutes = timeToMinutes(closes);

      // Rules 2, 3 and 4 — one condition, two reportable meanings.
      if (closesMinutes === opensMinutes) {
        issue('EQUAL_TIMES');
        return;
      }
      if (closesMinutes < opensMinutes) {
        issue('OVERNIGHT_UNSUPPORTED');
        return;
      }

      // Rule 7 — an exact duplicate of an earlier interval on the same day.
      const key = `${opens}-${closes}`;
      if (seen.has(key)) {
        issue('DUPLICATE_INTERVAL');
        return;
      }
      seen.set(key, intervalIndex);

      // Rule 6 — overlap with any earlier valid interval on the same day.
      // Touching endpoints do not overlap: 07:00–13:00 and 13:00–20:00 is a
      // continuous day expressed as two intervals, which is legal.
      const overlaps = day.intervals.slice(0, intervalIndex).some((earlier) => {
        const earlierOpens = earlier.opensAt.trim();
        const earlierCloses = earlier.closesAt.trim();
        if (!TIME_OF_DAY_PATTERN.test(earlierOpens) || !TIME_OF_DAY_PATTERN.test(earlierCloses)) {
          return false;
        }
        const earlierStart = timeToMinutes(earlierOpens);
        const earlierEnd = timeToMinutes(earlierCloses);
        if (earlierEnd <= earlierStart) return false;
        return opensMinutes < earlierEnd && earlierStart < closesMinutes;
      });

      if (overlaps) {
        issue('OVERLAPPING_INTERVALS');
      }
    });
  }

  return issues;
}
