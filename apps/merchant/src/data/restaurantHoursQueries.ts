import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseTimeOfDay, type DayOfWeek, type RestaurantHoursDay } from '@banhao/validation';

/**
 * The merchant's own weekly schedule — read directly from Supabase under
 * `restaurant_hours_select_member` (M-12 S1). No endpoint is needed for the
 * read; the save is the API's job.
 */

export interface HoursRow {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
}

export async function fetchRestaurantHours(
  client: SupabaseClient,
  restaurantId: string,
): Promise<RestaurantHoursDay[]> {
  const { data, error } = await client
    .from('restaurant_hours')
    .select('day_of_week, opens_at, closes_at')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week', { ascending: true })
    .order('opens_at', { ascending: true });

  if (error) throw new Error(error.message);

  return groupHoursByDay((data ?? []) as HoursRow[]);
}

/**
 * Flat rows to one entry per day that has any.
 *
 * A day with no rows produces no entry — the absence *is* the closed state,
 * and emitting an empty entry would quietly turn it back into a flag the
 * schema does not have. The form fills the seven-row grid itself.
 */
export function groupHoursByDay(rows: HoursRow[]): RestaurantHoursDay[] {
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
