import { Injectable, Logger } from '@nestjs/common';
import {
  DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
  DELIVERY_FAILURE_WAIT_SECONDS,
  uuidSchema,
  type AwaitingFailureDelivery,
  type AwaitingFailureListResponse,
  type DeliveryFailureCause,
  type FailDeliveryRequest,
  type FailDeliveryResponse,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import type { AuthenticatedUser } from '../../common/types';
import { OrdersService } from '../orders/orders.service';
import {
  ARRIVAL_TIMEOUT_DELIVERY_STATE,
  ARRIVAL_TIMEOUT_ORDER_STATE,
  arrivalTimeoutCutoff,
} from '../rider/arrival-timeout-policy';
import { ARRIVAL_TIMEOUT_ACTION } from '../rider/arrival-timeout-escalation.service';

/** `deliveries`, the columns this command reads and writes. */
interface DeliveryRow {
  id: string;
  state: string;
  rider_id: string | null;
  order_id: string;
  arrived_at: string | null;
  failed_at: string | null;
  failure_cause: string | null;
}

/** `orders`, the columns the order-side guard and diagnosis need. */
interface OrderRow {
  id: string;
  state: string;
  cause_code: string | null;
  customer_id: string;
  restaurant_id: string;
}

/** `rider_availability`, the two columns the slot CAS reads back. */
interface RiderAvailabilityRow {
  rider_id: string;
  active_delivery_count: number;
}

/** H-3 locked recipient shape — `outbox.payload.recipients[]`. Duplicated per module, matching every other H-3 writer's own precedent. */
type RecipientType = 'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'OPERATOR';
interface OutboxRecipient {
  recipientId: string;
  recipientType: RecipientType;
}

/** The one delivery state a post-pickup failure may be declared from (DEC-053 § 2, DEC-054). */
const FAILABLE_DELIVERY_STATE = 'ARRIVED';
/** The one order state that pairs with it (DEC-019). */
const FAILABLE_ORDER_STATE = 'DELIVERING';

/** The `audit_logs.action` this command records under. */
const FAILURE_AUDIT_ACTION = 'DELIVERY_FAILURE_DECLARED';

/** How many awaiting-failure rows one page reads. A bound on work, not a policy value. */
const AWAITING_DEFAULT_LIMIT = 50;
const AWAITING_MAX_LIMIT = 100;

/** `deliveries` joined to its order, for the operator's working list. No money column is selected. */
interface AwaitingFailureRow {
  id: string;
  order_id: string;
  rider_id: string | null;
  arrived_at: string;
}

/**
 * `POST /api/v1/admin/supervisor/deliveries/:id/fail` — BQ-017 Slice #2.
 *
 * The operator declares a post-pickup delivery failure: `ARRIVED -> FAILED` on
 * `deliveries` and `DELIVERING -> DELIVERY_FAILED` on `orders`, with one cause
 * recorded on both (DEC-053, unblocked operationally by DEC-054).
 *
 * ## Why this is an operator command, and the first one that moves state
 *
 * Every other supervisor route writes an audit row and changes nothing
 * (`docs/HUMAN_SUPERVISOR_CONTRACT.md` § 5). This one transitions two domains,
 * because DEC-053 § 2 puts the authority there and nowhere else: *"the rider
 * performs the operational steps and produces the evidence; the operator is
 * the authority that declares the failure."* The cause selects an economic
 * outcome (DEC-053 § 5), so no party to the delivery — rider, customer or
 * merchant — may choose it. `@Roles('OPERATOR','ADMIN')` on the controller is
 * that boundary, reusing the existing `platform_staff` grant; no new role, no
 * new permission model, no new table.
 *
 * ## Preconditions are gates, and the guarded UPDATE is still the authority
 *
 * DEC-053 § 3's operational conditions — two contact attempts, five minutes
 * since **customer** arrival — are read and checked before anything is
 * written. They are *policy gates*, not the transition decision: the
 * `WHERE state = 'ARRIVED'` clause in {@link claimFailure} is what actually
 * decides whether this request moved the delivery, exactly as everywhere else
 * in this codebase (ADR-003). A gate that passes on stale data cannot produce
 * a double transition; it can only let a request reach a guarded UPDATE that
 * then refuses it.
 *
 * **The anchor is `deliveries.arrived_at`** (DEC-054) — never `picked_up_at`,
 * `assigned_at`, `created_at`, or the merchant-arrival moment, which has no
 * timestamp at all. Starting the clock at the shop is the precise error
 * DEC-054 exists to prevent.
 *
 * **There is no operator override.** DEC-053 makes the operator the authority
 * *after* its conditions are met, not instead of them. A `force` flag would
 * make the two-attempt and five-minute rules advisory, which is not what the
 * decision says.
 *
 * ## Five writes, in this order — `DeliveryCompletionService`'s proven shape
 *
 * 1. **The delivery claim** — guarded `ARRIVED -> FAILED`, writing `failed_at`
 *    and `failure_cause` in the same statement. Sole transition authority.
 * 2. **The delivery's history row** — winner only, immediately.
 * 3. **The assignment close** — `rider_assignments` `ACCEPTED -> CANCELLED`.
 * 4. **The rider's slot release** — `active_delivery_count` `1 -> 0`, CAS.
 * 5. **The order transition** — `OrdersService.failDelivery`, which owns its
 *    own guarded UPDATE and its own `order_status_history` row.
 *
 * Steps 3–5 are {@link finishTail}, re-runnable in full because each is a
 * guarded write that is a no-op once applied. That is what closes the
 * order/delivery split: any retry re-runs the whole tail rather than having to
 * work out how far an earlier request got.
 *
 * ## Idempotency and the conflicting-cause rule
 *
 * A retry whose delivery is already `FAILED` **with the same cause** re-runs
 * the tail and reports success — the effect this call wanted has happened.
 * One already `FAILED` with a **different** cause is `CONFLICT`: a cause is an
 * economic attribution, and silently overwriting one operator's finding with
 * another's would rewrite who bears the loss. Any other state is
 * `INVALID_TRANSITION`.
 *
 * The audit row and the outbox event are written by the **winner only**,
 * matching `DeliveryCompletionService`'s own treatment of `OrderDelivered`:
 * neither table carries a natural key this service could deduplicate on, and a
 * repair is by definition a retry of a request whose winner already recorded
 * both.
 *
 * ## What this service never does
 *
 * It never calls `release_rider_assignment()` — that RPC refuses post-pickup
 * states and would return the delivery to `RIDER_SEARCHING`, re-offering a
 * delivery whose food is gone. It never marks the assignment `COMPLETED`; the
 * delivery was not completed. It never writes a payment, refund, ledger,
 * earning, compensation, commission, promotion or settlement row — DEC-053's
 * economics are policy that nothing executes while **Q-020** and **BQ-024**
 * are open. It never notifies an operator through `notifications`: Phase H
 * skips `OPERATOR` recipients by design, and operator visibility is the audit
 * trail and the supervisor inbox.
 */
@Injectable()
export class DeliveryFailureService {
  private readonly logger = new Logger(DeliveryFailureService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * The operator's working list — BQ-017 Slice #3.
   *
   * Deliveries that have been `ARRIVED` at the customer for at least DEC-053's
   * five minutes and whose order is still `DELIVERING`. Read-only: nothing is
   * claimed, assigned, locked or consumed, and a delivery leaves this list
   * only by actually being resolved.
   *
   * ## Why it lives here rather than in `SupervisorCaseService`
   *
   * A *case* in that service is an `audit_logs` row written by an AI Operations
   * playbook — it filters `actor_type = 'AI'` and `AI_OPS_*`, and its subject
   * is whatever the agent escalated on. This list is neither: its rows are live
   * `deliveries`, its eligibility is DEC-053's own precondition set, and its
   * companion is {@link failDelivery} directly above it. Putting it beside the
   * command means one class owns "what DEC-053 considers actionable", so the
   * operator can never be shown a case the command would then refuse — which
   * two independent copies of the predicate would eventually produce.
   *
   * The shared constants come from `arrival-timeout-policy.ts`, so this listing
   * and `ArrivalTimeoutEscalationService` select the same population.
   *
   * ## What it deliberately does not carry
   *
   * No amount, fee, total, refund, payout or compensation — the projection
   * discipline `docs/HUMAN_SUPERVISOR_CONTRACT.md` § 7 imposes on every
   * supervisor surface, and here also because DEC-053's economics are blocked
   * on Q-020 and BQ-024. No `causeCode`: the cause is what the operator
   * decides, and offering one before they have would be the system proposing
   * the economic outcome it may not choose.
   *
   * `failureResolvable` reports whether every DEC-053 precondition is already
   * met. A `false` never hides a row — a delivery waiting on the rider's second
   * contact attempt is often the one an operator most needs to see.
   */
  async listAwaitingFailure(limit = AWAITING_DEFAULT_LIMIT): Promise<AwaitingFailureListResponse> {
    const bounded = Math.min(
      Math.max(Math.trunc(limit) || AWAITING_DEFAULT_LIMIT, 1),
      AWAITING_MAX_LIMIT,
    );
    const now = new Date();

    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, order_id, rider_id, arrived_at')
      .eq('state', ARRIVAL_TIMEOUT_DELIVERY_STATE)
      // `arrived_at` is DEC-054's anchor. A null cannot satisfy `.lte(...)`,
      // so a delivery with no recorded arrival is excluded by the query
      // itself rather than by a check that could be forgotten.
      .lte('arrived_at', arrivalTimeoutCutoff(now))
      .order('arrived_at', { ascending: true })
      .limit(bounded)
      .returns<AwaitingFailureRow[]>();

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Awaiting-failure read failed: ${error.message}`,
      });
    }

    const rows = data ?? [];

    if (rows.length === 0) {
      return { deliveries: [], window: { limit: bounded, returned: 0, resolvableInWindow: 0 } };
    }

    // The order half of eligibility, plus the order number an operator needs
    // to find the case in any other surface. Live state, never a snapshot.
    const orders = await this.readDeliveringOrders(rows.map((row) => row.order_id));
    const attempts = await this.countContactAttemptsFor(rows.map((row) => row.id));
    const escalated = await this.listEscalatedIds(rows.map((row) => row.id));

    const deliveries: AwaitingFailureDelivery[] = [];

    for (const row of rows) {
      const order = orders.get(row.order_id);

      // An order that has ended some other way is not a case this operator can
      // act on with the failure command, so it is not shown as one.
      if (!order) {
        continue;
      }

      const waitedSeconds = Math.max(
        0,
        Math.floor((now.getTime() - new Date(row.arrived_at).getTime()) / 1000),
      );
      const contactAttempts = attempts.get(row.id) ?? 0;

      deliveries.push({
        deliveryId: row.id,
        orderId: row.order_id,
        orderNumber: order.order_number,
        riderId: row.rider_id,
        deliveryState: ARRIVAL_TIMEOUT_DELIVERY_STATE,
        orderState: ARRIVAL_TIMEOUT_ORDER_STATE,
        arrivedAt: row.arrived_at,
        waitedSeconds,
        waitSecondsRequired: DELIVERY_FAILURE_WAIT_SECONDS,
        contactAttempts,
        contactAttemptsRequired: DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
        // Every DEC-053 precondition, evaluated exactly as `failDelivery`
        // evaluates them — the wait is already implied by the query above.
        failureResolvable: contactAttempts >= DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
        escalated: escalated.has(row.id),
      });
    }

    return {
      deliveries,
      window: {
        limit: bounded,
        returned: deliveries.length,
        resolvableInWindow: deliveries.filter((d) => d.failureResolvable).length,
      },
    };
  }

  /** The still-`DELIVERING` orders among these ids, keyed by id. No money column is selected. */
  private async readDeliveringOrders(
    orderIds: string[],
  ): Promise<Map<string, { order_number: string }>> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, order_number, state')
      .in('id', [...new Set(orderIds)])
      .eq('state', ARRIVAL_TIMEOUT_ORDER_STATE)
      .returns<{ id: string; order_number: string; state: string }[]>();

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Awaiting-failure order read failed: ${error.message}`,
      });
    }

    return new Map((data ?? []).map((row) => [row.id, { order_number: row.order_number }]));
  }

  /**
   * Contact-attempt counts for a whole page, in one read.
   *
   * Counted from the rows rather than with a per-delivery `count` query: the
   * cap is two per delivery (`delivery_contact_attempts`' own constraints), so
   * a page of 100 deliveries reads at most 200 rows.
   */
  private async countContactAttemptsFor(deliveryIds: string[]): Promise<Map<string, number>> {
    const { data, error } = await this.supabase.admin
      .from('delivery_contact_attempts')
      .select('delivery_id')
      .in('delivery_id', deliveryIds)
      .returns<{ delivery_id: string }[]>();

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Awaiting-failure contact attempt read failed: ${error.message}`,
      });
    }

    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      counts.set(row.delivery_id, (counts.get(row.delivery_id) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Which of these deliveries the tick has already escalated.
   *
   * Presence only. An escalation is a record that the wait elapsed, never a
   * claim on the work and never a precondition of resolving it — an operator
   * who reaches a delivery before the tick does may still fail it.
   *
   * A read failure here degrades to "not escalated" rather than failing the
   * whole listing: the flag is advisory, and losing it must not cost an
   * operator their working list.
   */
  private async listEscalatedIds(deliveryIds: string[]): Promise<Set<string>> {
    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('entity_id')
      .eq('action', ARRIVAL_TIMEOUT_ACTION)
      .eq('entity_type', 'delivery')
      .in('entity_id', deliveryIds)
      .returns<{ entity_id: string }[]>();

    if (error) {
      this.logger.error(`Awaiting-failure escalation read failed: ${error.message}`);
      return new Set();
    }

    return new Set((data ?? []).map((row) => row.entity_id));
  }

  async failDelivery(
    user: AuthenticatedUser,
    deliveryId: string,
    request: FailDeliveryRequest,
  ): Promise<FailDeliveryResponse> {
    const staff = user.capabilities.platformStaff;

    if (!staff) {
      // Belt and braces behind `@Roles('OPERATOR','ADMIN')`, matching
      // `SupervisorCaseService.resolveCase`: the guard already refused a
      // non-staff caller, and this refuses a principal that somehow reached
      // the service without the grant the audit row must record.
      throw new DomainError('FORBIDDEN', { message: 'Platform staff grant required' });
    }

    const delivery = await this.readDelivery(deliveryId);

    if (!delivery) {
      throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
    }

    // A delivery already resolved is answered before the preconditions are
    // re-checked: a retry must not be refused for a five-minute window that
    // has since become irrelevant, and a conflicting cause must be reported
    // as a conflict rather than as an unmet precondition.
    if (delivery.state !== FAILABLE_DELIVERY_STATE) {
      return this.repairFailure(user, delivery, request);
    }

    const order = await this.readOrder(delivery.order_id);
    await this.assertPreconditions(delivery, order, request.causeCode);

    const claimed = await this.claimFailure(deliveryId, request.causeCode);

    if (!claimed) {
      // Lost the guarded UPDATE to a concurrent request, or the delivery left
      // ARRIVED between the read above and the write. Re-read and let the
      // repair path decide whether that is a success or a refusal.
      const current = await this.readDelivery(deliveryId);
      if (!current) {
        throw new DomainError('NOT_FOUND', { message: 'Delivery not found' });
      }
      return this.repairFailure(user, current, request);
    }

    // The delivery has genuinely moved to FAILED, and this request is the one
    // that moved it. Record that before anything else can fail.
    await this.writeDeliveryHistory(claimed, user, request);

    await this.finishTail(user, claimed, request);

    // Winner-only, exactly like `DeliveryCompletionService`'s OrderDelivered
    // event and for the same reason.
    await this.writeAudit(claimed, user, request, staff.staffRole);
    await this.writeOrderDeliveryFailedOutboxEvent(claimed);

    return this.response(claimed, request.causeCode);
  }

  /**
   * Reached when the delivery is not `ARRIVED` — either because an earlier
   * request already resolved it, or because it is somewhere this command may
   * not act.
   *
   * Only `FAILED` **with this call's own cause** is repairable. Everything
   * else is a refusal, and none of them writes anything.
   */
  private async repairFailure(
    user: AuthenticatedUser,
    delivery: DeliveryRow,
    request: FailDeliveryRequest,
  ): Promise<FailDeliveryResponse> {
    if (delivery.state !== 'FAILED') {
      throw new DomainError('INVALID_TRANSITION', {
        details: { deliveryId: delivery.id, from: delivery.state, to: 'FAILED' },
      });
    }

    if (delivery.failure_cause !== request.causeCode) {
      // A cause is an economic attribution (DEC-053 § 5). Overwriting one
      // operator's finding with another's would rewrite who bears the loss.
      throw new DomainError('CONFLICT', {
        message: 'This delivery was already failed under a different cause',
        details: {
          deliveryId: delivery.id,
          recordedCause: delivery.failure_cause,
          requestedCause: request.causeCode,
        },
      });
    }

    this.logger.warn(
      `Repairing failure resolution for delivery ${delivery.id}: already FAILED under ${delivery.failure_cause}, ` +
        `re-running the tail (assignment close, slot release, order ${delivery.order_id})`,
    );

    // No history, audit or outbox write on this path — the request that moved
    // the delivery already wrote all three. See this file's header.
    await this.finishTail(user, delivery, request);

    return this.response(delivery, request.causeCode);
  }

  /**
   * Steps 3–5, run identically by the winner and by a repair.
   *
   * Every step is a guarded write that is a no-op once already applied, which
   * is what lets a repair re-run all of them rather than having to determine
   * which of them an earlier request completed before it died — the same
   * property `DeliveryCompletionService.finishTail` relies on.
   */
  private async finishTail(
    user: AuthenticatedUser,
    delivery: DeliveryRow,
    request: FailDeliveryRequest,
  ): Promise<void> {
    if (delivery.rider_id) {
      await this.closeAssignment(delivery.id, delivery.rider_id);
      await this.releaseRiderSlot(delivery.rider_id, delivery.id);
    }

    await this.advanceOrder(user, delivery, request);
  }

  /**
   * DEC-053 § 3's operational conditions, checked against live state.
   *
   * All four are refused with `CONFLICT` — the request was well-formed and the
   * operator did nothing wrong; the world is not yet in a state where this
   * command is legal. `details` names which condition failed, so the console
   * can say *why* rather than showing a generic refusal.
   */
  private async assertPreconditions(
    delivery: DeliveryRow,
    order: OrderRow | null,
    causeCode: DeliveryFailureCause,
  ): Promise<void> {
    if (!order) {
      throw new DomainError('NOT_FOUND', { message: 'Order not found' });
    }

    if (order.state !== FAILABLE_ORDER_STATE) {
      throw new DomainError('CONFLICT', {
        message: `The order must be ${FAILABLE_ORDER_STATE} to declare a delivery failure`,
        details: { orderId: order.id, orderState: order.state, requestedCause: causeCode },
      });
    }

    // DEC-054's anchor. A delivery in ARRIVED always has one — the transition
    // that set the state set the timestamp in the same statement — so a null
    // here is a corrupted row, refused rather than treated as "long ago".
    if (!delivery.arrived_at) {
      this.logger.error(
        `Delivery ${delivery.id} is ARRIVED with no arrived_at — the DEC-053 wait has no anchor`,
      );
      throw new DomainError('CONFLICT', {
        message: 'This delivery has no recorded customer-arrival time',
        details: { deliveryId: delivery.id },
      });
    }

    const waitedSeconds = (Date.now() - new Date(delivery.arrived_at).getTime()) / 1000;

    if (waitedSeconds < DELIVERY_FAILURE_WAIT_SECONDS) {
      throw new DomainError('CONFLICT', {
        message: `The delivery must wait ${DELIVERY_FAILURE_WAIT_SECONDS / 60} minutes from customer arrival before it may be failed`,
        details: {
          deliveryId: delivery.id,
          arrivedAt: delivery.arrived_at,
          waitSecondsRequired: DELIVERY_FAILURE_WAIT_SECONDS,
          waitSecondsElapsed: Math.max(0, Math.floor(waitedSeconds)),
        },
      });
    }

    const attempts = await this.countContactAttempts(delivery.id);

    if (attempts < DELIVERY_CONTACT_ATTEMPTS_REQUIRED) {
      throw new DomainError('CONFLICT', {
        message: `The rider must record ${DELIVERY_CONTACT_ATTEMPTS_REQUIRED} customer contact attempts before this delivery may be failed`,
        details: {
          deliveryId: delivery.id,
          attemptsRecorded: attempts,
          attemptsRequired: DELIVERY_CONTACT_ATTEMPTS_REQUIRED,
        },
      });
    }
  }

  /**
   * The guarded UPDATE — the pre-state lives in the `WHERE` clause, and
   * `failed_at`/`failure_cause` are written in the same statement.
   *
   * That pairing is what makes the cause effectively write-once: there is no
   * window in which a delivery is `FAILED` with no cause, and a second call
   * matches zero rows and never reaches the write. The *database* does not
   * enforce it — `deliveries` deliberately carries no column-immutability
   * trigger, so `state` and `rider_id` can advance freely — so this is an
   * application rule, stated as plainly as `DeliveryCompletionService` states
   * the same property for `proof_photo_path`.
   *
   * No ownership filter: unlike every rider transition, the operator is not a
   * party to this delivery. The grant is the authorization, and it was checked
   * by the guard and re-checked at the top of {@link failDelivery}.
   */
  private async claimFailure(
    deliveryId: string,
    causeCode: DeliveryFailureCause,
  ): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .update({
        state: 'FAILED',
        failed_at: new Date().toISOString(),
        failure_cause: causeCode,
      })
      .eq('id', deliveryId)
      .eq('state', FAILABLE_DELIVERY_STATE)
      .select('id, state, rider_id, order_id, arrived_at, failed_at, failure_cause')
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Failure claim failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery failure transition failed' });
    }

    return data ?? null;
  }

  /**
   * `rider_assignments` `ACCEPTED -> CANCELLED` for this delivery's rider.
   *
   * `CANCELLED`, never `COMPLETED`: the delivery was not completed, and
   * `rider_assignments.status`'s CHECK admits no `FAILED` — widening it would
   * be a migration this slice does not need, since `CANCELLED` with a
   * `close_reason` already says exactly what happened.
   *
   * **Not `release_rider_assignment()`.** That RPC accepts only
   * `RIDER_ASSIGNED`/`RIDER_REASSIGNING`, and it *nulls* `deliveries.rider_id`
   * and sends the delivery back to `RIDER_SEARCHING` — which would re-offer a
   * delivery whose food is already gone. The direct guarded close is
   * `DeliveryCompletionService.closeAssignment`'s shape, for the same reason.
   *
   * Matched on `delivery_id` AND `rider_id` AND `status = 'ACCEPTED'`, so it
   * can never cross-close another rider's row. Zero rows is a success: on a
   * retry the row is already `CANCELLED` and the guard matches nothing.
   */
  private async closeAssignment(deliveryId: string, riderId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignments')
      .update({
        status: 'CANCELLED',
        closed_at: new Date().toISOString(),
        close_reason: 'DELIVERY_FAILED',
      })
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
          `already closed, or never recorded. Failure resolution proceeds.`,
      );
    }
  }

  /**
   * Frees the rider's single active-delivery slot — the same guarded `1 -> 0`
   * CAS `DeliveryCompletionService.releaseRiderSlot` performs, and mandatory
   * for the same reason: without it a rider whose delivery failed stays
   * counted as busy and can accept no further work.
   *
   * The CAS is what makes a retry safe — a second call finds the count already
   * `0`, matches nothing, and cannot decrement past zero.
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
        `active_delivery_count release failed for rider ${riderId} after failing delivery ${deliveryId}: ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }

    if (data) {
      return;
    }

    await this.assertSlotAlreadyReleased(riderId, deliveryId);
  }

  /**
   * Diagnostic only — reached when the `1 -> 0` CAS matched nothing, to decide
   * whether that is the benign case (already 0) or the broken one (no row at
   * all). A read failure must not be reported as a released slot, so it raises
   * too: this method's contract is "prove the slot is free".
   */
  private async assertSlotAlreadyReleased(riderId: string, deliveryId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .select('rider_id, active_delivery_count')
      .eq('rider_id', riderId)
      .maybeSingle<RiderAvailabilityRow>();

    if (error || !data) {
      this.logger.error(
        `active_delivery_count verification failed for rider ${riderId} after failing delivery ${deliveryId}: ` +
          `${error?.message ?? 'no rider_availability row'}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }

    if (data.active_delivery_count !== 0) {
      this.logger.error(
        `Rider ${riderId} still holds ${data.active_delivery_count} active deliveries after failing ${deliveryId}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Rider availability release failed' });
    }
  }

  /**
   * The order half, made idempotent.
   *
   * `OrdersService.failDelivery` is the authority and is called first,
   * unconditionally — its own guarded `WHERE state = 'DELIVERING'` decides,
   * and an order in any other state matches zero rows and is left untouched.
   *
   * Only on failure does this read `orders`, and only to answer one question:
   * *did the effect this call wanted already happen?* An order already
   * `DELIVERY_FAILED` **under the same cause** means yes. Under a *different*
   * cause it is a conflict, for the same reason {@link repairFailure} refuses
   * one. Any other state and the original error propagates unchanged.
   *
   * Same diagnose-only-after-the-authority-has-spoken shape
   * `DeliveryCompletionService.advanceOrder` uses.
   */
  private async advanceOrder(
    user: AuthenticatedUser,
    delivery: DeliveryRow,
    request: FailDeliveryRequest,
  ): Promise<void> {
    try {
      await this.orders.failDelivery(user, delivery.order_id, request.causeCode, request.reason);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const order = await this.readOrder(delivery.order_id);

      if (order?.state === 'DELIVERY_FAILED') {
        if (order.cause_code !== request.causeCode) {
          throw new DomainError('CONFLICT', {
            message: 'This order was already failed under a different cause',
            details: {
              orderId: order.id,
              recordedCause: order.cause_code,
              requestedCause: request.causeCode,
            },
          });
        }

        this.logger.warn(
          `Order ${order.id} was already DELIVERY_FAILED when delivery ${delivery.id} re-attempted ` +
            `its transition; treating the order half as already complete: ${message}`,
        );
        return;
      }

      this.logger.error(
        `Order transition to DELIVERY_FAILED failed for order ${delivery.order_id} after delivery ` +
          `${delivery.id} had already moved to FAILED: ${message}. The delivery stays FAILED; ` +
          `retrying this command will re-attempt the order half.`,
      );
      throw cause;
    }
  }

  /** The delivery, read for gating and diagnosis. Never what decides a transition (ADR-003). */
  private async readDelivery(deliveryId: string): Promise<DeliveryRow | null> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, rider_id, order_id, arrived_at, failed_at, failure_cause')
      .eq('id', deliveryId)
      .maybeSingle<DeliveryRow>();

    if (error) {
      this.logger.error(`Delivery read failed for failure resolution ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery failure transition failed' });
    }

    return data ?? null;
  }

  /** The order, read for gating and diagnosis. Carries no money column into this service. */
  private async readOrder(orderId: string): Promise<OrderRow | null> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, state, cause_code, customer_id, restaurant_id')
      .eq('id', orderId)
      .maybeSingle<OrderRow>();

    if (error) {
      this.logger.error(`Order read failed for failure resolution ${orderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery failure transition failed' });
    }

    return data ?? null;
  }

  /** How many contact attempts this delivery holds — DEC-053 § 3's first precondition. */
  private async countContactAttempts(deliveryId: string): Promise<number> {
    const { count, error } = await this.supabase.admin
      .from('delivery_contact_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_id', deliveryId);

    if (error) {
      this.logger.error(`Contact attempt count failed for delivery ${deliveryId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery failure transition failed' });
    }

    return count ?? 0;
  }

  /**
   * The delivery domain's own record of the transition. Append-only, written
   * by the guarded-UPDATE winner only, which is what makes "exactly one row" a
   * structural property rather than a checked one.
   *
   * `actor_type = 'OPERATOR'` and the operator's own profile id — never
   * `SYSTEM`, never the rider. The reason is carried too: this is the only
   * delivery-domain transition an operator performs, and DEC-032 makes their
   * reason mandatory.
   */
  private async writeDeliveryHistory(
    delivery: DeliveryRow,
    user: AuthenticatedUser,
    request: FailDeliveryRequest,
  ): Promise<void> {
    const parsedCorrelationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('delivery_status_history').insert({
      delivery_id: delivery.id,
      from_state: FAILABLE_DELIVERY_STATE,
      to_state: 'FAILED',
      actor_type: 'OPERATOR',
      actor_id: user.id,
      reason: request.reason,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
    });

    if (error) {
      this.logger.error(
        `delivery_status_history insert failed for delivery ${delivery.id} (-> FAILED): ${error.message}`,
      );
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery failure history failed' });
    }
  }

  /**
   * The operator-intervention record (DEC-032). Winner only.
   *
   * `actor_type = 'OPERATOR'` with the acting profile's id, and the mandatory
   * reason — which `audit_logs_operator_reason_check` enforces as a database
   * invariant, not an application courtesy. `staffRole` is recorded in `after`
   * because the CHECK has no `ADMIN` value, exactly as
   * `SupervisorCaseService.resolveCase` already does.
   *
   * `after` carries ids, states and the cause. **No amount, fee, refund or
   * payout appears in it** — DEC-053's economics are policy that nothing
   * executes, and an audit row naming a refund would record an effect that did
   * not happen.
   *
   * Never throws: the transition has already succeeded and been reported, and
   * losing the audit row must not turn that into a client-visible 500. It is
   * logged loudly instead — the same best-effort discipline
   * `ProofPhotoRetentionService.writeAuditRecord` documents.
   */
  private async writeAudit(
    delivery: DeliveryRow,
    user: AuthenticatedUser,
    request: FailDeliveryRequest,
    staffRole: string,
  ): Promise<void> {
    const parsedCorrelationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('audit_logs').insert({
      actor_type: 'OPERATOR',
      actor_id: user.id,
      action: FAILURE_AUDIT_ACTION,
      entity_type: 'delivery',
      entity_id: delivery.id,
      before: { state: FAILABLE_DELIVERY_STATE },
      after: {
        state: 'FAILED',
        orderId: delivery.order_id,
        orderState: 'DELIVERY_FAILED',
        causeCode: request.causeCode,
        staffRole,
      },
      reason: request.reason,
      correlation_id: parsedCorrelationId.success ? parsedCorrelationId.data : null,
      source: 'api',
    });

    if (error) {
      this.logger.error(
        `audit_logs insert failed for ${FAILURE_AUDIT_ACTION} (delivery ${delivery.id}): ${error.message}`,
      );
    }
  }

  /**
   * `OrderDeliveryFailed` — CUSTOMER and MERCHANT, the two parties whose order
   * just ended. Winner only, and best-effort: the failure has already been
   * declared and reported, so a lost notification must not turn it into a 500.
   *
   * **No `OPERATOR` recipient.** `OutboxDispatchService` skips them by design
   * (Phase H), so adding one would write a row that is silently dropped and
   * imply an operator channel that does not exist. Operator visibility is the
   * `audit_logs` row above and the supervisor inbox that projects it.
   */
  private async writeOrderDeliveryFailedOutboxEvent(delivery: DeliveryRow): Promise<void> {
    const order = await this.readOrderRecipients(delivery.order_id);

    if (!order) {
      this.logger.error(
        `OrderDeliveryFailed recipient resolution: orders read failed for delivery ${delivery.id}`,
      );
      return;
    }

    const recipients: OutboxRecipient[] = [
      { recipientId: order.customer_id, recipientType: 'CUSTOMER' },
    ];

    const merchantOwnerId = await this.resolveMerchantOwnerId(order.restaurant_id);
    if (merchantOwnerId) {
      recipients.push({ recipientId: merchantOwnerId, recipientType: 'MERCHANT' });
    }

    const { error } = await this.supabase.admin.from('outbox').insert({
      aggregate_type: 'delivery',
      aggregate_id: delivery.id,
      event_type: 'OrderDeliveryFailed',
      payload: { recipients },
    });

    if (error) {
      this.logger.error(
        `outbox insert failed for OrderDeliveryFailed (delivery ${delivery.id}): ${error.message}`,
      );
    }
  }

  /** Recipient resolution only — never throws, matching the outbox writer's contract. */
  private async readOrderRecipients(orderId: string): Promise<OrderRow | null> {
    const { data, error } = await this.supabase.admin
      .from('orders')
      .select('id, state, cause_code, customer_id, restaurant_id')
      .eq('id', orderId)
      .maybeSingle<OrderRow>();

    if (error) {
      this.logger.error(`Order recipient read failed for ${orderId}: ${error.message}`);
      return null;
    }

    return data ?? null;
  }

  /** `restaurants.merchant_id -> merchants.owner_user_id`, same as the completion path's. */
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
        `Merchant-owner resolution: merchants read failed for ${restaurant.merchant_id}: ${merchantError?.message ?? 'not found'}`,
      );
      return null;
    }

    return merchant.owner_user_id;
  }

  private response(delivery: DeliveryRow, causeCode: DeliveryFailureCause): FailDeliveryResponse {
    return {
      deliveryId: delivery.id,
      orderId: delivery.order_id,
      state: 'FAILED',
      orderState: 'DELIVERY_FAILED',
      causeCode,
      failedAt: delivery.failed_at,
    };
  }
}
