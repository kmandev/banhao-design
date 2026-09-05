import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderDeliveredResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';
import { OrdersService } from '../orders/orders.service';
import { StorageService } from '../storage/storage.service';
import { parseDeliveryProofObjectKey } from '../storage/object-key';
import { resolveRiderEarningSatang } from './rider-earning-pricing';

/** `deliveries`, what the guarded UPDATE returns on a match, and the diagnostic read's own shape. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
  order_id: string;
  delivered_at: string | null;
  proof_photo_path: string | null;
  rider_earning_satang: number | null;
}

/** `orders`, the single column the order-side diagnostic read needs. */
interface OrderStateRow {
  state: string;
}

/** H-3 locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching `isUniqueViolation`'s own established precedent in this codebase rather than a shared cross-module resolver. */
type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

/** `rider_availability`, the two columns the slot CAS reads back. */
interface RiderAvailabilityRow {
  rider_id: string;
  active_delivery_count: number;
}

/**
 * The server-side ceiling on a proof photo's actual R2 object size — G7.4,
 * `docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md` §7.4/§9/§16, which records
 * that "no limit exists anywhere today" server-side and recommends enforcing
 * one by rejecting oversized objects at `HeadObject` time.
 *
 * Matches `PROOF_PHOTO_MAX_BYTES` in `apps/driver/src/lib/proofPhoto.ts`
 * exactly — same 2 MB ceiling, not a new number. The two constants cannot
 * share a definition (separate apps, no shared package for it), so this one
 * is the security boundary and the driver one is a client-side backstop that
 * protects nobody who skips it, per that file's own comment.
 */
const PROOF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * `POST /api/v1/rider/deliveries/:id/delivered` — Phase G-7.2, the **terminal**
 * rider transition. `EN_ROUTE -> DELIVERED` on `deliveries`, and — only once
 * that has genuinely happened — `DELIVERING -> DELIVERED` on `orders`.
 *
 * V1.1 §7 records this transition as *actor Rider, validation "is
 * `DELIVERING`", terminal success*; `docs/RIDER_LIFECYCLE.md` §4 names the
 * delivery half (`EN_ROUTE --> DELIVERED`). Both names are `DELIVERED`, so
 * unlike G-6 this step needs no two-field response.
 *
 * Structurally this is {@link DeliveryEnRouteService}'s shape with a longer
 * tail. Everything that makes that service correct is preserved verbatim: the
 * guarded conditional UPDATE as sole authority (ADR-003), the winner-only
 * history row, the diagnose-only-after-the-authority-has-spoken repair path.
 * What is new is that **completion releases resources departure did not** —
 * see "The tail" below.
 *
 * ## Reused, not reimplemented
 *
 * The order-side half is `OrdersService.completeDelivery` — already written
 * for Phase E-4.1, already a guarded UPDATE (`DELIVERING -> DELIVERED`,
 * writing `orders.delivered_at`) with its own `order_status_history` write and
 * its own error mapping. Until this slice it had **no caller anywhere in the
 * API**, exactly the state `pickupOrder` was in before G-5 and `startDelivery`
 * before G-6. This service is that wiring; `OrdersService` is not modified and
 * no second order-completion implementation is introduced.
 *
 * ## Five writes, in this order, and why the order matters
 *
 * 1. **The delivery claim** — `UPDATE deliveries SET state = 'DELIVERED',
 *    delivered_at = now() WHERE id = :id AND state = 'EN_ROUTE' AND
 *    rider_id = :riderId`. Ownership and the pre-state are both enforced
 *    inside the `WHERE` clause, never decided by a prior `SELECT` (ADR-003).
 *    This is the **sole** authority for the delivery transition: exactly one
 *    of N concurrent calls matches, the losers affect zero rows, and
 *    {@link repairCompletion} only ever explains a loss that already happened.
 * 2. **The delivery's own history row** — written by the guarded-UPDATE
 *    *winner only*, immediately, before anything else can fail.
 * 3. **The assignment close** — `rider_assignments` `ACCEPTED -> COMPLETED`.
 * 4. **The rider's slot release** — `rider_availability.active_delivery_count`
 *    `1 -> 0`, guarded CAS.
 * 5. **The order transition** — `OrdersService.completeDelivery`.
 *
 * ## The tail, and why steps 3 and 4 exist at all
 *
 * `OfferAcceptanceService.claimRiderSlot` takes the rider's single
 * active-delivery slot on accept (`UPDATE rider_availability SET
 * active_delivery_count = 1 WHERE rider_id = :r AND active_delivery_count = 0`
 * — BQ-021 via DEC-037) and `recordAssignment` inserts the `rider_assignments`
 * row as `ACCEPTED`. Before this service existed, **only cancellation ever
 * gave either back**: `DeliveryReleaseService` releases the slot and
 * `release_rider_assignment()` closes the row, and both are reachable only
 * from `RIDER_ASSIGNED`/`RIDER_REASSIGNING`. A delivery that ran to completion
 * therefore left the slot at 1 and the assignment `ACCEPTED` forever.
 *
 * **What that actually costs, stated precisely.** It is not a permanent
 * lockout — `OfferAcceptanceService.diagnoseBusyRider` reads the rider's
 * deliveries in `ACTIVE_DELIVERY_STATES`, finds none (`DELIVERED` is terminal
 * and not in that list), and `reclaimOrphanedSlot` resets the count and
 * retries the claim, so the *next* accept self-heals. The real costs are that
 * every post-completion accept pays an extra three round trips through a
 * repair path meant for crash recovery; that `rider_availability` misreports
 * the rider as busy to every other reader in between; and that
 * `rider_assignments` — the claim history, and the table
 * `rider_assignments_one_active` indexes — never records that the delivery was
 * completed rather than abandoned. Steps 3 and 4 close all three at the moment
 * they become true.
 *
 * **Not `release_rider_assignment()`.** That RPC is deliberately unusable
 * here: it accepts only `p_status in ('CANCELLED', 'RELEASED')` and only from
 * `state in ('RIDER_ASSIGNED', 'RIDER_REASSIGNING')`, and it *nulls*
 * `deliveries.rider_id` and bumps `reassignment_count` — all correct for
 * DEC-021's reassignment and all wrong for a completion, which must keep
 * `rider_id` as the record of who delivered. Step 3 is a plain guarded UPDATE
 * for that reason, not because the RPC was overlooked. Widening the RPC would
 * be a migration against a locked schema for no gain.
 *
 * ## The partial-failure repair path
 *
 * **Deliberately not one transaction** (no cross-domain RPC exists, and the
 * schema is locked), so any of steps 2–5 can fail after step 1 has committed.
 * {@link repairCompletion} closes that exactly as
 * `DeliveryEnRouteService.repairEnRoute` does — *"the delivery already
 * reflects this call's effect; finish the tail and report the success that
 * already happened"* — with one deliberate extension: because this
 * transition's tail is **four** steps rather than one, the repair path re-runs
 * steps 3, 4 and 5, not just the order half. Every one of them is a guarded
 * write that is a no-op once already applied, so re-running them cannot
 * double-apply anything.
 *
 * The repair path **never writes `delivery_status_history`**. It does not need
 * to: step 2 already wrote it, in the same request that made the delivery
 * `DELIVERED`, and only the guarded-UPDATE winner ever reaches step 2. That is
 * what makes "exactly one history row" a structural property rather than a
 * check-then-insert race — `delivery_status_history` carries **no** unique
 * constraint (migration `20260811000009`), so an existence-check-then-insert
 * heal would be genuinely race-prone under two concurrent retries. Not writing
 * is the only duplicate-free answer available without a migration.
 *
 * ## What this service never does
 *
 * It never writes `order_status_history` — that stays inside
 * `OrdersService.completeDelivery`, which this service does not modify. It
 * never forces an order out of a state its own guarded UPDATE refuses. It
 * never nulls `deliveries.rider_id` (that is reassignment, not completion) and
 * never touches `reassignment_count`.
 *
 * No payment, refund, reconciliation or settlement row is read or written.
 * No `rider_assignment_attempts` write — a completed delivery's offers were
 * already resolved at accept time.
 *
 * ## Rider earning — DEC-044
 *
 * `claimCompletion`'s own guarded UPDATE now also snapshots
 * `rider_earning_satang` (DEC-044 — flat ฿12, 1200 satang), in the **same**
 * statement as the state transition — the identical atomicity reasoning this
 * file already applies to `proof_photo_path`: no window in which a delivery
 * is `DELIVERED` with a null earning, and no second write a retry could use
 * to change it. `resolveRiderEarningSatang()` is called exactly once, by the
 * guarded-UPDATE winner; the repair path never calls it again and never
 * touches the column — it only reads back whatever the winner already wrote,
 * which is what makes the snapshot stable against a future configurable rate
 * (see that function's own doc comment).
 *
 * {@link postRiderEarningLedger}, run from {@link finishTail} on both the
 * winner and repair paths, posts exactly one `RIDER_PAYABLE` ledger entry —
 * `BANHAO owes rider ฿12` — anchored on `rider-earning:<deliveryId>` via
 * `ledger_entry_groups.group_key`'s existing unique constraint, matching
 * `PaymentEventProcessingService.postCommissionLedger`'s established
 * insert-then-self-heal-on-conflict pattern (DEC-043). **This group does not
 * sum to zero on its own** — see that method's own doc comment for why, and
 * do not "fix" that by inventing a matching entry.
 *
 * ## The proof photo (POD, Phase 2)
 *
 * `objectKey` is **required** — DEC-038, resolving BQ-018 as mandatory. With COD disabled (DEC-016) the photo is the only evidence a
 * handover happened, and this endpoint is where that rule lives, not the
 * client. A rider who genuinely cannot photograph has no completion path at
 * all (DEC-038): the driver app directs them to an operator and the delivery
 * stays open.
 *
 * The photo is verified before the state machine is touched
 * ({@link assertProofUploaded}) and persisted in the same guarded UPDATE that
 * moves the state ({@link claimCompletion}), so there is no window in which a
 * delivery is `DELIVERED` with a null path, and no second write a retry could
 * use to replace evidence.
 */
@Injectable()
export class DeliveryCompletionService {
  private readonly logger = new Logger(DeliveryCompletionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}

  async complete(
    user: AuthenticatedUser,
    deliveryId: string,
    objectKey: string,
  ): Promise<RiderDeliveredResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    // The proof is verified BEFORE the state machine is touched, so a
    // fabricated, foreign, or never-uploaded key moves nothing. See
    // {@link assertProofUploaded}.
    await this.assertProofUploaded(deliveryId, objectKey);

    const delivery = await this.claimCompletion(deliveryId, riderId, objectKey);

    if (!delivery) {
      // Lost the guarded UPDATE, or the delivery is not in a completable
      // state. Either it is repairable (already DELIVERED and still ours —
      // finish the tail) or it is a genuine refusal.
      return this.repairCompletion(user, deliveryId, riderId);
    }

    // The delivery has genuinely moved to DELIVERED, and this request is the
    // one that moved it. Record that fact before anything else can fail —
    // see this file's header on why the history row leads the rest.
    await this.writeHistory(deliveryId, riderId);

    // Everything from here is "finish the tail", never "decide whether the
    // delivery transition happened".
    await this.finishTail(user, delivery, riderId);

    // H-3 — OrderDelivered, CUSTOMER + MERCHANT. Fires only on this branch —
    // the guarded `claimCompletion` UPDATE actually winning — never from
    // `repairCompletion`, which finishes the tail for a delivery an earlier
    // request already moved (and already notified).
    await this.writeOrderDeliveredOutboxEvent(delivery);

    return this.response(delivery, riderId);
  }

  /**
   * The repair path: reached only when the guarded UPDATE matched no row.
   * Diagnoses why, and — for the one case that is a genuine partial failure
   * rather than a refusal — finishes the tail an earlier request left undone.
   *
   * Ownership is re-established here from `deliveries.rider_id` exactly as on
   * the primary path; a delivery that is `DELIVERED` but belongs to someone
   * else is still `NOT_ASSIGNED_RIDER`, never repairable by this caller. That
   * is what makes a completion by one rider incapable of affecting another's
   * assignment or slot.
   *
   * Only `DELIVERED` is repairable. A delivery still `EN_ROUTE` cannot reach
   * here (the guarded UPDATE would have matched it); one still `AT_MERCHANT`,
   * `PICKED_UP` or `RIDER_ASSIGNED` has not reached this transition yet; and
   * one that is `FAILED` or `ABANDONED` ended a different way — all stay
   * `INVALID_TRANSITION`, because re-driving the order from any of them would
   * be inventing a transition.
   */
  private async repairCompletion(
    user: AuthenticatedUser,
    deliveryId: string,
    riderId: string,
  ): Promise<RiderDeliveredResponse> {
    const delivery = await this.readDelivery(deliveryId);

    if (!delivery) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    if (delivery.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    if (delivery.state !== 'DELIVERED') {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId, from: delivery.state, to: 'DELIVERED' },
      });
    }

    this.logger.warn(
      `Repairing completion for delivery ${deliveryId} (rider ${riderId}): delivery is already DELIVERED, ` +
        `re-running the tail (assignment close, slot release, order ${delivery.order_id})`,
    );

    // No history write on this path — the request that moved the delivery
    // already wrote it. See this file's header.
    await this.finishTail(user, delivery, riderId);

    return this.response(delivery, riderId);
  }

  /**
   * Steps 3–6, in order, run identically by the winner and by a repair.
   *
   * Every step is a guarded write that is a no-op once already applied, which
   * is precisely what lets the repair path re-run all of them rather than
   * having to work out which of them an earlier request got to before it died.
   */
  private async finishTail(
    user: AuthenticatedUser,
    delivery: DeliveryRow,
    riderId: string,
  ): Promise<void> {
    await this.closeAssignment(delivery.id, riderId);
    await this.releaseRiderSlot(riderId, delivery.id);
    await this.postRiderEarningLedger(delivery, riderId);
    await this.advanceOrder(user, delivery.order_id, delivery.id, riderId);
  }

  /**
   * Proves a real proof photo exists at a key that could only belong to
   * **this** delivery — POD, Phase G-7.2 Phase 2.
   *
   * Two independent checks, the pair `MenuItemImageService.completeUpload`
   * already relies on, because this key (like a menu item's) carries a
   * server-generated random UUID that nothing observable here can recompute:
   *
   * 1. **Structure** — `parseDeliveryProofObjectKey` demands the exact
   *    documented shape for this authorized delivery id. A key minted for
   *    another delivery, a traversal attempt, an unsupported extension and a
   *    garbled string all fail identically.
   * 2. **Existence** — `StorageService.exists()` against the **private**
   *    bucket. A presigned URL merely *authorizes* a PUT; issuing one is not
   *    proof one happened, so nothing is written until real bytes are there.
   *
   * Structure narrows what shape of key can matter; existence proves one was
   * actually used. Together they replace M-11's recompute-and-compare, which
   * is unavailable here by construction.
   *
   * A third check follows existence: the object's actual size, from R2's own
   * `ContentLength` — never the client's declared size — must not exceed
   * {@link PROOF_PHOTO_MAX_BYTES}. See {@link assertProofSizeWithinLimit}.
   *
   * **Runs before the guarded UPDATE**, deliberately: the POD design's
   * acceptance criterion 11 requires that a structurally invalid key, a key
   * for another delivery, and a key with no object behind it are all refused
   * and **none of them moves any state**. Verifying after the claim would
   * leave a delivery `DELIVERED` with a rejected photo — and the same is true
   * of an oversized one.
   */
  private async assertProofUploaded(deliveryId: string, objectKey: string): Promise<void> {
    const parsed = parseDeliveryProofObjectKey(objectKey, deliveryId);
    if (!parsed) {
      // Deliberately generic — see `parseDeliveryProofObjectKey`'s own note on
      // why every rejection reason gets the same answer.
      throw new DomainError('VALIDATION_FAILED', {
        message: 'objectKey is not a valid proof photo key for this delivery',
        details: { objectKey: ['does not match the expected key shape for this delivery'] },
      });
    }

    let uploaded: boolean;
    try {
      uploaded = await this.storage.exists(objectKey, 'private');
    } catch (cause) {
      // A transport or configuration failure must never read as "no photo" —
      // that would refuse a rider who genuinely uploaded one.
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`Proof photo existence check failed for delivery ${deliveryId}: ${message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Proof photo verification failed' });
    }

    if (!uploaded) {
      throw new DomainError('NOT_FOUND', {
        message: 'No proof photo was found at the expected key — upload it before confirming',
      });
    }

    await this.assertProofSizeWithinLimit(deliveryId, objectKey);
  }

  /**
   * The size half of {@link assertProofUploaded} — G7.4. Reads the object's
   * real `ContentLength` from R2 via `StorageService.getObjectSize` and
   * refuses anything over {@link PROOF_PHOTO_MAX_BYTES}. The client's own
   * declared size (or the client-side check in `apps/driver/src/lib/proofPhoto.ts`)
   * is never consulted — only what R2 itself reports for the object already
   * confirmed to exist.
   *
   * Fails closed on a lookup failure, exactly as {@link assertProofUploaded}
   * does for existence: a transport error, a missing `ContentLength`, or the
   * object having vanished between the `exists()` call and this one must never
   * read as "small enough". None of those raw causes reaches the caller — only
   * the generic `INTERNAL_ERROR` `DomainError`, matching this file's existing
   * convention of never exposing a raw storage-provider error.
   */
  private async assertProofSizeWithinLimit(deliveryId: string, objectKey: string): Promise<void> {
    let sizeBytes: number;
    try {
      sizeBytes = await this.storage.getObjectSize(objectKey, 'private');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.logger.error(`Proof photo size check failed for delivery ${deliveryId}: ${message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Proof photo verification failed' });
    }

    if (sizeBytes > PROOF_PHOTO_MAX_BYTES) {
      throw new DomainError('VALIDATION_FAILED', {
        message: 'Proof photo exceeds the maximum allowed size',
        details: { objectKey: [`must be ${PROOF_PHOTO_MAX_BYTES} bytes or fewer`] },
      });
    }
  }

  /**
   * The guarded UPDATE — ownership and pre-state enforced entirely in the
   * `WHERE` clause.
   *
   * `proof_photo_path` is written **in this same statement**, not a separate
   * one. That is what makes the photo and the completion atomic: there is no
   * moment where the delivery is `DELIVERED` with a null path, and no second
   * write that a retry could use to replace evidence. The `state = 'EN_ROUTE'`
   * guard is also what makes the path effectively write-once — a second call
   * matches zero rows and never reaches the write. Note honestly that the
   * *database* does not enforce this: `deliveries` carries no
   * column-immutability trigger (deliberately — `state` and `rider_id` must
   * advance freely), so this is an application rule (POD-Q-07).
   */
  private async claimCompletion(
    deliveryId: string,
    riderId: string,
    objectKey: string,
  ): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({
        state: 'DELIVERED',
        delivered_at: new Date().toISOString(),
        proof_photo_path: objectKey,
        // DEC-044 — snapshotted in this same statement, for the identical
        // reason proof_photo_path is: no window where the delivery is
        // DELIVERED with no earning recorded, and no second write a retry
        // could use to change it. See this file's own "Rider earning" doc
        // section above.
        rider_earning_satang: resolveRiderEarningSatang(),
      })
      .eq('id', deliveryId)
      .eq('state', 'EN_ROUTE')
      .eq('rider_id', riderId)
      .select('id, state, rider_id, order_id, delivered_at, proof_photo_path, rider_earning_satang')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(
        `Completion claim failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Completion transition failed' });
    }

    return data ?? null;
  }

  /**
   * The delivery, read for diagnosis only — never to decide a transition
   * (ADR-003). Reached only after the guarded UPDATE has already matched
   * nothing, so this read can explain a loss but can never cause one.
   */
  private async readDelivery(deliveryId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id, order_id, delivered_at, proof_photo_path, rider_earning_satang')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Completion diagnosis read failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Completion transition failed' });
    }

    return data ?? null;
  }

  /**
   * Step 3 — `rider_assignments` `ACCEPTED -> COMPLETED` for **this** rider's
   * claim on **this** delivery.
   *
   * Matched on `delivery_id` AND `rider_id` AND `status = 'ACCEPTED'`, never
   * on `delivery_id` alone — the same discipline `release_rider_assignment()`
   * applies for the same reason: matching more loosely could cross-close a row
   * that is not this call's to close.
   *
   * `'COMPLETED'` is the schema's own vocabulary (`rider_assignments.status`'s
   * CHECK admits `ACCEPTED`, `CANCELLED`, `RELEASED`, `COMPLETED`); nothing is
   * invented here. This is also the write that lets the delivery stop holding
   * `rider_assignments_one_active`.
   *
   * **Zero rows is a success, not a failure.** On a retry the row is already
   * `COMPLETED`, so the guard matches nothing — that is the idempotency, not
   * an error. A genuinely missing `ACCEPTED` row cannot be distinguished from
   * an already-closed one without a second read, and the difference does not
   * change what this method should do, so it is logged at debug and the
   * completion proceeds.
   */
  private async closeAssignment(deliveryId: string, riderId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignments')
      .update({ status: 'COMPLETED', closed_at: new Date().toISOString(), close_reason: 'DELIVERED' })
      .eq('delivery_id', deliveryId)
      .eq('rider_id', riderId)
      .eq('status', 'ACCEPTED')
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) {
      this.logger.error(
        `rider_assignments close failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider assignment close failed' });
    }

    if (!data) {
      this.logger.debug(
        `No ACCEPTED rider_assignments row to close for delivery ${deliveryId} (rider ${riderId}) — ` +
          `already COMPLETED, or never recorded. Completion proceeds.`,
      );
    }
  }

  /**
   * Step 4 — the fix for the completion-side slot leak.
   *
   * Guarded CAS, `1 -> 0`, never a blind `active_delivery_count = 0`: the
   * mirror of `OfferAcceptanceService.claimRiderSlot`'s `0 -> 1` and the exact
   * shape `DeliveryReleaseService.repairAvailability` already uses for the
   * cancellation path (ADR-003 — the state check lives in the `WHERE` clause,
   * never a prior `SELECT`). An unconditional write would clobber a slot a
   * *different*, concurrently accepted delivery had legitimately taken.
   *
   * **Zero rows needs a second look, unlike step 3.** It means one of two
   * things and they are not interchangeable: the count is already 0 (a retry,
   * or a concurrent completion of this same delivery won the race — both fine,
   * the slot is released either way), or there is no `rider_availability` row
   * at all (a broken invariant — the rider could not have been dispatched to
   * without one). Only a diagnostic read tells them apart, and it runs only
   * after the CAS has already matched nothing, so it never decides a race.
   *
   * Fails closed, matching `DeliveryReleaseService.repairAvailability`: if the
   * slot cannot be *confirmed* released, this raises rather than reporting a
   * clean completion. The delivery is already `DELIVERED` and stays that way;
   * a retry re-enters {@link repairCompletion} and re-runs this step. Telling
   * a rider they are free to take new work when they may not be is the one
   * outcome this method must never produce.
   */
  private async releaseRiderSlot(riderId: string, deliveryId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 0 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 1)
      .select('rider_id, active_delivery_count')
      .maybeSingle<RiderAvailabilityRow>();

    if (error) {
      this.logger.error(
        `active_delivery_count release failed for rider ${riderId} after completing delivery ${deliveryId}: ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }

    if (data) {
      return;
    }

    await this.assertSlotAlreadyReleased(riderId, deliveryId);
  }

  /**
   * Diagnostic only — reached when the `1 -> 0` CAS matched nothing, and used
   * solely to decide whether that is the benign case (already 0) or the broken
   * one (no availability row at all).
   *
   * A read failure here must not be reported as a released slot, so it raises
   * too: this method's contract is "prove the slot is free", and an
   * unanswerable read proves nothing.
   */
  private async assertSlotAlreadyReleased(riderId: string, deliveryId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .select('rider_id, active_delivery_count')
      .eq('rider_id', riderId)
      .maybeSingle<RiderAvailabilityRow>();

    if (error) {
      this.logger.error(
        `Rider availability diagnosis read failed for rider ${riderId} after completing delivery ${deliveryId}: ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }

    if (!data) {
      this.logger.error(
        `Rider ${riderId} completed delivery ${deliveryId} but has no rider_availability row — ` +
          `the slot cannot be confirmed released.`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability missing' });
    }

    if (data.active_delivery_count !== 0) {
      this.logger.error(
        `Rider ${riderId} still holds active_delivery_count = ${data.active_delivery_count} after ` +
          `completing delivery ${deliveryId}; expected 0 or 1.`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }

    this.logger.debug(
      `active_delivery_count was already 0 for rider ${riderId} when completing delivery ${deliveryId}.`,
    );
  }

  /**
   * Step 5 — DEC-044. Posts one `RIDER_PAYABLE` ledger entry —
   * `BANHAO owes rider ฿12` — for this completed delivery.
   *
   * `delivery.rider_earning_satang` is read from the row {@link claimCompletion}
   * or {@link readDelivery} already returned — **never recomputed** here — so
   * the amount posted is always exactly what was snapshotted at completion,
   * even if a future configuration changes the effective rate for deliveries
   * that complete afterwards.
   *
   * Anchored on `rider-earning:<deliveryId>` via
   * `ledger_entry_groups.group_key`'s existing unique constraint
   * (`20260811000007_ledger_domain.sql`) — a delivery can complete at most
   * once (the guarded `EN_ROUTE -> DELIVERED` transition is itself write-once),
   * so the delivery id alone is a sufficient, permanent anchor; no second
   * transaction identity is needed the way payment events needed one. The
   * insert-then-self-heal-on-conflict shape matches
   * `PaymentEventProcessingService.postCommissionLedger` exactly (DEC-043).
   *
   * **This group is a single entry and does not sum to zero on its own.**
   * The natural offsetting entry would be the customer's delivery-fee
   * payment (`CUSTOMER_PAYMENT`), but no such entry is posted anywhere in the
   * current Phase F implementation — the commission ledger (DEC-043) does not
   * post one either. Forcing a balanced group here would mean inventing a
   * funding entry this repository's architecture does not yet have a home
   * for, which DEC-044's own implementation instructions explicitly forbid.
   * This is a real, surfaced accounting boundary, not an oversight: a
   * `CUSTOMER_PAYMENT`-anchored, fully balanced rider/delivery ledger flow is
   * a separate, larger Phase F question this method does not decide.
   */
  private async postRiderEarningLedger(delivery: DeliveryRow, riderId: string): Promise<void> {
    if (delivery.rider_earning_satang === null) {
      // Cannot happen on the paths that call this (claimCompletion always
      // sets it in the same statement as DELIVERED; the repair path only
      // reaches a delivery that is already DELIVERED, hence already
      // snapshotted) — a defensive, "throw rather than guess" guard against
      // silently inventing an amount here, matching this codebase's own
      // convention for a state that should be structurally unreachable.
      throw new DomainError('INTERNAL_ERROR', {
        message: 'DELIVERED delivery has no rider_earning_satang snapshot',
        details: { deliveryId: delivery.id },
      });
    }

    const earningSatang = delivery.rider_earning_satang;
    const groupKey = `rider-earning:${delivery.id}`;

    const { data: group, error: groupError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .insert({ group_key: groupKey, order_id: delivery.order_id, kind: 'RIDER_EARNING' })
      .select('id')
      .maybeSingle<{ id: string }>();

    if (groupError) {
      if (!isUniqueViolation(groupError)) {
        throw new DomainError('INTERNAL_ERROR', { message: 'Rider earning ledger group insert failed' });
      }

      // Already posted by an earlier run of this same completion (self-heal),
      // or the group committed but the entry insert below did not (the same
      // class of narrow crash window this file's own history-write and
      // slot-release steps already tolerate).
      await this.ensureRiderEarningEntryRecorded(groupKey, riderId, earningSatang);
      return;
    }

    if (!group) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider earning ledger group insert returned no row' });
    }

    await this.insertRiderEarningEntry(group.id, riderId, earningSatang);
  }

  private async ensureRiderEarningEntryRecorded(
    groupKey: string,
    riderId: string,
    earningSatang: number,
  ): Promise<void> {
    const { data: existingGroup, error: groupReadError } = await this.supabase.admin
      .from('ledger_entry_groups')
      .select('id')
      .eq('group_key', groupKey)
      .maybeSingle<{ id: string }>();

    if (groupReadError) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider earning ledger group read failed' });
    }
    if (!existingGroup) {
      throw new DomainError('INTERNAL_ERROR', {
        message: 'Rider earning ledger group read found no row',
        details: { groupKey },
      });
    }

    const { data: existingEntries, error: entriesReadError } = await this.supabase.admin
      .from('ledger_entries')
      .select('id')
      .eq('group_id', existingGroup.id)
      .returns<{ id: string }[]>();

    if (entriesReadError) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider earning ledger entry check failed' });
    }
    if (existingEntries && existingEntries.length > 0) {
      return;
    }

    await this.insertRiderEarningEntry(existingGroup.id, riderId, earningSatang);
  }

  /** `RIDER_PAYABLE`, negative — an outflow obligation, matching `SETTLEMENT_MODEL.md` § 4.1's own sign convention for this account. */
  private async insertRiderEarningEntry(groupId: string, riderId: string, earningSatang: number): Promise<void> {
    const { error } = await this.supabase.admin.from('ledger_entries').insert({
      group_id: groupId,
      account: 'RIDER_PAYABLE',
      party_type: 'RIDER',
      party_id: riderId,
      amount_satang: -earningSatang,
    });

    if (error) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider earning ledger entry insert failed' });
    }
  }

  /**
   * Step 6 — the order-side half, made idempotent.
   *
   * `OrdersService.completeDelivery` is the authority and is called first,
   * unconditionally — its own guarded `WHERE state = 'DELIVERING'` is what
   * decides, and an order in any other state (`CANCELLED` included) simply
   * matches zero rows and is **left untouched**.
   *
   * Only when it fails does this method read `orders.state`, and only to
   * answer one question: *did the effect this call wanted already happen?* An
   * order already `DELIVERED` means yes — a concurrent request, or an earlier
   * attempt of this same repair, already moved it — so reporting a failure
   * would be dishonest about the state the caller is left in. Any other state
   * means no, and the original error propagates **unchanged**. This method
   * never upgrades a refusal into a success, and never re-attempts the write.
   *
   * Same diagnose-only-after-the-authority-has-spoken shape
   * `DeliveryEnRouteService.advanceOrder` uses.
   */
  private async advanceOrder(
    user: AuthenticatedUser,
    orderId: string,
    deliveryId: string,
    riderId: string,
  ): Promise<void> {
    try {
      await this.orders.completeDelivery(user, orderId);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      if (await this.orderIsAlreadyDelivered(orderId)) {
        this.logger.warn(
          `Order ${orderId} was already DELIVERED when delivery ${deliveryId} (rider ${riderId}) ` +
            `re-attempted its transition; treating the order half as already complete: ${message}`,
        );
        return;
      }

      this.logger.error(
        `Order transition to DELIVERED failed for order ${orderId} after delivery ${deliveryId} ` +
          `(rider ${riderId}) had already moved to DELIVERED: ${message}. ` +
          `The delivery stays DELIVERED; retrying this endpoint will re-attempt the order half.`,
      );
      throw cause;
    }
  }

  /**
   * Diagnostic only — a read of `orders.state`, never a write, and never
   * consulted before `OrdersService.completeDelivery` has already had its say.
   * A read failure here must not mask the order error that brought us here, so
   * it resolves to `false` and lets that original error propagate.
   */
  private async orderIsAlreadyDelivered(orderId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('state')
      .eq('id', orderId)
      .maybeSingle<OrderStateRow>();

    if (error) {
      this.logger.error(`Order state diagnosis read failed for order ${orderId}: ${error.message}`);
      return false;
    }

    return data?.state === 'DELIVERED';
  }

  /**
   * The completion transition's audit row. Append-only, exactly like
   * `DeliveryEnRouteService.writeHistory` — and called **only** by the request
   * whose guarded UPDATE actually moved the delivery, which is what makes
   * "exactly one row" a structural property rather than a checked one. Never
   * called from {@link repairCompletion}.
   */
  private async writeHistory(deliveryId: string, riderId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: 'EN_ROUTE',
      to_state: 'DELIVERED',
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(
        `delivery_status_history insert failed for delivery ${deliveryId} (-> DELIVERED): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery completion history failed' });
    }
  }

  /**
   * One `state`, because both domains say `DELIVERED` — see
   * `RiderDeliveredResponse` for why this transition needs no `orderState`
   * field where G-6's did.
   */
  private response(delivery: DeliveryRow, riderId: string): RiderDeliveredResponse {
    return {
      deliveryId: delivery.id,
      orderId: delivery.order_id,
      state: 'DELIVERED',
      deliveredAt: delivery.delivered_at,
      riderId,
    };
  }

  /**
   * H-3 — `OrderDelivered`, CUSTOMER + MERCHANT. Reads `orders`/`restaurants`/
   * `merchants` directly — this service already reads `orders` directly
   * (`orderIsAlreadyDelivered`), and the H-3 contract calls for the same
   * order/restaurant/merchant-owner relationship. Never throws: a
   * resolution or write failure is logged and swallowed — the delivery has
   * already completed and already been reported to the rider.
   */
  private async writeOrderDeliveredOutboxEvent(delivery: DeliveryRow): Promise<void> {
    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('customer_id, restaurant_id')
      .eq('id', delivery.order_id)
      .maybeSingle<{ customer_id: string; restaurant_id: string }>();

    if (orderError || !order) {
      this.logger.error(
        `OrderDelivered recipient resolution: orders read failed for delivery ${delivery.id}: ${orderError?.message ?? 'not found'}`,
      );
      return;
    }

    const recipients: OutboxRecipient[] = [{ recipientId: order.customer_id, recipientType: 'CUSTOMER' }];

    const merchantOwnerId = await this.resolveMerchantOwnerId(order.restaurant_id);
    if (merchantOwnerId) {
      recipients.push({ recipientId: merchantOwnerId, recipientType: 'MERCHANT' });
    }

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: 'delivery',
      aggregate_id: delivery.id,
      event_type: 'OrderDelivered',
      payload: { recipients },
    });

    if (error) {
      this.logger.error(`outbox insert failed for OrderDelivered (delivery ${delivery.id}): ${error.message}`);
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
}

/** Matches `PaymentEventProcessingService`'s own identically-named helper — Postgres unique-violation, code `23505`. */
function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
