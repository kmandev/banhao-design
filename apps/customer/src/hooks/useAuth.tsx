import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Role } from '@banhao/types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

export interface CustomerProfile {
  id: string;
  role: Role;
  phone: string | null;
  displayName: string | null;
}

interface AuthState {
  /** True until the persisted session has been read — screen 01 waits on this. */
  initialising: boolean;
  session: Session | null;
  profile: CustomerProfile | null;
  profileError: string | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

interface ProfileRow {
  id: string;
  role: Role;
  phone: string | null;
  display_name: string | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initialising, setInitialising] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    // RLS restricts this to the caller's own row — the query cannot return
    // another user's profile even if the filter were wrong.
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, phone, display_name')
      .eq('id', userId)
      .maybeSingle<ProfileRow>();

    if (error) {
      setProfileError(error.message);
      setProfile(null);
      return;
    }

    setProfileError(null);
    setProfile(
      data
        ? {
            id: data.id,
            role: data.role,
            phone: data.phone,
            displayName: data.display_name,
          }
        : null,
    );
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitialising(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user.id) void loadProfile(data.session.user.id);
      setInitialising(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user.id) {
        void loadProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const requestOtp = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw new Error(error.message);
  }, []);

  /**
   * Only display_name is writable. Column privileges and a trigger reject any
   * attempt to change role, id, or phone from a client — see
   * supabase/migrations/20260809000003_harden_profiles_rls.sql.
   */
  const updateDisplayName = useCallback(
    async (displayName: string) => {
      const userId = session?.user.id;
      if (!userId) throw new Error('ยังไม่ได้เข้าสู่ระบบ');

      const { error } = await supabase
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', userId);

      if (error) throw new Error(error.message);
      await loadProfile(userId);
    },
    [session, loadProfile],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user.id) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthState>(
    () => ({
      initialising,
      session,
      profile,
      profileError,
      requestOtp,
      verifyOtp,
      updateDisplayName,
      signOut,
      refreshProfile,
    }),
    [
      initialising,
      session,
      profile,
      profileError,
      requestOtp,
      verifyOtp,
      updateDisplayName,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
