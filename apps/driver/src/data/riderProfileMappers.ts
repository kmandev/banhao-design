/**
 * Database row → domain mapper for the rider's own identity record.
 *
 * `RiderProfileRow` is exactly the allowed projection of `public.riders` for
 * this read path. Deliberately no `user_id` (the RLS policy is what scopes the
 * row — a client-side identity field is never read, the same discipline
 * `riderOfferMappers.ts` documents), no `rating_avg`/`rating_count`, no
 * `service_area_id`/`zone_id` (the geo domain is deferred), and no
 * `approved_by`/`approved_at`.
 *
 * Same two rules as the G6.3/G6.4 mappers: nothing here is invented beyond a
 * column rename, and no money field exists in the row or the mapped shape.
 */

import { RIDER_STATUSES, type RiderProfile, type RiderStatus } from '../domain/riderProfile';

/** The allowed columns of `public.riders` for this read path. */
export interface RiderProfileRow {
  id: string;
  full_name: string;
  status: string;
  vehicle_type: string | null;
  plate: string | null;
}

/**
 * An unrecognised `riders.status`.
 *
 * The column is CHECK-constrained, so this can only mean schema/code drift.
 * It is raised rather than defaulted: defaulting toward `APPROVED` would grant
 * work to a rider the server never approved, and defaulting away from it would
 * silently strand an approved rider. Neither is a decision a mapper may take.
 */
export class UnknownRiderStatusError extends Error {
  constructor(status: string) {
    super(`Unrecognised riders.status: ${status}`);
    this.name = 'UnknownRiderStatusError';
  }
}

function toRiderStatus(status: string): RiderStatus {
  const known = RIDER_STATUSES.find((candidate) => candidate === status);
  if (!known) throw new UnknownRiderStatusError(status);
  return known;
}

export function toRiderProfile(row: RiderProfileRow): RiderProfile {
  return {
    riderId: row.id,
    fullName: row.full_name,
    status: toRiderStatus(row.status),
    vehicleType: row.vehicle_type,
    plate: row.plate,
  };
}
