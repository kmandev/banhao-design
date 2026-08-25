/**
 * Supabase-backed rider offer-inbox repository — Phase G, V1.1 §9's
 * `rider_assignment_attempts` read path.
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `riderOrderView.ts` exactly. There is no NestJS endpoint for this and none
 * should be added — the accept (G2) and decline (G6.2) endpoints already
 * exist; what was missing was a way for a rider client to discover a
 * pending `offerId` to call them with.
 *
 * Unlike `RiderOrderViewRepository.getAssignedOrder()`, this returns a list:
 * broadcast dispatch (DEC-020) can leave a rider holding several concurrent
 * `PENDING` offers at once, across different deliveries in the same round.
 *
 * Same as `riderOrderView.ts`: no default client parameter. apps/driver has
 * no Supabase client singleton yet — a caller constructs this repository
 * with whatever authenticated client the eventual driver-app session
 * provides.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderOfferSummary } from '../domain/riderOffer';
import { fetchPendingOffers } from '../data/riderOfferQueries';
import { toRiderOfferSummary } from '../data/riderOfferMappers';

/**
 * The rider's own read path to their currently open offers.
 *
 * An empty list means the rider has no pending offer right now — not an
 * error, and not a special case: the same "no active row is not a failure"
 * discipline `RiderOrderViewRepository` documents for `null`.
 */
export interface RiderOfferInboxRepository {
  listPendingOffers(): Promise<RiderOfferSummary[]>;
}

export function createRiderOfferInboxRepository(client: SupabaseClient): RiderOfferInboxRepository {
  return {
    listPendingOffers: async () => {
      const rows = await fetchPendingOffers(client);
      return rows.map(toRiderOfferSummary);
    },
  };
}
