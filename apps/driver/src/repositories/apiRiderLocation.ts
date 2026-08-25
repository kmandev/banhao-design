/**
 * `POST /api/v1/rider/location`, consumed through the shared API client.
 *
 * This endpoint already existed (Phase G-2) and had no client until now. It is
 * the only way a rider's coordinates can reach the database: `last_lat` and
 * `last_lng` are outside the `authenticated` column grant, so the service-role
 * write inside `RiderLocationService` is the sole path, and
 * `rider_availability.location` — the generated column DEC-037's eligibility
 * filter tests — derives from that pair alone.
 *
 * ## What this module sends, and what it must never send
 *
 * The body is exactly `{ lat, lng }`. `riderLocationRequestSchema` is
 * `.strict()` server-side precisely so a client cannot smuggle a `riderId` (or
 * an `is_online`) into a request whose identity is supposed to come from the
 * verified JWT alone — the rider id is resolved from
 * `user.capabilities.rider.riderId` on every request (DEC-033 / DEC-APP-004)
 * and is the `WHERE` clause of the server's write.
 *
 * This module therefore sends no identity of any kind: no `riderId`, no
 * `userId`, and none of the columns outside the endpoint's own contract
 * (`active_delivery_count`, `blocked_reason`, `last_lat`, `last_lng`). The
 * shared client attaches the access token; that is the whole of the identity
 * on the wire.
 *
 * Same shape as `apps/customer/src/repositories/apiOrderCreation.ts`: this
 * **only translates**. It re-implements none of the server's rules.
 */

import type { ApiClient } from '@banhao/api-client';
import type { RiderLocationRequest, RiderLocationResponse } from '@banhao/validation';
import { apiClient as defaultClient, getAccessToken as defaultGetAccessToken } from '../lib/apiClient';
import type { DevicePosition } from '../lib/deviceLocation';

/** The rider's position could not be recorded. Retryable — the rider may try again. */
export class LocationReportFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationReportFailedError';
  }
}

/** There is no session, so the position is not sent at all. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('ยังไม่ได้เข้าสู่ระบบ');
    this.name = 'NotAuthenticatedError';
  }
}

export interface RiderLocationRepository {
  /**
   * Records the rider's latest position.
   *
   * Resolves with the server's own `locationUpdatedAt`, which is what makes
   * the rider dispatch-eligible under DEC-037. Rejects on any failure — a
   * position that did not reach the server must never be reported as recorded,
   * because the rider would then appear online while sitting outside the
   * candidate pool.
   */
  reportPosition(position: DevicePosition): Promise<RiderLocationResponse>;
}

export function createApiRiderLocationRepository(
  client: ApiClient = defaultClient,
  getAccessToken: () => Promise<string | null> = defaultGetAccessToken,
): RiderLocationRepository {
  return {
    async reportPosition(position: DevicePosition): Promise<RiderLocationResponse> {
      // Checked before the body is built, not after a 401 comes back. An
      // anonymous request would still put the rider's coordinates on the wire
      // for a call that cannot succeed — see `getAccessToken`'s note.
      const token = await getAccessToken();
      if (!token) throw new NotAuthenticatedError();

      // Destructured rather than spread: a spread would forward whatever the
      // caller happened to attach to the object, which is the exact shape of
      // mistake `.strict()` exists to catch on the far end. Two named fields
      // is the entire contract.
      const body: RiderLocationRequest = { lat: position.lat, lng: position.lng };

      try {
        return await client.request<RiderLocationResponse>('/api/v1/rider/location', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } catch (error) {
        throw new LocationReportFailedError(
          error instanceof Error ? error.message : 'ส่งตำแหน่งไม่สำเร็จ',
        );
      }
    },
  };
}
