/**
 * Rider offer-inbox query — Phase G, V1.1 §9 "How a rider receives work".
 *
 * **Direct client → Supabase read, under RLS** (DEC-APP-008). Selects go
 * against `rider_assignment_attempts` only, scoped by its own
 * `rider_assignment_attempts_select_own` policy
 * (`supabase/migrations/20260811000011_rls_policies.sql`) — never a view,
 * and never the `deliveries`/`orders` tables a not-yet-accepted rider has no
 * policy on at all.
 *
 * **No `rider_id` filter, ever.** Same discipline `riderOrderQueries.ts`
 * documents for the assigned-order read path: row scope is the table's own
 * RLS predicate, evaluated against the caller's session, not a client-side
 * filter that would duplicate (and could drift from) that security boundary.
 *
 * The `outcome = 'PENDING'` filter is a business filter, not an
 * authorization one — it narrows an already-authorized row set down to
 * offers still open for an accept/decline decision, matching the deployed
 * `rider_assignment_attempts_pending_idx` partial index.
 *
 * Errors always throw, exactly as `riderOrderQueries.ts` documents: a failed
 * read must never be returned as an empty list.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderOfferAttemptRow } from './riderOfferMappers';

const RIDER_OFFER_COLUMNS = 'id, delivery_id, round_no, offered_at, expires_at, outcome';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Rider offer ${operation} failed: ${message}`);
}

/**
 * Every offer currently open for the caller to accept or decline.
 *
 * Zero, one, or several rows can come back — broadcast dispatch (DEC-020)
 * can leave a rider holding concurrent `PENDING` offers for different
 * deliveries in the same round; DEC-037's one-active-delivery limit governs
 * *accepted* deliveries, not offered ones.
 */
export async function fetchPendingOffers(client: SupabaseClient): Promise<RiderOfferAttemptRow[]> {
  const { data, error } = await client
    .from('rider_assignment_attempts')
    .select(RIDER_OFFER_COLUMNS)
    .eq('outcome', 'PENDING')
    .returns<RiderOfferAttemptRow[]>();

  if (error) raise('read', error.message);
  return data ?? [];
}
