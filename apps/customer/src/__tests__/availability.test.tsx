import { render, screen, waitFor, fireEvent, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { ShopScreen } from '../screens/ShopScreen';
import { ItemOptionsScreen } from '../screens/ItemOptionsScreen';
import { repositories } from '../repositories';
import { PAUSED_LABEL } from '../lib/catalogDisplay';
import type { MenuItem, Shop } from '../domain/catalog';
import type { Cart } from '../domain/cart';
import type { CartRepository } from '../repositories/types';

/**
 * PC-Q-001 / C-8 — unavailable items and options.
 *
 * RLS now returns sold-out rows to customers, so the app is what decides they
 * cannot be ordered. These tests assert the *interaction* boundary, not the
 * styling: a greyed row that still navigates would pass a visual check and fail
 * the customer.
 *
 * The final describe block (G-1, M-AV final recon) reuses the same fixtures
 * for the shop-wide Pause gate: a Paused restaurant blocks the add-to-cart
 * *action*, never the ability to view the shop or the item.
 */

const mockNavigate = jest.fn();
const mockRouteParams: Record<string, unknown> = {};

/**
 * Session control for the G-1 "remains available" control cases only.
 * Defaults to signed-out, matching every other test in this file — the real
 * `AuthProvider` would resolve the same way against the jest-wide Supabase
 * mock (`jest.setup.js`), so this mock changes nothing for the existing
 * PC-Q-001/C-8 tests above and only needs to move for the two control cases
 * that prove Busy/Normal actually complete an add.
 */
let mockUserId: string | null = null;

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
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

const SHOP: Shop = {
  id: 'shop-1',
  name: 'ส้มตำป้าทองดี',
  description: null,
  cuisine: 'อาหารอีสาน',
  imageUrl: null,
  phone: null,
  addressLine: null,
  lat: null,
  lng: null,
  minOrderSatang: null,
  avgPrepMinutes: null,
  ratingAvg: 4.8,
  ratingCount: 326,
  temporarilyClosedUntil: null,
  availabilityMode: 'NORMAL',
  busyPrepMinutes: null,
  hours: [],
  isOpen: true,
  todayHours: '09:00 - 20:00',
  isOrderable: true,
};

const AVAILABLE_ITEM: MenuItem = {
  id: 'item-available',
  shopId: 'shop-1',
  categoryId: 'cat-1',
  categoryName: 'แนะนำ',
  name: 'ส้มตำไทย',
  description: null,
  priceSatang: 6000,
  imageUrl: null,
  isAvailable: true,
  sortOrder: 0,
};

const SOLD_OUT_ITEM: MenuItem = {
  ...AVAILABLE_ITEM,
  id: 'item-soldout',
  name: 'ตำซั่วปูปลาร้า',
  isAvailable: false,
  sortOrder: 1,
};

/** The whole item is sold out, not just one of its options. */
const SOLD_OUT_WHOLE_ITEM: MenuItem = {
  ...AVAILABLE_ITEM,
  id: 'item-wholly-unavailable',
  name: 'ของหมดทั้งจาน',
  isAvailable: false,
};

/** Item with a required group whose second option is sold out. */
const ITEM_WITH_OPTIONS: MenuItem = {
  ...AVAILABLE_ITEM,
  id: 'item-options',
  optionGroups: [
    {
      id: 'group-required',
      menuItemId: 'item-options',
      title: 'ระดับความเผ็ด',
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      options: [
        { id: 'opt-mild', label: 'เผ็ดน้อย', priceDeltaSatang: 0, isAvailable: true, sortOrder: 0 },
        { id: 'opt-hot', label: 'เผ็ดมาก', priceDeltaSatang: 1000, isAvailable: false, sortOrder: 1 },
      ],
    },
    {
      id: 'group-optional',
      menuItemId: 'item-options',
      title: 'เพิ่มไข่',
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 1,
      options: [
        { id: 'opt-egg', label: 'ไข่ดาว', priceDeltaSatang: 1500, isAvailable: true, sortOrder: 0 },
      ],
    },
  ],
};

const mockCatalog = {
  listCategories: jest.fn().mockResolvedValue([]),
  listShops: jest.fn().mockResolvedValue([SHOP]),
  getShop: jest.fn().mockResolvedValue(SHOP),
  listMenu: jest.fn().mockResolvedValue([AVAILABLE_ITEM, SOLD_OUT_ITEM]),
  getMenuItem: jest.fn().mockResolvedValue(ITEM_WITH_OPTIONS),
  search: jest.fn().mockResolvedValue({ shops: [], items: [] }),
};

/**
 * The catalog binding is swapped on the live `repositories` object rather than
 * via `jest.mock`: the factory is hoisted above these fixtures, so a module mock
 * cannot see them. Mutating the seam is exactly what the seam is for.
 */
beforeAll(() => {
  (repositories as unknown as { catalog: typeof mockCatalog }).catalog = mockCatalog;
});

function renderScreen(ui: React.ReactElement) {
  return render(
    <NavigationContainer>
      <AuthProvider>
        <CartProvider>{ui}</CartProvider>
      </AuthProvider>
    </NavigationContainer>,
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
  for (const key of Object.keys(mockRouteParams)) delete mockRouteParams[key];
  mockRouteParams.shopId = 'shop-1';
  mockRouteParams.itemId = 'item-options';
});

describe('ShopScreen — unavailable items (C-8)', () => {
  async function renderShop() {
    renderScreen(<ShopScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-shop')).toBeTruthy());
  }

  it('renders an available item normally', async () => {
    await renderShop();
    expect(screen.getByTestId('menu-row-item-available')).toBeTruthy();
    expect(screen.getByText('ส้มตำไทย')).toBeTruthy();
  });

  it('keeps an unavailable item VISIBLE in its category', async () => {
    // The whole point of PC-Q-001: hiding it would make the menu inconsistent
    // with what the customer saw yesterday.
    await renderShop();
    expect(screen.getByTestId('menu-row-item-soldout')).toBeTruthy();
    expect(screen.getByText('ตำซั่วปูปลาร้า')).toBeTruthy();
  });

  it('labels the unavailable item วันนี้หมด', async () => {
    await renderShop();
    expect(screen.getByText('วันนี้หมด')).toBeTruthy();
  });

  it('does NOT navigate when the unavailable item is pressed', async () => {
    await renderShop();
    fireEvent.press(screen.getByTestId('menu-row-item-soldout'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('still navigates when the available item is pressed', async () => {
    await renderShop();
    fireEvent.press(screen.getByTestId('menu-row-item-available'));
    expect(mockNavigate).toHaveBeenCalledWith('ItemOptions', {
      shopId: 'shop-1',
      itemId: 'item-available',
    });
  });

  it('renders the unavailable row as a non-button, so it cannot be activated', async () => {
    // Structural, not cosmetic: MenuRow withholds onPress entirely, so the row
    // is not a Pressable at all — opacity is not what stops the tap.
    await renderShop();
    const soldOut = screen.getByTestId('menu-row-item-soldout');
    const available = screen.getByTestId('menu-row-item-available');

    expect(soldOut.props.accessibilityRole).toBeUndefined();
    expect(available.props.accessibilityRole).toBe('button');
  });

  it('does not change cart state when the unavailable item is pressed', async () => {
    // The only add-to-cart path from the menu is ItemOptions, and a sold-out
    // row cannot reach it — so the cart is left exactly as it was.
    //
    // From Phase D the cart is persisted and starts empty rather than carrying
    // two seeded lines, so "unchanged" is observed as the cart bar never
    // appearing: it renders only when `itemCount > 0`.
    await renderShop();
    expect(screen.queryByTestId('button-view-cart')).toBeNull();

    fireEvent.press(screen.getByTestId('menu-row-item-soldout'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('button-view-cart')).toBeNull();
  });
});

describe('ItemOptionsScreen — unavailable options (C-8)', () => {
  async function renderItem() {
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());
  }

  it('keeps an unavailable option visible', async () => {
    await renderItem();
    expect(screen.getByTestId('option-group-required-opt-hot')).toBeTruthy();
    expect(screen.getByText('เผ็ดมาก')).toBeTruthy();
  });

  it('labels the unavailable option วันนี้หมด instead of a price', async () => {
    await renderItem();
    expect(screen.getByText('วันนี้หมด')).toBeTruthy();
    // Its +฿10 delta must not be advertised as orderable.
    expect(screen.queryByText('+฿10')).toBeNull();
  });

  it('allows selecting an available option', async () => {
    await renderItem();
    const egg = screen.getByTestId('option-group-optional-opt-egg');
    fireEvent.press(egg);
    await waitFor(() =>
      expect(
        screen.getByTestId('option-group-optional-opt-egg').props.accessibilityState?.selected,
      ).toBe(true),
    );
  });

  it('does NOT select an unavailable option when pressed', async () => {
    await renderItem();
    const hot = screen.getByTestId('option-group-required-opt-hot');
    fireEvent.press(hot);

    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());
    expect(
      screen.getByTestId('option-group-required-opt-hot').props.accessibilityState?.selected,
    ).toBe(false);
    // The available sibling keeps the required group's default selection.
    expect(
      screen.getByTestId('option-group-required-opt-mild').props.accessibilityState?.selected,
    ).toBe(true);
  });

  it('renders the unavailable option as a non-button', async () => {
    await renderItem();
    expect(
      screen.getByTestId('option-group-required-opt-hot').props.accessibilityRole,
    ).toBeUndefined();
    expect(
      screen.getByTestId('option-group-required-opt-mild').props.accessibilityRole,
    ).toBe('button');
  });

  it('defaults a required group to the first AVAILABLE option, never a sold-out one', async () => {
    await renderItem();
    // If the default were `options[0]` blindly and that option were sold out,
    // an unavailable choice would silently satisfy a required group and price
    // the line. `เผ็ดน้อย` is available and must be the default.
    expect(
      screen.getByTestId('option-group-required-opt-mild').props.accessibilityState?.selected,
    ).toBe(true);
  });

  it('does not add an unavailable option’s price to the line total', async () => {
    await renderItem();
    // Base ฿60, default mild (+0). The sold-out เผ็ดมาก (+฿10) must not count.
    expect(screen.getByTestId('button-add-to-cart')).toBeTruthy();
    expect(screen.queryByText('฿70')).toBeNull();
  });

  it('preserves multi-select semantics from minSelect/maxSelect', async () => {
    await renderItem();
    // group-optional is minSelect 0 / maxSelect 2 — optional and multi-capable,
    // so it must NOT carry the required badge that group-required does.
    expect(screen.getByText('ระดับความเผ็ด')).toBeTruthy();
    expect(screen.getByText('เพิ่มไข่')).toBeTruthy();
    expect(screen.getAllByText('ต้องเลือก')).toHaveLength(1);
  });
});

describe('ItemOptionsScreen — the whole item can be unavailable (Step 8)', () => {
  // Not just an option within an item — the item itself. Reachable via a
  // stale nav param, a deep link, or (before the SearchScreen fix) a search
  // result. ShopScreen and SearchScreen both refuse to navigate here for such
  // an item, but this screen must not depend on that alone.

  beforeEach(() => {
    mockRouteParams.shopId = 'shop-1';
    mockRouteParams.itemId = 'item-wholly-unavailable';
    mockCatalog.getMenuItem.mockResolvedValueOnce(SOLD_OUT_WHOLE_ITEM);
  });

  it('relabels the CTA to วันนี้หมด instead of the price', async () => {
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    expect(screen.getByTestId('button-add-to-cart').props.accessibilityLabel).toBe('วันนี้หมด');
  });

  it('disables the CTA at the component level, not just visually', async () => {
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    expect(
      screen.getByTestId('button-add-to-cart').props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it('does not add the item to the cart when the disabled CTA is pressed', async () => {
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    fireEvent.press(screen.getByTestId('button-add-to-cart'));

    // No navigation to Cart happened — the only observable sign addLine ran.
    expect(mockNavigate).not.toHaveBeenCalledWith('Cart');
  });
});

describe('ItemOptionsScreen — Pause blocks the action, not the view (G-1)', () => {
  // M-AV final recon G-1: server-side protection (cart validate's
  // RESTAURANT_CLOSED, create_order()'s PAUSED refusal) already existed;
  // this closes the matching client-side gap. Reuses `availabilityMode`,
  // the same M-13 source of truth ShopScreen's own Paused banner already
  // reads — never a second, independent Pause signal.

  const PAUSED_SHOP: Shop = { ...SHOP, availabilityMode: 'PAUSED', busyPrepMinutes: null };
  const BUSY_SHOP: Shop = { ...SHOP, availabilityMode: 'BUSY', busyPrepMinutes: 20 };

  const AN_ITEM: MenuItem = { ...AVAILABLE_ITEM, id: 'item-plain', name: 'ข้าวผัดกุ้ง' };

  beforeEach(() => {
    mockRouteParams.shopId = 'shop-1';
    mockRouteParams.itemId = 'item-plain';
    mockCatalog.getMenuItem.mockResolvedValueOnce(AN_ITEM);
  });

  afterEach(() => {
    mockUserId = null;
  });

  it('PAUSED: labels the CTA with the established Pause wording, never a new string', async () => {
    mockCatalog.getShop.mockResolvedValueOnce(PAUSED_SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    expect(screen.getByTestId('button-add-to-cart').props.accessibilityLabel).toBe(PAUSED_LABEL);
    // Not the sold-out wording — a Paused shop is a different fact from an
    // out-of-stock item, and reusing วันนี้หมด would misreport why.
    expect(screen.queryByText('วันนี้หมด')).toBeNull();
  });

  it('PAUSED: disables the CTA at the component level', async () => {
    mockCatalog.getShop.mockResolvedValueOnce(PAUSED_SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    expect(
      screen.getByTestId('button-add-to-cart').props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it('PAUSED: pressing the CTA never navigates to Cart', async () => {
    mockCatalog.getShop.mockResolvedValueOnce(PAUSED_SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    fireEvent.press(screen.getByTestId('button-add-to-cart'));

    expect(mockNavigate).not.toHaveBeenCalledWith('Cart');
  });

  it('PAUSED: the item itself stays visible and inspectable', async () => {
    // "Menu still browsable" (M-13 design § shop page) — Pause blocks the
    // action, not navigation into the item or its price display.
    mockCatalog.getShop.mockResolvedValueOnce(PAUSED_SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    expect(screen.getByText('ข้าวผัดกุ้ง')).toBeTruthy();
    expect(screen.getByText('฿60')).toBeTruthy();
  });

  it('NORMAL: the CTA is never the Pause label (signed-out control)', async () => {
    // `SHOP` (the file's default fixture) is NORMAL. Signed-out here, like
    // every other test in this file, so the CTA reads the sign-in prompt —
    // that branch is untouched by G-1. What this asserts is the one thing
    // G-1 could regress: NORMAL must never show the Pause wording or the
    // Pause-disabled state.
    mockCatalog.getShop.mockResolvedValueOnce(SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    const button = screen.getByTestId('button-add-to-cart');
    expect(button.props.accessibilityLabel).not.toBe(PAUSED_LABEL);
    expect(button.props.accessibilityLabel).toBe('เข้าสู่ระบบเพื่อสั่ง');
  });

  it('BUSY: the CTA is never the Pause label (signed-out control)', async () => {
    mockCatalog.getShop.mockResolvedValueOnce(BUSY_SHOP);
    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    const button = screen.getByTestId('button-add-to-cart');
    expect(button.props.accessibilityLabel).not.toBe(PAUSED_LABEL);
    expect(button.props.accessibilityLabel).toBe('เข้าสู่ระบบเพื่อสั่ง');
  });

  it('NORMAL, signed in: add-to-cart completes and navigates to Cart', async () => {
    // The one end-to-end proof that G-1's guard is additive, not a second
    // independent block: a genuinely purchasable item in a Normal shop still
    // reaches the cart. Signs in and swaps `repositories.cart` for this one
    // test only — every other test in this file stays on the lightweight
    // signed-out path.
    mockUserId = 'user-1';
    mockCatalog.getShop.mockResolvedValueOnce(SHOP);

    const emptyCart: Cart = { id: 'cart-1', shopId: 'shop-1', lines: [], unresolvedLineIds: [] };
    const cartWithItem: Cart = {
      ...emptyCart,
      lines: [
        {
          id: 'ci-1',
          menuItemId: AN_ITEM.id,
          name: AN_ITEM.name,
          basePriceSatang: AN_ITEM.priceSatang,
          isAvailable: true,
          quantity: 1,
          note: '',
          options: [],
        },
      ],
    };
    const mockCart: CartRepository = {
      getCart: jest.fn().mockResolvedValue(emptyCart),
      addItem: jest.fn().mockResolvedValue(cartWithItem),
      setQuantity: jest.fn().mockResolvedValue(cartWithItem),
      removeItem: jest.fn().mockResolvedValue(emptyCart),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    (repositories as unknown as { cart: CartRepository }).cart = mockCart;

    renderScreen(<ItemOptionsScreen />);
    await waitFor(() => expect(screen.getByTestId('screen-item-options')).toBeTruthy());

    const button = screen.getByTestId('button-add-to-cart');
    expect(button.props.accessibilityLabel).toBe('เพิ่มลงตะกร้า');
    expect(button.props.accessibilityState?.disabled).toBeFalsy();

    await act(async () => {
      fireEvent.press(button);
    });

    expect(mockCart.addItem).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('Cart');
  });

  // Not duplicated here — already covered above and unaffected by this
  // change, since `isPaused` is an additional guard alongside, never a
  // replacement for, the existing checks:
  //   - sold-out item: 'ItemOptionsScreen — the whole item can be
  //     unavailable (Step 8)', which the !item.isAvailable check (evaluated
  //     before isPaused) still owns entirely.
  //   - signed-out behaviour: exercised by every test in this describe
  //     block's default (mockUserId = null); the sign-in label is asserted
  //     directly in the NORMAL/BUSY control cases above.
});
