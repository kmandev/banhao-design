import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiClientError } from '@banhao/api-client';
import { OfferInboxScreen } from './OfferInboxScreen';
import { repositories } from '../repositories';
import type { RiderOfferSummary } from '../domain/riderOffer';

/**
 * G-7.1 — the rider's offer inbox.
 *
 * `useFocusEffect` is replaced with a plain mount/unmount effect so this
 * suite can drive focus, polling, and cleanup deterministically without a
 * real navigator underneath — the same trade `RootNavigator.test.tsx` and
 * `HomeScreen.test.tsx` make when they mock `useNavigation` instead of
 * threading a full navigation tree through every test. This is evidence that
 * the hook fetches on "focus" (here: mount), polls on an interval, and stops
 * on "blur" (here: unmount) — it is not evidence of real navigation focus
 * timing, exactly as `RootNavigator.test.tsx`'s own note records for auth.
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

const PENDING_OFFER: RiderOfferSummary = {
  offerId: 'attempt-1',
  deliveryId: 'delivery-1',
  roundNo: 1,
  offeredAt: '2026-08-25T05:00:00Z',
  expiresAt: '2026-08-25T05:01:00Z',
  outcome: 'PENDING',
};

const SECOND_OFFER: RiderOfferSummary = {
  offerId: 'attempt-2',
  deliveryId: 'delivery-2',
  roundNo: 1,
  offeredAt: '2026-08-25T05:00:05Z',
  expiresAt: '2026-08-25T05:01:05Z',
  outcome: 'PENDING',
};

function bind(overrides: {
  listPendingOffers?: jest.Mock;
  acceptOffer?: jest.Mock;
  declineOffer?: jest.Mock;
}) {
  const listPendingOffers = overrides.listPendingOffers ?? jest.fn(async () => [PENDING_OFFER]);
  const acceptOffer = overrides.acceptOffer ?? jest.fn(async () => ({}));
  const declineOffer = overrides.declineOffer ?? jest.fn(async () => ({}));

  // Bound onto the shared `repositories` singleton — the same object
  // `apps/driver/src/repositories/index.ts` exports and the screen imports,
  // so a pass here is evidence the G-7.1 binding is actually wired, not a
  // private test double the screen never sees in production.
  Object.assign(repositories, {
    offers: { listPendingOffers },
    offerActions: { acceptOffer, declineOffer },
  });

  return { listPendingOffers, acceptOffer, declineOffer };
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('OfferInboxScreen — initial load', () => {
  it('fetches through the repositories singleton on mount and renders the result', async () => {
    const { listPendingOffers } = bind({});

    render(<OfferInboxScreen />);

    expect(screen.getByTestId('offer-inbox-loading')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('offer-inbox-list')).toBeTruthy());
    expect(listPendingOffers).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy();
  });

  it('renders every pending offer returned, not just the first', async () => {
    bind({ listPendingOffers: jest.fn(async () => [PENDING_OFFER, SECOND_OFFER]) });

    render(<OfferInboxScreen />);

    await waitFor(() => expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy());
    expect(screen.getByTestId('offer-card-attempt-2')).toBeTruthy();
  });
});

describe('OfferInboxScreen — empty and error states', () => {
  it('shows neutral copy, no promise about future offers, when the inbox is empty', async () => {
    bind({ listPendingOffers: jest.fn(async () => []) });

    render(<OfferInboxScreen />);

    await waitFor(() => expect(screen.getByTestId('offer-inbox-empty')).toBeTruthy());
    expect(screen.getByText('ยังไม่มีงาน')).toBeTruthy();
  });

  it('shows an error state with retry when the read fails, and retry re-fetches', async () => {
    const listPendingOffers = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce([PENDING_OFFER]);
    bind({ listPendingOffers });

    render(<OfferInboxScreen />);

    await waitFor(() => expect(screen.getByTestId('offer-inbox-error')).toBeTruthy());
    expect(screen.getByText('connection reset')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-retry-offers'));
    });

    await waitFor(() => expect(screen.getByTestId('offer-inbox-list')).toBeTruthy());
    expect(listPendingOffers).toHaveBeenCalledTimes(2);
  });
});

describe('OfferInboxScreen — overlapping-read protection', () => {
  it('a load triggered while one is already in flight does not start a second concurrent read', async () => {
    let resolveFirst!: (offers: RiderOfferSummary[]) => void;
    const first = new Promise<RiderOfferSummary[]>((resolve) => {
      resolveFirst = resolve;
    });
    const listPendingOffers = jest
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce([PENDING_OFFER]);
    bind({ listPendingOffers });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    // A manual refresh while the mount load is still in flight must not fire
    // a second, concurrent read — it is coalesced into one more read after
    // the in-flight one settles.
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-refresh-offers'));
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst([PENDING_OFFER]);
    });
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(2));
  });

  it('a post-action refresh is not swallowed by an in-flight poll read — it runs once the poll settles', async () => {
    jest.useFakeTimers();

    let resolvePoll!: (offers: RiderOfferSummary[]) => void;
    const pollRead = new Promise<RiderOfferSummary[]>((resolve) => {
      resolvePoll = resolve;
    });
    const listPendingOffers = jest
      .fn()
      .mockResolvedValueOnce([PENDING_OFFER]) // mount
      .mockImplementationOnce(() => pollRead) // the poll tick we hold open
      .mockResolvedValueOnce([]); // the coalesced post-action refresh
    const acceptOffer = jest.fn(async () => ({ deliveryId: 'delivery-1', state: 'RIDER_ASSIGNED', riderId: 'rider-1' }));
    bind({ listPendingOffers, acceptOffer });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    // Start the poll tick and leave it in flight.
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(2);

    // Accept while that poll read is still unresolved — this is exactly the
    // originally-reported race: `runAction`'s guaranteed `load()` call must
    // not be dropped just because `loading.current` is true right now.
    await act(async () => {
      fireEvent.press(screen.getByTestId('button-accept-attempt-1'));
    });
    expect(acceptOffer).toHaveBeenCalledWith('attempt-1');
    // No concurrent third read yet — the refresh is queued, not fired now.
    expect(listPendingOffers).toHaveBeenCalledTimes(2);

    // Let the in-flight poll read settle.
    await act(async () => {
      resolvePoll([PENDING_OFFER]);
    });

    // The queued post-action refresh must fire once the in-flight read
    // settles, and the final rendered list must come from that fresh read —
    // never from an optimistic local removal of the accepted offer.
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByTestId('offer-inbox-empty')).toBeTruthy());
  });
});

describe('OfferInboxScreen — polling continues correctly after an action', () => {
  it.each(['accept', 'decline'] as const)(
    'keeps exactly one poll timer alive after %s completes',
    async (action) => {
      jest.useFakeTimers();
      const listPendingOffers = jest.fn().mockResolvedValue([PENDING_OFFER]);
      const acceptOffer = jest.fn(async () => ({}));
      const declineOffer = jest.fn(async () => ({}));
      bind({ listPendingOffers, acceptOffer, declineOffer });

      render(<OfferInboxScreen />);
      await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

      await act(async () => {
        fireEvent.press(
          screen.getByTestId(action === 'accept' ? 'button-accept-attempt-1' : 'button-decline-attempt-1'),
        );
      });
      // The action's own guaranteed refresh.
      await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(2));

      const callsAfterAction = listPendingOffers.mock.calls.length;

      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      // Exactly one more call — a duplicated timer would double this.
      expect(listPendingOffers).toHaveBeenCalledTimes(callsAfterAction + 1);

      await act(async () => {
        jest.advanceTimersByTime(15_000);
      });
      expect(listPendingOffers).toHaveBeenCalledTimes(callsAfterAction + 2);
    },
  );
});

describe('OfferInboxScreen — foreground polling', () => {
  it('polls again on the bounded interval while mounted ("focused")', async () => {
    jest.useFakeTimers();
    const { listPendingOffers } = bind({});

    render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(3);
  });

  it('never has more than one timer alive — advancing a full interval fires exactly one extra poll', async () => {
    jest.useFakeTimers();
    const { listPendingOffers } = bind({});

    render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    // A duplicated interval would double this to 3 (or more) on the very
    // first tick; a single well-behaved timer produces exactly one.
    expect(listPendingOffers).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the screen unmounts ("blurs") — the timer is cleared, not just abandoned', async () => {
    jest.useFakeTimers();
    const { listPendingOffers } = bind({});

    const view = render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    view.unmount();

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(1);
  });

  // `useFocusEffect` is mocked to plain mount/unmount (see the file header
  // note) — this test therefore exercises blur→refocus through that same
  // mount/unmount proxy, not a real navigator's focus event. It is honest
  // about that limit, not a claim that real focus-lifecycle timing is
  // verified here.
  it('on refocus after a blur: the old timer stays cleared and exactly one new timer is created', async () => {
    jest.useFakeTimers();
    const { listPendingOffers } = bind({});

    const view = render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(1));

    // Blur.
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(1);

    // Refocus.
    render(<OfferInboxScreen />);
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(2));

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    // Exactly one more call — not two, which a leftover timer from the
    // blurred instance plus a new one would produce.
    expect(listPendingOffers).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(listPendingOffers).toHaveBeenCalledTimes(4);
  });
});

describe('OfferInboxScreen — accept', () => {
  it('accepts through the API repository, treats the response as authoritative, and refreshes the list', async () => {
    const listPendingOffers = jest
      .fn()
      .mockResolvedValueOnce([PENDING_OFFER])
      .mockResolvedValueOnce([]);
    const acceptOffer = jest.fn(async () => ({ deliveryId: 'delivery-1', state: 'RIDER_ASSIGNED', riderId: 'rider-1' }));
    bind({ listPendingOffers, acceptOffer });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-accept-attempt-1'));
    });

    expect(acceptOffer).toHaveBeenCalledWith('attempt-1');
    await waitFor(() => expect(screen.getByTestId('offer-inbox-empty')).toBeTruthy());
    expect(listPendingOffers).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('offer-action-error')).toBeNull();
  });

  it.each([
    ['OFFER_TAKEN', 409, 'งานนี้ถูกไรเดอร์คนอื่นรับไปแล้ว'],
    ['OFFER_EXPIRED', 409, 'งานนี้หมดเวลารับแล้ว'],
    ['NOT_FOUND', 404, 'ไม่พบงานนี้แล้ว'],
    ['RIDER_HAS_ACTIVE_DELIVERY', 409, 'คุณมีงานที่กำลังดำเนินการอยู่แล้ว'],
    ['FORBIDDEN', 403, 'บัญชีนี้ยังไม่ได้รับอนุมัติให้รับงาน'],
  ] as const)('shows concise feedback and refreshes, without retrying, on %s', async (code, status, expectedCopy) => {
    const listPendingOffers = jest
      .fn()
      .mockResolvedValueOnce([PENDING_OFFER])
      .mockResolvedValueOnce([]);
    const acceptOffer = jest.fn(async () => {
      throw new ApiClientError(status, { code, message: 'server message' });
    });
    bind({ listPendingOffers, acceptOffer });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-accept-attempt-1'));
    });

    await waitFor(() => expect(screen.getByTestId('offer-action-error')).toBeTruthy());
    expect(screen.getByText(expectedCopy)).toBeTruthy();
    // Never the server's raw message — ApiClientError's own contract is
    // "branch on code, never on message".
    expect(screen.queryByText('server message')).toBeNull();
    expect(acceptOffer).toHaveBeenCalledTimes(1);
    // The stale offer is refreshed away rather than left rendered as live.
    await waitFor(() => expect(listPendingOffers).toHaveBeenCalledTimes(2));
  });
});

describe('OfferInboxScreen — decline', () => {
  it('declines through the API repository and refreshes the list', async () => {
    const listPendingOffers = jest
      .fn()
      .mockResolvedValueOnce([PENDING_OFFER])
      .mockResolvedValueOnce([]);
    const declineOffer = jest.fn(async () => ({ offerId: 'attempt-1', riderId: 'rider-1', outcome: 'DECLINED' }));
    bind({ listPendingOffers, declineOffer });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-decline-attempt-1'));
    });

    expect(declineOffer).toHaveBeenCalledWith('attempt-1');
    await waitFor(() => expect(screen.getByTestId('offer-inbox-empty')).toBeTruthy());
  });

  it.each([
    ['OFFER_TAKEN', 409, 'งานนี้ถูกไรเดอร์คนอื่นรับไปแล้ว'],
    ['OFFER_EXPIRED', 409, 'งานนี้หมดเวลารับแล้ว'],
    ['FORBIDDEN', 403, 'บัญชีนี้ยังไม่ได้รับอนุมัติให้รับงาน'],
  ] as const)('shows concise feedback on %s without retrying', async (code, status, expectedCopy) => {
    const listPendingOffers = jest
      .fn()
      .mockResolvedValueOnce([PENDING_OFFER])
      .mockResolvedValueOnce([]);
    const declineOffer = jest.fn(async () => {
      throw new ApiClientError(status, { code, message: 'server message' });
    });
    bind({ listPendingOffers, declineOffer });

    render(<OfferInboxScreen />);
    await waitFor(() => expect(screen.getByTestId('offer-card-attempt-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-decline-attempt-1'));
    });

    await waitFor(() => expect(screen.getByTestId('offer-action-error')).toBeTruthy());
    expect(screen.getByText(expectedCopy)).toBeTruthy();
    expect(declineOffer).toHaveBeenCalledTimes(1);
  });
});
