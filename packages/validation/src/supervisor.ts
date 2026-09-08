import { z } from 'zod';
import type { Satang } from '@banhao/types';
import { deliveryFailureCauseSchema, type DeliveryFailureCause } from './delivery-failure';

/**
 * Human Supervisor console — Phase I, aligned to DEC-040 and the AI Operations
 * design package § 09 (screens S-02, S-03, S-06).
 *
 * Read `docs/HUMAN_SUPERVISOR_CONTRACT.md` before changing anything here. Two
 * properties held for every shape in this file until Q-020 Slice 1:
 *
 * - **No financial field appears anywhere.** Not an amount, a fee, a total, a
 *   payment reference or a provider id. Phase I's money surfaces were blocked
 *   behind Q-001/Q-002/Q-010/Q-020.
 * - **There is no command that changes domain state** other than a case
 *   resolution (an audit row) and the DEC-053 delivery-failure command.
 *
 * **This is no longer true without exception.** Q-020's mechanism, authority
 * and full-refund accounting are now decision-locked (DEC-057/058/059), and
 * {@link initiateRefundSchema}/{@link InitiateRefundResponse} are this
 * console's first genuinely financial surface — `amountSatang` and
 * `providerRefundId` are deliberately present. Every other route in this file
 * keeps both properties above unchanged: refund initiation is additive, not a
 * relaxation of the console's existing no-financial-field default elsewhere.
 * Cancel, release, redispatch and pause-a-merchant remain absent, gated on
 * their own still-open decisions.
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

/**
 * `POST /api/v1/admin/supervisor/deliveries/:id/fail` — BQ-017 Slice #2.
 *
 * The operator declares a post-pickup delivery failure (DEC-053), the first
 * supervisor command that moves domain state. Everything above this point in
 * this file writes an audit row and nothing else; this one transitions a
 * delivery and its order, which is why its preconditions are enforced by the
 * server and not by the console.
 *
 * ## Why the operator, and only the operator
 *
 * DEC-053 § 2: "the rider performs the operational steps and produces the
 * evidence; the operator is the authority that declares the failure." A rider,
 * customer or merchant may not, because the cause selects an economic outcome
 * (DEC-053 § 5) and no party to the delivery may choose their own. The route
 * lives under `/admin/supervisor` behind the existing
 * `@Roles('OPERATOR','ADMIN')` grant for exactly that reason — no new role and
 * no new permission model.
 *
 * ## `causeCode` is required, and it is not the cancel API's field
 *
 * DEC-053 recognises six causes and this schema accepts exactly those
 * ({@link deliveryFailureCauseSchema}). `cancelOrderRequestSchema` remains
 * `.strict()` with `reason` only and still rejects `causeCode`: a cancellation
 * is not a post-pickup delivery failure, and widening it would let one path
 * write another path's outcome.
 *
 * ## `reason` is required by the database, not by taste
 *
 * `audit_logs_operator_reason_check` makes `reason` non-null for every
 * `OPERATOR` row (DEC-032). A blank reason cannot reach the table, so it must
 * not reach the button — the same reasoning
 * {@link resolveSupervisorCaseSchema} states for case resolution. The 500-char
 * ceiling matches `cancelOrderRequestSchema`'s own free-text bound rather than
 * this file's 2000, because this reason accompanies a domain transition and
 * sits alongside the order's own cancellation reasons in the same history.
 *
 * `.strict()` stops a client from smuggling a state, an actor, a timestamp or
 * an amount into the body: the delivery comes from the route, the operator
 * from the verified JWT, and the clock from the server.
 */
export const failDeliverySchema = z
  .object({
    causeCode: deliveryFailureCauseSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type FailDeliveryRequest = z.infer<typeof failDeliverySchema>;

/**
 * What the operator is left with after a successful failure resolution.
 *
 * **No financial field, deliberately** — no refund, no amount, no rider
 * compensation, no write-off. DEC-053's economics are real policy but nothing
 * executes them: refunds are blocked on Q-020 and rider compensation on
 * BQ-024. A response that named a refund would be reporting an effect that did
 * not happen.
 *
 * Both domains are reported because both moved and they use different words
 * (DEC-018) — the delivery is `FAILED`, the order is `DELIVERY_FAILED`.
 */
export interface FailDeliveryResponse {
  deliveryId: string;
  orderId: string;
  /** Always `FAILED` on success — the **delivery** domain's terminal state for this path. */
  state: string;
  /** Always `DELIVERY_FAILED` on success — the **order** domain's terminal state for this path. */
  orderState: string;
  /** The cause recorded on both `deliveries.failure_cause` and `orders.cause_code`. */
  causeCode: DeliveryFailureCause;
  /** `deliveries.failed_at`, the moment the failure was declared. */
  failedAt: string | null;
}

/**
 * One delivery waiting on an operator's failure decision — BQ-017 Slice #3,
 * `GET /api/v1/admin/supervisor/deliveries/awaiting-failure`.
 *
 * ## What it is, and what it is not
 *
 * It is the operator's working list for DEC-053: deliveries that have been
 * `ARRIVED` at the customer for at least the approved wait and whose order is
 * still `DELIVERING`. It is a **derived view of live domain state**, not a
 * queue and not a work item — nothing is claimed, assigned or consumed by
 * reading it, and a delivery leaves the list only by actually being resolved.
 *
 * It is **not** an assertion that the delivery should fail. DEC-053 § 2 makes
 * the operator the authority; this listing says a case needs a person to look,
 * which is the whole of what a timer may say.
 *
 * ## No financial field, and no cause
 *
 * No amount, fee, total, refund, payout or compensation appears — the same
 * projection discipline `docs/HUMAN_SUPERVISOR_CONTRACT.md` § 7 imposes on
 * every supervisor surface, and here for the additional reason that DEC-053's
 * economics are blocked on Q-020 and BQ-024.
 *
 * There is deliberately **no `causeCode`**. A cause is what the operator
 * decides; presenting one before they have would be the system proposing the
 * economic outcome it is forbidden to choose.
 */
export interface AwaitingFailureDelivery {
  deliveryId: string;
  orderId: string;
  orderNumber: string;
  /** `deliveries.rider_id`, or null when the delivery somehow carries none. Needed to locate the rider on the ground. */
  riderId: string | null;
  /** Always `ARRIVED` for a row in this list — stated rather than assumed, since the console renders it. */
  deliveryState: string;
  /** Always `DELIVERING` — the order-domain name for the same step (DEC-018). */
  orderState: string;
  /** ISO-8601. `deliveries.arrived_at` — DEC-054's anchor, never merchant arrival. */
  arrivedAt: string;
  /** Whole seconds since {@link arrivedAt}, derived at read time. */
  waitedSeconds: number;
  /** DEC-053 § 3's five minutes, so the console states the policy rather than hard-coding it. */
  waitSecondsRequired: number;
  /** How many customer contact attempts the rider has recorded. */
  contactAttempts: number;
  /** DEC-053 § 3's two, for the same reason as `waitSecondsRequired`. */
  contactAttemptsRequired: number;
  /**
   * Whether every DEC-053 precondition is already satisfied, so the console
   * can distinguish "ready to resolve" from "still waiting on the rider's
   * second contact attempt" without re-deriving the policy itself.
   *
   * `false` never hides the row: a delivery an operator cannot yet resolve is
   * often exactly the one they most need to see.
   */
  failureResolvable: boolean;
  /** Whether the tick has already recorded an escalation for this delivery. Presence, not a claim on the work. */
  escalated: boolean;
}

/**
 * `GET /api/v1/admin/supervisor/deliveries/awaiting-failure`.
 *
 * `window` is reported rather than assumed, exactly as
 * {@link SupervisorCaseListResponse} does: this reads a bounded page and any
 * count taken from it is a count of *this page*.
 */
export interface AwaitingFailureListResponse {
  deliveries: AwaitingFailureDelivery[];
  window: {
    limit: number;
    returned: number;
    /** How many of the returned rows already satisfy every DEC-053 precondition. */
    resolvableInWindow: number;
  };
}

/**
 * `POST /api/v1/admin/supervisor/orders/:id/refund` (Q-020 Slice 1,
 * DEC-057/058/059).
 *
 * **`reason` only — deliberately no `amount` field.** DEC-057 §1 locks
 * Phase 1 to full refund only: the refunded amount is always the order's
 * settled payment amount, determined server-side by `RefundService`, never a
 * caller-supplied number. A schema that accepted an `amount` would be the one
 * place a partial refund could sneak in through the API surface even though
 * nothing behind it could safely process one yet — so the field does not
 * exist, rather than existing and being validated away.
 *
 * `reason` is required, matching `resolveSupervisorCaseSchema`'s and
 * `failDeliverySchema`'s own precedent (DEC-032 — a mandatory operator
 * reason) and `refunds.reason`'s own `not null` column.
 */
export const initiateRefundSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type InitiateRefundRequest = z.infer<typeof initiateRefundSchema>;

/**
 * What the operator is left with after a successful refund *initiation* —
 * never a completed refund. `state` is one of the two DEC-057 §4 intermediate
 * values (`REFUND_REQUESTED`, `REFUND_PENDING`) — **it is never `REFUNDED`
 * from this endpoint**: DEC-057 §2/§8 forbids treating a synchronous Stripe
 * API response as finality, and Slice 1 implements no webhook or
 * reconciliation path that could ever produce `REFUNDED` here. `providerRefundId`
 * is present once Stripe has acknowledged the refund request; it is a
 * provider-neutral string (DEC-057 §7) — nothing about its shape (a Stripe
 * `re_...` id, in Phase 1) is exposed by this contract, only its presence.
 */
export interface InitiateRefundResponse {
  refundId: string;
  orderId: string;
  paymentId: string;
  /** `REFUND_REQUESTED` or `REFUND_PENDING` only — see this interface's own doc comment. */
  state: string;
  amountSatang: Satang;
  providerRefundId?: string;
}
