/**
 * Supabase-backed active-delivery repository — Phase G-7.2.
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), the same seam
 * `riderOfferInbox.ts` and `riderOrderView.ts` already use. This is a **read**
 * repository only; every delivery *transition* is a write and goes through
 * `riderDeliveryActions.ts` to the NestJS API, never to PostgREST.
 *
 * That split is not a style choice. `deliveries` grants `authenticated` no
 * `update` at all (`revoke all ... from anon, authenticated` in
 * `20260811000009_delivery_domain.sql`, and `20260811000011_rls_policies.sql`
 * re-grants `select` only), so a client-side state write is not merely
 * discouraged — it is impossible. ADR-001 and ADR-003 are what the API
 * endpoints implement on the rider's behalf.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderActiveDelivery } from '../domain/riderDelivery';
import { fetchActiveDelivery } from '../data/riderDeliveryQueries';
import { toRiderActiveDelivery } from '../data/riderDeliveryMappers';

export interface RiderDeliveryRepository {
  /**
   * The delivery the caller is currently working, or `null` when they have
   * none.
   *
   * `null` means "no active delivery", never "the read failed" — a failure
   * throws, so a rider mid-delivery is never shown an empty screen because the
   * network dropped.
   */
  getActiveDelivery(): Promise<RiderActiveDelivery | null>;
}

export function createRiderDeliveryRepository(client: SupabaseClient): RiderDeliveryRepository {
  return {
    getActiveDelivery: async () => {
      const row = await fetchActiveDelivery(client);
      return row ? toRiderActiveDelivery(row) : null;
    },
  };
}
