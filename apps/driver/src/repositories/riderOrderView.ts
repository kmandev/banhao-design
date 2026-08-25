/**
 * Supabase-backed rider order-view repository — Phase G, V1.1 §15's
 * `RiderOrderView` contract.
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `apps/customer/src/repositories/supabaseOrderDetail.ts` exactly:
 * composition happens here so each query in `riderOrderQueries.ts` stays a
 * single, testable statement, and the options batch fetch has somewhere to
 * be stitched back onto its items.
 *
 * There is no NestJS endpoint for this and none should be added — V1.1 §15
 * names `RiderOrderView` as the way Phase G closes the rider read path, and
 * DEC-APP-008 routes it client→Supabase like every other read.
 *
 * Unlike `createSupabaseOrderDetailRepository`, this factory takes no default
 * client parameter: apps/driver has no Supabase client singleton yet (no
 * screen, navigation, or auth flow consumes one), and wiring one — session
 * storage, env vars, the works — is app-runtime scope this slice does not
 * touch. A caller constructs this repository with whatever authenticated
 * client the eventual driver-app session provides.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RiderOrderDetail, RiderOrderItemOption, RiderOrderLineItem } from '../domain/riderOrder';
import {
  fetchAssignedOrder,
  fetchRiderOrderItemOptions,
  fetchRiderOrderItems,
} from '../data/riderOrderQueries';
import { toRiderOrderDetail, toRiderOrderItemOption, toRiderOrderLineItem } from '../data/riderOrderMappers';

/**
 * The rider's own read path to the order they are currently assigned to.
 *
 * `null` means the rider has no active assignment right now — the same
 * "does not exist" and "not theirs" collapse `OrderDetailRepository`
 * documents, except here there is no id parameter at all for a caller to
 * have gotten wrong: authorization comes entirely from the caller's own
 * session via `is_assigned_order_rider()`. See `riderOrderQueries.ts` for
 * the full argument.
 */
export interface RiderOrderViewRepository {
  getAssignedOrder(): Promise<RiderOrderDetail | null>;
}

/** Options grouped by their order line, so each item is assembled in one pass. */
function groupOptions(
  optionRows: Awaited<ReturnType<typeof fetchRiderOrderItemOptions>>,
): Map<string, RiderOrderItemOption[]> {
  const byItem = new Map<string, RiderOrderItemOption[]>();

  for (const row of optionRows) {
    const mapped = toRiderOrderItemOption(row);
    const existing = byItem.get(row.order_item_id);
    if (existing) existing.push(mapped);
    else byItem.set(row.order_item_id, [mapped]);
  }

  return byItem;
}

export function createRiderOrderViewRepository(client: SupabaseClient): RiderOrderViewRepository {
  return {
    getAssignedOrder: async () => {
      const order = await fetchAssignedOrder(client);
      if (!order) return null;

      const itemRows = await fetchRiderOrderItems(client, order.id);
      const optionRows = await fetchRiderOrderItemOptions(
        client,
        itemRows.map((row) => row.id),
      );
      const optionsByItem = groupOptions(optionRows);

      const items: RiderOrderLineItem[] = itemRows.map((row) =>
        toRiderOrderLineItem(row, optionsByItem.get(row.id) ?? []),
      );

      return toRiderOrderDetail(order, items);
    },
  };
}
