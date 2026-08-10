/**
 * Repository layer — the seam between UI and data source.
 *
 *   Screen → Hook → Repository → (Mock | API)
 *
 * Screens depend only on these interfaces, so replacing the mock with a real
 * API means writing a new implementation and changing `repositories` below.
 * No screen imports from src/mocks/ directly. See brief §12–13.
 */

import type { Category, Shop, MenuItem, OrderSummary, AppNotification, Address } from '../mocks/types';
import {
  categories as mockCategories,
  shops as mockShops,
  menuByShop,
  orders as mockOrders,
  notifications as mockNotifications,
  addresses as mockAddresses,
} from '../mocks/data';

export interface CatalogRepository {
  listCategories(): Promise<Category[]>;
  listShops(): Promise<Shop[]>;
  getShop(shopId: string): Promise<Shop | null>;
  listMenu(shopId: string): Promise<MenuItem[]>;
  getMenuItem(shopId: string, itemId: string): Promise<MenuItem | null>;
  search(query: string): Promise<{ shops: Shop[]; items: MenuItem[] }>;
}

export interface OrderRepository {
  listOrders(): Promise<OrderSummary[]>;
  getOrder(orderId: string): Promise<OrderSummary | null>;
}

export interface NotificationRepository {
  listNotifications(): Promise<AppNotification[]>;
}

export interface AddressRepository {
  listAddresses(): Promise<Address[]>;
}

/**
 * Simulated latency, so loading states are actually exercised in development
 * rather than only existing in code. Screens must handle loading regardless.
 */
const LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const allMenuItems = Object.values(menuByShop).flat();

export const mockCatalogRepository: CatalogRepository = {
  listCategories: () => delay(mockCategories),
  listShops: () => delay(mockShops),
  getShop: (shopId) => delay(mockShops.find((s) => s.id === shopId) ?? null),
  listMenu: (shopId) => delay(menuByShop[shopId] ?? []),
  getMenuItem: (shopId, itemId) =>
    delay((menuByShop[shopId] ?? []).find((m) => m.id === itemId) ?? null),
  search: (query) => {
    const q = query.trim().toLowerCase();
    if (!q) return delay({ shops: [], items: [] });

    // Shops first, then menu items — see DQ-05 in the implementation map; the
    // design does not specify ranking.
    return delay({
      shops: mockShops.filter((s) => s.name.toLowerCase().includes(q)),
      items: allMenuItems.filter((m) => m.name.toLowerCase().includes(q)),
    });
  },
};

export const mockOrderRepository: OrderRepository = {
  listOrders: () => delay(mockOrders),
  getOrder: (orderId) => delay(mockOrders.find((o) => o.id === orderId) ?? null),
};

export const mockNotificationRepository: NotificationRepository = {
  listNotifications: () => delay(mockNotifications),
};

export const mockAddressRepository: AddressRepository = {
  listAddresses: () => delay(mockAddresses),
};

/**
 * The active repositories.
 *
 * Everything except authentication and `profiles` is mock-backed, because the
 * domain schema does not exist yet (brief §23 — no database expansion in this
 * step). Swap these bindings when the real endpoints land.
 */
export const repositories = {
  catalog: mockCatalogRepository,
  orders: mockOrderRepository,
  notifications: mockNotificationRepository,
  addresses: mockAddressRepository,
};

export type Repositories = typeof repositories;
