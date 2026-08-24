/**
 * The Phase 1 dispatch policy — **DEC-037**, which fixed the four numbers
 * DEC-020 deliberately left `OPEN` (BQ-020, BQ-021, and the working-area half
 * of BQ-022).
 *
 * These are constants, not environment variables, for the same reason
 * `OrderPricingService` holds DEC-035/036's amounts as constants: an approved
 * business value belongs in the decision log and in code that cites it, not in
 * deployment configuration where it can drift per environment with no record
 * of who changed it. `docs/ORDER_LIFECYCLE.md` § 4's "all timers must be
 * configuration, not constants (DEC-031)" is about *where the value is
 * administered* once there is an admin surface to administer it from; until
 * that surface exists (Phase I), a single cited constant is the honest
 * representation, and DEC-037 records that the shape question is untouched.
 *
 * Nothing here may be tuned to make a test pass. Changing any of these values
 * is changing DEC-037.
 */

/**
 * BQ-020 — how long a rider has to accept one offer.
 *
 * **Not 12 s and not 20 s**: both came from a self-contradictory wireframe
 * (title `นับถอยหลัง 20 วิ`, button `รับงาน · 12 วิ`), which is precisely why
 * BQ-020 stayed open until DEC-037 answered it with neither.
 */
export const ACCEPT_WINDOW_SECONDS = 60;

/**
 * The interval between broadcast rounds, aligned to the existing one-minute
 * Cloudflare Worker tick (DEC-APP-010). This alignment is load-bearing: it is
 * why dispatch needs no scheduler of its own, and it is why `roundNumberFor`
 * below can derive a round from the clock instead of counting rows.
 */
export const ROUND_INTERVAL_SECONDS = 60;

/**
 * The delivery states a dispatch round broadcasts for.
 *
 * Matches `deliveries_searching_idx`, the partial index the schema created for
 * exactly this query. `RIDER_REASSIGNING` is here because DEC-021 sends a
 * cancelled delivery back through broadcast rather than cancelling the order.
 */
export const DISPATCHABLE_DELIVERY_STATES = ['RIDER_SEARCHING', 'RIDER_REASSIGNING'] as const;

/**
 * The delivery states in which a rider is considered to hold an *active*
 * delivery for BQ-021's one-at-a-time rule.
 *
 * Taken from the schema's own `deliveries.state` CHECK constraint and
 * `docs/RIDER_LIFECYCLE.md` § 4, not invented: these are every state in which
 * a rider is engaged with a delivery. `UNASSIGNED` and `RIDER_SEARCHING` have
 * no rider at all; `DELIVERED`, `FAILED` and `ABANDONED` are terminal.
 * `RIDER_REASSIGNING` is counted as active deliberately — `deliveries.rider_id`
 * may still be set until `release_rider_assignment()` nulls it, and counting a
 * possibly-still-held delivery as active fails closed.
 */
export const ACTIVE_DELIVERY_STATES = [
  'RIDER_ASSIGNED',
  'RIDER_REASSIGNING',
  'AT_MERCHANT',
  'PICKED_UP',
  'EN_ROUTE',
] as const;

/** How many searching deliveries one round dispatches at most. Matches the payment tick's batch. */
export const DISPATCH_BATCH_SIZE = 25;

/**
 * The round number a delivery is on at `now`, derived from the clock rather
 * than from a count of existing rows.
 *
 * This is what makes a round idempotent without a prior `SELECT`: two ticks
 * racing inside the same 60-second window compute the *same* `round_no`, so
 * the second one's INSERTs collide with
 * `rider_assignment_attempts_delivery_rider_round_key` and are absorbed as
 * 23505 — the unique constraint stays the sole authority (DEC-028), exactly as
 * it does for every payment natural key. Counting rows instead would be a
 * read-then-write race with no constraint behind it.
 *
 * Clamped to 1 because `round_no` is `check (round_no > 0)`: a delivery whose
 * `created_at` is in the future (clock skew between the database and this
 * process) must still produce a legal row.
 */
export function roundNumberFor(deliveryCreatedAt: string, now: Date): number {
  const elapsedMs = now.getTime() - new Date(deliveryCreatedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 1;
  }
  return Math.floor(elapsedMs / (ROUND_INTERVAL_SECONDS * 1000)) + 1;
}

/** `offered_at + 60 s` (DEC-037), as an ISO string for the `expires_at` column. */
export function offerExpiryFor(offeredAt: Date): string {
  return new Date(offeredAt.getTime() + ACCEPT_WINDOW_SECONDS * 1000).toISOString();
}
