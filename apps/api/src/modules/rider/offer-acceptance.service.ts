import { Injectable, Logger } from '@nestjs/common';
import type { RiderOfferAcceptResponse, RiderOfferDeclineResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import { ACTIVE_DELIVERY_STATES, DISPATCHABLE_DELIVERY_STATES } from './dispatch-policy';

/** `rider_assignment_attempts`, the offer a rider is trying to accept. */
interface OfferRow {
  id: string;
  delivery_id: string;
  rider_id: string;
  outcome: string;
  expires_at: string | null;
}

/** `deliveries`, what the guarded claim returns when it wins. */
interface ClaimedDeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
  order_id: string;
}

/** H-3 locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching `isUniqueViolation`'s own established precedent in this codebase rather than a shared cross-module resolver. */
type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

/** `deliveries`, one delivery a rider is already engaged with. */
interface ActiveDeliveryRow {
  id: string;
  state: string;
}

/** `rider_availability`, the rider-side claim counter. */
interface RiderAvailabilityRow {
  rider_id: string;
  active_delivery_count: number;
}

/**
 * The outcome of trying to take the rider-side one-active-delivery claim.
 *
 * `alreadyHoldsThisDelivery` is not an error: it is how a crash between the
 * claim and the delivery `UPDATE`'s follow-up writes gets repaired on retry.
 */
type RiderClaim = 'claimed' | 'alreadyHoldsThisDelivery' | 'busy';

/**
 * `POST /api/v1/rider/offers/:id/accept` — Phase G-2 (DEC-020, DEC-037).
 * `POST /api/v1/rider/offers/:id/decline` — Phase G-6.2, documented on
 * {@link OfferAcceptanceService.declineOffer} itself.
 *
 * ## Two guarded writes, in this order, and why the order matters
 *
 * 1. **Rider-side claim** — `UPDATE rider_availability SET active_delivery_count = 1
 *    WHERE rider_id = :r AND active_delivery_count = 0`.
 * 2. **Delivery-side claim** — `UPDATE deliveries SET state = 'RIDER_ASSIGNED',
 *    rider_id = :r WHERE id = :d AND state IN ('RIDER_SEARCHING','RIDER_REASSIGNING')
 *    AND rider_id IS NULL`.
 *
 * Both are compare-and-set: the condition lives in the `WHERE` clause and the
 * rowcount alone decides (ADR-003 — never `SELECT`-then-check-then-`UPDATE`).
 * Under `READ COMMITTED`, two statements contending for the *same* row
 * serialise on that row's lock and the loser re-evaluates its `WHERE` against
 * the committed new version and matches nothing. That is what makes (2) decide
 * the two-riders-one-delivery race — the mechanism the schema's own
 * `rider_race_assertions.sql` proves with two concurrent `psql` processes —
 * and it is equally what makes (1) decide the **same-rider-two-deliveries**
 * race, because both attempts contend for that rider's single
 * `rider_availability` row.
 *
 * ⚠️ **Deviation from V1.1 §6's sketch, recorded deliberately.** That sketch
 * puts BQ-021's limit inside the delivery `UPDATE` as
 * `AND NOT EXISTS (SELECT 1 FROM deliveries WHERE rider_id = :r AND state IN (…))`.
 * PostgREST cannot express a subquery in an `UPDATE` filter, so the literal
 * form would need a new `SECURITY INVOKER` function — a migration, which the
 * schema lock forbids and DEC-037 explicitly does not authorise (it also
 * declines DBQ-007's partial unique index for the same reason). The claim on
 * `rider_availability.active_delivery_count` is the equivalent-in-principle
 * guarded write: `docs/DATABASE_DESIGN.md` § 11 already specifies this limit as
 * *"a service-layer check"*, and this is that check expressed as a
 * compare-and-set rather than as a pre-read. It is set to `1`, never
 * incremented, because under DEC-037 the only legal values are 0 and 1 —
 * an increment would drift; a CAS cannot.
 *
 * ## What this service never does
 *
 * No order state, ever: DEC-018 keeps the delivery domain separate, and a rider
 * accepting an offer moves no order. No payment, ledger, refund, reconciliation
 * or settlement row is read or written. No earning is computed —
 * `rider_earning_satang` is not in any statement here and stays `NULL` while
 * BQ-029 is `OPEN`. `release_rider_assignment()` is not called and not
 * reimplemented: release belongs to rider cancellation, a later slice.
 */
@Injectable()
export class OfferAcceptanceService {
  private readonly logger = new Logger(OfferAcceptanceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async acceptOffer(user: AuthenticatedUser, offerId: string): Promise<RiderOfferAcceptResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (`CapabilitiesService.resolveRider` matches only `status = 'APPROVED'`),
    // so approval is settled before this method runs. This narrows the type
    // and fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const offer = await this.readOwnOffer(offerId, riderId);

    // Ownership, liveness and the 60-second window. This read is a validity
    // check, not the concurrency authority: whether the *delivery* is still
    // free, and whether this rider may hold it, are both decided by the two
    // guarded writes below and are never pre-read.
    this.assertOfferIsAcceptable(offer);

    const claim = await this.claimRiderSlot(riderId, offer.delivery_id);

    if (claim === 'busy') {
      throw new DomainError('RIDER_HAS_ACTIVE_DELIVERY', { details: { riderId } });
    }

    if (claim === 'alreadyHoldsThisDelivery') {
      // Crash-window repair (Case B): the delivery is already assigned to this
      // rider, so the assignment row and the offer outcomes are what is
      // missing. Finish the tail and report the success that already happened —
      // re-running the delivery UPDATE would fail on `rider_id IS NULL` and
      // turn a completed accept into a spurious `OFFER_TAKEN`.
      await this.recordAssignment(offer.delivery_id, riderId, offer.id);
      return { deliveryId: offer.delivery_id, state: 'RIDER_ASSIGNED', riderId };
    }

    const delivery = await this.claimDelivery(offer.delivery_id, riderId);

    if (!delivery) {
      // Lost the race, or the delivery moved on. Hand the rider-side claim
      // back, guarded on the value this call itself set, so a slot taken for a
      // delivery that was never won cannot strand the rider.
      await this.releaseRiderSlot(riderId);
      throw new DomainError('OFFER_TAKEN', { details: { deliveryId: offer.delivery_id } });
    }

    await this.recordAssignment(delivery.id, riderId, offer.id);

    // H-3 — RiderAssigned, CUSTOMER + MERCHANT + RIDER. Fires only on THIS
    // branch — the guarded `claimDelivery` UPDATE actually winning — never
    // from the `alreadyHoldsThisDelivery` repair branch above, which reuses
    // an assignment an earlier request already won and notified.
    await this.writeRiderAssignedOutboxEvent(delivery, riderId);

    return { deliveryId: delivery.id, state: delivery.state, riderId };
  }

  /**
   * `POST /api/v1/rider/offers/:id/decline` — Phase G-6.2 (V1.1 §7's
   * `accept|decline` pair). A single guarded `UPDATE` on
   * `rider_assignment_attempts` alone: `PENDING -> DECLINED`, scoped to the
   * caller's own offer. No delivery, order, or money table is read or written
   * — DEC-020's broadcast model means every eligible rider was offered this
   * delivery simultaneously, so one rider declining changes nothing for any
   * other rider's own live offer, and `DispatchService`'s own round logic
   * (state-driven, never outcome-driven — see its header) is untouched.
   *
   * The guarded `UPDATE` is the sole transition authority (ADR-003): ownership
   * (`rider_id`) and the pre-state (`outcome = 'PENDING'`) are both enforced
   * inside its `WHERE` clause. A zero-row result does not by itself say why —
   * {@link readOwnOffer} is reused unchanged for the diagnostic read, which is
   * what already collapses "does not exist" and "belongs to another rider"
   * into the same `NOT_FOUND` `acceptOffer` returns, rather than inventing a
   * new distinction for this endpoint. Whatever `readOwnOffer` returns is by
   * definition owned by this rider and not `PENDING` (the guarded `UPDATE`
   * already ruled that combination out), so the only two live outcomes to
   * classify are `EXPIRED` and everything else already resolved
   * (`ACCEPTED`/`DECLINED`/`SUPERSEDED`) — both map onto the same catalogue
   * codes `assertOfferIsAcceptable` already established: `OFFER_EXPIRED` and
   * `OFFER_TAKEN`. Declining an already-declined offer is therefore a refusal,
   * not an idempotent success — the same "terminal offer states are refusal"
   * convention `acceptOffer` uses for `DECLINED`/`SUPERSEDED`.
   */
  async declineOffer(user: AuthenticatedUser, offerId: string): Promise<RiderOfferDeclineResponse> {
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const declined = await this.claimDecline(offerId, riderId);

    if (!declined) {
      const offer = await this.readOwnOffer(offerId, riderId);
      this.classifyDeclineFailure(offer);
    }

    return { offerId, riderId, outcome: 'DECLINED' };
  }

  /** The guarded UPDATE — ownership and pre-state enforced entirely in the `WHERE` clause. */
  private async claimDecline(offerId: string, riderId: string): Promise<OfferRow | null> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .update({ outcome: 'DECLINED' })
      .eq('id', offerId)
      .eq('rider_id', riderId)
      .eq('outcome', 'PENDING')
      .select('id, delivery_id, rider_id, outcome, expires_at')
      .maybeSingle<OfferRow>();

    if (error) {
      this.logger.error(`Offer decline claim failed for ${offerId} (rider ${riderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Offer decline failed' });
    }

    return data ?? null;
  }

  /**
   * Explains a failed guarded decline. Reached only once {@link readOwnOffer}
   * has already confirmed the offer exists and belongs to this rider, so the
   * only question left is which non-`PENDING` outcome it already settled into.
   */
  private classifyDeclineFailure(offer: OfferRow): never {
    if (offer.outcome === 'EXPIRED') {
      throw new DomainError('OFFER_EXPIRED', { details: { offerId: offer.id } });
    }

    // ACCEPTED, DECLINED, or SUPERSEDED — no longer PENDING, already resolved
    // one way or another. Same grouping `assertOfferIsAcceptable` uses for
    // DECLINED/SUPERSEDED, extended to ACCEPTED for the identical reason: the
    // offer is not live, and OFFER_TAKEN is the catalogue's existing code for
    // "well-formed request, offer no longer available."
    throw new DomainError('OFFER_TAKEN', { details: { offerId: offer.id } });
  }

  /**
   * The offer, scoped to its own rider.
   *
   * `rider_id` is a filter rather than a post-read comparison — the same
   * "ownership is a query filter" discipline `AddressesService` and
   * `OrdersService.customerCancel` already follow. A foreign offer id and a
   * nonexistent one are indistinguishable `NOT_FOUND`, so the endpoint cannot
   * be used to confirm that some other rider was offered a job.
   */
  private async readOwnOffer(offerId: string, riderId: string): Promise<OfferRow> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .select('id, delivery_id, rider_id, outcome, expires_at')
      .eq('id', offerId)
      .eq('rider_id', riderId)
      .maybeSingle<OfferRow>();

    if (error) {
      this.logger.error(`Offer read failed for ${offerId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Offer read failed' });
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Offer not found' });
    }

    return data;
  }

  /**
   * Refuses an offer that is not live.
   *
   * `ACCEPTED` deliberately falls through rather than raising: a rider retrying
   * after a dropped response must be able to complete an accept that already
   * succeeded, and `claimRiderSlot` recognises that case as
   * `alreadyHoldsThisDelivery`.
   */
  private assertOfferIsAcceptable(offer: OfferRow): void {
    if (offer.outcome === 'EXPIRED') {
      throw new DomainError('OFFER_EXPIRED', { details: { offerId: offer.id } });
    }

    if (offer.outcome === 'DECLINED' || offer.outcome === 'SUPERSEDED') {
      throw new DomainError('OFFER_TAKEN', { details: { offerId: offer.id } });
    }

    // The window, per DEC-037 — 60 seconds from `offered_at`, written by
    // `DispatchService`. A missing `expires_at` is treated as closed: the
    // column is nullable in the schema because BQ-020 was open when it was
    // written, and an offer with no window is not one this slice created.
    if (offer.expires_at === null || Date.parse(offer.expires_at) <= Date.now()) {
      throw new DomainError('OFFER_EXPIRED', { details: { offerId: offer.id } });
    }
  }

  /**
   * Takes this rider's single active-delivery slot — BQ-021 via DEC-037.
   *
   * The `WHERE active_delivery_count = 0` is the whole enforcement: two
   * concurrent accepts by the same rider contend for one row and exactly one
   * of them sees a rowcount of 1.
   */
  private async claimRiderSlot(riderId: string, deliveryId: string): Promise<RiderClaim> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 1 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 0)
      .select('rider_id, active_delivery_count')
      .maybeSingle<RiderAvailabilityRow>();

    if (error) {
      this.logger.error(`Rider slot claim failed for ${riderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability claim failed' });
    }

    if (data) {
      return 'claimed';
    }

    return this.diagnoseBusyRider(riderId, deliveryId);
  }

  /**
   * A rider whose slot was already taken: genuinely busy, already holding *this*
   * delivery, or carrying a slot left behind by a crash.
   *
   * Only reached when the guarded claim above matched nothing, so this read
   * never decides a live race — it decides how to *report* one, and whether a
   * repair is owed. The repair itself is another guarded write.
   */
  private async diagnoseBusyRider(riderId: string, deliveryId: string): Promise<RiderClaim> {
    const { data: active, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state')
      .eq('rider_id', riderId)
      .in('state', [...ACTIVE_DELIVERY_STATES])
      .returns<ActiveDeliveryRow[]>();

    if (error) {
      this.logger.error(`Active-delivery read failed for rider ${riderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability check failed' });
    }

    const activeDeliveries = active ?? [];

    if (activeDeliveries.some((row) => row.id === deliveryId)) {
      return 'alreadyHoldsThisDelivery';
    }

    if (activeDeliveries.length > 0) {
      return 'busy';
    }

    // No active delivery, yet the slot is taken: the crash window between the
    // claim and the delivery UPDATE (Case A of this service's own reasoning).
    // Fail-closed by construction — the rider was locked out, never
    // double-assigned — and repaired here on the next attempt, the same
    // "repair the invariant on the retry that discovers it" shape the payment
    // domain and `OrdersService.acceptOrder` already use.
    return this.reclaimOrphanedSlot(riderId);
  }

  /** Clears a slot no delivery accounts for, then retries the claim exactly once. */
  private async reclaimOrphanedSlot(riderId: string): Promise<RiderClaim> {
    const { data: reset, error: resetError } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 0 })
      .eq('rider_id', riderId)
      .gt('active_delivery_count', 0)
      .select('rider_id, active_delivery_count')
      .maybeSingle<RiderAvailabilityRow>();

    if (resetError) {
      this.logger.error(`Orphaned slot reset failed for rider ${riderId}: ${resetError.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability repair failed' });
    }

    if (!reset) {
      // Nothing to reset and nothing claimable: the rider has no
      // `rider_availability` row at all. They could not have been dispatched to
      // (eligibility requires an online row with a location), so this is a
      // broken invariant rather than a rider-facing condition.
      this.logger.error(`Rider ${riderId} has an offer but no rider_availability row`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability missing' });
    }

    this.logger.warn(`Repaired orphaned active_delivery_count for rider ${riderId}`);

    const { data: retried, error: retryError } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 1 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 0)
      .select('rider_id, active_delivery_count')
      .maybeSingle<RiderAvailabilityRow>();

    if (retryError) {
      this.logger.error(`Rider slot re-claim failed for ${riderId}: ${retryError.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability claim failed' });
    }

    // Still nothing means another accept took the repaired slot in between.
    // That rider genuinely is busy now; exactly one of the two won.
    return retried ? 'claimed' : 'busy';
  }

  /** Hands the slot back after a lost delivery race. Guarded on the value this request set. */
  private async releaseRiderSlot(riderId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 0 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 1);

    if (error) {
      // Logged, not thrown: the caller is already reporting `OFFER_TAKEN`, and
      // a stranded slot is repaired by `reclaimOrphanedSlot` on this rider's
      // next accept rather than by masking the real outcome with a 500.
      this.logger.error(`Rider slot release failed for ${riderId}: ${error.message}`);
    }
  }

  /**
   * **The assignment authority** (V1.1 §9, layer 1). `rider_id IS NULL` plus
   * the state list is what makes exactly one of N racing riders win; everyone
   * else gets 0 rows and a clean `OFFER_TAKEN` (409), which the driver app must
   * render as a normal outcome rather than an error.
   */
  private async claimDelivery(deliveryId: string, riderId: string): Promise<ClaimedDeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({
        state: 'RIDER_ASSIGNED',
        rider_id: riderId,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .in('state', [...DISPATCHABLE_DELIVERY_STATES])
      .is('rider_id', null)
      .select('id, state, rider_id, order_id')
      .maybeSingle<ClaimedDeliveryRow>();

    if (error) {
      this.logger.error(`Delivery claim failed for ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery claim failed' });
    }

    return data ?? null;
  }

  /**
   * The tail of a won accept: the claim history row, this offer's outcome, and
   * every sibling offer's outcome.
   *
   * Runs after the delivery is already assigned, so each step is written to be
   * safely repeatable — a crash part-way through leaves the delivery correct
   * (`deliveries.rider_id` is the authority on who is delivering, per the
   * table's own comment) and the next attempt by the same rider re-enters here
   * through `alreadyHoldsThisDelivery`.
   */
  private async recordAssignment(deliveryId: string, riderId: string, offerId: string): Promise<void> {
    const { error: assignmentError } = await this.supabase.admin.from('rider_assignments').insert({
      delivery_id: deliveryId,
      rider_id: riderId,
      status: 'ACCEPTED',
    });

    if (assignmentError && !isUniqueViolation(assignmentError)) {
      this.logger.error(`rider_assignments insert failed for ${deliveryId}: ${assignmentError.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider assignment record failed' });
    }

    if (assignmentError) {
      // `rider_assignments_one_active` refused a second ACCEPTED row for this
      // delivery. On a retry that is exactly right — the row is already there.
      this.logger.debug(`rider_assignments row already present for delivery ${deliveryId}`);
    }

    // This offer's outcome. Guarded on `PENDING` so a retry (already
    // `ACCEPTED`) is a no-op rather than a rewrite of history.
    const { error: offerError } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .update({ outcome: 'ACCEPTED' })
      .eq('id', offerId)
      .eq('outcome', 'PENDING');

    if (offerError) {
      this.logger.error(`Offer outcome update failed for ${offerId}: ${offerError.message}`);
    }

    // Every other rider's offer for this delivery is now moot. `SUPERSEDED` is
    // the schema's own vocabulary for it, and marking it keeps the dispatch
    // audit trail able to answer "why did this offer go nowhere?" without
    // waiting for the window to lapse into `EXPIRED`.
    const { error: siblingError } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .update({ outcome: 'SUPERSEDED' })
      .eq('delivery_id', deliveryId)
      .eq('outcome', 'PENDING')
      .neq('id', offerId);

    if (siblingError) {
      this.logger.error(`Sibling offer supersede failed for delivery ${deliveryId}: ${siblingError.message}`);
    }
  }

  /**
   * H-3 — `RiderAssigned`, CUSTOMER + MERCHANT + RIDER. Reads `orders`/
   * `restaurants`/`merchants`/`riders` directly: this module already reads
   * `deliveries` freely, and the H-3 contract explicitly calls for the
   * order/restaurant/merchant-owner relationship and `deliveries.rider_id`
   * (never `rider_assignments`) as the recipient sources. Never throws — a
   * resolution or write failure is logged and swallowed, matching
   * `releaseRiderSlot`'s own precedent: the assignment has already
   * succeeded and already been reported to the rider, and a lost
   * notification must not turn that into a failed accept.
   */
  private async writeRiderAssignedOutboxEvent(delivery: ClaimedDeliveryRow, riderId: string): Promise<void> {
    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('customer_id, restaurant_id')
      .eq('id', delivery.order_id)
      .maybeSingle<{ customer_id: string; restaurant_id: string }>();

    if (orderError || !order) {
      this.logger.error(
        `RiderAssigned recipient resolution: orders read failed for delivery ${delivery.id}: ${orderError?.message ?? 'not found'}`,
      );
      return;
    }

    const recipients: OutboxRecipient[] = [{ recipientId: order.customer_id, recipientType: 'CUSTOMER' }];

    const merchantOwnerId = await this.resolveMerchantOwnerId(order.restaurant_id);
    if (merchantOwnerId) {
      recipients.push({ recipientId: merchantOwnerId, recipientType: 'MERCHANT' });
    }

    const riderProfileId = await this.resolveRiderProfileId(riderId);
    if (riderProfileId) {
      recipients.push({ recipientId: riderProfileId, recipientType: 'RIDER' });
    }

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: 'delivery',
      aggregate_id: delivery.id,
      event_type: 'RiderAssigned',
      payload: { recipients },
    });

    if (error) {
      this.logger.error(`outbox insert failed for RiderAssigned (delivery ${delivery.id}): ${error.message}`);
    }
  }

  /** `restaurants.merchant_id -> merchants.owner_user_id`. */
  private async resolveMerchantOwnerId(restaurantId: string): Promise<string | null> {
    const { data: restaurant, error: restaurantError } = await this.supabase.admin
      .from('restaurants')
      .select('merchant_id')
      .eq('id', restaurantId)
      .maybeSingle<{ merchant_id: string }>();

    if (restaurantError || !restaurant) {
      this.logger.error(
        `Merchant-owner resolution: restaurants read failed for ${restaurantId}: ${restaurantError?.message ?? 'not found'}`,
      );
      return null;
    }

    const { data: merchant, error: merchantError } = await this.supabase.admin
      .from('merchants')
      .select('owner_user_id')
      .eq('id', restaurant.merchant_id)
      .maybeSingle<{ owner_user_id: string }>();

    if (merchantError || !merchant) {
      this.logger.error(
        `Merchant-owner resolution: merchants read failed for restaurant ${restaurantId}: ${merchantError?.message ?? 'not found'}`,
      );
      return null;
    }

    return merchant.owner_user_id;
  }

  /** `riders.id -> riders.user_id` — the rider's own profile id, for the RIDER recipient. */
  private async resolveRiderProfileId(riderId: string): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('riders')
      .select('user_id')
      .eq('id', riderId)
      .maybeSingle<{ user_id: string }>();

    if (error || !data) {
      this.logger.error(`Rider-profile resolution failed for rider ${riderId}: ${error?.message ?? 'not found'}`);
      return null;
    }

    return data.user_id;
  }
}

/** Same shape as the order and payment domains' own helper — `23505`, however it surfaces. */
function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
