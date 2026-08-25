/**
 * Driver App offer-inbox domain — the rider's read path to a broadcast offer
 * before accepting it (Phase G, V1.1 §9 "How a rider receives work").
 *
 * `rider_assignment_attempts` is "a rider's only read path to a broadcast
 * offer before they accept — an unaccepted rider is not yet a party to the
 * order or the delivery" (see the table's own comment,
 * `supabase/migrations/20260811000009_delivery_domain.sql`, and
 * `docs/DATABASE_DESIGN.md` § 18 "The rider's read path"). That doc is
 * explicit that the row "carries only what an accept decision needs" — a
 * privacy boundary, not an oversight — so this type stays exactly as narrow
 * as the table: no restaurant, address, distance, or money field is added
 * here that the table doesn't already carry.
 *
 * Unlike `RiderOrderDetail` (singular — DEC-037 limits a rider to one active
 * *delivery*), broadcast dispatch (DEC-020) can leave a rider holding several
 * concurrent `PENDING` offers across different deliveries in the same round,
 * so the read path here is a list.
 */

export interface RiderOfferSummary {
  offerId: string;
  deliveryId: string;
  roundNo: number;
  offeredAt: string;
  expiresAt: string | null;
  outcome: string;
}
