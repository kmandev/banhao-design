import { Body, Controller, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { updateRestaurantProfileSchema, type RestaurantProfileResponse } from '@banhao/validation';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { RestaurantProfileService } from './restaurant-profile.service';

/**
 * M-10 Restaurant Profile.
 *
 * One route. `PUT`, not `PATCH` — the whole editable field set is replaced in
 * one request (M10-D08), the same choice `RestaurantHoursController` makes
 * for the same reason: a partial-save contract would make it ambiguous
 * whether an omitted field means "leave unchanged" or "clear it".
 *
 * Restaurant-scoped, so `@RestaurantScope()` authorizes it directly from the
 * path, exactly as `RestaurantCoverController` and `RestaurantHoursController`
 * both do.
 *
 * There is no read route: `restaurants_select_member` already lets a merchant
 * read their own restaurant's descriptive fields straight from Supabase,
 * matching the read/write split `RestaurantHoursController` already
 * establishes ("no read route" — M-12).
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/restaurants/:restaurantId/profile')
export class RestaurantProfileController {
  constructor(private readonly profile: RestaurantProfileService) {}

  @Put()
  @HttpCode(200)
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'The saved profile, re-read from the database' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async updateProfile(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<RestaurantProfileResponse> {
    const input = parseOrThrow(updateRestaurantProfileSchema, body);
    return this.profile.updateProfile(restaurantId, input);
  }
}
