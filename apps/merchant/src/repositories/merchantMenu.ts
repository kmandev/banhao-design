import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiClient } from '@banhao/api-client';
import type {
  ArchiveResponse,
  CreateMenuCategoryInput,
  CreateMenuItemInput,
  MenuCategoryResponse,
  MenuItemResponse,
  MenuOptionGroupInput,
  MenuOptionGroupsResponse,
  ReorderResponse,
  UpdateMenuItemInput,
} from '@banhao/validation';
import type { MenuOptionGroup, MenuSection } from '../domain/menu';
import { fetchMenu, fetchOptionGroups } from '../data/menuQueries';
import { apiClient as defaultApiClient } from '../lib/apiClient';

/**
 * The M-11 repository — the read/write split this app already draws twice.
 *
 * Reads go client → Supabase under RLS; writes go through the NestJS API.
 * That is not symmetry for its own sake: `authenticated` holds `select` only
 * on every catalog table, so a client-side write is not merely discouraged
 * here, it is impossible. `merchantOrders.ts` documents the same split at
 * length and for the same reasons.
 *
 * Errors are deliberately **not** collapsed into an opaque message: callers
 * branch on `ApiClientError.code` (`NOT_RESTAURANT_MEMBER`, `CONFLICT`,
 * `VALIDATION_FAILED`), so the original failure is left intact for the screen
 * to render the right Thai copy against.
 */
export interface MerchantMenuRepository {
  /** Active categories with their active dishes, in `sort_order`. May be empty. */
  listMenu(restaurantId: string): Promise<MenuSection[]>;

  /** One dish's option groups, loaded when the option editor opens. */
  listOptionGroups(menuItemId: string): Promise<MenuOptionGroup[]>;

  createCategory(restaurantId: string, input: CreateMenuCategoryInput): Promise<MenuCategoryResponse>;
  renameCategory(categoryId: string, name: string): Promise<MenuCategoryResponse>;
  archiveCategory(categoryId: string): Promise<ArchiveResponse>;
  reorderCategories(restaurantId: string, categoryIds: string[]): Promise<ReorderResponse>;

  createItem(restaurantId: string, input: CreateMenuItemInput): Promise<MenuItemResponse>;
  updateItem(menuItemId: string, input: UpdateMenuItemInput): Promise<MenuItemResponse>;

  /**
   * The `ปิดขายวันนี้` fast path — one boolean against its own endpoint.
   * Separate from `updateItem` because M11-C05 requires the most frequent
   * merchant action to be the cheapest request, not the heaviest.
   */
  setItemAvailability(menuItemId: string, isAvailable: boolean): Promise<MenuItemResponse>;

  archiveItem(menuItemId: string): Promise<ArchiveResponse>;
  reorderItems(restaurantId: string, categoryId: string, menuItemIds: string[]): Promise<ReorderResponse>;

  replaceOptionGroups(
    menuItemId: string,
    groups: MenuOptionGroupInput[],
  ): Promise<MenuOptionGroupsResponse>;

  /**
   * The M-MENU-IMG two-step upload's first call — existing
   * `MenuItemImageController` route, keyed by `menuItemId` alone (no
   * `restaurantId`, edit-mode only per M11-D09). Reused exactly as it exists,
   * matching `merchantProfile.ts`'s cover-photo pair.
   */
  requestItemImageUpload(
    menuItemId: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; objectKey: string }>;

  /** The second call — `imageUrl` in the response is already the resolved public URL. */
  completeItemImageUpload(menuItemId: string, objectKey: string): Promise<{ imageUrl: string }>;
}

export function createMerchantMenuRepository(
  client: SupabaseClient,
  api: ApiClient = defaultApiClient,
): MerchantMenuRepository {
  /** `ApiClient` exposes `request` only; every write here states its own verb. */
  const send = <T>(path: string, method: string, body?: unknown): Promise<T> =>
    api.request<T>(path, {
      method,
      // No `body: '{}'` for a body-less command — that would invent a request
      // shape the controller does not declare. Same rule `merchantOrders.ts`
      // follows for its two body-less transitions.
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return {
    listMenu: (restaurantId) => fetchMenu(client, restaurantId),
    listOptionGroups: (menuItemId) => fetchOptionGroups(client, menuItemId),

    createCategory: (restaurantId, input) =>
      send<MenuCategoryResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/menu-categories`,
        'POST',
        input,
      ),

    renameCategory: (categoryId, name) =>
      send<MenuCategoryResponse>(`/api/v1/merchant/menu-categories/${categoryId}`, 'PATCH', {
        name,
      }),

    archiveCategory: (categoryId) =>
      send<ArchiveResponse>(`/api/v1/merchant/menu-categories/${categoryId}/archive`, 'POST'),

    reorderCategories: (restaurantId, categoryIds) =>
      send<ReorderResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/menu-categories/reorder`,
        'POST',
        { categoryIds },
      ),

    createItem: (restaurantId, input) =>
      send<MenuItemResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/menu-items`,
        'POST',
        input,
      ),

    updateItem: (menuItemId, input) =>
      send<MenuItemResponse>(`/api/v1/merchant/menu-items/${menuItemId}`, 'PATCH', input),

    setItemAvailability: (menuItemId, isAvailable) =>
      send<MenuItemResponse>(`/api/v1/merchant/menu-items/${menuItemId}/availability`, 'PATCH', {
        isAvailable,
      }),

    archiveItem: (menuItemId) =>
      send<ArchiveResponse>(`/api/v1/merchant/menu-items/${menuItemId}/archive`, 'POST'),

    reorderItems: (restaurantId, categoryId, menuItemIds) =>
      send<ReorderResponse>(
        `/api/v1/merchant/restaurants/${restaurantId}/menu-items/reorder`,
        'POST',
        { categoryId, menuItemIds },
      ),

    replaceOptionGroups: (menuItemId, groups) =>
      send<MenuOptionGroupsResponse>(
        `/api/v1/merchant/menu-items/${menuItemId}/option-groups`,
        'PUT',
        { groups },
      ),

    requestItemImageUpload: (menuItemId, contentType) =>
      send<{ uploadUrl: string; objectKey: string }>(
        `/api/v1/merchant/menu-items/${menuItemId}/image/upload-url`,
        'POST',
        { contentType },
      ),

    completeItemImageUpload: (menuItemId, objectKey) =>
      send<{ imageUrl: string }>(
        `/api/v1/merchant/menu-items/${menuItemId}/image/complete`,
        'POST',
        { objectKey },
      ),
  };
}
