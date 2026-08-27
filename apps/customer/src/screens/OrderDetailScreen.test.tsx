import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OrderDetailScreen } from './OrderDetailScreen';
import { repositories } from '../repositories';
import type { OrderDetail } from '../domain/order';
import type { DeliveryProofRepository, OrderDetailRepository } from '../repositories/types';

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
const mockGetDeliveryProof = jest.fn();

function stub() {
  const orderDetailRepo: OrderDetailRepository = { getOrder: mockGetOrder };
  (repositories as unknown as { orderDetail: OrderDetailRepository }).orderDetail = orderDetailRepo;

  const deliveryProofRepo: DeliveryProofRepository = { getDeliveryProof: mockGetDeliveryProof };
  (repositories as unknown as { deliveryProof: DeliveryProofRepository }).deliveryProof =
    deliveryProofRepo;
}

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, setOptions: jest.fn() }),
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
  restaurantNameSnapshot: 'ก๋วยเตี๋ยวลุงหนวด',
  recipientNameSnapshot: 'สมชาย ใจดี',
  recipientPhoneSnapshot: '0812345678',
  deliveryAddressSnapshot: '123 หมู่ 4 ต.บุณฑริก',
  deliveryLandmark: 'ใกล้ตลาดสดบุณฑริก',
  // 05:00Z = 12:00 Bangkok, 19 Aug 2026 = 19 ส.ค. 2569.
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
  mockGetDeliveryProof.mockReset();
  mockGetDeliveryProof.mockResolvedValue(null);
  mockGoBack.mockReset();
  mockNavigate.mockReset();
  stub();
});

it('uses orderId from the route, not any client-held customer id', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(mockGetOrder).toHaveBeenCalledWith('order-1'));
});

it('renders the summary card as screen 19 specifies — state badge, order number, shop, placed-at', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  // PREPARING, from the approved UX-SPEC §10 copy.
  expect(screen.getByText('ร้านกำลังทำอาหาร')).toBeTruthy();
  // The design shows the bare `#…`, not the E-3B.1 heading `ออเดอร์ #…`.
  expect(screen.getByText('#BH-20260819-0001')).toBeTruthy();
  expect(screen.queryByText('ออเดอร์ #BH-20260819-0001')).toBeNull();
  expect(screen.getByText('ก๋วยเตี๋ยวลุงหนวด')).toBeTruthy();
  expect(screen.getByText('19 ส.ค. 2569 · 12:00 น.')).toBeTruthy();
});

it('renders each item from its snapshot in the design’s `name ×qty` form', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('order-item-item-1')).toBeTruthy());
  expect(screen.getByText('ส้มตำไทย ×2')).toBeTruthy();
  expect(screen.getByText('เผ็ดมาก')).toBeTruthy();
  expect(screen.getByText('รายการอาหาร')).toBeTruthy();
});

it('renders the money card with screen 19’s labels, including ชำระโดย', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  expect(screen.getByText('ค่าอาหาร')).toBeTruthy();
  expect(screen.getByText('ค่าส่ง')).toBeTruthy();
  expect(screen.getByText('ค่าบริการ')).toBeTruthy();
  expect(screen.getByText('ยอดรวม')).toBeTruthy();
  expect(screen.getByText('฿140')).toBeTruthy();
  expect(screen.getByText('ชำระโดย')).toBeTruthy();
  // C-19 spells the method out; the C-16 card's shorter `พร้อมเพย์` is a
  // different string in the design and must not be substituted here.
  expect(screen.getByText('พร้อมเพย์ QR')).toBeTruthy();
  // Labels the design does not use on this screen.
  expect(screen.queryByText('ราคาอาหาร')).toBeNull();
  expect(screen.queryByText('รวมทั้งหมด')).toBeNull();
});

it('renders the delivery address and its landmark', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  expect(screen.getByText('ที่อยู่จัดส่ง')).toBeTruthy();
  expect(screen.getByText('123 หมู่ 4 ต.บุณฑริก')).toBeTruthy();
  expect(screen.getByText('จุดสังเกต: ใกล้ตลาดสดบุณฑริก')).toBeTruthy();
});

it('omits the landmark line when the address recorded none', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, deliveryLandmark: null });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(screen.queryByText(/จุดสังเกต/)).toBeNull();
});

it('renders no status timeline — UX-SPEC §9.3 puts the Timeline on C-14, not C-19', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());

  expect(screen.queryByText('สถานะออเดอร์')).toBeNull();
  // `PAID` is in this order's history; if a timeline were rendering, its
  // §10 label would appear.
  expect(screen.queryByText('ส่งให้ร้านแล้ว · รอร้านรับออเดอร์')).toBeNull();
});

it('shows the ให้คะแนนร้านนี้ action on a delivered order', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('button-rate-shop')).toBeTruthy());
  fireEvent.press(screen.getByTestId('button-rate-shop'));

  expect(mockNavigate).toHaveBeenCalledWith('Rating', { orderId: 'order-1' });
});

it('withholds the rating action while the order is still in flight', async () => {
  mockGetOrder.mockResolvedValue(ORDER); // PREPARING
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(screen.queryByTestId('button-rate-shop')).toBeNull();
});

it('never renders a raw state identifier', async () => {
  mockGetOrder.mockResolvedValue({ ...ORDER, state: 'PAYMENT_FAILED' });
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(screen.queryByText('PAYMENT_FAILED')).toBeNull();
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

/**
 * The E-3B.1 screen carried a `โหลดสถานะล่าสุด` refresh button. Screen 19 has
 * no such control — C-19 is order detail *from history*, and live progress is
 * C-14's job — so it is gone, replaced by the design's rating action. Retrying
 * a *failed* read is unaffected: that action belongs to the error state, and
 * the test below still exercises it.
 */
it('retries the read from the error state, which is where the design puts a retry', async () => {
  mockGetOrder.mockRejectedValueOnce(new Error('Network request failed'));
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail-error')).toBeTruthy());
  expect(mockGetOrder).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByText('ลองอีกครั้ง'));

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(mockGetOrder).toHaveBeenCalledTimes(2);
});

it('no longer renders the undesigned refresh control', async () => {
  mockGetOrder.mockResolvedValue(ORDER);
  renderScreen();

  await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
  expect(screen.queryByTestId('button-refresh-order')).toBeNull();
});

/**
 * Proof of delivery (POD, Phase G7.4 / T3.4) — `repositories.deliveryProof`
 * is a second, independent read from `repositories.orderDetail`, so these
 * tests stub it separately and assert it degrades without ever touching the
 * rest of the receipt.
 */
const PROOF = {
  photoUrl: 'https://r2.example.com/signed/deliveries/order-1/proof/abc.jpg?sig=xyz',
  capturedAt: '2026-08-19T05:10:00Z',
  deliveredAt: '2026-08-19T05:10:00Z',
};

describe('OrderDetailScreen — proof of delivery (POD)', () => {
  it('renders the POD card for a delivered order with a proof photo', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-card')).toBeTruthy());
    expect(screen.getByText('หลักฐานการส่ง')).toBeTruthy();
    expect(screen.getByTestId('pod-thumbnail')).toBeTruthy();
    expect(mockGetDeliveryProof).toHaveBeenCalledWith('order-1');
  });

  it('renders the delivered timestamp using the same long-form date helper the screen already uses', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    // 05:10Z = 12:10 Bangkok, 19 Aug 2026 = 19 ส.ค. 2569.
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-card')).toBeTruthy());
    expect(screen.getByText('19 ส.ค. 2569 · 12:10 น.')).toBeTruthy();
  });

  it('omits the POD card when the proof is null — not an error, not a placeholder', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(null);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
    await waitFor(() => expect(mockGetDeliveryProof).toHaveBeenCalled());

    expect(screen.queryByTestId('pod-card')).toBeNull();
    expect(screen.queryByTestId('pod-error-card')).toBeNull();
    expect(screen.queryByText('หลักฐานการส่ง')).toBeNull();
    expect(screen.queryByText('ไม่มีหลักฐาน')).toBeNull();
    // The rest of the receipt is unaffected.
    expect(screen.getByText('ที่อยู่จัดส่ง')).toBeTruthy();
  });

  it('never calls the delivery-proof repository for a non-delivered order', async () => {
    mockGetOrder.mockResolvedValue(ORDER); // PREPARING
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('screen-order-detail')).toBeTruthy());
    expect(mockGetDeliveryProof).not.toHaveBeenCalled();
    expect(screen.queryByTestId('pod-card')).toBeNull();
  });

  it('keeps the main receipt visible when the POD fetch fails, showing only a scoped inline retry', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockRejectedValue(new Error('internal error'));
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-error-card')).toBeTruthy());

    // The rest of the order detail screen rendered normally — no global error state.
    expect(screen.getByTestId('screen-order-detail')).toBeTruthy();
    expect(screen.getByText('ที่อยู่จัดส่ง')).toBeTruthy();
    expect(screen.getByText('ค่าอาหาร')).toBeTruthy();
    // The raw repository error message is never shown.
    expect(screen.queryByText('internal error')).toBeNull();
  });

  it('retries only the POD fetch from its own inline retry action', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockRejectedValueOnce(new Error('Network request failed'));
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-error-card')).toBeTruthy());
    expect(mockGetOrder).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('button-retry-pod'));

    await waitFor(() => expect(screen.getByTestId('pod-card')).toBeTruthy());
    expect(mockGetDeliveryProof).toHaveBeenCalledTimes(2);
    // The main order read was never re-triggered by the POD retry.
    expect(mockGetOrder).toHaveBeenCalledTimes(1);
  });

  it('treats a NOT_FOUND-mapped null proof the same as any other null — no authorization details shown', async () => {
    // The repository already folds NOT_FOUND into null (apiDeliveryProof.ts);
    // this exercises the screen's side of that contract.
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(null);
    renderScreen();

    await waitFor(() => expect(mockGetDeliveryProof).toHaveBeenCalled());
    expect(screen.queryByText('ไม่มีสิทธิ์')).toBeNull();
    expect(screen.queryByTestId('pod-error-card')).toBeNull();
    expect(screen.queryByTestId('pod-card')).toBeNull();
  });

  it('opens the full-screen viewer when the thumbnail is tapped, and closes it from the close action', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-thumbnail-button')).toBeTruthy());
    expect(screen.queryByTestId('pod-viewer-image')).toBeNull();

    fireEvent.press(screen.getByTestId('pod-thumbnail-button'));
    await waitFor(() => expect(screen.getByTestId('pod-viewer-image')).toBeTruthy());

    fireEvent.press(screen.getByTestId('pod-viewer-close'));
    await waitFor(() => expect(screen.queryByTestId('pod-viewer-image')).toBeNull());
  });

  it('shows an inline placeholder, not a full-screen error, when the signed URL image fails to load', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-thumbnail')).toBeTruthy());
    fireEvent(screen.getByTestId('pod-thumbnail'), 'error');

    await waitFor(() => expect(screen.getByText('โหลดรูปไม่สำเร็จ')).toBeTruthy());
    expect(screen.queryByTestId('pod-thumbnail')).toBeNull();
    // The rest of the screen is unaffected.
    expect(screen.getByTestId('screen-order-detail')).toBeTruthy();
  });

  it('never leaves the full-screen viewer silently blank when the signed URL fails to load there', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-thumbnail-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('pod-thumbnail-button'));
    await waitFor(() => expect(screen.getByTestId('pod-viewer-image')).toBeTruthy());

    fireEvent(screen.getByTestId('pod-viewer-image'), 'error');

    // The viewer stays open (still reachable, not silently dismissed) but no
    // longer shows a blank/broken image — the same fallback copy the
    // thumbnail already uses appears in its place. (The thumbnail shares the
    // same failure state, so the fallback text can appear in both places —
    // asserting "at least one" is the behavioral claim, not "exactly one".)
    await waitFor(() => expect(screen.queryByTestId('pod-viewer-image')).toBeNull());
    expect(screen.getAllByText('โหลดรูปไม่สำเร็จ').length).toBeGreaterThan(0);
    expect(screen.getByTestId('pod-viewer-close')).toBeTruthy();
  });

  it('never renders the raw object key or any internal storage detail', async () => {
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'DELIVERED' });
    mockGetDeliveryProof.mockResolvedValue(PROOF);
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('pod-card')).toBeTruthy());
    expect(screen.queryByText(/deliveries\//)).toBeNull();
    expect(screen.queryByText(/proof_photo_path/i)).toBeNull();
    expect(screen.queryByText(/r2_/i)).toBeNull();
  });
});
