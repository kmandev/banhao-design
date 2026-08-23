import { fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { AuthProvider } from '../hooks/useAuth';
import { CartProvider } from '../hooks/useCart';
import { OrderConfirmedScreen } from '../screens/OrderConfirmedScreen';
import {
  PayCheckingScreen,
  PayDuplicateScreen,
  PaySuccessScreen,
  PromptPayQrScreen,
} from '../screens/payment';

/**
 * Phase E-3E — the real order id created by `POST /orders` must survive the
 * whole ONLINE payment chain and reach C-14.
 *
 * Before this, `CheckoutScreen` put `{ orderId, orderNumber }` on
 * `PromptPayQr` and the very next screen dropped them, so C-13 had nothing
 * real to track and its designed `ติดตามออเดอร์` action could not exist.
 *
 * These tests assert *navigation payloads only*. Nothing here confirms a
 * payment: CON-002 still means only a signature-verified provider webhook may
 * do that, and `PayChecking`'s `จำลอง:` buttons remain review scaffolding.
 */

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_NUMBER = 'BH-20260819-0042';
const ORDER_REF = { orderId: ORDER_ID, orderNumber: ORDER_NUMBER };

const mockNavigate = jest.fn();
let mockRouteParams: Record<string, unknown> | undefined = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

beforeEach(() => {
  mockNavigate.mockReset();
  mockRouteParams = { ...ORDER_REF };
});

/** Payment screens read the cart for their total; C-13 does not. */
function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>{ui}</CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

function renderPlain(ui: React.ReactElement) {
  return render(<NavigationContainer>{ui}</NavigationContainer>);
}

// --- Test 1: the chain, hop by hop ---------------------------------------

it('PromptPayQr forwards the order reference to PayChecking', () => {
  jest.useFakeTimers();
  try {
    renderWithProviders(<PromptPayQrScreen />);
    fireEvent.press(screen.getByTestId('button-paid'));
  } finally {
    jest.useRealTimers();
  }

  expect(mockNavigate).toHaveBeenCalledWith('PayChecking', ORDER_REF);
});

it('PayChecking forwards the order reference to PaySuccess', () => {
  renderPlain(<PayCheckingScreen />);
  fireEvent.press(screen.getByText('จำลอง: สำเร็จ'));

  expect(mockNavigate).toHaveBeenCalledWith('PaySuccess', ORDER_REF);
});

it('PaySuccess forwards the order reference to OrderConfirmed', () => {
  renderPlain(<PaySuccessScreen />);
  fireEvent.press(screen.getByText('ดูออเดอร์'));

  expect(mockNavigate).toHaveBeenCalledWith('OrderConfirmed', ORDER_REF);
});

it('carries the id through the chain unmutated, never regenerating one', () => {
  // Each hop is re-rendered with exactly what the previous hop emitted, so a
  // screen that silently substituted its own id would break the chain here.
  jest.useFakeTimers();
  try {
    renderWithProviders(<PromptPayQrScreen />);
    fireEvent.press(screen.getByTestId('button-paid'));
  } finally {
    jest.useRealTimers();
  }
  const [, toChecking] = mockNavigate.mock.calls.at(-1)!;

  mockRouteParams = toChecking as Record<string, unknown>;
  renderPlain(<PayCheckingScreen />);
  fireEvent.press(screen.getByText('จำลอง: สำเร็จ'));
  const [, toSuccess] = mockNavigate.mock.calls.at(-1)!;

  mockRouteParams = toSuccess as Record<string, unknown>;
  renderPlain(<PaySuccessScreen />);
  fireEvent.press(screen.getByText('ดูออเดอร์'));
  const [, toConfirmed] = mockNavigate.mock.calls.at(-1)!;

  expect(toConfirmed).toEqual(ORDER_REF);
});

// --- Test 4: duplicate symmetry ------------------------------------------

it('PayChecking forwards the same reference to PayDuplicate as to PaySuccess', () => {
  renderPlain(<PayCheckingScreen />);
  fireEvent.press(screen.getByText('จำลอง: สำเร็จ'));
  fireEvent.press(screen.getByText('จำลอง: จ่ายซ้ำ'));

  const [, toSuccess] = mockNavigate.mock.calls[0];
  const [, toDuplicate] = mockNavigate.mock.calls[1];
  expect(toDuplicate).toEqual(toSuccess);
});

it('PayDuplicate reaches OrderConfirmed with the same order as the success path', () => {
  // REQ-003: a duplicate payment is the *same* order, so tracking must work
  // identically. An asymmetry here would silently strand the customer.
  renderPlain(<PayDuplicateScreen />);
  fireEvent.press(screen.getByText('ดูออเดอร์'));

  expect(mockNavigate).toHaveBeenCalledWith('OrderConfirmed', ORDER_REF);
});

// --- Test 2: C-13 offers the designed tracking action --------------------

it('OrderConfirmed shows ติดตามออเดอร์ and opens C-14 with the real id', () => {
  renderPlain(<OrderConfirmedScreen />);

  expect(screen.getByText('ติดตามออเดอร์')).toBeTruthy();
  fireEvent.press(screen.getByTestId('button-track-order'));

  expect(mockNavigate).toHaveBeenCalledWith('OrderTracking', { orderId: ORDER_ID });
  // The superseded mock payload E-3D removed must not come back.
  expect(mockNavigate).not.toHaveBeenCalledWith('OrderTracking', { state: 'PREPARING' });
});

// --- Test 3: CASH regression ---------------------------------------------

it('OrderConfirmed shows no tracking action on the CASH path, which has no order', () => {
  mockRouteParams = undefined;
  renderPlain(<OrderConfirmedScreen />);

  // The screen itself still renders — only the action it cannot honour is gone.
  expect(screen.getByTestId('state-order-confirmed')).toBeTruthy();
  expect(screen.queryByText('ติดตามออเดอร์')).toBeNull();
  expect(screen.queryByTestId('button-track-order')).toBeNull();

  fireEvent.press(screen.getByText('กลับหน้าแรก'));
  expect(mockNavigate).not.toHaveBeenCalledWith('OrderTracking', expect.anything());
});

it('OrderConfirmed treats a blank order id as no order, not as a trackable one', () => {
  mockRouteParams = { orderId: '   ' };
  renderPlain(<OrderConfirmedScreen />);

  expect(screen.queryByTestId('button-track-order')).toBeNull();
  expect(mockNavigate).not.toHaveBeenCalledWith('OrderTracking', expect.anything());
});
