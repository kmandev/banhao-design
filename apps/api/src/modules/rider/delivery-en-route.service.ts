import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderEnRouteResponse } from '@banhao/validation';
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

/**
 * `POST /api/v1/rider/deliveries/:id/en-route` — Phase G-6: the rider departs
 * the merchant. `PICKED_UP -> EN_ROUTE` on `deliveries`, and — only once that
 * has genuinely happened — `PICKED_UP -> DELIVERING` on `orders`.
 *
 * V1.1 §7 records this transition exactly once, in the Order State Machine
 * table: *actor Rider, validation "is `PICKED_UP`", side effect "delivery →
 * `EN_ROUTE`"*. `docs/RIDER_LIFECYCLE.md` §4 names the delivery half in its own
 * state diagram (`PICKED_UP --> EN_ROUTE : rider departs`). **This is the one
 * step where the two domains use different words for the same moment** — the
 * order calls it `DELIVERING`, the delivery calls it `EN_ROUTE` — which is
 * DEC-018 working as intended, not a naming bug to reconcile.
 *
 * Structurally this is G-5's join point again, minus the join. Pickup had to
 * wait for two *independent* things (the merchant finishing the food and a
 * rider being assigned); departure waits only on the rider's own immediately
 * preceding action, so there is no second party whose progress can legitimately
 * be missing. Everything else — the guarded UPDATE as sole authority, the
 * winner-only history row, the repair-on-retry tail — is
 * {@link DeliveryPickupService}'s shape, deliberately unchanged.
 *
 * ## Reused, not reimplemented
 *
 * The order-side half is `OrdersService.startDelivery` — already written for
 * Phase E, already a guarded UPDATE (`PICKED_UP -> DELIVERING`) with its own
 * `order_status_history` write and its own `NOT_FOUND` /`INVALID_TRANSITION` /
 * `INTERNAL_ERROR` mapping. Until this slice it had **no caller anywhere in the
 * API** — the same state `pickupOrder` was in before G-5 wired it. This service
 * is that wiring: it enforces delivery-side ownership and pre-state *before*
 * ever calling `startDelivery`, and `OrdersService` itself is not modified.
 *
 * ## Three writes, in this order, and why the order matters
 *
 * 1. **The delivery claim** — `UPDATE deliveries SET state = 'EN_ROUTE'
 *    WHERE id = :id AND state = 'PICKED_UP' AND rider_id = :riderId`.
 *    Ownership and the pre-state are both enforced inside the `WHERE` clause,
 *    never decided by a prior `SELECT` (ADR-003). This is the **sole**
 *    authority for the delivery transition: exactly one of N concurrent calls
 *    matches, the losers affect zero rows, and {@link repairEnRoute} only ever
 *    explains a loss that already happened, never decides one.
 * 2. **The delivery's own history row** — written by the guarded-UPDATE
 *    *winner only*, immediately, before the order is touched.
 * 3. **The order transition** — `OrdersService.startDelivery`, whose own
 *    guarded UPDATE is the order-side authority. Never re-implemented here.
 *
 * Step 2 leads step 3 for the reason G-5.1 established: `delivery_status_history`
 * audits the *delivery* domain, and by step 2 the delivery has genuinely
 * transitioned. Withholding that row because a *different domain's* write later
 * failed would make the delivery's own audit trail lie about the delivery.
 *
 * ## The partial-failure repair path
 *
 * **Deliberately not one transaction** (no cross-domain RPC exists, and the
 * schema is locked), so step 3 genuinely can fail after step 1 has committed,
 * leaving `deliveries.state = EN_ROUTE` while the order has not moved. Without
 * a repair path that would be a dead end: every retry would hit step 1's
 * `state = 'PICKED_UP'` guard, match nothing, and return `INVALID_TRANSITION`
 * forever.
 *
 * {@link repairEnRoute} closes it exactly as `DeliveryPickupService.repairPickup`
 * does — *"the delivery already reflects this call's effect; finish the tail and
 * report the success that already happened"*. A retry whose delivery is already
 * `EN_ROUTE` **and still owned by the calling rider** re-attempts only the order
 * half:
 *
 * - order moves → success, the partial failure is repaired;
 * - order is already `DELIVERING` → success, idempotent, nothing written;
 * - order is `CANCELLED`, `DELIVERED`, or anything else → `startDelivery`'s own
 *   guarded `WHERE state = 'PICKED_UP'` matches nothing, so **the order is never
 *   mutated**, and its error propagates unchanged. Nothing is forced.
 *
 * The repair path **never writes `delivery_status_history`**. It does not need
 * to: step 2 already wrote it, in the same request that made the delivery
 * `EN_ROUTE`, and only the guarded-UPDATE winner ever reaches step 2. That is
 * what makes "exactly one history row" a structural property rather than a
 * check-then-insert race — `delivery_status_history` carries **no** unique
 * constraint (migration `20260811000009`), so an existence-check-then-insert
 * heal would be genuinely race-prone under two concurrent retries. Not writing
 * is the only duplicate-free answer available without a migration.
 *
 * ## What this service never does
 *
 * It never writes `order_status_history` — that stays inside
 * `OrdersService.startDelivery`, which this service does not modify. It never
 * forces an order out of a state its own guarded UPDATE refuses. It never
 * re-runs the delivery UPDATE to "undo" or re-drive anything.
 *
 * No payment, ledger, refund, reconciliation or settlement row is read or
 * written. No `rider_assignments` or `rider_assignment_attempts` write —
 * departure does not change assignment authority. No proof photo, no
 * notification, no earning, no `rider_earning_satang` (BQ-029 is `OPEN`; a
 * value here would be invented). No `DELIVERED` — that transition is Phase G-7
 * and is blocked on BQ-018 and BQ-029.
 */
@Injectable()
export class DeliveryEnRouteService {
  private readonly logger = new Logger(DeliveryEnRouteService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orders: OrdersService,
  ) {}

  async startDelivery(user: AuthenticatedUser, deliveryId: string): Promise<RiderEnRouteResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const delivery = await this.claimEnRoute(deliveryId, riderId);

    if (!delivery) {
      // Lost the guarded UPDATE, or the delivery is not in a departable state.
      // Either it is repairable (already EN_ROUTE and still ours — finish the
      // order half) or it is a genuine refusal.
      return this.repairEnRoute(user, deliveryId, riderId);
    }

    // The delivery has genuinely moved to EN_ROUTE, and this request is the
    // one that moved it. Record that fact before anything else can fail —
    // see this file's header on why the history row leads the order write.
    await this.writeHistory(deliveryId, riderId);

    // Everything from here is "finish the tail", never "decide whether the
    // delivery transition happened".
    await this.advanceOrder(user, delivery.order_id, deliveryId, riderId);

    return this.response(deliveryId, delivery.order_id, riderId);
  }

  /**
   * The repair path: reached only when the guarded UPDATE matched no row.
   * Diagnoses why, and — for the one case that is a genuine partial failure
   * rather than a refusal — finishes the order half that an earlier request
   * left undone.
   *
   * Ownership is re-established here from `deliveries.rider_id` exactly as on
   * the primary path; a delivery that is `EN_ROUTE` but belongs to someone
   * else is still `NOT_ASSIGNED_RIDER`, never repairable by this caller.
   *
   * Only `EN_ROUTE` is repairable. A delivery still `PICKED_UP` cannot reach
   * here (the guarded UPDATE would have matched it), one still `AT_MERCHANT`
   * or `RIDER_ASSIGNED` has not reached this transition yet, and one already
   * `DELIVERED` or `FAILED` is past it entirely — all stay
   * `INVALID_TRANSITION`, because re-driving the order from any of them would
   * be inventing a transition.
   */
  private async repairEnRoute(
    user: AuthenticatedUser,
    deliveryId: string,
    riderId: string,
  ): Promise<RiderEnRouteResponse> {
    const delivery = await this.readDelivery(deliveryId);

    if (!delivery) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    if (delivery.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    if (delivery.state !== 'EN_ROUTE') {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId, from: delivery.state, to: 'EN_ROUTE' },
      });
    }

    this.logger.warn(
      `Repairing departure for delivery ${deliveryId} (rider ${riderId}): delivery is already EN_ROUTE, ` +
        `re-attempting the order half for order ${delivery.order_id}`,
    );

    // No history write on this path — the request that moved the delivery
    // already wrote it. See this file's header.
    await this.advanceOrder(user, delivery.order_id, deliveryId, riderId);

    return this.response(deliveryId, delivery.order_id, riderId);
  }

  /** The guarded UPDATE — ownership and pre-state enforced entirely in the `WHERE` clause. */
  private async claimEnRoute(deliveryId: string, riderId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({ state: 'EN_ROUTE' })
      .eq('id', deliveryId)
      .eq('state', 'PICKED_UP')
      .eq('rider_id', riderId)
      .select('id, state, rider_id, order_id')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Departure claim failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Departure transition failed' });
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
      this.logger.error(`Departure diagnosis read failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Departure transition failed' });
    }

    return data ?? null;
  }

  /**
   * The order-side half, made idempotent.
   *
   * `OrdersService.startDelivery` is the authority and is called first,
   * unconditionally — its own guarded `WHERE state = 'PICKED_UP'` is what
   * decides, and an order in any other state (`CANCELLED` and `DELIVERED`
   * included) simply matches zero rows and is **left untouched**.
   *
   * Only when it fails does this method read `orders.state`, and only to
   * answer one question: *did the effect this call wanted already happen?*
   * An order already `DELIVERING` means yes — a concurrent request, or an
   * earlier attempt of this same repair, already moved it — so reporting a
   * failure would be dishonest about the state the caller is left in. Any
   * other state means no, and the original error propagates **unchanged**
   * (`INVALID_TRANSITION` for a cancelled order, `NOT_FOUND` for a missing
   * one, `INTERNAL_ERROR` for a transport fault, and a non-`DomainError`
   * exactly as thrown) — this method never upgrades a refusal into a success,
   * and never re-attempts the write.
   *
   * This is the same diagnose-only-after-the-authority-has-spoken shape
   * `DeliveryPickupService.advanceOrder` and
   * `OrdersService.buildFailedTransitionError` already use.
   */
  private async advanceOrder(
    user: AuthenticatedUser,
    orderId: string,
    deliveryId: string,
    riderId: string,
  ): Promise<void> {
    try {
      await this.orders.startDelivery(user, orderId);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);

      if (await this.orderIsAlreadyDelivering(orderId)) {
        this.logger.warn(
          `Order ${orderId} was already DELIVERING when delivery ${deliveryId} (rider ${riderId}) ` +
            `re-attempted its transition; treating the order half as already complete: ${message}`,
        );
        return;
      }

      this.logger.error(
        `Order transition to DELIVERING failed for order ${orderId} after delivery ${deliveryId} ` +
          `(rider ${riderId}) had already moved to EN_ROUTE: ${message}. ` +
          `The delivery stays EN_ROUTE; retrying this endpoint will re-attempt the order half.`,
      );
      throw cause;
    }
  }

  /**
   * Diagnostic only — a read of `orders.state`, never a write, and never
   * consulted before `OrdersService.startDelivery` has already had its say.
   * A read failure here must not mask the order error that brought us here,
   * so it resolves to `false` and lets that original error propagate.
   */
  private async orderIsAlreadyDelivering(orderId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('state')
      .eq('id', orderId)
      .maybeSingle<OrderStateRow>();

    if (error) {
      this.logger.error(`Order state diagnosis read failed for order ${orderId}: ${error.message}`);
      return false;
    }

    return data?.state === 'DELIVERING';
  }

  /**
   * The departure transition's audit row. Append-only, exactly like
   * `DeliveryPickupService.writeHistory` — and called **only** by the request
   * whose guarded UPDATE actually moved the delivery, which is what makes
   * "exactly one row" a structural property rather than a checked one. Never
   * called from {@link repairEnRoute}.
   */
  private async writeHistory(deliveryId: string, riderId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: 'PICKED_UP',
      to_state: 'EN_ROUTE',
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(`delivery_status_history insert failed for delivery ${deliveryId} (-> EN_ROUTE): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery departure history failed' });
    }
  }

  /**
   * Both domains' names for this one step, stated separately — see
   * `RiderEnRouteResponse` for why this transition cannot honestly report a
   * single `state` the way the pickup response could.
   */
  private response(deliveryId: string, orderId: string, riderId: string): RiderEnRouteResponse {
    return { deliveryId, orderId, state: 'EN_ROUTE', orderState: 'DELIVERING', riderId };
  }
}
