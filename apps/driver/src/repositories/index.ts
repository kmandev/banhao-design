/**
 * Repository bindings — the swap point between UI and data source.
 *
 *   Screen → Hook → Repository → (Supabase | API)
 *
 * Same seam `apps/customer/src/repositories/index.ts` establishes, and for the
 * same reason: screens depend on the interfaces, so the binding can change
 * without touching a screen.
 *
 * **No mock bindings.** The Customer App ships mock repositories because its
 * catalog screens predate the backend; nothing here does. Every screen in this
 * app reads live rider state, and a fixture that made a rider look approved or
 * online would be exactly the fabricated state `AGENTS.md` forbids. Tests
 * substitute their own stubs through this object, as `AddressScreen.test.tsx`
 * already does on the customer side.
 *
 * `G6.3`/`G6.4`'s `riderOrderView` and `riderOfferInbox` are deliberately
 * **not** bound here. They are Phase G-7.1/G-7.2 contracts with no screen in
 * this slice, and binding them now would claim a consumer that does not exist.
 */

import { supabase } from '../lib/supabase';
import { createRiderProfileRepository, type RiderProfileRepository } from './riderProfile';
import {
  createRiderAvailabilityRepository,
  type RiderAvailabilityRepository,
} from './riderAvailability';
import { createApiRiderLocationRepository, type RiderLocationRepository } from './apiRiderLocation';
import { captureForegroundPosition } from '../lib/deviceLocation';
import type { DevicePosition } from '../lib/deviceLocation';

export * from './riderProfile';
export * from './riderAvailability';
export * from './apiRiderLocation';

/** The device's own position source, behind an interface so a test never needs a GPS. */
export interface DeviceLocationSource {
  capturePosition(): Promise<DevicePosition>;
}

export interface Repositories {
  riderProfile: RiderProfileRepository;
  availability: RiderAvailabilityRepository;
  location: RiderLocationRepository;
  deviceLocation: DeviceLocationSource;
}

export const repositories: Repositories = {
  riderProfile: createRiderProfileRepository(supabase),
  availability: createRiderAvailabilityRepository(supabase),
  location: createApiRiderLocationRepository(),
  deviceLocation: { capturePosition: captureForegroundPosition },
};
