/**
 * Supabase-backed rider identity repository — the approval gate's read path
 * (Phase G, DEC-UX-006).
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `riderOrderView.ts` and `riderOfferInbox.ts`. There is no NestJS endpoint
 * for this and none should be added: `riders_select_own` already scopes the
 * row, and `GET /api/v1/me` resolves *capabilities* for the API's own guards,
 * not the rider record a status screen renders.
 *
 * ## What this repository must never do
 *
 * It must never fabricate approval. `null` means the signed-in user has no
 * `riders` row; a thrown error means the read failed. Neither may be collapsed
 * into "approved", and neither may be collapsed into the other — a suspended
 * rider and an outage look nothing alike to the person holding the phone.
 *
 * Rider onboarding — what a rider submits, who approves it, and the contractual
 * relationship — is **BQ-022, `OPEN` and `LEGAL_REVIEW_REQUIRED`**. This
 * repository therefore reads and never writes: there is no create, no submit,
 * and no document upload anywhere in this app.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderProfile } from '../domain/riderProfile';
import { fetchOwnRider } from '../data/riderProfileQueries';
import { toRiderProfile } from '../data/riderProfileMappers';

export interface RiderProfileRepository {
  /** The caller's own rider record, or `null` if they are not a rider. */
  getOwnProfile(): Promise<RiderProfile | null>;
}

export function createRiderProfileRepository(client: SupabaseClient): RiderProfileRepository {
  return {
    getOwnProfile: async () => {
      const row = await fetchOwnRider(client);
      return row ? toRiderProfile(row) : null;
    },
  };
}
