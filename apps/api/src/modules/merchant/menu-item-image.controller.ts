import { Body, Controller, Param, Post, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  completeMenuItemImageUploadSchema,
  requestMenuItemImageUploadUrlSchema,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import type { AuthenticatedUser } from '../../common/types';
import { MenuItemImageService } from './menu-item-image.service';

/**
 * Menu item image upload — M-12.
 *
 * No `@RestaurantScope()` on either route, unlike M-11's restaurant cover
 * routes — and that is intentional, not a gap. `@RestaurantScope()` reads a
 * `restaurantId` **route parameter**; these routes are keyed by `menuItemId`
 * alone and carry no such parameter, so the decorator would deny every
 * request unconditionally rather than authorize correctly. `@Roles('MERCHANT')`
 * still runs (rejects a non-merchant outright), and `MenuItemImageService`
 * performs the equivalent per-resource membership check itself — using the
 * same `hasMerchantAccess` primitive `RestaurantScopeGuard` calls — once
 * `menuItemId` resolves to a restaurant. See that service's own doc comment
 * for the full reasoning.
 *
 * `imageUrl` in the `complete` response is the **resolved public URL**
 * (`StorageService.getPublicUrl`), not the bare object key M-11's endpoint of
 * the same name returns. Both are documented, deliberate: M-12's own spec
 * calls for a ready-to-render URL here, and changing M-11's established
 * response shape to match was out of this task's scope.
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/menu-items/:menuItemId/image')
export class MenuItemImageController {
  constructor(private readonly images: MenuItemImageService) {}

  @Post('upload-url')
  @Roles('MERCHANT')
  @ApiOkResponse({ description: 'A presigned R2 upload URL and the object key it is scoped to' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the restaurant that owns this item' })
  async requestUploadUrl(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
    @Body() body: unknown,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const input = parseOrThrow(requestMenuItemImageUploadUrlSchema, body);
    return this.images.requestUploadUrl(
      menuItemId,
      input.contentType,
      requireUser(user).capabilities,
    );
  }

  @Post('complete')
  @Roles('MERCHANT')
  @ApiOkResponse({ description: "The menu item's resolved public image URL" })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of the restaurant that owns this item' })
  @ApiNotFoundResponse({ description: 'No object exists at the expected key yet' })
  async completeUpload(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('menuItemId') menuItemId: string,
    @Body() body: unknown,
  ): Promise<{ imageUrl: string }> {
    const input = parseOrThrow(completeMenuItemImageUploadSchema, body);
    return this.images.completeUpload(
      menuItemId,
      input.objectKey,
      requireUser(user).capabilities,
    );
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so
 * the type is non-optional at the call site, matching `AddressesController`
 * and `RestaurantCoverController`.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
