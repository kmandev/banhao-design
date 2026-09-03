import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { AgentPort } from './agent.port';
import { AiAuditService } from './ai-audit.service';
import { CommandDispatcher } from './command-dispatcher';
import { EventNormalizer, type OutboxRowForNormalization } from './event-normalizer';
import { MerchantAcceptancePolicySource } from './merchant-acceptance-policy';
import { PlaybookRouter } from './playbook-router';
import type {
  AiOpsRunResult,
  OperationalEvent,
  PipelineOutcome,
  ScopedOperationalProjection,
} from './ai-ops.types';

/** How many candidate events one tick examines. A bound, not a policy value — see the class header. */
const BATCH_SIZE = 25;

/** `orders`, the columns the projection needs. No amount, fee or ledger column is selected — DEC-040 §3. */
interface OrderProjectionRow {
  id: string;
  state: string;
  restaurant_id: string;
  paid_at: string | null;
  created_at: string;
}

/**
 * Phase J, vertical slice #1 — the Merchant Acceptance Timeout pipeline.
 *
 * Runs as a tick phase (DEC-APP-010's single 60-second Cloudflare Worker
 * cron), alongside the payment, dispatch, no-rider, POD-retention and outbox
 * phases. No scheduler, queue, broker or cache is introduced — DEC-040 §9.
 *
 * ## The pipeline, in the order DEC-040 fixes it
 *
 * ```
 * outbox row → normalize → route → policy → [agent] → command → domain → verify → audit → resolve/escalate
 * ```
 *
 * Each stage is a separate collaborator so that each boundary is testable in
 * isolation and none of them can quietly acquire the next one's authority.
 *
 * ## What actually happens in production today, and why that is correct
 *
 * The policy stage resolves `MISSING`, because BQ-013 is `OPEN` and no
 * approved merchant-acceptance deadline exists anywhere in this repository.
 * The pipeline therefore **fails closed and escalates `ESC-UNKNOWN`** for
 * every routed event, and the agent is never reached. That is the designed
 * outcome of DEC-040 §5, not an unfinished path: the alternative — picking a
 * plausible number so the flow "works" — is precisely what the decision
 * forbids. The stages below the policy gate are fully implemented and fully
 * tested against an injected policy source, so the day BQ-013 is decided,
 * the change is a constant plus a decision entry, not a new pipeline.
 *
 * ## Idempotency
 *
 * `audit_logs` is the durable record of what has already been handled: one
 * row per `(action, order)`. Its bounds are documented on
 * `AiAuditService.alreadyHandled` and are honest — sequential re-runs are
 * suppressed, genuinely concurrent ticks are not, and closing that would need
 * a unique constraint this slice is not authorized to add.
 *
 * ## Never throws
 *
 * Matching every other tick phase's own contract: a failure here must not
 * fail the phases sharing the tick invocation.
 *
 * `BATCH_SIZE` is a bound on work per invocation, in the same family as
 * `POD_RETENTION_BATCH_SIZE` — it changes how much is examined, never what is
 * decided, so it is not a business policy value under DEC-040 §5.
 */
@Injectable()
export class MerchantAcceptanceTimeoutService {
  private readonly logger = new Logger(MerchantAcceptanceTimeoutService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly normalizer: EventNormalizer,
    private readonly router: PlaybookRouter,
    private readonly policy: MerchantAcceptancePolicySource,
    private readonly agent: AgentPort,
    private readonly dispatcher: CommandDispatcher,
    private readonly audit: AiAuditService,
  ) {}

  async run(): Promise<AiOpsRunResult> {
    const empty: AiOpsRunResult = { examined: 0, acted: 0, escalated: 0, skipped: 0, failed: 0 };

    let rows: OutboxRowForNormalization[];
    try {
      rows = await this.listCandidateEvents();
    } catch (cause) {
      this.logger.error(`AI operations candidate read failed: ${message(cause)}`);
      return { ...empty, failed: 1 };
    }

    let acted = 0;
    let escalated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const outcome = await this.processOne(row);
        if (outcome === 'ACTED') acted += 1;
        else if (outcome === 'ESCALATED') escalated += 1;
        else skipped += 1;
      } catch (cause) {
        failed += 1;
        this.logger.error(`AI operations pipeline failed for outbox row: ${message(cause)}`);
      }
    }

    return { examined: rows.length, acted, escalated, skipped, failed };
  }

  private async processOne(row: OutboxRowForNormalization): Promise<PipelineOutcome> {
    // Stage 1 — normalize.
    const event = this.normalizer.normalize(row);

    if (!event) {
      // An unrecognized or malformed operational event. There is no id to
      // attach an audit row to that would mean anything, so this is logged
      // and counted rather than written against an arbitrary entity —
      // `audit_logs.entity_id` is `not null` and inventing one would
      // misrepresent what happened.
      this.logger.warn(
        `ESC-UNKNOWN: unrecognized operational event shape (outbox id ${String(row.id)}, type ${String(row.event_type)})`,
      );
      return 'NO_ACTION';
    }

    // Stage 2 — deterministic routing. No model call has happened yet, and
    // for an unroutable event none ever will.
    const playbook = this.router.route(event);

    if (!playbook) {
      await this.audit.recordEscalation({
        action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
        entityId: event.aggregateId,
        escalation: 'ESC-UNKNOWN',
        reason: `No playbook routes ${event.eventType} on ${event.aggregateType}`,
        context: { sourceEventId: event.sourceEventId },
      });
      return 'ESCALATED';
    }

    if (await this.audit.alreadyHandled(EventNormalizer.MERCHANT_ACCEPTANCE_ACTION, event.aggregateId)) {
      return 'SKIPPED_ALREADY_HANDLED';
    }

    // Stage 3 — policy. The fail-closed gate.
    const resolved = this.policy.resolve();

    if (resolved.status === 'MISSING') {
      await this.audit.recordEscalation({
        action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
        entityId: event.aggregateId,
        escalation: 'ESC-UNKNOWN',
        reason: `Policy dependency ${resolved.dependency} is unresolved: ${resolved.detail}`,
        context: { playbook, dependency: resolved.dependency, sourceEventId: event.sourceEventId },
      });
      return 'ESCALATED';
    }

    const projection = await this.buildProjection(event);

    if (!projection) {
      await this.audit.recordEscalation({
        action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
        entityId: event.aggregateId,
        escalation: 'ESC-UNKNOWN',
        reason: 'Order could not be projected for this event',
        context: { sourceEventId: event.sourceEventId },
      });
      return 'ESCALATED';
    }

    // Deterministic resolution first: an order that is no longer awaiting
    // acceptance, or has not yet reached the deadline, is settled here and
    // the agent is never invoked. The design package's economic argument is
    // this branch — a model call is the exception, not the pipeline.
    if (projection.orderState !== 'PAID') {
      return 'NO_ACTION';
    }

    if (projection.elapsedSeconds < resolved.value.acceptanceDeadlineSeconds) {
      return 'NO_ACTION';
    }

    // Stage 4 — the agent boundary, reached only now: a playbook is chosen,
    // its policy resolved, and the deterministic branches exhausted.
    const decision = await this.agent.decide(projection);

    if (decision.kind === 'NO_ACTION') {
      return 'NO_ACTION';
    }

    if (decision.kind === 'ESCALATE') {
      await this.audit.recordEscalation({
        action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
        entityId: event.aggregateId,
        escalation: decision.escalation,
        reason: decision.reason,
        context: { playbook, policyVersion: resolved.policyVersion },
      });
      return 'ESCALATED';
    }

    // Stages 5–8 — typed command → catalog/autonomy gate → guarded domain
    // call → verification read. All of it inside the dispatcher; nothing here
    // can reach the domain around it.
    const result = await this.dispatcher.dispatch(decision.command);

    if (result.status === 'EXECUTED') {
      // Stage 9 — audit, `actor_type = 'AI'`.
      await this.audit.recordAction({
        action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
        entityId: event.aggregateId,
        reason: decision.command.reason,
        after: {
          command: decision.command.name,
          policyVersion: resolved.policyVersion,
          result: result.detail,
        },
      });
      return 'ACTED';
    }

    const escalation =
      result.status === 'DOMAIN_REJECTED'
        ? 'ESC-DOMAIN-REJECT'
        : result.status === 'NOT_PERMITTED'
          ? 'ESC-UNKNOWN'
          : 'ESC-RETRY-EXHAUSTED';

    await this.audit.recordEscalation({
      action: EventNormalizer.MERCHANT_ACCEPTANCE_ACTION,
      entityId: event.aggregateId,
      escalation,
      reason: result.detail,
      context: { command: decision.command.name, commandStatus: result.status },
    });

    return 'ESCALATED';
  }

  /**
   * Candidate events: shipped `outbox` rows, read-only.
   *
   * AI Operations is a second *reader* of the outbox and never a writer or a
   * claimer of it — `OutboxDispatchService` alone owns `dispatched_at`. No
   * cursor column is added; the dedupe key checked against `audit_logs` is
   * what prevents reprocessing.
   *
   * ## Why newest-first
   *
   * Because this consumer marks nothing, the candidate set is the *whole*
   * `PaymentSucceeded` history on every tick. Reading it oldest-first means
   * the same `BATCH_SIZE` long-settled rows fill the batch forever and no
   * order paid after them is ever examined — the pipeline would silently stop
   * working at order `BATCH_SIZE + 1`. Newest-first inverts that: an event is
   * examined on the tick after it is written, which is the only tick that
   * matters, since one examination is all the `audit_logs` dedupe key allows.
   *
   * The residual bound is throughput, not correctness: an event is missed only
   * if more than `BATCH_SIZE` orders are paid inside one 60-second tick. That
   * is the same family of bound as `BATCH_SIZE` itself — it changes how much
   * is examined, never what is decided — and it is far above Phase 1 volume.
   * Closing it properly needs a consumer cursor, which is a column this slice
   * is not authorized to add. Recorded as a deferred dependency.
   */
  private async listCandidateEvents(): Promise<OutboxRowForNormalization[]> {
    const { data, error } = await this.supabase.admin
      .from('outbox')
      .select('id, aggregate_type, aggregate_id, event_type, created_at')
      .eq('event_type', 'PaymentSucceeded')
      .eq('aggregate_type', 'order')
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE)
      .returns<OutboxRowForNormalization[]>();

    if (error) {
      throw new Error(`outbox read failed: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * The scoped projection handed to the agent. Selects only operational
   * columns — DEC-040 §3 means no `grand_total_satang`, no fee column, no
   * payment reference, deliberately.
   */
  private async buildProjection(event: OperationalEvent): Promise<ScopedOperationalProjection | null> {
    const { data: order, error } = await this.supabase.admin
      .from('orders')
      .select('id, state, restaurant_id, paid_at, created_at')
      .eq('id', event.aggregateId)
      .maybeSingle<OrderProjectionRow>();

    if (error || !order) {
      return null;
    }

    const { data: delivery } = await this.supabase.admin
      .from('deliveries')
      .select('id')
      .eq('order_id', order.id)
      .limit(1)
      .returns<{ id: string }[]>();

    // `paid_at` is the authoritative start of the merchant-acceptance clock;
    // the outbox row's own timestamp is the fallback for an order whose
    // `paid_at` is somehow unset, and no third clock is introduced.
    const since = order.paid_at ?? event.occurredAt;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));

    return {
      playbook: 'MERCHANT_ACCEPTANCE_TIMEOUT',
      orderId: order.id,
      orderState: order.state,
      restaurantId: order.restaurant_id,
      awaitingAcceptanceSince: since,
      elapsedSeconds,
      hasDelivery: (delivery ?? []).length > 0,
    };
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
