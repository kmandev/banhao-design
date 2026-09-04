import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MerchantOrderSummary } from '../domain/order';
import type { MerchantOrderDetail } from '../domain/orderDetail';
import type { UseOrderBoard } from '../hooks/useOrderBoard';
import { OrderBoard } from './OrderBoard';
import { repositories } from '../repositories';

/**
 * M-04 board-integration tests — a separate file from `OrderBoard.test.tsx`
 * and `OrderBoard.headerAlerts.test.tsx`, so their existing, already-passing
 * M-2.6/M-2.7/M-03 coverage is left completely untouched.
 *
 * Same mocking boundary those files already draw: `useOrderBoard` is
 * mocked; `repositories.merchantOrders.getOrderDetail` is mocked at the
 * module seam for `useOrderDetail`/`OrderDetailPanel`; sound/localStorage
 * are mocked the same way `OrderBoard.headerAlerts.test.tsx` mocks them, so
 * `useOrderAlerts` (already wired into `OrderBoard`) does not interfere.
 */

let mockUseOrderBoard: jest.Mock<UseOrderBoard, [string | null]>;

jest.mock('../hooks/useOrderBoard', () => ({
  useOrderBoard: (restaurantId: string | null) =>
    (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock(restaurantId),
}));

jest.mock('../lib/alertSound', () => ({
  createAlertPlayer: () => ({ play: () => Promise.resolve({ played: true }) }),
}));

jest.mock('../lib/soundPreference', () => ({
  getSoundPreference: () => true,
  setSoundPreference: () => {},
}));

jest.mock('../repositories', () => ({
  repositories: {
    merchantOrders: {
      listRestaurantOrders: jest.fn(),
      transitionOrder: jest.fn(() => new Promise(() => {})), // never resolves — the test asserts no panel opens, not the transition's outcome
      getOrderDetail: jest.fn(),
    },
    // M-13. Never resolves — irrelevant to M-04's own panel tests.
    merchantAvailability: {
      getAvailability: jest.fn(() => new Promise(() => {})),
      setAvailability: jest.fn(() => new Promise(() => {})),
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
    placedAt: new Date(Date.now() - 60_000).toISOString(),
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
    placedAt: new Date(Date.now() - 60_000).toISOString(),
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    items: [],
    statusHistory: [],
    ...overrides,
  };
}

function boardState(overrides: Partial<UseOrderBoard>): UseOrderBoard {
  return {
    orders: [],
    loading: false,
    error: null,
    realtimeStatus: 'SUBSCRIBED',
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockUseOrderBoard = jest.fn();
  (globalThis as unknown as { __useOrderBoardMock: jest.Mock }).__useOrderBoardMock = mockUseOrderBoard;
  getOrderDetail.mockReset();
});

describe('OrderBoard — opening detail from a card', () => {
  it('clicking a card opens the panel with that card\'s order number', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `#BH-1` })).toBeInTheDocument();
    await waitFor(() => expect(getOrderDetail).toHaveBeenCalledWith('1', 'rest-a'));
  });

  it('the board stays mounted and its columns remain rendered behind the panel', () => {
    getOrderDetail.mockReturnValue(new Promise(() => {}));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));

    expect(screen.getByRole('heading', { name: 'ใหม่ · รอตอบรับ' })).toBeInTheDocument();
    expect(screen.getByTestId('order-card-1')).toBeInTheDocument();
  });

  it('the M-03 header (connection pill, sound, today count) remains intact with the panel open', () => {
    getOrderDetail.mockReturnValue(new Promise(() => {}));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));

    expect(screen.getByText('เชื่อมต่ออยู่')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เสียงแจ้งเตือน · เปิด' })).toBeInTheDocument();
  });

  it('the selected card is visually marked (aria-expanded)', () => {
    getOrderDetail.mockReturnValue(new Promise(() => {}));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    const openButton = screen.getByRole('button', { name: /เปิดรายละเอียด/ });
    expect(openButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(openButton);
    expect(openButton).toHaveAttribute('aria-expanded', 'true');
  });

  // Since M-05 the accept button opens its own confirmation dialog. The
  // assertion this test has always made — that it never opens the *detail
  // panel* — is unchanged; only the negative is now specific, because the
  // two overlays are distinguishable and must never both be present.
  it('clicking the action button (accept) opens M-05, never the detail panel', () => {
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1', state: 'PAID' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'รับออเดอร์' }));

    expect(screen.queryByTestId('order-detail-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('accept-confirm-dialog')).toBeInTheDocument();
    expect(getOrderDetail).not.toHaveBeenCalled();
  });
});

describe('OrderBoard — closing and switching', () => {
  it('closing clears the selection', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่างรายละเอียด' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('switching from order A to order B loads B', async () => {
    getOrderDetail.mockImplementation((orderId: string) => Promise.resolve(detail({ orderId })));
    mockUseOrderBoard.mockReturnValue(
      boardState({ orders: [order({ id: '1' }), order({ id: '2', state: 'MERCHANT_ACCEPTED', acceptedAt: new Date().toISOString() })] }),
    );
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: 'เปิดรายละเอียด ออเดอร์ #BH-1' }));
    await waitFor(() => expect(getOrderDetail).toHaveBeenCalledWith('1', 'rest-a'));

    fireEvent.click(screen.getByRole('button', { name: 'เปิดรายละเอียด ออเดอร์ #BH-2' }));
    await waitFor(() => expect(getOrderDetail).toHaveBeenCalledWith('2', 'rest-a'));

    expect(screen.getByRole('heading', { name: '#BH-2' })).toBeInTheDocument();
  });

  it('a restaurant switch closes the panel', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })] }));
    const { rerender } = render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    mockUseOrderBoard.mockReturnValue(boardState({ orders: [] }));
    act(() => {
      rerender(<OrderBoard restaurantId="rest-b" />);
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('OrderBoard — no board reload while the panel is open', () => {
  it('does not call refetch as a side effect of opening the panel', async () => {
    getOrderDetail.mockResolvedValue(detail({ orderId: '1' }));
    const refetch = jest.fn();
    mockUseOrderBoard.mockReturnValue(boardState({ orders: [order({ id: '1' })], refetch }));
    render(<OrderBoard restaurantId="rest-a" />);

    fireEvent.click(screen.getByRole('button', { name: /เปิดรายละเอียด/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    expect(refetch).not.toHaveBeenCalled();
  });
});
