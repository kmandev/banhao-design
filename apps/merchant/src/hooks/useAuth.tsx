'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { markSessionExpired } from '../lib/restaurantScope';

/**
 * Merchant App session state.
 *
 * Deliberately thin, mirroring apps/driver/src/hooks/useAuth.tsx: this hook
 * owns the Supabase **session** and nothing else. It does not resolve
 * restaurant membership — that is `MerchantRestaurantRepository`, read
 * through `useRestaurantScope` (see hooks/useRestaurantScope.tsx). Keeping
 * authentication and merchant authorization in separate places is
 * DEC-033/DEC-APP-004's own shape: identity is one thing, domain membership
 * is another, and membership is re-read from the database rather than
 * cached into the session or stored as a client-side role.
 *
 * **No fabricated session, ever.** AGENTS.md forbids it, and a fake session
 * here would make the restaurant-selection and dashboard screens reachable
 * without a real, database-backed membership behind them.
 */

interface AuthState {
  /** True until the persisted session has been read — callers should wait on this. */
  initialising: boolean;
  session: Session | null;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialising, setInitialising] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // True only while *this hook* is in the middle of calling signOut(), so
  // the subsequent SIGNED_OUT event isn't mistaken for an expired session.
  const manualSignOut = useRef(false);
  const hadSession = useRef(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitialising(false);
      return;
    }

    let cancelled = false;

    // The persisted session is read here — this is what lets a signed-in
    // merchant survive a reload without re-verifying by OTP.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      hadSession.current = data.session !== null;
      setInitialising(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // A session that was present and is now gone, and that we did not
      // ourselves just sign out, means the refresh token failed — the
      // session expired rather than the merchant choosing to leave.
      if (event === 'SIGNED_OUT' && hadSession.current && !manualSignOut.current) {
        markSessionExpired();
      }
      manualSignOut.current = false;
      hadSession.current = nextSession !== null;
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
    manualSignOut.current = true;
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
