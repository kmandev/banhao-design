/**
 * Repository bindings — the swap point between UI and data source.
 *
 *   Screen → Hook → Repository → (Mock | Supabase)
 *
 * Screens depend only on the interfaces in `./types`, which is what made the
 * Phase C catalog swap a one-line change here rather than a rewrite of four
 * screens.
 */

import type { AppNotification } from '../mocks/types';
import { notifications as mockNotifications } from '../mocks/data';
import { supabaseCatalogRepository } from './supabaseCatalog';
import { mockCatalogRepository } from './mockCatalog';
import { supabaseCartRepository } from './supabaseCart';
import { createMockCartRepository } from './mockCart';
import { apiCartValidationRepository } from './apiCartValidation';
import { apiOrderCreationRepository } from './apiOrderCreation';
import { apiAddressRepository } from './apiAddresses';
import { mockAddressRepository } from './mockAddresses';
import { supabaseOrderDetailRepository } from './supabaseOrderDetail';
import { supabaseOrderHistoryRepository } from './supabaseOrderHistory';
import { apiDeliveryProofRepository } from './apiDeliveryProof';
import { apiNotificationRepository } from './apiNotifications';
import type {
  CartValidationRepository,
  DeliveryProofRepository,
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
export { apiNotificationRepository, createApiNotificationRepository } from './apiNotifications';
export { mockAddressRepository, createMockAddressRepository } from './mockAddresses';
export {
  supabaseOrderDetailRepository,
  createSupabaseOrderDetailRepository,
} from './supabaseOrderDetail';
export {
  supabaseOrderHistoryRepository,
  createSupabaseOrderHistoryRepository,
} from './supabaseOrderHistory';
export {
  apiDeliveryProofRepository,
  createApiDeliveryProofRepository,
} from './apiDeliveryProof';

/**
 * Simulated latency, so loading states are actually exercised in development
 * rather than only existing in code. Screens must handle loading regardless.
 */
const LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/**
 * Fixture order history.
 *
 * Empty, not fabricated. The old `mocks/data.ts` `orders` fixture carried the
 * superseded 12-state vocabulary and non-UUID ids (`BH000125`) — feeding those
 * into a screen that now navigates by real order id would produce rows whose
 * only possible outcome is a failed detail read. A suite that wants history
 * rows binds its own stub, exactly as the cart and order-creation suites do.
 */
export const mockOrderRepository: OrderRepository = {
  listOrders: () => delay([]),
};

export const mockNotificationRepository: NotificationRepository = {
  listNotifications: (): Promise<AppNotification[]> => delay(mockNotifications),
  markNotificationRead: (): Promise<void> => delay(undefined),
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

/** Fixture delivery-proof — no photo, for screen tests that are not about POD. */
export const mockDeliveryProofRepository: DeliveryProofRepository = {
  getDeliveryProof: () => delay(null),
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
 * Supabase under RLS (DEC-APP-008).
 *
 * **Order history is live** — Phase E-3B.3. `orders_select_customer` returns
 * the caller's own orders and nothing else, which is what finally makes C-16 →
 * C-19 real: the history card now carries a genuine order UUID rather than a
 * fixture string.
 *
 * **Delivery proof is live** — Phase G7.4. `GET /api/v1/orders/:id/delivery-proof`
 * mints a short-lived signed R2 URL server-side, so — unlike order detail —
 * this goes through the API rather than a direct Supabase read.
 *
 * **Notifications are live** — Phase H-5A. `GET /api/v1/me/notifications` /
 * `PATCH /api/v1/me/notifications/:id` are customer-scoped the same way
 * addresses are (ownership is a query filter server-side, backed by the
 * unchanged `notifications_select_own`/`notifications_update_own` RLS
 * policies) — `apiNotificationRepository` maps the real rows into the same
 * `AppNotification` shape the mock always returned.
 */
export const repositories: Repositories = {
  catalog: supabaseCatalogRepository,
  cart: supabaseCartRepository,
  cartValidation: apiCartValidationRepository,
  orderCreation: apiOrderCreationRepository,
  orders: supabaseOrderHistoryRepository,
  orderDetail: supabaseOrderDetailRepository,
  deliveryProof: apiDeliveryProofRepository,
  notifications: apiNotificationRepository,
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
  deliveryProof: mockDeliveryProofRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};
