import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderArrivedResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';

/** `deliveries`, read only to classify a failed guarded UPDATE — never to decide it. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
}

/**
 * `POST /api/v1/rider/deliveries/:id/arrived` — Phase G-4.
 *
 * A rider marks that they have reached the merchant for a delivery already
 * assigned to them: `RIDER_ASSIGNED -> AT_MERCHANT`. Delivery-domain only
 * (DEC-018) — no order, payment, ledger, or reconciliation table is read or
 * written, and no timestamp, radius, GPS, or notification logic is added:
 * this is strictly the state transition and its audit row.
 *
 * ## The guarded UPDATE is the sole transition authority
 *
 * `UPDATE deliveries SET state = 'AT_MERCHANT' WHERE id = :id AND state =
 * 'RIDER_ASSIGNED' AND rider_id = :riderId` — ownership and the pre-state are
 * both enforced inside the `WHERE` clause, never decided by a prior `SELECT`
 * (ADR-003). This is what makes two concurrent arrival calls for the same
 * delivery resolve safely: exactly one statement's `WHERE` matches (Postgres
 * serialises on the row lock under READ COMMITTED, same mechanism
 * `OfferAcceptanceService.claimDelivery` and `DeliveryReleaseService`'s own
 * CAS calls rely on), the loser affects zero rows, and no second history row
 * is ever written because {@link writeHistory} only runs after a matched
 * update.
 *
 * ## Diagnosis, never decision
 *
 * A zero-row result does not by itself say *why*. {@link classifyFailure}
 * runs a read-only `SELECT` **after** the guarded UPDATE has already failed,
 * purely to choose the honest error code — this is the same
 * diagnose-after-the-fact shape `OfferAcceptanceService.diagnoseBusyRider`
 * uses, not a read-then-write race: the transition itself was already decided
 * by the UPDATE, and this read can only ever explain a loss, never cause one.
 *
 * - No delivery at all → `NOT_FOUND`.
 * - A delivery that exists but is assigned to someone else (or no one) →
 *   `NOT_ASSIGNED_RIDER` (403) — ownership is `deliveries.rider_id`, never
 *   `rider_assignments`/`rider_assignment_attempts`, matching
 *   `DeliveryReleaseService`'s own documented reasoning.
 * - A delivery this rider owns but that is not `RIDER_ASSIGNED` (still
 *   `RIDER_SEARCHING`, already `AT_MERCHANT`, or any later state) →
 *   `INVALID_TRANSITION` (409) — the existing catalogue code for "the request
 *   was well-formed and the rider did nothing wrong, the world moved first",
 *   reused rather than inventing a new one for this single case.
 *
 * ## What this service never does
 *
 * No order state, ever (DEC-018). No payment, ledger, refund, reconciliation
 * or settlement row is read or written. No `rider_assignments` or
 * `rider_assignment_attempts` write — arrival does not change assignment
 * authority. No new `deliveries` column, no proof photo, no notification, no
 * earning.
 */
@Injectable()
export class DeliveryArrivalService {
  private readonly logger = new Logger(DeliveryArrivalService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async arrive(user: AuthenticatedUser, deliveryId: string): Promise<RiderArrivedResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const claimed = await this.claimArrival(deliveryId, riderId);

    if (!claimed) {
      await this.classifyFailure(deliveryId, riderId);
    }

    await this.writeHistory(deliveryId, riderId);

    return { deliveryId, state: 'AT_MERCHANT', riderId };
  }

  /**
   * The guarded UPDATE — ownership and pre-state enforced entirely in the
   * `WHERE` clause. Returns the matched row on success, `null` on zero rows.
   */
  private async claimArrival(deliveryId: string, riderId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({ state: 'AT_MERCHANT' })
      .eq('id', deliveryId)
      .eq('state', 'RIDER_ASSIGNED')
      .eq('rider_id', riderId)
      .select('id, state, rider_id')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Arrival claim failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Arrival transition failed' });
    }

    return data ?? null;
  }

  /**
   * Explains a failed guarded UPDATE. Never itself a transition authority —
   * see this file's header.
   */
  private async classifyFailure(deliveryId: string, riderId: string): Promise<never> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Arrival diagnosis read failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Arrival transition failed' });
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    if (data.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    throw new DomainError('INVALID_TRANSITION', {
      details: { deliveryId, from: data.state, to: 'AT_MERCHANT' },
    });
  }

  /**
   * The arrival transition's audit row. Append-only, exactly like
   * `DeliveryReleaseService.writeHistory` — only ever called after the
   * guarded UPDATE has already matched a row.
   */
  private async writeHistory(deliveryId: string, riderId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: 'RIDER_ASSIGNED',
      to_state: 'AT_MERCHANT',
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(`delivery_status_history insert failed for delivery ${deliveryId} (-> AT_MERCHANT): ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery arrival history failed' });
    }
  }
}
