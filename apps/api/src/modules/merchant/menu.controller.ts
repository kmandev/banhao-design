import { Body, Controller, HttpCode, Param, Patch, Post, Put, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  createMenuCategorySchema,
  createMenuItemSchema,
  reorderMenuCategoriesSchema,
  reorderMenuItemsSchema,
  replaceMenuOptionGroupsSchema,
  setMenuItemAvailabilitySchema,
  updateMenuCategorySchema,
  updateMenuItemSchema,
  type ArchiveResponse,
  type MenuCategoryResponse,
  type MenuItemResponse,
  type MenuOptionGroupsResponse,
  type ReorderResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { MenuService } from './menu.service';

/**
 * M-11 Menu Management — the merchant catalog write surface.
 *
 * ## Two route shapes, two authorization mechanisms
 *
 * Creating and reordering are **restaurant-scoped**: the restaurant is in the
 * path, so `@RestaurantScope()` authorizes them, exactly as
 * `RestaurantCoverController` does.
 *
 * Editing one category or one dish is keyed by **that row's id** and carries
 * no `restaurantId` at all. `@RestaurantScope()` denies unconditionally when
 * its route parameter is missing, so it genuinely cannot be applied — the same
 * situation `MenuItemImageController` is in, and resolved the same way:
 * `MenuService` calls `hasMerchantAccess` once the owning restaurant is known
 * from the row. `@Roles('MERCHANT')` still applies to every route here.
 *
 * ## No read routes
 *
 * The overview reads straight from Supabase under
 * `menu_categories_select_member` / `menu_items_select_member` (DEC-APP-008,
 * M-11 §12). A read endpoint here would duplicate a working path.
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  @Post('restaurants/:restaurantId/menu-categories')
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiCreatedResponse({ description: 'The created category' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async createCategory(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<MenuCategoryResponse> {
    const input = parseOrThrow(createMenuCategorySchema, body);
    return this.menu.createCategory(restaurantId, input);
  }

  @Patch('menu-categories/:categoryId')
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The renamed category' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async updateCategory(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('categoryId') categoryId: string,
    @Body() body: unknown,
  ): Promise<MenuCategoryResponse> {
    const input = parseOrThrow(updateMenuCategorySchema, body);
    return this.menu.updateCategory(categoryId, input, requireUser(user).capabilities);
  }

  /**
   * Archive, not delete — `menu_categories_reject_delete` refuses a DELETE and
   * the copy must not promise removal (M11-D06). A category still holding
   * active dishes is refused with `CONFLICT`; see `MenuService.archiveCategory`
   * for why that is the correct behaviour while M11-Q-01 is open.
   */
  @Post('menu-categories/:categoryId/archive')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The category, now archived' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  @ApiConflictResponse({ description: 'The category still holds active items, or is already archived' })
  async archiveCategory(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('categoryId') categoryId: string,
  ): Promise<ArchiveResponse> {
    return this.menu.archiveCategory(categoryId, requireUser(user).capabilities);
  }

  @Post('restaurants/:restaurantId/menu-categories/reorder')
  @HttpCode(200)
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'How many categories were renumbered' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async reorderCategories(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<ReorderResponse> {
    const input = parseOrThrow(reorderMenuCategoriesSchema, body);
    return this.menu.reorderCategories(restaurantId, input.categoryIds);
  }

  // -------------------------------------------------------------------------
  // Menu items
  // -------------------------------------------------------------------------

  @Post('restaurants/:restaurantId/menu-items')
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiCreatedResponse({ description: 'The created dish' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async createItem(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<MenuItemResponse> {
    const input = parseOrThrow(createMenuItemSchema, body);
    return this.menu.createItem(restaurantId, input);
  }

  @Patch('menu-items/:menuItemId')
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The updated dish' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
    @Body() body: unknown,
  ): Promise<MenuItemResponse> {
    const input = parseOrThrow(updateMenuItemSchema, body);
    return this.menu.updateItem(menuItemId, input, requireUser(user).capabilities);
  }

  /**
   * The `ปิดขายวันนี้` fast path. Its own single-field route because this is
   * the most frequent merchant action after accepting an order and the UX
   * specification requires it to cost nothing (M11-C05).
   */
  @Patch('menu-items/:menuItemId/availability')
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The dish, with its new availability' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  @ApiNotFoundResponse({ description: 'Menu item not found' })
  async setItemAvailability(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
    @Body() body: unknown,
  ): Promise<MenuItemResponse> {
    const input = parseOrThrow(setMenuItemAvailabilitySchema, body);
    return this.menu.setItemAvailability(menuItemId, input.isAvailable, requireUser(user).capabilities);
  }

  @Post('menu-items/:menuItemId/archive')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'The dish, now archived' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  @ApiConflictResponse({ description: 'The dish is already archived' })
  async archiveItem(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
  ): Promise<ArchiveResponse> {
    return this.menu.archiveItem(menuItemId, requireUser(user).capabilities);
  }

  @Post('restaurants/:restaurantId/menu-items/reorder')
  @HttpCode(200)
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'How many dishes were renumbered' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async reorderItems(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<ReorderResponse> {
    const input = parseOrThrow(reorderMenuItemsSchema, body);
    return this.menu.reorderItems(restaurantId, input.categoryId, input.menuItemIds);
  }

  // -------------------------------------------------------------------------
  // Option groups
  // -------------------------------------------------------------------------

  /**
   * `PUT`, not `PATCH`: this replaces every group and option on the dish, and
   * the verb should say so. An empty array removes them all, which is a
   * legitimate edit.
   */
  @Put('menu-items/:menuItemId/option-groups')
  @HttpCode(200)
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'How many option groups the dish now has' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the owning restaurant' })
  async replaceOptionGroups(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
    @Body() body: unknown,
  ): Promise<MenuOptionGroupsResponse> {
    const input = parseOrThrow(replaceMenuOptionGroupsSchema, body);
    return this.menu.replaceOptionGroups(menuItemId, input.groups, requireUser(user).capabilities);
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so the
 * type is non-optional at the call site, matching every other controller.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
