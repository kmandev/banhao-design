/**
 * Repository interfaces — the seam between UI and data source.
 *
 *   Screen → Hook → Repository → (Mock | Supabase)
 *
 * Extracted from `index.ts` in Phase C / C-5 so an implementation can import
 * the contract without importing the bindings, which would be circular.
 *
 * Catalog types now come from `src/domain/catalog.ts` (C-1). The remaining
 * three still use the mock types: orders, notifications and addresses are not
 * Phase C work and keep their existing contracts untouched.
 */

import type { MenuItem, Shop } from '../domain/catalog';
import type { Category } from '../domain/categoryTaxonomy';
import type { OrderSummary, AppNotification, Address } from '../mocks/types';

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

export interface Repositories {
  catalog: CatalogRepository;
  orders: OrderRepository;
  notifications: NotificationRepository;
  addresses: AddressRepository;
}
