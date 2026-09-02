import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import type { RestaurantProfileResponse, UpdateRestaurantProfileInput } from '@banhao/validation';
import { fetchRestaurantProfile, type RestaurantProfileRow } from '../data/restaurantProfileQueries';
import { apiClient as defaultApiClient } from '../lib/apiClient';

/**
 * The M-10 repository. Same read/write split as `merchantHours.ts` and
 * `merchantMenu.ts`: reads go client → Supabase directly under RLS
 * (`restaurants_select_member`), writes go through the guarded NestJS API.
 *
 * The cover-photo upload is the two calls `RestaurantCoverController` already
 * exposes (M10-D01) — `requestCoverUpload` then `completeCoverUpload` — no new
 * upload mechanism, reused exactly as M-11's own artifact left it.
 */
export interface MerchantProfileRepository {
  getProfile(restaurantId: string): Promise<RestaurantProfileRow>;
  saveProfile(
    restaurantId: string,
    input: UpdateRestaurantProfileInput,
  ): Promise<RestaurantProfileResponse>;
  requestCoverUpload(
    restaurantId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }>;
  completeCoverUpload(restaurantId: string, objectKey: string): Promise<{ imageUrl: string }>;
}

export function createMerchantProfileRepository(
  client: SupabaseClient,
  api: ApiClient = defaultApiClient,
): MerchantProfileRepository {
  return {
    getProfile: (restaurantId) => fetchRestaurantProfile(client, restaurantId),

    saveProfile: (restaurantId, input) =>
      api.request<RestaurantProfileResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/profile`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),

    requestCoverUpload: (restaurantId, contentType) =>
      api.request<{ uploadUrl: string; objectKey: string }>(
        `/api/v1/merchant/restaurants/${restaurantId}/cover/upload-url`,
        { method: 'POST', body: JSON.stringify({ contentType }) },
      ),

    completeCoverUpload: (restaurantId, objectKey) =>
      api.request<{ imageUrl: string }>(
        `/api/v1/merchant/restaurants/${restaurantId}/cover/complete`,
        { method: 'POST', body: JSON.stringify({ objectKey }) },
      ),
  };
}
