/**
 * Rider identity query — Phase G, the approval gate's read path.
 *
 * **Direct client → Supabase read, under RLS** (DEC-APP-008). The select goes
 * against `public.riders`, scoped by its own `riders_select_own` policy
 * (`user_id = auth.uid()`,
 * `supabase/migrations/20260811000011_rls_policies.sql`).
 *
 * **No `user_id` or `rider_id` filter, ever.** Same discipline
 * `riderOrderQueries.ts` and `riderOfferQueries.ts` document: row scope is the
 * table's own RLS predicate, evaluated against the caller's session, never a
 * client-side filter that would duplicate — and could drift from — that
 * security boundary.
 *
 * Errors always throw. A failed read must never be returned as "no rider",
 * because "no rider" is a state the approval gate renders as a legitimate
 * screen; collapsing an outage into it would tell a suspended or approved
 * rider something false about their own account.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderProfileRow } from './riderProfileMappers';

const RIDER_COLUMNS = 'id, full_name, status, vehicle_type, plate';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Rider profile ${operation} failed: ${message}`);
}

/**
 * The caller's own rider record, or `null` if they have none.
 *
 * `maybeSingle` rather than a list-then-`[0]`: `riders_user_id_key` makes at
 * most one rider row per user a structural guarantee of the schema, not a
 * policy that could change, so more than one row is a genuine invariant
 * violation and should surface as an error rather than be silently narrowed.
 */
export async function fetchOwnRider(client: SupabaseClient): Promise<RiderProfileRow | null> {
  const { data, error } = await client
    .from('riders')
    .select(RIDER_COLUMNS)
    .maybeSingle<RiderProfileRow>();

  if (error) raise('read', error.message);
  return data ?? null;
}
