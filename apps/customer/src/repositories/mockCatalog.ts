/**
 * Mock catalog repository — retained as a **test/UI fixture**, not production.
 *
 * Production reads come from `supabaseCatalogRepository` after the Phase C / C-7
 * binding swap. This implementation stays because screen tests and offline UI
 * work still need deterministic data.
 *
 * The fixtures in `src/mocks/data.ts` are written in the pre-Phase-C shape, so
 * this module adapts them to the production domain rather than the fixtures
 * being rewritten. That keeps a large hand-authored dataset untouched — and
 * therefore un-broken — while the contract the screens see is the real one.
 *
 * Adaptation is lossy in the honest direction: fields with no database source
 * (`distanceKm`, `etaMinutes`, `deliveryFeeSatang`, `badge`, `glyph`) are
 * **dropped**, not carried over, so a fixture cannot make a screen look like it
 * has data that production will never supply (PC-Q-002).
 */

import type { MenuItem, MenuOptionGroup, Shop } from '../domain/catalog';
import { CATEGORY_TAXONOMY, type Category } from '../domain/categoryTaxonomy';
import type {
  MenuItem as MockMenuItem,
  MenuOptionGroup as MockMenuOptionGroup,
  Shop as MockShop,
} from '../mocks/types';
import { shops as mockShops, menuByShop } from '../mocks/data';
import type { CatalogRepository } from './types';

/**
 * Simulated latency, so loading states are actually exercised in development
 * rather than only existing in code.
 */
const LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function adaptShop(shop: MockShop): Shop {
  const rating = Number.parseFloat(shop.rating);

  return {
    id: shop.id,
    name: shop.name,
    description: null,
    cuisine: shop.cuisine,
    imageUrl: null,
    phone: null,
    addressLine: shop.addressLine,
    lat: null,
    lng: null,
    minOrderSatang: null,
    avgPrepMinutes: null,
    ratingAvg: Number.isNaN(rating) ? null : rating,
    ratingCount: shop.reviewCount,
    temporarilyClosedUntil: null,
    hours: [],
    isOpen: shop.isOpen,
    todayHours: shop.openingHours,
  };
}

function adaptOptionGroup(group: MockMenuOptionGroup, menuItemId: string): MenuOptionGroup {
  return {
    id: group.id,
    menuItemId,
    title: group.title,
    // The fixture only knows "required", so it maps onto the narrowest
    // constraint that means the same thing: pick exactly one when required,
    // at most one when not.
    minSelect: group.required ? 1 : 0,
    maxSelect: 1,
    sortOrder: 0,
    options: group.options.map((option, index) => ({
      id: option.id,
      label: option.label,
      priceDeltaSatang: option.priceDeltaSatang,
      isAvailable: true,
      sortOrder: index,
    })),
  };
}

function adaptMenuItem(item: MockMenuItem, index: number): MenuItem {
  return {
    id: item.id,
    shopId: item.shopId,
    // The fixture has no category ids — the section name stands in for both, so
    // grouping by `categoryName` behaves exactly as it does against real data.
    categoryId: item.section,
    categoryName: item.section,
    name: item.name,
    description: item.description ?? null,
    priceSatang: item.priceSatang,
    imageUrl: null,
    isAvailable: true,
    sortOrder: index,
    ...(item.optionGroups
      ? { optionGroups: item.optionGroups.map((group) => adaptOptionGroup(group, item.id)) }
      : {}),
  };
}

const adaptedShops: Shop[] = mockShops.map(adaptShop);

const adaptedMenus: Record<string, MenuItem[]> = Object.fromEntries(
  Object.entries(menuByShop).map(([shopId, items]) => [shopId, items.map(adaptMenuItem)]),
);

const allMenuItems = Object.values(adaptedMenus).flat();

export const mockCatalogRepository: CatalogRepository = {
  listCategories: (): Promise<Category[]> => delay([...CATEGORY_TAXONOMY]),
  listShops: () => delay(adaptedShops),
  getShop: (shopId) => delay(adaptedShops.find((shop) => shop.id === shopId) ?? null),
  listMenu: (shopId) => delay(adaptedMenus[shopId] ?? []),
  getMenuItem: (shopId, itemId) =>
    delay((adaptedMenus[shopId] ?? []).find((item) => item.id === itemId) ?? null),
  search: (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return delay({ shops: [], items: [] });

    // Shops first, then menu items — see DQ-05 in the implementation map; the
    // design does not specify ranking.
    return delay({
      shops: adaptedShops.filter((shop) => shop.name.toLowerCase().includes(q)),
      items: allMenuItems.filter((item) => item.name.toLowerCase().includes(q)),
    });
  },
};
