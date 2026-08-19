/**
 * Cart row shapes and their mapping to the domain (Phase D / D-4).
 *
 * Same split as `catalogMappers.ts`: the `*Row` interfaces describe exactly
 * what PostgREST returns (snake_case, database types) and the mappers are the
 * one place that shape becomes the domain's. Keeping them apart is what lets
 * the repository be tested without a database and the domain stay free of
 * Supabase types.
 */

import type { Cart, CartLine, CartOptionSelection } from '../domain/cart';
import type { MenuItemRow, MenuOptionRow } from './catalogMappers';

export interface CartRow {
  id: string;
  restaurant_id: string;
}

export interface CartItemRow {
  id: string;
  cart_id: string;
  restaurant_id: string;
  menu_item_id: string;
  quantity: number;
  note: string | null;
}

export interface CartItemOptionRow {
  id: string;
  cart_item_id: string;
  menu_option_id: string;
}

/**
 * One selected option, priced from the live catalog.
 *
 * Returns `null` when the option is not in `options` — RLS hides options
 * belonging to an archived item, so a stored selection can genuinely have no
 * readable catalog row. A missing option contributes nothing to the line total
 * rather than a guessed delta, which is the same rule `ItemOptionsScreen`
 * already applies to an unavailable option.
 */
export function toCartOptionSelection(
  row: CartItemOptionRow,
  options: Map<string, MenuOptionRow>,
): CartOptionSelection | null {
  const option = options.get(row.menu_option_id);
  if (!option) return null;

  return {
    id: row.id,
    menuOptionId: row.menu_option_id,
    label: option.label,
    priceDeltaSatang: option.price_delta_satang,
  };
}

/**
 * One cart line, priced from the live catalog.
 *
 * Returns `null` when the menu item cannot be read — the caller records the id
 * in `Cart.unresolvedLineIds` rather than discarding it (see `domain/cart.ts`).
 */
export function toCartLine(
  row: CartItemRow,
  items: Map<string, MenuItemRow>,
  optionRows: CartItemOptionRow[],
  options: Map<string, MenuOptionRow>,
): CartLine | null {
  const item = items.get(row.menu_item_id);
  if (!item) return null;

  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: item.name,
    basePriceSatang: item.base_price_satang,
    isAvailable: item.is_available,
    quantity: row.quantity,
    // The column is nullable; the domain is not. One representation of "no
    // note" beats two.
    note: row.note ?? '',
    options: optionRows
      .map((optionRow) => toCartOptionSelection(optionRow, options))
      .filter((selection): selection is CartOptionSelection => selection !== null),
  };
}

/** Groups option rows by the cart line they belong to, in one pass. */
export function groupOptionsByItem(
  rows: CartItemOptionRow[],
): Map<string, CartItemOptionRow[]> {
  const byItem = new Map<string, CartItemOptionRow[]>();

  for (const row of rows) {
    const existing = byItem.get(row.cart_item_id);
    if (existing) existing.push(row);
    else byItem.set(row.cart_item_id, [row]);
  }

  return byItem;
}

/** Assembles the whole cart, separating resolvable lines from unresolvable ones. */
export function toCart(
  cartRow: CartRow,
  itemRows: CartItemRow[],
  optionRows: CartItemOptionRow[],
  items: Map<string, MenuItemRow>,
  options: Map<string, MenuOptionRow>,
): Cart {
  const optionsByItem = groupOptionsByItem(optionRows);
  const lines: CartLine[] = [];
  const unresolvedLineIds: string[] = [];

  for (const row of itemRows) {
    const line = toCartLine(row, items, optionsByItem.get(row.id) ?? [], options);
    if (line) lines.push(line);
    else unresolvedLineIds.push(row.id);
  }

  return { id: cartRow.id, shopId: cartRow.restaurant_id, lines, unresolvedLineIds };
}
