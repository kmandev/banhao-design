import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderPickedUpResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';
import { OrdersService } from '../orders/orders.service';

/** `deliveries`, what the guarded UPDATE returns on a match, and the diagnostic read's own shape. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
  order_id: string;
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

/**
 * `POST /api/v1/rider/deliveries/:id/picked-up` — Phase G-5, the order ↔
 * delivery **join point** (V1.1 §7: "`PICKED_UP` — `READY_FOR_PICKUP` **and**
 * delivery has assigned rider — the join point"). The first slice that
 * intentionally touches both domains in one request: `AT_MERCHANT ->
 * PICKED_UP` on `deliveries`, and — only once that has genuinely happened —
 * `READY_FOR_PICKUP -> PICKED_UP` on `orders` (DEC-018 still holds: nothing
 * here merges the two state machines into one, it sequences two separate
 * guarded writes behind one rider-facing action).
 *
 * ## Reused, not reimplemented
 *
 * The order-side half of this transition is `OrdersService.pickupOrder` —
 * already written for Phase E-4.1, already a guarded UPDATE (`READY_FOR_PICKUP
 * -> PICKED_UP`) with its own `order_status_history` write and its own
 * `NOT_FOUND` / `INVALID_TRANSITION` / `INTERNAL_ERROR` mapping. That method's
 * own doc comment names exactly the gap this service closes: *"Restricting
 * which rider may call this is... a known gap closed by Phase G, not by this
 * method."* This service is that closure — it enforces delivery-side
 * ownership and pre-state *before* ever calling `pickupOrder`, and
 * `OrdersService` itself is not modified.
 *
 * ## Three writes, in this order, and why the order matters (Phase G-5.1)
 *
 * 1. **The delivery claim** — `UPDATE deliveries SET state = 'PICKED_UP'
 *    WHERE id = :id AND state = 'AT_MERCHANT' AND rider_id = :riderId`.
 *    Ownership and the pre-state are both enforced inside the `WHERE` clause,
 *    never decided by a prior `SELECT` (ADR-003) — same discipline as
 *    `DeliveryArrivalService.claimArrival`. This is the **sole** authority for
 *    the delivery transition: exactly one of N concurrent calls matches, the
 *    losers affect zero rows, and {@link buildFailedClaimError} /
 *    {@link repairPickup} only ever explain a loss that already happened,
 *    never decide one.
 * 2. **The delivery's own history row** — written by the guarded-UPDATE
 *    *winner only*, immediately, before the order is touched.
 * 3. **The order transition** — `OrdersService.pickupOrder`, whose own
 *    guarded UPDATE is the order-side authority. Never re-implemented here.
 *
 * ### Why the history row moved ahead of the order transition (G-5.1)
 *
 * It used to be written last, after the order had also moved. That was wrong
 * under **DEC-018**: `delivery_status_history` audits the *delivery* domain,
 * and by step 2 the delivery has genuinely transitioned `AT_MERCHANT ->
 * PICKED_UP`. Withholding that row because a *different domain's* write later
 * failed made the delivery's own audit trail lie about what happened to the
 * delivery. Writing it at the moment it becomes true is both more honest and —
 * see below — what makes the repair path provably free of duplicate history.
 *
 * ## The partial-failure repair path — the G-5.1 fix
 *
 * **Deliberately not one transaction** (no cross-domain RPC exists, and the
 * schema is locked). So step 3 genuinely can fail after step 1 has committed,
 * leaving `deliveries.state = PICKED_UP` while the order has not moved.
 *
 * Before G-5.1 that was a **dead end**: every retry hit step 1's
 * `state = 'AT_MERCHANT'` guard, matched nothing, and returned
 * `INVALID_TRANSITION` — the order transition was never re-attempted, and no
 * reconciliation kind covers this pair (`reconciliation_cases`' CHECK admits
 * no such value, and adding one is a migration).
 *
 * {@link repairPickup} closes it, reusing the pattern
 * `OfferAcceptanceService.acceptOffer` already established in this very module
 * for the structurally identical problem — *"the delivery already reflects
 * this call's effect; finish the tail and report the success that already
 * happened"* (its `alreadyHoldsThisDelivery` branch). A retry whose delivery
 * is already `PICKED_UP` **and still owned by the calling rider** re-attempts
 * only the order half:
 *
 * - order moves → success, the partial failure is repaired;
 * - order is already `PICKED_UP` → success, idempotent, nothing written;
 * - order is `CANCELLED` or any other state → `pickupOrder`'s own guarded
 *   `WHERE state = 'READY_FOR_PICKUP'` matches nothing, so **the order is
 *   never mutated**, and its error propagates unchanged. Nothing is forced.
 *
 * The repair path **never writes `delivery_status_history`**. It does not need
 * to: step 2 already wrote it, in the same request that made the delivery
 * `PICKED_UP`, and only the guarded-UPDATE winner ever reaches step 2. That is
 * what makes "exactly one history row" a structural property rather than a
 * check-then-insert race — `delivery_status_history` carries **no** unique
 * constraint (migration `20260811000009`), so an existence-check-then-insert
 * heal would be genuinely race-prone under two concurrent retries. Not writing
 * is the only duplicate-free answer available without a migration.
 *
 * ## What this service never does
 *
 * It never writes `order_status_history` — that stays inside
 * `OrdersService.pickupOrder`, which this service does not modify. It never
 * forces an order out of a state its own guarded UPDATE refuses. It never
 * re-runs the delivery UPDATE to "undo" anything.
 *
 * ## What this service never does
 *
 * No payment, ledger, refund, reconciliation or settlement row is read or
 * written. No `rider_assignments` or `rider_assignment_attempts` write —
 * pickup does not change assignment authority. No proof photo, no
 * notification, no earning. No `EN_ROUTE`/`DELIVERING` or `DELIVERED` — this
 * service's only outcome is `PICKED_UP` on both domains.
 */
@Injectable()
export class DeliveryPickupService {
  private readonly logger = new Logger(DeliveryPickupService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orders: OrdersService,
  ) {}

  async pickup(user: AuthenticatedUser, deliveryId: string): Promise<RiderPickedUpResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const delivery = await this.claimPickup(deliveryId, riderId);

    if (!delivery) {
      // Lost the guarded UPDATE, or the delivery is not in a pickable state.
      // Either it is repairable (already PICKED_UP and still ours — finish the
      // order half) or it is a genuine refusal.
      return this.repairPickup(user, deliveryId, riderId);
    }

    // The delivery has genuinely moved to PICKED_UP, and this request is the
    // one that moved it. Record that fact before anything else can fail —
    // see this file's header on why the history row leads the order write.
    await this.writeHistory(deliveryId, riderId);

    // Everything from here is "finish the join point", never "decide whether
    // the delivery transition happened".
    await this.advanceOrder(user, delivery.order_id, deliveryId, riderId);

    // H-3 — OrderPickedUp, CUSTOMER + MERCHANT. Fires only on this branch —
    // the guarded `claimPickup` UPDATE actually winning — never from
    // `repairPickup`, which finishes the order half for a delivery an
    // earlier request already moved (and already notified).
    await this.writeOrderPickedUpOutboxEvent(delivery);

    return { deliveryId, orderId: delivery.order_id, state: 'PICKED_UP', riderId };
  }

  /**
   * The G-5.1 repair path: reached only when the guarded UPDATE matched no
   * row. Diagnoses why, and — for the one case that is a genuine partial
   * failure rather than a refusal — finishes the order half that an earlier
   * request left undone.
   *
   * Ownership is re-established here from `deliveries.rider_id` exactly as on
   * the primary path; a delivery that is `PICKED_UP` but belongs to someone
   * else is still `NOT_ASSIGNED_RIDER`, never repairable by this caller.
   *
   * Only `PICKED_UP` is repairable. A delivery that has moved on to
   * `EN_ROUTE`, `DELIVERED`, or anything else is past this transition
   * entirely and stays `INVALID_TRANSITION` — the join point is finished for
   * it, and re-driving the order from here would be inventing a transition.
   */
  private async repairPickup(
    user: AuthenticatedUser,
    deliveryId: string,
    riderId: string,
  ): Promise<RiderPickedUpResponse> {
    const delivery = await this.readDelivery(deliveryId);

    if (!delivery) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    if (delivery.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    if (delivery.state !== 'PICKED_UP') {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId, from: delivery.state, to: 'PICKED_UP' },
      });
    }

    this.logger.warn(
      `Repairing pickup for delivery ${deliveryId} (rider ${riderId}): delivery is already PICKED_UP, ` +
        `re-attempting the order half for order ${delivery.order_id}`,
    );

    // No history write on this path — the request that moved the delivery
    // already wrote it. See this file's header.
    await this.advanceOrder(user, delivery.order_id, deliveryId, riderId);

    return { deliveryId, orderId: delivery.order_id, state: 'PICKED_UP', riderId };
  }

  /** The guarded UPDATE — ownership and pre-state enforced entirely in the `WHERE` clause. */
  private async claimPickup(deliveryId: string, riderId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({ state: 'PICKED_UP' })
      .eq('id', deliveryId)
      .eq('state', 'AT_MERCHANT')
      .eq('rider_id', riderId)
      .select('id, state, rider_id, order_id')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Pickup claim failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Pickup transition failed' });
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
      .select('id, state, rider_id, order_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Pickup diagnosis read failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Pickup transition failed' });
    }

    return data ?? null;
  }

  /**
   * The order-side half of the join point, made idempotent.
   *
   * `OrdersService.pickupOrder` is the authority and is called first,
   * unconditionally — its own guarded `WHERE state = 'READY_FOR_PICKUP'` is
   * what decides, and an order in any other state (`CANCELLED` included)
   * simply matches zero rows and is **left untouched**.
   *
   * Only when it fails does this method read `orders.state`, and only to
   * answer one question: *did the effect this call wanted already happen?*
   * An order already `PICKED_UP` means yes — a concurrent request, or an
   * earlier attempt of this same repair, already moved it — so reporting a
   * failure would be dishonest about the state the caller is left in. Any
   * other state means no, and the original error propagates **unchanged**
   * (`INVALID_TRANSITION` for a cancelled order, `NOT_FOUND` for a missing
   * one, `INTERNAL_ERROR` for a transport fault) — this method never
   * upgrades a refusal into a success, and never re-attempts the write.
   *
   * This is the same diagnose-only-after-the-authority-has-spoken shape
   * `OfferAcceptanceService.diagnoseBusyRider` and
   * `OrdersService.buildFailedTransitionError` already use.
   */
  private async advanceOrder(
    user: AuthenticatedUser,
    orderId: string,
    deliveryId: string,
    riderId: string,
  ): Promise<void> {
    try {
      await this.orders.pickupOrder(user, orderId);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      if (await this.orderIsAlreadyPickedUp(orderId)) {
        this.logger.warn(
          `Order ${orderId} was already PICKED_UP when delivery ${deliveryId} (rider ${riderId}) ` +
            `re-attempted its transition; treating the order half as already complete: ${message}`,
        );
        return;
      }

      this.logger.error(
        `Order transition to PICKED_UP failed for order ${orderId} after delivery ${deliveryId} ` +
          `(rider ${riderId}) had already moved to PICKED_UP: ${message}. ` +
          `The delivery stays PICKED_UP; retrying this endpoint will re-attempt the order half.`,
      );
      throw cause;
    }
  }

  /**
   * Diagnostic only — a read of `orders.state`, never a write, and never
   * consulted before `OrdersService.pickupOrder` has already had its say.
   * A read failure here must not mask the order error that brought us here,
   * so it resolves to `false` and lets that original error propagate.
   */
  private async orderIsAlreadyPickedUp(orderId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('state')
      .eq('id', orderId)
      .maybeSingle<OrderStateRow>();

    if (error) {
      this.logger.error(`Order state diagnosis read failed for order ${orderId}: ${error.message}`);
      return false;
    }

    return data?.state === 'PICKED_UP';
  }

  /**
   * The pickup transition's audit row. Append-only, exactly like
   * `DeliveryArrivalService.writeHistory` — and called **only** by the
   * request whose guarded UPDATE actually moved the delivery, which is what
   * makes "exactly one row" a structural property rather than a checked one.
   * Never called from {@link repairPickup}.
   */
  private async writeHistory(deliveryId: string, riderId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: 'AT_MERCHANT',
      to_state: 'PICKED_UP',
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(`delivery_status_history insert failed for delivery ${deliveryId} (-> PICKED_UP): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery pickup history failed' });
    }
  }

  /**
   * H-3 — `OrderPickedUp`, CUSTOMER + MERCHANT. Reads `orders`/`restaurants`/
   * `merchants` directly — this service already reads `orders` directly
   * (`orderIsAlreadyPickedUp`), and the H-3 contract calls for the same
   * order/restaurant/merchant-owner relationship. Never throws: a
   * resolution or write failure is logged and swallowed, matching this
   * file's own `advanceOrder` precedent of never letting a side effect
   * undo an already-succeeded delivery-side transition.
   */
  private async writeOrderPickedUpOutboxEvent(delivery: DeliveryRow): Promise<void> {
    const { data: order, error: orderError } = await this.supabase.admin
      .from('orders')
      .select('customer_id, restaurant_id')
      .eq('id', delivery.order_id)
      .maybeSingle<{ customer_id: string; restaurant_id: string }>();

    if (orderError || !order) {
      this.logger.error(
        `OrderPickedUp recipient resolution: orders read failed for delivery ${delivery.id}: ${orderError?.message ?? 'not found'}`,
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
      event_type: 'OrderPickedUp',
      payload: { recipients },
    });

    if (error) {
      this.logger.error(`outbox insert failed for OrderPickedUp (delivery ${delivery.id}): ${error.message}`);
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
