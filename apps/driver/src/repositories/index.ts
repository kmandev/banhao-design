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
 * `G6.3`'s `riderOrderView` is deliberately **not** bound here. It is the
 * Phase G-7.2 contract, and G-7.2 has no screen in this slice — binding it now
 * would claim a consumer that does not exist. `G6.4`'s `riderOfferInbox` *is*
 * bound (`offers`, below): G-7.1 is its first consumer.
 */

import { supabase } from '../lib/supabase';
import { createRiderProfileRepository, type RiderProfileRepository } from './riderProfile';
import {
  createRiderAvailabilityRepository,
  type RiderAvailabilityRepository,
} from './riderAvailability';
import { createApiRiderLocationRepository, type RiderLocationRepository } from './apiRiderLocation';
import { createRiderOfferInboxRepository, type RiderOfferInboxRepository } from './riderOfferInbox';
import {
  createRiderOfferActionsRepository,
  type RiderOfferActionsRepository,
} from './riderOfferActions';
import { captureForegroundPosition } from '../lib/deviceLocation';
import type { DevicePosition } from '../lib/deviceLocation';

export * from './riderProfile';
export * from './riderAvailability';
export * from './apiRiderLocation';
export * from './riderOfferInbox';
export * from './riderOfferActions';

/** The device's own position source, behind an interface so a test never needs a GPS. */
export interface DeviceLocationSource {
  capturePosition(): Promise<DevicePosition>;
}

export interface Repositories {
  riderProfile: RiderProfileRepository;
  availability: RiderAvailabilityRepository;
  location: RiderLocationRepository;
  offers: RiderOfferInboxRepository;
  offerActions: RiderOfferActionsRepository;
  deviceLocation: DeviceLocationSource;
}

export const repositories: Repositories = {
  riderProfile: createRiderProfileRepository(supabase),
  availability: createRiderAvailabilityRepository(supabase),
  location: createApiRiderLocationRepository(),
  offers: createRiderOfferInboxRepository(supabase),
  offerActions: createRiderOfferActionsRepository(),
  deviceLocation: { capturePosition: captureForegroundPosition },
};
