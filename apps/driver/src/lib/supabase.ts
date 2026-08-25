import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for the Driver App.
 *
 * SECURITY — read before changing anything here:
 *
 * This client uses the ANON key only. That key is safe to ship in a mobile
 * bundle because Row Level Security is what protects the data — for this app
 * specifically `riders_select_own`, `rider_availability_select_own` and
 * `rider_availability_update_own`
 * (supabase/migrations/20260811000011_rls_policies.sql).
 *
 * SUPABASE_SERVICE_ROLE_KEY must NEVER appear in this app. It bypasses RLS
 * entirely and belongs to apps/api alone. Anything shipped to a device is
 * readable by anyone holding the device — see AGENTS.md and
 * ai/DEVELOPMENT_RULES.md.
 *
 * Deliberately identical in posture to `apps/customer/src/lib/supabase.ts`:
 * one anon client per app, sessions in AsyncStorage, no URL detection. The two
 * apps are separate sessions on purpose — DEC-UX-010 rules out an in-app
 * capability switcher, so a person who is both customer and rider signs in
 * twice, in two apps.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Whether real credentials are configured.
 *
 * Unlike the Customer App there is no mock-data fallback here: every screen in
 * this app reads live rider state, and a rider who cannot reach Supabase is a
 * rider who cannot go online. Call sites use this to say so plainly rather
 * than to substitute fixtures.
 */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

export const supabase = createClient(
  // Placeholders keep createClient from throwing when unconfigured; guarded by
  // isSupabaseConfigured at the call sites.
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Sessions persist across launches so a rider isn't asked to re-verify
      // by OTP every time they open the app mid-shift.
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL bar for OAuth redirects to land in.
      detectSessionInUrl: false,
    },
  },
);
