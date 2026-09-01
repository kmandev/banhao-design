import { act, renderHook, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary, OrderState } from '../domain/order';
import { useOrderActions } from './useOrderActions';
import { repositories } from '../repositories';

/**
 * M-2.7's action-state layer. The repository is mocked at the module seam —
 * the same level `useOrderBoard.test.ts` mocks it — so these tests assert the
 * hook's own contract: one in-flight command per card, no fabricated state,
 * and a pending flag that resolves on the *order's state changing* rather
 * than on the HTTP response.
 */

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(),
    },
  },
}));

const transitionOrder = repositories.merchantOrders.transitionOrder as jest.MockedFunction<
  typeof repositories.merchantOrders.transitionOrder
>;

function order(id: string, state: OrderState): MerchantOrderSummary {
  return {
    id,
    orderNumber: `BH-${id}`,
    state,
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 18500,
    placedAt: '2026-08-31T04:41:20.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
  };
}

/** A promise whose settlement this test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OK = { orderId: 'o1', state: 'MERCHANT_ACCEPTED' };
/** M-05: accept now carries a prep time. */
const ACCEPT = { command: 'accept', prepMinutes: 20 } as const;

beforeEach(() => {
  jest.clearAllMocks();
  transitionOrder.mockResolvedValue(OK);
});

describe('useOrderActions — issuing a command', () => {
  it('calls the repository with the order id and command', async () => {
    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    act(() => result.current.runAction(paid, ACCEPT));

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledWith('o1', ACCEPT));
  });

  it('marks only the acted-on card pending', async () => {
    const gate = deferred<typeof OK>();
    transitionOrder.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useOrderActions());
    const acted = order('o1', 'PAID');
    const other = order('o2', 'PAID');

    act(() => result.current.runAction(acted, ACCEPT));

    await waitFor(() => expect(result.current.isPending(acted)).toBe(true));
    expect(result.current.isPending(other)).toBe(false);

    await act(async () => {
      gate.resolve(OK);
    });
  });
});

describe('useOrderActions — duplicate submission', () => {
  it('ignores a second press while the same command is unresolved', async () => {
    const gate = deferred<typeof OK>();
    transitionOrder.mockReturnValue(gate.promise);

    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    act(() => {
      result.current.runAction(paid, ACCEPT);
      result.current.runAction(paid, ACCEPT);
    });
    act(() => result.current.runAction(paid, ACCEPT));

    expect(transitionOrder).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(OK);
    });
  });

  it('still allows the next, different command once the order has moved on', async () => {
    const { result } = renderHook(() => useOrderActions());

    act(() => result.current.runAction(order('o1', 'PAID'), ACCEPT));
    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(1));

    // Realtime has since moved the order; the same card now offers a
    // different command and must not be blocked by the previous one.
    act(() => result.current.runAction(order('o1', 'MERCHANT_ACCEPTED'), { command: 'start-preparing' }));

    await waitFor(() => expect(transitionOrder).toHaveBeenCalledTimes(2));
    expect(transitionOrder).toHaveBeenLastCalledWith('o1', { command: 'start-preparing' });
  });
});

describe('useOrderActions — success does not fabricate state', () => {
  it('keeps the card pending after the request succeeds, while its state is unchanged', async () => {
    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });

    // HTTP has resolved, but the board has not yet seen the Realtime UPDATE.
    expect(transitionOrder).toHaveBeenCalledTimes(1);
    expect(result.current.isPending(paid)).toBe(true);
  });

  it('resolves pending only when the order state actually changes', async () => {
    const { result } = renderHook(() => useOrderActions());

    await act(async () => {
      result.current.runAction(order('o1', 'PAID'), ACCEPT);
    });

    expect(result.current.isPending(order('o1', 'PAID'))).toBe(true);
    // The same order, as Realtime now reports it.
    expect(result.current.isPending(order('o1', 'MERCHANT_ACCEPTED'))).toBe(false);
  });

  it('records no error on success', async () => {
    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });

    expect(result.current.errorFor(paid)).toBeNull();
  });
});

describe('useOrderActions — failure', () => {
  it('clears pending and exposes Thai copy for the code', async () => {
    transitionOrder.mockRejectedValue(Object.assign(new Error('nope'), { code: 'INVALID_TRANSITION' }));

    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });

    expect(result.current.isPending(paid)).toBe(false);
    expect(result.current.errorFor(paid)).toBe('ออเดอร์นี้ถูกเปลี่ยนสถานะไปแล้ว · กระดานจะอัปเดตเอง');
  });

  it('falls back to generic copy for an unrecognised failure', async () => {
    transitionOrder.mockRejectedValue(new Error('socket hang up'));

    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });

    expect(result.current.errorFor(paid)).toBe('ทำรายการไม่สำเร็จ · ลองอีกครั้ง');
  });

  it('allows a retry after a failure, and clears the message when the retry starts', async () => {
    transitionOrder.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useOrderActions());
    const paid = order('o1', 'PAID');

    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });
    expect(result.current.errorFor(paid)).not.toBeNull();

    transitionOrder.mockResolvedValue(OK);
    await act(async () => {
      result.current.runAction(paid, ACCEPT);
    });

    expect(transitionOrder).toHaveBeenCalledTimes(2);
    expect(result.current.errorFor(paid)).toBeNull();
    expect(result.current.isPending(paid)).toBe(true);
  });

  it('leaves other cards unaffected by one card failing', async () => {
    transitionOrder.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useOrderActions());
    const failed = order('o1', 'PAID');
    const other = order('o2', 'PAID');

    await act(async () => {
      result.current.runAction(failed, ACCEPT);
    });

    expect(result.current.errorFor(other)).toBeNull();
    expect(result.current.isPending(other)).toBe(false);
  });

  it('drops a failure message once the order state moves on', async () => {
    transitionOrder.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useOrderActions());

    await act(async () => {
      result.current.runAction(order('o1', 'PAID'), ACCEPT);
    });

    expect(result.current.errorFor(order('o1', 'PAID'))).not.toBeNull();
    expect(result.current.errorFor(order('o1', 'MERCHANT_ACCEPTED'))).toBeNull();
  });
});
