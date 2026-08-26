/**
 * Database row → domain mapper for the rider's active-delivery read path
 * (Phase G-7.2).
 *
 * `RiderDeliveryRow` is exactly the allowed projection of `deliveries` for
 * this read path — `id`, `order_id`, `state`, `assigned_at`, `picked_up_at`,
 * `delivered_at`. Deliberately **no** `rider_id`: the table's own
 * `deliveries_select_rider` policy (`is_assigned_rider(rider_id)`) is what
 * scopes every row to the caller, so a client-side identity field is never
 * read — the same discipline `riderOfferMappers.ts` and `riderOrderMappers.ts`
 * both document.
 *
 * Deliberately **no** `rider_earning_satang` (BQ-029 is `OPEN`) and **no**
 * `proof_photo_path` (POD is the next phase). Unlike the order views, the RLS
 * grant here is a full-row one, so leaving those columns out is this file's
 * responsibility rather than the database's — see `domain/riderDelivery.ts`.
 *
 * Same two rules as the sibling mappers: nothing here is invented beyond a
 * column rename, and no money field exists in the row or the mapped shape.
 */

import type { RiderActiveDelivery } from '../domain/riderDelivery';

/** The allowed columns of `deliveries` for this read path. */
export interface RiderDeliveryRow {
  id: string;
  order_id: string;
  state: string;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export function toRiderActiveDelivery(row: RiderDeliveryRow): RiderActiveDelivery {
  return {
    deliveryId: row.id,
    orderId: row.order_id,
    state: row.state,
    assignedAt: row.assigned_at,
    pickedUpAt: row.picked_up_at,
    deliveredAt: row.delivered_at,
  };
}
