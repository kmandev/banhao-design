import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { repositories } from '../repositories';
import { PayCheckingScreen, PayDetailScreen, PromptPayQrScreen, RefundScreen } from '../screens/payment';

/**
 * The ONLINE payment chain on real data: the QR, amount and fees come from the
 * server, and the customer moves on only when the server's order row says so
 * (CON-002). No simulate buttons, no sample figures.
 */

const ORDER_REF = { orderId: 'order-1', orderNumber: 'BH-20261108-0001' };
const mockNavigate = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: { orderId: 'order-1', orderNumber: 'BH-20261108-0001' } }),
  };
});

const ORDER = {
  state: 'PENDING_PAYMENT',
  subtotalSatang: 18000,
  deliveryFeeSatang: 1000,
  serviceFeeSatang: 900,
  discountSatang: 0,
  grandTotalSatang: 19900,
};

const mockStartPayment = jest.fn();
const mockGetOrder = jest.fn();
const mockGetSummary = jest.fn();

beforeEach(() => {
  mockNavigate.mockReset();
  mockReplace.mockReset();
  mockStartPayment.mockReset().mockResolvedValue({
    paymentId: 'pay-1',
    amountSatang: 19900,
    qrImageUrl: 'https://stripe.example/qr.png',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  mockGetOrder.mockReset().mockResolvedValue(ORDER);
  mockGetSummary.mockReset();
  (repositories as unknown as Record<string, unknown>).payments = {
    startPayment: mockStartPayment,
    getPaymentSummary: mockGetSummary,
  };
  (repositories as unknown as Record<string, unknown>).orderDetail = { getOrder: mockGetOrder };
});

afterEach(() => jest.useRealTimers());

const renderIn = (ui: React.ReactElement) => render(<NavigationContainer>{ui}</NavigationContainer>);

async function poll() {
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
}

describe('PromptPayQr on real data', () => {
  it("shows the provider's QR, the server's amount, and the order's own fees", async () => {
    renderIn(<PromptPayQrScreen />);

    await waitFor(() => expect(screen.getByTestId('qr-amount').props.children).toBe('฿199'));
    expect(screen.getByTestId('qr-image').props.source).toEqual({ uri: 'https://stripe.example/qr.png' });
    await waitFor(() => expect(screen.getByTestId('qr-breakdown')).toBeTruthy());
    expect(screen.getByText('฿9')).toBeTruthy(); // service fee from the order row
    expect(screen.queryByText(/BANHAO7/)).toBeNull();
    expect(mockStartPayment).toHaveBeenCalledWith('order-1');
  });

  it('moves to PaySuccess by itself once the server records the payment', async () => {
    jest.useFakeTimers();
    mockGetOrder.mockResolvedValue({ ...ORDER, state: 'PAID' });
    renderIn(<PromptPayQrScreen />);
    await act(async () => {});

    await poll();

    expect(mockReplace).toHaveBeenCalledWith('PaySuccess', ORDER_REF);
  });

  it('asks for a payment email when the server requires one, and opens the account tab', async () => {
    mockStartPayment.mockRejectedValue(new Error('EMAIL_REQUIRED'));
    renderIn(<PromptPayQrScreen />);

    await waitFor(() => expect(screen.getByTestId('state-qr-email-required')).toBeTruthy());
    fireEvent.press(screen.getByText('ไปที่บัญชี'));
    expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Profile' });
  });

  it('says the order can no longer be paid, and opens it, when the server refuses', async () => {
    mockStartPayment.mockRejectedValue(new Error('NOT_PAYABLE'));
    renderIn(<PromptPayQrScreen />);

    await waitFor(() => expect(screen.getByTestId('state-qr-not-payable')).toBeTruthy());
    fireEvent.press(screen.getByText('ดูออเดอร์'));
    expect(mockReplace).toHaveBeenCalledWith('OrderDetail', { orderId: 'order-1' });
  });

  it('offers a retry on any other failure, without guessing a refusal', async () => {
    mockStartPayment.mockRejectedValueOnce(new Error('Network request failed'));
    renderIn(<PromptPayQrScreen />);

    await waitFor(() => expect(screen.getByTestId('state-qr-error')).toBeTruthy());
  });
});

describe('PayChecking waits for the server', () => {
  it('has no button that decides the outcome', () => {
    renderIn(<PayCheckingScreen />);

    expect(screen.queryByText(/จำลอง/)).toBeNull();
  });

  it('stays put while the order is still pending', async () => {
    jest.useFakeTimers();
    renderIn(<PayCheckingScreen />);

    await poll();
    await poll();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each([
    ['PAID', 'PaySuccess', ORDER_REF],
    ['MERCHANT_ACCEPTED', 'PaySuccess', ORDER_REF],
    ['PAYMENT_EXPIRED', 'PayExpired', ORDER_REF],
    ['PAYMENT_FAILED', 'PayFailed', ORDER_REF],
    ['CANCELLED', 'OrderDetail', { orderId: 'order-1' }],
  ])('order %s → %s', async (state, route, params) => {
    jest.useFakeTimers();
    mockGetOrder.mockResolvedValue({ ...ORDER, state });
    renderIn(<PayCheckingScreen />);

    await poll();

    expect(mockReplace).toHaveBeenCalledWith(route, params);
  });

  it('keeps polling through a failed read instead of moving on', async () => {
    jest.useFakeTimers();
    mockGetOrder.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ...ORDER, state: 'PAID' });
    renderIn(<PayCheckingScreen />);

    await poll();
    expect(mockReplace).not.toHaveBeenCalled();
    await poll();
    expect(mockReplace).toHaveBeenCalledWith('PaySuccess', ORDER_REF);
  });
});

const PAID_SUMMARY = {
  orderNumber: 'BH-20261108-0002',
  payment: { paymentReference: 'PAY-REAL-1', state: 'SUCCESS', method: 'ONLINE', amountSatang: 19900, providerRefTail: '8F2A' },
  refund: null,
};

describe('PayDetail on real data', () => {
  it("shows the order's real payment, with only a partial provider reference", async () => {
    mockGetSummary.mockResolvedValue(PAID_SUMMARY);
    renderIn(<PayDetailScreen />);

    await waitFor(() => expect(screen.getByText('PAY-REAL-1')).toBeTruthy());
    expect(screen.getByText('BH-20261108-0002')).toBeTruthy();
    expect(screen.getByText('฿199')).toBeTruthy();
    expect(screen.getByText('PROMPTPAY')).toBeTruthy();
    expect(screen.getByText('····8F2A')).toBeTruthy();
    expect(screen.queryByText('PAY-BH000125')).toBeNull();
    expect(mockGetSummary).toHaveBeenCalledWith('order-1');
  });

  it('offers no refund action when there is no refund — customers do not start one here (DEC-058)', async () => {
    mockGetSummary.mockResolvedValue(PAID_SUMMARY);
    renderIn(<PayDetailScreen />);

    await waitFor(() => expect(screen.getByText('PAY-REAL-1')).toBeTruthy());
    expect(screen.queryByTestId('button-view-refund')).toBeNull();
    expect(screen.queryByText('ขอคืนเงิน')).toBeNull();
  });

  it('opens the refund for this order when one exists', async () => {
    mockGetSummary.mockResolvedValue({
      ...PAID_SUMMARY,
      refund: { state: 'REFUND_PROCESSING', amountSatang: 19900, requestedAt: '2026-11-08T08:30:00Z', completedAt: null },
    });
    renderIn(<PayDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('button-view-refund')).toBeTruthy());
    fireEvent.press(screen.getByTestId('button-view-refund'));
    expect(mockNavigate).toHaveBeenCalledWith('Refund', { orderId: 'order-1' });
  });

  it('says so honestly when the order has no payment yet', async () => {
    mockGetSummary.mockResolvedValue({ orderNumber: 'BH-1', payment: null, refund: null });
    renderIn(<PayDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('state-pay-detail-none')).toBeTruthy());
  });
});

describe('Refund on real data', () => {
  const withRefund = (state: string) => ({
    ...PAID_SUMMARY,
    refund: { state, amountSatang: 19900, requestedAt: '2026-11-08T08:30:00Z', completedAt: null },
  });

  it.each([
    ['REFUND_REQUESTED', 'กำลังดำเนินการคืนเงิน'],
    ['REFUND_PROCESSING', 'กำลังดำเนินการคืนเงิน'],
    ['REFUNDED', 'คืนเงินแล้ว'],
    ['REFUND_FAILED', 'ทีมงานกำลังตรวจสอบการคืนเงิน'],
  ])('%s → "%s", with the real amount', async (state, headline) => {
    mockGetSummary.mockResolvedValue(withRefund(state));
    renderIn(<RefundScreen />);

    await waitFor(() => expect(screen.getByTestId('refund-status').props.children).toBe(headline));
    expect(screen.getByTestId('refund-amount').props.children).toBe('฿199');
  });

  it('tells the customer to complete the bank form while the refund is in flight', async () => {
    mockGetSummary.mockResolvedValue(withRefund('REFUND_PROCESSING'));
    renderIn(<RefundScreen />);

    await waitFor(() => expect(screen.getByText(/กรอกบัญชีที่จะรับเงินคืน/)).toBeTruthy());
  });

  it('says there is no refund rather than inventing one', async () => {
    mockGetSummary.mockResolvedValue(PAID_SUMMARY);
    renderIn(<RefundScreen />);

    await waitFor(() => expect(screen.getByTestId('state-refund-none')).toBeTruthy());
  });
});
