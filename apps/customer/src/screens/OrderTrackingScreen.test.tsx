import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OrderTrackingScreen } from './OrderTrackingScreen';
import { repositories } from '../repositories';
import type { OrderDetail } from '../domain/order';
import type { OrderDetailRepository } from '../repositories/types';

/**
 * Phase E-3D — C-14 only renders the order-detail repository's RLS-scoped
 * response. Query/RLS coverage belongs to `supabaseOrderDetail.test.ts`; this
 * suite proves the screen neither substitutes mock tracking data nor leaks
 * internal state/error values.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const mockGetOrder = jest.fn();
const mockGoBack = jest.fn();
const mockRouteParams: { orderId: string } = { orderId: ORDER_ID };

function stub() {
  const orderDetailRepo: OrderDetailRepository = { getOrder: mockGetOrder };
  (repositories as unknown as { orderDetail: OrderDetailRepository }).orderDetail = orderDetailRepo;
}

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

function renderScreen() {
  return render(
    <NavigationContainer>
      <OrderTrackingScreen />
    </NavigationContainer>,
  );
}

const ORDER: OrderDetail = {
  orderId: ORDER_ID,
  orderNumber: 'BH-20260819-0001',
  state: 'PREPARING',
  paymentMethod: 'ONLINE',
  prepMinutes: null,
  subtotalSatang: 12000,
  deliveryFeeSatang: 1500,
  serviceFeeSatang: 500,
  discountSatang: 0,
  grandTotalSatang: 14000,
  restaurantNameSnapshot: 'ก๋วยเตี๋ยวลุงหนวด',
  recipientNameSnapshot: 'สมชาย ใจดี',
  recipientPhoneSnapshot: '0812345678',
  deliveryAddressSnapshot: '123 หมู่ 4 ต.บุณฑริก',
  deliveryLandmark: 'ใกล้ตลาดสดบุณฑริก',
  placedAt: '2026-08-19T05:00:00Z',
  items: [],
  statusHistory: [
    { toState: 'CREATED', occurredAt: '2026-08-19T05:00:00Z', reason: 'created_from_cart' },
    { toState: 'PAID', occurredAt: '2026-08-19T05:01:00Z', reason: 'payment_provider_event' },
    { toState: 'PREPARING', occurredAt: '2026-08-19T05:03:00Z', reason: 'merchant_started' },
  ],
};

beforeEach(() => {
  mockGetOrder.mockReset();
  mockGoBack.mockReset();
  stub();
});

it('loads the real order detail using the real route UUID', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(mockGetOrder).toHaveBeenCalledWith(ORDER_ID));
});

it('passes no customer or restaurant identity to the read — ownership is RLS’s job', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(mockGetOrder).toHaveBeenCalled());

  // The order id is the *only* argument. Identity comes from the verified
  // Supabase session behind `orders_select_customer`, never from route
  // params or anything else the UI could supply (DEC-APP-008).
  expect(mockGetOrder.mock.calls[0]).toEqual([ORDER_ID]);
});

it('renders the real order number, current DEC-019 state, and recorded status history', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.getByText('#BH-20260819-0001')).toBeTruthy();
  // Once as UX-SPEC §5's "largest text on screen" headline, once as the
  // timeline's most recent recorded step.
  expect(screen.getAllByText('ร้านกำลังทำอาหาร')).toHaveLength(2);
  expect(screen.getByText('ส่งให้ร้านแล้ว · รอร้านรับออเดอร์')).toBeTruthy();
  expect(screen.getByText('19 ส.ค. 12:01 น.')).toBeTruthy();
  expect(screen.getByText('19 ส.ค. 12:03 น.')).toBeTruthy();
  // The order summary UX-SPEC §5 puts on C-14, from write-once snapshots.
  expect(screen.getByText('ก๋วยเตี๋ยวลุงหนวด')).toBeTruthy();
  expect(screen.getByText('฿140')).toBeTruthy();
});

it('does not render an unapproved raw state or the internal history reason', async () => {
  mockGetOrder.mockResolvedValue({
    ...ORDER,
    state: 'PAYMENT_FAILED',
    statusHistory: [
      { toState: 'PAYMENT_FAILED', occurredAt: '2026-08-19T05:03:00Z', reason: 'provider_declined' },
    ],
  });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.queryByText('PAYMENT_FAILED')).toBeNull();
  expect(screen.queryByText('provider_declined')).toBeNull();
  // Nothing in the history has approved copy, so the whole section is gone —
  // the design supplies no empty-history wording for C-14 to render instead.
  expect(screen.queryByTestId('tracking-status-timeline')).toBeNull();
  expect(screen.queryByText('สถานะออเดอร์')).toBeNull();
});

it('honestly omits the transient CREATED label rather than leaking its identifier', async () => {
  mockGetOrder.mockResolvedValue({
    ...ORDER,
    state: 'CREATED',
    statusHistory: [{ toState: 'CREATED', occurredAt: '2026-08-19T05:00:00Z', reason: null }],
  });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.queryByText('CREATED')).toBeNull();
  expect(screen.queryByTestId('tracking-status-timeline')).toBeNull();
  // This is today's real production shape: `create_order()` writes only the
  // `CREATED` event, and UX-SPEC §10 gives `CREATED` no customer wording.
  expect(screen.getByTestId('tracking-order-id')).toBeTruthy();
});

it('renders a CREATED-only history without inventing a next or future step', async () => {
  mockGetOrder.mockResolvedValue({
    ...ORDER,
    state: 'CREATED',
    statusHistory: [{ toState: 'CREATED', occurredAt: '2026-08-19T05:00:00Z', reason: null }],
  });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  // Not one label from the rest of the DEC-019 machine may appear — the
  // screen shows what happened, never what is expected to happen next.
  expect(screen.queryByText('รอชำระเงิน')).toBeNull();
  expect(screen.queryByText('ส่งให้ร้านแล้ว · รอร้านรับออเดอร์')).toBeNull();
  expect(screen.queryByText('ร้านรับออเดอร์แล้ว')).toBeNull();
  expect(screen.queryByText('ร้านกำลังทำอาหาร')).toBeNull();
  expect(screen.queryByText('อาหารพร้อมแล้ว')).toBeNull();
  expect(screen.queryByText('ไรเดอร์รับอาหารแล้ว')).toBeNull();
  expect(screen.queryByText('กำลังไปส่ง')).toBeNull();
  expect(screen.queryByText('จัดส่งสำเร็จ')).toBeNull();
});

it('renders multiple recorded events in chronological order', async () => {
  mockGetOrder.mockResolvedValue({
    ...ORDER,
    state: 'DELIVERED',
    statusHistory: [
      { toState: 'PAID', occurredAt: '2026-08-19T05:01:00Z', reason: null },
      { toState: 'PREPARING', occurredAt: '2026-08-19T05:03:00Z', reason: null },
      { toState: 'DELIVERED', occurredAt: '2026-08-19T05:40:00Z', reason: null },
    ],
  });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('tracking-status-timeline')).toBeTruthy());

  // The repository returns `occurred_at asc`; the screen must not re-sort or
  // reverse it. Positions in the rendered tree are compared rather than a
  // component internal, so this asserts what the customer actually sees.
  const tree = JSON.stringify(screen.toJSON());
  const paid = tree.indexOf('ส่งให้ร้านแล้ว · รอร้านรับออเดอร์');
  const preparing = tree.indexOf('ร้านกำลังทำอาหาร');
  const delivered = tree.lastIndexOf('จัดส่งสำเร็จ');

  expect(paid).toBeGreaterThan(-1);
  expect(paid).toBeLessThan(preparing);
  expect(preparing).toBeLessThan(delivered);
});

it('does not retain mock state names or unsupported ETA, rider, and map data', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.queryByText('OUT_FOR_DELIVERY')).toBeNull();
  expect(screen.queryByText('DRIVER_ASSIGNED')).toBeNull();
  expect(screen.queryByText('ถึงประมาณ 19:05 น.')).toBeNull();
  expect(screen.queryByText(/ไรเดอร์ตัวอย่าง/)).toBeNull();
  expect(screen.queryByLabelText(/แผนที่ติดตามออเดอร์/)).toBeNull();
});

it('renders loading while the RLS-safe read is in flight', () => {
  mockGetOrder.mockReturnValue(new Promise(() => {}));
  renderScreen();

  expect(screen.getByTestId('screen-order-tracking-loading')).toBeTruthy();
  expect(screen.getByText('กำลังโหลด…')).toBeTruthy();
});

it('renders a safe not-found state for a missing or non-owned order', async () => {
  mockGetOrder.mockResolvedValue(null);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking-not-found')).toBeTruthy());
  fireEvent.press(screen.getByText('กลับ'));
  expect(mockGoBack).toHaveBeenCalled();
});

it('renders shared offline copy without a raw transport error', async () => {
  mockGetOrder.mockRejectedValue(new Error('Network request failed'));
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking-error')).toBeTruthy());
  expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy();
  expect(screen.queryByText('Network request failed')).toBeNull();
});

it('renders shared generic-error copy without a raw server error', async () => {
  mockGetOrder.mockRejectedValue(new Error('Order detail failed: 42P01'));
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking-error')).toBeTruthy());
  expect(screen.getByText('ระบบมีปัญหาชั่วคราว')).toBeTruthy();
  expect(screen.queryByText(/42P01/)).toBeNull();
});

// ---------------------------------------------------------------------------
// M-05 §08 — the merchant's per-order prep-time caption. One line under the
// existing state headline; no new screen, no new read, no ETA.
// ---------------------------------------------------------------------------

it('renders the merchant’s prep-time estimate once the value exists', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'MERCHANT_ACCEPTED', prepMinutes: 20 });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.getByTestId('tracking-prep-minutes').props.children.join('')).toBe(
    'ร้านใช้เวลาทำอาหารประมาณ 20 นาที',
  );
});

it.each([10, 20, 30, 45, 60])('renders the merchant’s chosen %i minutes exactly, never a range', async (minutes) => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'MERCHANT_ACCEPTED', prepMinutes: minutes });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.getByTestId('tracking-prep-minutes').props.children.join('')).toBe(
    `ร้านใช้เวลาทำอาหารประมาณ ${minutes} นาที`,
  );
});

it('renders no caption at all when the order carries no prep time', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'MERCHANT_ACCEPTED', prepMinutes: null });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  // Every order accepted before M-05 shipped is this case, permanently. No
  // placeholder, no substitute value, no line.
  expect(screen.queryByTestId('tracking-prep-minutes')).toBeNull();
  expect(screen.queryByText(/ประมาณ/)).toBeNull();
});

it('leaves the approved MERCHANT_ACCEPTED headline in place — the caption is additive', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'MERCHANT_ACCEPTED', prepMinutes: 20 });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  expect(screen.getByTestId('tracking-state')).toBeTruthy();
  expect(screen.getByTestId('tracking-order-id')).toBeTruthy();
});

it('presents the prep time as an estimate, never as an ETA or an arrival time', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'MERCHANT_ACCEPTED', prepMinutes: 20 });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-tracking')).toBeTruthy());

  // No arrival wording anywhere on the screen. Prep time plus delivery time
  // is not an arrival estimate and must not be shown as one.
  for (const forbidden of ['ถึงประมาณ', 'จัดส่งประมาณ', 'ETA', 'ไรเดอร์ถึง']) {
    expect(screen.queryByText(new RegExp(forbidden))).toBeNull();
  }
});
