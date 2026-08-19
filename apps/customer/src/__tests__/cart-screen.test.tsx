import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { CartScreen } from '../screens/CartScreen';
import { repositories } from '../repositories';
import type { Cart } from '../domain/cart';
import type { CartRepository } from '../repositories/types';

/**
 * Phase D / D-7 — CartScreen against the persisted, Supabase-backed cart.
 *
 * `__tests__/cart-persistence.test.tsx` (D-5) already covers the hook's own
 * contract — this file is specifically the screen: real lines render, no fee
 * is invented, mutations go through the persisted repository operations
 * rather than local state, and loading/error reuse the same `StateView` +
 * `presentLoadError` pattern every other Phase C screen already uses.
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

function renderCart() {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>
          <CartScreen />
        </CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockUserId = 'user-1';
  mockNavigate.mockClear();
});

describe('D-7 — empty cart', () => {
  it('renders the UX-SPEC § 13 empty-cart copy, with nothing seeded', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(null) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('state-cart-empty')).toBeTruthy());
    expect(screen.getByText('ตะกร้ายังว่างอยู่')).toBeTruthy();
    expect(screen.getByText('เลือกอาหาร')).toBeTruthy();
  });
});

describe('D-7 — cart lines from the persisted cart', () => {
  it('renders real name, option labels, quantity and line subtotal', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    expect(screen.getByText('ส้มตำไทย')).toBeTruthy();
    expect(screen.getByText('ไข่ดาว')).toBeTruthy();
    // (6000 + 1000) × 2 = 14000 satang = ฿140 — the D-2 domain arithmetic, not
    // a locally invented figure. Appears on both the line and the subtotal.
    expect(screen.getAllByText('฿140')).toHaveLength(2);
  });

  it('shows the subtotal derived from the cart domain, not a client guess', async () => {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-summary')).toBeTruthy());
    expect(screen.getByText('ราคาอาหาร')).toBeTruthy();
    expect(screen.getAllByText('฿140').length).toBeGreaterThan(0);
  });
});

describe('D-7 — DEC-D-01, no invented money in the summary', () => {
  async function renderWithSummary() {
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderCart();
    await waitFor(() => expect(screen.getByTestId('cart-summary')).toBeTruthy());
  }

  it('shows the pending-fee copy for delivery', async () => {
    await renderWithSummary();
    expect(screen.getByText('ค่าส่ง')).toBeTruthy();
    expect(screen.getAllByText('คำนวณเมื่อยืนยัน').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the pending-fee copy for service', async () => {
    await renderWithSummary();
    expect(screen.getByText('ค่าบริการ')).toBeTruthy();
    expect(screen.getAllByText('คำนวณเมื่อยืนยัน')).toHaveLength(2);
  });

  it('shows no discount row of any kind', async () => {
    await renderWithSummary();
    expect(screen.queryByText(/ส่วนลด/)).toBeNull();
    expect(screen.queryByText(/BANHAO7/)).toBeNull();
  });

  it('shows no grand total row', async () => {
    await renderWithSummary();
    expect(screen.queryByText('รวมทั้งหมด')).toBeNull();
  });

  it('the CTA button shows only the item count, no trailing amount', async () => {
    await renderWithSummary();
    // A subtotal on the CTA would read as the amount payable, which it isn't
    // — only "ยืนยันการสั่ง (N)" is present, no "฿NNN" alongside it.
    expect(screen.getByText('ยืนยันการสั่ง (2)')).toBeTruthy();
    expect(screen.getAllByText(/^฿/).length).toBeGreaterThan(0); // the line/subtotal rows themselves
    expect(screen.queryByText(/ยืนยันการสั่ง.*฿/)).toBeNull();
  });
});

describe('D-7 — quantity and remove use the persisted repository operations', () => {
  it('increase calls setQuantity with quantity + 1 and adopts the server result', async () => {
    const repo = stubCart({
      getCart: jest.fn().mockResolvedValue(cartWith([LINE])),
      setQuantity: jest.fn().mockResolvedValue(cartWith([{ ...LINE, quantity: 3 }])),
    });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('เพิ่มจำนวน'));

    await waitFor(() => expect(repo.setQuantity).toHaveBeenCalledWith('ci-1', 3));
    // The rendered value is what the server returned (3), not a local 2+1
    // guess computed independently of the mock's response.
    await waitFor(() => expect(screen.getByLabelText('จำนวน 3')).toBeTruthy());
  });

  it('decrease calls setQuantity with quantity - 1', async () => {
    const repo = stubCart({
      getCart: jest.fn().mockResolvedValue(cartWith([LINE])),
      setQuantity: jest.fn().mockResolvedValue(cartWith([{ ...LINE, quantity: 1 }])),
    });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('ลดจำนวน'));

    await waitFor(() => expect(repo.setQuantity).toHaveBeenCalledWith('ci-1', 1));
  });

  it('remove calls removeItem and the line disappears once the server confirms', async () => {
    const repo = stubCart({
      getCart: jest.fn().mockResolvedValue(cartWith([LINE])),
      removeItem: jest.fn().mockResolvedValue(cartWith([])),
    });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('remove-ci-1'));

    await waitFor(() => expect(repo.removeItem).toHaveBeenCalledWith('ci-1'));
    await waitFor(() => expect(screen.getByTestId('state-cart-empty')).toBeTruthy());
  });
});

describe('D-7 — loading and error states reuse existing conventions', () => {
  it('shows the shared loading state before the cart resolves', async () => {
    let resolveCart: (cart: Cart | null) => void = () => {};
    stubCart({
      getCart: jest.fn(
        () =>
          new Promise<Cart | null>((resolve) => {
            resolveCart = resolve;
          }),
      ),
    });
    renderCart();

    expect(screen.getByTestId('screen-cart-loading')).toBeTruthy();
    await act(async () => {
      resolveCart(null);
      await Promise.resolve();
    });
  });

  it('shows the shared offline copy for a network failure loading the cart', async () => {
    stubCart({ getCart: jest.fn().mockRejectedValue(new Error('Network request failed')) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('screen-cart-error')).toBeTruthy());
    expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy();
  });

  it('shows the shared server-error copy for a non-network failure', async () => {
    stubCart({ getCart: jest.fn().mockRejectedValue(new Error('Cart lookup failed: boom')) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('screen-cart-error')).toBeTruthy());
    expect(screen.getByText('ระบบมีปัญหาชั่วคราว')).toBeTruthy();
  });

  it('retries by reloading the cart, not by inventing local recovery', async () => {
    const getCart = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(cartWith([LINE]));
    stubCart({ getCart });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('screen-cart-error')).toBeTruthy());
    fireEvent.press(screen.getByText('ลองอีกครั้ง'));

    await waitFor(() => expect(screen.getByTestId('cart-line-ci-1')).toBeTruthy());
    expect(getCart).toHaveBeenCalledTimes(2);
  });
});

describe('D-7 — DEC-D-03, signed-out users never reach the repository', () => {
  it('renders the empty state without ever calling getCart', async () => {
    mockUserId = null;
    const repo = stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('state-cart-empty')).toBeTruthy());
    expect(repo.getCart).not.toHaveBeenCalled();
  });
});

describe('D-7 — mock boundary', () => {
  it('CartScreen renders no known mock-only string (BANHAO7, sample fee glyphs)', async () => {
    // The structural guarantee is the eslint `no-restricted-imports` override
    // already pinned to `screens/CartScreen.tsx` in .eslintrc.json (from D-5,
    // unchanged here). This is the observable consequence: no mock-sourced
    // value reaches the rendered tree.
    stubCart({ getCart: jest.fn().mockResolvedValue(cartWith([LINE])) });
    renderCart();

    await waitFor(() => expect(screen.getByTestId('cart-summary')).toBeTruthy());
    expect(screen.queryByText(/BANHAO7/)).toBeNull();
    expect(screen.queryByText('฿15.00')).toBeNull();
    expect(screen.queryByText('฿5.00')).toBeNull();
  });
});
