import {
  toMenuCategory,
  toMenuItem,
  toMenuOption,
  toMenuOptionGroup,
  toOpeningWindow,
  toShop,
  type MenuItemRow,
  type MenuOptionGroupRow,
  type MenuOptionRow,
  type RestaurantRow,
} from './catalogMappers';
import { isMultiSelectGroup, isRequiredGroup } from '../domain/catalog';

const RESTAURANT: RestaurantRow = {
  id: 'r1',
  name: 'ส้มตำป้าทองดี',
  description: 'ร้านอีสานแท้',
  cuisine: 'อาหารอีสาน',
  image_url: 'https://example.test/shop.jpg',
  phone: '+66812345678',
  address_line: 'ใกล้ตลาดสดบุณฑริก',
  lat: 14.78,
  lng: 105.42,
  status: 'ACTIVE',
  temporarily_closed_until: null,
  min_order_satang: 5000,
  avg_prep_minutes: 20,
  rating_avg: 4.8,
  rating_count: 326,
};

const ITEM: MenuItemRow = {
  id: 'm1',
  restaurant_id: 'r1',
  category_id: 'c1',
  name: 'ส้มตำไทย',
  description: 'ตำไทยรสกลมกล่อม',
  base_price_satang: 6000,
  image_url: null,
  is_available: true,
  sort_order: 2,
};

const DERIVED = { isOpen: true, todayHours: '09:00 - 20:00' };

describe('toShop', () => {
  it('maps every column to its domain field', () => {
    const shop = toShop(RESTAURANT, [], DERIVED);

    expect(shop).toEqual({
      id: 'r1',
      name: 'ส้มตำป้าทองดี',
      description: 'ร้านอีสานแท้',
      cuisine: 'อาหารอีสาน',
      imageUrl: 'https://example.test/shop.jpg',
      phone: '+66812345678',
      addressLine: 'ใกล้ตลาดสดบุณฑริก',
      lat: 14.78,
      lng: 105.42,
      minOrderSatang: 5000,
      avgPrepMinutes: 20,
      ratingAvg: 4.8,
      ratingCount: 326,
      temporarilyClosedUntil: null,
      hours: [],
      isOpen: true,
      todayHours: '09:00 - 20:00',
    });
  });

  it('preserves nulls rather than substituting defaults', () => {
    const sparse: RestaurantRow = {
      ...RESTAURANT,
      description: null,
      cuisine: null,
      image_url: null,
      phone: null,
      address_line: null,
      lat: null,
      lng: null,
      min_order_satang: null,
      avg_prep_minutes: null,
      rating_avg: null,
    };

    const shop = toShop(sparse, [], DERIVED);

    expect(shop.cuisine).toBeNull();
    expect(shop.ratingAvg).toBeNull();
    expect(shop.minOrderSatang).toBeNull();
    // An unrated shop is not a zero-rated shop.
    expect(shop.ratingAvg).not.toBe(0);
  });

  it('does NOT carry the PC-Q-002 fields, which have no source', () => {
    const shop = toShop(RESTAURANT, [], DERIVED) as unknown as Record<string, unknown>;

    // Guards the decision itself: if any of these reappears, it was invented.
    expect(shop).not.toHaveProperty('distanceKm');
    expect(shop).not.toHaveProperty('deliveryFeeSatang');
    expect(shop).not.toHaveProperty('etaMinutes');
    expect(shop).not.toHaveProperty('badge');
  });

  it('never derives an ETA from avg_prep_minutes', () => {
    const shop = toShop(RESTAURANT, [], DERIVED);
    // Prep time is preserved as itself and nothing more.
    expect(shop.avgPrepMinutes).toBe(20);
  });

  it('carries the derived availability through untouched', () => {
    const shop = toShop(RESTAURANT, [], { isOpen: false, todayHours: null });
    expect(shop.isOpen).toBe(false);
    expect(shop.todayHours).toBeNull();
  });
});

describe('toOpeningWindow', () => {
  it('maps an hours row', () => {
    expect(
      toOpeningWindow({
        restaurant_id: 'r1',
        day_of_week: 3,
        opens_at: '09:00:00',
        closes_at: '20:00:00',
      }),
    ).toEqual({ dayOfWeek: 3, opensAt: '09:00:00', closesAt: '20:00:00' });
  });
});

describe('toMenuCategory', () => {
  it('maps a category row and keeps sort order', () => {
    expect(
      toMenuCategory({ id: 'c1', restaurant_id: 'r1', name: 'แนะนำ', sort_order: 1 }),
    ).toEqual({ id: 'c1', shopId: 'r1', name: 'แนะนำ', sortOrder: 1 });
  });
});

describe('toMenuItem', () => {
  it('maps an item and denormalises its category name', () => {
    expect(toMenuItem(ITEM, 'แนะนำ')).toEqual({
      id: 'm1',
      shopId: 'r1',
      categoryId: 'c1',
      categoryName: 'แนะนำ',
      name: 'ส้มตำไทย',
      description: 'ตำไทยรสกลมกล่อม',
      priceSatang: 6000,
      imageUrl: null,
      isAvailable: true,
      sortOrder: 2,
    });
  });

  it('keeps satang as an integer — never Baht, never a float', () => {
    const item = toMenuItem({ ...ITEM, base_price_satang: 12345 }, 'แนะนำ');
    expect(item.priceSatang).toBe(12345);
    expect(Number.isInteger(item.priceSatang)).toBe(true);
  });

  it('preserves is_available even though rendering it is deferred (PC-Q-001)', () => {
    expect(toMenuItem({ ...ITEM, is_available: false }, 'แนะนำ').isAvailable).toBe(false);
  });

  it('maps a missing category to an empty section rather than dropping the item', () => {
    expect(toMenuItem(ITEM, '').categoryName).toBe('');
  });

  it('omits optionGroups entirely when none were fetched', () => {
    expect(toMenuItem(ITEM, 'แนะนำ')).not.toHaveProperty('optionGroups');
  });

  it('attaches optionGroups when supplied', () => {
    const item = toMenuItem(ITEM, 'แนะนำ', []);
    expect(item.optionGroups).toEqual([]);
  });

  it('preserves a null description', () => {
    expect(toMenuItem({ ...ITEM, description: null }, 'แนะนำ').description).toBeNull();
  });
});

describe('toMenuOption', () => {
  const OPTION: MenuOptionRow = {
    id: 'o1',
    group_id: 'g1',
    label: 'ไข่ดาว',
    price_delta_satang: 1000,
    is_available: true,
    sort_order: 0,
  };

  it('maps an option row', () => {
    expect(toMenuOption(OPTION)).toEqual({
      id: 'o1',
      label: 'ไข่ดาว',
      priceDeltaSatang: 1000,
      isAvailable: true,
      sortOrder: 0,
    });
  });

  it('preserves a negative price delta', () => {
    // No CHECK forbids one, so the mapper must not clamp it.
    expect(toMenuOption({ ...OPTION, price_delta_satang: -500 }).priceDeltaSatang).toBe(-500);
  });

  it('preserves availability', () => {
    expect(toMenuOption({ ...OPTION, is_available: false }).isAvailable).toBe(false);
  });
});

describe('toMenuOptionGroup', () => {
  const GROUP: MenuOptionGroupRow = {
    id: 'g1',
    menu_item_id: 'm1',
    title: 'เลือกเนื้อสัตว์',
    min_select: 1,
    max_select: 1,
    sort_order: 0,
  };

  it('preserves min_select and max_select instead of collapsing to a boolean', () => {
    const group = toMenuOptionGroup({ ...GROUP, min_select: 0, max_select: 3 }, []);
    expect(group.minSelect).toBe(0);
    expect(group.maxSelect).toBe(3);
  });

  it('supports the four selection shapes BQ-009 encodes as data', () => {
    const single_required = toMenuOptionGroup({ ...GROUP, min_select: 1, max_select: 1 }, []);
    const single_optional = toMenuOptionGroup({ ...GROUP, min_select: 0, max_select: 1 }, []);
    const multi_optional = toMenuOptionGroup({ ...GROUP, min_select: 0, max_select: 3 }, []);
    const multi_required = toMenuOptionGroup({ ...GROUP, min_select: 2, max_select: 4 }, []);

    expect([isRequiredGroup(single_required), isMultiSelectGroup(single_required)]).toEqual([
      true,
      false,
    ]);
    expect([isRequiredGroup(single_optional), isMultiSelectGroup(single_optional)]).toEqual([
      false,
      false,
    ]);
    expect([isRequiredGroup(multi_optional), isMultiSelectGroup(multi_optional)]).toEqual([
      false,
      true,
    ]);
    expect([isRequiredGroup(multi_required), isMultiSelectGroup(multi_required)]).toEqual([
      true,
      true,
    ]);
  });

  it('attaches its options', () => {
    const group = toMenuOptionGroup(GROUP, [
      { id: 'o1', label: 'หมู', priceDeltaSatang: 0, isAvailable: true, sortOrder: 0 },
    ]);
    expect(group.options).toHaveLength(1);
    expect(group.menuItemId).toBe('m1');
  });
});
