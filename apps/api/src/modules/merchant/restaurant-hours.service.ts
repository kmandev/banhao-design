import { Injectable, Logger } from '@nestjs/common';
import {
  normaliseTimeOfDay,
  validateWeeklyHours,
  type DayOfWeek,
  type ReplaceRestaurantHoursInput,
  type RestaurantHoursResponse,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * M-12 Opening Hours — the weekly schedule write path.
 *
 * ## One request, one transaction, the whole week
 *
 * `restaurant_hours`'s own table comment fixes the edit strategy: the
 * application deletes and re-inserts a restaurant's rows rather than patching
 * them. M-12 §11 C-02 then makes atomicity a correctness requirement rather
 * than an optimisation — outside a transaction, a failure between the delete
 * and the insert leaves a restaurant with **no hours at all**, which the
 * derived open/closed reads as permanently closed.
 *
 * So this service does not issue a delete and an insert. It calls
 * `replace_restaurant_hours`, which does both inside one database transaction
 * (`20260901000002`). There is no partial-save path, because the model has no
 * partial save.
 *
 * ## Days
 *
 * `day_of_week` is 0 = Sunday … 6 = Saturday. A closed day is a day with no
 * rows — there is no `is_closed` column, and this service invents none
 * (M12-D04).
 *
 * ## Times
 *
 * `opens_at` / `closes_at` are `time` columns: wall-clock Asia/Bangkok, with
 * no timezone and no conversion anywhere in this path. What the merchant
 * typed is what is stored and what is returned. Nothing here constructs a
 * `Date`, so no server, browser or CI timezone can shift a schedule.
 */

interface HoursRow {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
}

@Injectable()
export class RestaurantHoursService {
  private readonly logger = new Logger(RestaurantHoursService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Replaces the whole week.
   *
   * Server-side validation runs the **same** `validateWeeklyHours` the merchant
   * form runs. That is deliberate reuse, not duplication: one implementation,
   * imported by both, so the two cannot disagree about what a valid week is.
   * The API never trusts that the client ran it — a request that skipped the
   * UI entirely is rejected here.
   *
   * Two of the seven rules — overlap and exact duplicate — have no database
   * constraint behind them (M-12 §11 C-03, M12-Q-02 open). Enforcing them here
   * is what makes them true of everything this API writes; it is still not a
   * guarantee about rows written by some other path, and the constraint
   * question stays open.
   */
  async replaceHours(
    restaurantId: string,
    input: ReplaceRestaurantHoursInput,
  ): Promise<RestaurantHoursResponse> {
    const issues = validateWeeklyHours(input.days);
    if (issues.length > 0) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'One or more opening-hour intervals are invalid',
        details: { intervals: issues },
      });
    }

    // Flattened to one row per interval, which is exactly how the table
    // stores them: a split shift is two rows sharing a `day_of_week`.
    const rows = input.days.flatMap((day) =>
      day.intervals.map((interval) => ({
        dayOfWeek: day.dayOfWeek,
        opensAt: interval.opensAt,
        closesAt: interval.closesAt,
      })),
    );

    const { data, error } = await this.supabase.admin.rpc('replace_restaurant_hours', {
      p_restaurant_id: restaurantId,
      p_hours: rows,
    });

    if (error) {
      this.logger.error(`Hours replace failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Opening hours update failed' });
    }

    // The function returns the stored week, so the response is what the
    // database now holds rather than an echo of the request. M-12 S4 requires
    // exactly this: "The saved week is re-read rather than assumed."
    return {
      restaurantId,
      days: groupByDay(Array.isArray(data) ? (data as HoursRow[]) : []),
    };
  }
}

/**
 * Groups flat rows into one entry per day, ascending, with each day's
 * intervals ordered by opening time.
 *
 * Only days that actually have intervals appear. A caller rendering seven rows
 * fills the gaps itself — the absence *is* the closed state, and inventing
 * seven entries here would blur that back into a flag.
 */
export function groupByDay(rows: HoursRow[]): RestaurantHoursResponse['days'] {
  const byDay = new Map<DayOfWeek, { opensAt: string; closesAt: string }[]>();

  for (const row of rows) {
    const dayOfWeek = row.day_of_week as DayOfWeek;
    const intervals = byDay.get(dayOfWeek) ?? [];
    intervals.push({
      opensAt: normaliseTimeOfDay(row.opens_at),
      closesAt: normaliseTimeOfDay(row.closes_at),
    });
    byDay.set(dayOfWeek, intervals);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayOfWeek, intervals]) => ({
      dayOfWeek,
      intervals: intervals.sort((a, b) => a.opensAt.localeCompare(b.opensAt)),
    }));
}
