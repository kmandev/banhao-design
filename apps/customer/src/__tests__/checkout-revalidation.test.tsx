import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { repositories } from '../repositories';
import { CartConflictError } from '../domain/cartValidation';
import type { Cart } from '../domain/cart';
import type {
  AddressRepository,
  CartRepository,
  CartValidationRepository,
  OrderCreationRepository,
} from '../repositories/types';

/**
 * Phase D · checkout revalidation.
 *
 * V1.1 §15's Phase D done-when is *"a stale cart cannot become an order"*, and
 * UX-SPEC § C-10 places the check on press. These tests are therefore mostly
 * about what does **not** happen: that no path to payment survives a conflict,
 * and — the one that actually protects the invariant — that an unreachable API
 * does not read as an accepted cart.
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

const LINE_A = {
  id: 'ci-1',
  menuItemId: 'mi-1',
  name: 'ส้มตำไทย',
  basePriceSatang: 6000,
  isAvailable: true,
  quantity: 2,
  note: '',
  options: [{ id: 'o1', menuOptionId: 'mo-1', label: 'ไข่ดาว', priceDeltaSatang: 1000 }],
};

const LINE_B = {
  id: 'ci-2',
  menuItemId: 'mi-2',
  name: 'ผัดกะเพราหมูสับ',
  basePriceSatang: 5000,
  isAvailable: true,
  quantity: 1,
  note: '',
  options: [],
};

function cartWith(lines: Cart['lines']): Cart {
  return { id: 'cart-1', shopId: 'shop-1', lines, unresolvedLineIds: [] };
}

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

function stub(options: {
  lines?: Cart['lines'];
  validate?: jest.Mock;
  removeItem?: jest.Mock;
  createOrder?: jest.Mock;
  listAddresses?: jest.Mock;
}) {
  const cart = cartWith(options.lines ?? [LINE_A]);

  const cartRepo: CartRepository = {
    getCart: jest.fn().mockResolvedValue(cart),
    addItem: jest.fn().mockResolvedValue(cart),
    setQuantity: jest.fn().mockResolvedValue(cart),
    removeItem: options.removeItem ?? jest.fn().mockResolvedValue(cart),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  const validationRepo: CartValidationRepository = {
    validate:
      options.validate ??
      jest.fn().mockResolvedValue({
        cartId: 'cart-1',
        restaurantId: 'shop-1',
        subtotalSatang: 14000,
        lines: [],
      }),
  };

  const orderCreationRepo: OrderCreationRepository = {
    create: options.createOrder ?? jest.fn().mockResolvedValue(CREATED_ORDER),
  };

  const addressRepo: AddressRepository = {
    listAddresses: options.listAddresses ?? jest.fn().mockResolvedValue([DEFAULT_ADDRESS]),
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

  return { cartRepo, validationRepo, orderCreationRepo, addressRepo };
}

function renderCheckout() {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>
          <CheckoutScreen />
        </CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

/** Renders, waits for the cart to load, then presses the checkout CTA. */
async function pressPlaceOrder() {
  renderCheckout();
  await waitFor(() => expect(screen.getByTestId('screen-checkout')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('ส้มตำไทย')).toBeTruthy());
  // Also wait for the address fetch to resolve — onPlaceOrder needs
  // defaultAddress to be populated (Phase E-3A), and pressing before it
  // loads would make every test racily depend on microtask ordering.
  await waitFor(() => expect(screen.getByText(DEFAULT_ADDRESS.label)).toBeTruthy());
  // Wrapped so the validation promise settling is flushed inside act(), rather
  // than resolving after the test body and warning about an unwrapped update.
  await act(async () => {
    fireEvent.press(screen.getByTestId('button-place-order'));
  });
}

beforeEach(() => {
  mockUserId = 'user-1';
  mockNavigate.mockClear();
});

describe('successful validation', () => {
  it('validates, creates the order, then navigates exactly once with the order reference', async () => {
    const { validationRepo, orderCreationRepo } = stub({});
    await pressPlaceOrder();

    await waitFor(() => expect(validationRepo.validate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(orderCreationRepo.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('PromptPayQr', {
      orderId: CREATED_ORDER.orderId,
      orderNumber: CREATED_ORDER.orderNumber,
    });
  });

  it('creates the order against the resolved default address, never a client-invented id', async () => {
    const { orderCreationRepo } = stub({});
    await pressPlaceOrder();

    await waitFor(() =>
      expect(orderCreationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ addressId: DEFAULT_ADDRESS.id }),
      ),
    );
  });

  it('sends the prices the customer was shown, so drift is detectable', async () => {
    const { validationRepo } = stub({ lines: [LINE_A, LINE_B] });
    await pressPlaceOrder();

    // 6000 + 1000 option delta for A; 5000 for B. Unit prices, before quantity.
    await waitFor(() =>
      expect(validationRepo.validate).toHaveBeenCalledWith([
        { cartItemId: 'ci-1', expectedUnitPriceSatang: 7000 },
        { cartItemId: 'ci-2', expectedUnitPriceSatang: 5000 },
      ]),
    );
  });

  it('shows the in-flight state on the CTA while validating', async () => {
    let release: () => void = () => {};
    stub({
      validate: jest.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ cartId: 'c', restaurantId: 'r', subtotalSatang: 0, lines: [] });
          }),
      ),
    });
    await pressPlaceOrder();

    // UX-SPEC § 13, "Loading, action in flight": spinner + disabled. The
    // shared `Button` renders the spinner in place of the label, so
    // `กำลังดำเนินการ` reaches the accessibility tree rather than the visual
    // one — see the unresolved-issues note in the report.
    await waitFor(() => {
      const cta = screen.getByTestId('button-place-order');
      expect(cta.props.accessibilityState.busy).toBe(true);
      expect(cta.props.accessibilityState.disabled).toBe(true);
      expect(cta.props.accessibilityLabel).toBe('กำลังดำเนินการ');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    release();
  });
});

describe('PRICE_CHANGED', () => {
  const priceChanged = () =>
    jest.fn().mockRejectedValue(
      new CartConflictError({
        kind: 'PRICE_CHANGED',
        changes: [{ cartItemId: 'ci-1', wasSatang: 7000, nowSatang: 7500 }],
      }),
    );

  it('does not proceed to payment', async () => {
    stub({ validate: priceChanged() });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-price-changed')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders the UX-SPEC copy with the affected dish and both prices', async () => {
    stub({ validate: priceChanged() });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByText('ราคามีการเปลี่ยนแปลง')).toBeTruthy());
    // The dish is named, not the cart item id.
    expect(screen.getAllByText('ส้มตำไทย').length).toBeGreaterThan(0);

    // Both the old and the new amount are present in the same row — a diff,
    // not just the new price.
    expect(screen.getByTestId('price-diff-ci-1')).toBeTruthy();
    expect(screen.getByText('฿70')).toBeTruthy();
    expect(screen.getByText(/฿75/)).toBeTruthy();
  });

  it('surfaces every changed line, not just the first', async () => {
    stub({
      lines: [LINE_A, LINE_B],
      validate: jest.fn().mockRejectedValue(
        new CartConflictError({
          kind: 'PRICE_CHANGED',
          changes: [
            { cartItemId: 'ci-1', wasSatang: 7000, nowSatang: 7500 },
            { cartItemId: 'ci-2', wasSatang: 5000, nowSatang: 5500 },
          ],
        }),
      ),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('price-diff-ci-1')).toBeTruthy());
    expect(screen.getByTestId('price-diff-ci-2')).toBeTruthy();
  });

  it('acknowledging re-validates rather than bypassing the check', async () => {
    const validate = priceChanged();
    stub({ validate });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('button-acknowledge-price')).toBeTruthy());
    fireEvent.press(screen.getByTestId('button-acknowledge-price'));

    // The diff clears, and — critically — acknowledging alone did not navigate.
    await waitFor(() => expect(screen.queryByTestId('checkout-price-changed')).toBeNull());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('ITEM_UNAVAILABLE', () => {
  const unavailable = () =>
    jest.fn().mockRejectedValue(
      new CartConflictError({
        kind: 'ITEM_UNAVAILABLE',
        items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }],
      }),
    );

  it('does not proceed to payment', async () => {
    stub({ validate: unavailable() });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-item-unavailable')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders the UX-SPEC copy and names the affected dish', async () => {
    stub({ validate: unavailable() });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByText('วันนี้หมด')).toBeTruthy());
    expect(screen.getAllByText('ส้มตำไทย').length).toBeGreaterThan(0);
  });

  it('removes exactly the refused lines through the persisted cart, never silently', async () => {
    const removeItem = jest.fn().mockResolvedValue(cartWith([LINE_B]));
    stub({ lines: [LINE_A, LINE_B], validate: unavailable(), removeItem });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('button-remove-unavailable')).toBeTruthy());
    // The item was still in the cart until the customer chose to remove it.
    expect(removeItem).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('button-remove-unavailable'));

    await waitFor(() => expect(removeItem).toHaveBeenCalledWith('ci-1'));
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('transport / system failure — fails closed', () => {
  it.each([
    ['offline', 'Network request failed', 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต'],
    ['server error', 'Internal error', 'ระบบมีปัญหาชั่วคราว'],
  ])('%s does not proceed to payment', async (_label, message, expectedCopy) => {
    stub({ validate: jest.fn().mockRejectedValue(new Error(message)) });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(screen.getByText(expectedCopy)).toBeTruthy();
    // The invariant: an unreachable API is not an accepted cart.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not render a conflict diff for a system failure', async () => {
    stub({ validate: jest.fn().mockRejectedValue(new Error('boom')) });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(screen.queryByTestId('checkout-price-changed')).toBeNull();
    expect(screen.queryByTestId('checkout-item-unavailable')).toBeNull();
  });

  it('retrying can succeed and then proceeds', async () => {
    const validate = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ cartId: 'c', restaurantId: 'r', subtotalSatang: 0, lines: [] });
    stub({ validate });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('button-retry-validation')).toBeTruthy());
    fireEvent.press(screen.getByTestId('button-retry-validation'));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('PromptPayQr', {
        orderId: CREATED_ORDER.orderId,
        orderNumber: CREATED_ORDER.orderNumber,
      }),
    );
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
