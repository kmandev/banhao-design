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
 * M-11 and M-12 add two more: `merchantMenu` (the catalog) and
 * `merchantHours` (the weekly schedule). Both draw the same read/write split
 * as `merchantOrders` — Supabase under RLS for reads, the API for every write
 * — and both take the API client as an optional second argument defaulting to
 * the app's own; only tests pass it explicitly.
 */

import { supabase } from '../lib/supabase';
import {
  createMerchantRestaurantRepository,
  type MerchantRestaurantRepository,
} from './merchantRestaurant';
import { createMerchantOrdersRepository, type MerchantOrdersRepository } from './merchantOrders';
import { createMerchantMenuRepository, type MerchantMenuRepository } from './merchantMenu';
import { createMerchantHoursRepository, type MerchantHoursRepository } from './merchantHours';
import { createMerchantProfileRepository, type MerchantProfileRepository } from './merchantProfile';
import {
  createMerchantAvailabilityRepository,
  type MerchantAvailabilityRepository,
} from './merchantAvailability';

export * from './merchantRestaurant';
export * from './merchantOrders';
export * from './merchantMenu';
export * from './merchantHours';
export * from './merchantProfile';
export * from './merchantAvailability';

export interface Repositories {
  merchantRestaurant: MerchantRestaurantRepository;
  merchantOrders: MerchantOrdersRepository;
  merchantMenu: MerchantMenuRepository;
  merchantHours: MerchantHoursRepository;
  merchantProfile: MerchantProfileRepository;
  merchantAvailability: MerchantAvailabilityRepository;
}

export const repositories: Repositories = {
  merchantRestaurant: createMerchantRestaurantRepository(supabase),
  merchantOrders: createMerchantOrdersRepository(supabase),
  merchantMenu: createMerchantMenuRepository(supabase),
  merchantHours: createMerchantHoursRepository(supabase),
  merchantProfile: createMerchantProfileRepository(supabase),
  merchantAvailability: createMerchantAvailabilityRepository(supabase),
};
