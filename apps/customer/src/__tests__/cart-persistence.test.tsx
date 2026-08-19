import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { Text } from 'react-native';
import { CartProvider, useCart } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { CartScreen } from '../screens/CartScreen';
import { repositories } from '../repositories';
import * as cartDomain from '../domain/cart';
import * as cartHook from '../hooks/useCart';
import * as cartRepo from '../repositories/supabaseCart';
import { cartSubtotalSatang } from '../domain/cart';
import type { Cart } from '../domain/cart';
import type { CartRepository } from '../repositories/types';

/**
 * Phase D / D-5 — the cart is persisted, and the app invents no money.
 *
 * These drive the hook through the repository seam rather than the network, so
 * what is under test is the hook's own contract: that it adopts server state,
 * that it refuses to act without a session (DEC-D-03), and that no fee number
 * survives anywhere in the cart path (DEC-D-01).
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

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() }),
    useRoute: () => ({ params: {} }),
  };
});

function cartWith(lines: Cart['lines']): Cart {
  return { id: 'cart-1', shopId: 'shop-1', lines, unresolvedLineIds: [] };
}

const LINE = {
  id: 'ci-1',
  menuItemId: 'mi-1',
  name: 'ส้มตำไทย',
  basePriceSatang: 6000,
  isAvailable: true,
  quantity: 2,
  note: '',
  options: [{ id: 'o1', menuOptionId: 'mo-1', label: 'ไข่ดาว', priceDeltaSatang: 1000 }],
};

function stubCart(overrides: Partial<CartRepository> = {}) {
  const stub: CartRepository = {
    getCart: jest.fn().mockResolvedValue(null),
    addItem: jest.fn().mockResolvedValue(cartWith([])),
    setQuantity: jest.fn().mockResolvedValue(cartWith([])),
    removeItem: jest.fn().mockResolvedValue(cartWith([])),
    clear: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (repositories as unknown as { cart: CartRepository }).cart = stub;
  return stub;
}

/** Renders a probe that exposes the hook's values as text. */
function Probe() {
  const { cart, itemCount, subtotalSatang, canModify, error } = useCart();
  return (
    <>
      <Text>{`count:${itemCount}`}</Text>
      <Text>{`subtotal:${subtotalSatang}`}</Text>
      <Text>{`canModify:${canModify}`}</Text>
      <Text>{`lines:${cart?.lines.length ?? -1}`}</Text>
      <Text>{`error:${error ?? 'none'}`}</Text>
    </>
  );
}

function renderHook() {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>
          <Probe />
        </CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockUserId = 'user-1';
});

describe('DEC-D-02 — the persisted cart is the source of truth', () => {
  it('loads the cart from the repository on mount, with nothing seeded', async () => {
    const repo = stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderHook();

    await waitFor(() => expect(screen.getByText('lines:1')).toBeTruthy());
    expect(repo.getCart).toHaveBeenCalled();
    // The pre-Phase-D hook started with two hardcoded lines. It must not any more.
    expect(screen.getByText('count:2')).toBeTruthy();
  });

  it('derives the subtotal from live prices, including option deltas', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderHook();

    // (6000 + 1000) × 2
    await waitFor(() => expect(screen.getByText('subtotal:14000')).toBeTruthy());
  });

  it('adopts the cart the server returned after a mutation, not a local guess', async () => {
    const serverCart = cartWith([{ ...LINE, quantity: 9 }]);
    stubCart({
      getCart: jest.fn().mockResolvedValue(cartWith([LINE])),
      setQuantity: jest.fn().mockResolvedValue(serverCart),
    });

    render(
      <NavigationContainer>
        <AuthProvider>
          <CartProvider>
            <CartScreen />
          </CartProvider>
        </AuthProvider>
      </NavigationContainer>,
    );

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('เพิ่มจำนวน'));

    // 9 is what the server said; a local increment would have produced 3.
    await waitFor(() => expect(screen.getByText('9')).toBeTruthy());
  });

  it('restores nothing and shows no cart when signed out', async () => {
    mockUserId = null;
    const repo = stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderHook();

    await waitFor(() => expect(screen.getByText('lines:-1')).toBeTruthy());
    // Not an error, and not a request — a signed-out customer simply has no
    // cart in view. The row itself is untouched, waiting for the next sign-in.
    expect(repo.getCart).not.toHaveBeenCalled();
    expect(screen.getByText('error:none')).toBeTruthy();
  });
});

describe('DEC-D-03 — no guest cart', () => {
  it('reports that the cart cannot be modified when signed out', async () => {
    mockUserId = null;
    stubCart();
    renderHook();

    await waitFor(() => expect(screen.getByText('canModify:false')).toBeTruthy());
  });

  it('allows modification once a session exists', async () => {
    stubCart();
    renderHook();

    await waitFor(() => expect(screen.getByText('canModify:true')).toBeTruthy());
  });
});

describe('DEC-D-01 — the cart screen invents no money', () => {
  it('renders the UX-SPEC § C-09 pending-fee copy for both fee rows', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });

    render(
      <NavigationContainer>
        <AuthProvider>
          <CartProvider>
            <CartScreen />
          </CartProvider>
        </AuthProvider>
      </NavigationContainer>,
    );

    await waitFor(() => expect(screen.getByTestId('cart-summary')).toBeTruthy());
    expect(screen.getAllByText('คำนวณเมื่อยืนยัน')).toHaveLength(2);
  });

  it('shows the food subtotal but no grand total or discount', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });

    render(
      <NavigationContainer>
        <AuthProvider>
          <CartProvider>
            <CartScreen />
          </CartProvider>
        </AuthProvider>
      </NavigationContainer>,
    );

    await waitFor(() => expect(screen.getByTestId('cart-summary')).toBeTruthy());
    expect(screen.getByText('ราคาอาหาร')).toBeTruthy();
    // The sample ฿15 / ฿5 / ฿10 BANHAO7 rows and the total are gone.
    expect(screen.queryByText('รวมทั้งหมด')).toBeNull();
    expect(screen.queryByText(/BANHAO7/)).toBeNull();
    expect(screen.queryByText('฿15')).toBeNull();
  });
});

describe('mock boundary', () => {
  it('the cart path exposes no sample fee value anywhere', () => {
    // The structural guarantee is an eslint `no-restricted-imports` override
    // pinned to the cart files (.eslintrc.json). This asserts the observable
    // consequence: none of the design's illustrative figures — ฿15 delivery,
    // ฿5 service, the ฿10 BANHAO7 discount — can be reached from the cart.
    for (const moduleUnderTest of [cartDomain, cartHook, cartRepo]) {
      const surface = Object.keys(moduleUnderTest).join(' ');
      expect(surface).not.toMatch(/SAMPLE_/);
      expect(surface).not.toMatch(/calculateTotals/);
    }
  });

  it('a cart built from live rows carries only catalog-sourced money', () => {
    // 6000 + 1000 option delta, x2 — and nothing added on top. If a fee ever
    // sneaks back into the subtotal, this is the number that moves.
    expect(cartSubtotalSatang(cartWith([LINE]))).toBe(14000);
  });
});
