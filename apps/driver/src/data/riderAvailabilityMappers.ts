/**
 * Database row → domain mapper for the rider's availability row.
 *
 * `RiderAvailabilityRow` is exactly the projection
 * `riderAvailabilityQueries.ts` requests — `is_online`, `location_updated_at` —
 * and nothing wider. `rider_id` is absent for the same reason
 * `riderOfferMappers.ts` omits it: the RLS policy is what scopes the row, so a
 * client-side identity field is never read.
 *
 * Same two rules as every other mapper in this app: nothing is invented beyond
 * a column rename, and no money field exists in the row or the mapped shape.
 */

import type { RiderAvailability } from '../domain/riderAvailability';

/** The allowed columns of `public.rider_availability` for this read path. */
export interface RiderAvailabilityRow {
  is_online: boolean;
  location_updated_at: string | null;
}

export function toRiderAvailability(row: RiderAvailabilityRow): RiderAvailability {
  return {
    isOnline: row.is_online,
    locationRecordedAt: row.location_updated_at,
  };
}

/**
 * The state of a rider who has no `rider_availability` row yet.
 *
 * Written once, here, rather than at each call site: a missing row genuinely
 * means "offline, no position recorded" — that is what the column defaults
 * (`is_online default false`, `location_updated_at` null) would say the moment
 * `RiderLocationService` creates it. This is the one place in the app that
 * describes an absent row, and it describes it exactly as the schema would.
 */
export const NO_AVAILABILITY_ROW: RiderAvailability = {
  isOnline: false,
  locationRecordedAt: null,
};
