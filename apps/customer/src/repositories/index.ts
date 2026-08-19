/**
 * Repository bindings — the swap point between UI and data source.
 *
 *   Screen → Hook → Repository → (Mock | Supabase)
 *
 * Screens depend only on the interfaces in `./types`, which is what made the
 * Phase C catalog swap a one-line change here rather than a rewrite of four
 * screens.
 */

import type { OrderSummary, AppNotification, Address } from '../mocks/types';
import {
  orders as mockOrders,
  notifications as mockNotifications,
  addresses as mockAddresses,
} from '../mocks/data';
import { supabaseCatalogRepository } from './supabaseCatalog';
import { mockCatalogRepository } from './mockCatalog';
import { supabaseCartRepository } from './supabaseCart';
import { createMockCartRepository } from './mockCart';
import { apiCartValidationRepository } from './apiCartValidation';
import type {
  AddressRepository,
  CartValidationRepository,
  NotificationRepository,
  OrderRepository,
  Repositories,
} from './types';

export * from './types';
export { mockCatalogRepository } from './mockCatalog';
export { supabaseCatalogRepository, createSupabaseCatalogRepository } from './supabaseCatalog';
export {
  supabaseCartRepository,
  createSupabaseCartRepository,
  MixedRestaurantError,
  NotAuthenticatedError,
} from './supabaseCart';
export { createMockCartRepository, mockCartRepository } from './mockCart';
export {
  apiCartValidationRepository,
  createApiCartValidationRepository,
} from './apiCartValidation';

/**
 * Simulated latency, so loading states are actually exercised in development
 * rather than only existing in code. Screens must handle loading regardless.
 */
const LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

export const mockOrderRepository: OrderRepository = {
  listOrders: (): Promise<OrderSummary[]> => delay(mockOrders),
  getOrder: (orderId) => delay(mockOrders.find((o) => o.id === orderId) ?? null),
};

export const mockNotificationRepository: NotificationRepository = {
  listNotifications: (): Promise<AppNotification[]> => delay(mockNotifications),
};

export const mockAddressRepository: AddressRepository = {
  listAddresses: (): Promise<Address[]> => delay(mockAddresses),
};

/**
 * Fixture validation that always accepts, for screen tests that are not about
 * revalidation. A suite that *is* about it binds its own stub, exactly as the
 * cart suites already do.
 */
export const mockCartValidationRepository: CartValidationRepository = {
  validate: () =>
    delay({ cartId: 'mock-cart', restaurantId: 'mock-shop', subtotalSatang: 0, lines: [] }),
};

/**
 * The active repositories.
 *
 * **Catalog is live** — Supabase-backed as of Phase C / C-7, read directly from
 * PostgREST under RLS with the anon key (DEC-APP-008).
 *
 * **Cart is live** — Supabase-backed as of Phase D / D-4. It is the only
 * repository that writes, which DEC-APP-008 permits for the cart specifically.
 *
 * **Cart validation is live** — the one repository that talks to the NestJS
 * API, because a cart's re-pricing must come from the trusted writer rather
 * than from anything the device computed.
 *
 * Orders, notifications and addresses remain mock-backed: they belong to later
 * phases and Phase D deliberately does not touch them. (An addresses API now
 * exists from Phase B, but wiring the customer app to it is not Phase D work.)
 */
export const repositories: Repositories = {
  catalog: supabaseCatalogRepository,
  cart: supabaseCartRepository,
  cartValidation: apiCartValidationRepository,
  orders: mockOrderRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};

/**
 * Fixture bindings, for tests and offline UI work.
 *
 * `cart` is constructed per-object rather than shared, so a suite that fills a
 * cart cannot leak lines into the next one.
 */
export const mockRepositories: Repositories = {
  catalog: mockCatalogRepository,
  cart: createMockCartRepository(),
  cartValidation: mockCartValidationRepository,
  orders: mockOrderRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};
