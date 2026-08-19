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
import { apiOrderCreationRepository } from './apiOrderCreation';
import { apiAddressRepository } from './apiAddresses';
import { supabaseOrderDetailRepository } from './supabaseOrderDetail';
import type {
  AddressRepository,
  CartValidationRepository,
  NotificationRepository,
  OrderCreationRepository,
  OrderDetailRepository,
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
export {
  apiOrderCreationRepository,
  createApiOrderCreationRepository,
} from './apiOrderCreation';
export { apiAddressRepository, createApiAddressRepository } from './apiAddresses';
export {
  supabaseOrderDetailRepository,
  createSupabaseOrderDetailRepository,
} from './supabaseOrderDetail';

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

/** Fixture order-creation, for screen tests that are not about checkout. */
export const mockOrderCreationRepository: OrderCreationRepository = {
  create: () => delay({ orderId: 'mock-order', orderNumber: 'BH-00000000-0000', state: 'CREATED' }),
};

/** Fixture order-detail, for screen tests that are not about order tracking. */
export const mockOrderDetailRepository: OrderDetailRepository = {
  getOrder: () => delay(null),
};

/**
 * The active repositories.
 *
 * **Catalog is live** — Supabase-backed as of Phase C / C-7, read directly from
 * PostgREST under RLS with the anon key (DEC-APP-008).
 *
 * **Cart is live** — Supabase-backed as of Phase D / D-4. It is the only
 * direct-write repository, which DEC-APP-008 permits for the cart specifically.
 *
 * **Cart validation is live** — talks to the NestJS API, because a cart's
 * re-pricing must come from the trusted writer rather than from anything the
 * device computed.
 *
 * **Order creation is live** — Phase E-3A. `POST /api/v1/orders`, the one
 * write that is both financial and API-routed.
 *
 * **Addresses are live** — Phase E-3A. The Phase B API existed since Phase B;
 * wiring the customer app to it became necessary here because DEC-E-04
 * forbids an order snapshotting a mock address. `AddressScreen` and
 * `CheckoutScreen` are unchanged — `apiAddressRepository` maps the real rows
 * into the same shape the mock always returned.
 *
 * **Order detail is live** — Phase E-3B.1. A single order the caller owns,
 * with its item/option snapshots and status history, read directly from
 * Supabase under RLS (DEC-APP-008) — `orderDetail` is additive, alongside
 * `orders` rather than replacing it.
 *
 * Order history (the `orders` list) and notifications remain mock-backed:
 * they are later-phase work this task does not touch.
 */
export const repositories: Repositories = {
  catalog: supabaseCatalogRepository,
  cart: supabaseCartRepository,
  cartValidation: apiCartValidationRepository,
  orderCreation: apiOrderCreationRepository,
  orders: mockOrderRepository,
  orderDetail: supabaseOrderDetailRepository,
  notifications: mockNotificationRepository,
  addresses: apiAddressRepository,
};

/**
 * Fixture bindings, for tests and offline UI work.
 *
 * `cart` is constructed per-object rather than shared, so a suite that fills a
 * cart cannot leak lines into the next one. `addresses` stays the mock here
 * deliberately — screen tests render `CheckoutScreen`/`AddressScreen` without
 * a network, and their fixture shape is what mock/data.ts already provides.
 */
export const mockRepositories: Repositories = {
  catalog: mockCatalogRepository,
  cart: createMockCartRepository(),
  cartValidation: mockCartValidationRepository,
  orderCreation: mockOrderCreationRepository,
  orders: mockOrderRepository,
  orderDetail: mockOrderDetailRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};
