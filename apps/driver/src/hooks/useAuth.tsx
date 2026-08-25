import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/**
 * Driver App session state.
 *
 * Deliberately thinner than the Customer App's `useAuth`: this hook owns the
 * Supabase **session** and nothing else. It does not read `profiles`, and it
 * does not resolve whether the signed-in user is a rider — that is
 * `riders.status`, read through `RiderProfileRepository` and rendered by the
 * approval gate (DEC-UX-006). Keeping authentication and rider capability in
 * separate places is DEC-033/DEC-APP-004's own shape: identity is one thing,
 * domain membership is another, and membership is re-read from the database
 * rather than cached into the session.
 *
 * **No fabricated session, ever.** `AGENTS.md` forbids it and the rule has
 * teeth here: a fake session would make the availability screens reachable
 * without a real rider behind them, and the toggle writes to a live table.
 */

interface AuthState {
  /** True until the persisted session has been read — the splash waits on this. */
  initialising: boolean;
  session: Session | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [initialising, setInitialising] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitialising(false);
      return;
    }

    let cancelled = false;

    // The persisted session is read from AsyncStorage here — this is what
    // makes a signed-in rider survive an app restart without re-verifying.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setInitialising(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ initialising, session, requestOtp, verifyOtp, signOut }),
    [initialising, session, requestOtp, verifyOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
