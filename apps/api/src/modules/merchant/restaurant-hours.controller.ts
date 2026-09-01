import { Body, Controller, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { replaceRestaurantHoursSchema, type RestaurantHoursResponse } from '@banhao/validation';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { RestaurantHoursService } from './restaurant-hours.service';

/**
 * M-12 Opening Hours.
 *
 * One route. `PUT` and not `PATCH`, because the schedule is replaced wholesale
 * — `restaurant_hours` has no per-row update path, and M12-D01 makes one save
 * for the whole week a product requirement, not just an implementation
 * convenience: a per-day save would silently rewrite the other six days.
 *
 * Restaurant-scoped, so `@RestaurantScope()` authorizes it directly from the
 * path, exactly as `RestaurantCoverController` does.
 *
 * There is no read route: `restaurant_hours_select_member` already lets a
 * merchant read their own hours straight from Supabase (M-12 S1).
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/restaurants/:restaurantId/hours')
export class RestaurantHoursController {
  constructor(private readonly hours: RestaurantHoursService) {}

  @Put()
  @HttpCode(200)
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'The saved week, re-read from the database' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async replaceHours(
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<RestaurantHoursResponse> {
    const input = parseOrThrow(replaceRestaurantHoursSchema, body);
    return this.hours.replaceHours(restaurantId, input);
  }
}
