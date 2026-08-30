import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './useAuth';

const markSessionExpired = jest.fn();
jest.mock('../lib/restaurantScope', () => ({
  markSessionExpired: () => markSessionExpired(),
}));

type AuthStateCallback = (event: string, session: unknown) => void;
let authStateCallback: AuthStateCallback | null = null;

// Built entirely inside the factory — jest hoists jest.mock() calls above
// every import and const in this file, so referencing an outer identifier
// directly here (rather than only inside a closure invoked later) would hit
// the temporal dead zone. `authStateCallback` above is safe because it's
// only *assigned* inside a closure that runs later, during renderHook().
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn((cb: AuthStateCallback) => {
        authStateCallback = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      signOut: jest.fn(),
    },
  },
  isSupabaseConfigured: true,
}));

interface MockSupabase {
  auth: {
    getSession: jest.Mock;
    onAuthStateChange: jest.Mock;
    signInWithOtp: jest.Mock;
    verifyOtp: jest.Mock;
    signOut: jest.Mock;
  };
}

// Obtained after the mock is registered, so this is a typed handle onto the
// same object useAuth.tsx itself imports — not a second, disconnected mock.
const { supabase: mockSupabase } = jest.requireMock<{ supabase: MockSupabase }>('../lib/supabase');

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const SESSION = { access_token: 'token-1', user: { id: 'user-1' } };

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStateCallback = null;
    mockSupabase.auth.signOut.mockResolvedValue({ error: null });
  });

  it('starts initialising and resolves once the persisted session is read', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.initialising).toBe(true);

    await waitFor(() => expect(result.current.initialising).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('restores a persisted session on load — a signed-in merchant survives a reload', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.session).toEqual(SESSION));
  });

  it('requestOtp calls signInWithOtp with the phone number', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabase.auth.signInWithOtp.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialising).toBe(false));

    await act(async () => {
      await result.current.requestOtp('+66812345678');
    });

    expect(mockSupabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: '+66812345678' });
  });

  it('requestOtp throws when Supabase returns an error — OTP send failure', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabase.auth.signInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialising).toBe(false));

    await expect(result.current.requestOtp('+66812345678')).rejects.toThrow('rate limited');
  });

  it('verifyOtp calls verifyOtp with phone, token and type sms', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabase.auth.verifyOtp.mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialising).toBe(false));

    await act(async () => {
      await result.current.verifyOtp('+66812345678', '123456');
    });

    expect(mockSupabase.auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+66812345678',
      token: '123456',
      type: 'sms',
    });
  });

  it('verifyOtp throws when Supabase rejects the code — invalid/expired OTP', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    mockSupabase.auth.verifyOtp.mockResolvedValue({ error: { message: 'Token has expired' } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialising).toBe(false));

    await expect(result.current.verifyOtp('+66812345678', '000000')).rejects.toThrow(
      'Token has expired',
    );
  });

  it('signOut clears the session and does not mark it as expired', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.session).toEqual(SESSION));

    await act(async () => {
      await result.current.signOut();
      // Supabase emits this after a real signOut() call; simulate it so the
      // "was this manual?" guard is exercised the same way it is live.
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(result.current.session).toBeNull();
    expect(markSessionExpired).not.toHaveBeenCalled();
  });

  it('marks the session expired when it disappears without signOut() being called', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: SESSION } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.session).toEqual(SESSION));

    act(() => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(markSessionExpired).toHaveBeenCalledTimes(1);
    expect(result.current.session).toBeNull();
  });

  it('does not mark session expired on the very first auth event when there was never a session', async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initialising).toBe(false));

    act(() => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(markSessionExpired).not.toHaveBeenCalled();
  });
});
