import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { CartProvider } from '../hooks/useCart';
import { AuthProvider } from '../hooks/useAuth';
import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { ShopScreen } from '../screens/ShopScreen';
import { repositories } from '../repositories';
import type { MenuItem, Shop } from '../domain/catalog';
import type { Category } from '../domain/categoryTaxonomy';

/**
 * Phase C / C-9 — loading, empty, offline, server-error and closed-restaurant
 * states, checked against the actual UX-SPEC § 13 copy rather than "a state
 * rendered something".
 */

const mockRouteParams: Record<string, unknown> = {};

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      replace: jest.fn(),
      goBack: jest.fn(),
      setOptions: jest.fn(),
    }),
    useRoute: () => ({ params: mockRouteParams }),
  };
});

const OPEN_SHOP: Shop = {
  id: 'shop-open',
  name: 'ส้มตำป้าทองดี',
  description: null,
  cuisine: 'อาหารอีสาน',
  imageUrl: null,
  phone: null,
  addressLine: 'ใกล้ตลาดสด',
  lat: null,
  lng: null,
  minOrderSatang: null,
  avgPrepMinutes: null,
  ratingAvg: 4.8,
  ratingCount: 326,
  temporarilyClosedUntil: null,
  hours: [{ dayOfWeek: 0, opensAt: '09:00:00', closesAt: '20:00:00' }],
  isOpen: true,
  todayHours: '09:00 - 20:00',
};

const CLOSED_SHOP: Shop = {
  ...OPEN_SHOP,
  id: 'shop-closed',
  name: 'ร้านปิดวันนี้',
  hours: [{ dayOfWeek: 1, opensAt: '08:00:00', closesAt: '20:00:00' }],
  isOpen: false,
  todayHours: null,
};

const ITEM: MenuItem = {
  id: 'item-1',
  shopId: 'shop-closed',
  categoryId: 'cat-1',
  categoryName: 'แนะนำ',
  name: 'ส้มตำไทย',
  description: null,
  priceSatang: 6000,
  imageUrl: null,
  isAvailable: true,
  sortOrder: 0,
};

const CATEGORIES: Category[] = [{ id: 'c1', icon: '🍜', name: 'ตามสั่ง' }];

function catalogStub(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    listCategories: jest.fn().mockResolvedValue(CATEGORIES),
    listShops: jest.fn().mockResolvedValue([]),
    getShop: jest.fn().mockResolvedValue(null),
    listMenu: jest.fn().mockResolvedValue([]),
    getMenuItem: jest.fn().mockResolvedValue(null),
    search: jest.fn().mockResolvedValue({ shops: [], items: [] }),
    ...overrides,
  };
}

function useCatalog(stub: ReturnType<typeof catalogStub>) {
  (repositories as unknown as { catalog: typeof stub }).catalog = stub;
}

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
  for (const key of Object.keys(mockRouteParams)) delete mockRouteParams[key];
});

describe('HomeScreen — C-9 states', () => {
  it('shows the true "no restaurants" empty state, distinct from a category filter', async () => {
    useCatalog(catalogStub({ listShops: jest.fn().mockResolvedValue([]) }));
    renderScreen(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('state-home-empty')).toBeTruthy());
    // UX-SPEC § 13 copy, verbatim.
    expect(screen.getByText('ยังไม่มีร้านในพื้นที่นี้')).toBeTruthy();
    expect(screen.getByText('เปลี่ยนพื้นที่จัดส่ง')).toBeTruthy();
  });

  it('shows the offline copy when the load fails with a network error', async () => {
    useCatalog(
      catalogStub({
        listShops: jest.fn().mockRejectedValue(new Error('Network request failed')),
      }),
    );
    renderScreen(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('screen-home-error')).toBeTruthy());
    expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy();
    expect(screen.getByText('ลองอีกครั้ง')).toBeTruthy();
  });

  it('shows the server-error copy for a non-network failure, not the offline copy', async () => {
    useCatalog(
      catalogStub({
        listShops: jest.fn().mockRejectedValue(new Error('Catalog restaurant list failed: boom')),
      }),
    );
    renderScreen(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('screen-home-error')).toBeTruthy());
    expect(screen.getByText('ระบบมีปัญหาชั่วคราว')).toBeTruthy();
    expect(screen.queryByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeNull();
  });

  it('renders a closed shop dimmed but still tappable, distinct from an open one', async () => {
    useCatalog(catalogStub({ listShops: jest.fn().mockResolvedValue([OPEN_SHOP, CLOSED_SHOP]) }));
    renderScreen(<HomeScreen />);

    await waitFor(() => expect(screen.getByTestId('screen-home')).toBeTruthy());
    // Still present and still a real Pressable — UX-SPEC § 5.3: dimmed, not
    // hidden, not disabled.
    const closedCard = screen.getByTestId('shop-card-shop-closed');
    expect(closedCard).toBeTruthy();
    expect(closedCard.props.accessibilityRole).toBe('button');
    expect(screen.getByText('ปิดอยู่')).toBeTruthy();
    expect(screen.getByText('เปิดอยู่')).toBeTruthy();
  });
});

describe('SearchScreen — C-9 states', () => {
  it('shows the UX-SPEC empty-result copy with a "ดูร้านทั้งหมด" action', async () => {
    useCatalog(catalogStub());
    renderScreen(<SearchScreen />);

    const input = screen.getByTestId('input-search');
    fireEvent.changeText(input, 'ไม่มีจริง');

    await waitFor(() => expect(screen.getByTestId('state-search-empty')).toBeTruthy());
    expect(screen.getByText('ไม่พบร้านหรืออาหารที่ค้นหา')).toBeTruthy();
    expect(screen.getByText('ดูร้านทั้งหมด')).toBeTruthy();
  });

  it('shows the offline copy for a network failure during search', async () => {
    useCatalog(catalogStub({ search: jest.fn().mockRejectedValue(new Error('Failed to fetch')) }));
    renderScreen(<SearchScreen />);

    const input = screen.getByTestId('input-search');
    fireEvent.changeText(input, 'ส้มตำ');

    await waitFor(() => expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy());
  });
});

describe('ShopScreen — C-9 closed-restaurant banner', () => {
  it('keeps the menu visible AND shows the persistent closed banner', async () => {
    useCatalog(
      catalogStub({
        getShop: jest.fn().mockResolvedValue(CLOSED_SHOP),
        listMenu: jest.fn().mockResolvedValue([ITEM]),
      }),
    );
    mockRouteParams.shopId = 'shop-closed';
    renderScreen(<ShopScreen />);

    // The screen itself — not a replacement state — still renders.
    await waitFor(() => expect(screen.getByTestId('screen-shop')).toBeTruthy());
    expect(screen.getByTestId('banner-shop-closed')).toBeTruthy();
    // The menu underneath is still browsable.
    expect(screen.getByTestId('menu-row-item-1')).toBeTruthy();
  });

  it('does not show a closed banner for an open restaurant', async () => {
    useCatalog(
      catalogStub({
        getShop: jest.fn().mockResolvedValue(OPEN_SHOP),
        listMenu: jest.fn().mockResolvedValue([]),
      }),
    );
    mockRouteParams.shopId = 'shop-open';
    renderScreen(<ShopScreen />);

    await waitFor(() => expect(screen.getByTestId('screen-shop')).toBeTruthy());
    expect(screen.queryByTestId('banner-shop-closed')).toBeNull();
  });

  it('reveals the full week of hours only after "ดูเวลาเปิดร้าน" is pressed', async () => {
    useCatalog(
      catalogStub({
        getShop: jest.fn().mockResolvedValue(CLOSED_SHOP),
        listMenu: jest.fn().mockResolvedValue([]),
      }),
    );
    mockRouteParams.shopId = 'shop-closed';
    renderScreen(<ShopScreen />);

    await waitFor(() => expect(screen.getByTestId('banner-shop-closed')).toBeTruthy());
    expect(screen.queryByTestId('shop-all-hours')).toBeNull();

    fireEvent.press(screen.getByTestId('button-view-hours'));

    await waitFor(() => expect(screen.getByTestId('shop-all-hours')).toBeTruthy());
  });

  it('shows the offline copy for a network failure loading the shop', async () => {
    useCatalog(
      catalogStub({
        getShop: jest.fn().mockRejectedValue(new Error('Network request failed')),
      }),
    );
    mockRouteParams.shopId = 'shop-open';
    renderScreen(<ShopScreen />);

    await waitFor(() => expect(screen.getByText('ไม่มีการเชื่อมต่ออินเทอร์เน็ต')).toBeTruthy());
  });
});
