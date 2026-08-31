import { act, renderHook } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import { useOrderAlerts } from './useOrderAlerts';

/**
 * `../lib/soundPreference` and `../lib/alertSound` are the only two seams
 * this hook has to the outside world (`localStorage` and `AudioContext`
 * respectively) — both mocked here so these tests exercise only the
 * arrival-detection/repeat logic, the same discipline `OrderBoard.test.tsx`
 * uses for `useOrderBoard`.
 */

const playMock = jest.fn<Promise<{ played: boolean; reason?: string }>, []>();

jest.mock('../lib/alertSound', () => ({
  createAlertPlayer: () => ({ play: () => playMock() }),
}));

let storedPreference = true;
jest.mock('../lib/soundPreference', () => ({
  getSoundPreference: () => storedPreference,
  setSoundPreference: (value: boolean) => {
    storedPreference = value;
  },
}));

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 10000,
    placedAt: new Date().toISOString(),
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-08-31T08:00:00.000Z');

beforeEach(() => {
  storedPreference = true;
  playMock.mockReset();
  playMock.mockResolvedValue({ played: true });
});

describe('useOrderAlerts — arrival detection', () => {
  it('does not alert for orders already PAID at mount', async () => {
    const initial = [order({ id: '1' })];
    renderHook(({ orders }) => useOrderAlerts(orders, NOW), { initialProps: { orders: initial } });
    // The preference-sync effect fires on mount too; give effects a tick.
    await act(async () => {});
    expect(playMock).not.toHaveBeenCalled();
  });

  it('alerts when a genuinely new PAID order arrives', async () => {
    const initial: MerchantOrderSummary[] = [];
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: initial },
    });
    await act(async () => {});
    expect(playMock).not.toHaveBeenCalled();

    const withArrival = [order({ id: '1' })];
    await act(async () => {
      rerender({ orders: withArrival });
    });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('does not retrigger for an unrelated update once nothing is outstanding', async () => {
    const initial = [order({ id: '1', state: 'MERCHANT_ACCEPTED' })];
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: initial },
    });
    await act(async () => {});
    expect(playMock).not.toHaveBeenCalled();

    // Order #1 moves PREPARING -> READY_FOR_PICKUP: a real board event, but
    // nothing PAID was ever introduced, so there is nothing to alert about.
    const updated = [order({ id: '1', state: 'READY_FOR_PICKUP' })];
    await act(async () => {
      rerender({ orders: updated });
    });
    expect(playMock).not.toHaveBeenCalled();
  });

  it('stops alerting once the order is accepted (leaves PAID)', async () => {
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    await act(async () => {
      rerender({ orders: [order({ id: '1' })] });
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ orders: [order({ id: '1', state: 'MERCHANT_ACCEPTED' })] });
    });
    // Accepting is a board event too, but order #1 is no longer PAID and
    // there is no other outstanding order, so no further alert plays.
    expect(playMock).toHaveBeenCalledTimes(1);

    // A later unrelated event confirms it stays resolved.
    await act(async () => {
      rerender({ orders: [order({ id: '1', state: 'PREPARING' })] });
    });
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('repeats while a new arrival remains unresolved and another board event occurs', async () => {
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    await act(async () => {
      rerender({ orders: [order({ id: '1' })] });
    });
    expect(playMock).toHaveBeenCalledTimes(1);

    // A second, unrelated order arrives while #1 is still unresolved: this
    // is itself a genuine board event, and #1 is still outstanding.
    await act(async () => {
      rerender({ orders: [order({ id: '1' }), order({ id: '2', state: 'READY_FOR_PICKUP' })] });
    });
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it('does not play when a new arrival appears while sound is muted', async () => {
    const { result, rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    act(() => {
      result.current.toggleSound(); // ON -> OFF; the confirmation-tone branch is only for turning ON
    });
    expect(result.current.soundEnabled).toBe(false);
    playMock.mockClear();

    await act(async () => {
      rerender({ orders: [order({ id: '1' })] });
    });
    expect(playMock).not.toHaveBeenCalled();
  });

  it('plays at most once per board event even when several orders arrive together (no audio storm)', async () => {
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    await act(async () => {
      rerender({ orders: [order({ id: '1' }), order({ id: '2' }), order({ id: '3' })] });
    });
    expect(playMock).toHaveBeenCalledTimes(1);
  });
});

describe('useOrderAlerts — sound preference', () => {
  it('defaults to the stored preference (ON)', async () => {
    const { result } = renderHook(() => useOrderAlerts([], NOW));
    await act(async () => {});
    expect(result.current.soundEnabled).toBe(true);
  });

  it('starts muted when the stored preference is OFF', async () => {
    storedPreference = false;
    const { result } = renderHook(() => useOrderAlerts([], NOW));
    await act(async () => {});
    expect(result.current.soundEnabled).toBe(false);
  });

  it('toggling ON attempts a play (the unlock/confirmation gesture) and reports a blocked context honestly', async () => {
    storedPreference = false;
    playMock.mockResolvedValue({ played: false, reason: 'blocked' });
    const { result } = renderHook(() => useOrderAlerts([], NOW));
    await act(async () => {});

    await act(async () => {
      result.current.toggleSound();
    });

    expect(result.current.soundEnabled).toBe(true);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(result.current.audioBlocked).toBe(true);
  });
});

describe('useOrderAlerts — counts', () => {
  it('exposes waitingCount as the PAID count and todayCount as the Bangkok-today count', async () => {
    const orders = [
      order({ id: '1', state: 'PAID', placedAt: '2026-08-31T02:00:00.000Z' }),
      order({ id: '2', state: 'MERCHANT_ACCEPTED', placedAt: '2026-08-31T02:00:00.000Z' }),
      order({ id: '3', state: 'DELIVERED', placedAt: '2026-08-30T02:00:00.000Z' }),
    ];
    const { result } = renderHook(() => useOrderAlerts(orders, NOW));
    await act(async () => {});
    expect(result.current.waitingCount).toBe(1);
    expect(result.current.todayCount).toBe(2);
  });
});

describe('useOrderAlerts — document title', () => {
  const originalTitle = document.title;

  afterEach(() => {
    document.title = originalTitle;
  });

  it('shows the base title when nothing is waiting', async () => {
    document.title = 'irrelevant starting title';
    renderHook(() => useOrderAlerts([], NOW));
    await act(async () => {});
    expect(document.title).toBe('ออเดอร์วันนี้ — BANHAO');
  });

  it('shows the waiting count when one or more orders are waiting', async () => {
    document.title = 'irrelevant starting title';
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    await act(async () => {
      rerender({ orders: [order({ id: '1' }), order({ id: '2' })] });
    });
    expect(document.title).toBe('(2) ออเดอร์วันนี้ — BANHAO');
  });

  it('restores the true original title on unmount, not an intermediate one', async () => {
    document.title = 'the real original title';
    const { rerender, unmount } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {});

    await act(async () => {
      rerender({ orders: [order({ id: '1' })] });
    });
    expect(document.title).toBe('(1) ออเดอร์วันนี้ — BANHAO');

    unmount();
    expect(document.title).toBe('the real original title');
  });
});

describe('useOrderAlerts — no timer APIs', () => {
  it('never calls setInterval', async () => {
    const intervalSpy = jest.spyOn(window, 'setInterval');
    const { rerender } = renderHook(({ orders }) => useOrderAlerts(orders, NOW), {
      initialProps: { orders: [] as MerchantOrderSummary[] },
    });
    await act(async () => {
      rerender({ orders: [order({ id: '1' })] });
    });
    await act(async () => {
      rerender({ orders: [order({ id: '1', state: 'MERCHANT_ACCEPTED' })] });
    });
    expect(intervalSpy).not.toHaveBeenCalled();
    intervalSpy.mockRestore();
  });
});
