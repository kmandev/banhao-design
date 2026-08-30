/**
 * A merchant's active membership in one restaurant, as read from
 * `restaurant_members` joined to `restaurants` under RLS.
 *
 * This is deliberately NOT the API's `ActorCapabilities` /
 * `MerchantMembership` (apps/api/src/common/types.ts) — those are server-
 * internal shapes resolved by CapabilitiesService for the API's own guards
 * and are not exposed over any endpoint (DEC-APP-004 does not require it).
 * This client reads restaurant membership itself, straight from PostgREST
 * under RLS (DEC-APP-008), which is the same data the server-side check is
 * built from but is not the same object.
 */
export interface RestaurantMembership {
  restaurantId: string;
  restaurantName: string;
  restaurantStatus: string;
  memberRole: 'OWNER' | 'MANAGER' | 'STAFF';
}
