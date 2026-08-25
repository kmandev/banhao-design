/**
 * Supabase-backed availability repository — the rider's own online flag
 * (Phase G, DEC-037).
 *
 * Read and write both go client → Supabase directly under RLS. The write is
 * the documented exception to DEC-APP-008's "writes go through the API":
 * `docs/DATABASE_DESIGN.md` §18 lists `rider_availability` as one of three
 * tables with a direct client write surface, and the deployed grant restricts
 * that surface to `is_online` alone. Adding a NestJS endpoint for it would
 * duplicate a path the schema already sanctions.
 *
 * **Coordinates are not part of this repository.** They are outside the column
 * grant and reach the database only through `POST /api/v1/rider/location` —
 * see `apiRiderLocation.ts`. Sequencing the two (position first, flag second)
 * is `useRiderAvailability`'s job, not this file's.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderAvailability } from '../domain/riderAvailability';
import { fetchOwnAvailability, updateOwnOnlineFlag } from '../data/riderAvailabilityQueries';
import { NO_AVAILABILITY_ROW, toRiderAvailability } from '../data/riderAvailabilityMappers';

export interface RiderAvailabilityRepository {
  /**
   * The rider's own availability as the server currently holds it.
   *
   * A rider with no row reads as offline with no recorded position — the same
   * "no row is not a failure" discipline `RiderOrderViewRepository` documents
   * for `null`, except here the absent row has a well-defined meaning the
   * schema's own column defaults already state.
   */
  getOwnAvailability(): Promise<RiderAvailability>;

  /**
   * Sets the online flag and returns the state the **server** ended up in.
   *
   * Never returns the value it was asked to write. The guarded UPDATE can
   * legitimately match nothing — the row was already in the target state, or
   * the rider has no row yet — and only a re-read can tell those apart. A
   * toggle that did not take effect throws rather than reporting success,
   * because a rider shown as online who is not in the dispatch pool is the one
   * failure this screen exists to prevent.
   */
  setOnline(isOnline: boolean): Promise<RiderAvailability>;
}

/** The rider's availability row does not exist, so the flag has nothing to set. */
export class AvailabilityRowMissingError extends Error {
  constructor() {
    super('ยังไม่มีข้อมูลสถานะไรเดอร์ — ต้องส่งตำแหน่งก่อนจึงจะเปิดรับงานได้');
    this.name = 'AvailabilityRowMissingError';
  }
}

/** The write was accepted but the server did not end up in the requested state. */
export class AvailabilityNotAppliedError extends Error {
  constructor() {
    super('เปลี่ยนสถานะรับงานไม่สำเร็จ');
    this.name = 'AvailabilityNotAppliedError';
  }
}

export function createRiderAvailabilityRepository(
  client: SupabaseClient,
): RiderAvailabilityRepository {
  async function read(): Promise<RiderAvailability> {
    const row = await fetchOwnAvailability(client);
    return row ? toRiderAvailability(row) : NO_AVAILABILITY_ROW;
  }

  return {
    getOwnAvailability: read,

    setOnline: async (isOnline: boolean) => {
      const updated = await updateOwnOnlineFlag(client, isOnline);
      if (updated) return toRiderAvailability(updated);

      // The guard matched nothing. Re-read to find out which of the two
      // reasons applies, rather than assuming the friendlier one.
      const current = await fetchOwnAvailability(client);
      if (!current) throw new AvailabilityRowMissingError();

      const state = toRiderAvailability(current);
      if (state.isOnline !== isOnline) throw new AvailabilityNotAppliedError();

      // Already in the requested state — an idempotent no-op, not a failure.
      return state;
    },
  };
}
