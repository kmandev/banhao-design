import type { AutonomyLevel } from './ai-ops.types';

export const COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE = 'notify_merchant_acceptance_deadline';

/**
 * One catalog entry. Every field is a guard the dispatcher enforces, not
 * documentation about a guard enforced elsewhere.
 */
export interface CommandCatalogEntry {
  readonly name: string;
  readonly autonomyLevel: AutonomyLevel;
  /** Which domain this command's effect lands in. Used to keep the financial domain provably out. */
  readonly domain: 'notification';
  /** What the handler must re-read and re-check immediately before acting. */
  readonly requiredDomainValidation: string;
  /** Whether the effect can be undone, and how a reviewer should read a duplicate. */
  readonly reversibility: string;
  /** What must be written to `audit_logs` when this command runs. */
  readonly auditRequirement: string;
  /** What happens when the domain refuses. */
  readonly escalationBehavior: string;
}

/**
 * Phase J — the command catalog.
 *
 * DEC-040 §1 and §3 are enforced by what this object *does not contain*.
 * There is no refund, payout, fee, ledger, commission, earnings or payable
 * command — not gated behind a level, absent. The dispatcher refuses any name
 * that does not resolve here, so "the agent asked for a refund" cannot become
 * "the agent got a refund" via a level check that someone later relaxes.
 *
 * Equally deliberate: there is no command that moves an order, delivery,
 * payment or rider state. This slice introduces no business state and
 * modifies no state machine (DEC-040 §4). The one command it has is a
 * notification — the design package's `send_deadline_reminder` shape, at L2.
 *
 * Adding an entry is an architectural change requiring the level, the
 * validation and the escalation behaviour to be stated here, in this table,
 * before any handler can be reached.
 */
export const COMMAND_CATALOG: Readonly<Record<string, CommandCatalogEntry>> = Object.freeze({
  [COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE]: Object.freeze({
    name: COMMAND_NOTIFY_MERCHANT_ACCEPTANCE_DEADLINE,
    autonomyLevel: 'L2',
    domain: 'notification',
    requiredDomainValidation:
      'Re-read orders.state immediately before acting; the order must still be PAID. A merchant who accepted in the meantime makes this command moot and it must be refused, not sent.',
    reversibility:
      'A notification cannot be unsent. Duplicate suppression is the dedupe key checked against audit_logs before the pipeline runs.',
    auditRequirement:
      "One audit_logs row, actor_type = 'AI', action = AI_OPS_MERCHANT_ACCEPTANCE_TIMEOUT, entity_type = 'order'.",
    escalationBehavior: 'A domain refusal maps to ESC-DOMAIN-REJECT and is never retried around.',
  }),
});

/**
 * The levels a command may be executed at without a human in the loop.
 *
 * L0/L1 produce no autonomous effect (observe / recommend). L4 requires an
 * approval that revalidates domain state at execution time, and this slice
 * builds no approval surface, so an L4 command is refused here rather than
 * silently executed. L5 is never autonomous under any circumstance.
 *
 * Model confidence is absent from this decision entirely — DEC-040 §6.
 */
export const AUTONOMOUSLY_EXECUTABLE_LEVELS: ReadonlySet<AutonomyLevel> = new Set<AutonomyLevel>([
  'L2',
  'L3',
]);

export function lookupCommand(name: string): CommandCatalogEntry | null {
  if (!Object.prototype.hasOwnProperty.call(COMMAND_CATALOG, name)) {
    return null;
  }
  return COMMAND_CATALOG[name] ?? null;
}
