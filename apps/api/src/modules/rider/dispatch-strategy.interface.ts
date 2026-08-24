/**
 * The swappable dispatch seam — DEC-020: *"build the dispatcher behind an
 * interface so the model is swappable — the same discipline DEC-015 applies to
 * payment providers."*
 *
 * `DispatchService` owns *when* a round runs, what a round writes, and every
 * idempotency and concurrency guarantee. A strategy owns exactly one question:
 * **which riders are eligible right now.** That split is what lets Stage 2
 * replace broadcast with zones or nearest-first by binding a different class in
 * `RiderModule` — with no change to the round, the offer table, the accept
 * path, or anything in the order and payment domains.
 */

/** Injection token for the active strategy. Bound once, in `RiderModule`. */
export const DISPATCH_STRATEGY = Symbol('DISPATCH_STRATEGY');

export interface DispatchStrategy {
  /**
   * The rider ids that may receive an offer in this round.
   *
   * Takes no delivery argument, and that is a statement about DEC-037 rather
   * than an oversight: the Phase 1 pool is `APPROVED` + online + a valid
   * recorded location, with **no radius, distance, zone, ranking or fairness
   * input**, so it cannot depend on which delivery is being dispatched. A
   * future model that *does* depend on the delivery changes this signature —
   * a deliberate, visible break, exactly like swapping a payment provider.
   */
  selectCandidateRiderIds(): Promise<string[]>;
}
