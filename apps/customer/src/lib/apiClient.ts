import { createApiClient, ApiClientError } from '@banhao/api-client';
import { supabase } from './supabase';

/**
 * The BANHAO API client for the Customer App.
 *
 * `@banhao/api-client` was already a declared dependency of this app and is the
 * shared client all four apps use — this module only supplies the two things
 * that differ per app: the base URL, and how this app holds its access token.
 * No new networking layer is introduced.
 *
 * ## Why the API at all, when catalog and cart read from Supabase directly
 *
 * DEC-APP-008 splits the two: clients **read** domain data straight from
 * PostgREST under RLS, and clients **write** exclusively through the NestJS
 * API. Cart CRUD is the documented exception (a cart is not financial data), so
 * it stays on Supabase. `POST /cart/validate` is not cart CRUD — it is the
 * server re-pricing against the live catalog, and its answer must come from the
 * trusted writer, not from anything the device computed. That is why this
 * client exists and why the cart still does not use it for its own writes.
 *
 * The access token is read from the live Supabase session on every request
 * rather than captured once, so a token refreshed in the background is picked
 * up without rebuilding the client.
 */

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

export const apiClient = createApiClient({
  // No call site branches on whether a URL was configured — unlike Supabase
  // (which the app still runs against with mock data when unset), there is no
  // valid degraded mode for cart validation. An empty EXPO_PUBLIC_API_URL
  // falls through to this placeholder, `fetch` then fails against it, and
  // `apiCartValidation.ts` rethrows anything that is not one of the two named
  // conflict codes — so a missing URL surfaces as the same system-error state
  // as an unreachable server, and checkout does not proceed either way.
  baseUrl: apiUrl || 'http://localhost:3000',
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

export { ApiClientError };
