import { Injectable, Logger } from '@nestjs/common';
import type {
  ResolveSupervisorCaseRequest,
  ResolveSupervisorCaseResponse,
  SupervisorCaseDetailResponse,
  SupervisorCaseListResponse,
  SupervisorCaseResolution,
  SupervisorCaseSubject,
  SupervisorCaseSummary,
  SupervisorTimelineEntry,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import { uuidSchema } from '@banhao/validation';
import type { AuthenticatedUser } from '../../common/types';
import {
  AI_OPS_ACTION_PREFIX,
  CASE_RESOLVED_ACTION,
  blockedByFor,
  evidenceOf,
  isEscalationRow,
  resolutionOf,
  resolvedCaseIdOf,
  toCaseSummary,
  type AuditRowForProjection,
} from './supervisor-case.projection';

/** How many escalations one inbox page reads. A bound on work, not a policy value. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** How many timeline entries a case detail carries per source. */
const TIMELINE_LIMIT = 25;

interface OrderSubjectRow {
  id: string;
  order_number: string;
  state: string;
  restaurant_id: string;
  created_at: string;
  paid_at: string | null;
}

interface DeliverySubjectRow {
  id: string;
  order_id: string;
  state: string;
  created_at: string;
  rider_id: string | null;
}

interface StatusHistoryRow {
  from_state: string | null;
  to_state: string;
  actor_type: string;
  reason: string | null;
  occurred_at: string;
}

/**
 * Phase I — the Human Supervisor case projection and its one command.
 *
 * Read `docs/HUMAN_SUPERVISOR_CONTRACT.md` first; this class implements § 4
 * and § 5 of it. Three properties are structural rather than stylistic:
 *
 * ## There is no case table, and this adds none
 *
 * A case **is** an `audit_logs` row: one written by AI Operations, with
 * `actor_type = 'AI'`, an `AI_OPS_*` action and an `after.escalation`. Its id
 * is that row's id. State is derived by looking for a later
 * `AI_OPS_CASE_RESOLVED` row that names it. This is the AI-02 projection the
 * design package specifies precisely so that no migration is required, and
 * DEC-040 § 9 forbids the alternative.
 *
 * ## Nothing here mutates domain state
 *
 * The only write is one append-only audit row. No order, delivery, payment,
 * rider or merchant row is updated by any path in this file, and there is no
 * generic mutation entry point for one to hide behind. Commands that *would*
 * move domain state are absent because their policy is open — see
 * `blockedByFor`, which names the decision rather than shipping a disabled
 * button that implies the capability exists.
 *
 * ## Human attribution, never `SYSTEM`
 *
 * A resolution is written with `actor_type = 'OPERATOR'` and the acting
 * profile's id. `audit_logs.actor_type` has no `'ADMIN'` value — the CHECK
 * accepts `OPERATOR` for staff — so the grant actually held is recorded
 * alongside it in `after.staffRole` rather than being flattened away. The
 * mandatory reason is a database invariant under
 * `audit_logs_operator_reason_check` (DEC-032), not an application courtesy.
 */
@Injectable()
export class SupervisorCaseService {
  private readonly logger = new Logger(SupervisorCaseService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** S-02 — the operations inbox. */
  async listCases(limit = DEFAULT_LIMIT): Promise<SupervisorCaseListResponse> {
    const bounded = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('id, actor_type, action, entity_type, entity_id, reason, after, created_at')
      .eq('actor_type', 'AI')
      .like('action', `${AI_OPS_ACTION_PREFIX}%`)
      .order('created_at', { ascending: false })
      .limit(bounded)
      .returns<AuditRowForProjection[]>();

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Supervisor case read failed: ${error.message}`,
      });
    }

    const escalations = (data ?? []).filter(isEscalationRow);
    const resolutions = await this.listResolutions(escalations.map((row) => row.entity_id));

    const cases = escalations.map((row) => toCaseSummary(row, resolutions.get(row.id) ?? null));

    return {
      cases,
      window: {
        limit: bounded,
        returned: cases.length,
        openInWindow: cases.filter((c) => c.state === 'OPEN').length,
        resolvedInWindow: cases.filter((c) => c.state === 'RESOLVED').length,
      },
    };
  }

  /** S-03 — one case, with live domain state rather than the agent's snapshot of it. */
  async getCase(caseId: string): Promise<SupervisorCaseDetailResponse> {
    const row = await this.readCaseRow(caseId);
    const resolution = (await this.listResolutions([row.entity_id])).get(row.id) ?? null;
    const summary = toCaseSummary(row, resolution);

    const subject = await this.buildSubject(summary);
    const timeline = await this.buildTimeline(summary);

    return {
      case: summary,
      evidence: evidenceOf(row),
      subject,
      timeline,
      blockedBy: blockedByFor(row.action),
    };
  }

  /**
   * S-06 — close a case.
   *
   * Writes one append-only audit row and nothing else. Deliberately refuses a
   * second resolution rather than recording a competing one: an inbox where a
   * case can be closed twice is an inbox where two people each believe the
   * other handled it.
   */
  async resolveCase(
    caseId: string,
    request: ResolveSupervisorCaseRequest,
    user: AuthenticatedUser,
  ): Promise<ResolveSupervisorCaseResponse> {
    const staff = user.capabilities.platformStaff;

    if (!staff) {
      // Belt and braces behind `@Roles('OPERATOR','ADMIN')`: the guard already
      // refused a non-staff caller, and this refuses a principal that somehow
      // reached the service without the grant the audit row must record.
      throw new DomainError('FORBIDDEN', { message: 'Platform staff grant required' });
    }

    const row = await this.readCaseRow(caseId);
    const existing = (await this.listResolutions([row.entity_id])).get(row.id) ?? null;

    if (existing) {
      throw new DomainError('CONFLICT', {
        message: `Case ${caseId} was already resolved as ${existing.outcome}`,
        details: { caseId: row.id, outcome: existing.outcome },
      });
    }

    const correlationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('audit_logs').insert({
      // Human attribution. Never 'SYSTEM', never 'AI' — the two things this
      // row exists to be distinguishable from.
      actor_type: 'OPERATOR',
      actor_id: user.id,
      action: CASE_RESOLVED_ACTION,
      // The case's own subject, so `audit_logs_entity_idx` resolves the
      // resolution alongside the escalation it closes.
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      before: null,
      after: {
        caseId: row.id,
        caseAction: row.action,
        outcome: request.outcome,
        // The grant actually held, since actor_type cannot express ADMIN.
        staffRole: staff.staffRole,
      },
      reason: request.reason,
      correlation_id: correlationId.success ? correlationId.data : null,
      source: 'api',
    });

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Case resolution write failed: ${error.message}`,
      });
    }

    const resolution: SupervisorCaseResolution = {
      outcome: request.outcome,
      reason: request.reason,
      resolvedAt: new Date().toISOString(),
      staffRole: staff.staffRole,
    };

    this.logger.log(`Case ${caseId} resolved as ${request.outcome} by staff ${staff.staffRole}`);

    return { caseId: row.id, state: 'RESOLVED', resolution };
  }

  private async readCaseRow(caseId: string): Promise<AuditRowForProjection> {
    const parsed = uuidSchema.safeParse(caseId);

    if (!parsed.success) {
      throw new DomainError('NOT_FOUND', { message: 'Case not found' });
    }

    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('id, actor_type, action, entity_type, entity_id, reason, after, created_at')
      .eq('id', parsed.data)
      .maybeSingle<AuditRowForProjection>();

    if (error) {
      throw new DomainError('INTERNAL_ERROR', {
        message: `Supervisor case read failed: ${error.message}`,
      });
    }

    // An audit row that is not an AI escalation is not a case, and saying
    // "not found" rather than "not a case" keeps this endpoint from being a
    // way to probe whether an arbitrary audit row exists.
    if (!data || !isEscalationRow(data)) {
      throw new DomainError('NOT_FOUND', { message: 'Case not found' });
    }

    return data;
  }

  /**
   * Resolutions for the given case subjects, keyed by the case id each one
   * closes.
   *
   * Queried by `entity_id` rather than by a JSON path so the read uses
   * `audit_logs_entity_idx`; the `after.caseId` match is then made here. A
   * resolution row that names no case, or that is malformed, is ignored — its
   * case stays open and therefore stays visible.
   */
  private async listResolutions(entityIds: string[]): Promise<Map<string, SupervisorCaseResolution>> {
    const unique = [...new Set(entityIds)];
    const resolved = new Map<string, SupervisorCaseResolution>();

    if (unique.length === 0) {
      return resolved;
    }

    const { data, error } = await this.supabase.admin
      .from('audit_logs')
      .select('id, actor_type, action, entity_type, entity_id, reason, after, created_at')
      .eq('action', CASE_RESOLVED_ACTION)
      .in('entity_id', unique)
      .returns<AuditRowForProjection[]>();

    if (error) {
      // Fail closed toward "still open": a case whose closure cannot be read
      // must not disappear from the inbox.
      this.logger.error(`Case resolution read failed: ${error.message}`);
      return resolved;
    }

    for (const row of data ?? []) {
      const caseId = resolvedCaseIdOf(row);
      const resolution = resolutionOf(row);

      if (caseId && resolution && !resolved.has(caseId)) {
        resolved.set(caseId, resolution);
      }
    }

    return resolved;
  }

  /** Live authoritative state for the case's subject — never the agent's snapshot. */
  private async buildSubject(summary: SupervisorCaseSummary): Promise<SupervisorCaseSubject> {
    if (summary.subjectType === 'order') {
      const { data, error } = await this.supabase.admin
        .from('orders')
        // No amount, fee or total column is selected — the console has no
        // approved financial surface, so it is handed no financial data.
        .select('id, order_number, state, restaurant_id, created_at, paid_at')
        .eq('id', summary.subjectId)
        .maybeSingle<OrderSubjectRow>();

      if (error || !data) {
        return { type: 'unavailable', detail: 'Order could not be read for this case' };
      }

      return {
        type: 'order',
        orderId: data.id,
        orderNumber: data.order_number,
        state: data.state,
        restaurantId: data.restaurant_id,
        createdAt: data.created_at,
        paidAt: data.paid_at,
      };
    }

    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, order_id, state, created_at, rider_id')
      .eq('id', summary.subjectId)
      .maybeSingle<DeliverySubjectRow>();

    if (error || !data) {
      return { type: 'unavailable', detail: 'Delivery could not be read for this case' };
    }

    return {
      type: 'delivery',
      deliveryId: data.id,
      orderId: data.order_id,
      state: data.state,
      createdAt: data.created_at,
      // Presence, not identity: whether someone is on it is what the decision
      // needs; who they are is more personal data than it needs.
      hasRider: data.rider_id !== null,
    };
  }

  /**
   * The case timeline, from the two append-only tables that already record it:
   * `audit_logs` for the subject, and `order_status_history` when the subject
   * is an order.
   */
  private async buildTimeline(summary: SupervisorCaseSummary): Promise<SupervisorTimelineEntry[]> {
    const entries: SupervisorTimelineEntry[] = [];

    const { data: audits, error: auditError } = await this.supabase.admin
      .from('audit_logs')
      .select('id, actor_type, action, entity_type, entity_id, reason, after, created_at')
      .eq('entity_type', summary.subjectType)
      .eq('entity_id', summary.subjectId)
      .order('created_at', { ascending: false })
      .limit(TIMELINE_LIMIT)
      .returns<AuditRowForProjection[]>();

    if (auditError) {
      this.logger.error(`Case timeline audit read failed: ${auditError.message}`);
    }

    for (const row of audits ?? []) {
      entries.push({
        at: row.created_at,
        source: 'audit',
        actorType: row.actor_type,
        what: row.action,
        reason: row.reason,
      });
    }

    if (summary.subjectType === 'order') {
      const { data: history, error: historyError } = await this.supabase.admin
        .from('order_status_history')
        .select('from_state, to_state, actor_type, reason, occurred_at')
        .eq('order_id', summary.subjectId)
        .order('occurred_at', { ascending: false })
        .limit(TIMELINE_LIMIT)
        .returns<StatusHistoryRow[]>();

      if (historyError) {
        this.logger.error(`Case timeline history read failed: ${historyError.message}`);
      }

      for (const row of history ?? []) {
        entries.push({
          at: row.occurred_at,
          source: 'order_status',
          actorType: row.actor_type,
          what: `${row.from_state ?? '—'} → ${row.to_state}`,
          reason: row.reason,
        });
      }
    }

    return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
}
