import { Injectable, Logger } from '@nestjs/common';
import { uuidSchema } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { getCorrelationId } from '../../common/correlation/correlation';

/**
 * Deliveries a cancelled order can still strand: everything before pickup.
 *
 * `PICKED_UP`, `EN_ROUTE` and `ARRIVED` are deliberately absent. Once the food
 * has left the shop a cancellation is not the right resolution — DEC-053's
 * operator failure command is, with its own preconditions — and
 * `OPERATOR_CANCELLABLE_STATES` already refuses to cancel the order from
 * there, so this service is never asked about them by the cancel path.
 * `DELIVERED`, `FAILED` and `ABANDONED` are terminal.
 */
const ABANDONABLE_STATES = [
  'UNASSIGNED',
  'RIDER_SEARCHING',
  'RIDER_REASSIGNING',
  'RIDER_ASSIGNED',
  'AT_MERCHANT',
] as const;

/** States in which a rider is genuinely busy with a delivery — used to avoid freeing a slot another delivery holds. */
const RIDER_BUSY_STATES = ['RIDER_ASSIGNED', 'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED'] as const;

/** How many cancelled-order deliveries one tick repairs at most. A bound on work, not a policy value. */
const SWEEP_BATCH_SIZE = 25;

export type AbandonActor =
  | { type: 'CUSTOMER'; id: string }
  | { type: 'OPERATOR'; id: string }
  | { type: 'SYSTEM'; id: null };

export type AbandonOutcome = 'ABANDONED' | 'REPAIRED' | 'NOT_APPLICABLE' | 'NO_DELIVERY';

export interface AbandonmentSweepResult {
  examined: number;
  abandoned: number;
  failed: number;
}

interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
}

/**
 * Closes the delivery of an order that has been cancelled.
 *
 * ## Why this exists
 *
 * Cancelling an order moved `orders.state` and nothing else. The delivery kept
 * its own state, dispatch (which never reads `orders`) kept offering it to
 * riders, a rider could accept an order the customer had already cancelled, and
 * an assigned rider stayed counted as busy. `OPERATOR_CANCELLABLE_STATES`'
 * own comment records the same stranding for the post-pickup states; this
 * closes it for the pre-pickup ones, and it is what makes it safe to let a
 * customer cancel as late as `MERCHANT_ACCEPTED` (DEC-050), which is the
 * moment a delivery row first exists.
 *
 * ## The shape — `DeliveryFailureService`'s, minus the order half
 *
 * 1. **The claim** — guarded `<abandonable state> -> ABANDONED`. The sole
 *    transition authority (ADR-003). `ABANDONED` is the state
 *    `docs/RIDER_LIFECYCLE.md` § 4 names for "operator cancels the order".
 * 2. **The history row** — winner only.
 * 3. **The assignment close** — `rider_assignments` `ACCEPTED -> CANCELLED`.
 * 4. **The rider's slot release** — `active_delivery_count` `1 -> 0`, CAS,
 *    skipped if the rider holds another live delivery.
 *
 * The order is already `CANCELLED` and is not touched. Steps 3–4 are
 * re-runnable, so a delivery found already `ABANDONED` has its tail re-run
 * rather than trusting that the earlier request finished.
 *
 * ## Never fails the cancellation
 *
 * The cancel path calls this *after* the order has been cancelled and treats a
 * failure as a warning: the customer's cancellation must not be reported as
 * failed because of a rider-side repair. {@link sweepCancelledOrders}, run by
 * the tick, finds any delivery of a cancelled order that is still abandonable
 * and finishes the job, so a crash or a transient error between the two writes
 * heals within a tick. It also heals deliveries stranded by cancellations made
 * before this service existed.
 *
 * ## What it does not do
 *
 * No migration, no new state (`ABANDONED` already exists in the CHECK), no
 * payment, refund or ledger write, and no rider notification — a rider whose
 * delivery disappears learns it from their active-delivery read, and the
 * rider-facing wording was never decided.
 */
@Injectable()
export class DeliveryAbandonmentService {
  private readonly logger = new Logger(DeliveryAbandonmentService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async abandonForOrder(orderId: string, actor: AbandonActor, reason: string | undefined): Promise<AbandonOutcome> {
    const delivery = await this.readDelivery(orderId);

    if (!delivery) {
      return 'NO_DELIVERY';
    }

    if (delivery.state === 'ABANDONED') {
      await this.finishTail(delivery);
      return 'REPAIRED';
    }

    if (!(ABANDONABLE_STATES as readonly string[]).includes(delivery.state)) {
      return 'NOT_APPLICABLE';
    }

    const claimed = await this.claim(delivery.id);

    if (!claimed) {
      // Lost the guarded UPDATE to a concurrent request, or the delivery moved
      // on between the read and the write. Re-read and decide.
      const current = await this.readDelivery(orderId);
      if (current?.state === 'ABANDONED') {
        await this.finishTail(current);
        return 'REPAIRED';
      }
      return 'NOT_APPLICABLE';
    }

    await this.writeHistory(delivery.id, delivery.state, actor, reason);
    await this.finishTail(claimed);

    return 'ABANDONED';
  }

  /**
   * Finds deliveries that are still abandonable although their order is
   * `CANCELLED`, and closes them. Run by the tick, before dispatch, so a
   * cancelled order's delivery is not offered to riders again in the same tick.
   *
   * Never throws: one bad delivery must not stop the rest, or the phases behind
   * this one in the tick.
   */
  async sweepCancelledOrders(): Promise<AbandonmentSweepResult> {
    let rows: { order_id: string }[];

    try {
      const { data, error } = await this.supabase.admin
        .from('deliveries')
        // `orders!inner` makes the filter below an inner join: only deliveries
        // whose order is CANCELLED come back, so settled and fixture deliveries
        // can never fill the batch and starve a real one.
        .select('order_id, orders!inner(state)')
        .in('state', [...ABANDONABLE_STATES])
        .eq('orders.state', 'CANCELLED')
        .order('created_at', { ascending: true })
        .limit(SWEEP_BATCH_SIZE)
        .returns<{ order_id: string }[]>();

      if (error) {
        throw new Error(error.message);
      }
      rows = data ?? [];
    } catch (cause) {
      this.logger.error(`Cancelled-order delivery sweep read failed: ${message(cause)}`);
      return { examined: 0, abandoned: 0, failed: 1 };
    }

    let abandoned = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const outcome = await this.abandonForOrder(
          row.order_id,
          { type: 'SYSTEM', id: null },
          'Order was cancelled; closing its delivery',
        );
        if (outcome === 'ABANDONED' || outcome === 'REPAIRED') abandoned += 1;
      } catch (cause) {
        failed += 1;
        this.logger.error(`Abandoning the delivery of cancelled order ${row.order_id} failed: ${message(cause)}`);
      }
    }

    return { examined: rows.length, abandoned, failed };
  }

  private async readDelivery(orderId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id')
      .eq('order_id', orderId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      throw new Error(`deliveries read failed for order ${orderId}: ${error.message}`);
    }
    return data;
  }

  /** The guarded UPDATE: the pre-state lives in the `WHERE` clause. `rider_id` is kept, as a record of who held it. */
  private async claim(deliveryId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({ state: 'ABANDONED' })
      .eq('id', deliveryId)
      .in('state', [...ABANDONABLE_STATES])
      .select('id, state, rider_id')
      .maybeSingle<DeliveryRow>();

    if (error) {
      throw new Error(`deliveries abandon claim failed for ${deliveryId}: ${error.message}`);
    }
    return data;
  }

  private async writeHistory(
    deliveryId: string,
    fromState: string,
    actor: AbandonActor,
    reason: string | undefined,
  ): Promise<void> {
    const correlationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: deliveryId,
      from_state: fromState,
      to_state: 'ABANDONED',
      actor_type: actor.type,
      actor_id: actor.id,
      reason: reason ?? null,
      correlation_id: correlationId.success ? correlationId.data : null,
    });

    if (error) {
      throw new Error(`delivery_status_history insert failed for ${deliveryId}: ${error.message}`);
    }
  }

  /** Steps 3–4. Each is a guarded write that is a no-op once applied, so a repair re-runs both. */
  private async finishTail(delivery: DeliveryRow): Promise<void> {
    if (!delivery.rider_id) {
      return;
    }

    await this.closeAssignment(delivery.id, delivery.rider_id);
    await this.releaseRiderSlot(delivery.id, delivery.rider_id);
  }

  /** `rider_assignments` `ACCEPTED -> CANCELLED`, matched on delivery AND rider so it cannot cross-close another row. Zero rows is success. */
  private async closeAssignment(deliveryId: string, riderId: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('rider_assignments')
      .update({ status: 'CANCELLED', closed_at: new Date().toISOString(), close_reason: 'ORDER_CANCELLED' })
      .eq('delivery_id', deliveryId)
      .eq('rider_id', riderId)
      .eq('status', 'ACCEPTED');

    if (error) {
      throw new Error(`rider_assignments close failed for delivery ${deliveryId}: ${error.message}`);
    }
  }

  /**
   * Frees the rider's single active-delivery slot (`1 -> 0`, CAS) — unless the
   * rider already holds a different live delivery. On a repair the abandoned
   * delivery may be long gone and the rider busy with the next one; freeing the
   * slot then would let them accept a third while carrying a second.
   */
  private async releaseRiderSlot(deliveryId: string, riderId: string): Promise<void> {
    const { data: other, error: otherError } = await this.supabase.admin
      .from('deliveries')
      .select('id')
      .eq('rider_id', riderId)
      .neq('id', deliveryId)
      .in('state', [...RIDER_BUSY_STATES])
      .limit(1)
      .returns<{ id: string }[]>();

    if (otherError) {
      throw new Error(`rider's other deliveries read failed for ${riderId}: ${otherError.message}`);
    }

    if ((other ?? []).length > 0) {
      return;
    }

    const { error } = await this.supabase.admin
      .from('rider_availability')
      .update({ active_delivery_count: 0 })
      .eq('rider_id', riderId)
      .eq('active_delivery_count', 1);

    if (error) {
      throw new Error(`active_delivery_count release failed for rider ${riderId}: ${error.message}`);
    }
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
