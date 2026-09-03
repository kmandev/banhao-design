/**
 * Phase J (DEC-040) — AI Operations shared types.
 *
 * Vertical slice #1: Merchant Acceptance Timeout. These types are the seams
 * DEC-040's ten constraints are enforced at, so read them as the boundary
 * definition rather than as data-shape convenience:
 *
 * - {@link ScopedOperationalProjection} is the ONLY thing an agent ever sees.
 *   It carries ids, states and clock facts — never an amount, a fee, a ledger
 *   reference or any other financial field (DEC-040 §3). Widening it is a
 *   decision, not a refactor.
 * - {@link CommandRequest} is the ONLY thing an agent may produce. It names a
 *   catalog entry; it cannot carry SQL, a table name, or a free-form mutation
 *   (DEC-040 §1/§2).
 * - {@link PolicyResolution} makes "no approved policy value exists" a
 *   first-class result rather than an exception path, so the fail-closed
 *   branch is the one the type system pushes you into (DEC-040 §5).
 */

/**
 * The autonomy ladder, exactly as DEC-040 §6 authorizes it.
 *
 * Model confidence is NEVER an input to this. Authorization comes from the
 * level attached to the command in the catalog — see
 * `command-catalog.ts` and `CommandDispatcher.dispatch`.
 */
export type AutonomyLevel =
  /** Read scoped projections; write nothing. */
  | 'L0'
  /** Propose; a human executes. */
  | 'L1'
  /** Low-risk operational mutation (a notification, a reminder). */
  | 'L2'
  /** Deterministic policy action — a state change with no judgement. */
  | 'L3'
  /** Human approval required; approval must revalidate domain state. */
  | 'L4'
  /** Never autonomous. Absent from the agent catalog entirely. */
  | 'L5';

/**
 * Escalation identifiers, as named by the AI Operations design package
 * (`docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design
 * Package.dc.html` § 08). Only the four this slice can actually reach are
 * defined; the package's others (`ESC-LOW-CONF`, `ESC-L4`, `ESC-NORIDER`,
 * `ESC-REPEAT`, `ESC-INVARIANT`, `ESC-SAFETY`, `ESC-NOTIFY`) belong to
 * playbooks this slice does not implement, and inventing a new id here is
 * forbidden by DEC-040 §5.
 */
export type EscalationId =
  /** Unroutable event, or a policy input that does not exist yet. Fail closed. */
  | 'ESC-UNKNOWN'
  /** The domain service refused the command. Never bypassed, never retried around. */
  | 'ESC-DOMAIN-REJECT'
  /** Attempts exhausted against a transient failure. */
  | 'ESC-RETRY-EXHAUSTED'
  /** The same action recurring on the same entity — runaway automation guard. */
  | 'ESC-LOOP';

/** The playbooks this slice knows. One, deliberately. */
export type PlaybookId = 'MERCHANT_ACCEPTANCE_TIMEOUT';

/**
 * A normalized operational event.
 *
 * Produced only by {@link EventNormalizer} from a shipped `outbox` row
 * (ADR-005). The agent reads events, never table diffs, so it can never
 * observe a half-committed world.
 */
export interface OperationalEvent {
  /** The `outbox` row this was normalized from. */
  readonly sourceEventId: string;
  readonly eventType: string;
  readonly aggregateType: 'order' | 'delivery';
  readonly aggregateId: string;
  readonly occurredAt: string;
  /**
   * Stable key for "have we already handled this?".
   *
   * `<playbook action>:<aggregate id>` — one AI operation per playbook per
   * aggregate. See `MerchantAcceptanceTimeoutService`'s header for why
   * `audit_logs` is the durable record this is checked against, and what that
   * does and does not guarantee under genuinely concurrent ticks.
   */
  readonly dedupeKey: string;
}

/**
 * The scoped read projection handed to an agent.
 *
 * DEC-040 §3 — no amounts, no fees, no ledger, no payout, no payment provider
 * detail. If a future playbook needs a financial fact, that is a decision
 * about financial autonomy, not a field addition.
 */
export interface ScopedOperationalProjection {
  readonly playbook: PlaybookId;
  readonly orderId: string;
  readonly orderState: string;
  readonly restaurantId: string;
  /** When the merchant-acceptance clock started (the order reached `PAID`). */
  readonly awaitingAcceptanceSince: string;
  readonly elapsedSeconds: number;
  /** Whether a delivery already exists for this order. Presence only — no rider identity. */
  readonly hasDelivery: boolean;
}

/** What an agent is allowed to return. Nothing else is accepted. */
export type AgentDecision =
  | { readonly kind: 'COMMAND'; readonly command: CommandRequest }
  | { readonly kind: 'ESCALATE'; readonly escalation: EscalationId; readonly reason: string }
  | { readonly kind: 'NO_ACTION'; readonly reason: string };

/**
 * A typed command request — the only way into the domain from AI Operations.
 *
 * `name` must resolve in the catalog; an unknown name is refused by the
 * dispatcher rather than interpreted. There is deliberately no `sql`,
 * `table`, `column` or free-form payload field: DEC-040 §1/§2 are enforced by
 * this type's shape, not by a runtime string check alone.
 */
export interface CommandRequest {
  readonly name: string;
  readonly orderId: string;
  readonly reason: string;
}

/** The outcome of dispatching a command. */
export type CommandResult =
  | { readonly status: 'EXECUTED'; readonly verified: true; readonly detail: string }
  /** The domain refused. Maps to `ESC-DOMAIN-REJECT`, never to a retry. */
  | { readonly status: 'DOMAIN_REJECTED'; readonly detail: string }
  /** The command is not in the catalog, or its level forbids autonomous execution. */
  | { readonly status: 'NOT_PERMITTED'; readonly detail: string }
  /** Executed, but the post-execution read could not confirm the effect. */
  | { readonly status: 'UNVERIFIED'; readonly detail: string };

/**
 * A policy lookup result.
 *
 * `MISSING` is not an error — it is the correct, expected answer whenever a
 * business decision has not been made yet, and it is what makes the pipeline
 * fail closed instead of inventing a number (DEC-040 §5).
 */
export type PolicyResolution<T> =
  | { readonly status: 'RESOLVED'; readonly value: T; readonly policyVersion: string }
  | { readonly status: 'MISSING'; readonly dependency: string; readonly detail: string };

/** One pipeline run's terminal outcome, for the tick response and for tests. */
export type PipelineOutcome =
  | 'SKIPPED_ALREADY_HANDLED'
  | 'ACTED'
  | 'ESCALATED'
  | 'NO_ACTION';

export interface AiOpsRunResult {
  /** Outbox rows this run normalized and routed. */
  readonly examined: number;
  readonly acted: number;
  readonly escalated: number;
  readonly skipped: number;
  readonly failed: number;
}
