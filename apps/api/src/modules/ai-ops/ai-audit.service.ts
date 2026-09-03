import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { getCorrelationId } from '../../common/correlation/correlation';
import { uuidSchema } from '@banhao/validation';
import type { EscalationId } from './ai-ops.types';

/**
 * Phase J — stage 9 (audit) and stage 10 (escalate).
 *
 * ## `actor_type = 'AI'`, never `SYSTEM`
 *
 * DEC-040 §8 and AI-01. The live `audit_logs_actor_type_check` accepts `'AI'`
 * as of migration `20260903000001` (applied and verified on `banhao-dev`
 * 2026-09-03), which is what makes an agent decision distinguishable from the
 * tick, the dispatch round and the payment processor — all of which
 * legitimately write `SYSTEM`. Writing `SYSTEM` here would re-create exactly
 * the attribution gap AI-01 was opened to close.
 *
 * The append-only model is used as-is and not touched: every record here is an
 * `INSERT`. Nothing in Phase J updates or deletes an audit row, and the
 * `audit_logs_reject_mutation` trigger refuses both for every role including
 * `service_role`. A correction is a new compensating record, never an edit.
 *
 * ## Escalation sink, and the one thing this slice deliberately does not do
 *
 * An escalation is recorded as an `audit_logs` row whose `action` names the
 * escalation id. It is **not** written to `reconciliation_cases`, and that is
 * a considered refusal rather than an omission: that table's `kind` CHECK
 * accepts only `LATE_PAYMENT`, `SURPLUS_PAYMENT`, `AMOUNT_MISMATCH`,
 * `UNMATCHED_EVENT` and `RIDER_RELEASE_INVARIANT`. An AI-operations kind
 * would need an additive CHECK widening — a migration, which DEC-040 §9 says
 * must be explicitly instructed and which this slice is not authorized to
 * make. The design package anticipates exactly this: its V1 supervisor
 * console is designed as a *projection* over `jobs`, `audit_logs` and
 * `reconciliation_cases` precisely so that no migration is required (AI-02).
 * `audit_logs` is therefore the durable, append-only, queryable record a
 * future supervisor surface reads. Recorded as a deferred dependency, not as
 * "escalation is done".
 */
@Injectable()
export class AiAuditService {
  private readonly logger = new Logger(AiAuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Has this operational event already been handled?
   *
   * `audit_logs` is the dedupe record because no AI-operations table exists
   * and this slice adds none. The guarantee is honest and bounded: a
   * sequential re-run of the same tick, or a redelivery of the same outbox
   * row, is suppressed. Two genuinely concurrent ticks are not — `audit_logs`
   * carries no unique constraint on `(action, entity_id)` and adding one is a
   * migration this slice must not make. That is the same read-then-write
   * limitation `NoRiderEscalationService` documents for its own outbox
   * existence check, accepted here for the same reason: DEC-APP-010 fixes a
   * single 60-second cron as the only scheduler, and the worst case is one
   * duplicate notification with no money and no state change behind it.
   *
   * Fail-closed on error: if the check itself fails, the event is reported as
   * already handled, so a database problem produces silence rather than a
   * duplicate operational action.
   */
  async alreadyHandled(action: string, entityId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('id')
      .eq('action', action)
      .eq('entity_id', entityId)
      .limit(1)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(
        `audit_logs dedupe check failed for ${action}/${entityId}; treating as handled: ${error.message}`,
      );
      return true;
    }

    return (data ?? []).length > 0;
  }

  /** One AI action that reached the domain. Never throws — the effect already happened. */
  async recordAction(params: {
    action: string;
    entityId: string;
    reason: string;
    after: Record<string, unknown>;
  }): Promise<void> {
    await this.insert({
      action: params.action,
      entityId: params.entityId,
      reason: params.reason,
      after: params.after,
    });
  }

  /**
   * One escalation. The `after` payload carries the escalation id and the
   * reason a human needs to act on it — ids and states only, no prompt text,
   * no PII copy, matching `audit_logs`' own table comment.
   */
  async recordEscalation(params: {
    action: string;
    entityId: string;
    escalation: EscalationId;
    reason: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    this.logger.warn(
      `AI operations escalation ${params.escalation} on ${params.entityId}: ${params.reason}`,
    );

    await this.insert({
      action: params.action,
      entityId: params.entityId,
      reason: `${params.escalation}: ${params.reason}`,
      after: { escalation: params.escalation, ...(params.context ?? {}) },
    });
  }

  private async insert(params: {
    action: string;
    entityId: string;
    reason: string;
    after: Record<string, unknown>;
  }): Promise<void> {
    const correlationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('audit_logs').insert({
      // DEC-040 §8 / AI-01. Not 'SYSTEM'.
      actor_type: 'AI',
      // No profile row represents the agent, and inventing one would
      // misattribute the action to a person. Null is the honest value —
      // the design package names this as the remaining half of AI-01.
      actor_id: null,
      action: params.action,
      entity_type: 'order',
      entity_id: params.entityId,
      before: null,
      after: params.after,
      reason: params.reason,
      correlation_id: correlationId.success ? correlationId.data : null,
      source: 'worker',
    });

    if (error) {
      // Never throws: an audit write failing must not turn one tick phase's
      // problem into every later phase's problem, matching the never-throws
      // contract every other tick phase documents on itself.
      this.logger.error(`audit_logs write failed for ${params.action}/${params.entityId}: ${error.message}`);
    }
  }
}
