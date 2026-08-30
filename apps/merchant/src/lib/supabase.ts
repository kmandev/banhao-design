import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for the Merchant App.
 *
 * SECURITY — read before changing anything here:
 *
 * This client uses the ANON key only. That key is safe to ship in a browser
 * bundle because Row Level Security is what protects the data — for this app
 * specifically `restaurants_select_member` and `restaurant_members_select_member`
 * (supabase/migrations/20260811000011_rls_policies.sql), both gated by the
 * `is_restaurant_member()` function (DEC-033).
 *
 * SUPABASE_SERVICE_ROLE_KEY must NEVER appear in this app. It bypasses RLS
 * entirely and belongs to apps/api alone. Anything shipped to a browser is
 * readable by anyone who opens devtools — see AGENTS.md and
 * ai/DEVELOPMENT_RULES.md.
 *
 * Deliberately identical in posture to apps/driver/src/lib/supabase.ts: one
 * anon client per app, sessions persisted, no mock-data fallback — every
 * screen in this app reads live merchant state.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Whether real credentials are configured. Call sites use this to fail
 * loudly rather than silently proceed — there is no mock merchant, no mock
 * restaurant membership, and a fabricated session is forbidden outright.
 */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

export const supabase = createClient(
  // Placeholders keep createClient from throwing when unconfigured; guarded by
  // isSupabaseConfigured at the call sites.
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Sessions persist across reloads/tabs so a signed-in merchant isn't
      // asked to re-verify by OTP on every visit. localStorage is the
      // supabase-js default storage on web and is what we want here — the
      // browser tab has no secure-enclave equivalent to Expo's AsyncStorage
      // wrapper, but the same anon-key-plus-RLS posture applies regardless of
      // where the session token sits.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
