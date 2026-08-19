/**
 * Supabase-backed `OrderDetailRepository` (Phase E-3B.1).
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `supabaseCatalog.ts` exactly: composition happens here so each query in
 * `orderQueries.ts` stays a single, testable statement, and the options
 * batch fetch has somewhere to be stitched back onto its items.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultClient } from '../lib/supabase';
import type { OrderItemOption, OrderLineItem } from '../domain/order';
import { fetchOrder, fetchOrderItemOptions, fetchOrderItems, fetchOrderStatusHistory } from '../data/orderQueries';
import {
  toOrderDetail,
  toOrderItemOption,
  toOrderLineItem,
  toOrderStatusEvent,
} from '../data/orderMappers';
import type { OrderDetailRepository } from './types';

/** Options grouped by their order line, so each item is assembled in one pass. */
function groupOptions(
  optionRows: Awaited<ReturnType<typeof fetchOrderItemOptions>>,
): Map<string, OrderItemOption[]> {
  const byItem = new Map<string, OrderItemOption[]>();

  for (const row of optionRows) {
    const mapped = toOrderItemOption(row);
    const existing = byItem.get(row.order_item_id);
    if (existing) existing.push(mapped);
    else byItem.set(row.order_item_id, [mapped]);
  }

  return byItem;
}

export function createSupabaseOrderDetailRepository(
  client: SupabaseClient = defaultClient,
): OrderDetailRepository {
  return {
    getOrder: async (orderId) => {
      const order = await fetchOrder(client, orderId);
      if (!order) return null;

      const [itemRows, statusRows] = await Promise.all([
        fetchOrderItems(client, orderId),
        fetchOrderStatusHistory(client, orderId),
      ]);

      const optionRows = await fetchOrderItemOptions(
        client,
        itemRows.map((row) => row.id),
      );
      const optionsByItem = groupOptions(optionRows);

      const items: OrderLineItem[] = itemRows.map((row) =>
        toOrderLineItem(row, optionsByItem.get(row.id) ?? []),
      );

      return toOrderDetail(order, items, statusRows.map(toOrderStatusEvent));
    },
  };
}

export const supabaseOrderDetailRepository = createSupabaseOrderDetailRepository();
