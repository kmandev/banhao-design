import type {
  SupervisorCaseResolution,
  SupervisorCaseState,
  SupervisorCaseSubjectType,
  SupervisorCaseSummary,
} from '@banhao/validation';

/** The `audit_logs` columns the projection reads. Nothing financial is selected. */
export interface AuditRowForProjection {
  id: string;
  actor_type: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string | null;
  after: Record<string, unknown> | null;
  created_at: string;
}

/** The action string a supervisor's own case resolution is recorded under. */
export const CASE_RESOLVED_ACTION = 'AI_OPS_CASE_RESOLVED';

/** Every AI Operations action string starts with this. Used to select cases, never to authorize one. */
export const AI_OPS_ACTION_PREFIX = 'AI_OPS_';

/**
 * Which open decision, if any, is why a case of this kind carries no
 * operational command.
 *
 * This table **names** existing blockers; it does not create them. Each entry
 * points at a question that is `OPEN` in `docs/OPEN_BUSINESS_QUESTIONS.md` or
 * in the AI Operations design package, and each is the reason the console
 * shows a case with a reason field and nothing to press. When one of these is
 * decided, a command becomes designable — the entry is removed here and the
 * command is added deliberately, never by an entry quietly falling out of a
 * default branch.
 */
const BLOCKED_BY_ACTION: Readonly<Record<string, string>> = Object.freeze({
  AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT:
    'BQ-013 — no merchant acceptance deadline or auto-pause threshold is approved, so no merchant command exists to offer.',
  AI_OPS_NO_RIDER_TRIAGE:
    'UX-Q-006 — the no-rider terminal outcome is undecided. DEC-020 forbids auto-cancellation, so no cancel, fail or redispatch control exists here.',
});

export function blockedByFor(action: string): string | null {
  return Object.prototype.hasOwnProperty.call(BLOCKED_BY_ACTION, action)
    ? (BLOCKED_BY_ACTION[action] ?? null)
    : null;
}

/** Is this audit row an AI Operations escalation — i.e. a case? */
export function isEscalationRow(row: AuditRowForProjection): boolean {
  return (
    row.actor_type === 'AI' &&
    row.action.startsWith(AI_OPS_ACTION_PREFIX) &&
    typeof escalationIdOf(row) === 'string'
  );
}

function escalationIdOf(row: AuditRowForProjection): string | null {
  const value = row.after?.['escalation'];
  return typeof value === 'string' ? value : null;
}

/**
 * Turn one resolution audit row into the resolution half of a case.
 *
 * Returns `null` for a row that does not carry the fields a resolution must
 * have. A malformed row is not treated as "resolved anyway": a case whose
 * closure cannot be read stays `OPEN` and therefore stays visible, which is
 * the fail-closed direction for an inbox.
 */
export function resolutionOf(row: AuditRowForProjection): SupervisorCaseResolution | null {
  const outcome = row.after?.['outcome'];
  const staffRole = row.after?.['staffRole'];

  if (typeof outcome !== 'string' || !row.reason) {
    return null;
  }

  return {
    outcome: outcome as SupervisorCaseResolution['outcome'],
    reason: row.reason,
    resolvedAt: row.created_at,
    staffRole: typeof staffRole === 'string' ? staffRole : 'OPERATOR',
  };
}

/** The `after.caseId` a resolution row points at, if it points at one. */
export function resolvedCaseIdOf(row: AuditRowForProjection): string | null {
  const value = row.after?.['caseId'];
  return typeof value === 'string' ? value : null;
}

/**
 * Project one escalation row (plus its resolution, if any) into a case summary.
 *
 * The case *is* the audit row — there is no case table and Phase I adds none
 * (DEC-040 § 9, AI-02). State is derived here and nowhere else, so two screens
 * cannot disagree about whether something is still open.
 */
export function toCaseSummary(
  row: AuditRowForProjection,
  resolution: SupervisorCaseResolution | null,
): SupervisorCaseSummary {
  const state: SupervisorCaseState = resolution ? 'RESOLVED' : 'OPEN';

  return {
    caseId: row.id,
    action: row.action,
    escalation: escalationIdOf(row) ?? 'ESC-UNKNOWN',
    subjectType: row.entity_type as SupervisorCaseSubjectType,
    subjectId: row.entity_id,
    reason: row.reason ?? '',
    raisedAt: row.created_at,
    state,
    resolution,
  };
}

/**
 * The escalation's recorded context, with the fields the summary already
 * carries removed so the evidence block is what is *left over* rather than a
 * second copy.
 */
export function evidenceOf(row: AuditRowForProjection): Record<string, unknown> {
  const { escalation: _escalation, ...rest } = row.after ?? {};
  return rest;
}
