/**
 * Supabase-backed `OrderRepository` — the customer's own order history
 * (C-16, Phase E-3B.3).
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), the same path
 * `supabaseOrderDetail.ts` established for C-19. Composition happens here so
 * each query stays a single statement and the batched item fetch has somewhere
 * to be stitched back onto its orders.
 *
 * **Two queries total, regardless of how many orders the customer has.** The
 * list fetch, then one batched `in('order_id', …)` for every line across every
 * order — never one query per card.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultClient } from '../lib/supabase';
import { fetchOrderHistory, fetchOrderItemsForOrders } from '../data/orderQueries';
import { toOrderHistoryEntry, type OrderItemRow } from '../data/orderMappers';
import type { OrderRepository } from './types';

/** Line names and quantities grouped by order, preserving the query's ordering. */
function groupItems(rows: OrderItemRow[]): Map<string, { nameSnapshot: string; quantity: number }[]> {
  const byOrder = new Map<string, { nameSnapshot: string; quantity: number }[]>();

  for (const row of rows) {
    const line = { nameSnapshot: row.item_name_snapshot, quantity: row.quantity };
    const existing = byOrder.get(row.order_id);
    if (existing) existing.push(line);
    else byOrder.set(row.order_id, [line]);
  }

  return byOrder;
}

export function createSupabaseOrderHistoryRepository(
  client: SupabaseClient = defaultClient,
): OrderRepository {
  return {
    listOrders: async () => {
      const rows = await fetchOrderHistory(client);
      if (rows.length === 0) return [];

      const itemRows = await fetchOrderItemsForOrders(
        client,
        rows.map((row) => row.id),
      );
      const itemsByOrder = groupItems(itemRows);

      return rows.map((row) => toOrderHistoryEntry(row, itemsByOrder.get(row.id) ?? []));
    },
  };
}

export const supabaseOrderHistoryRepository = createSupabaseOrderHistoryRepository();
