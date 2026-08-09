import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for the Customer App.
 *
 * SECURITY — read before changing anything here:
 *
 * This client uses the ANON key only. That key is safe to ship in a mobile
 * bundle because Row Level Security is what protects the data (see
 * supabase/migrations/20260809000003_harden_profiles_rls.sql).
 *
 * SUPABASE_SERVICE_ROLE_KEY must NEVER appear in this app. It bypasses RLS
 * entirely and belongs to apps/api alone. Anything shipped to a device is
 * readable by anyone holding the device — see AGENTS.md and
 * ai/DEVELOPMENT_RULES.md.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Whether real credentials are configured. When false the app still runs on
 * mock data — useful for UI work and for tests — but auth calls will fail.
 */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

export const supabase = createClient(
  // Placeholders keep createClient from throwing when unconfigured; guarded by
  // isSupabaseConfigured at the call sites.
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      // Sessions persist across launches so a signed-in customer isn't asked
      // to re-verify by OTP every time they open the app.
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // React Native has no URL bar for OAuth redirects to land in.
      detectSessionInUrl: false,
    },
  },
);
