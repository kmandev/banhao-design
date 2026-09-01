import { Injectable, Logger } from '@nestjs/common';
import type {
  ArchiveResponse,
  CreateMenuCategoryInput,
  CreateMenuItemInput,
  MenuCategoryResponse,
  MenuItemResponse,
  MenuOptionGroupInput,
  ReorderResponse,
  UpdateMenuCategoryInput,
  UpdateMenuItemInput,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { hasMerchantAccess, type ActorCapabilities } from '../../common/types';

/**
 * M-11 Menu Management — the merchant catalog write path.
 *
 * ## Why this service exists at all
 *
 * The M-11 artifact's single most important finding (§14 C-01) is that no
 * merchant catalog write path existed: `authenticated` holds `select` only on
 * all five catalog tables, so a browser physically cannot write a dish, a
 * price or an availability flag. This service is the other side of that —
 * DEC-APP-008's "NestJS writes, clients read", with the service-role client
 * doing the writing, exactly as `MenuItemImageService` already writes
 * `menu_items.image_url`.
 *
 * **Reads are deliberately absent.** `menu_categories_select_member` and
 * `menu_items_select_member` already scope a merchant to their own restaurant,
 * so the overview reads straight from Supabase and needs no endpoint here
 * (M-11 §12). Adding read endpoints would duplicate a path that already works.
 *
 * ## Authorization
 *
 * Two shapes, matching the two that already exist in this module:
 *
 *   - Restaurant-scoped routes (`restaurants/:restaurantId/...`) are covered
 *     by `@RestaurantScope()` in the controller, like `RestaurantCoverService`.
 *   - Routes keyed by a category or item id carry no `restaurantId` in the
 *     URL, so — exactly as `MenuItemImageService` documents at length — the
 *     resource-level check moves from the decorator to an explicit
 *     `hasMerchantAccess` call at the point the owning restaurant becomes
 *     known. `@Roles('MERCHANT')` and `SupabaseAuthGuard` still run as global
 *     guards; only the per-resource half moves.
 *
 * A missing row and a row belonging to someone else produce the **same**
 * error, deliberately: a merchant must not be able to learn whether an id
 * names a real dish in a shop they do not belong to.
 *
 * ## Nothing here deletes
 *
 * `menu_items` and `menu_categories` both carry `reject_delete`, and
 * `order_items.menu_item_id` is `on delete set null` so history keeps pointing
 * at a real row. Removal is `archived_at`, and the copy says so (M11-D06).
 */

interface CategoryRow {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  archived_at: string | null;
}

interface ItemRow {
  id: string;
  restaurant_id: string;
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

const CATEGORY_COLUMNS = 'id, restaurant_id, name, sort_order, archived_at';
const ITEM_COLUMNS =
  'id, restaurant_id, category_id, name, description, base_price_satang, image_url, is_available, sort_order, archived_at, updated_at';

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  /**
   * A new category appends: `sort_order` is one past the current maximum, so
   * the merchant's existing order is untouched and the new section lands at
   * the bottom where they just asked for it (M11-D08).
   *
   * The max-then-insert is not a race the way a claimed sequence would be:
   * two categories created at the same instant would share a `sort_order`,
   * which the column permits (it has no uniqueness guarantee) and which the
   * next drag-reorder renumbers away. A ties-broken-by-name ordering on read
   * keeps the display stable in the meantime.
   */
  async createCategory(
    restaurantId: string,
    input: CreateMenuCategoryInput,
  ): Promise<MenuCategoryResponse> {
    const sortOrder = await this.nextCategorySortOrder(restaurantId);

    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .insert({ restaurant_id: restaurantId, name: input.name, sort_order: sortOrder })
      .select(CATEGORY_COLUMNS)
      .maybeSingle<CategoryRow>();

    if (error) {
      this.logger.error(`Category insert failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category create failed' });
    }
    if (!data) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Category create returned no row' });
    }

    return toCategoryResponse(data);
  }

  async updateCategory(
    categoryId: string,
    input: UpdateMenuCategoryInput,
    capabilities: ActorCapabilities,
  ): Promise<MenuCategoryResponse> {
    await this.resolveAuthorizedCategory(categoryId, capabilities);

    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .update({ name: input.name })
      .eq('id', categoryId)
      .select(CATEGORY_COLUMNS)
      .maybeSingle<CategoryRow>();

    if (error) {
      this.logger.error(`Category update failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category update failed' });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Category not found' });
    }

    return toCategoryResponse(data);
  }

  /**
   * Archives a category — never deletes it (`menu_categories_reject_delete`).
   *
   * **A category holding active dishes is refused.** `menu_items.category_id`
   * is `on delete restrict` and, more to the point, `menu_items_select_active`
   * checks only the item and the restaurant — not the category — so archiving
   * a populated category would leave its dishes publicly readable with no
   * section to appear in. That is M11-Q-01, which is unresolved; blocking the
   * removal is the design's own stated safe placeholder, and choosing either
   * outcome here would be answering a product question in an implementation
   * task.
   */
  async archiveCategory(
    categoryId: string,
    capabilities: ActorCapabilities,
  ): Promise<ArchiveResponse> {
    const category = await this.resolveAuthorizedCategory(categoryId, capabilities);

    const activeItems = await this.countActiveItemsInCategory(categoryId);
    if (activeItems > 0) {
      throw new DomainError('CONFLICT', {
        message: 'Move or archive this category’s items before archiving it',
        details: { activeItemCount: activeItems, categoryId: category.id },
      });
    }

    const archivedAt = new Date().toISOString();

    // Guarded conditional UPDATE (ADR-003): `archived_at is null` is in the
    // WHERE clause, not read first and checked in TypeScript, so a second
    // concurrent archive changes nothing rather than overwriting the first
    // one's timestamp.
    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .update({ archived_at: archivedAt })
      .eq('id', categoryId)
      .is('archived_at', null)
      .select('id, archived_at')
      .maybeSingle<{ id: string; archived_at: string }>();

    if (error) {
      this.logger.error(`Category archive failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category archive failed' });
    }
    if (!data) {
      // Already archived. Reported as a conflict rather than silently
      // succeeding, so the UI does not show "removed" for a second time.
      throw new DomainError('CONFLICT', { message: 'Category is already archived' });
    }

    return { id: data.id, archivedAt: data.archived_at };
  }

  async reorderCategories(restaurantId: string, categoryIds: string[]): Promise<ReorderResponse> {
    const { data, error } = await this.supabase.admin.rpc('reorder_menu_categories', {
      p_restaurant_id: restaurantId,
      p_category_ids: categoryIds,
    });

    if (error) {
      this.logger.error(`Category reorder failed for ${restaurantId}: ${error.message}`);
      // The function raises when the list is partial, duplicated, or names
      // another restaurant's category. All three are the caller sending a
      // stale or wrong list, not a server fault.
      throw new DomainError('VALIDATION_FAILED', {
        message: 'The supplied order must name every active category of this restaurant exactly once',
        details: { categoryIds: ['not a complete, duplicate-free order for this restaurant'] },
      });
    }

    return { reordered: Number(data ?? 0) };
  }

  // -------------------------------------------------------------------------
  // Menu items
  // -------------------------------------------------------------------------

  async createItem(
    restaurantId: string,
    input: CreateMenuItemInput,
  ): Promise<MenuItemResponse> {
    // The category must be an active one of *this* restaurant. Without this
    // check the composite FK would still stop a cross-restaurant line reaching
    // a cart, but the dish itself would have been created in the wrong shop.
    await this.assertCategoryBelongsToRestaurant(input.categoryId, restaurantId);

    const sortOrder = await this.nextItemSortOrder(restaurantId, input.categoryId);

    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .insert({
        restaurant_id: restaurantId,
        category_id: input.categoryId,
        name: input.name,
        description: emptyToNull(input.description),
        base_price_satang: input.basePriceSatang,
        is_available: input.isAvailable ?? true,
        sort_order: sortOrder,
      })
      .select(ITEM_COLUMNS)
      .maybeSingle<ItemRow>();

    if (error) {
      this.logger.error(`Menu item insert failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item create failed' });
    }
    if (!data) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item create returned no row' });
    }

    return toItemResponse(data);
  }

  async updateItem(
    menuItemId: string,
    input: UpdateMenuItemInput,
    capabilities: ActorCapabilities,
  ): Promise<MenuItemResponse> {
    const item = await this.resolveAuthorizedItem(menuItemId, capabilities);

    // Moving a dish between categories is permitted (M11-Q-02: the database
    // allows it and `order_items` snapshots name and price, so history is
    // unaffected) — but only within the same restaurant.
    if (input.categoryId !== undefined) {
      await this.assertCategoryBelongsToRestaurant(input.categoryId, item.restaurant_id);
    }

    const patch: Record<string, unknown> = {};
    if (input.categoryId !== undefined) patch.category_id = input.categoryId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = emptyToNull(input.description);
    if (input.basePriceSatang !== undefined) patch.base_price_satang = input.basePriceSatang;
    if (input.isAvailable !== undefined) patch.is_available = input.isAvailable;

    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .update(patch)
      .eq('id', menuItemId)
      .select(ITEM_COLUMNS)
      .maybeSingle<ItemRow>();

    if (error) {
      this.logger.error(`Menu item update failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item update failed' });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Menu item not found' });
    }

    return toItemResponse(data);
  }

  /**
   * The `ปิดขายวันนี้` fast path — one boolean, its own route.
   *
   * M11-C05: this is the most frequent merchant action after accepting an
   * order, and the UX specification requires it to cost nothing. Routing it
   * through `updateItem`'s payload would make the fast path the heaviest
   * request on the screen.
   *
   * **No automatic daily reset.** M11-Q-03 records that `ปิดขายวันนี้` says
   * "today" while `is_available` is a plain boolean with no timestamp and no
   * job. The design flags that mismatch rather than inventing a reset, and so
   * does this: nothing here or anywhere else schedules one.
   */
  async setItemAvailability(
    menuItemId: string,
    isAvailable: boolean,
    capabilities: ActorCapabilities,
  ): Promise<MenuItemResponse> {
    await this.resolveAuthorizedItem(menuItemId, capabilities);

    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .update({ is_available: isAvailable })
      .eq('id', menuItemId)
      .select(ITEM_COLUMNS)
      .maybeSingle<ItemRow>();

    if (error) {
      this.logger.error(`Availability update failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Availability update failed' });
    }
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Menu item not found' });
    }

    return toItemResponse(data);
  }

  /** Archives a dish. Never deletes — `menu_items_reject_delete` refuses, and history must keep its FK. */
  async archiveItem(menuItemId: string, capabilities: ActorCapabilities): Promise<ArchiveResponse> {
    await this.resolveAuthorizedItem(menuItemId, capabilities);

    const archivedAt = new Date().toISOString();

    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .update({ archived_at: archivedAt })
      .eq('id', menuItemId)
      .is('archived_at', null)
      .select('id, archived_at')
      .maybeSingle<{ id: string; archived_at: string }>();

    if (error) {
      this.logger.error(`Menu item archive failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item archive failed' });
    }
    if (!data) {
      throw new DomainError('CONFLICT', { message: 'Menu item is already archived' });
    }

    return { id: data.id, archivedAt: data.archived_at };
  }

  async reorderItems(
    restaurantId: string,
    categoryId: string,
    menuItemIds: string[],
  ): Promise<ReorderResponse> {
    const { data, error } = await this.supabase.admin.rpc('reorder_menu_items', {
      p_restaurant_id: restaurantId,
      p_category_id: categoryId,
      p_menu_item_ids: menuItemIds,
    });

    if (error) {
      this.logger.error(`Menu item reorder failed for ${restaurantId}: ${error.message}`);
      throw new DomainError('VALIDATION_FAILED', {
        message: 'The supplied order must name every active item of this category exactly once',
        details: { menuItemIds: ['not a complete, duplicate-free order for this category'] },
      });
    }

    return { reordered: Number(data ?? 0) };
  }

  // -------------------------------------------------------------------------
  // Option groups
  // -------------------------------------------------------------------------

  /**
   * Replaces a dish's option groups wholesale, in one transaction.
   *
   * Wholesale because the editor edits them as one list — adding, removing and
   * reordering groups and their options together — and because it is safe:
   * `order_item_options` snapshots `group_name_snapshot` and
   * `option_name_snapshot` as text, so no history depends on a group's id
   * surviving.
   */
  async replaceOptionGroups(
    menuItemId: string,
    groups: MenuOptionGroupInput[],
    capabilities: ActorCapabilities,
  ): Promise<{ menuItemId: string; groupCount: number }> {
    await this.resolveAuthorizedItem(menuItemId, capabilities);

    const { data, error } = await this.supabase.admin.rpc('replace_menu_item_option_groups', {
      p_menu_item_id: menuItemId,
      p_groups: groups.map((group) => ({
        title: group.title,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.options.map((option) => ({
          label: option.label,
          priceDeltaSatang: option.priceDeltaSatang,
          isAvailable: option.isAvailable,
        })),
      })),
    });

    if (error) {
      this.logger.error(`Option group replace failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Option group update failed' });
    }

    return { menuItemId, groupCount: Number(data ?? 0) };
  }

  // -------------------------------------------------------------------------
  // Shared lookups
  // -------------------------------------------------------------------------

  /**
   * Resolves a category to its owning restaurant and proves membership.
   * See this class's doc comment for why this is an explicit call rather than
   * `@RestaurantScope()`.
   */
  private async resolveAuthorizedCategory(
    categoryId: string,
    capabilities: ActorCapabilities,
  ): Promise<CategoryRow> {
    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .select(CATEGORY_COLUMNS)
      .eq('id', categoryId)
      .maybeSingle<CategoryRow>();

    if (error) {
      this.logger.error(`Category lookup failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category lookup failed' });
    }
    if (!data || !hasMerchantAccess(capabilities, data.restaurant_id)) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    return data;
  }

  private async resolveAuthorizedItem(
    menuItemId: string,
    capabilities: ActorCapabilities,
  ): Promise<ItemRow> {
    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .select(ITEM_COLUMNS)
      .eq('id', menuItemId)
      .maybeSingle<ItemRow>();

    if (error) {
      this.logger.error(`Menu item lookup failed for ${menuItemId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item lookup failed' });
    }
    if (!data || !hasMerchantAccess(capabilities, data.restaurant_id)) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }

    return data;
  }

  private async assertCategoryBelongsToRestaurant(
    categoryId: string,
    restaurantId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .select('id, restaurant_id, archived_at')
      .eq('id', categoryId)
      .maybeSingle<{ id: string; restaurant_id: string; archived_at: string | null }>();

    if (error) {
      this.logger.error(`Category lookup failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category lookup failed' });
    }

    if (!data || data.restaurant_id !== restaurantId || data.archived_at !== null) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'categoryId must be an active category of this restaurant',
        details: { categoryId: ['not an active category of this restaurant'] },
      });
    }
  }

  private async countActiveItemsInCategory(categoryId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId)
      .is('archived_at', null);

    if (error) {
      this.logger.error(`Category item count failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category item count failed' });
    }

    return count ?? 0;
  }

  private async nextCategorySortOrder(restaurantId: string): Promise<number> {
    const { data, error } = await this.supabase.admin
      .from('menu_categories')
      .select('sort_order')
      .eq('restaurant_id', restaurantId)
      .is('archived_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();

    if (error) {
      this.logger.error(`Category sort order read failed for ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Category create failed' });
    }

    return data ? data.sort_order + 1 : 0;
  }

  private async nextItemSortOrder(restaurantId: string, categoryId: string): Promise<number> {
    const { data, error } = await this.supabase.admin
      .from('menu_items')
      .select('sort_order')
      .eq('restaurant_id', restaurantId)
      .eq('category_id', categoryId)
      .is('archived_at', null)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();

    if (error) {
      this.logger.error(`Item sort order read failed for ${categoryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Menu item create failed' });
    }

    return data ? data.sort_order + 1 : 0;
  }
}

/**
 * An empty description is stored as `null`, not `''`.
 *
 * `menu_items.description` is nullable and the customer app renders no second
 * line when it is absent. Storing an empty string would make "no description"
 * two different values that read the same on screen.
 */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toCategoryResponse(row: CategoryRow): MenuCategoryResponse {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  };
}

function toItemResponse(row: ItemRow): MenuItemResponse {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    basePriceSatang: Number(row.base_price_satang),
    imageUrl: row.image_url,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    updatedAt: row.updated_at,
  };
}
