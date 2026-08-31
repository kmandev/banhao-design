/**
 * Repository bindings — the swap point between UI and data source.
 *
 *   Screen → Hook → Repository → (Supabase | API)
 *
 * Same seam apps/driver/src/repositories/index.ts and
 * apps/customer/src/repositories/index.ts establish, and for the same
 * reason: screens depend on the interfaces, so the binding can change
 * without touching a screen. Tests substitute their own stubs against the
 * `MerchantRestaurantRepository` interface directly rather than through this
 * object, the same way apps/driver's tests do.
 *
 * M-1 needed exactly one repository — restaurant membership, for
 * authorization and restaurant selection. M-2.3 adds the Order Board's
 * initial-fetch repository alongside it (the Realtime subscription half is
 * M-2.4, not bound here). M-2.7 adds the board's three transition commands
 * to that same repository rather than a third binding — see
 * `merchantOrders.ts` on why its read and write halves share one module.
 *
 * `createMerchantOrdersRepository` takes the API client as an optional second
 * argument defaulting to the app's own; only tests pass it explicitly.
 */

import { supabase } from '../lib/supabase';
import {
  createMerchantRestaurantRepository,
  type MerchantRestaurantRepository,
} from './merchantRestaurant';
import { createMerchantOrdersRepository, type MerchantOrdersRepository } from './merchantOrders';

export * from './merchantRestaurant';
export * from './merchantOrders';

export interface Repositories {
  merchantRestaurant: MerchantRestaurantRepository;
  merchantOrders: MerchantOrdersRepository;
}

export const repositories: Repositories = {
  merchantRestaurant: createMerchantRestaurantRepository(supabase),
  merchantOrders: createMerchantOrdersRepository(supabase),
};
