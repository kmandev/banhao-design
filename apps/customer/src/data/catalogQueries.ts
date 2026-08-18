/**
 * Supabase catalog queries (Phase C / C-3).
 *
 * **Direct client → Supabase reads, under RLS** (DEC-APP-008). The anon key is
 * the only credential involved; no service role, no NestJS API, no proxy. The
 * deployed `*_select_active` policies already scope every table below to active
 * restaurants and non-archived rows, which is why none of these queries
 * re-filters `status` or `archived_at` defensively — doing so would duplicate
 * the security boundary in a place that cannot enforce it, and would drift.
 *
 * Ordering is requested explicitly because `sort_order` is the merchant's own
 * menu arrangement and PostgREST gives no ordering guarantee otherwise.
 *
 * Errors always throw. A failed read must never be returned as an empty
 * result: "this restaurant has no menu" and "the menu could not be loaded" are
 * different facts, and the screens render them differently.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MenuCategoryRow,
  MenuItemRow,
  MenuOptionGroupRow,
  MenuOptionRow,
  RestaurantHoursRow,
  RestaurantRow,
} from './catalogMappers';

const RESTAURANT_COLUMNS =
  'id, name, description, cuisine, image_url, phone, address_line, lat, lng, status, temporarily_closed_until, min_order_satang, avg_prep_minutes, rating_avg, rating_count';

const HOURS_COLUMNS = 'restaurant_id, day_of_week, opens_at, closes_at';
const CATEGORY_COLUMNS = 'id, restaurant_id, name, sort_order';
const ITEM_COLUMNS =
  'id, restaurant_id, category_id, name, description, base_price_satang, image_url, is_available, sort_order';
const OPTION_GROUP_COLUMNS = 'id, menu_item_id, title, min_select, max_select, sort_order';
const OPTION_COLUMNS = 'id, group_id, label, price_delta_satang, is_available, sort_order';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Catalog ${operation} failed: ${message}`);
}

/**
 * Active restaurants.
 *
 * RLS (`restaurants_select_active`) restricts this to `status = 'ACTIVE'`, so
 * DRAFT, SUSPENDED and CLOSED storefronts are invisible without a client-side
 * filter. Ordered by name for a stable list — the schema defines no ranking,
 * and CON-004 rules out inventing one.
 */
export async function fetchRestaurants(client: SupabaseClient): Promise<RestaurantRow[]> {
  const { data, error } = await client
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .order('name', { ascending: true })
    .returns<RestaurantRow[]>();

  if (error) raise('restaurant list', error.message);
  return data ?? [];
}

export async function fetchRestaurant(
  client: SupabaseClient,
  restaurantId: string,
): Promise<RestaurantRow | null> {
  const { data, error } = await client
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .eq('id', restaurantId)
    .maybeSingle<RestaurantRow>();

  if (error) raise('restaurant fetch', error.message);
  return data ?? null;
}

/**
 * Opening hours for several restaurants in ONE query.
 *
 * Deliberately batched by `in (...)`: fetching hours per card would be an N+1
 * across the whole home screen, and `isOpen` is needed for every card.
 */
export async function fetchHoursForRestaurants(
  client: SupabaseClient,
  restaurantIds: string[],
): Promise<RestaurantHoursRow[]> {
  if (restaurantIds.length === 0) return [];

  const { data, error } = await client
    .from('restaurant_hours')
    .select(HOURS_COLUMNS)
    .in('restaurant_id', restaurantIds)
    .returns<RestaurantHoursRow[]>();

  if (error) raise('hours fetch', error.message);
  return data ?? [];
}

/** Menu sections for one restaurant, in the merchant's chosen order. */
export async function fetchMenuCategories(
  client: SupabaseClient,
  restaurantId: string,
): Promise<MenuCategoryRow[]> {
  const { data, error } = await client
    .from('menu_categories')
    .select(CATEGORY_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .returns<MenuCategoryRow[]>();

  if (error) raise('menu category fetch', error.message);
  return data ?? [];
}

/**
 * Menu items for one restaurant.
 *
 * PC-Q-001 (resolved, Option A): `menu_items_select_active` no longer filters on
 * `is_available`, so sold-out items DO come back here. That is deliberate — the
 * app renders them as `วันนี้หมด` rather than hiding them (UX-SPEC § 5.3). The
 * archived and restaurant-ACTIVE predicates still apply, in RLS.
 */
export async function fetchMenuItems(
  client: SupabaseClient,
  restaurantId: string,
): Promise<MenuItemRow[]> {
  const { data, error } = await client
    .from('menu_items')
    .select(ITEM_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .returns<MenuItemRow[]>();

  if (error) raise('menu item fetch', error.message);
  return data ?? [];
}

export async function fetchMenuItem(
  client: SupabaseClient,
  restaurantId: string,
  itemId: string,
): Promise<MenuItemRow | null> {
  const { data, error } = await client
    .from('menu_items')
    .select(ITEM_COLUMNS)
    // Both filters: the composite (id, restaurant_id) is what guarantees an
    // item cannot be read as belonging to a restaurant it does not belong to.
    .eq('id', itemId)
    .eq('restaurant_id', restaurantId)
    .maybeSingle<MenuItemRow>();

  if (error) raise('menu item fetch', error.message);
  return data ?? null;
}

/** Option groups for one item, in display order. */
export async function fetchOptionGroups(
  client: SupabaseClient,
  menuItemId: string,
): Promise<MenuOptionGroupRow[]> {
  const { data, error } = await client
    .from('menu_option_groups')
    .select(OPTION_GROUP_COLUMNS)
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true })
    .returns<MenuOptionGroupRow[]>();

  if (error) raise('option group fetch', error.message);
  return data ?? [];
}

/**
 * Options for several groups in ONE query — the second half of avoiding an N+1
 * on the item screen, where a dish routinely has three or four groups.
 */
export async function fetchOptionsForGroups(
  client: SupabaseClient,
  groupIds: string[],
): Promise<MenuOptionRow[]> {
  if (groupIds.length === 0) return [];

  const { data, error } = await client
    .from('menu_options')
    .select(OPTION_COLUMNS)
    .in('group_id', groupIds)
    .order('sort_order', { ascending: true })
    .returns<MenuOptionRow[]>();

  if (error) raise('option fetch', error.message);
  return data ?? [];
}

/**
 * Escapes a user string for use inside a Postgres LIKE/ILIKE pattern.
 *
 * Backslash is escaped **first** and deliberately: it is Postgres' default LIKE
 * escape character, so a search for `a\\b` would otherwise be read as an escaped
 * `b` and match `ab`. Escaping `%` and `_` afterwards is safe because the
 * backslashes this step introduces are already-escaped output, not input.
 *
 * This is pattern correctness, not injection defence — supabase-js parameterises
 * the value, and no SQL is built by string concatenation anywhere here.
 */
function escapeLike(query: string): string {
  return query
    .replace(/\\/g, '\\\\')
    .replace(/[%_]/g, (char) => `\\${char}`);
}

export async function searchRestaurants(
  client: SupabaseClient,
  query: string,
): Promise<RestaurantRow[]> {
  const { data, error } = await client
    .from('restaurants')
    .select(RESTAURANT_COLUMNS)
    .ilike('name', `%${escapeLike(query)}%`)
    .order('name', { ascending: true })
    .returns<RestaurantRow[]>();

  if (error) raise('restaurant search', error.message);
  return data ?? [];
}

export async function searchMenuItems(
  client: SupabaseClient,
  query: string,
): Promise<MenuItemRow[]> {
  const { data, error } = await client
    .from('menu_items')
    .select(ITEM_COLUMNS)
    .ilike('name', `%${escapeLike(query)}%`)
    .order('name', { ascending: true })
    .returns<MenuItemRow[]>();

  if (error) raise('menu item search', error.message);
  return data ?? [];
}
