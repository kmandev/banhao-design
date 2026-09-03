import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { DISPATCHABLE_DELIVERY_STATES } from '../rider/dispatch-policy';
import { DISPATCH_STRATEGY, type DispatchStrategy } from '../rider/dispatch-strategy.interface';
import { AgentPort } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { EventNormalizer, type OutboxRowForNormalization } from './event-normalizer';
import { NoRiderTriagePolicySource } from './no-rider-triage-policy';
import { PlaybookRouter } from './playbook-router';
import type {
  AiOpsRunResult,
  NoRiderTriageProjection,
  OperationalEvent,
  PipelineOutcome,
} from './ai-ops.types';

/** How many candidate events one tick examines. A bound, not a policy value — see `MerchantAcceptanceTimeoutService`. */
const BATCH_SIZE = 25;

/** `deliveries`, the columns the projection needs. No fee, payout or earnings column is selected — DEC-040 §3. */
interface DeliveryProjectionRow {
  id: string;
  state: string;
  order_id: string;
  created_at: string;
}

/** `rider_assignment_attempts`, the columns the round history is counted from. */
interface AssignmentAttemptRow {
  rider_id: string;
  round_no: number;
  outcome: string;
}

/**
 * Phase J, vertical slice #2 — the No Rider Triage playbook (design package
 * § 10, "No rider found").
 *
 * ## What it does, and the wall it stops at
 *
 * A delivery that is still searching past DEC-022's decision point is, by that
 * decision, a person's problem rather than the system's. The deterministic
 * ladder already tells the customer at 5 minutes and already logs the 8-minute
 * crossing — but it logs it to stdout, which no supervisor can query. This
 * pipeline turns that crossing into a durable, append-only `audit_logs`
 * escalation carrying the round history and the current eligible-rider count,
 * which is exactly what the design package asks the agent for: "detect that
 * rounds are producing no acceptance, correlate with rider availability, and
 * escalate with round history attached".
 *
 * It stops there, and the stop is structural rather than promised:
 *
 * - **No command exists for it.** The catalog has no cancel, no fail, no
 *   re-broadcast and no customer message, so `ESC-NORIDER` is the only
 *   outcome the agent can reach. DEC-020 forbids auto-cancellation and
 *   UX-Q-006 leaves the terminal outcome open — a command here would be
 *   inventing that answer.
 * - **No `CommandDispatcher` is injected**, so even an agent that returned a
 *   command could not have it executed; the pipeline escalates the attempt as
 *   a boundary violation instead.
 * - **Nothing is said to the customer.** The customer-facing notice is
 *   `NoRiderEscalationService`'s `OrderNoRiderFound` event, written by the
 *   deterministic path with the approved copy inventory. This service writes
 *   no outbox row at all.
 *
 * ## Policy
 *
 * Unlike the merchant-acceptance playbook, this one's policy **resolves**:
 * DEC-022's decision point is approved and already a cited constant. See
 * `Dec022NoRiderTriagePolicySource` for why importing that constant is reuse
 * of one decision rather than the aliasing of two.
 *
 * ## Idempotency and failure safety
 *
 * Identical to slice #1 and bounded in the same honest way: one `audit_logs`
 * row per `(action, delivery)` suppresses sequential re-runs, genuinely
 * concurrent ticks are not covered without a unique constraint this slice is
 * not authorized to add, and the service never throws, so a failure here
 * cannot cost the phases sharing the tick invocation.
 */
@Injectable()
export class NoRiderTriageService {
  private readonly logger = new Logger(NoRiderTriageService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly normalizer: EventNormalizer,
    private readonly router: PlaybookRouter,
    private readonly policy: NoRiderTriagePolicySource,
    private readonly agent: AgentPort,
    private readonly audit: AiAuditService,
    @Inject(DISPATCH_STRATEGY) private readonly dispatchStrategy: DispatchStrategy,
  ) {}

  async run(): Promise<AiOpsRunResult> {
    const empty: AiOpsRunResult = { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 };

    let rows: OutboxRowForNormalization[];
    try {
      rows = await this.listCandidateEvents();
    } catch (cause) {
      this.logger.error(`No-rider triage candidate read failed: ${message(cause)}`);
      return { ...empty, failed: 1 };
    }

    let escalated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const outcome = await this.processOne(row);
        if (outcome === 'ESCALATED') escalated += 1;
        else skipped += 1;
      } catch (cause) {
        failed += 1;
        this.logger.error(`No-rider triage pipeline failed for outbox row: ${message(cause)}`);
      }
    }

    // `acted` is structurally zero: this playbook has no command, so it can
    // never reach the domain. That is the point, not an empty counter.
    return { examined: rows.length, acted: 0, escalated, skipped, failed };
  }

  private async processOne(row: OutboxRowForNormalization): Promise<PipelineOutcome> {
    const event = this.normalizer.normalize(row);

    if (!event) {
      this.logger.warn(
        `ESC-UNKNOWN: unrecognized operational event shape (outbox id ${String(row.id)}, type ${String(row.event_type)})`,
      );
      return 'NO_ACTION';
    }

    const playbook = this.router.route(event);

    if (playbook !== 'NO_RIDER_TRIAGE') {
      // A row this service's own query cannot produce. Counted and logged
      // rather than audited against a delivery that has nothing to do with it.
      this.logger.warn(
        `No-rider triage received an event routing to ${String(playbook)}; ignored`,
      );
      return 'NO_ACTION';
    }

    if (await this.audit.alreadyHandled(EventNormalizer.NO_RIDER_TRIAGE_ACTION, event.aggregateId)) {
      return 'SKIPPED_ALREADY_HANDLED';
    }

    const resolved = this.policy.resolve();

    if (resolved.status === 'MISSING') {
      await this.escalate(event, 'ESC-UNKNOWN', `Policy dependency ${resolved.dependency} is unresolved: ${resolved.detail}`);
      return 'ESCALATED';
    }

    const projection = await this.buildProjection(event);

    if (!projection) {
      await this.escalate(event, 'ESC-UNKNOWN', 'Delivery could not be projected for this event');
      return 'ESCALATED';
    }

    // Deterministic resolution first, so the common cases never reach the
    // agent: a delivery that has since found a rider is settled, and one that
    // has not yet crossed DEC-022's decision point is still the deterministic
    // ladder's to own.
    if (!(DISPATCHABLE_DELIVERY_STATES as readonly string[]).includes(projection.deliveryState)) {
      return 'NO_ACTION';
    }

    if (projection.elapsedSeconds < resolved.value.decisionPointSeconds) {
      return 'NO_ACTION';
    }

    const decision = await this.agent.decide(projection);

    if (decision.kind === 'NO_ACTION') {
      return 'NO_ACTION';
    }

    if (decision.kind === 'COMMAND') {
      // The agent asked for an effect this playbook has no authority to
      // produce. There is no dispatcher here to refuse it *later*, so the
      // request is refused here and recorded — a refused command is evidence,
      // and a sustained rate of them is the design package's § 07 prompt-
      // injection signal.
      await this.escalate(
        event,
        'ESC-UNKNOWN',
        `Agent requested command ${decision.command.name}; the no-rider playbook has no command authority and none was executed`,
      );
      return 'ESCALATED';
    }

    await this.audit.recordEscalation({
      action: EventNormalizer.NO_RIDER_TRIAGE_ACTION,
      entityId: event.aggregateId,
      entityType: 'delivery',
      escalation: decision.escalation,
      reason: decision.reason,
      context: {
        playbook,
        policyVersion: resolved.policyVersion,
        sourceEventId: event.sourceEventId,
        orderId: projection.orderId,
        deliveryState: projection.deliveryState,
        elapsedSeconds: projection.elapsedSeconds,
        roundsBroadcast: projection.roundsBroadcast,
        offersMade: projection.offersMade,
        offersExpired: projection.offersExpired,
        offersDeclined: projection.offersDeclined,
        ridersOffered: projection.ridersOffered,
        ridersEligibleNow: projection.ridersEligibleNow,
      },
    });

    return 'ESCALATED';
  }

  private async escalate(
    event: OperationalEvent,
    escalation: 'ESC-UNKNOWN',
    reason: string,
  ): Promise<void> {
    await this.audit.recordEscalation({
      action: EventNormalizer.NO_RIDER_TRIAGE_ACTION,
      entityId: event.aggregateId,
      entityType: 'delivery',
      escalation,
      reason,
      context: { sourceEventId: event.sourceEventId },
    });
  }

  /**
   * Candidate events — shipped `OrderNoRiderFound` rows, read-only.
   *
   * Newest-first for the reason `MerchantAcceptanceTimeoutService` documents
   * at length: this consumer marks nothing, so an oldest-first read would let
   * a settled backlog fill the batch forever and starve every later delivery.
   */
  private async listCandidateEvents(): Promise<OutboxRowForNormalization[]> {
    const { data, error } = await this.supabase.admin
      .from('outbox')
      .select('id, aggregate_type, aggregate_id, event_type, created_at')
      .eq('event_type', 'OrderNoRiderFound')
      .eq('aggregate_type', 'delivery')
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE)
      .returns<OutboxRowForNormalization[]>();

    if (error) {
      throw new Error(`outbox read failed: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * The scoped projection. Counts, states and clock facts only — no rider id,
   * no rider name or phone, no location, and no financial column anywhere
   * (DEC-040 §3). The eligible-rider count comes from the shipped dispatch
   * strategy rather than from a second copy of DEC-037's eligibility rule, so
   * the number the agent sees is the pool dispatch would actually broadcast
   * to.
   */
  private async buildProjection(event: OperationalEvent): Promise<NoRiderTriageProjection | null> {
    const { data: delivery, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, state, order_id, created_at')
      .eq('id', event.aggregateId)
      .maybeSingle<DeliveryProjectionRow>();

    if (error || !delivery) {
      return null;
    }

    const attempts = await this.listAttempts(delivery.id);
    const ridersEligibleNow = await this.countEligibleRiders();

    // `deliveries.created_at` is the authoritative search-start clock — the
    // same one `roundNumberFor` and `NoRiderEscalationService` derive from. No
    // second clock is introduced.
    const elapsedSeconds = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(delivery.created_at)) / 1000),
    );

    return {
      playbook: 'NO_RIDER_TRIAGE',
      deliveryId: delivery.id,
      orderId: delivery.order_id,
      deliveryState: delivery.state,
      searchingSince: delivery.created_at,
      elapsedSeconds,
      roundsBroadcast: attempts.reduce((max, a) => Math.max(max, a.round_no), 0),
      offersMade: attempts.length,
      offersExpired: attempts.filter((a) => a.outcome === 'EXPIRED').length,
      offersDeclined: attempts.filter((a) => a.outcome === 'DECLINED').length,
      ridersOffered: new Set(attempts.map((a) => a.rider_id)).size,
      ridersEligibleNow,
    };
  }

  private async listAttempts(deliveryId: string): Promise<AssignmentAttemptRow[]> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .select('rider_id, round_no, outcome')
      .eq('delivery_id', deliveryId)
      .returns<AssignmentAttemptRow[]>();

    if (error) {
      // History is context, not authority. An escalation with an incomplete
      // history is still worth raising; suppressing it would leave a stuck
      // delivery invisible because a secondary read failed.
      this.logger.error(`rider_assignment_attempts read failed for delivery ${deliveryId}: ${error.message}`);
      return [];
    }

    return data ?? [];
  }

  private async countEligibleRiders(): Promise<number> {
    try {
      const riderIds = await this.dispatchStrategy.selectCandidateRiderIds();
      // Only the size crosses into the projection. Identities stay here.
      return riderIds.length;
    } catch (cause) {
      this.logger.error(`Eligible rider count failed: ${message(cause)}`);
      return 0;
    }
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
