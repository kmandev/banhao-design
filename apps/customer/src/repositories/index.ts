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
import type {
  AddressRepository,
  NotificationRepository,
  OrderRepository,
  Repositories,
} from './types';

export * from './types';
export { mockCatalogRepository } from './mockCatalog';
export { supabaseCatalogRepository, createSupabaseCatalogRepository } from './supabaseCatalog';

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
 * The active repositories.
 *
 * **Catalog is live** — Supabase-backed as of Phase C / C-7, read directly from
 * PostgREST under RLS with the anon key (DEC-APP-008).
 *
 * Orders, notifications and addresses remain mock-backed: they belong to later
 * phases and Phase C deliberately does not touch them. (An addresses API now
 * exists from Phase B, but wiring the customer app to it is not Phase C work.)
 */
export const repositories: Repositories = {
  catalog: supabaseCatalogRepository,
  orders: mockOrderRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};

/** Fixture bindings, for tests and offline UI work. */
export const mockRepositories: Repositories = {
  catalog: mockCatalogRepository,
  orders: mockOrderRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};
