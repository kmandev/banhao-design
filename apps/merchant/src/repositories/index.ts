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
 * M-1 needs exactly one repository — restaurant membership, for
 * authorization and restaurant selection. An order repository is explicitly
 * out of scope for this phase (see the M-1 brief's "DO NOT IMPLEMENT" list);
 * it will get its own binding here in M-2.
 */

import { supabase } from '../lib/supabase';
import {
  createMerchantRestaurantRepository,
  type MerchantRestaurantRepository,
} from './merchantRestaurant';

export * from './merchantRestaurant';

export interface Repositories {
  merchantRestaurant: MerchantRestaurantRepository;
}

export const repositories: Repositories = {
  merchantRestaurant: createMerchantRestaurantRepository(supabase),
};
