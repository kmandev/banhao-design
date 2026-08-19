import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OrderDetailScreen } from './OrderDetailScreen';
import { repositories } from '../repositories';
import type { OrderDetail } from '../domain/order';
import type { OrderDetailRepository } from '../repositories/types';

/**
 * Phase E-3B.1 — `OrderDetailScreen` against a stubbed `orderDetail`
 * repository. The repository's own Supabase-query correctness is covered by
 * `repositories/supabaseOrderDetail.test.ts`; this file is about the screen:
 * does it render what the repository gives it, in each of loading / success /
 * not-found / error, and does refresh actually call the repository again.
 *
 * The `repositories` singleton is monkey-patched directly rather than via
 * `jest.mock`, matching `__tests__/order-creation.test.tsx`'s own `stub()` —
 * a `jest.mock` factory here would reference `mockGetOrder` before jest's
 * hoisted `jest.mock` call runs relative to the `OrderDetailScreen` import
 * that transitively requires `../repositories`.
 */

const mockGetOrder = jest.fn();

function stub() {
  const orderDetailRepo: OrderDetailRepository = { getOrder: mockGetOrder };
  (repositories as unknown as { orderDetail: OrderDetailRepository }).orderDetail = orderDetailRepo;
}

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack, setOptions: jest.fn() }),
    useRoute: () => ({ params: { orderId: 'order-1' } }),
  };
});

function renderScreen() {
  return render(
    <NavigationContainer>
      <OrderDetailScreen />
    </NavigationContainer>,
  );
}

const ORDER: OrderDetail = {
  orderId: 'order-1',
  orderNumber: 'BH-20260819-0001',
  state: 'PREPARING',
  paymentMethod: 'ONLINE',
  subtotalSatang: 12000,
  deliveryFeeSatang: 1500,
  serviceFeeSatang: 500,
  discountSatang: 0,
  grandTotalSatang: 14000,
  recipientNameSnapshot: 'สมชาย ใจดี',
  recipientPhoneSnapshot: '0812345678',
  deliveryAddressSnapshot: '123 หมู่ 4 ต.บุณฑริก',
  placedAt: '2026-08-19T05:00:00Z',
  items: [
    {
      id: 'item-1',
      menuItemId: 'mi-1',
      nameSnapshot: 'ส้มตำไทย',
      unitPriceSatang: 6000,
      quantity: 2,
      lineTotalSatang: 12000,
      note: null,
      options: [
        { id: 'opt-1', groupNameSnapshot: 'ระดับความเผ็ด', optionNameSnapshot: 'เผ็ดมาก', priceDeltaSatang: 0 },
      ],
    },
  ],
  statusHistory: [
    { toState: 'CREATED', occurredAt: '2026-08-19T05:00:00Z', reason: null },
    { toState: 'PAID', occurredAt: '2026-08-19T05:01:00Z', reason: null },
    { toState: 'PREPARING', occurredAt: '2026-08-19T05:03:00Z', reason: null },
  ],
};

beforeEach(() => {
  mockGetOrder.mockReset();
  mockGoBack.mockReset();
  stub();
});

it('uses orderId from the route, not any client-held customer id', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(mockGetOrder).toHaveBeenCalledWith('order-1'));
});

it('renders order number, current state and money snapshot on success', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  expect(screen.getByText('ออเดอร์ #BH-20260819-0001')).toBeTruthy();
  // PREPARING, from the approved UX-SPEC copy — appears in both the summary
  // card and the timeline's active step, so at least one match is enough.
  expect(screen.getAllByText('ร้านกำลังทำอาหาร').length).toBeGreaterThan(0);
  expect(screen.getByText('฿140')).toBeTruthy(); // grand total, emphasis row
});

it('renders each item from its snapshot, including its option snapshot', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('order-item-item-1')).toBeTruthy());
  expect(screen.getByText('ส้มตำไทย × 2')).toBeTruthy();
  expect(screen.getByText('เผ็ดมาก')).toBeTruthy();
});

it('renders the status timeline from order_status_history, not a fabricated step list', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  // Only states that actually occurred appear — MERCHANT_ACCEPTED never
  // happened in this fixture, so its label must not render either.
  expect(screen.queryByText('ร้านรับออเดอร์แล้ว')).toBeNull();
});

it('shows a safe not-found state for a nonexistent or non-owned order, and lets the customer go back', async () => {
  mockGetOrder.mockResolvedValue(null);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail-not-found')).toBeTruthy());

  fireEvent.press(screen.getByText('กลับ'));
  expect(mockGoBack).toHaveBeenCalled();
});

it('shows the existing safe system-error state on a repository failure, not a raw error message', async () => {
  mockGetOrder.mockRejectedValue(new Error('internal error'));
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail-error')).toBeTruthy());
  expect(screen.queryByText('internal error')).toBeNull();
});

it('refresh re-fetches from the repository rather than reusing the first response', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(mockGetOrder).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId('button-refresh-order'));

  await waitFor(() => expect(mockGetOrder).toHaveBeenCalledTimes(2));
});
