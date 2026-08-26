import { Text, StyleSheet, type TextStyle } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { HomeScreen } from './HomeScreen';
import { AuthProvider } from '../hooks/useAuth';
import { repositories } from '../repositories';
import type { RiderStatus } from '../domain/riderProfile';
import type { RiderAvailability } from '../domain/riderAvailability';
import { LocationPermissionDeniedError } from '../lib/deviceLocation';

/**
 * R-03 หน้าหลัก + R-04 เปิด/ปิดรับงาน, and the DEC-UX-006 gate in front of them.
 *
 * The three properties this suite exists to protect:
 *
 * 1. **A non-approved rider has no toggle in the tree at all** — not a
 *    disabled one. DEC-UX-006 is explicit, and "absent" is asserted by
 *    `queryByTestID(...)` being null rather than by checking a disabled prop.
 * 2. **The rider is never shown as online unless the server actually holds a
 *    position and the flag.** Every failure in the go-online sequence must stop
 *    before `setOnline(true)` is called.
 * 3. **The G-7.1 entry point navigates, and reads nothing new.** Same
 *    `useNavigation` mock `AddressScreen.test.tsx` establishes on the customer
 *    side — `navigate` is a spy, everything else is the real module.
 */

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

const APPROVED_PROFILE = {
  riderId: 'rider-1',
  fullName: 'สมชาย ใจดี',
  status: 'APPROVED' as RiderStatus,
  vehicleType: 'MOTORCYCLE',
  plate: 'กข 1234',
};

const ONLINE: RiderAvailability = { isOnline: true, locationRecordedAt: '2026-08-25T05:00:00Z' };
const OFFLINE: RiderAvailability = { isOnline: false, locationRecordedAt: '2026-08-25T05:00:00Z' };
const NEVER_ONLINE: RiderAvailability = { isOnline: false, locationRecordedAt: null };

/** Call order across all four repositories, so sequencing can be asserted. */
let order: string[] = [];

function bind(overrides: {
  profile?: () => Promise<typeof APPROVED_PROFILE | null>;
  availability?: RiderAvailability;
  setOnline?: jest.Mock;
  capturePosition?: jest.Mock;
  reportPosition?: jest.Mock;
  getOwnAvailability?: jest.Mock;
}) {
  const setOnline =
    overrides.setOnline ??
    jest.fn(async (isOnline: boolean) => {
      order.push(`setOnline(${isOnline})`);
      return { isOnline, locationRecordedAt: '2026-08-25T05:00:00Z' };
    });

  const capturePosition =
    overrides.capturePosition ??
    jest.fn(async () => {
      order.push('capturePosition');
      return { lat: 14.78, lng: 105.32 };
    });

  const reportPosition =
    overrides.reportPosition ??
    jest.fn(async () => {
      order.push('reportPosition');
      return { riderId: 'rider-1', locationUpdatedAt: '2026-08-25T05:00:00Z' };
    });

  const getOwnAvailability =
    overrides.getOwnAvailability ??
    jest.fn(async () => overrides.availability ?? OFFLINE);

  Object.assign(repositories, {
    riderProfile: {
      getOwnProfile: overrides.profile ?? (async () => APPROVED_PROFILE),
    },
    availability: { getOwnAvailability, setOnline },
    location: { reportPosition },
    deviceLocation: { capturePosition },
  });

  return { setOnline, capturePosition, reportPosition, getOwnAvailability };
}

function renderHome() {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <HomeScreen />
      </AuthProvider>
    </NavigationContainer>,
  );
}

/**
 * The rendered text of a node, flattened.
 *
 * The `toHaveTextContent` matcher lives in `@testing-library/jest-native`,
 * which this app does not depend on — one matcher is not worth a dependency,
 * and reading the node's own children is what that matcher does anyway.
 */
function textOf(node: { props: { children?: unknown } }): string {
  const flatten = (value: unknown): string => {
    if (value === null || value === undefined || typeof value === 'boolean') return '';
    if (Array.isArray(value)) return value.map(flatten).join('');
    if (typeof value === 'object' && 'props' in (value as Record<string, unknown>)) {
      return flatten((value as { props: { children?: unknown } }).props.children);
    }
    return String(value);
  };
  return flatten(node.props.children);
}

beforeEach(() => {
  order = [];
  jest.clearAllMocks();
});

describe('HomeScreen — the three async states', () => {
  it('renders a loading state while the rider record is in flight', async () => {
    let release: (value: typeof APPROVED_PROFILE) => void = () => {};
    bind({ profile: () => new Promise((resolve) => (release = resolve)) });

    renderHome();

    expect(screen.getByTestId('home-loading')).toBeTruthy();
    // Never a gate, and never a toggle, while the answer is unknown.
    expect(screen.queryByTestId('screen-status')).toBeNull();
    expect(screen.queryByTestId('button-go-online')).toBeNull();

    await act(async () => {
      release(APPROVED_PROFILE);
    });
  });

  it('renders an error state — never "not approved" — when the rider record fails to load', async () => {
    bind({
      profile: async () => {
        throw new Error('connection reset');
      },
    });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-error')).toBeTruthy());
    expect(screen.getByText('connection reset')).toBeTruthy();
    expect(screen.queryByTestId('screen-status')).toBeNull();
    expect(screen.queryByTestId('button-go-online')).toBeNull();
  });

  it('renders the availability control on success for an approved rider', async () => {
    bind({ availability: OFFLINE });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('availability-panel')).toBeTruthy());
    expect(screen.getByTestId('button-go-online')).toBeTruthy();
  });

  it('renders an availability error state with a retry, without claiming a status', async () => {
    bind({
      getOwnAvailability: jest.fn(async () => {
        throw new Error('permission denied');
      }),
    });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('availability-error')).toBeTruthy());
    expect(screen.queryByTestId('button-go-online')).toBeNull();
    expect(screen.getByTestId('button-retry-availability')).toBeTruthy();
  });
});

describe('HomeScreen — the DEC-UX-006 approval gate', () => {
  const NON_APPROVED: RiderStatus[] = [
    'REGISTERED',
    'DOCUMENTS_SUBMITTED',
    'PENDING_APPROVAL',
    'DOCUMENTS_REJECTED',
    'SUSPENDED',
    'DEACTIVATED',
  ];

  it.each(NON_APPROVED)(
    'a %s rider sees no online toggle at all — absent, not disabled',
    async (status) => {
      const { getOwnAvailability } = bind({ profile: async () => ({ ...APPROVED_PROFILE, status }) });

      renderHome();

      await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());
      expect(screen.queryByTestId('button-go-online')).toBeNull();
      expect(screen.queryByTestId('button-go-offline')).toBeNull();
      expect(screen.queryByTestId('availability-panel')).toBeNull();

      // Availability is not even queried for a rider who cannot be offered work.
      expect(getOwnAvailability).not.toHaveBeenCalled();
    },
  );

  it('a user with no rider record sees the gate, and no fabricated identity', async () => {
    bind({ profile: async () => null });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());
    expect(screen.queryByTestId('button-go-online')).toBeNull();
    expect(screen.getByText('บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นไรเดอร์')).toBeTruthy();
  });

  it('an APPROVED rider does reach the toggle', async () => {
    bind({ availability: OFFLINE });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());
    expect(screen.queryByTestId('screen-status')).toBeNull();
  });
});

describe('HomeScreen — going online is position first, flag second', () => {
  it('captures a position, reports it, and only then sets is_online = true', async () => {
    const { setOnline } = bind({ availability: NEVER_ONLINE });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-go-online'));
    });

    expect(order).toEqual(['capturePosition', 'reportPosition', 'setOnline(true)']);
    expect(setOnline).toHaveBeenCalledWith(true);
    await waitFor(() => expect(screen.getByTestId('button-go-offline')).toBeTruthy());
  });

  it('does not set the flag when location permission is denied, and says why', async () => {
    const { setOnline, reportPosition } = bind({
      availability: NEVER_ONLINE,
      capturePosition: jest.fn(async () => {
        throw new LocationPermissionDeniedError();
      }),
    });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-go-online'));
    });

    expect(reportPosition).not.toHaveBeenCalled();
    expect(setOnline).not.toHaveBeenCalled();

    // Still offline, and told that location is what is missing.
    expect(screen.getByTestId('button-go-online')).toBeTruthy();
    expect(screen.queryByTestId('button-go-offline')).toBeNull();
    expect(textOf(screen.getByTestId('availability-action-error'))).toContain(
      'ต้องอนุญาตให้เข้าถึงตำแหน่งก่อนจึงจะเปิดรับงานได้',
    );
  });

  it('does not set the flag when the position could not be reported to the server', async () => {
    const { setOnline } = bind({
      availability: NEVER_ONLINE,
      reportPosition: jest.fn(async () => {
        throw new Error('Network request failed');
      }),
    });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-go-online'));
    });

    expect(setOnline).not.toHaveBeenCalled();
    expect(screen.getByTestId('button-go-online')).toBeTruthy();
  });

  it('stays offline when the flag write itself fails', async () => {
    bind({
      availability: NEVER_ONLINE,
      setOnline: jest.fn(async () => {
        throw new Error('เปลี่ยนสถานะรับงานไม่สำเร็จ');
      }),
    });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-go-online'));
    });

    expect(screen.getByTestId('button-go-online')).toBeTruthy();
    expect(screen.queryByTestId('button-go-offline')).toBeNull();
    expect(screen.getByTestId('availability-action-error')).toBeTruthy();
  });
});

describe('HomeScreen — going offline', () => {
  it('writes is_online = false and captures no position', async () => {
    const { setOnline, capturePosition, reportPosition } = bind({ availability: ONLINE });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-go-offline')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-go-offline'));
    });

    expect(setOnline).toHaveBeenCalledWith(false);
    expect(capturePosition).not.toHaveBeenCalled();
    expect(reportPosition).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('button-go-online')).toBeTruthy());
  });
});

describe('HomeScreen — G-7.1 entry point', () => {
  it('navigates to OfferInbox and reads nothing new to do it', async () => {
    bind({ availability: OFFLINE });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-view-offers')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-view-offers'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('OfferInbox');
  });

  it('is absent for a non-approved rider, same as the toggle', async () => {
    bind({ profile: async () => ({ ...APPROVED_PROFILE, status: 'SUSPENDED' }) });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());
    expect(screen.queryByTestId('button-view-offers')).toBeNull();
  });
});

describe('HomeScreen — explicit refresh', () => {
  it('re-reads the rider record and the availability row, and captures no position', async () => {
    const profile = jest.fn(async () => APPROVED_PROFILE);
    const { getOwnAvailability, capturePosition } = bind({ profile, availability: OFFLINE });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('button-refresh')).toBeTruthy());

    expect(profile).toHaveBeenCalledTimes(1);
    expect(getOwnAvailability).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-refresh'));
    });

    await waitFor(() => expect(profile).toHaveBeenCalledTimes(2));
    expect(getOwnAvailability).toHaveBeenCalledTimes(2);
    expect(capturePosition).not.toHaveBeenCalled();
  });
});

describe('HomeScreen — the rider is told about their recorded position', () => {
  it('says the server has no position when none is recorded', async () => {
    bind({ availability: NEVER_ONLINE });

    renderHome();

    await waitFor(() =>
      expect(textOf(screen.getByTestId('location-state'))).toContain('ระบบยังไม่มีตำแหน่งของคุณ'),
    );
  });

  it('states the recorded time when one exists', async () => {
    bind({ availability: OFFLINE });

    renderHome();

    await waitFor(() =>
      expect(textOf(screen.getByTestId('location-state'))).toContain('ตำแหน่งล่าสุดที่ระบบบันทึกไว้'),
    );
  });
});

describe('HomeScreen — typography', () => {
  /**
   * `fontSize` without `fontFamily` silently falls back to the system face, and
   * Android ignores `fontWeight` when a custom family is set — so every Text in
   * this app must name a family explicitly (CLAUDE.md §10).
   */
  function assertEveryTextNamesAFamily() {
    const texts = screen.UNSAFE_getAllByType(Text);
    expect(texts.length).toBeGreaterThan(0);

    for (const node of texts) {
      const flattened = StyleSheet.flatten(node.props.style as TextStyle) ?? {};
      expect(typeof flattened.fontFamily).toBe('string');
      expect(flattened.fontFamily).toMatch(/^IBMPlexSansThai_/);
    }
  }

  it('every text style on the availability screen names an IBM Plex Sans Thai family', async () => {
    bind({ availability: ONLINE });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('availability-panel')).toBeTruthy());

    assertEveryTextNamesAFamily();
  });

  it('every text style on the approval gate names an IBM Plex Sans Thai family', async () => {
    bind({ profile: async () => ({ ...APPROVED_PROFILE, status: 'SUSPENDED' }) });

    renderHome();
    await waitFor(() => expect(screen.getByTestId('screen-status')).toBeTruthy());

    assertEveryTextNamesAFamily();
  });
});
