import type { Session } from '@supabase/supabase-js';
import { render, screen, waitFor } from '@testing-library/react-native';
import { RootNavigator } from './RootNavigator';
import { AuthProvider } from '../hooks/useAuth';
import { repositories } from '../repositories';

/**
 * Which tree a rider lands in, and why.
 *
 * The choice is the Supabase session and nothing else — whether the user is an
 * *approved rider* is answered separately, inside `HomeScreen`, from a fresh
 * `riders` read (DEC-APP-004: a revoked grant must take effect on the next
 * read, so it can never be cached into the session).
 *
 * ## What these tests are, and are not
 *
 * They assert that the app routes correctly **given** a session object, and
 * that the session is read from the client on mount rather than assumed. They
 * are **not** evidence that authentication works: no OTP is sent, no JWT is
 * verified, and no session is persisted to real storage here. Live end-to-end
 * auth against `banhao-dev` is a manual verification, exactly as the Customer
 * App records in `docs/CUSTOMER_APP_VISUAL_QA.md`.
 *
 * `../lib/supabase` is mocked at the module boundary rather than the SDK
 * beneath it, following `apps/customer/src/__tests__/navigation.test.tsx`:
 * babel-preset-expo inlines `EXPO_PUBLIC_*` at transform time, so setting
 * `process.env` at runtime cannot flip `isSupabaseConfigured`, and the module
 * boundary is the only place these conditions can be controlled.
 *
 * **No session is ever pushed into the provider's state.** Every one below
 * arrives through the client's own `getSession` or its auth listener — the two
 * paths a real session takes. `AGENTS.md` forbids fabricating one, and a test
 * that bypassed the client would stop proving anything about restart
 * behaviour.
 */

type AuthChangeHandler = (event: string, session: Session | null) => void;
type Subscription = { data: { subscription: { unsubscribe: jest.Mock } } };

const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn(
  (_handler: AuthChangeHandler): Subscription => ({
    data: { subscription: { unsubscribe: jest.fn() } },
  }),
);

jest.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (handler: AuthChangeHandler) => mockOnAuthStateChange(handler),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

/** Shaped like GoTrue's, and only ever returned *through* the mocked client. */
const PERSISTED_SESSION = {
  access_token: 'persisted-access-token',
  user: { id: 'user-1', phone: '+66812345678' },
} as unknown as Session;

beforeEach(() => {
  jest.clearAllMocks();
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: jest.fn() } },
  });

  // The reads HomeScreen performs once the rider tree mounts. `getOwnProfile`
  // resolving null lands it on the approval gate, which is still the rider
  // stack — the distinction these tests care about.
  Object.assign(repositories, {
    riderProfile: { getOwnProfile: jest.fn().mockResolvedValue(null) },
    availability: {
      getOwnAvailability: jest.fn().mockResolvedValue({ isOnline: false, locationRecordedAt: null }),
      setOnline: jest.fn(),
    },
    location: { reportPosition: jest.fn() },
    deviceLocation: { capturePosition: jest.fn() },
  });
});

function renderRoot() {
  return render(
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>,
  );
}

describe('RootNavigator — session drives the tree', () => {
  it('shows the splash while the persisted session is still being read', () => {
    mockGetSession.mockReturnValue(new Promise(() => {}));

    renderRoot();

    expect(screen.getByTestId('screen-splash')).toBeTruthy();
    expect(screen.queryByTestId('screen-login')).toBeNull();
    expect(screen.queryByTestId('screen-status')).toBeNull();
  });

  it('routes a signed-out user to the auth stack', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    renderRoot();

    await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());
    expect(screen.queryByTestId('screen-status')).toBeNull();
    expect(screen.queryByTestId('screen-home')).toBeNull();
  });

  it('routes a signed-in user to the rider stack', async () => {
    mockGetSession.mockResolvedValue({ data: { session: PERSISTED_SESSION } });

    renderRoot();

    await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());
    expect(screen.queryByTestId('screen-login')).toBeNull();
  });
});

describe('RootNavigator — session persistence', () => {
  it('reads the persisted session from the client on mount rather than starting signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: PERSISTED_SESSION } });

    renderRoot();

    await waitFor(() => expect(mockGetSession).toHaveBeenCalledTimes(1));
    // A restart is exactly this: a fresh mount that finds a session already in
    // storage and never shows the login screen.
    expect(screen.queryByTestId('screen-login')).toBeNull();
  });

  it('subscribes to auth state changes and unsubscribes on unmount', async () => {
    const unsubscribe = jest.fn();
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const view = renderRoot();
    await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());

    expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('follows a sign-out pushed by the auth listener back to the auth stack', async () => {
    mockGetSession.mockResolvedValue({ data: { session: PERSISTED_SESSION } });

    let emit: AuthChangeHandler | undefined;
    mockOnAuthStateChange.mockImplementation((handler: AuthChangeHandler) => {
      emit = handler;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    renderRoot();
    await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());

    await waitFor(() => {
      emit?.('SIGNED_OUT', null);
    });

    await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());
  });
});

describe('RootNavigator — nothing is assumed about identity', () => {
  it('treats a client reporting no session as signed out, with no fallback identity', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    renderRoot();

    await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());
    // Nothing in the rider tree is reachable, and no rider record was read.
    expect(repositories.riderProfile.getOwnProfile).not.toHaveBeenCalled();
  });
});
