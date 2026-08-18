import { render, screen, waitFor } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider } from '../hooks/useAuth';
import { CartProvider } from '../hooks/useCart';
import { RootNavigator, headerOptions } from '../navigation/RootNavigator';

/**
 * Catalog reads are Supabase-backed in production (Phase C / C-7). Screen tests
 * bind the repository seam to the fixtures instead, so these stay deterministic
 * and offline — the seam is exactly what makes that a one-line swap.
 */
jest.mock('../repositories', () => {
  const actual = jest.requireActual('../repositories');
  return { ...actual, repositories: actual.mockRepositories };
});


/**
 * MOCK TEST — no network, no Supabase project, no real session.
 *
 * These assert that the app routes correctly given a session object. They are
 * NOT evidence that authentication works. Live end-to-end auth against the real
 * project is verified by hand (docs/CUSTOMER_APP_VISUAL_QA.md) and live RLS by
 * `node supabase/tests/live-rls-check.mjs`.
 *
 * Navigation tests: which tree the app shows is decided by session state, not
 * by anything the UI holds.
 *
 * `../lib/supabase` is mocked rather than the underlying SDK because
 * babel-preset-expo inlines `EXPO_PUBLIC_*` at transform time — setting
 * process.env at runtime cannot change `isSupabaseConfigured`, so the module
 * boundary is the only place these conditions can be controlled.
 */

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}));
const mockMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: () => mockOnAuthStateChange(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
    }),
  },
}));

const signedInSession = {
  user: { id: 'user-1', phone: '+66812345678' },
  access_token: 'token',
} as unknown as Session;

function renderApp() {
  return render(
    <AuthProvider>
      <CartProvider>
        <RootNavigator />
      </CartProvider>
    </AuthProvider>,
  );
}

describe('RootNavigator', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('shows the splash screen while the session is still being resolved', () => {
    // Never settles, so `initialising` stays true.
    mockGetSession.mockReturnValue(new Promise(() => {}));

    renderApp();

    expect(screen.getByTestId('screen-splash')).toBeTruthy();
  });

  it('shows the auth tree when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    renderApp();

    await waitFor(() => {
      expect(screen.getByTestId('screen-onboarding')).toBeTruthy();
    });
  });

  it('shows the customer tree when signed in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: signedInSession } });
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'user-1', role: 'CUSTOMER', phone: '+66812345678', display_name: 'สมชาย' },
      error: null,
    });

    renderApp();

    await waitFor(() => {
      // The auth tree is gone…
      expect(screen.queryByTestId('screen-onboarding')).toBeNull();
      expect(screen.queryByTestId('screen-splash')).toBeNull();
    });
    // …and the customer tree's first tab is mounted.
    await waitFor(() => {
      expect(screen.getByTestId('screen-home')).toBeTruthy();
    });
  });

  it('loads the profile for the signed-in user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: signedInSession } });

    renderApp();

    await waitFor(() => {
      expect(mockMaybeSingle).toHaveBeenCalled();
    });
  });
});

/**
 * DEF-03. The back button used to fall back to the previous route's name — which
 * surfaced as "Tabs" — or to iOS's generic English "Back" when the previous
 * title was too long. Both are English text in a Thai-language app.
 */
describe('header back label', () => {
  it('uses an explicit Thai label rather than the route name', () => {
    expect(headerOptions.headerBackTitle).toBe('กลับ');
    expect(headerOptions.headerBackTitle).not.toMatch(/[A-Za-z]/);
  });

  it('gives the back label a bundled font family', () => {
    expect(headerOptions.headerBackTitleStyle.fontFamily).toMatch(/IBMPlexSansThai/);
  });
});
