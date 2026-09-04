/**
 * Database row → domain mappers.
 *
 * Every snake_case-to-camelCase transformation lives here, so no screen or
 * repository has to know column names, and a schema change has exactly one
 * place to land (Phase C / C-3).
 *
 * Two rules these mappers hold to:
 *
 * 1. **Satang stays an integer.** `base_price_satang` and `price_delta_satang`
 *    are Postgres `bigint`; they arrive as JS numbers and are passed through
 *    untouched. No division, no `toFixed`, no Baht — CON-003. Conversion to
 *    Baht happens only in `formatBaht`, at render time.
 * 2. **Nothing is invented.** A nullable column maps to a nullable field. Where
 *    the mock types demanded a value the schema cannot supply, the field is
 *    absent from the domain rather than filled in — see the PC-Q-002 note in
 *    `src/domain/catalog.ts`.
 */

import type {
  MenuCategory,
  MenuItem,
  MenuOption,
  MenuOptionGroup,
  OpeningWindow,
  RestaurantAvailabilityMode,
  Shop,
} from '../domain/catalog';

// --- row shapes, exactly as selected by catalogQueries ----------------------

export interface RestaurantRow {
  id: string;
  name: string;
  description: string | null;
  cuisine: string | null;
  image_url: string | null;
  phone: string | null;
  address_line: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  temporarily_closed_until: string | null;
  availability_mode: RestaurantAvailabilityMode;
  busy_prep_minutes: number | null;
  min_order_satang: number | null;
  avg_prep_minutes: number | null;
  rating_avg: number | null;
  rating_count: number;
}

export interface RestaurantHoursRow {
  restaurant_id: string;
  day_of_week: number;
  opens_at: string;
  closes_at: string;
}

export interface MenuCategoryRow {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
}

export interface MenuItemRow {
  id: string;
  restaurant_id: string;
  category_id: string;
  name: string;
  description: string | null;
  base_price_satang: number;
  image_url: string | null;
  is_available: boolean;
  sort_order: number;
}

export interface MenuOptionGroupRow {
  id: string;
  menu_item_id: string;
  title: string;
  min_select: number;
  max_select: number;
  sort_order: number;
}

export interface MenuOptionRow {
  id: string;
  group_id: string;
  label: string;
  price_delta_satang: number;
  is_available: boolean;
  sort_order: number;
}

// --- mappers ---------------------------------------------------------------

export function toOpeningWindow(row: RestaurantHoursRow): OpeningWindow {
  return {
    dayOfWeek: row.day_of_week,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  };
}

/**
 * `isOpen` and `todayHours` are not columns — the caller derives them from the
 * hours and `temporarily_closed_until` and passes them in, so this mapper stays
 * a pure column translation with no clock dependency of its own.
 */
export function toShop(
  row: RestaurantRow,
  hours: OpeningWindow[],
  derived: { isOpen: boolean; todayHours: string | null; isOrderable: boolean },
): Shop {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cuisine: row.cuisine,
    imageUrl: row.image_url,
    phone: row.phone,
    addressLine: row.address_line,
    lat: row.lat,
    lng: row.lng,
    minOrderSatang: row.min_order_satang,
    avgPrepMinutes: row.avg_prep_minutes,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    temporarilyClosedUntil: row.temporarily_closed_until,
    availabilityMode: row.availability_mode,
    busyPrepMinutes: row.busy_prep_minutes,
    hours,
    isOpen: derived.isOpen,
    todayHours: derived.todayHours,
    isOrderable: derived.isOrderable,
  };
}

export function toMenuCategory(row: MenuCategoryRow): MenuCategory {
  return {
    id: row.id,
    shopId: row.restaurant_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

/**
 * `categoryName` is denormalised from the joined category so the UI can group
 * by section without a second lookup. An item whose category did not come back
 * — archived, or filtered by RLS — maps to an empty section name rather than
 * being dropped, so a menu never silently loses rows.
 */
export function toMenuItem(
  row: MenuItemRow,
  categoryName: string,
  optionGroups?: MenuOptionGroup[],
): MenuItem {
  return {
    id: row.id,
    shopId: row.restaurant_id,
    categoryId: row.category_id,
    categoryName,
    name: row.name,
    description: row.description,
    priceSatang: row.base_price_satang,
    imageUrl: row.image_url,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
    ...(optionGroups ? { optionGroups } : {}),
  };
}

export function toMenuOption(row: MenuOptionRow): MenuOption {
  return {
    id: row.id,
    label: row.label,
    priceDeltaSatang: row.price_delta_satang,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
  };
}

/**
 * `min_select` / `max_select` are carried through unchanged. Collapsing them to
 * a `required` boolean here would destroy the multi-select information BQ-009
 * deliberately stores as data; `isRequiredGroup()` derives the boolean at the
 * point of use instead.
 */
export function toMenuOptionGroup(
  row: MenuOptionGroupRow,
  options: MenuOption[],
): MenuOptionGroup {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    title: row.title,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
    options,
  };
}
