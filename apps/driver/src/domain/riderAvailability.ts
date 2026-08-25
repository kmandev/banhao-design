/**
 * Driver App availability domain — the rider's own online/offline state
 * (Phase G, V1.1 §15; DEC-037's eligibility rule).
 *
 * Backed by `public.rider_availability`, read through
 * `rider_availability_select_own` and written through
 * `rider_availability_update_own`. `docs/DATABASE_DESIGN.md` §18 records this
 * table's rider column as `S,U(own online flag)` — one of only three tables in
 * the whole schema with a direct client write surface, and the write is
 * restricted to `is_online` by a column-scoped grant.
 *
 * ## What this type deliberately does not carry
 *
 * - **`active_delivery_count`.** It is the server's concurrency guard: the
 *   `WHERE active_delivery_count = 0` in `OfferAcceptanceService.claimRiderSlot`
 *   is what enforces DEC-037's one-active-delivery rule. Projecting it into a
 *   client type invites a screen to re-derive that decision locally, which is
 *   exactly the check-then-act ADR-003 forbids.
 * - **`blocked_reason`.** Dormant under DEC-016 (no rider holds platform cash
 *   while COD is disabled) and its vocabulary is undecided — the column is
 *   deliberately unconstrained in the schema. Rendering an undecided value is
 *   inventing one.
 * - **Any money field.** `rider_availability` has none, and BQ-029 (the rider
 *   earnings formula) is `OPEN`. Same rule as `domain/riderOrder.ts` and
 *   `domain/riderOffer.ts`.
 * - **Raw coordinates.** The rider's own last position is of no use to any
 *   Phase G screen, and not reading it is one less place for it to leak.
 *   `locationRecordedAt` answers the only question a screen actually asks —
 *   "does the server have a position for me?" — which is the DEC-037
 *   eligibility half this app can act on.
 */

export interface RiderAvailability {
  /** `rider_availability.is_online` as the server currently holds it. */
  isOnline: boolean;
  /**
   * `location_updated_at`, or `null` if the server holds no position.
   *
   * Presence, not freshness: DEC-037 records the eligibility predicate as
   * "has a location", not "has a fresh one", and no staleness rule is decided.
   * Treating this as an expiry would invent one.
   */
  locationRecordedAt: string | null;
}

/**
 * Whether the server currently holds everything DEC-037 requires of the rider's
 * own row for a broadcast to reach them.
 *
 * This is a **display** predicate, not an authorization one. The authority is
 * `BroadcastDispatchStrategy`, which additionally re-reads `riders.status` and
 * excludes riders already holding a delivery. A screen uses this to explain why
 * a rider is or is not receiving work; nothing branches on it server-side.
 */
export function isDispatchable(availability: RiderAvailability | null): boolean {
  return availability?.isOnline === true && availability.locationRecordedAt !== null;
}
