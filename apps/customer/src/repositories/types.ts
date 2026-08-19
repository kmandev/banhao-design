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
import type { Cart } from '../domain/cart';
import type { CartValidation, ExpectedLine } from '../domain/cartValidation';
import type { Category } from '../domain/categoryTaxonomy';
import type { OrderDetail, OrderHistoryEntry } from '../domain/order';
import type { AppNotification, Address } from '../mocks/types';

export interface CatalogRepository {
  listCategories(): Promise<Category[]>;
  listShops(): Promise<Shop[]>;
  getShop(shopId: string): Promise<Shop | null>;
  listMenu(shopId: string): Promise<MenuItem[]>;
  getMenuItem(shopId: string, itemId: string): Promise<MenuItem | null>;
  search(query: string): Promise<{ shops: Shop[]; items: MenuItem[] }>;
}

/** One configured line, as the item screen produces it. */
export interface AddCartItemInput {
  shopId: string;
  menuItemId: string;
  quantity: number;
  /** Empty string means no note; the query layer stores that as NULL. */
  note: string;
  /**
   * The chosen `menu_options.id` values — identities, not labels.
   *
   * Labels and price deltas are deliberately absent: they are read live from
   * the catalog when the cart loads, so a cart never carries a stale price it
   * captured at add time. `cart_item_options` has no price column for the same
   * reason.
   */
  menuOptionIds: string[];
}

/**
 * Cart persistence (Phase D).
 *
 * The only repository whose operations **write**. Every other client write in
 * the app goes through the API; the cart is one of the two documented
 * exceptions in DEC-APP-008, because a cart is not financial data.
 *
 * Mutations return the reloaded cart rather than void so a caller never has to
 * reconstruct server state locally — the database stays the source of truth
 * (DEC-D-02) even for the shape of the screen immediately after a tap.
 * `null` means the customer has no open cart at all.
 */
export interface CartRepository {
  getCart(): Promise<Cart | null>;
  addItem(input: AddCartItemInput): Promise<Cart>;
  setQuantity(cartItemId: string, quantity: number): Promise<Cart | null>;
  removeItem(cartItemId: string): Promise<Cart | null>;
  clear(): Promise<void>;
}

/**
 * Server-authoritative cart revalidation (`POST /api/v1/cart/validate`).
 *
 * Separate from `CartRepository` because the two speak to different systems:
 * cart CRUD writes to Supabase directly (DEC-APP-008's documented exception),
 * while validation must come from the trusted writer. Resolves with the
 * re-priced cart, or rejects — with `CartConflictError` for the two conflicts
 * the customer can act on, and with the underlying failure for everything else.
 */
export interface CartValidationRepository {
  validate(expectedLines: ExpectedLine[]): Promise<CartValidation>;
}

/**
 * The customer's own order history (C-16, Phase E-3B.3).
 *
 * Real Supabase data as of E-3B.3 — previously mock-backed. `getOrder` is
 * gone: a single order belongs to `OrderDetailRepository` (C-19), and keeping
 * a second detail method here would be the duplicate order model this seam
 * exists to prevent.
 *
 * No `customerId` parameter, deliberately and permanently. Ownership is
 * `orders_select_customer` (`customer_id = auth.uid()`) against the verified
 * session — an id the UI could pass would be an authorization decision made on
 * a device.
 */
export interface OrderRepository {
  listOrders(): Promise<OrderHistoryEntry[]>;
}

/**
 * `POST /api/v1/orders` (Phase E-3A).
 *
 * `paymentMethod` is deliberately absent from this input — the API's own
 * contract (`packages/validation/src/order.ts`) accepts only `'ONLINE'`
 * (DEC-016), so the repository sends that literal itself rather than taking
 * it as a parameter this screen could vary. There is no `customerId` or
 * `restaurantId` field for the same reason `CartValidationRepository` has
 * none: identity comes from the verified session on every request, and the
 * restaurant is derived server-side from the caller's own cart.
 */
export interface CreateOrderInput {
  /** Must belong to the caller — checked server-side (DEC-E-04). */
  addressId: string;
  /**
   * What the customer was actually shown for each line, so the server can
   * detect drift (V1.1 §6 lists `PRICE_CHANGED` as a `POST /orders` failure
   * case). Same shape and same values as `CartValidationRepository.validate`
   * receives — read live from the cart when it last rendered, never
   * re-derived at submit time.
   */
  expectedLines: ExpectedLine[];
}

/** What `POST /api/v1/orders` returns on success. */
export interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  state: string;
}

/**
 * Creates an order from the caller's own persisted cart (Phase E-3A).
 *
 * The only repository whose single operation both writes and is financial —
 * unlike `CartRepository` (DEC-APP-008's documented direct-write exception),
 * this goes through the NestJS API, because an order is exactly the kind of
 * write DEC-APP-008 reserves for the trusted writer.
 */
export interface OrderCreationRepository {
  create(input: CreateOrderInput): Promise<CreatedOrder>;
}

/**
 * Real order detail — a single order the caller owns, with its line items,
 * option snapshots and status history (Phase E-3B.1).
 *
 * A read, not a write, so it goes client → Supabase directly under RLS
 * (DEC-APP-008) rather than through the API — `orders_select_customer` and
 * its three sibling policies exist precisely for this. Deliberately its own
 * interface rather than an addition to `OrderRepository`: that one's
 * `OrderSummary` type carries the superseded 12-state mock vocabulary
 * (`src/mocks/types.ts`), and `OrdersScreen`/`OrderTrackingScreen` still
 * depend on it unchanged — this is the same "old and new contract coexist"
 * shape `CatalogRepository` went through in Phase C.
 *
 * `null` means the order does not exist or is not the caller's own — RLS
 * makes the two indistinguishable, which is the safe behaviour to expose.
 */
export interface OrderDetailRepository {
  getOrder(orderId: string): Promise<OrderDetail | null>;
}

export interface NotificationRepository {
  listNotifications(): Promise<AppNotification[]>;
}

export interface AddressRepository {
  listAddresses(): Promise<Address[]>;
}

export interface Repositories {
  catalog: CatalogRepository;
  cart: CartRepository;
  cartValidation: CartValidationRepository;
  orderCreation: OrderCreationRepository;
  orders: OrderRepository;
  orderDetail: OrderDetailRepository;
  notifications: NotificationRepository;
  addresses: AddressRepository;
}
