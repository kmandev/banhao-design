import { Body, Controller, HttpCode, Param, Post, UnauthorizedException } from '@nestjs/common';
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
  riderLocationRequestSchema,
  type RiderLocationResponse,
  type RiderOfferAcceptResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { RiderLocationService } from './rider-location.service';

/**
 * The rider surface — Phase G-2 (DEC-020 broadcast dispatch, DEC-037's
 * parameters). Two routes, both commands rather than `PATCH { … }` (ADR-009),
 * both under the `/api/v1` base V1.1 §6 fixes.
 *
 * `@Roles('RIDER')` is the approval gate: `CapabilitiesService` resolves
 * `capabilities.rider` only for `riders.status = 'APPROVED'`, so a pending,
 * suspended or deactivated rider is refused here with `403 FORBIDDEN` before
 * any service runs — which is why neither service re-checks approval and why
 * V1.1 §6's `RIDER_NOT_APPROVED` needs no catalogue code of its own.
 *
 * There is deliberately **no** route to read offers: DEC-APP-008 has the driver
 * app read its own pending offers straight from Supabase through the
 * `rider_assignment_attempts_select_own` policy, so adding a read endpoint here
 * would duplicate a path that already exists.
 */
@ApiTags('rider')
@ApiBearerAuth()
@Controller('api/v1/rider')
export class RiderController {
  constructor(
    private readonly location: RiderLocationService,
    private readonly offers: OfferAcceptanceService,
  ) {}

  /**
   * The rider's current position. No rider id in the path or the body — see
   * `RiderLocationService` for why that is the access control rather than a
   * check inside it.
   */
  @Post('location')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The position was recorded' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider' })
  async updateLocation(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() body: unknown,
  ): Promise<RiderLocationResponse> {
    const input = parseOrThrow(riderLocationRequestSchema, body);
    return this.location.updateLocation(requireRiderId(user), input);
  }

  /** First valid acceptance wins the delivery — DEC-020. A loser sees `OFFER_TAKEN` (409). */
  @Post('offers/:id/accept')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery, now RIDER_ASSIGNED to this rider' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider' })
  @ApiNotFoundResponse({ description: 'Offer not found, or not offered to this rider' })
  @ApiConflictResponse({
    description: 'OFFER_TAKEN, OFFER_EXPIRED, or RIDER_HAS_ACTIVE_DELIVERY',
  })
  async acceptOffer(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderOfferAcceptResponse> {
    return this.offers.acceptOffer(requireUser(user), id);
  }
}

/**
 * The global auth guard already rejects anonymous requests; this exists so the
 * type is non-optional at the call site, matching `OrdersController` and every
 * other controller in this module set.
 */
function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) {
    throw new UnauthorizedException();
  }
  return user;
}

/** The rider identity `@Roles('RIDER')` has already established. */
function requireRiderId(user: AuthenticatedUser | undefined): string {
  const rider = requireUser(user).capabilities.rider;
  if (!rider) {
    throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
  }
  return rider.riderId;
}
