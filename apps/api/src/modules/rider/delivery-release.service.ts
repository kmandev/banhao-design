import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema, type RiderCancelDeliveryResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';

/** `deliveries`, read once to decide ownership and to capture the pre-release state. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
}

/** The narrow shape a `.rpc()` or guarded-`UPDATE` error carries — same as `orders.service.ts`'s own. */
interface SupabaseError {
  message: string;
  code?: string;
}

/**
 * `POST /api/v1/rider/deliveries/:id/cancel` — Phase G-3 (DEC-021, V1.1 §6/§9).
 *
 * A rider releases the delivery currently assigned to them. The order is
 * never touched (DEC-018 — Order, Payment, Delivery and Settlement are
 * separate state domains) and `release_rider_assignment()` — already deployed
 * and SQL-tested (`supabase/tests/rider_reassignment_atomicity_test.sql`) — is
 * the sole authority for the delivery/assignment writes this produces. This
 * service never reimplements or duplicates them.
 *
 * ## Three writes, in this order, and why the order matters
 *
 * 1. **The RPC** — `release_rider_assignment(deliveryId, 'RELEASED', reason)`.
 *    Atomically moves `deliveries.state` to `RIDER_SEARCHING`, nulls
 *    `rider_id`, bumps `reassignment_count`, and closes the rider's
 *    `rider_assignments` row. This is the moment the release *actually
 *    happens* — everything after this point is bookkeeping about a release
 *    that already succeeded, never a decision about whether it did.
 * 2. **The availability repair** — a guarded `UPDATE … WHERE active_delivery_count = 1`
 *    on `rider_availability`, the same compare-and-set discipline
 *    `OfferAcceptanceService` uses for the opposite direction (ADR-003: the
 *    state check lives in the `WHERE` clause, never a prior `SELECT`).
 * 3. **The history row** — `delivery_status_history`, append-only, written
 *    only once both of the above are confirmed.
 *
 * **Deliberately not one transaction.** The RPC and the availability repair
 * are two separate network round trips to PostgREST; a crash between them
 * cannot be undone from here. If (2) fails after (1) succeeded, this service
 * does NOT report a clean cancellation — it logs full context and raises
 * `INTERNAL_ERROR`, matching the RPC's own genuine outcome. It does not call
 * the RPC again (idempotency of a second `RELEASED` call is not guaranteed —
 * the delivery would no longer be `RIDER_ASSIGNED`/`RIDER_REASSIGNING`,
 * so a retry would raise `NOT_RELEASABLE`, masking the real fault as a
 * business condition), and it does not fabricate a manual repair — the
 * existing orphan-repair path in `OfferAcceptanceService.reclaimOrphanedSlot`
 * already recovers a stranded `rider_availability` slot on this rider's next
 * accept attempt, and inventing a second repair mechanism here would be
 * exactly the undocumented improvisation this codebase's conventions forbid.
 *
 * ## The release-invariant-violation reconciliation case (Phase G-3.1)
 *
 * V1.1 §9 asks for a `reconciliation_cases` record when the RPC's own
 * backstop fires (`P0001 release invariant violated` — see migration
 * `20260811000013`'s comment "THE BACKSTOP"). `reconciliation_cases.kind`
 * gained `RIDER_RELEASE_INVARIANT` and a nullable `delivery_id` column in
 * migration `20260825000001` (G3.1_RECON_RESULT found the table is,
 * architecturally, a generic infra reconciliation queue — not the
 * payment-exclusive table its original `comment on table` narrowly implied —
 * and V1.1 §9 already named this exact reuse). `openReleaseInvariantCase`
 * writes `{ kind: 'RIDER_RELEASE_INVARIANT', delivery_id, state: 'OPEN' }`
 * plus structured context in `resolution_note` (no new column was added for
 * that — DEC-018/`docs/DATABASE_DESIGN.md` already give this table exactly
 * that free-text field for exactly this purpose). No `rider_id` is written:
 * the backstop raises before either of the RPC's own statements commits (its
 * own comment: "rolls back statement 1 too"), so `deliveries.rider_id` still
 * holds the rider at that moment and is reachable via `delivery_id` alone.
 * A failure to write the case is logged, never thrown past this method — the
 * rider-facing outcome is `INTERNAL_ERROR` either way, and a case-insert
 * failure must not change the response shape the client sees.
 *
 * ## What this service never does
 *
 * No order state, ever (DEC-018, DEC-021 — a rider releasing a delivery moves
 * no order). No payment, ledger, refund, settlement or commission row is
 * read or written. No cancellation penalty, counter or compensation —
 * `rider_earning_satang` is not in any statement here.
 */
@Injectable()
export class DeliveryReleaseService {
  private readonly logger = new Logger(DeliveryReleaseService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async cancelDelivery(
    user: AuthenticatedUser,
    deliveryId: string,
    reason: string | undefined,
  ): Promise<RiderCancelDeliveryResponse> {
    // `@Roles('RIDER')` already refused anyone without an APPROVED rider row
    // (see `RiderController`'s own note on this), so this narrows the type and
    // fails closed if the route is ever wired without the decorator.
    const rider = user.capabilities.rider;
    if (!rider) {
      throw new DomainError('FORBIDDEN', { message: 'Not a rider' });
    }
    const riderId = rider.riderId;

    const delivery = await this.readDelivery(deliveryId);

    if (!delivery) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    // Ownership is `deliveries.rider_id` — never `rider_assignments`
    // (`deliveries.rider_id` is the schema's own documented authority on "who
    // is delivering this right now"; `rider_assignments` is history) — and
    // never the request body. A delivery with no rider, or assigned to
    // someone else, is the same 403 either way.
    if (delivery.rider_id !== riderId) {
      throw new DomainError('NOT_ASSIGNED_RIDER', { details: { deliveryId } });
    }

    const fromState = delivery.state;

    await this.releaseAssignment(deliveryId, riderId, reason);

    // The RPC is authoritative for the delivery's new state and is never
    // re-read to confirm it — `release_rider_assignment` always moves a
    // delivery it accepts to `RIDER_SEARCHING`, never `RIDER_REASSIGNING`
    // (migration 20260811000013, Statement 1).
    const toState = 'RIDER_SEARCHING';

    await this.repairAvailability(riderId, deliveryId);

    await this.writeHistory(deliveryId, fromState, toState, riderId, reason);

    return { deliveryId, state: toState, riderId };
  }

  private async readDelivery(deliveryId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Delivery read failed for ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery read failed' });
    }

    return data ?? null;
  }

  private async releaseAssignment(deliveryId: string, riderId: string, reason: string | undefined): Promise<void> {
    const { error } = await this.supabase.admin.rpc('release_rider_assignment', {
      p_delivery_id: deliveryId,
      p_status: 'RELEASED',
      p_reason: reason ?? null,
    });

    if (error) {
      await this.raiseFromReleaseError(deliveryId, riderId, reason, error);
    }
  }

  /** V1.1 §9's error map. Both P0001 conditions share the SQLSTATE, so the message text is the only way to tell them apart. */
  private async raiseFromReleaseError(
    deliveryId: string,
    riderId: string,
    reason: string | undefined,
    error: SupabaseError,
  ): Promise<never> {
    this.logger.error(
      `release_rider_assignment failed for delivery ${deliveryId} (rider ${riderId}): ${error.message}`,
    );

    if (error.code === '42501' || error.message.includes('service role')) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Release not permitted' });
    }

    if (error.message.includes('release invariant violated')) {
      // The backstop fired: the invariant was already broken by something
      // other than this call (migration 20260811000013's own comment). Never
      // retried, never reported as success — the RPC's own rollback already
      // left the delivery in its pre-release state.
      await this.openReleaseInvariantCase(deliveryId, riderId, reason, error.message);
      throw new DomainError('INTERNAL_ERROR', { message: 'Release invariant violated' });
    }

    if (error.message.includes('not in a releasable state')) {
      throw new DomainError('NOT_RELEASABLE', { details: { deliveryId } });
    }

    throw new DomainError('INTERNAL_ERROR', { message: 'Release failed' });
  }

  /**
   * V1.1 §9's mandated reconciliation case for the release-invariant backstop
   * (Phase G-3.1 — migration `20260825000001` added the `kind` value and the
   * nullable `delivery_id` column this uses). `resolution_note` is the
   * table's own existing free-text field, reused here rather than adding a
   * new column, matching `PaymentEventProcessingService.openCase`'s own
   * service-role write path exactly.
   *
   * Deliberately swallows its own failure: the rider-facing outcome is
   * `INTERNAL_ERROR` regardless of whether this insert succeeds, and letting
   * a case-insert failure escape as an unhandled error would replace that
   * clean `DomainError` response with an opaque one — the caller always
   * throws its own `INTERNAL_ERROR` immediately after this returns.
   */
  private async openReleaseInvariantCase(
    deliveryId: string,
    riderId: string,
    reason: string | undefined,
    rpcMessage: string,
  ): Promise<void> {
    const note =
      `release_rider_assignment backstop fired for rider ${riderId}, delivery ${deliveryId}` +
      (reason ? ` (rider-supplied reason: ${reason})` : '') +
      ` [correlationId=${getCorrelationId() ?? 'none'}] — ${rpcMessage}`;

    const { error } = await this.supabase.admin.from('reconciliation_cases').insert({
      kind: 'RIDER_RELEASE_INVARIANT',
      delivery_id: deliveryId,
      state: 'OPEN',
      resolution_note: note,
    });

    if (error) {
      this.logger.error(
        `reconciliation_cases insert failed (RIDER_RELEASE_INVARIANT) for delivery ${deliveryId}: ${error.message}`,
      );
    }
  }

  /**
   * Repairs `rider_availability.active_delivery_count` after a successful
   * release — guarded CAS, `1 -> 0`, never a blind decrement. Runs after the
   * RPC has already committed, so a failure here must fail closed rather than
   * claim a clean success (see this file's header, "Deliberately not one
   * transaction").
   */
  private async repairAvailability(riderId: string, deliveryId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 0 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 1)
      .select('rider_id, active_delivery_count')
      .maybeSingle<{ rider_id: string; active_delivery_count: number }>();

    if (error) {
      this.logger.error(
        `active_delivery_count repair failed for rider ${riderId} after releasing delivery ${deliveryId}: ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability repair failed' });
    }

    if (!data) {
      this.logger.error(
        `active_delivery_count repair found no matching row for rider ${riderId} after releasing delivery ${deliveryId} (expected active_delivery_count = 1)`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability repair failed' });
    }
  }

  /**
   * The release transition's audit row. Append-only, exactly like
   * `OrdersService.writeHistory` — never the authority on whether the release
   * happened, only ever called after the RPC and the availability repair have
   * both already succeeded.
   */
  private async writeHistory(
    deliveryId: string,
    fromState: string,
    toState: string,
    riderId: string,
    reason: string | undefined,
  ): Promise<void> {
    const correlationId = getCorrelationId();
    const parsedCorrelationId = uuidSchema.safeParse(correlationId);

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: fromState,
      to_state: toState,
      actor_type: 'RIDER',
      actor_id: riderId,
      reason: reason ?? null,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(
        `delivery_status_history insert failed for delivery ${deliveryId} (-> ${toState}): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery release history failed' });
    }
  }
}
