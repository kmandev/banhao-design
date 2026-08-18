/**
 * Supabase-backed `CatalogRepository` (Phase C / C-5, C-6).
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008). The screens are
 * unchanged in shape: they still depend on the repository interface, and this
 * implementation slots in behind the same seam the mock used.
 *
 * Composition happens here rather than in the queries so each query stays a
 * single, testable statement, and so the N+1-avoiding batch fetches
 * (`fetchHoursForRestaurants`, `fetchOptionsForGroups`) have somewhere to be
 * stitched back together.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultClient } from '../lib/supabase';
import { deriveAvailability } from '../lib/openingHours';
import { CATEGORY_TAXONOMY, type Category } from '../domain/categoryTaxonomy';
import type { MenuItem, MenuOptionGroup, Shop } from '../domain/catalog';
import {
  fetchHoursForRestaurants,
  fetchMenuCategories,
  fetchMenuItem,
  fetchMenuItems,
  fetchOptionGroups,
  fetchOptionsForGroups,
  fetchRestaurant,
  fetchRestaurants,
  searchMenuItems,
  searchRestaurants,
} from '../data/catalogQueries';
import {
  toMenuItem,
  toMenuOption,
  toMenuOptionGroup,
  toOpeningWindow,
  toShop,
  type MenuItemRow,
  type RestaurantHoursRow,
  type RestaurantRow,
} from '../data/catalogMappers';
import type { CatalogRepository } from './types';

/** Groups hours rows by restaurant so each shop is assembled in one pass. */
function groupHours(rows: RestaurantHoursRow[]): Map<string, RestaurantHoursRow[]> {
  const byRestaurant = new Map<string, RestaurantHoursRow[]>();

  for (const row of rows) {
    const existing = byRestaurant.get(row.restaurant_id);
    if (existing) existing.push(row);
    else byRestaurant.set(row.restaurant_id, [row]);
  }

  return byRestaurant;
}

function buildShop(row: RestaurantRow, hoursRows: RestaurantHoursRow[], now: Date): Shop {
  const hours = hoursRows.map(toOpeningWindow);
  return toShop(row, hours, deriveAvailability(hours, row.temporarily_closed_until, now));
}

/**
 * Attaches shops' hours in one batch.
 *
 * `now` is captured once for the whole list so every card on the home screen is
 * judged against the same instant — otherwise a slow render could show two
 * shops as open and closed by the same rule.
 */
async function withHours(
  client: SupabaseClient,
  rows: RestaurantRow[],
  now: Date,
): Promise<Shop[]> {
  if (rows.length === 0) return [];

  const hours = await fetchHoursForRestaurants(
    client,
    rows.map((row) => row.id),
  );
  const byRestaurant = groupHours(hours);

  return rows.map((row) => buildShop(row, byRestaurant.get(row.id) ?? [], now));
}

/**
 * Resolves each item's section name from the restaurant's categories.
 *
 * One categories query per menu, not one per item.
 */
async function withCategoryNames(
  client: SupabaseClient,
  restaurantId: string,
  rows: MenuItemRow[],
): Promise<MenuItem[]> {
  if (rows.length === 0) return [];

  const categories = await fetchMenuCategories(client, restaurantId);
  const nameById = new Map(categories.map((category) => [category.id, category.name]));

  return rows.map((row) => toMenuItem(row, nameById.get(row.category_id) ?? ''));
}

/** Option groups with their options, batched into two queries total. */
async function loadOptionGroups(
  client: SupabaseClient,
  menuItemId: string,
): Promise<MenuOptionGroup[]> {
  const groups = await fetchOptionGroups(client, menuItemId);
  if (groups.length === 0) return [];

  const options = await fetchOptionsForGroups(
    client,
    groups.map((group) => group.id),
  );

  const byGroup = new Map<string, ReturnType<typeof toMenuOption>[]>();
  for (const option of options) {
    const mapped = toMenuOption(option);
    const existing = byGroup.get(option.group_id);
    if (existing) existing.push(mapped);
    else byGroup.set(option.group_id, [mapped]);
  }

  return groups.map((group) => toMenuOptionGroup(group, byGroup.get(group.id) ?? []));
}

export function createSupabaseCatalogRepository(
  client: SupabaseClient = defaultClient,
  clock: () => Date = () => new Date(),
): CatalogRepository {
  return {
    /**
     * PC-Q-003 — served from the static presentation taxonomy, not Supabase.
     *
     * There is no global category table; `menu_categories` is per-restaurant and
     * means something different. Returning it from here would be a fabrication,
     * so the limitation stays visible in `src/domain/categoryTaxonomy.ts`.
     */
    listCategories: async (): Promise<Category[]> => [...CATEGORY_TAXONOMY],

    listShops: async () => {
      const rows = await fetchRestaurants(client);
      return withHours(client, rows, clock());
    },

    getShop: async (shopId) => {
      const row = await fetchRestaurant(client, shopId);
      if (!row) return null;

      const hours = await fetchHoursForRestaurants(client, [row.id]);
      return buildShop(row, hours, clock());
    },

    listMenu: async (shopId) => {
      const rows = await fetchMenuItems(client, shopId);
      return withCategoryNames(client, shopId, rows);
    },

    getMenuItem: async (shopId, itemId) => {
      const row = await fetchMenuItem(client, shopId, itemId);
      if (!row) return null;

      const [categories, optionGroups] = await Promise.all([
        fetchMenuCategories(client, shopId),
        loadOptionGroups(client, row.id),
      ]);

      const categoryName =
        categories.find((category) => category.id === row.category_id)?.name ?? '';

      return toMenuItem(row, categoryName, optionGroups);
    },

    /**
     * Shops first, then items — the order the design specifies. Ranking within
     * each list is undefined by the design (DQ-05), so neither is re-sorted
     * beyond the alphabetical order the queries request.
     */
    search: async (query) => {
      const trimmed = query.trim();
      if (!trimmed) return { shops: [], items: [] };

      const [restaurantRows, itemRows] = await Promise.all([
        searchRestaurants(client, trimmed),
        searchMenuItems(client, trimmed),
      ]);

      const shops = await withHours(client, restaurantRows, clock());

      // Section names are NOT resolved here. Matching items span restaurants, so
      // doing it meant one categories query per restaurant — an N+1 whose only
      // product was a `categoryName` the search results never render. Items keep
      // their `categoryId`, so a future screen that does need the name can
      // resolve it with one batched query rather than N.
      return {
        shops,
        items: itemRows.map((row) => toMenuItem(row, '')),
      };
    },
  };
}

export const supabaseCatalogRepository = createSupabaseCatalogRepository();
