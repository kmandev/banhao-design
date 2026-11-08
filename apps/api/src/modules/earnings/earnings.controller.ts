import { Controller, Get, Param, Query, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { weekStartSchema, type EarningsResponse } from '@banhao/validation';
import { Roles } from '../../common/decorators/roles.decorator';
import { RestaurantScope } from '../../common/decorators/restaurant-scope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { EarningsService } from './earnings.service';

/** DEC-073 — a restaurant member reads that restaurant's earnings. `@RestaurantScope()` checks membership. */
@ApiTags('merchant')
@ApiBearerAuth()
@Controller('api/v1/merchant/restaurants/:restaurantId/earnings')
export class MerchantEarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get()
  @Roles('MERCHANT')
  @RestaurantScope()
  @ApiOkResponse({ description: "The restaurant's earnings for the week" })
  @ApiForbiddenResponse({ description: 'Not a member of this restaurant' })
  async get(@Param('restaurantId') restaurantId: string, @Query('week') week?: string): Promise<EarningsResponse> {
    return this.earnings.forRestaurant(restaurantId, parseOrThrow(weekStartSchema, week));
  }
}

/** DEC-073 — an approved rider reads their own earnings. Never another rider's: the id comes from the session. */
@ApiTags('rider')
@ApiBearerAuth()
@Controller('api/v1/rider/earnings')
export class RiderEarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get()
  @Roles('RIDER')
  @ApiOkResponse({ description: "The caller's own earnings for the week" })
  async get(@CurrentUser() user: AuthenticatedUser | undefined, @Query('week') week?: string): Promise<EarningsResponse> {
    if (!user) throw new UnauthorizedException();
    const rider = user.capabilities.rider;
    if (!rider) throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    return this.earnings.forRider(rider.riderId, parseOrThrow(weekStartSchema, week));
  }
}
