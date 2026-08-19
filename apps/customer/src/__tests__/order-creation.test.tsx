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
 * Phase E-3A — real order creation from `CheckoutScreen`.
 *
 * `checkout-revalidation.test.tsx` already covers what happens when
 * `cartValidation.validate` itself rejects (Phase D). This file covers the
 * step after it now passes: `orderCreation.create` — the actual
 * `POST /api/v1/orders` call — succeeding or failing, and proves the mock
 * order-creation path is not what the real screen is wired to.
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
  options: [],
};

const DEFAULT_ADDRESS = {
  id: 'address-1',
  label: 'บ้าน',
  glyph: '📍',
  line: 'ที่อยู่ทดสอบ',
  isDefault: true,
};

function cartWith(lines: Cart['lines']): Cart {
  return { id: 'cart-1', shopId: 'shop-1', lines, unresolvedLineIds: [] };
}

function stub(options: {
  clear?: jest.Mock;
  removeItem?: jest.Mock;
  createOrder?: jest.Mock;
}) {
  const cart = cartWith([LINE_A]);
  const clear = options.clear ?? jest.fn().mockResolvedValue(undefined);
  const removeItem = options.removeItem ?? jest.fn().mockResolvedValue(cart);

  const cartRepo: CartRepository = {
    getCart: jest.fn().mockResolvedValue(cart),
    addItem: jest.fn().mockResolvedValue(cart),
    setQuantity: jest.fn().mockResolvedValue(cart),
    removeItem,
    clear,
  };

  const validationRepo: CartValidationRepository = {
    validate: jest.fn().mockResolvedValue({
      cartId: 'cart-1',
      restaurantId: 'shop-1',
      subtotalSatang: 12000,
      lines: [],
    }),
  };

  const orderCreationRepo: OrderCreationRepository = {
    create:
      options.createOrder ??
      jest.fn().mockResolvedValue({ orderId: 'order-1', orderNumber: 'BH-20260819-0001', state: 'CREATED' }),
  };

  const addressRepo: AddressRepository = {
    listAddresses: jest.fn().mockResolvedValue([DEFAULT_ADDRESS]),
  };

  (repositories as unknown as { cart: CartRepository }).cart = cartRepo;
  (repositories as unknown as { cartValidation: CartValidationRepository }).cartValidation =
    validationRepo;
  (repositories as unknown as { orderCreation: OrderCreationRepository }).orderCreation =
    orderCreationRepo;
  (repositories as unknown as { addresses: AddressRepository }).addresses = addressRepo;

  return { cartRepo, validationRepo, orderCreationRepo, addressRepo, clear, removeItem };
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

async function pressPlaceOrder() {
  renderCheckout();
  await waitFor(() => expect(screen.getByTestId('screen-checkout')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('ส้มตำไทย')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(DEFAULT_ADDRESS.label)).toBeTruthy());
  await act(async () => {
    fireEvent.press(screen.getByTestId('button-place-order'));
  });
}

beforeEach(() => {
  mockUserId = 'user-1';
  mockNavigate.mockClear();
});

describe('order creation — success (G)', () => {
  it('calls create_order via POST /orders and navigates with orderId/orderNumber', async () => {
    const { orderCreationRepo } = stub({
      createOrder: jest.fn().mockResolvedValue({
        orderId: 'order-42',
        orderNumber: 'BH-20260819-0042',
        state: 'CREATED',
      }),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(orderCreationRepo.create).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('PromptPayQr', {
        orderId: 'order-42',
        orderNumber: 'BH-20260819-0042',
      }),
    );
  });

  it('sends only addressId and expectedLines — no customerId, restaurantId, or money field', async () => {
    const { orderCreationRepo } = stub({});
    await pressPlaceOrder();

    await waitFor(() => expect(orderCreationRepo.create).toHaveBeenCalledTimes(1));
    const [input] = (orderCreationRepo.create as jest.Mock).mock.calls[0] as [Record<string, unknown>];

    expect(Object.keys(input).sort()).toEqual(['addressId', 'expectedLines']);
    expect(input.addressId).toBe(DEFAULT_ADDRESS.id);
    expect(input.expectedLines).toEqual([{ cartItemId: 'ci-1', expectedUnitPriceSatang: 6000 }]);
  });
});

describe('order creation — failure fails closed (H, I)', () => {
  it('does not navigate when order creation fails', async () => {
    const { clear } = stub({
      createOrder: jest.fn().mockRejectedValue(new Error('Internal error')),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not clear or otherwise mutate the cart when order creation fails', async () => {
    const { clear, removeItem } = stub({
      createOrder: jest.fn().mockRejectedValue(new Error('Internal error')),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(clear).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('CART_EMPTY from order creation renders the generic system-error state, not a success', async () => {
    stub({ createOrder: jest.fn().mockRejectedValue(new Error('CART_EMPTY')) });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('order creation — conflicts reuse the existing Phase D UI (J, K)', () => {
  it('PRICE_CHANGED from order creation renders the same price-changed card cart/validate uses', async () => {
    stub({
      createOrder: jest.fn().mockRejectedValue(
        new CartConflictError({
          kind: 'PRICE_CHANGED',
          changes: [{ cartItemId: 'ci-1', wasSatang: 6000, nowSatang: 6500 }],
        }),
      ),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-price-changed')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ITEM_UNAVAILABLE from order creation renders the same unavailable card cart/validate uses', async () => {
    stub({
      createOrder: jest.fn().mockRejectedValue(
        new CartConflictError({ kind: 'ITEM_UNAVAILABLE', items: [{ cartItemId: 'ci-1', menuItemId: 'mi-1' }] }),
      ),
    });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-item-unavailable')).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('order creation — DEC-E-01 pricing gate (L)', () => {
  it('NOT_IMPLEMENTED (no approved fee yet) renders the generic system error, never a fabricated success', async () => {
    stub({ createOrder: jest.fn().mockRejectedValue(new Error('NOT_IMPLEMENTED')) });
    await pressPlaceOrder();

    await waitFor(() => expect(screen.getByTestId('checkout-validation-error')).toBeTruthy());
    expect(screen.getByText('ระบบมีปัญหาชั่วคราว')).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('checkout-price-changed')).toBeNull();
    expect(screen.queryByTestId('checkout-item-unavailable')).toBeNull();
  });
});

// (M) "the real checkout path never uses mock order creation" is asserted in
// repositories/orderCreationWiring.test.ts, in its own file — this file's
// stub() mutates the shared repositories singleton across many tests, which
// would make an in-file wiring assertion depend on test execution order.
