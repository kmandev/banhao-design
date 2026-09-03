import { z } from 'zod';

/**
 * Human Supervisor console — Phase I, aligned to DEC-040 and the AI Operations
 * design package § 09 (screens S-02, S-03, S-06).
 *
 * Read `docs/HUMAN_SUPERVISOR_CONTRACT.md` before changing anything here. Two
 * properties of these shapes are load-bearing rather than incidental:
 *
 * - **No financial field appears anywhere.** Not an amount, a fee, a total, a
 *   payment reference or a provider id. Phase I's money surfaces are blocked
 *   behind Q-001/Q-002/Q-010/Q-020, and a console that leaked a total would be
 *   presenting a number no decision authorises it to act on.
 * - **There is no command that changes domain state.** The only write in this
 *   file is a case resolution, which writes an audit row and nothing else.
 *   Every operational command — cancel, release, redispatch, pause a merchant —
 *   is gated on an open business decision and is deliberately absent, not
 *   disabled.
 */

/**
 * How a case ends, exactly as the design package's S-06 offers it.
 *
 * These classify the *supervisor's own* conclusion. None of them is a business
 * state, none of them moves an order or a delivery, and `AWAITING_POLICY` is
 * the honest terminal for the cases whose real answer is an unresolved
 * decision (BQ-013, UX-Q-006, BQ-015, Q-032).
 */
export const SUPERVISOR_CASE_OUTCOMES = ['RESOLVED', 'NO_ACTION_NEEDED', 'AWAITING_POLICY'] as const;

export type SupervisorCaseOutcome = (typeof SUPERVISOR_CASE_OUTCOMES)[number];

/**
 * `POST /api/v1/admin/supervisor/cases/:id/resolve`.
 *
 * `reason` is required and non-empty because `audit_logs_operator_reason_check`
 * makes it a database invariant for every `OPERATOR` row (DEC-032) — a blank
 * reason cannot reach the table, so it must not reach the button.
 *
 * `.strict()` stops a client from smuggling an actor, a state or a case id into
 * the body: identity comes from the verified JWT and the case comes from the
 * route.
 */
export const resolveSupervisorCaseSchema = z
  .object({
    outcome: z.enum(SUPERVISOR_CASE_OUTCOMES),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ResolveSupervisorCaseRequest = z.infer<typeof resolveSupervisorCaseSchema>;

/** What a case is about. Mirrors `audit_logs.entity_type` for the two aggregates Phase J escalates on. */
export type SupervisorCaseSubjectType = 'order' | 'delivery';

/** Derived, never stored — see the contract § 4. */
export type SupervisorCaseState = 'OPEN' | 'RESOLVED';

/** One row of the operations inbox (S-02). */
export interface SupervisorCaseSummary {
  /** The `audit_logs` row this case *is*. There is no case table (DEC-040 § 9, AI-02). */
  caseId: string;
  /** The AI Operations action that raised it, e.g. `AI_OPS_NO_RIDER_TRIAGE`. */
  action: string;
  /** The escalation id from the design package § 08, e.g. `ESC-NORIDER`. */
  escalation: string;
  subjectType: SupervisorCaseSubjectType;
  subjectId: string;
  /** The escalation's own reason text, as written by the pipeline. */
  reason: string;
  /** ISO-8601. When the escalation was recorded. */
  raisedAt: string;
  state: SupervisorCaseState;
  /** Present only when `state` is `RESOLVED`. */
  resolution: SupervisorCaseResolution | null;
}

export interface SupervisorCaseResolution {
  outcome: SupervisorCaseOutcome;
  reason: string;
  resolvedAt: string;
  /** The staff grant held at the moment of resolution — `OPERATOR` or `ADMIN`. */
  staffRole: string;
}

/**
 * `GET /api/v1/admin/supervisor/cases`.
 *
 * `window` is reported rather than assumed: the projection reads a bounded page
 * of `audit_logs` and derives state within it, so a count taken from this
 * response is a count of *this page* and the field names say so. There is no
 * "total open cases" number here, because producing an honest one needs a full
 * scan this endpoint deliberately does not do.
 */
export interface SupervisorCaseListResponse {
  cases: SupervisorCaseSummary[];
  window: {
    limit: number;
    returned: number;
    openInWindow: number;
    resolvedInWindow: number;
  };
}

/**
 * The live subject of a case (S-03's evidence region).
 *
 * Read from the authoritative domain tables **at render time**, never from the
 * audit payload: the whole point of opening a case is to see what is true now,
 * and the payload records what was true when the agent looked. `hasRider` is a
 * boolean rather than a rider id — presence is what an operational decision
 * needs, and identity is more personal data than the decision requires.
 */
export type SupervisorCaseSubject =
  | {
      type: 'order';
      orderId: string;
      orderNumber: string;
      state: string;
      restaurantId: string;
      createdAt: string;
      paidAt: string | null;
    }
  | {
      type: 'delivery';
      deliveryId: string;
      orderId: string;
      state: string;
      createdAt: string;
      hasRider: boolean;
    }
  | { type: 'unavailable'; detail: string };

/** One entry of the case timeline. Both sources are append-only tables. */
export interface SupervisorTimelineEntry {
  at: string;
  /** `audit` for an `audit_logs` row, `order_status` for an `order_status_history` row. */
  source: 'audit' | 'order_status';
  actorType: string;
  /** The action, or `FROM → TO` for a status transition. */
  what: string;
  reason: string | null;
}

/** `GET /api/v1/admin/supervisor/cases/:id` — S-03. */
export interface SupervisorCaseDetailResponse {
  case: SupervisorCaseSummary;
  /** The escalation's recorded context — ids, states and counts only, as written by the pipeline. */
  evidence: Record<string, unknown>;
  subject: SupervisorCaseSubject;
  timeline: SupervisorTimelineEntry[];
  /**
   * Why this case has no operational command attached, when it has none.
   *
   * Null means "nothing is being withheld". A string names the open decision —
   * this is what stops the console from silently looking like a console with
   * missing buttons.
   */
  blockedBy: string | null;
}

/** `POST /api/v1/admin/supervisor/cases/:id/resolve`. */
export interface ResolveSupervisorCaseResponse {
  caseId: string;
  state: SupervisorCaseState;
  resolution: SupervisorCaseResolution;
}

/**
 * `GET /api/v1/admin/supervisor/me` — who is signed in, and with which grant.
 *
 * Presentation only. The console renders the role in its header; every route
 * re-resolves the grant per request, so this answer is never the boundary and
 * is never cached as one.
 */
export interface SupervisorIdentityResponse {
  userId: string;
  /** `OPERATOR` or `ADMIN` — the two values `platform_staff.staff_role` allows. */
  staffRole: string;
}
