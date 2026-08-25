/* eslint-disable @typescript-eslint/no-require-imports */

// AsyncStorage has no JS implementation in the test environment.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Supabase is never called for real in tests.
 *
 * Mocking at the client boundary keeps the auth hook itself under test rather
 * than stubbing the hook. `getSession` resolves to NO session by default —
 * a test that wants an authenticated tree must say so explicitly, so nothing
 * here can be mistaken for a fabricated signed-in rider (AGENTS.md).
 */
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
      signInWithOtp: jest.fn().mockResolvedValue({ error: null }),
      verifyOtp: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}));

/**
 * expo-location's native module is absent under jest-expo.
 *
 * Denied by default, and `getCurrentPositionAsync` rejects: a test that wants a
 * position must grant it explicitly. The default therefore fails closed — the
 * same posture `lib/deviceLocation.ts` takes at runtime.
 */
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  getCurrentPositionAsync: jest.fn().mockRejectedValue(new Error('no location in tests')),
}));

// react-native-screens' native module isn't present under jest-expo.
jest.mock('react-native-screens', () => {
  const actual = jest.requireActual('react-native-screens');
  return { ...actual, enableScreens: jest.fn() };
});
