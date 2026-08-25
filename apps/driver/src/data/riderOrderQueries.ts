/**
 * Rider read-path queries — Phase G, V1.1 §15's `RiderOrderView` contract.
 *
 * **Direct client → Supabase reads, under RLS** (DEC-APP-008). Selects go
 * against the three deployed `rider_order_*` views ONLY — never the base
 * `orders`/`order_items`/`order_item_options` tables, which grant a rider no
 * `SELECT` policy at all as of `20260811000012_rider_order_views.sql`
 * (`orders_select_rider` and its two siblings are dropped by that same
 * migration). There is no `GET /api/v1/rider/...` order-read endpoint and
 * this file does not add one — DEC-APP-008 routes this read client→Supabase.
 *
 * **No `rider_id` filter anywhere in this file, ever.** Row scope is
 * `public.is_assigned_order_rider()`, baked into each view's own `where`
 * clause and evaluated against the caller's session
 * (`security_barrier = true` — the security boundary, not a client
 * convenience; see the migration's own header for the query-error oracle
 * that option closes). `fetchAssignedOrder` is unfiltered, the same
 * "ownership is the view/RLS scope, not a query filter" discipline
 * `orderQueries.ts#fetchOrderHistory` documents for the customer app; the two
 * item/option fetches below take an id purely to narrow rows the view has
 * already authorized — same discipline `orderQueries.ts#fetchOrder`
 * documents — never to grant new access.
 *
 * Errors always throw, exactly as `orderQueries.ts` documents: a failed read
 * must never be returned as an empty result.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderOrderItemOptionRow, RiderOrderItemRow, RiderOrderRow } from './riderOrderMappers';

const RIDER_ORDER_COLUMNS =
  'id, order_number, state, restaurant_id, restaurant_name_snapshot, delivery_address_snapshot, delivery_lat, delivery_lng, delivery_landmark, recipient_name_snapshot, recipient_phone_snapshot, distance_m, quoted_eta_minutes, placed_at, accepted_at, ready_at, picked_up_at, delivered_at, cancelled_at, created_at, updated_at';

const RIDER_ORDER_ITEM_COLUMNS = 'id, order_id, item_name_snapshot, quantity, note, created_at';

const RIDER_ORDER_ITEM_OPTION_COLUMNS =
  'id, order_item_id, group_name_snapshot, option_name_snapshot, created_at';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Rider order ${operation} failed: ${message}`);
}

/**
 * The order currently assigned to the caller, or `null` if there is none.
 *
 * Unfiltered — `rider_order_view`'s own `where is_assigned_order_rider(o.id)`
 * already scopes every row to the caller, so a `rider_id` filter here would
 * duplicate a security boundary in the one place that cannot enforce it.
 * DEC-037 limits a rider to one active delivery at a time, so this returns
 * at most one row today; `data?.[0] ?? null` takes whatever the view has
 * already authorized, not a client-side ranking of candidates.
 */
export async function fetchAssignedOrder(client: SupabaseClient): Promise<RiderOrderRow | null> {
  const { data, error } = await client
    .from('rider_order_view')
    .select(RIDER_ORDER_COLUMNS)
    .returns<RiderOrderRow[]>();

  if (error) raise('read', error.message);
  return data?.[0] ?? null;
}

/**
 * Every line of the order, in creation order (no `sort_order` column exists,
 * same as `order_items`). `orderId` narrows rows the view has already
 * authorized — it cannot widen them: `is_assigned_order_rider` still gates
 * every row of `rider_order_item_view` regardless of this filter.
 */
export async function fetchRiderOrderItems(
  client: SupabaseClient,
  orderId: string,
): Promise<RiderOrderItemRow[]> {
  const { data, error } = await client
    .from('rider_order_item_view')
    .select(RIDER_ORDER_ITEM_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .returns<RiderOrderItemRow[]>();

  if (error) raise('items', error.message);
  return data ?? [];
}

/** Every selected option across a batch of order lines, one query for the whole order. */
export async function fetchRiderOrderItemOptions(
  client: SupabaseClient,
  orderItemIds: string[],
): Promise<RiderOrderItemOptionRow[]> {
  if (orderItemIds.length === 0) return [];

  const { data, error } = await client
    .from('rider_order_item_option_view')
    .select(RIDER_ORDER_ITEM_OPTION_COLUMNS)
    .in('order_item_id', orderItemIds)
    .returns<RiderOrderItemOptionRow[]>();

  if (error) raise('item options', error.message);
  return data ?? [];
}
