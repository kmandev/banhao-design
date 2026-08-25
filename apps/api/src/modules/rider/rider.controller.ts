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
  riderCancelDeliveryRequestSchema,
  riderLocationRequestSchema,
  type RiderArrivedResponse,
  type RiderCancelDeliveryResponse,
  type RiderEnRouteResponse,
  type RiderLocationResponse,
  type RiderOfferAcceptResponse,
  type RiderOfferDeclineResponse,
  type RiderPickedUpResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DeliveryEnRouteService } from './delivery-en-route.service';
import { DeliveryPickupService } from './delivery-pickup.service';
import { DeliveryReleaseService } from './delivery-release.service';
import { OfferAcceptanceService } from './offer-acceptance.service';
import { RiderLocationService } from './rider-location.service';

/**
 * The rider surface — Phase G-2 (DEC-020 broadcast dispatch, DEC-037's
 * parameters) plus Phase G-3 (DEC-021 rider cancel/release). Three routes, all
 * commands rather than `PATCH { … }` (ADR-009), all under the `/api/v1` base
 * V1.1 §6 fixes.
 *
 * `@Roles('RIDER')` is the approval gate: `CapabilitiesService` resolves
 * `capabilities.rider` only for `riders.status = 'APPROVED'`, so a pending,
 * suspended or deactivated rider is refused here with `403 FORBIDDEN` before
 * any service runs — which is why no service re-checks approval and why
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
    private readonly releases: DeliveryReleaseService,
    private readonly arrivals: DeliveryArrivalService,
    private readonly pickups: DeliveryPickupService,
    private readonly departures: DeliveryEnRouteService,
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

  /**
   * A rider declines their own offer — Phase G-6.2 (V1.1 §7's `accept|decline`
   * pair). Single-row, single-domain: only `rider_assignment_attempts` moves,
   * never the delivery, the order, or any money table. See
   * `OfferAcceptanceService.declineOffer` for why the broadcast model (DEC-020)
   * makes this safe to do without touching dispatch state.
   */
  @Post('offers/:id/decline')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The offer, now DECLINED' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider' })
  @ApiNotFoundResponse({ description: 'Offer not found, or not offered to this rider' })
  @ApiConflictResponse({ description: 'OFFER_TAKEN or OFFER_EXPIRED — the offer is no longer PENDING' })
  async declineOffer(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderOfferDeclineResponse> {
    return this.offers.declineOffer(requireUser(user), id);
  }

  /**
   * A rider marks that they have reached the merchant for a delivery already
   * assigned to them — Phase G-4. Delivery-domain only (DEC-018): no order,
   * payment, or assignment-authority table is touched.
   */
  @Post('deliveries/:id/arrived')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery, now AT_MERCHANT' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — the delivery is not currently RIDER_ASSIGNED' })
  async markArrived(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderArrivedResponse> {
    return this.arrivals.arrive(requireUser(user), id);
  }

  /**
   * The order ↔ delivery join point — Phase G-5. `AT_MERCHANT -> PICKED_UP`
   * on the delivery, and — only once that has genuinely happened —
   * `READY_FOR_PICKUP -> PICKED_UP` on the order, via the existing,
   * unmodified `OrdersService.pickupOrder`.
   */
  @Post('deliveries/:id/picked-up')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery and the order, both now PICKED_UP' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery or order not found' })
  @ApiConflictResponse({
    description: 'INVALID_TRANSITION — the delivery is not AT_MERCHANT, or the order is not READY_FOR_PICKUP',
  })
  async markPickedUp(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderPickedUpResponse> {
    return this.pickups.pickup(requireUser(user), id);
  }

  /**
   * The rider departs the merchant — Phase G-6. `PICKED_UP -> EN_ROUTE` on the
   * delivery, and — only once that has genuinely happened — `PICKED_UP ->
   * DELIVERING` on the order, via the existing, unmodified
   * `OrdersService.startDelivery`.
   *
   * The path segment is `en-route` because `EN_ROUTE` is the delivery domain's
   * own accepted state name (V1.1 §7's side-effect column, `RIDER_LIFECYCLE.md`
   * §4) and every other route in this controller is named for the delivery
   * state it produces. The order's name for the same step is `DELIVERING`; both
   * are in the response.
   */
  @Post('deliveries/:id/en-route')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery now EN_ROUTE, and the order now DELIVERING' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery or order not found' })
  @ApiConflictResponse({
    description: 'INVALID_TRANSITION — the delivery is not PICKED_UP, or the order is not PICKED_UP',
  })
  async markEnRoute(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderEnRouteResponse> {
    return this.departures.startDelivery(requireUser(user), id);
  }

  /**
   * A rider releases the delivery currently assigned to them — DEC-021. The
   * order is never touched (DEC-018); the delivery goes back to
   * `RIDER_SEARCHING` so the existing dispatch tick can offer it again.
   */
  @Post('deliveries/:id/cancel')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery, released back to RIDER_SEARCHING' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  @ApiConflictResponse({ description: 'NOT_RELEASABLE' })
  async cancelDelivery(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RiderCancelDeliveryResponse> {
    const input = parseOrThrow(riderCancelDeliveryRequestSchema, body ?? {});
    return this.releases.cancelDelivery(requireUser(user), id, input.reason);
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
