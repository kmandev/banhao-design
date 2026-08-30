import type { SupabaseClient } from '@supabase/supabase-js';
import type { RestaurantMembership } from '../domain/restaurantMembership';

/**
 * Raw row shape from the `restaurant_members` ⨝ `restaurants` read.
 * Kept separate from `RestaurantMembership` so a PostgREST column rename
 * only touches this file and its mapper, per the pattern
 * apps/driver/src/data already establishes.
 */
interface MembershipRow {
  restaurant_id: string;
  member_role: string;
  restaurants: { name: string; status: string } | null;
}

/**
 * The caller's own active restaurant memberships.
 *
 * `restaurant_members_select_member` (RLS) already scopes this to rows where
 * `is_restaurant_member(restaurant_id)` is true, which itself requires
 * `revoked_at is null` — a revoked membership is already invisible here. The
 * explicit `.is('revoked_at', null)` below is defense in depth, matching
 * CapabilitiesService.resolveMerchant()'s own explicit filter server-side
 * (apps/api/src/modules/users/capabilities.service.ts): never rely on RLS
 * being the only thing standing between a revoked member and a "yes".
 *
 * No caching — resolved fresh on every call, same posture as
 * CapabilitiesService's own "read now" comment (DEC-APP-004).
 */
export async function fetchOwnRestaurantMemberships(
  client: SupabaseClient,
): Promise<MembershipRow[]> {
  const { data, error } = await client
    .from('restaurant_members')
    .select('restaurant_id, member_role, restaurants ( name, status )')
    .is('revoked_at', null);

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MembershipRow[];
}

export function toRestaurantMembership(row: MembershipRow): RestaurantMembership | null {
  // A joined restaurant can be null if the row's FK target is unreadable
  // under RLS for some other reason; skip rather than render a nameless
  // restaurant a merchant could mistake for a real one.
  if (!row.restaurants) return null;

  return {
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurants.name,
    restaurantStatus: row.restaurants.status,
    memberRole: row.member_role as RestaurantMembership['memberRole'],
  };
}
