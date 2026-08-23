import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { PayFailedScreen } from '../screens/payment';
import { repositories } from '../repositories';
import type { Cart } from '../domain/cart';
import type {
  AddressRepository,
  CartRepository,
  CartValidationRepository,
  OrderCreationRepository,
} from '../repositories/types';

/**
 * DEC-016 — Phase 1 is online payment only; Cash on Delivery is disabled.
 *
 * The decision's own Consequences section recorded the Customer App's cash
 * option as a divergence that "must be disabled". These tests hold that
 * closed: cash must not be selectable at checkout, and a failed online
 * payment must not offer it as a fallback.
 *
 * Scope note: this is about the *customer-facing* surface only. DEC-016
 * equally requires the CASH model to stay reintroducible, so the column, the
 * `create_order()` argument and `lib/orderDisplay.ts`'s historical rendering
 * all keep it — covered by `lib/orderDisplay.test.ts`, deliberately untouched.
 */

let mockUserId: string | null = 'user-1';

jest.mock('../hooks/useAuth', () => {
  const actual = jest.requireActual('../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      initialising: false,
      session: mockUserId ? { user: { id: mockUserId } } : null,
      profile: null,
      profileError: null,
    }),
  };
});

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: {} }),
  };
});

const CART: Cart = {
  id: 'cart-1',
  shopId: 'shop-1',
  lines: [
    {
      id: 'ci-1',
      menuItemId: 'mi-1',
      name: 'ส้มตำไทย',
      basePriceSatang: 6000,
      isAvailable: true,
      quantity: 1,
      note: '',
      options: [],
    },
  ],
  unresolvedLineIds: [],
};

const DEFAULT_ADDRESS = {
  id: 'address-1',
  label: 'บ้าน',
  glyph: '📍',
  line: 'ที่อยู่ทดสอบ',
  isDefault: true,
  rawLabel: 'บ้าน',
  recipientName: 'ลูกค้า ทดสอบ',
  recipientPhone: '+66811111111',
  addressLine: 'ที่อยู่ทดสอบ',
  landmark: null,
  instructions: null,
  lat: null,
  lng: null,
};

const CREATED_ORDER = { orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' };

function stub() {
  const cartRepo: CartRepository = {
    getCart: jest.fn().mockResolvedValue(CART),
    addItem: jest.fn(),
    setQuantity: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };
  const validationRepo: CartValidationRepository = {
    validate: jest
      .fn()
      .mockResolvedValue({ cartId: 'cart-1', restaurantId: 'shop-1', subtotalSatang: 6000, lines: [] }),
  };
  const orderCreationRepo: OrderCreationRepository = {
    create: jest.fn().mockResolvedValue(CREATED_ORDER),
  };
  const addressRepo: AddressRepository = {
    listAddresses: jest.fn().mockResolvedValue([DEFAULT_ADDRESS]),
    createAddress: jest.fn(),
    updateAddress: jest.fn(),
    archiveAddress: jest.fn(),
  };

  (repositories as unknown as { cart: CartRepository }).cart = cartRepo;
  (repositories as unknown as { cartValidation: CartValidationRepository }).cartValidation =
    validationRepo;
  (repositories as unknown as { orderCreation: OrderCreationRepository }).orderCreation =
    orderCreationRepo;
  (repositories as unknown as { addresses: AddressRepository }).addresses = addressRepo;

  return { validationRepo, orderCreationRepo };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>{ui}</CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

async function renderCheckout() {
  renderWithProviders(<CheckoutScreen />);
  await waitFor(() => expect(screen.getByTestId('screen-checkout')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(DEFAULT_ADDRESS.label)).toBeTruthy());
}

beforeEach(() => {
  mockUserId = 'user-1';
  mockNavigate.mockClear();
});

describe('checkout offers online payment only (DEC-016)', () => {
  it('does not present เงินสดปลายทาง as a payment option', async () => {
    stub();
    await renderCheckout();

    expect(screen.queryByTestId('method-cash')).toBeNull();
    expect(screen.queryByText('เงินสดปลายทาง')).toBeNull();
    expect(screen.queryByText('จ่ายกับไรเดอร์เมื่อได้รับอาหาร')).toBeNull();
  });

  it('presents พร้อมเพย์ QR as the method, and it is not a switchable choice', async () => {
    stub();
    await renderCheckout();

    const promptpay = screen.getByTestId('method-promptpay');
    expect(promptpay).toBeTruthy();
    // No `onPress` — with one method there is nothing to select between, so
    // the row states the method rather than offering a choice.
    expect(promptpay.props.accessibilityRole).toBeUndefined();
  });

  it('never renders the cash CTA variant', async () => {
    stub();
    await renderCheckout();

    expect(screen.getByText(/ไปสแกนจ่าย/)).toBeTruthy();
    expect(screen.queryByText(/เงินสด/)).toBeNull();
  });

  it('always creates a real order — no path reaches OrderConfirmed without one', async () => {
    const { orderCreationRepo } = stub();
    await renderCheckout();

    await act(async () => {
      fireEvent.press(screen.getByTestId('button-place-order'));
    });

    await waitFor(() => expect(orderCreationRepo.create).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('PromptPayQr', {
      orderId: CREATED_ORDER.orderId,
      orderNumber: CREATED_ORDER.orderNumber,
    });
    // The removed cash branch went straight here with no order behind it.
    expect(mockNavigate).not.toHaveBeenCalledWith('OrderConfirmed');
    expect(mockNavigate).not.toHaveBeenCalledWith('OrderConfirmed', expect.anything());
  });
});

describe('failed online payment offers no cash fallback (DEC-016)', () => {
  it('does not offer เปลี่ยนเป็นเงินสด', () => {
    renderWithProviders(<PayFailedScreen />);

    expect(screen.getByTestId('screen-pay-failed')).toBeTruthy();
    expect(screen.queryByText('เปลี่ยนเป็นเงินสด')).toBeNull();
    expect(screen.queryByText(/เงินสด/)).toBeNull();
  });

  it('still offers a retry and a route back to checkout', () => {
    renderWithProviders(<PayFailedScreen />);

    fireEvent.press(screen.getByText('ลองจ่ายอีกครั้ง'));
    expect(mockNavigate).toHaveBeenCalledWith('PromptPayQr');

    fireEvent.press(screen.getByText('กลับไปแก้ออเดอร์'));
    expect(mockNavigate).toHaveBeenCalledWith('Checkout');
  });
});
