/**
 * DEC-053's post-pickup delivery-failure cause vocabulary — BQ-017 Slice #1.
 *
 * Read DEC-053 § 9 and DEC-054 before changing anything here.
 *
 * ## What this is, precisely
 *
 * The six cause classes DEC-053 recognises for a **post-pickup delivery
 * failure**, and nothing else. It is the vocabulary of one path — the
 * operator-resolved failure DEC-054 carved out of DEC-APP-006 — not a general
 * cause-code policy for the platform.
 *
 * `docs/ORDER_LIFECYCLE.md` § 6 describes a *wider* taxonomy
 * (`CUSTOMER_CANCELLED`, `MERCHANT_TIMEOUT`, `OPERATOR_CANCELLED`,
 * `PAYMENT_EXPIRED`, …) covering cancellation, rejection and payment outcomes
 * as well. That table is still `PROPOSED`, and this file deliberately does
 * **not** implement it: DEC-053 approved six values for one path, so six
 * values for one path is what exists. `CUSTOMER_CANCELLED` is therefore
 * *rejected* by this schema — not because it is invalid generally, but
 * because a cancellation is not a post-pickup delivery failure, and admitting
 * it here would let one path write another path's outcome.
 *
 * ## What it deliberately is not
 *
 * - **Not a database constraint.** `orders.cause_code` and
 *   `deliveries.failure_cause` stay unconstrained `text`
 *   (`20260811000005_order_domain.sql`, `…09_delivery_domain.sql`). A CHECK
 *   narrowed to these six would pre-decide the cancellation and rejection
 *   paths whose vocabulary is still `PROPOSED` — the same reasoning
 *   `ledger_entry_groups.kind`'s own comment gives for staying free text
 *   ("the taxonomy of ledger event kinds is an application concern").
 * - **Not part of the cancel API.** `cancelOrderRequestSchema` stays
 *   `.strict()` with `reason` only and still rejects `causeCode`; DEC-053's
 *   failure path is its own command, not a widened cancellation.
 * - **Not financial.** A cause selects an economic outcome in DEC-053's
 *   table, but nothing in this slice acts on that: refund execution is
 *   blocked on Q-020 and rider compensation on BQ-024.
 *
 * ## Where the value is stored, when a later slice writes one
 *
 * `orders.cause_code` is the canonical field (DEC-051, DEC-053 and
 * `docs/ORDER_LIFECYCLE.md` § 6 all name it); `deliveries.failure_cause` is
 * the delivery-domain copy so a delivery row explains itself without a
 * cross-domain join. Neither is written by this slice — the operator failure
 * command that writes them is Slice #2.
 */

import { z } from 'zod';

/**
 * The six causes, exactly as DEC-053 § 9 recognises them.
 *
 * Order follows the decision's own table (§ 5): the two customer-caused rows,
 * then rider, merchant, platform, and the indeterminate residual. No value may
 * be added, removed or renamed without a decision that supersedes DEC-053.
 */
export const DELIVERY_FAILURE_CAUSES = [
  'CUSTOMER_UNREACHABLE',
  'CUSTOMER_REFUSED',
  'RIDER_CAUSED',
  'MERCHANT_CAUSED',
  'PLATFORM_CAUSED',
  'INDETERMINATE',
] as const;

export type DeliveryFailureCause = (typeof DELIVERY_FAILURE_CAUSES)[number];

/**
 * Validates one cause against DEC-053's vocabulary.
 *
 * Rejecting is the point: a value outside these six — including one that is
 * legitimate elsewhere in `docs/ORDER_LIFECYCLE.md` § 6, such as
 * `CUSTOMER_CANCELLED` — must not be accepted on the post-pickup failure path.
 */
export const deliveryFailureCauseSchema = z.enum(DELIVERY_FAILURE_CAUSES);

/** Narrowing type guard, for code holding a `string` from a database read. */
export function isDeliveryFailureCause(value: unknown): value is DeliveryFailureCause {
  return (
    typeof value === 'string' && (DELIVERY_FAILURE_CAUSES as readonly string[]).includes(value)
  );
}
