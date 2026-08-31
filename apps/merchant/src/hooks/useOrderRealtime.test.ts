import { renderHook, act } from '@testing-library/react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useOrderRealtime, type MerchantOrderRealtimeEvent } from './useOrderRealtime';

/**
 * M-2.4's Realtime subscription seam. These tests stub only the channel
 * surface the hook actually calls (`channel`, `removeChannel`, `on`,
 * `subscribe`) — the same shape `@supabase/realtime-js@2.112.2`'s installed
 * `RealtimeChannel`/`SupabaseClient` typings expose (`channel(name)`,
 * `channel.on('postgres_changes', filter, callback)`,
 * `channel.subscribe(statusCallback)`, `REALTIME_SUBSCRIBE_STATES`), not an
 * invented API. Mirrors `useAuth.test.tsx`'s `jest.mock('../lib/supabase', …)`
 * style.
 */

type PostgresChangesHandler = (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
type StatusHandler = (status: REALTIME_SUBSCRIBE_STATES) => void;

interface FakeChannel {
  name: string;
  onFilter: { event: string; schema: string; table: string; filter: string } | null;
  handler: PostgresChangesHandler | null;
  statusHandler: StatusHandler | null;
  on: jest.Mock;
  subscribe: jest.Mock;
}

function makeFakeChannel(name: string): FakeChannel {
  const fake: FakeChannel = {
    name,
    onFilter: null,
    handler: null,
    statusHandler: null,
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  fake.on.mockImplementation((_type: string, filter: FakeChannel['onFilter'], cb: PostgresChangesHandler) => {
    fake.onFilter = filter;
    fake.handler = cb;
    return fake;
  });
  fake.subscribe.mockImplementation((cb: StatusHandler) => {
    fake.statusHandler = cb;
    return fake;
  });
  return fake;
}

let calls: string[];
let channels: Record<string, FakeChannel>;
let channelMock: jest.Mock;
let removeChannelMock: jest.Mock;

jest.mock('../lib/supabase', () => ({
  supabase: {
    channel: (...args: unknown[]) => (globalThis as unknown as { __channelMock: jest.Mock }).__channelMock(...args),
    removeChannel: (...args: unknown[]) =>
      (globalThis as unknown as { __removeChannelMock: jest.Mock }).__removeChannelMock(...args),
  },
}));

beforeEach(() => {
  calls = [];
  channels = {};
  channelMock = jest.fn((name: string) => {
    calls.push(`channel:${name}`);
    const fake = makeFakeChannel(name);
    channels[name] = fake;
    return fake;
  });
  removeChannelMock = jest.fn((channel: FakeChannel) => {
    calls.push(`removeChannel:${channel.name}`);
    return Promise.resolve('ok');
  });
  (globalThis as unknown as { __channelMock: jest.Mock }).__channelMock = channelMock;
  (globalThis as unknown as { __removeChannelMock: jest.Mock }).__removeChannelMock = removeChannelMock;
});

const ORDER_ROW = {
  id: 'order-1',
  order_number: 'BH-20260831-0001',
  state: 'MERCHANT_ACCEPTED',
  restaurant_id: 'rest-1',
  recipient_name_snapshot: 'สมชาย ใจดี',
  recipient_phone_snapshot: '+66812345678',
  grand_total_satang: 15000,
  placed_at: '2026-08-31T09:00:00Z',
  accepted_at: '2026-08-31T09:02:00Z',
  ready_at: null,
  picked_up_at: null,
};

const BASE_PAYLOAD = {
  schema: 'public',
  table: 'orders',
  commit_timestamp: '2026-08-31T09:02:00Z',
  errors: [],
};

describe('useOrderRealtime — no restaurant', () => {
  it('creates no channel and reports IDLE when restaurantId is null', () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useOrderRealtime(null, onEvent));

    expect(channelMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('IDLE');
  });
});

describe('useOrderRealtime — initial subscription', () => {
  it('creates a deterministic restaurant-scoped channel and registers postgres_changes with the restaurant filter', () => {
    const onEvent = jest.fn();
    renderHook(() => useOrderRealtime('rest-1', onEvent));

    expect(channelMock).toHaveBeenCalledWith('merchant-orders:rest-1');
    const fake = channels['merchant-orders:rest-1']!;
    expect(fake.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: 'restaurant_id=eq.rest-1',
      }),
      expect.any(Function),
    );
    expect(fake.subscribe).toHaveBeenCalled();
  });

  it('reports CONNECTING immediately, before any status callback fires', () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useOrderRealtime('rest-1', onEvent));

    expect(result.current.status).toBe('CONNECTING');
  });
});

describe('useOrderRealtime — INSERT / UPDATE / DELETE normalization', () => {
  it('emits a normalized INSERT event with the mapped MerchantOrderSummary', () => {
    const onEvent = jest.fn<void, [MerchantOrderRealtimeEvent]>();
    renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    act(() => {
      fake.handler!({ ...BASE_PAYLOAD, eventType: 'INSERT', new: ORDER_ROW, old: {} } as RealtimePostgresChangesPayload<
        Record<string, unknown>
      >);
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'INSERT',
      order: {
        id: 'order-1',
        orderNumber: 'BH-20260831-0001',
        state: 'MERCHANT_ACCEPTED',
        restaurantId: 'rest-1',
        recipientNameSnapshot: 'สมชาย ใจดี',
        recipientPhoneSnapshot: '+66812345678',
        grandTotalSatang: 15000,
        placedAt: '2026-08-31T09:00:00Z',
        acceptedAt: '2026-08-31T09:02:00Z',
        readyAt: null,
        pickedUpAt: null,
      },
    });
  });

  it('emits a normalized UPDATE event with the mapped MerchantOrderSummary', () => {
    const onEvent = jest.fn<void, [MerchantOrderRealtimeEvent]>();
    renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;
    const updatedRow = { ...ORDER_ROW, state: 'READY_FOR_PICKUP', ready_at: '2026-08-31T09:10:00Z' };

    act(() => {
      fake.handler!({
        ...BASE_PAYLOAD,
        eventType: 'UPDATE',
        new: updatedRow,
        old: { id: 'order-1' },
      } as RealtimePostgresChangesPayload<Record<string, unknown>>);
    });

    expect(onEvent).toHaveBeenCalledWith({
      type: 'UPDATE',
      order: expect.objectContaining({ id: 'order-1', state: 'READY_FOR_PICKUP', readyAt: '2026-08-31T09:10:00Z' }),
    });
  });

  it('emits a DELETE event with only the order id — never a fabricated full order', () => {
    const onEvent = jest.fn<void, [MerchantOrderRealtimeEvent]>();
    renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    act(() => {
      fake.handler!({
        ...BASE_PAYLOAD,
        eventType: 'DELETE',
        new: {},
        // REPLICA IDENTITY DEFAULT: only the primary key survives into `old`.
        old: { id: 'order-1' },
      } as RealtimePostgresChangesPayload<Record<string, unknown>>);
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({ type: 'DELETE', orderId: 'order-1' });
    const emitted = onEvent.mock.calls[0]![0];
    expect(emitted).not.toHaveProperty('order');
  });
});

describe('useOrderRealtime — malformed payloads', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('drops a malformed INSERT/UPDATE record without emitting a fabricated order', () => {
    const onEvent = jest.fn();
    renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    act(() => {
      fake.handler!({
        ...BASE_PAYLOAD,
        eventType: 'INSERT',
        new: { id: 'order-2' /* missing every other required field */ },
        old: {},
      } as RealtimePostgresChangesPayload<Record<string, unknown>>);
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('drops a DELETE payload with no usable id', () => {
    const onEvent = jest.fn();
    renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    act(() => {
      fake.handler!({
        ...BASE_PAYLOAD,
        eventType: 'DELETE',
        new: {},
        old: {},
      } as RealtimePostgresChangesPayload<Record<string, unknown>>);
    });

    expect(onEvent).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('useOrderRealtime — restaurant switch ordering', () => {
  it('removes the old channel before creating the new one on a restaurant switch', () => {
    const onEvent = jest.fn();
    const { rerender } = renderHook(({ restaurantId }) => useOrderRealtime(restaurantId, onEvent), {
      initialProps: { restaurantId: 'rest-a' },
    });

    expect(calls).toEqual(['channel:merchant-orders:rest-a']);

    rerender({ restaurantId: 'rest-b' });

    expect(calls).toEqual([
      'channel:merchant-orders:rest-a',
      'removeChannel:merchant-orders:rest-a',
      'channel:merchant-orders:rest-b',
    ]);
    expect(channels['merchant-orders:rest-b']!.subscribe).toHaveBeenCalled();
  });

  it('does not mutate the old channel filter — a switch always creates a distinct channel object', () => {
    const onEvent = jest.fn();
    const { rerender } = renderHook(({ restaurantId }) => useOrderRealtime(restaurantId, onEvent), {
      initialProps: { restaurantId: 'rest-a' },
    });
    const channelA = channels['merchant-orders:rest-a']!;

    rerender({ restaurantId: 'rest-b' });
    const channelB = channels['merchant-orders:rest-b']!;

    expect(channelA).not.toBe(channelB);
    expect(channelB.onFilter?.filter).toBe('restaurant_id=eq.rest-b');
  });

  it('removes the channel and reports IDLE when restaurantId becomes null', () => {
    const onEvent = jest.fn();
    const { result, rerender } = renderHook(
      ({ restaurantId }: { restaurantId: string | null }) => useOrderRealtime(restaurantId, onEvent),
      { initialProps: { restaurantId: 'rest-a' as string | null } },
    );

    rerender({ restaurantId: null });

    expect(calls).toEqual(['channel:merchant-orders:rest-a', 'removeChannel:merchant-orders:rest-a']);
    expect(result.current.status).toBe('IDLE');
  });
});

describe('useOrderRealtime — unmount cleanup', () => {
  it('removes the channel exactly once on unmount', () => {
    const onEvent = jest.fn();
    const { unmount } = renderHook(() => useOrderRealtime('rest-1', onEvent));

    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).toHaveBeenCalledWith(channels['merchant-orders:rest-1']);

    // Unmounting again (React never does this, but a strict test should
    // confirm the effect's own cleanup isn't reentered) does not add a
    // second removal.
    unmount();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });
});

describe('useOrderRealtime — status', () => {
  it('transitions CONNECTING -> SUBSCRIBED using the installed REALTIME_SUBSCRIBE_STATES value', () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    expect(result.current.status).toBe('CONNECTING');

    act(() => {
      fake.statusHandler!(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
    });
    expect(result.current.status).toBe(REALTIME_SUBSCRIBE_STATES.SUBSCRIBED);
  });

  it('surfaces CLOSED and CHANNEL_ERROR exactly as the SDK reports them', () => {
    const onEvent = jest.fn();
    const { result } = renderHook(() => useOrderRealtime('rest-1', onEvent));
    const fake = channels['merchant-orders:rest-1']!;

    act(() => {
      fake.statusHandler!(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);
    });
    expect(result.current.status).toBe(REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR);

    act(() => {
      fake.statusHandler!(REALTIME_SUBSCRIBE_STATES.CLOSED);
    });
    expect(result.current.status).toBe(REALTIME_SUBSCRIBE_STATES.CLOSED);
  });
});
