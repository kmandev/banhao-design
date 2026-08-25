import { createApiClient, ApiClientError } from '@banhao/api-client';
import { supabase } from './supabase';

/**
 * The BANHAO API client for the Driver App.
 *
 * `@banhao/api-client` is the shared client all four apps use; this module
 * supplies only the two things that differ per app — the base URL, and how
 * this app holds its access token.
 *
 * ## Why the API at all, when availability is written straight to Supabase
 *
 * DEC-APP-008 splits the two: clients **read** domain data straight from
 * PostgREST under RLS, and clients **write** exclusively through the NestJS
 * API. `rider_availability.is_online` is the documented exception — the
 * deployed schema grants `update (is_online)` to `authenticated` and
 * `docs/DATABASE_DESIGN.md` §18 records it as one of only three direct client
 * write surfaces. Coordinates are **not** in that grant: `last_lat`/`last_lng`
 * are writable by the service role alone, which is exactly why
 * `POST /api/v1/rider/location` exists and why this client does.
 *
 * The access token is read from the live Supabase session on every request
 * rather than captured once, so a token refreshed in the background is picked
 * up without rebuilding the client.
 */

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

/**
 * The current access token, or `null` when signed out.
 *
 * Read from the live Supabase session on every call rather than captured once,
 * so a token refreshed in the background is picked up without rebuilding
 * anything. Exported because `apiRiderLocation.ts` needs it as a
 * **precondition**, not merely as a header: a signed-out app must not transmit
 * a rider's coordinates at all, rather than send them and collect a 401. With
 * Q-012 (PDPA lawful basis) still `OPEN`, a position that cannot possibly be
 * recorded is one that should never leave the device.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const apiClient = createApiClient({
  // There is no valid degraded mode for a location write: a rider whose
  // position never reached the server is not dispatchable (DEC-037), so an
  // unset EXPO_PUBLIC_API_URL must fail loudly at the call site rather than
  // quietly appear to work. It falls through to this placeholder, `fetch`
  // fails against it, and `apiRiderLocation.ts` surfaces that as a retryable
  // failure — the same state as an unreachable server.
  baseUrl: apiUrl || 'http://localhost:3000',
  getAccessToken,
});

export { ApiClientError };
