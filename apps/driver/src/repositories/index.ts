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
 * `G6.3`'s `riderOrderView` **is** bound now (`riderOrderView`, below).
 * G-7.2's `ActiveDeliveryScreen` is its first consumer — it was deliberately
 * left unbound while no screen existed, and that condition no longer holds.
 * `G6.4`'s `riderOfferInbox` is bound as `offers`: G-7.1 is its consumer.
 *
 * `delivery` (read, Supabase under RLS) and `deliveryActions` (write, through
 * the NestJS API) are the G-7.2 pair, split for exactly the reason
 * `offers`/`offerActions` are: DEC-APP-008 puts reads on PostgREST and writes
 * on the API, and `deliveries` grants `authenticated` no `update` at all.
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
import { createRiderDeliveryRepository, type RiderDeliveryRepository } from './riderDelivery';
import {
  createRiderDeliveryActionsRepository,
  type RiderDeliveryActionsRepository,
} from './riderDeliveryActions';
import { createRiderOrderViewRepository, type RiderOrderViewRepository } from './riderOrderView';
import {
  createRiderProofUploadRepository,
  type RiderProofUploadRepository,
} from './riderProofUpload';
import { captureForegroundPosition } from '../lib/deviceLocation';
import type { DevicePosition } from '../lib/deviceLocation';

export * from './riderProfile';
export * from './riderAvailability';
export * from './apiRiderLocation';
export * from './riderOfferInbox';
export * from './riderOfferActions';
export * from './riderDelivery';
export * from './riderDeliveryActions';
export * from './riderOrderView';
export * from './riderProofUpload';

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
  delivery: RiderDeliveryRepository;
  deliveryActions: RiderDeliveryActionsRepository;
  riderOrderView: RiderOrderViewRepository;
  proofUpload: RiderProofUploadRepository;
  deviceLocation: DeviceLocationSource;
}

export const repositories: Repositories = {
  riderProfile: createRiderProfileRepository(supabase),
  availability: createRiderAvailabilityRepository(supabase),
  location: createApiRiderLocationRepository(),
  offers: createRiderOfferInboxRepository(supabase),
  offerActions: createRiderOfferActionsRepository(),
  delivery: createRiderDeliveryRepository(supabase),
  deliveryActions: createRiderDeliveryActionsRepository(),
  riderOrderView: createRiderOrderViewRepository(supabase),
  proofUpload: createRiderProofUploadRepository(),
  deviceLocation: { capturePosition: captureForegroundPosition },
};
