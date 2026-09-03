import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for the Admin app — **authentication only**.
 *
 * SECURITY — read before changing anything here:
 *
 * This client uses the ANON key only. `SUPABASE_SERVICE_ROLE_KEY` must never
 * appear in this app: it bypasses RLS entirely and belongs to `apps/api` alone.
 *
 * Unlike the merchant and driver apps, this one performs **no data reads
 * through Supabase at all**. Every operator screen goes through a named
 * endpoint under `/api/v1/admin/` (DEC-APP-008, and the Admin design package's
 * own DO NOT BUILD list: "Any direct Supabase read from the admin app"). The
 * only thing this client does is hold the phone-OTP session whose access token
 * the API then verifies. If a screen here ever needs `supabase.from(...)`, that
 * is an architecture decision, not a convenience.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Whether real credentials are configured. Call sites fail loudly rather than fabricate a session. */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
