import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * M-13 — the merchant's own restaurant availability mode, read directly from
 * Supabase under `restaurants_select_member` (the same "no read route" split
 * `restaurantProfileQueries.ts` and `restaurantHoursQueries.ts` already
 * establish for M-10/M-12): the write goes through
 * `RestaurantAvailabilityController`, the read does not need an endpoint at
 * all — `availability_mode`/`busy_prep_minutes` are public, table-level-
 * granted columns, exactly like `status` already is on this same row.
 */

export interface RestaurantAvailabilityRow {
  id: string;
  availability_mode: 'NORMAL' | 'BUSY' | 'PAUSED';
  busy_prep_minutes: number | null;
  updated_at: string;
}

export async function fetchRestaurantAvailability(
  client: SupabaseClient,
  restaurantId: string,
): Promise<RestaurantAvailabilityRow> {
  const { data, error } = await client
    .from('restaurants')
    .select('id, availability_mode, busy_prep_minutes, updated_at')
    .eq('id', restaurantId)
    .single();

  if (error) throw new Error(error.message);
  return data as RestaurantAvailabilityRow;
}
