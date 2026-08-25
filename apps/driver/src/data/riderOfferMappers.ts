/**
 * Database row → domain mapper for the rider's offer-inbox read path
 * (Phase G, V1.1 §9).
 *
 * `RiderOfferAttemptRow` is exactly the allowed projection of
 * `rider_assignment_attempts` for this read path — `id`, `delivery_id`,
 * `round_no`, `offered_at`, `expires_at`, `outcome`. Deliberately no
 * `rider_id`: the table's own `rider_assignment_attempts_select_own` RLS
 * policy is what scopes every row to the caller, so a client-side identity
 * field is never read, following the same discipline
 * `riderOrderMappers.ts` documents for the assigned-order read path.
 *
 * Same two rules as `riderOrderMappers.ts`: nothing here is invented beyond
 * a column rename, and no money field exists in the row or the mapped shape.
 */

import type { RiderOfferSummary } from '../domain/riderOffer';

/** The allowed columns of `rider_assignment_attempts` for this read path. */
export interface RiderOfferAttemptRow {
  id: string;
  delivery_id: string;
  round_no: number;
  offered_at: string;
  expires_at: string | null;
  outcome: string;
}

export function toRiderOfferSummary(row: RiderOfferAttemptRow): RiderOfferSummary {
  return {
    offerId: row.id,
    deliveryId: row.delivery_id,
    roundNo: row.round_no,
    offeredAt: row.offered_at,
    expiresAt: row.expires_at,
    outcome: row.outcome,
  };
}
