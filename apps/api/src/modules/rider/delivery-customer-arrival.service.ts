import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderArrivedAtCustomerResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';

/** `deliveries`, what the guarded UPDATE returns on a match and the diagnostic read's own shape. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
  order_id: string;
  arrived_at: string | null;
}

/**
 * `POST /api/v1/rider/deliveries/:id/arrived-at-customer` — BQ-017 Slice #1.
 *
 * The rider has reached the **customer's** delivery location:
 * `EN_ROUTE -> ARRIVED` on `deliveries`, with `arrived_at` stamped in the same
 * statement. Delivery-domain only (DEC-018) — the order stays `DELIVERING`.
 *
 * ## This is not the existing arrival endpoint, and must never become it
 *
 * {@link DeliveryArrivalService} handles `RIDER_ASSIGNED -> AT_MERCHANT`:
 * arrival at the **shop**, before the food is collected. DEC-054 makes the two
 * concepts textually distinct precisely because they were confusable — an
 * implementer wiring DEC-053's five-minute wait to the endpoint whose name
 * matched the policy word ("arrived") would have started the clock at the
 * merchant, at the wrong end of the journey. The two services, the two routes
 * and the two response types are all separate so that neither can silently
 * become the other. Do not alias them, do not share a base class for them, and
 * do not reuse `AT_MERCHANT`'s endpoint for this.
 *
 * ## What DEC-054 authorises here, and what it does not
 *
 * It authorises the transition and its timestamp, nothing further. This
 * service therefore writes **no** failure state, no cause code, no contact
 * attempt, no notification and no financial row, and it starts no timer —
 * `arrived_at` is the anchor a *later* slice's timer will read. `FAILED`,
 * `DELIVERY_FAILED` and the operator command that produces them are Slice #2.
 *
 * ## The guarded UPDATE is the sole transition authority
 *
 * `UPDATE deliveries SET state = 'ARRIVED', arrived_at = now() WHERE id = :id
 * AND state = 'EN_ROUTE' AND rider_id = :riderId` — ownership and the
 * pre-state both live in the `WHERE` clause, never in a prior `SELECT`
 * (ADR-003). Two concurrent calls for the same delivery resolve on the row
 * lock under READ COMMITTED: exactly one matches, the loser matches zero rows,
 * and {@link writeHistory} runs only after a match, so exactly one
 * `delivery_status_history` row exists as a structural property rather than a
 * checked one — the same discipline {@link DeliveryEnRouteService} documents.
 *
 * ## `arrived_at` is write-once, and that falls out of the guard
 *
 * It is written in the same statement as the state, so there is no window
 * where a delivery is `ARRIVED` with a null anchor, and no second write a
 * retry could use to move it. A repeat call finds `state = 'ARRIVED'`, matches
 * nothing, and never reaches the write — and because no transition anywhere
 * returns a delivery to `EN_ROUTE`, that is permanent. The *database* does not
 * enforce it (`deliveries` deliberately carries no column-immutability
 * trigger, so `state` and `rider_id` can advance freely); this is an
 * application rule, stated as honestly as `DeliveryCompletionService` states
 * the same property for `proof_photo_path`.
 *
 * ## Diagnosis, never decision
 *
 * {@link buildFailureError} runs only *after* the guarded UPDATE has already
 * matched nothing, purely to choose an honest error code — the same
 * diagnose-after-the-fact shape `DeliveryArrivalService.classifyFailure` uses,
 * in `OrdersService.buildFailedTransitionError`'s built-and-returned form so
 * the `throw` is visible at the point it happens.
 *
 * - No delivery → `NOT_FOUND`.
 * - Assigned to someone else, or to no one → `NOT_ASSIGNED_RIDER` (403).
 *   Ownership is `deliveries.rider_id`, never `rider_assignments`.
 * - Owned by this rider but not `EN_ROUTE` — still `RIDER_ASSIGNED`,
 *   `AT_MERCHANT` or `PICKED_UP`, already `ARRIVED`, or past it at
 *   `DELIVERED`/`FAILED` — → `INVALID_TRANSITION` (409). A duplicate arrival
 *   lands here deliberately: it is a refusal, not an idempotent success, and
 *   nothing is repaired. There is no partial failure to repair, because this
 *   transition writes to exactly one domain.
 *
 * No new error code is introduced; both are the existing catalogue's.
 */
@Injectable()
export class DeliveryCustomerArrivalService {
  private readonly logger = new Logger(DeliveryCustomerArrivalService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async arriveAtCustomer(
    user: AuthenticatedUser,
    deliveryId: string,
  ): Promise<RiderArrivedAtCustomerResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const delivery = await this.claimArrival(deliveryId, riderId);

    if (!delivery) {
      throw await this.buildFailureError(deliveryId, riderId);
    }

    await this.writeHistory(deliveryId, riderId);

    return {
      deliveryId,
      orderId: delivery.order_id,
      state: 'ARRIVED',
      arrivedAt: delivery.arrived_at,
      riderId,
    };
  }

  /**
   * The guarded UPDATE — ownership and pre-state enforced entirely in the
   * `WHERE` clause, `arrived_at` written in the same statement as the state.
   * Returns the matched row on success, `null` on zero rows.
   */
  private async claimArrival(deliveryId: string, riderId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({ state: 'ARRIVED', arrived_at: new Date().toISOString() })
      .eq('id', deliveryId)
      .eq('state', 'EN_ROUTE')
      .eq('rider_id', riderId)
      .select('id, state, rider_id, order_id, arrived_at')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(
        `Customer-arrival claim failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Customer arrival transition failed' });
    }

    return data ?? null;
  }

  /**
   * Explains a failed guarded UPDATE. Never itself a transition authority —
   * see this file's header. Built and returned rather than thrown, so the
   * call site reads `throw await this.buildFailureError(...)`.
   */
  private async buildFailureError(deliveryId: string, riderId: string): Promise<DomainError> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id, order_id, arrived_at')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(
        `Customer-arrival diagnosis read failed for delivery ${deliveryId}: ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Customer arrival transition failed' });
    }

    if (!data) {
      return new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    if (data.rider_id !== riderId) {
      return new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    return new DomainError('INVALID_TRANSITION', {
      details: { deliveryId, from: data.state, to: 'ARRIVED' },
    });
  }

  /**
   * The transition's audit row. Append-only, exactly like
   * `DeliveryArrivalService.writeHistory` — and called **only** by the request
   * whose guarded UPDATE actually moved the delivery, which is what makes
   * "exactly one row" structural rather than checked.
   */
  private async writeHistory(deliveryId: string, riderId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: 'EN_ROUTE',
      to_state: 'ARRIVED',
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(
        `delivery_status_history insert failed for delivery ${deliveryId} (-> ARRIVED): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Customer arrival history failed' });
    }
  }
}
