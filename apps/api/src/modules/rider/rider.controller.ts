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
  riderDeliveredRequestSchema,
  riderLocationRequestSchema,
  riderProofUploadUrlRequestSchema,
  type RiderArrivedAtCustomerResponse,
  type RiderArrivedResponse,
  type RiderCancelDeliveryResponse,
  type RiderContactAttemptResponse,
  type RiderDeliveredResponse,
  type RiderEnRouteResponse,
  type RiderLocationResponse,
  type RiderOfferAcceptResponse,
  type RiderOfferDeclineResponse,
  type RiderPickedUpResponse,
  type RiderProofUploadUrlResponse,
} from '@banhao/validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseOrThrow } from '../../common/validation/parse';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DeliveryCompletionService } from './delivery-completion.service';
import { DeliveryContactAttemptService } from './delivery-contact-attempt.service';
import { DeliveryCustomerArrivalService } from './delivery-customer-arrival.service';
import { DeliveryEnRouteService } from './delivery-en-route.service';
import { DeliveryProofService } from './delivery-proof.service';
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
    private readonly customerArrivals: DeliveryCustomerArrivalService,
    private readonly contactAttempts: DeliveryContactAttemptService,
    private readonly pickups: DeliveryPickupService,
    private readonly departures: DeliveryEnRouteService,
    private readonly completions: DeliveryCompletionService,
    private readonly proofs: DeliveryProofService,
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
   * The rider reaches the **customer's** delivery location — BQ-017 Slice #1,
   * DEC-054. `EN_ROUTE -> ARRIVED` on the delivery. The order is not touched
   * and stays `DELIVERING` (DEC-018).
   *
   * **Distinct from `deliveries/:id/arrived` above, permanently.** That route
   * is *merchant* arrival (`RIDER_ASSIGNED -> AT_MERCHANT`) and keeps exactly
   * its current semantics; DEC-054 forbids reusing it as the customer-arrival
   * anchor, because it fires before pickup, at the wrong end of the journey.
   * The path segment says `arrived-at-customer` rather than `arrived` for the
   * same reason the two are separate services: neither may be mistaken for,
   * or aliased to, the other.
   *
   * The transition stamps `deliveries.arrived_at`, which DEC-054 makes the
   * authoritative anchor for DEC-053's five-minute wait. **That timer is not
   * implemented**, and neither is the failure path it leads to — this route
   * records an operational fact and nothing else.
   *
   * Tapping arrival is **not** a precondition of completing a delivery:
   * `deliveries/:id/delivered` still accepts `EN_ROUTE`, so a rider who never
   * taps it is not blocked. Making arrival mandatory would be a policy neither
   * DEC-053 nor DEC-054 states.
   */
  @Post('deliveries/:id/arrived-at-customer')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery, now ARRIVED at the customer' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — the delivery is not currently EN_ROUTE' })
  async markArrivedAtCustomer(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderArrivedAtCustomerResponse> {
    return this.customerArrivals.arriveAtCustomer(requireUser(user), id);
  }

  /**
   * The rider records an attempt to reach the customer at the door — BQ-017
   * Slice #2, DEC-053 § 3. One append-only evidence row, at most two per
   * delivery.
   *
   * **This endpoint declares nothing.** It does not fail the delivery, mark
   * the customer unreachable, choose a cause, touch the order, or start any
   * timer. DEC-053 § 2 makes the **operator** the failure authority, precisely
   * so that a rider never determines a financial outcome; recording the second
   * attempt satisfies one of the operator's preconditions and resolves
   * nothing. The failure command is
   * `POST /api/v1/admin/supervisor/deliveries/:id/fail`, and no rider route
   * reaches it.
   *
   * No request body: the delivery comes from the route, the rider from the
   * verified JWT, and the timestamp from the server — a client-supplied
   * `attemptedAt` would let evidence an operator relies on be backdated.
   *
   * Only valid while the delivery is `ARRIVED` (DEC-054): an attempt before
   * the rider reached the customer would be evidence of nothing.
   */
  @Post('deliveries/:id/contact-attempt')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The attempt was recorded, with the running count' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery not found' })
  @ApiConflictResponse({
    description:
      'INVALID_TRANSITION — the delivery is not currently ARRIVED. ' +
      'CONFLICT — this delivery already has the maximum of 2 recorded attempts (DEC-053 § 3)',
  })
  async recordContactAttempt(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
  ): Promise<RiderContactAttemptResponse> {
    return this.contactAttempts.recordContactAttempt(requireUser(user), id);
  }

  /**
   * Presigns a `PUT` for one proof photo — POD, Phase G-7.2 Phase 2.
   *
   * Authorized to the assigned rider of a delivery that is currently
   * `EN_ROUTE`, so a presign is never issued for a delivery the rider is not
   * on or has already closed. The object key is **server-templated** and
   * returned to the client; the client never supplies one.
   *
   * The photo lands in the **private** R2 bucket (`R2_PRIVATE_BUCKET`), which
   * has no public base URL — see `StorageService`'s `BucketKind`.
   *
   * There is deliberately no matching `complete` route the way M-11 and M-12
   * have one: the completion is `deliveries/:id/delivered` below, which
   * persists the key in the same guarded UPDATE that moves the state.
   */
  @Post('deliveries/:id/proof/upload-url')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'A presigned R2 upload URL and the object key it is scoped to' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiConflictResponse({ description: 'INVALID_TRANSITION — the delivery is not EN_ROUTE' })
  async requestProofUploadUrl(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RiderProofUploadUrlResponse> {
    const input = parseOrThrow(riderProofUploadUrlRequestSchema, body);
    return this.proofs.requestUploadUrl(requireUser(user), id, input.contentType);
  }

  /**
   * The rider completes the delivery — Phase G-7.2, the terminal transition.
   * `EN_ROUTE -> DELIVERED` on the delivery, and — only once that has
   * genuinely happened — `DELIVERING -> DELIVERED` on the order, via the
   * existing, unmodified `OrdersService.completeDelivery`.
   *
   * Unlike the three transitions above, this one also **gives back** what
   * accept took: the `rider_assignments` row is closed `COMPLETED` and
   * `rider_availability.active_delivery_count` is released `1 -> 0`, so the
   * rider can be offered work again. See `DeliveryCompletionService` for why
   * `release_rider_assignment()` is deliberately not used for that.
   *
   * **The proof photo is required** (DEC-038, resolving BQ-018 as mandatory).
   * `objectKey` is the key returned by the presign route above; the server
   * re-parses it against this delivery and requires the object to genuinely
   * exist before any state moves.
   */
  @Post('deliveries/:id/delivered')
  @HttpCode(200)
  @Roles('RIDER')
  @ApiOkResponse({ description: 'The delivery and the order, both now DELIVERED' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Not an approved rider, or not the rider currently assigned to this delivery' })
  @ApiNotFoundResponse({ description: 'Delivery or order not found' })
  @ApiConflictResponse({
    description: 'INVALID_TRANSITION — the delivery is not EN_ROUTE, or the order is not DELIVERING',
  })
  async markDelivered(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RiderDeliveredResponse> {
    const input = parseOrThrow(riderDeliveredRequestSchema, body);
    return this.completions.complete(requireUser(user), id, input.objectKey);
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
