import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OrdersScreen } from './OrdersScreen';
import { repositories } from '../repositories';
import type { OrderHistoryEntry } from '../domain/order';
import type { OrderRepository } from '../repositories/types';

/**
 * Phase E-3B.3 — C-16 against a stubbed history repository.
 *
 * The repository's own query correctness lives in
 * `repositories/supabaseOrderHistory.test.ts`; this file is about the screen:
 * what it renders in each state, and — the point of the whole phase — that
 * tapping a card opens C-19 with the order's real UUID.
 *
 * `repositories` is monkey-patched directly rather than via a `jest.mock`
 * factory, matching `OrderDetailScreen.test.tsx` and
 * `__tests__/order-creation.test.tsx`.
 */

const mockListOrders = jest.fn();

function stub() {
  const ordersRepo: OrderRepository = { listOrders: mockListOrders };
  (repositories as unknown as { orders: OrderRepository }).orders = ordersRepo;
}

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: {} }),
  };
});

function renderScreen() {
  return render(
    <NavigationContainer>
      <OrdersScreen />
    </NavigationContainer>,
  );
}

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const DELIVERED_ORDER: OrderHistoryEntry = {
  orderId: ORDER_ID,
  orderNumber: 'BH-20260819-0002',
  state: 'DELIVERED',
  paymentMethod: 'ONLINE',
  restaurantNameSnapshot: 'ก๋วยเตี๋ยวลุงหนวด',
  grandTotalSatang: 9500,
  // 12:02Z = 19:02 Bangkok.
  placedAt: '2026-08-06T12:02:00Z',
  items: [
    { nameSnapshot: 'ก๋วยเตี๋ยวเรือน้ำตก', quantity: 2 },
    { nameSnapshot: 'เกี๊ยวทอด', quantity: 1 },
  ],
};

beforeEach(() => {
  mockListOrders.mockReset();
  mockNavigate.mockReset();
  stub();
});

it('renders a real order row from snapshot data', async () => {
  mockListOrders.mockResolvedValue([DELIVERED_ORDER]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`order-card-${ORDER_ID}`)).toBeTruthy());

  expect(screen.getByText('ก๋วยเตี๋ยวลุงหนวด')).toBeTruthy();
  expect(screen.getByText('฿95')).toBeTruthy();
  expect(screen.getByText('ก๋วยเตี๋ยวเรือน้ำตก ×2, เกี๊ยวทอด ×1')).toBeTruthy();
  expect(screen.getByText('พร้อมเพย์')).toBeTruthy();
});

it('renders the DEC-019 state label from UX-SPEC §10, never the raw identifier', async () => {
  mockListOrders.mockResolvedValue([DELIVERED_ORDER]);
  renderScreen();

  await waitFor(() => expect(screen.getByText('จัดส่งสำเร็จ')).toBeTruthy());
  expect(screen.queryByText('DELIVERED')).toBeNull();
  // The superseded mock vocabulary must not survive anywhere on this screen.
  expect(screen.queryByText('ส่งสำเร็จ')).toBeNull();
});

it('renders the order number and its Bangkok placed-at time', async () => {
  mockListOrders.mockResolvedValue([DELIVERED_ORDER]);
  renderScreen();

  await waitFor(() =>
    expect(screen.getByText('#BH-20260819-0002 · 6 ส.ค. 19:02 น.')).toBeTruthy(),
  );
});

it('opens C-19 with the real order UUID — not the order number, not an index', async () => {
  mockListOrders.mockResolvedValue([DELIVERED_ORDER]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`order-card-${ORDER_ID}`)).toBeTruthy());
  fireEvent.press(screen.getByTestId(`order-card-${ORDER_ID}`));

  expect(mockNavigate).toHaveBeenCalledWith('OrderDetail', { orderId: ORDER_ID });
  expect(mockNavigate).not.toHaveBeenCalledWith('OrderTracking', expect.anything());
});

it('renders the loading state while history is in flight', () => {
  mockListOrders.mockReturnValue(new Promise(() => {}));
  renderScreen();

  expect(screen.getByText('กำลังโหลด…')).toBeTruthy();
});

it('renders the approved C-16 empty state', async () => {
  mockListOrders.mockResolvedValue([]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('state-orders-empty')).toBeTruthy());
  // UX-SPEC §13, "Empty — no orders | C-16".
  expect(screen.getByText('ยังไม่มีประวัติการสั่ง')).toBeTruthy();
  expect(screen.getByText('สั่งอาหาร')).toBeTruthy();
});

it('renders the shared offline copy when the read fails with a network error', async () => {
  mockListOrders.mockRejectedValue(new Error('Network request failed'));
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('state-orders-error')).toBeTruthy());
  expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy();
});

it('renders the shared server-error copy without leaking the raw failure', async () => {
  mockListOrders.mockRejectedValue(new Error('Order history failed: connection reset'));
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('state-orders-error')).toBeTruthy());
  expect(screen.getByText('ระบบมีปัญหาชั่วคราว')).toBeTruthy();
  expect(screen.queryByText(/connection reset/)).toBeNull();
});

it('omits the status badge for a state the design has no approved wording for', async () => {
  mockListOrders.mockResolvedValue([{ ...DELIVERED_ORDER, state: 'PAYMENT_FAILED' }]);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId(`order-card-${ORDER_ID}`)).toBeTruthy());
  // §10: "No state name, cause code, or error code is ever rendered to a user."
  expect(screen.queryByText('PAYMENT_FAILED')).toBeNull();
});
