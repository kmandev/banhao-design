/**
 * Rider availability queries — Phase G, DEC-037's eligibility row.
 *
 * **Direct client → Supabase, under RLS** (DEC-APP-008). Both statements below
 * go against `public.rider_availability` and nothing else, scoped by
 * `rider_availability_select_own` / `rider_availability_update_own`
 * (`supabase/migrations/20260811000011_rls_policies.sql`), both of which
 * resolve the row through `riders.user_id = auth.uid()`.
 *
 * **No `rider_id` filter in this file, anywhere, on either statement.** Row
 * scope is the table's own RLS predicate evaluated against the caller's
 * session — the same discipline `riderOrderQueries.ts` and
 * `riderOfferQueries.ts` document for their read paths. A client-side identity
 * filter would duplicate a security boundary in the one place that cannot
 * enforce it.
 *
 * **The write surface is one column.** `docs/DATABASE_DESIGN.md` §18 records
 * this table's rider column as `S,U(own online flag)`, and the deployed grant
 * is literally `grant select, update (is_online) on public.rider_availability
 * to authenticated`. `last_lat`, `last_lng`, `active_delivery_count` and
 * `blocked_reason` are outside that grant and are never written here —
 * coordinates reach the database only through
 * `POST /api/v1/rider/location`, which runs as the service role.
 *
 * Errors always throw, exactly as the sibling query modules document: a failed
 * read must never be returned as "offline", and a failed write must never be
 * returned as a successful toggle.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderAvailabilityRow } from './riderAvailabilityMappers';

/**
 * The fixed projection. Four columns exist that are **not** here on purpose —
 * see `domain/riderAvailability.ts` for why `active_delivery_count`,
 * `blocked_reason`, `last_lat` and `last_lng` are each excluded.
 */
const AVAILABILITY_COLUMNS = 'is_online, location_updated_at';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Rider availability ${operation} failed: ${message}`);
}

/**
 * The caller's own availability row, or `null` if none exists yet.
 *
 * `null` is a real state, not an error: `rider_availability` rows are created
 * lazily by `RiderLocationService` on a rider's first location write, so a
 * rider who has never been online has no row at all. Callers render that as
 * offline-with-no-position — never as a failure, and never by inventing a row.
 *
 * `maybeSingle` rather than a list-then-`[0]`: `rider_id` is this table's
 * primary key and `riders_user_id_key` makes one rider per user structural, so
 * two rows would be an invariant violation that deserves to surface, not be
 * silently narrowed away.
 */
export async function fetchOwnAvailability(
  client: SupabaseClient,
): Promise<RiderAvailabilityRow | null> {
  const { data, error } = await client
    .from('rider_availability')
    .select(AVAILABILITY_COLUMNS)
    .maybeSingle<RiderAvailabilityRow>();

  if (error) raise('read', error.message);
  return data ?? null;
}

/**
 * Flips the caller's own online flag — a **guarded conditional UPDATE**.
 *
 * The `.eq('is_online', !next)` is ADR-003 applied to the one write this app
 * has: the state check lives in the `WHERE` clause, never in a `SELECT` the
 * client then branches on. Two taps racing each other contend for one row and
 * exactly one of them sees a row come back; the loser gets `null` and the
 * caller re-reads rather than assuming.
 *
 * That predicate narrows rows RLS has **already** authorized — it cannot widen
 * them, which is the same "a filter may narrow, never grant" reasoning
 * `riderOrderQueries.fetchRiderOrderItems` documents for its `order_id`.
 *
 * The payload is exactly `{ is_online }`. Nothing else is in the grant, so
 * anything else in this object would be rejected by Postgres — and would be
 * wrong even if it were not.
 *
 * Returns the updated row, or `null` when the guard matched nothing: either the
 * row was already in the target state, or the rider has no availability row at
 * all. The two are indistinguishable here by design; `riderAvailability.ts`
 * re-reads to tell them apart rather than guessing.
 */
export async function updateOwnOnlineFlag(
  client: SupabaseClient,
  isOnline: boolean,
): Promise<RiderAvailabilityRow | null> {
  const { data, error } = await client
    .from('rider_availability')
    .update({ is_online: isOnline })
    .eq('is_online', !isOnline)
    .select(AVAILABILITY_COLUMNS)
    .maybeSingle<RiderAvailabilityRow>();

  if (error) raise('update', error.message);
  return data ?? null;
}
