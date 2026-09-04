import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import type {
  RestaurantAvailabilityResponse,
  SetRestaurantAvailabilityInput,
} from '@banhao/validation';
import {
  fetchRestaurantAvailability,
  type RestaurantAvailabilityRow,
} from '../data/restaurantAvailabilityQueries';
import { apiClient as defaultApiClient } from '../lib/apiClient';

/**
 * M-13 Merchant Availability. Same read/write split as `merchantProfile.ts`
 * and `merchantHours.ts`: reads go client → Supabase directly under RLS,
 * writes go through the guarded NestJS API
 * (`RestaurantAvailabilityController`).
 */
export interface MerchantAvailabilityRepository {
  getAvailability(restaurantId: string): Promise<RestaurantAvailabilityRow>;
  setAvailability(
    restaurantId: string,
    input: SetRestaurantAvailabilityInput,
  ): Promise<RestaurantAvailabilityResponse>;
}

export function createMerchantAvailabilityRepository(
  client: SupabaseClient,
  api: ApiClient = defaultApiClient,
): MerchantAvailabilityRepository {
  return {
    getAvailability: (restaurantId) => fetchRestaurantAvailability(client, restaurantId),

    setAvailability: (restaurantId, input) =>
      api.request<RestaurantAvailabilityResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/availability`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),
  };
}
