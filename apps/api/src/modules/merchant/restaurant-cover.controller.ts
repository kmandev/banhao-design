import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  completeCoverUploadSchema,
  requestCoverUploadUrlSchema,
} from '@banhao/validation';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { RestaurantCoverService } from './restaurant-cover.service';

/**
 * Restaurant cover image upload — M-11.
 *
 * `restaurantId` is read only from the route path, never the body — matching
 * `@RestaurantScope()`'s own rule that a body field must never be able to
 * redirect an authorization check. Both routes are protected by the three
 * global guards already registered in `AppModule` (`SupabaseAuthGuard` →
 * `RolesGuard` → `RestaurantScopeGuard`); `@Roles('MERCHANT')` +
 * `@RestaurantScope()` here is what actually turns that protection on for
 * these two routes — a scoped route with no decorator would fall through the
 * guards' own opt-out ("not a restaurant-scoped route" / "no roles
 * required").
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/restaurants/:restaurantId/cover')
export class RestaurantCoverController {
  constructor(private readonly cover: RestaurantCoverService) {}

  @Post('upload-url')
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'A presigned R2 upload URL and the object key it is scoped to' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  @ApiConflictResponse({ description: 'VALIDATION_FAILED — unsupported content type' })
  async requestUploadUrl(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const input = parseOrThrow(requestCoverUploadUrlSchema, body);
    return this.cover.requestUploadUrl(restaurantId, input.contentType);
  }

  @Post('complete')
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: "The restaurant's updated image object key" })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  @ApiNotFoundResponse({ description: 'No object exists at the expected key yet' })
  async completeUpload(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<{ imageUrl: string }> {
    const input = parseOrThrow(completeCoverUploadSchema, body);
    return this.cover.completeUpload(restaurantId, input.objectKey);
  }
}
