import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import type { ReplaceRestaurantHoursInput, RestaurantHoursDay, RestaurantHoursResponse } from '@banhao/validation';
import { fetchRestaurantHours } from '../data/restaurantHoursQueries';
import { apiClient as defaultApiClient } from '../lib/apiClient';

/**
 * The M-12 repository. Same read/write split as `merchantMenu.ts`.
 *
 * `saveHours` takes and returns the **whole week**. There is no per-day call
 * and there must not be one: the underlying write replaces the table's rows
 * for the restaurant, so a per-day request would silently rewrite the other
 * six days (M12-D01).
 */
export interface MerchantHoursRepository {
  /** Only days that have intervals appear — a missing day is a closed day. */
  listHours(restaurantId: string): Promise<RestaurantHoursDay[]>;

  /** Returns the week the server re-read after saving, not an echo of the request. */
  saveHours(
    restaurantId: string,
    input: ReplaceRestaurantHoursInput,
  ): Promise<RestaurantHoursResponse>;
}

export function createMerchantHoursRepository(
  client: SupabaseClient,
  api: ApiClient = defaultApiClient,
): MerchantHoursRepository {
  return {
    listHours: (restaurantId) => fetchRestaurantHours(client, restaurantId),
    saveHours: (restaurantId, input) =>
      api.request<RestaurantHoursResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/hours`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),
  };
}
