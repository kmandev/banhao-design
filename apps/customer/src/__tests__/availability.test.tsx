import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { ShopScreen } from '../screens/ShopScreen';
import { ItemOptionsScreen } from '../screens/ItemOptionsScreen';
import { repositories } from '../repositories';
import type { MenuItem, Shop } from '../domain/catalog';

/**
 * PC-Q-001 / C-8 — unavailable items and options.
 *
 * RLS now returns sold-out rows to customers, so the app is what decides they
 * cannot be ordered. These tests assert the *interaction* boundary, not the
 * styling: a greyed row that still navigates would pass a visual check and fail
 * the customer.
 */

const mockNavigate = jest.fn();
const mockRouteParams: Record<string, unknown> = {};

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
  hours: [],
  isOpen: true,
  todayHours: '09:00 - 20:00',
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
    // row cannot reach it — so the cart is left exactly as it was. (The cart
    // bar itself may already be showing from pre-existing cart contents; what
    // matters is that pressing this row moves nothing.)
    await renderShop();
    const before = screen.getByTestId('button-view-cart').props.children;

    fireEvent.press(screen.getByTestId('menu-row-item-soldout'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('button-view-cart').props.children).toEqual(before);
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
