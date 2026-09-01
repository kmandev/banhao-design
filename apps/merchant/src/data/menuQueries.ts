import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MenuCategory,
  MenuItem,
  MenuOption,
  MenuOptionGroup,
  MenuSection,
} from '../domain/menu';

/**
 * The merchant catalog read path — client to Supabase, directly, under RLS.
 *
 * No endpoint is involved and none should be added.
 * `menu_categories_select_member` and `menu_items_select_member` already scope
 * a merchant to restaurants they are an active member of, so the overview is a
 * read the client is already entitled to make (DEC-APP-008, M-11 §12). Writes
 * are the opposite and all go through the API — see `merchantMenu.ts`.
 *
 * `restaurantId` must already be a verified membership: it comes from
 * `useRestaurantScope`, which re-reads `restaurant_members` on every visit.
 * These functions do not re-check it, and do not need to — RLS is the backstop
 * if the caller is wrong.
 */

const CATEGORY_COLUMNS = 'id, name, sort_order, archived_at';
const ITEM_COLUMNS =
  'id, category_id, name, description, base_price_satang, image_url, is_available, sort_order, archived_at, updated_at';

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  archived_at: string | null;
}

export interface ItemRow {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  base_price_satang: number;
  image_url: string | null;
  is_available: boolean;
  sort_order: number;
  archived_at: string | null;
  updated_at: string;
}

export function toMenuCategory(row: CategoryRow): MenuCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  };
}

export function toMenuItem(row: ItemRow, optionGroupCount: number): MenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    basePriceSatang: Number(row.base_price_satang),
    imageUrl: row.image_url,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
    optionGroupCount,
  };
}

/**
 * Categories and dishes for the overview, assembled into sections.
 *
 * Archived rows are filtered out in the query rather than after it: an
 * archived dish is not part of the menu the merchant is editing, and reading
 * then discarding it would put retired data on the wire for no reader.
 *
 * Ordering is `sort_order` then `name`. The name tiebreak matters because
 * `sort_order` carries no uniqueness guarantee — two rows created in the same
 * moment share a value, and without a stable second key their order would
 * flicker between reads.
 */
export async function fetchMenu(
  client: SupabaseClient,
  restaurantId: string,
): Promise<MenuSection[]> {
  const [categories, items] = await Promise.all([
    fetchCategories(client, restaurantId),
    fetchItems(client, restaurantId),
  ]);

  const optionCounts = await fetchOptionGroupCounts(
    client,
    items.map((item) => item.id),
  );

  return categories.map((category) => ({
    category,
    items: items
      .filter((item) => item.category_id === category.id)
      .map((item) => toMenuItem(item, optionCounts.get(item.id) ?? 0)),
  }));
}

export async function fetchCategories(
  client: SupabaseClient,
  restaurantId: string,
): Promise<MenuCategory[]> {
  const { data, error } = await client
    .from('menu_categories')
    .select(CATEGORY_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => toMenuCategory(row as CategoryRow));
}

async function fetchItems(client: SupabaseClient, restaurantId: string): Promise<ItemRow[]> {
  const { data, error } = await client
    .from('menu_items')
    .select(ITEM_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as ItemRow[];
}

/**
 * How many option groups each dish has, for the row badge.
 *
 * A count, not the groups themselves: the overview shows `3 ตัวเลือก` and
 * nothing more, and pulling every option for every dish to render a number
 * would make the commonest read on the screen the most expensive one. The
 * groups are fetched by {@link fetchOptionGroups} when the editor opens.
 */
async function fetchOptionGroupCounts(
  client: SupabaseClient,
  menuItemIds: string[],
): Promise<Map<string, number>> {
  if (menuItemIds.length === 0) return new Map();

  const { data, error } = await client
    .from('menu_option_groups')
    .select('id, menu_item_id')
    .in('menu_item_id', menuItemIds);

  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { menu_item_id: string }[]) {
    counts.set(row.menu_item_id, (counts.get(row.menu_item_id) ?? 0) + 1);
  }
  return counts;
}

/** One dish's option groups and their options, for the option editor. */
export async function fetchOptionGroups(
  client: SupabaseClient,
  menuItemId: string,
): Promise<MenuOptionGroup[]> {
  const { data: groupData, error: groupError } = await client
    .from('menu_option_groups')
    .select('id, title, min_select, max_select, sort_order')
    .eq('menu_item_id', menuItemId)
    .order('sort_order', { ascending: true });

  if (groupError) throw new Error(groupError.message);

  const groups = (groupData ?? []) as {
    id: string;
    title: string;
    min_select: number;
    max_select: number;
    sort_order: number;
  }[];

  if (groups.length === 0) return [];

  const { data: optionData, error: optionError } = await client
    .from('menu_options')
    .select('id, group_id, label, price_delta_satang, is_available, sort_order')
    .in(
      'group_id',
      groups.map((group) => group.id),
    )
    .order('sort_order', { ascending: true });

  if (optionError) throw new Error(optionError.message);

  const byGroup = new Map<string, MenuOption[]>();
  for (const row of (optionData ?? []) as {
    id: string;
    group_id: string;
    label: string;
    price_delta_satang: number;
    is_available: boolean;
    sort_order: number;
  }[]) {
    const list = byGroup.get(row.group_id) ?? [];
    list.push({
      id: row.id,
      label: row.label,
      priceDeltaSatang: Number(row.price_delta_satang),
      isAvailable: row.is_available,
      sortOrder: row.sort_order,
    });
    byGroup.set(row.group_id, list);
  }

  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    minSelect: group.min_select,
    maxSelect: group.max_select,
    sortOrder: group.sort_order,
    options: byGroup.get(group.id) ?? [],
  }));
}
