import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The merchant's own restaurant profile — read directly from Supabase under
 * `restaurants_select_member` (M-10 §01, matching `restaurantHoursQueries.ts`'s
 * own "no read route" precedent for M-12). No endpoint is needed for the
 * read; the save is `RestaurantProfileController`'s job.
 */

export interface RestaurantProfileRow {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  phone: string | null;
  address_line: string | null;
  image_url: string | null;
  status: string;
  lat: number | null;
  lng: number | null;
  updated_at: string;
}

export async function fetchRestaurantProfile(
  client: SupabaseClient,
  restaurantId: string,
): Promise<RestaurantProfileRow> {
  const { data, error } = await client
    .from('restaurants')
    .select('id, name, description, cuisine, phone, address_line, image_url, status, lat, lng, updated_at')
    .eq('id', restaurantId)
    .single();

  if (error) throw new Error(error.message);
  return data as RestaurantProfileRow;
}
