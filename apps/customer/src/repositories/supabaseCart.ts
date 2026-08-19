/**
 * Supabase-backed `CartRepository` (Phase D / D-4).
 *
 * The cart lives in the database, not in React state. DEC-D-02: the persisted
 * cart is the source of truth, so it survives logout, reinstall and a change of
 * device — signing back in restores it because it was never client state to
 * begin with.
 *
 * Writes go client → Supabase directly under RLS (DEC-APP-008, cart exception).
 * Reads re-price every line from the live catalog on the way out, which is what
 * makes a stale cart visible rather than plausible.
 *
 * ## What this repository is *not*
 *
 * It is not a security boundary. Every operation is permitted or refused by the
 * deployed grants and the four `*_select_own` / `*_insert_own` policy families,
 * all of which key on `auth.uid()`. If this file were deleted the database
 * would be exactly as safe. The `MixedRestaurantError` below is a courtesy so
 * the customer sees the C-09 dialog instead of a constraint violation — the
 * composite foreign keys remain the enforcement, and nothing here should ever
 * be described as protecting them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as defaultClient } from '../lib/supabase';
import { emptyCart, type Cart } from '../domain/cart';
import { toCart } from '../data/cartMappers';
import type { MenuItemRow, MenuOptionRow } from '../data/catalogMappers';
import {
  deleteCart,
  deleteCartItem,
  fetchCart,
  fetchCartItemOptions,
  fetchCartItems,
  fetchMenuItemsByIds,
  fetchMenuOptionsByIds,
  insertCart,
  insertCartItem,
  insertCartItemOptions,
  updateCartItemQuantity,
} from '../data/cartQueries';
import type { AddCartItemInput, CartRepository } from './types';

/**
 * Raised when the customer adds an item from a different restaurant.
 *
 * DEC-017 / UX-SPEC § C-09: this is a dialog (`ตะกร้ามีอาหารจากร้านอื่นอยู่ ·
 * เริ่มตะกร้าใหม่?`), not an error state — the customer chooses between the old
 * cart and the new item. Thrown as a distinct class so a screen can branch on
 * `instanceof` rather than matching a message string.
 */
export class MixedRestaurantError extends Error {
  /** The restaurant the existing cart belongs to. */
  readonly currentShopId: string;
  /** The restaurant the customer just tried to add from. */
  readonly attemptedShopId: string;

  constructor(currentShopId: string, attemptedShopId: string) {
    super('MIXED_RESTAURANT');
    this.name = 'MixedRestaurantError';
    this.currentShopId = currentShopId;
    this.attemptedShopId = attemptedShopId;
  }
}

/**
 * Raised when a cart operation is attempted with no session.
 *
 * DEC-D-03: there is no guest cart. RLS would refuse these writes anyway —
 * `auth.uid()` is null and every cart policy fails — so this exists to fail
 * early with a comprehensible name rather than late with a `42501`.
 */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('NOT_AUTHENTICATED');
    this.name = 'NotAuthenticatedError';
  }
}

function indexById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Loads a cart's lines and prices them against the live catalog.
 *
 * Three batched reads, not one per line: items and options are fetched by id
 * set, the same N+1-avoiding shape the catalog repository uses.
 */
async function loadCartContents(
  client: SupabaseClient,
  cartRow: { id: string; restaurant_id: string },
): Promise<Cart> {
  const itemRows = await fetchCartItems(client, cartRow.id);

  if (itemRows.length === 0) {
    return emptyCart(cartRow.id, cartRow.restaurant_id);
  }

  const optionRows = await fetchCartItemOptions(
    client,
    itemRows.map((row) => row.id),
  );

  const [menuItems, menuOptions] = await Promise.all([
    fetchMenuItemsByIds(client, [...new Set(itemRows.map((row) => row.menu_item_id))]),
    fetchMenuOptionsByIds(client, [...new Set(optionRows.map((row) => row.menu_option_id))]),
  ]);

  return toCart(
    cartRow,
    itemRows,
    optionRows,
    indexById<MenuItemRow>(menuItems),
    indexById<MenuOptionRow>(menuOptions),
  );
}

/**
 * Builds a cart repository over a Supabase client.
 *
 * `resolveUserId` is injected rather than read from a module-level session so
 * the repository is testable without an auth stub, and so the caller decides
 * what "the current user" means.
 */
export function createSupabaseCartRepository(
  client: SupabaseClient = defaultClient,
  resolveUserId: () => Promise<string | null> = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  },
): CartRepository {
  async function requireUserId(): Promise<string> {
    const userId = await resolveUserId();
    if (!userId) throw new NotAuthenticatedError();
    return userId;
  }

  /** Reloads the whole cart. Every mutation returns this, so callers never guess. */
  async function reload(): Promise<Cart | null> {
    const userId = await requireUserId();
    const cartRow = await fetchCart(client, userId);
    if (!cartRow) return null;
    return loadCartContents(client, cartRow);
  }

  return {
    getCart: reload,

    async addItem(input: AddCartItemInput): Promise<Cart> {
      const userId = await requireUserId();

      let cartRow = await fetchCart(client, userId);

      if (cartRow && cartRow.restaurant_id !== input.shopId) {
        // DEC-017. The database would refuse the insert regardless; this turns
        // that refusal into a question the customer can answer.
        throw new MixedRestaurantError(cartRow.restaurant_id, input.shopId);
      }

      if (!cartRow) {
        cartRow = await insertCart(client, userId, input.shopId);
      }

      const itemRow = await insertCartItem(client, {
        cartId: cartRow.id,
        restaurantId: input.shopId,
        menuItemId: input.menuItemId,
        quantity: input.quantity,
        note: input.note,
      });

      await insertCartItemOptions(client, itemRow.id, input.menuOptionIds);

      return loadCartContents(client, cartRow);
    },

    async setQuantity(cartItemId: string, quantity: number): Promise<Cart | null> {
      await requireUserId();
      await updateCartItemQuantity(client, cartItemId, quantity);
      return reload();
    },

    async removeItem(cartItemId: string): Promise<Cart | null> {
      await requireUserId();
      await deleteCartItem(client, cartItemId);
      return reload();
    },

    async clear(): Promise<void> {
      const userId = await requireUserId();
      const cartRow = await fetchCart(client, userId);
      // Nothing to clear is a success, not a failure — `clear()` states an
      // intended end state rather than requiring a cart to destroy.
      if (!cartRow) return;
      await deleteCart(client, cartRow.id);
    },
  };
}

/** The bound repository used by the app. */
export const supabaseCartRepository = createSupabaseCartRepository();
