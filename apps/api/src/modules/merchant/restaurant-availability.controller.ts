import { Body, Controller, HttpCode, Param, Put, UnauthorizedException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  setRestaurantAvailabilitySchema,
  type RestaurantAvailabilityResponse,
} from '@banhao/validation';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { RestaurantAvailabilityService } from './restaurant-availability.service';

/**
 * M-13 Merchant Availability (Normal / Busy / Paused).
 *
 * One route. `PUT`, matching `RestaurantHoursController` and
 * `RestaurantProfileController`'s own choice for the same reason: the whole
 * mode is replaced in one request, never a partial patch.
 *
 * Restaurant-scoped, so `@RestaurantScope()` authorizes it directly from the
 * path, exactly as every other merchant write controller does.
 *
 * There is no read route: `restaurants_select_active` / `restaurants_select_member`
 * already let anyone read the two new columns straight from Supabase — they
 * are public, table-level-granted columns, matching every other operational
 * availability field on this table (`temporarily_closed_until`).
 */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/restaurants/:restaurantId/availability')
export class RestaurantAvailabilityController {
  constructor(private readonly availability: RestaurantAvailabilityService) {}

  @Put()
  @HttpCode(200)
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: 'The saved availability, re-read from the database' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — e.g. PAUSED to BUSY directly is not implemented' })
  // DEC-068 C3-A: the audit row is written in the same transaction as the
  // change. If it cannot be written the change fails (500) and the mode is
  // unchanged — it is never reported as a success.
  async setAvailability(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('restaurantId') restaurantId: string,
    @Body() body: unknown,
  ): Promise<RestaurantAvailabilityResponse> {
    const input = parseOrThrow(setRestaurantAvailabilitySchema, body);
    const caller = requireUser(user);
    // `RestaurantScopeGuard` has already proved this membership exists; the
    // role is read from it only so the audit row can record it (DEC-068 C3).
    const membership = caller.capabilities.merchant.find((m) => m.restaurantId === restaurantId);
    if (!membership) {
      throw new DomainError('NOT_RESTAURANT_MEMBER');
    }
    return this.availability.setAvailability(
      restaurantId,
      { actorType: 'MERCHANT', userId: caller.id, role: membership.memberRole },
      input,
    );
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so
 * the type is non-optional at the call site, matching every other controller
 * in this app (`OrdersController`, `AddressesController`, `CartController`).
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}
