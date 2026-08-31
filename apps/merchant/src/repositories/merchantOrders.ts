/**
 * Supabase-backed Order Board repository — the initial-fetch half of
 * M2-RT-001 (M-2.3). The Realtime subscription half is explicitly deferred
 * to M-2.4 and does not exist in this file.
 *
 * Reads go client → Supabase directly under RLS (DEC-APP-008), mirroring
 * `merchantRestaurant.ts`. There is no NestJS endpoint for this and none
 * should be added: `orders_select_merchant` already scopes the rows to
 * restaurants this caller is an active member of.
 *
 * ## What this repository must never do
 *
 * It must never fabricate an order, and it must never treat a fetch failure
 * as an empty board — an empty array means the restaurant genuinely has no
 * matching orders yet, and a thrown error means the read itself failed; the
 * caller must be able to tell those two apart and must not retry-forever on
 * the first or silently show "no orders" on the second.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MerchantOrderSummary } from '../domain/order';
import { fetchRestaurantOrders, toMerchantOrderSummary } from '../data/orderQueries';

export interface MerchantOrdersRepository {
  /**
   * The given restaurant's current order-board projection, newest first.
   * May be empty. `restaurantId` must already be a verified membership (see
   * `fetchRestaurantOrders`'s own doc comment) — this call does not check
   * that itself.
   */
  listRestaurantOrders(restaurantId: string): Promise<MerchantOrderSummary[]>;
}

export function createMerchantOrdersRepository(client: SupabaseClient): MerchantOrdersRepository {
  return {
    listRestaurantOrders: async (restaurantId: string) => {
      const rows = await fetchRestaurantOrders(client, restaurantId);
      return rows.map(toMerchantOrderSummary);
    },
  };
}
