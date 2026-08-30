/**
 * Supabase-backed restaurant membership repository — M-1's authorization
 * read path (DEC-APP-004 / DEC-033).
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * apps/driver/src/repositories/riderProfile.ts. There is no NestJS endpoint
 * for this and none should be added: `restaurant_members_select_member` and
 * `restaurants_select_member` already scope the rows to this caller's own
 * active memberships.
 *
 * ## What this repository must never do
 *
 * It must never fabricate a membership. An empty array means the signed-in
 * user has no active restaurant_members row — that is a legitimate answer,
 * not an error, and the caller must render "no restaurant access" rather
 * than treat it as still-loading or retry forever.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RestaurantMembership } from '../domain/restaurantMembership';
import { fetchOwnRestaurantMemberships, toRestaurantMembership } from '../data/restaurantMembershipQueries';

export interface MerchantRestaurantRepository {
  /** The caller's own active restaurant memberships. May be empty. */
  listOwnMemberships(): Promise<RestaurantMembership[]>;
}

export function createMerchantRestaurantRepository(
  client: SupabaseClient,
): MerchantRestaurantRepository {
  return {
    listOwnMemberships: async () => {
      const rows = await fetchOwnRestaurantMemberships(client);
      return rows
        .map(toRestaurantMembership)
        .filter((m): m is RestaurantMembership => m !== null);
    },
  };
}
