/**
 * Supabase cart queries (Phase D / D-4).
 *
 * **Direct client → Supabase writes, under RLS.** The cart is one of only two
 * places DEC-APP-008 permits a client to write a domain table directly — the
 * other being `rider_availability` — because a cart is not financial data and
 * the order snapshot, not the cart, is what becomes the contract.
 *
 * The anon key is the only credential involved. No service role, no NestJS API,
 * no proxy. Every statement below is already permitted (or already refused) by
 * grants and policies that were deployed with the schema:
 *
 *   carts              select · insert (user_id, restaurant_id) · update (restaurant_id) · delete
 *   cart_items         select · insert (cart_id, restaurant_id, menu_item_id, quantity, note) · update (quantity, note) · delete
 *   cart_item_options  select · insert (cart_item_id, menu_option_id) · delete
 *
 * Those column lists are why nothing here writes a price: the grant does not
 * include one, because `cart_items` has no price column at all.
 *
 * Reads are not filtered by `user_id` beyond the initial cart lookup. That is
 * deliberate — the four `*_select_own` policies scope every one of these tables
 * to `auth.uid()`, and re-stating the predicate in the client would duplicate a
 * security boundary in a place that cannot enforce it, exactly as the catalog
 * queries avoid re-filtering `status`.
 *
 * Errors always throw. A failed read must never surface as an empty cart:
 * "your cart is empty" and "your cart could not be loaded" are different facts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MenuItemRow, MenuOptionRow } from './catalogMappers';
import type { CartItemOptionRow, CartItemRow, CartRow } from './cartMappers';

const CART_COLUMNS = 'id, restaurant_id';
const CART_ITEM_COLUMNS = 'id, cart_id, restaurant_id, menu_item_id, quantity, note';
const CART_ITEM_OPTION_COLUMNS = 'id, cart_item_id, menu_option_id';

/** Mirrors `catalogQueries.ITEM_COLUMNS` — the cart needs the same item shape. */
const ITEM_COLUMNS =
  'id, restaurant_id, category_id, name, description, base_price_satang, image_url, is_available, sort_order';
const OPTION_COLUMNS = 'id, group_id, label, price_delta_satang, is_available, sort_order';

/** Turns a PostgREST error into a thrown Error, never an empty success. */
function raise(operation: string, message: string): never {
  throw new Error(`Cart ${operation} failed: ${message}`);
}

/**
 * The caller's open cart, or null when they have none.
 *
 * `carts_user_id_key` is UNIQUE on `user_id`, so this can never match more than
 * one row — `maybeSingle` is a statement about the schema, not optimism.
 */
export async function fetchCart(
  client: SupabaseClient,
  userId: string,
): Promise<CartRow | null> {
  const { data, error } = await client
    .from('carts')
    .select(CART_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle<CartRow>();

  if (error) raise('lookup', error.message);
  return data ?? null;
}

export async function fetchCartItems(
  client: SupabaseClient,
  cartId: string,
): Promise<CartItemRow[]> {
  const { data, error } = await client
    .from('cart_items')
    .select(CART_ITEM_COLUMNS)
    .eq('cart_id', cartId)
    // `cart_items` has no sort column; created_at is the only stable ordering
    // the schema offers, and it matches the order the customer added them in.
    .order('created_at', { ascending: true })
    .returns<CartItemRow[]>();

  if (error) raise('item list', error.message);
  return data ?? [];
}

export async function fetchCartItemOptions(
  client: SupabaseClient,
  cartItemIds: string[],
): Promise<CartItemOptionRow[]> {
  if (cartItemIds.length === 0) return [];

  const { data, error } = await client
    .from('cart_item_options')
    .select(CART_ITEM_OPTION_COLUMNS)
    .in('cart_item_id', cartItemIds)
    .order('created_at', { ascending: true })
    .returns<CartItemOptionRow[]>();

  if (error) raise('option list', error.message);
  return data ?? [];
}

/**
 * Live catalog rows for the cart's items, in one batch.
 *
 * Rows hidden by RLS (archived item, restaurant no longer `ACTIVE`) simply do
 * not come back, which is what produces `Cart.unresolvedLineIds`.
 */
export async function fetchMenuItemsByIds(
  client: SupabaseClient,
  menuItemIds: string[],
): Promise<MenuItemRow[]> {
  if (menuItemIds.length === 0) return [];

  const { data, error } = await client
    .from('menu_items')
    .select(ITEM_COLUMNS)
    .in('id', menuItemIds)
    .returns<MenuItemRow[]>();

  if (error) raise('menu item lookup', error.message);
  return data ?? [];
}

export async function fetchMenuOptionsByIds(
  client: SupabaseClient,
  menuOptionIds: string[],
): Promise<MenuOptionRow[]> {
  if (menuOptionIds.length === 0) return [];

  const { data, error } = await client
    .from('menu_options')
    .select(OPTION_COLUMNS)
    .in('id', menuOptionIds)
    .returns<MenuOptionRow[]>();

  if (error) raise('menu option lookup', error.message);
  return data ?? [];
}

/**
 * Opens the caller's cart for a restaurant.
 *
 * `user_id` is written explicitly because `carts_insert_own` checks
 * `user_id = auth.uid()` — the policy verifies the value, it does not supply
 * one, so omitting it fails the WITH CHECK rather than defaulting.
 */
export async function insertCart(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<CartRow> {
  const { data, error } = await client
    .from('carts')
    .insert({ user_id: userId, restaurant_id: restaurantId })
    .select(CART_COLUMNS)
    .single<CartRow>();

  if (error) raise('create', error.message);
  if (!data) raise('create', 'no row returned');
  return data;
}

/**
 * Adds one configured line.
 *
 * `restaurant_id` is written on the line itself. It looks redundant next to
 * `cart_id`, and is not: it is the column both composite foreign keys pin
 * together, so writing it is what submits the row to the DEC-017 check. A
 * cross-restaurant line is refused by the database here — not by this function.
 */
export async function insertCartItem(
  client: SupabaseClient,
  input: {
    cartId: string;
    restaurantId: string;
    menuItemId: string;
    quantity: number;
    note: string;
  },
): Promise<CartItemRow> {
  const { data, error } = await client
    .from('cart_items')
    .insert({
      cart_id: input.cartId,
      restaurant_id: input.restaurantId,
      menu_item_id: input.menuItemId,
      quantity: input.quantity,
      // Store absence as NULL rather than an empty string, so the column has
      // one representation of "no note" and the domain has the other.
      note: input.note.trim() === '' ? null : input.note.trim(),
    })
    .select(CART_ITEM_COLUMNS)
    .single<CartItemRow>();

  if (error) raise('add item', error.message);
  if (!data) raise('add item', 'no row returned');
  return data;
}

export async function insertCartItemOptions(
  client: SupabaseClient,
  cartItemId: string,
  menuOptionIds: string[],
): Promise<void> {
  if (menuOptionIds.length === 0) return;

  const { error } = await client.from('cart_item_options').insert(
    menuOptionIds.map((menuOptionId) => ({
      cart_item_id: cartItemId,
      menu_option_id: menuOptionId,
    })),
  );

  if (error) raise('add item options', error.message);
}

/**
 * Sets a line's quantity.
 *
 * `quantity > 0` is a CHECK constraint, so zero is rejected by the database
 * rather than quietly deleting the line. Removal is an explicit action.
 */
export async function updateCartItemQuantity(
  client: SupabaseClient,
  cartItemId: string,
  quantity: number,
): Promise<void> {
  const { error } = await client
    .from('cart_items')
    .update({ quantity })
    .eq('id', cartItemId);

  if (error) raise('update quantity', error.message);
}

/** Removes one line. `cart_item_options` cascade with it. */
export async function deleteCartItem(
  client: SupabaseClient,
  cartItemId: string,
): Promise<void> {
  const { error } = await client.from('cart_items').delete().eq('id', cartItemId);
  if (error) raise('remove item', error.message);
}

/**
 * Deletes the cart itself.
 *
 * Items and their options cascade, so this is one statement rather than three.
 * Carts are hard-deletable by design — they carry no financial or state
 * meaning, which is precisely why the client is allowed to delete one at all.
 */
export async function deleteCart(client: SupabaseClient, cartId: string): Promise<void> {
  const { error } = await client.from('carts').delete().eq('id', cartId);
  if (error) raise('clear', error.message);
}
