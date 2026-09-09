import { z } from 'zod';

/**
 * Q-020 Slice 4 — operational visibility for `reconciliation_cases`.
 *
 * ## Scope, read first
 *
 * This file exposes the **existing** `reconciliation_cases` table (DEC-029,
 * DEC-032) — the read path a prior production audit found missing — and a
 * reason-carrying resolve action, both under the existing
 * `@Roles('OPERATOR', 'ADMIN')` grant `SupervisorController` already
 * enforces. It does **not** add a refund-specific anomaly kind: the four
 * values below are `reconciliation_cases.kind`'s entire committed CHECK
 * constraint (`20260811000010_audit_notification_infra_domain.sql`). Widening
 * it to carry Q-020's own anomaly vocabulary (`PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED`
 * and the rest) is a schema decision this slice's own final report flags as
 * blocked, not something this file works around by inventing a client-side
 * vocabulary the database would reject.
 *
 * `RECONCILIATION_CASE_KINDS`/`RECONCILIATION_CASE_STATES` are the database's
 * own vocabulary, restated here so a client can render/filter against it
 * without guessing — extend only alongside a migration that widens the
 * matching CHECK constraint, never independently of one.
 */

export const RECONCILIATION_CASE_KINDS = [
  'LATE_PAYMENT',
  'SURPLUS_PAYMENT',
  'AMOUNT_MISMATCH',
  'UNMATCHED_EVENT',
] as const;

export type ReconciliationCaseKind = (typeof RECONCILIATION_CASE_KINDS)[number];

export const RECONCILIATION_CASE_STATES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;

export type ReconciliationCaseState = (typeof RECONCILIATION_CASE_STATES)[number];

/** One `reconciliation_cases` row, projected for an operator/admin reader. Carries no Stripe secret, webhook secret, or raw provider payload — see this file's own class doc comment. */
export interface ReconciliationCaseSummary {
  id: string;
  kind: ReconciliationCaseKind;
  state: ReconciliationCaseState;
  paymentId: string | null;
  orderId: string | null;
  paymentEventId: string | null;
  assignedTo: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/v1/admin/supervisor/reconciliation-cases`. Deterministic ordering — newest first, matching every other bounded list in this console. */
export interface ReconciliationCaseListResponse {
  cases: ReconciliationCaseSummary[];
  window: {
    limit: number;
    returned: number;
    openCount: number;
  };
}

/** `GET /api/v1/admin/supervisor/reconciliation-cases/:id`. Same projection as the list — there is no separate detail-only field this table carries. */
export interface ReconciliationCaseDetailResponse {
  case: ReconciliationCaseSummary;
}

/**
 * `POST /api/v1/admin/supervisor/reconciliation-cases/:id/resolve`.
 *
 * `resolutionNote` is required, mirroring `resolveSupervisorCaseSchema`'s own
 * mandatory-reason precedent (DEC-032's general operator-accountability
 * principle) even though no database CHECK enforces it for this table today.
 * `state` excludes `OPEN` deliberately — this action always moves a case
 * forward (into active work or a genuine resolution), never backward into
 * the state new cases already start in.
 *
 * `.strict()` stops a client from smuggling an actor, a kind, or a case id
 * into the body — identity comes from the verified JWT and the case comes
 * from the route, the same discipline every other admin-console schema in
 * this package already follows.
 */
export const resolveReconciliationCaseSchema = z
  .object({
    state: z.enum(['IN_PROGRESS', 'RESOLVED', 'CLOSED']),
    resolutionNote: z.string().trim().min(1).max(2000),
  })
  .strict();

export type ResolveReconciliationCaseRequest = z.infer<typeof resolveReconciliationCaseSchema>;

/** `POST /api/v1/admin/supervisor/reconciliation-cases/:id/resolve` response — the case, updated. */
export interface ResolveReconciliationCaseResponse {
  case: ReconciliationCaseSummary;
}

/**
 * `GET /api/v1/admin/supervisor/reconciliation-cases` query filters.
 *
 * Plain optional strings, not a zod schema — matching
 * `SupervisorController.list`/`awaitingFailure`'s own existing
 * `@Query('limit') limit?: string` convention exactly (this codebase
 * validates POST bodies with zod but has never validated a query string with
 * it). `kind`/`state`, when provided, are checked against
 * {@link RECONCILIATION_CASE_KINDS}/{@link RECONCILIATION_CASE_STATES} by
 * `ReconciliationCaseService` itself, which fails loud (`VALIDATION_FAILED`)
 * on an unrecognized value rather than silently returning an empty list.
 */
export interface ListReconciliationCasesQuery {
  kind?: string;
  state?: string;
  limit?: string;
}
