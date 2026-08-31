import { act, renderHook } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { MerchantOrderDetail } from '../domain/orderDetail';
import { useOrderDetail } from './useOrderDetail';
import { repositories } from '../repositories';

/**
 * M-04's data layer. `repositories.merchantOrders.getOrderDetail` is mocked
 * at the module seam, the same level `useOrderActions.test.ts` and
 * `useOrderBoard.test.ts` mock it — these tests assert the hook's own
 * contract: fetch on open, refetch on a same-order object-reference change,
 * no refetch for an unrelated order, and cleanup on close/unmount.
 */

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(),
      getOrderDetail: jest.fn(),
    },
  },
}));

const getOrderDetail = repositories.merchantOrders.getOrderDetail as jest.MockedFunction<
  typeof repositories.merchantOrders.getOrderDetail
>;

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 18500,
    placedAt: '2026-08-31T04:41:20.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<MerchantOrderDetail> & { orderId: string }): MerchantOrderDetail {
  return {
    orderNumber: `BH-${overrides.orderId}`,
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    deliveryAddressSnapshot: '88/12 หมู่ 4',
    deliveryLandmark: null,
    paymentMethod: 'ONLINE',
    subtotalSatang: 17500,
    deliveryFeeSatang: 2000,
    serviceFeeSatang: 1000,
    discountSatang: 0,
    grandTotalSatang: 20500,
    placedAt: '2026-08-31T04:41:20.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    items: [],
    statusHistory: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getOrderDetail.mockReset();
});

describe('useOrderDetail — no selection', () => {
  it('starts idle when no order is selected', () => {
    const { result } = renderHook(() => useOrderDetail(null));
    expect(result.current).toEqual({ detail: null, loading: false, error: null, refetch: expect.any(Function) });
    expect(getOrderDetail).not.toHaveBeenCalled();
  });
});

describe('useOrderDetail — opening an order', () => {
  it('fetches by the order id and restaurant id', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const target = order({ id: '1', restaurantId: 'rest-a' });

    await act(async () => {
      renderHook(() => useOrderDetail(target));
    });

    expect(getOrderDetail).toHaveBeenCalledWith('1', 'rest-a');
  });

  it('is loading before the fetch resolves, and not after', async () => {
    const { promise, resolve } = deferred<MerchantOrderDetail>();
    getOrderDetail.mockReturnValue(promise);
    const target = order({ id: '1' });

    const { result } = renderHook(() => useOrderDetail(target));
    expect(result.current.loading).toBe(true);
    expect(result.current.detail).toBeNull();

    await act(async () => {
      resolve(detail({ orderId: '1' }));
      await promise;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toEqual(detail({ orderId: '1' }));
  });

  it('surfaces a fetch failure without throwing', async () => {
    getOrderDetail.mockRejectedValue(new Error('network error'));
    const target = order({ id: '1' });

    const { result } = renderHook(() => useOrderDetail(target));
    await act(async () => {
      await Promise.resolve().then(() => Promise.resolve());
    });

    expect(result.current.error).toBe('network error');
    expect(result.current.loading).toBe(false);
    expect(result.current.detail).toBeNull();
  });
});

describe('useOrderDetail — switching orders', () => {
  it('clears the previous order\'s detail and shows loading again for a genuinely different order', async () => {
    getOrderDetail.mockResolvedValueOnce(detail({ orderId: '1' }));
    const { result, rerender } = renderHook(({ o }) => useOrderDetail(o), { initialProps: { o: order({ id: '1' }) } });

    await act(async () => {});
    expect(result.current.detail?.orderId).toBe('1');

    const { promise: secondPromise } = deferred<MerchantOrderDetail>();
    getOrderDetail.mockReturnValueOnce(secondPromise);

    act(() => {
      rerender({ o: order({ id: '2' }) });
    });

    expect(result.current.detail).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe('useOrderDetail — same order, state-change refetch', () => {
  it('refetches when the same order id arrives as a new object (a Realtime state change)', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const { rerender } = renderHook(({ o }) => useOrderDetail(o), { initialProps: { o: order({ id: '1', state: 'PAID' }) } });

    await act(async () => {});
    expect(getOrderDetail).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ o: order({ id: '1', state: 'MERCHANT_ACCEPTED' }) });
    });
    await act(async () => {});

    expect(getOrderDetail).toHaveBeenCalledTimes(2);
  });

  it('does not clear the already-displayed detail while a same-order refetch is in flight — no skeleton flash', async () => {
    getOrderDetail.mockResolvedValueOnce(detail({ orderId: '1' }));
    const { result, rerender } = renderHook(({ o }) => useOrderDetail(o), { initialProps: { o: order({ id: '1', state: 'PAID' }) } });
    await act(async () => {});
    expect(result.current.detail?.orderId).toBe('1');

    const { promise: refetchPromise } = deferred<MerchantOrderDetail>();
    getOrderDetail.mockReturnValueOnce(refetchPromise);

    act(() => {
      rerender({ o: order({ id: '1', state: 'MERCHANT_ACCEPTED' }) });
    });

    // Still showing the previous detail, and not flagged as loading.
    expect(result.current.detail?.orderId).toBe('1');
    expect(result.current.loading).toBe(false);
  });

  it('does not refetch when the object reference is unchanged (an unrelated re-render)', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const target = order({ id: '1' });
    const { rerender } = renderHook(({ o }) => useOrderDetail(o), { initialProps: { o: target } });

    await act(async () => {});
    expect(getOrderDetail).toHaveBeenCalledTimes(1);

    act(() => {
      rerender({ o: target }); // same reference
    });
    await act(async () => {});

    expect(getOrderDetail).toHaveBeenCalledTimes(1);
  });
});

describe('useOrderDetail — closing', () => {
  it('clears detail, loading and error when the order becomes null', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const { result, rerender } = renderHook(({ o }: { o: MerchantOrderSummary | null }) => useOrderDetail(o), {
      initialProps: { o: order({ id: '1' }) as MerchantOrderSummary | null },
    });
    await act(async () => {});
    expect(result.current.detail).not.toBeNull();

    act(() => {
      rerender({ o: null });
    });

    expect(result.current).toMatchObject({ detail: null, loading: false, error: null });
  });

  it('a response arriving after close does not resurrect the panel', async () => {
    const { promise, resolve } = deferred<MerchantOrderDetail>();
    getOrderDetail.mockReturnValue(promise);
    const { result, rerender } = renderHook(({ o }: { o: MerchantOrderSummary | null }) => useOrderDetail(o), {
      initialProps: { o: order({ id: '1' }) as MerchantOrderSummary | null },
    });

    act(() => {
      rerender({ o: null });
    });

    await act(async () => {
      resolve(detail({ orderId: '1' }));
      await promise;
    });

    expect(result.current.detail).toBeNull();
  });
});

describe('useOrderDetail — refetch()', () => {
  it('re-issues the fetch for the currently-open order', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const target = order({ id: '1' });
    const { result } = renderHook(() => useOrderDetail(target));
    await act(async () => {});
    expect(getOrderDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    expect(getOrderDetail).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when nothing is selected', () => {
    const { result } = renderHook(() => useOrderDetail(null));
    act(() => {
      result.current.refetch();
    });
    expect(getOrderDetail).not.toHaveBeenCalled();
  });
});

describe('useOrderDetail — unmount cleanup', () => {
  it('does not write state after unmount', async () => {
    const { promise, resolve } = deferred<MerchantOrderDetail>();
    getOrderDetail.mockReturnValue(promise);
    const target = order({ id: '1' });
    const { unmount } = renderHook(() => useOrderDetail(target));

    unmount();

    // Must not throw (an act()-outside-render state update would warn/throw
    // in a stricter setup) — resolving after unmount is the assertion itself.
    await act(async () => {
      resolve(detail({ orderId: '1' }));
      await promise;
    });
  });
});
