/**
 * POD retention parameters — **DEC-039**, resolving the retention half of
 * Q-012 for Phase 1 (the lawful-basis half stays `LEGAL_REVIEW_REQUIRED`; see
 * the decision).
 *
 * Constants, not environment variables — the same reasoning
 * `dispatch-policy.ts` (DEC-037) already documents for its own numbers: an
 * approved business value belongs in the decision log and in code that cites
 * it, not in deployment configuration where it can drift per environment with
 * no record of who changed it. `POD_RETENTION_PURGE_ENABLED` (an operational
 * on/off switch, not a business value) is the one piece of this feature that
 * *is* an environment variable, in `@banhao/config` — see
 * `ProofPhotoRetentionService`.
 *
 * Changing either number below is changing DEC-039, not tuning a default.
 */

/** BQ-018 / Q-012, DEC-039 — how long a *referenced* proof photo is kept, from `delivered_at`. */
export const POD_RETENTION_DAYS = 90;

/**
 * DEC-039 — how long an *unreferenced* object (a retake, or an abandoned
 * upload) is kept, from the object's own creation time in R2.
 *
 * Shorter than {@link POD_RETENTION_DAYS} because an orphan has no evidential
 * value at all — see `ProofPhotoRetentionService`'s orphan sweep.
 */
export const POD_ORPHAN_RETENTION_DAYS = 7;

/** How many `deliveries` rows one tick's referenced-photo purge claims at most — matches `DISPATCH_BATCH_SIZE`'s and `PaymentAttemptExpiryService`'s bound. */
export const POD_RETENTION_BATCH_SIZE = 25;

/** How many R2 objects one tick's orphan sweep lists at most — one page, never paginated within a single tick. */
export const POD_ORPHAN_SWEEP_PAGE_SIZE = 100;

/** The only namespace the orphan sweep is ever allowed to look at or delete from. */
export const POD_PROOF_OBJECT_PREFIX = 'deliveries/';
