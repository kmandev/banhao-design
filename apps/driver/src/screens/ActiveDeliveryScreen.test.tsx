import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@banhao/api-client';
import { ActiveDeliveryScreen } from './ActiveDeliveryScreen';
import { repositories } from '../repositories';
import type { RiderActiveDelivery } from '../domain/riderDelivery';
import type { RiderOrderDetail } from '../domain/riderOrder';

/**
 * G-7.2 Phase 1 — the rider's active delivery.
 *
 * `useFocusEffect` is replaced with a plain mount/unmount effect so this suite
 * can drive focus, polling and cleanup deterministically without a real
 * navigator underneath — the same trade `OfferInboxScreen.test.tsx`,
 * `HomeScreen.test.tsx` and `RootNavigator.test.tsx` all make. This is
 * evidence that the hook fetches on "focus" (here: mount), polls on an
 * interval, and stops on "blur" (here: unmount) — it is not evidence of real
 * navigation focus timing, exactly as those suites' own notes record.
 */
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useFocusEffect: (effect: () => void | (() => void)) => {
      (jest.requireActual('react') as typeof import('react')).useEffect(effect, []);
    },
  };
});

const EN_ROUTE_DELIVERY: RiderActiveDelivery = {
  deliveryId: 'delivery-1',
  orderId: 'order-1',
  state: 'EN_ROUTE',
  assignedAt: '2026-08-26T10:00:00Z',
  pickedUpAt: '2026-08-26T10:20:00Z',
  deliveredAt: null,
};

const ASSIGNED_DELIVERY: RiderActiveDelivery = {
  ...EN_ROUTE_DELIVERY,
  state: 'RIDER_ASSIGNED',
  pickedUpAt: null,
};

const ORDER: RiderOrderDetail = {
  orderId: 'order-1',
  orderNumber: 'BH-0241',
  state: 'DELIVERING',
  restaurantId: 'restaurant-1',
  restaurantNameSnapshot: 'ร้านก๋วยเตี๋ยวป้าน้อย',
  deliveryAddressSnapshot: '62 ม.4 ต.บุณฑริก',
  deliveryLat: null,
  deliveryLng: null,
  deliveryLandmark: 'ประตูรั้วสีเขียว',
  recipientNameSnapshot: 'คุณสมหญิง',
  recipientPhoneSnapshot: '+66812345678',
  distanceM: null,
  quotedEtaMinutes: null,
  placedAt: '2026-08-26T09:50:00Z',
  acceptedAt: null,
  readyAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  cancelledAt: null,
  createdAt: '2026-08-26T09:50:00Z',
  updatedAt: '2026-08-26T10:20:00Z',
  items: [],
};

function bind(overrides: {
  getActiveDelivery?: jest.Mock;
  getAssignedOrder?: jest.Mock;
  markArrived?: jest.Mock;
  markPickedUp?: jest.Mock;
  markEnRoute?: jest.Mock;
  markDelivered?: jest.Mock;
}) {
  const getActiveDelivery = overrides.getActiveDelivery ?? jest.fn(async () => EN_ROUTE_DELIVERY);
  const getAssignedOrder = overrides.getAssignedOrder ?? jest.fn(async () => ORDER);
  const markArrived = overrides.markArrived ?? jest.fn(async () => ({}));
  const markPickedUp = overrides.markPickedUp ?? jest.fn(async () => ({}));
  const markEnRoute = overrides.markEnRoute ?? jest.fn(async () => ({}));
  const markDelivered =
    overrides.markDelivered ??
    jest.fn(async () => ({
      deliveryId: 'delivery-1',
      orderId: 'order-1',
      state: 'DELIVERED',
      deliveredAt: '2026-08-26T11:00:00Z',
      riderId: 'rider-1',
    }));

  // Bound onto the shared `repositories` singleton — the same object
  // `apps/driver/src/repositories/index.ts` exports and the screen imports, so
  // a pass here is evidence the G-7.2 binding is actually wired, not a private
  // test double the screen never sees in production.
  Object.assign(repositories, {
    delivery: { getActiveDelivery },
    riderOrderView: { getAssignedOrder },
    deliveryActions: { markArrived, markPickedUp, markEnRoute, markDelivered },
  });

  return { getActiveDelivery, getAssignedOrder, markArrived, markPickedUp, markEnRoute, markDelivered };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('ActiveDeliveryScreen — rendering the active delivery', () => {
  it('renders the delivery, its step, and the order detail the rider navigates by', async () => {
    bind({});
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-body');

    expect(screen.getByText(/EN_ROUTE/)).toBeTruthy();
    expect(screen.getByText(/ขั้นที่ 4 จาก 4/)).toBeTruthy();
    expect(screen.getByText(/BH-0241/)).toBeTruthy();
    expect(screen.getByTestId('delivery-dropoff')).toBeTruthy();
    expect(screen.getByText('62 ม.4 ต.บุณฑริก')).toBeTruthy();
  });

  it('renders the step whose action matches the SERVER state, not a local counter', async () => {
    bind({ getActiveDelivery: jest.fn(async () => ASSIGNED_DELIVERY) });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-body');

    expect(screen.getByText(/ขั้นที่ 1 จาก 4/)).toBeTruthy();
    expect(screen.getByTestId('button-delivery-arrived')).toBeTruthy();
    expect(screen.queryByTestId('button-delivery-delivered')).toBeNull();
  });

  it('shows a loading state before the first read settles', () => {
    bind({ getActiveDelivery: jest.fn(() => new Promise<never>(() => {})) });
    render(<ActiveDeliveryScreen />);

    expect(screen.getByTestId('active-delivery-loading')).toBeTruthy();
  });

  it('shows the no-active-delivery state when the rider has none', async () => {
    bind({ getActiveDelivery: jest.fn(async () => null) });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-empty');
    expect(screen.queryByTestId('active-delivery-error')).toBeNull();
  });

  it('renders a failed read as an error, NEVER as "no active delivery"', async () => {
    bind({ getActiveDelivery: jest.fn(async () => { throw new Error('network request failed'); }) });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-error');
    // Telling a rider mid-delivery they have no job because the network
    // dropped is the specific failure this asserts against.
    expect(screen.queryByTestId('active-delivery-empty')).toBeNull();
    expect(screen.getByText('network request failed')).toBeTruthy();
  });

  it('retry re-reads and recovers from an error', async () => {
    const getActiveDelivery = jest
      .fn()
      .mockRejectedValueOnce(new Error('network request failed'))
      .mockResolvedValue(EN_ROUTE_DELIVERY);
    bind({ getActiveDelivery });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-error');
    fireEvent.press(screen.getByTestId('button-retry-active-delivery'));

    await screen.findByTestId('active-delivery-body');
    expect(getActiveDelivery).toHaveBeenCalledTimes(2);
  });

  it('still renders the delivery when the order read fails — the job is not lost with the address', async () => {
    bind({ getAssignedOrder: jest.fn(async () => { throw new Error('order read failed'); }) });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-body');
    expect(screen.getByTestId('delivery-order-unavailable')).toBeTruthy();
    // The action is still available: every command needs only deliveryId.
    expect(screen.getByTestId('button-delivery-delivered')).toBeTruthy();
  });

  it('offers no action for a delivery being reassigned', async () => {
    bind({
      getActiveDelivery: jest.fn(async () => ({ ...EN_ROUTE_DELIVERY, state: 'RIDER_REASSIGNING' })),
    });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-body');
    // A button here would produce a guaranteed 409 — no endpoint accepts this state.
    expect(screen.getByTestId('delivery-no-action')).toBeTruthy();
    expect(screen.queryByTestId('button-delivery-delivered')).toBeNull();
  });

  it('renders no money field anywhere — BQ-029 is OPEN', async () => {
    bind({});
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('active-delivery-body');
    expect(screen.queryByText(/฿|บาท|ค่ารอบ|รายได้/)).toBeNull();
  });
});

describe('ActiveDeliveryScreen — the delivered command', () => {
  it('calls the API command, never a direct Supabase write', async () => {
    const { markDelivered } = bind({});
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    expect(markDelivered).toHaveBeenCalledWith('delivery-1');
  });

  it('shows the completed state only after the server responded, with the server’s own timestamp', async () => {
    bind({});
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    const completed = await screen.findByTestId('delivery-completed');
    expect(completed).toBeTruthy();
    // Not a local clock — `deliveries.delivered_at` as the API returned it.
    expect(screen.getByTestId('delivery-completed-at')).toBeTruthy();
  });

  it('never shows the completed state when the command fails', async () => {
    bind({
      markDelivered: jest.fn(async () => {
        throw new ApiClientError(409, { code: 'INVALID_TRANSITION', message: 'not EN_ROUTE' });
      }),
    });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    await screen.findByTestId('delivery-action-error');
    expect(screen.queryByTestId('delivery-completed')).toBeNull();
  });

  it('re-reads the delivery after every action, success or failure', async () => {
    const { getActiveDelivery, markDelivered } = bind({
      markDelivered: jest.fn(async () => {
        throw new ApiClientError(409, { code: 'INVALID_TRANSITION', message: 'not EN_ROUTE' });
      }),
    });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    expect(getActiveDelivery).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    // The server's response is the only authority: the state just read is
    // stale either way, so it is re-read rather than patched locally.
    await waitFor(() => expect(getActiveDelivery).toHaveBeenCalledTimes(2));
    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it('maps a known error code to Thai copy, never a server-facing string', async () => {
    bind({
      markDelivered: jest.fn(async () => {
        throw new ApiClientError(403, { code: 'NOT_ASSIGNED_RIDER', message: 'raw server text' });
      }),
    });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    await screen.findByTestId('delivery-action-error');
    expect(screen.getByText('งานนี้ไม่ใช่งานของคุณแล้ว')).toBeTruthy();
    expect(screen.queryByText('raw server text')).toBeNull();
  });

  it('after completion the screen returns to the no-active-delivery state', async () => {
    // The delivery is EN_ROUTE on first read and gone on the post-action
    // re-read, exactly as the server behaves: DELIVERED is terminal and not in
    // ACTIVE_DELIVERY_STATES.
    const getActiveDelivery = jest
      .fn()
      .mockResolvedValueOnce(EN_ROUTE_DELIVERY)
      .mockResolvedValue(null);
    bind({ getActiveDelivery });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-delivered');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    await screen.findByTestId('delivery-completed');
    fireEvent.press(screen.getByTestId('button-acknowledge-completion'));

    // Which is what makes the rider available for a subsequent offer.
    await screen.findByTestId('active-delivery-empty');
  });

  it('drives the earlier steps through their own endpoints', async () => {
    const { markArrived } = bind({ getActiveDelivery: jest.fn(async () => ASSIGNED_DELIVERY) });
    render(<ActiveDeliveryScreen />);

    await screen.findByTestId('button-delivery-arrived');
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-arrived'));
    });

    expect(markArrived).toHaveBeenCalledWith('delivery-1');
  });
});

describe('ActiveDeliveryScreen — polling', () => {
  it('polls on a single 15 s timer while focused', async () => {
    jest.useFakeTimers();
    const { getActiveDelivery } = bind({});
    render(<ActiveDeliveryScreen />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(getActiveDelivery).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(getActiveDelivery).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    // Exactly one more, not two: a second timer would double this.
    expect(getActiveDelivery).toHaveBeenCalledTimes(3);
  });

  it('stops reading on blur — the timer is cleared, not left to fire', async () => {
    jest.useFakeTimers();
    const { getActiveDelivery } = bind({});
    const view = render(<ActiveDeliveryScreen />);

    await act(async () => {
      await Promise.resolve();
    });
    const beforeUnmount = getActiveDelivery.mock.calls.length;

    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(getActiveDelivery).toHaveBeenCalledTimes(beforeUnmount);
  });

  it('an action does not restart or duplicate the poll timer', async () => {
    jest.useFakeTimers();
    const { getActiveDelivery } = bind({});
    render(<ActiveDeliveryScreen />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-delivery-delivered'));
    });

    const afterAction = getActiveDelivery.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    // One tick, one read. A second interval registered by the action would
    // show up here as two.
    expect(getActiveDelivery).toHaveBeenCalledTimes(afterAction + 1);
  });
});
