import { createApiClient, ApiClientError } from '@banhao/api-client';
import { supabase } from './supabase';

/**
 * The BANHAO API client for the Admin app.
 *
 * Mirrors `apps/merchant/src/lib/apiClient.ts`: the shared client, plus the two
 * things that differ per app — the base URL and how the token is held. The
 * token is read from the live session on every request, so a background refresh
 * is picked up without rebuilding the client.
 *
 * This is the app's **only** data path. See `lib/supabase.ts` for why.
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
