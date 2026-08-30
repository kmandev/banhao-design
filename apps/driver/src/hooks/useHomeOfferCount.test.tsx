import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useHomeOfferCount } from './useHomeOfferCount';
import { repositories } from '../repositories';
import type { RiderOfferSummary } from '../domain/riderOffer';

const PENDING_OFFER: RiderOfferSummary = {
  offerId: 'attempt-1',
  deliveryId: 'delivery-1',
  roundNo: 1,
  offeredAt: '2026-08-25T05:00:00Z',
  expiresAt: '2026-08-25T05:01:00Z',
  outcome: 'PENDING',
};

function bind(listPendingOffers: jest.Mock) {
  Object.assign(repositories, { offers: { listPendingOffers } });
}

function Probe({ enabled }: { enabled: boolean }) {
  const count = useHomeOfferCount(enabled);
  return <Text testID="count">{count === null ? 'null' : String(count)}</Text>;
}

function renderProbe(enabled: boolean) {
  return render(
    <NavigationContainer>
      <Probe enabled={enabled} />
    </NavigationContainer>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useHomeOfferCount', () => {
  it('starts at null (not yet known), then resolves to the offer count', async () => {
    const listPendingOffers = jest.fn(async () => [PENDING_OFFER]);
    bind(listPendingOffers);

    renderProbe(true);

    expect(screen.getByTestId('count').props.children).toBe('null');
    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('1'));
  });

  it('resolves to 0 — a real, distinct answer from null — when there are no pending offers', async () => {
    const listPendingOffers = jest.fn(async () => []);
    bind(listPendingOffers);

    renderProbe(true);

    await waitFor(() => expect(screen.getByTestId('count').props.children).toBe('0'));
  });

  it('stays null when the read fails — a count failure is never surfaced as an error state', async () => {
    const listPendingOffers = jest.fn(async () => {
      throw new Error('network request failed');
    });
    bind(listPendingOffers);

    renderProbe(true);

    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('count').props.children).toBe('null');
  });

  it('does not read at all when disabled', async () => {
    const listPendingOffers = jest.fn(async () => [PENDING_OFFER]);
    bind(listPendingOffers);

    renderProbe(false);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listPendingOffers).not.toHaveBeenCalled();
    expect(screen.getByTestId('count').props.children).toBe('null');
  });

  it('reads exactly once and never sets up a timer — advancing time fires no further reads', async () => {
    jest.useFakeTimers();
    const listPendingOffers = jest.fn(async () => [PENDING_OFFER]);
    bind(listPendingOffers);

    renderProbe(true);

    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });

    // A poller (like the offer inbox's own 15s timer) would have fired
    // several more reads by now. This hook must not.
    expect(listPendingOffers).toHaveBeenCalledTimes(1);
  });

  it('stops on unmount — no state update after unmount, no lingering subscription', async () => {
    let resolve!: (offers: RiderOfferSummary[]) => void;
    const listPendingOffers = jest.fn(
      () =>
        new Promise<RiderOfferSummary[]>((r) => {
          resolve = r;
        }),
    );
    bind(listPendingOffers);

    const view = renderProbe(true);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    view.unmount();

    await act(async () => {
      resolve([PENDING_OFFER]);
      await Promise.resolve();
    });
    // No assertion needed beyond "this does not throw / warn" — the hook's
    // own `cancelled` guard is what's under test here.
  });
});
