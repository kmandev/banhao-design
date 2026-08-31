import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type {
  MerchantOrderRealtimeEvent,
  MerchantOrderRealtimeStatus,
} from './useOrderRealtime';
import { useOrderBoard } from './useOrderBoard';

/**
 * M-2.5's state/reconciliation layer.
 *
 * Only the two seams the hook actually depends on are mocked — the
 * repository (M-2.3) and `useOrderRealtime` (M-2.4). Supabase itself is
 * deliberately NOT mocked here: M-2.5 never touches it, and a Supabase stub
 * in this file would imply otherwise (see the "no Supabase duplication"
 * suite at the bottom, which asserts that directly against the source).
 *
 * The `useOrderRealtime` stand-in is a real hook, not a static return value,
 * so that status is React state and the IDLE → CONNECTING → SUBSCRIBED
 * sequence tests see is the same sequence the real M-2.4 produces (it sets
 * `'CONNECTING'` in an effect on every `restaurantId` change, and `'IDLE'`
 * when there is no restaurant).
 */

let listRestaurantOrders: jest.Mock<Promise<MerchantOrderSummary[]>, [string]>;

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: (restaurantId: string) =>
        (
          globalThis as unknown as { __listRestaurantOrders: jest.Mock }
        ).__listRestaurantOrders(restaurantId),
    },
  },
}));

/** Test handles onto the mocked M-2.4 hook. */
let emitEvent: (event: MerchantOrderRealtimeEvent) => void;
let setRealtimeStatus: (status: MerchantOrderRealtimeStatus) => void;
let realtimeRestaurantIds: (string | null)[];

jest.mock('./useOrderRealtime', () => ({
  useOrderRealtime: (
    restaurantId: string | null,
    onEvent: (event: MerchantOrderRealtimeEvent) => void,
  ) =>
    (
      globalThis as unknown as { __useOrderRealtimeMock: (...a: unknown[]) => { status: string } }
    ).__useOrderRealtimeMock(restaurantId, onEvent),
}));

beforeEach(() => {
  listRestaurantOrders = jest.fn();
  (globalThis as unknown as { __listRestaurantOrders: jest.Mock }).__listRestaurantOrders =
    listRestaurantOrders;
  realtimeRestaurantIds = [];

  (
    globalThis as unknown as { __useOrderRealtimeMock: unknown }
  ).__useOrderRealtimeMock = (
    restaurantId: string | null,
    onEvent: (event: MerchantOrderRealtimeEvent) => void,
  ) => {
    const [status, setStatus] = React.useState<MerchantOrderRealtimeStatus>('IDLE');
    const onEventRef = React.useRef(onEvent);
    onEventRef.current = onEvent;

    // Mirrors M-2.4: a restaurant change reports CONNECTING immediately;
    // no restaurant reports IDLE.
    React.useEffect(() => {
      realtimeRestaurantIds.push(restaurantId);
      setStatus(restaurantId ? 'CONNECTING' : 'IDLE');
    }, [restaurantId]);

    emitEvent = (event) => onEventRef.current(event);
    setRealtimeStatus = setStatus;
    return { status };
  };
});

// --------------------------------------------------------------------------
// fixtures / helpers
// --------------------------------------------------------------------------

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'สมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 15000,
    placedAt: '2026-08-31T09:00:00Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A rejection that a test settles before asserting must not surface as an
  // unhandled rejection while it sits unawaited.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Lets the mocked repository's already-settled promise flush into state. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Drives the mocked M-2.4 through the transition that starts the initial fetch. */
async function subscribe(): Promise<void> {
  await act(async () => {
    setRealtimeStatus('SUBSCRIBED');
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

// --------------------------------------------------------------------------
// A. no restaurant
// --------------------------------------------------------------------------

describe('useOrderBoard — no restaurant scoped', () => {
  it('fetches nothing, holds no orders, and is not loading', async () => {
    const { result } = renderHook(() => useOrderBoard(null));
    await flush();

    expect(listRestaurantOrders).not.toHaveBeenCalled();
    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.realtimeStatus).toBe('IDLE');
  });

  it('refetch() is a no-op with nothing scoped', async () => {
    const { result } = renderHook(() => useOrderBoard(null));
    await act(async () => {
      result.current.refetch();
    });

    expect(listRestaurantOrders).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// B/C/D. initial fetch outcomes
// --------------------------------------------------------------------------

describe('useOrderBoard — initial fetch', () => {
  it('waits for the subscription to settle before reading the snapshot (Pattern C)', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();

    // CONNECTING is not a settled status — no snapshot may be read yet.
    expect(result.current.realtimeStatus).toBe('CONNECTING');
    expect(listRestaurantOrders).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledWith('rest-a');
  });

  it('exposes the fetched orders, newest first, scoped to the restaurant', async () => {
    listRestaurantOrders.mockResolvedValue([
      order({ id: 'o-2', placedAt: '2026-08-31T10:00:00Z' }),
      order({ id: 'o-1', placedAt: '2026-08-31T09:00:00Z' }),
    ]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
    expect(listRestaurantOrders).toHaveBeenCalledWith('rest-a');
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-2', 'o-1']);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('re-sorts placed_at DESC even if the snapshot arrives out of order', async () => {
    listRestaurantOrders.mockResolvedValue([
      order({ id: 'o-old', placedAt: '2026-08-31T08:00:00Z' }),
      order({ id: 'o-new', placedAt: '2026-08-31T12:00:00Z' }),
      order({ id: 'o-mid', placedAt: '2026-08-31T10:00:00Z' }),
    ]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-new', 'o-mid', 'o-old']);
  });

  it('breaks placed_at ties deterministically by id', async () => {
    listRestaurantOrders.mockResolvedValue([
      order({ id: 'o-b', placedAt: '2026-08-31T09:00:00Z' }),
      order({ id: 'o-a', placedAt: '2026-08-31T09:00:00Z' }),
    ]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-a', 'o-b']);
  });

  it('an empty restaurant is an empty board, not an error', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(result.current.orders).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('a failed fetch exposes the error and fabricates no orders', async () => {
    listRestaurantOrders.mockRejectedValue(new Error('permission denied for table orders'));
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(result.current.error).toBe('permission denied for table orders');
    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('still reads the snapshot when Realtime fails outright, so the board is not stuck loading', async () => {
    listRestaurantOrders.mockResolvedValue([order({ id: 'o-1' })]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();

    await act(async () => {
      setRealtimeStatus('CHANNEL_ERROR');
    });

    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);
    expect(result.current.realtimeStatus).toBe('CHANNEL_ERROR');
  });
});

// --------------------------------------------------------------------------
// E/F/G. live event reconciliation
// --------------------------------------------------------------------------

describe('useOrderBoard — live events', () => {
  async function mounted(initial: MerchantOrderSummary[] = []) {
    listRestaurantOrders.mockResolvedValue(initial);
    const handle = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    return handle;
  }

  it('INSERT adds the new order', async () => {
    const { result } = await mounted([order({ id: 'o-1', placedAt: '2026-08-31T09:00:00Z' })]);

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-2', placedAt: '2026-08-31T11:00:00Z' }) });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-2', 'o-1']);
  });

  it('INSERT for an id already on the board replaces it instead of duplicating', async () => {
    const { result } = await mounted([order({ id: 'o-1', state: 'PAID' })]);

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-1', state: 'MERCHANT_ACCEPTED' }) });
    });

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0]!.state).toBe('MERCHANT_ACCEPTED');
  });

  it('UPDATE replaces the existing order', async () => {
    const { result } = await mounted([order({ id: 'o-1', state: 'MERCHANT_ACCEPTED' })]);

    await act(async () => {
      emitEvent({
        type: 'UPDATE',
        order: order({ id: 'o-1', state: 'READY_FOR_PICKUP', readyAt: '2026-08-31T09:30:00Z' }),
      });
    });

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0]!.state).toBe('READY_FOR_PICKUP');
    expect(result.current.orders[0]!.readyAt).toBe('2026-08-31T09:30:00Z');
  });

  it('UPDATE for an order the board has never seen adds it', async () => {
    const { result } = await mounted([]);

    await act(async () => {
      emitEvent({ type: 'UPDATE', order: order({ id: 'o-unseen', state: 'PREPARING' }) });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-unseen']);
  });

  it('DELETE removes by orderId alone', async () => {
    const { result } = await mounted([order({ id: 'o-1' }), order({ id: 'o-2' })]);

    await act(async () => {
      emitEvent({ type: 'DELETE', orderId: 'o-1' });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-2']);
  });

  it('DELETE for an unknown id is a no-op, not a crash', async () => {
    const { result } = await mounted([order({ id: 'o-1' })]);

    await act(async () => {
      emitEvent({ type: 'DELETE', orderId: 'o-never-existed' });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);
  });

  it('does not crash on structurally impossible normalized values', async () => {
    const { result } = await mounted([order({ id: 'o-1' })]);

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: '' }) });
      emitEvent({ type: 'DELETE', orderId: '' });
      emitEvent({
        type: 'UPDATE',
        order: undefined as unknown as MerchantOrderSummary,
      });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);
  });

  it('drops an event for a different restaurant — client-state correctness, not a second RLS check', async () => {
    const { result } = await mounted([order({ id: 'o-1' })]);

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-foreign', restaurantId: 'rest-b' }) });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);
  });
});

// --------------------------------------------------------------------------
// H/I. the initial-fetch race — the reconciliation barrier
// --------------------------------------------------------------------------

describe('useOrderBoard — initial-fetch race (reconciliation barrier)', () => {
  it('an INSERT arriving before the snapshot resolves survives, exactly once', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    // t1: event arrives while the fetch is still in flight.
    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-A', placedAt: '2026-08-31T11:00:00Z' }) });
    });
    // Buffered, not applied — the snapshot is not established yet.
    expect(result.current.orders).toEqual([]);

    // t3: the snapshot resolves without order A (it was read before A committed).
    await act(async () => {
      pending.resolve([order({ id: 'o-1', placedAt: '2026-08-31T09:00:00Z' })]);
    });
    await flush();

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-A', 'o-1']);
    expect(result.current.orders.filter((o) => o.id === 'o-A')).toHaveLength(1);
  });

  it('an INSERT already contained in the snapshot is not duplicated by its replay', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-A' }) });
    });
    // The snapshot was read after A committed, so it contains A too.
    await act(async () => {
      pending.resolve([order({ id: 'o-A' })]);
    });
    await flush();

    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0]!.id).toBe('o-A');
  });

  it('an UPDATE arriving during the fetch is not undone by an older snapshot', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    // The order moves forward while the fetch is in flight.
    await act(async () => {
      emitEvent({ type: 'UPDATE', order: order({ id: 'o-1', state: 'PREPARING' }) });
    });

    // The snapshot resolves carrying the OLDER representation.
    await act(async () => {
      pending.resolve([order({ id: 'o-1', state: 'MERCHANT_ACCEPTED' })]);
    });
    await flush();

    // Replay-after-snapshot: the newer state wins without comparing timestamps.
    expect(result.current.orders).toHaveLength(1);
    expect(result.current.orders[0]!.state).toBe('PREPARING');
  });

  it('replays buffered events in commit order, so the last one wins', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      emitEvent({ type: 'UPDATE', order: order({ id: 'o-1', state: 'PREPARING' }) });
      emitEvent({ type: 'UPDATE', order: order({ id: 'o-1', state: 'READY_FOR_PICKUP' }) });
    });
    await act(async () => {
      pending.resolve([order({ id: 'o-1', state: 'PAID' })]);
    });
    await flush();

    expect(result.current.orders[0]!.state).toBe('READY_FOR_PICKUP');
  });

  it('a DELETE buffered during the fetch removes the row the snapshot still contains', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      emitEvent({ type: 'DELETE', orderId: 'o-1' });
    });
    await act(async () => {
      pending.resolve([order({ id: 'o-1' }), order({ id: 'o-2' })]);
    });
    await flush();

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-2']);
  });

  it('does not lose buffered events when the fetch they were buffered behind fails', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-A' }) });
    });
    await act(async () => {
      pending.reject(new Error('network error'));
    });
    await flush();

    expect(result.current.error).toBe('network error');
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-A']);
  });
});

// --------------------------------------------------------------------------
// J. restaurant switch
// --------------------------------------------------------------------------

describe('useOrderBoard — restaurant switch', () => {
  it('discards A state, starts a fresh lifecycle for B, and ignores a delayed A fetch', async () => {
    const fetchA = deferred<MerchantOrderSummary[]>();
    const fetchB = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockImplementation((id: string) =>
      id === 'rest-a' ? fetchA.promise : fetchB.promise,
    );

    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string | null }) => useOrderBoard(restaurantId),
      { initialProps: { restaurantId: 'rest-a' as string | null } },
    );
    await flush();
    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledWith('rest-a');

    // Switch before A's fetch has resolved.
    rerender({ restaurantId: 'rest-b' });
    await flush();
    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(true);

    // The stale SUBSCRIBED repeat from A's channel must not start B's fetch.
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledWith('rest-b');
    expect(listRestaurantOrders).toHaveBeenCalledTimes(2);

    // A's response lands late — it must not touch B's board.
    await act(async () => {
      fetchA.resolve([order({ id: 'o-a1', restaurantId: 'rest-a' })]);
    });
    await flush();
    expect(result.current.orders).toEqual([]);

    await act(async () => {
      fetchB.resolve([order({ id: 'o-b1', restaurantId: 'rest-b' })]);
    });
    await flush();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-b1']);
  });

  it('a delayed event for restaurant A cannot enter restaurant B state', async () => {
    listRestaurantOrders.mockImplementation((id: string) =>
      Promise.resolve([order({ id: `o-${id}`, restaurantId: id })]),
    );

    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string | null }) => useOrderBoard(restaurantId),
      { initialProps: { restaurantId: 'rest-a' as string | null } },
    );
    await flush();
    await subscribe();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-rest-a']);

    rerender({ restaurantId: 'rest-b' });
    await flush();
    await subscribe();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-rest-b']);

    await act(async () => {
      emitEvent({ type: 'INSERT', order: order({ id: 'o-late-a', restaurantId: 'rest-a' }) });
    });

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-rest-b']);
  });

  it('clearing the restaurant empties the board and stops fetching', async () => {
    listRestaurantOrders.mockResolvedValue([order({ id: 'o-1' })]);
    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string | null }) => useOrderBoard(restaurantId),
      { initialProps: { restaurantId: 'rest-a' as string | null } },
    );
    await flush();
    await subscribe();
    expect(result.current.orders).toHaveLength(1);

    rerender({ restaurantId: null });
    await flush();

    expect(result.current.orders).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.realtimeStatus).toBe('IDLE');
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// K/L. refetch concurrency and failure
// --------------------------------------------------------------------------

describe('useOrderBoard — refetch', () => {
  it('an older fetch response cannot overwrite a newer one', async () => {
    const first = deferred<MerchantOrderSummary[]>();
    const second = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      result.current.refetch();
    });
    expect(listRestaurantOrders).toHaveBeenCalledTimes(2);

    // The newer fetch resolves first...
    await act(async () => {
      second.resolve([order({ id: 'o-new' })]);
    });
    await flush();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-new']);

    // ...and the older one, resolving late, is discarded.
    await act(async () => {
      first.resolve([order({ id: 'o-stale' })]);
    });
    await flush();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-new']);
  });

  it('a failed background refetch keeps the last known good board', async () => {
    listRestaurantOrders.mockResolvedValueOnce([order({ id: 'o-1' }), order({ id: 'o-2' })]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    expect(result.current.orders).toHaveLength(2);

    listRestaurantOrders.mockRejectedValueOnce(new Error('fetch failed'));
    await act(async () => {
      result.current.refetch();
    });
    await flush();

    expect(result.current.error).toBe('fetch failed');
    expect(result.current.orders.map((o) => o.id).sort()).toEqual(['o-1', 'o-2']);
    expect(result.current.loading).toBe(false);
  });

  it('a later successful fetch reconciles the board and clears the error', async () => {
    listRestaurantOrders.mockRejectedValueOnce(new Error('fetch failed'));
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    expect(result.current.error).toBe('fetch failed');

    listRestaurantOrders.mockResolvedValueOnce([order({ id: 'o-1' })]);
    await act(async () => {
      result.current.refetch();
    });
    await flush();

    expect(result.current.error).toBeNull();
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);
  });

  it('a refetch snapshot replaces removed orders rather than merging them back', async () => {
    listRestaurantOrders.mockResolvedValueOnce([order({ id: 'o-1' }), order({ id: 'o-2' })]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    listRestaurantOrders.mockResolvedValueOnce([order({ id: 'o-2' })]);
    await act(async () => {
      result.current.refetch();
    });
    await flush();

    expect(result.current.orders.map((o) => o.id)).toEqual(['o-2']);
  });
});

// --------------------------------------------------------------------------
// M. visibility restore
// --------------------------------------------------------------------------

describe('useOrderBoard — visibility restore', () => {
  afterEach(() => {
    setVisibility('visible');
  });

  it('refetches once when the document becomes visible again', async () => {
    listRestaurantOrders.mockResolvedValue([order({ id: 'o-1' })]);
    renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();

    expect(listRestaurantOrders).toHaveBeenCalledTimes(2);
  });

  it('does not poll — staying visible without a transition fetches nothing further', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    setVisibility('visible');
    await act(async () => {
      await Promise.resolve();
    });

    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
  });

  it('does not refetch on visibility restore when no restaurant is scoped', async () => {
    renderHook(() => useOrderBoard(null));
    await flush();

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(listRestaurantOrders).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// N. Realtime reconnect
// --------------------------------------------------------------------------

describe('useOrderBoard — Realtime reconnect', () => {
  it('refetches once when the channel resubscribes after a drop', async () => {
    listRestaurantOrders.mockResolvedValue([order({ id: 'o-1' })]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    await act(async () => {
      setRealtimeStatus('CHANNEL_ERROR');
    });
    expect(result.current.realtimeStatus).toBe('CHANNEL_ERROR');
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    await act(async () => {
      setRealtimeStatus('SUBSCRIBED');
    });
    await flush();

    expect(listRestaurantOrders).toHaveBeenCalledTimes(2);
  });

  it('a repeated SUBSCRIBED notification does not trigger a second fetch', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    await subscribe();
    await subscribe();
    await flush();

    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);
  });

  it('exposes the Realtime status untranslated', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    expect(result.current.realtimeStatus).toBe('CONNECTING');

    await act(async () => {
      setRealtimeStatus('TIMED_OUT');
    });
    expect(result.current.realtimeStatus).toBe('TIMED_OUT');

    await act(async () => {
      setRealtimeStatus('CLOSED');
    });
    expect(result.current.realtimeStatus).toBe('CLOSED');
  });

  it('does not treat a Realtime failure as a fetch error', async () => {
    listRestaurantOrders.mockResolvedValue([order({ id: 'o-1' })]);
    const { result } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    await act(async () => {
      setRealtimeStatus('CHANNEL_ERROR');
    });

    expect(result.current.error).toBeNull();
    expect(result.current.orders).toHaveLength(1);
  });
});

// --------------------------------------------------------------------------
// O. cleanup
// --------------------------------------------------------------------------

describe('useOrderBoard — cleanup', () => {
  it('removes the visibility listener on unmount', async () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    listRestaurantOrders.mockResolvedValue([]);

    const { unmount } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const registered = addSpy.mock.calls.find(([type]) => type === 'visibilitychange')![1];

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', registered);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listRestaurantOrders).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not update state after unmount when an in-flight fetch resolves', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    unmount();
    await act(async () => {
      pending.resolve([order({ id: 'o-1' })]);
    });
    await flush();

    // React logs an "update on an unmounted component" error if state is set
    // after teardown; the guards mean it never is.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does not update state after unmount when an in-flight fetch rejects', async () => {
    const pending = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValue(pending.promise);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderHook(() => useOrderBoard('rest-a'));
    await flush();
    await subscribe();

    unmount();
    await act(async () => {
      pending.reject(new Error('too late'));
    });
    await flush();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// --------------------------------------------------------------------------
// P. no Supabase duplication
// --------------------------------------------------------------------------

describe('useOrderBoard — subscription ownership stays in M-2.4', () => {
  const source = readFileSync(join(__dirname, 'useOrderBoard.ts'), 'utf8');
  /**
   * Comments are stripped before asserting: the hook's own documentation
   * names `.channel()` / `postgres_changes` / `removeChannel` precisely in
   * order to say it does not call them, and an assertion that cannot tell
   * prose from code would fail on the explanation rather than on a real
   * duplication of M-2.4.
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never opens a channel or registers postgres_changes itself', () => {
    expect(code).not.toMatch(/\.channel\(/);
    expect(code).not.toMatch(/postgres_changes/);
    expect(code).not.toMatch(/removeChannel/);
  });

  it('never imports the Supabase client — the repository and M-2.4 are the only seams', () => {
    expect(code).not.toMatch(/from '\.\.\/lib\/supabase'/);
    expect(code).not.toMatch(/@supabase\/supabase-js/);
    expect(code).toMatch(/from '\.\.\/repositories'/);
    expect(code).toMatch(/from '\.\/useOrderRealtime'/);
  });

  it('subscribes exactly once, through useOrderRealtime, per restaurant', async () => {
    listRestaurantOrders.mockResolvedValue([]);
    const { rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string | null }) => useOrderBoard(restaurantId),
      { initialProps: { restaurantId: 'rest-a' as string | null } },
    );
    await flush();
    await subscribe();

    // A re-render with the same restaurant must not re-run the subscription
    // effect (the event callback identity is stable).
    rerender({ restaurantId: 'rest-a' });
    await flush();

    expect(realtimeRestaurantIds).toEqual(['rest-a']);
  });
});

// --------------------------------------------------------------------------
// loading determinism
// --------------------------------------------------------------------------

describe('useOrderBoard — loading is deterministic', () => {
  it('is true from scope until the first fetch settles, and never re-raised by a refetch', async () => {
    const initial = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValueOnce(initial.promise);

    const { result } = renderHook(() => useOrderBoard('rest-a'));
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current.loading).toBe(true);

    await subscribe();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      initial.resolve([order({ id: 'o-1' })]);
    });
    await flush();
    expect(result.current.loading).toBe(false);

    const background = deferred<MerchantOrderSummary[]>();
    listRestaurantOrders.mockReturnValueOnce(background.promise);
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orders.map((o) => o.id)).toEqual(['o-1']);

    await act(async () => {
      background.resolve([]);
    });
    await flush();
    expect(result.current.loading).toBe(false);
  });
});
