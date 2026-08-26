/**
 * Rider active-delivery query — Phase G-7.2.
 *
 * **Direct client → Supabase read, under RLS** (DEC-APP-008). Selects go
 * against `deliveries` only, scoped by its own `deliveries_select_rider`
 * policy (`supabase/migrations/20260811000011_rls_policies.sql:566`,
 * `using (public.is_assigned_rider(rider_id))`), which the migration pairs
 * with `grant select on public.deliveries to authenticated`. No migration,
 * no view, and no new policy is required for this read — see
 * `docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md` §4.1.
 *
 * **No `rider_id` filter, ever.** Same discipline `riderOfferQueries.ts` and
 * `riderOrderQueries.ts` both document: row scope is the table's own RLS
 * predicate, evaluated against the caller's session, not a client-side filter
 * that would duplicate (and could drift from) that security boundary. There is
 * no rider id available on the client to filter by in any case — the driver
 * app holds a Supabase user id, never a `riders.id`.
 *
 * The `state in (...)` filter is a business filter, not an authorization one:
 * it narrows an already-authorized row set down to the delivery the rider is
 * actually working, excluding the terminal ones a rider can no longer act on.
 *
 * Errors always throw, exactly as the sibling query modules document: a failed
 * read must never be returned as "no active delivery", which would tell a
 * rider mid-delivery that they have no job.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_DELIVERY_STATES } from '../domain/riderDelivery';
import type { RiderDeliveryRow } from './riderDeliveryMappers';

const RIDER_DELIVERY_COLUMNS = 'id, order_id, state, assigned_at, picked_up_at, delivered_at';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Rider delivery ${operation} failed: ${message}`);
}

/**
 * The delivery the caller is currently working, or `null` if there is none.
 *
 * DEC-037 limits a rider to one active delivery at a time (enforced server-side
 * by `OfferAcceptanceService.claimRiderSlot`'s CAS on
 * `rider_availability.active_delivery_count`), so this returns at most one row
 * today. `data?.[0] ?? null` takes whatever RLS has already authorized rather
 * than applying a client-side ranking — the same shape
 * `riderOrderQueries.fetchAssignedOrder` uses for the order half.
 */
export async function fetchActiveDelivery(
  client: SupabaseClient,
): Promise<RiderDeliveryRow | null> {
  const { data, error } = await client
    .from('deliveries')
    .select(RIDER_DELIVERY_COLUMNS)
    .in('state', [...ACTIVE_DELIVERY_STATES])
    .returns<RiderDeliveryRow[]>();

  if (error) raise('read', error.message);
  return data?.[0] ?? null;
}
