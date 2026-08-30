import { createApiClient, ApiClientError } from '@banhao/api-client';
import { supabase } from './supabase';

/**
 * The BANHAO API client for the Merchant App.
 *
 * `@banhao/api-client` is the shared client all four apps use; this module
 * supplies only the two things that differ per app — the base URL, and how
 * this app holds its access token. Mirrors apps/driver/src/lib/apiClient.ts.
 *
 * Nothing in M-1 calls a write endpoint yet (accept/prepare/ready are M-2+),
 * but the client is wired up now so those phases plug into an existing seam
 * rather than inventing one under time pressure.
 *
 * The access token is read from the live Supabase session on every request
 * rather than captured once, so a token refreshed in the background is picked
 * up without rebuilding the client.
 */

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const apiClient = createApiClient({
  baseUrl: apiUrl || 'http://localhost:3000',
  getAccessToken,
});

export { ApiClientError };
