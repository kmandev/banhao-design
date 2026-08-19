/**
 * In-memory `CartRepository` — fixture binding, for tests and offline UI work.
 *
 * The production cart is Supabase-backed (`supabaseCart.ts`); this exists for
 * the same reason `mockCatalog.ts` does, so screen tests can render a cart
 * without a network. It is bound only into `mockRepositories`, never into the
 * live `repositories` object.
 *
 * It starts **empty**. The pre-Phase-D implementation seeded two hardcoded
 * lines so the cart and checkout screens were reachable; that seed is gone,
 * because a fixture that silently pretends the customer already shopped is
 * indistinguishable from a bug once the real cart is persisted. Tests that need
 * a populated cart call `addItem`.
 */

import { emptyCart, type Cart, type CartLine } from '../domain/cart';
import type { AddCartItemInput, CartRepository } from './types';

const CART_ID = 'mock-cart';
const PRICE_SATANG = 6000;

/** Builds an in-memory cart repository. Each call gets its own isolated state. */
export function createMockCartRepository(): CartRepository {
  let cart: Cart | null = null;
  let sequence = 0;

  return {
    getCart: async () => cart,

    async addItem(input: AddCartItemInput): Promise<Cart> {
      if (!cart) cart = emptyCart(CART_ID, input.shopId);

      sequence += 1;
      const line: CartLine = {
        id: `mock-line-${sequence}`,
        menuItemId: input.menuItemId,
        name: input.menuItemId,
        basePriceSatang: PRICE_SATANG,
        isAvailable: true,
        quantity: input.quantity,
        note: input.note,
        options: input.menuOptionIds.map((menuOptionId, index) => ({
          id: `mock-option-${sequence}-${index}`,
          menuOptionId,
          label: menuOptionId,
          priceDeltaSatang: 0,
        })),
      };

      cart = { ...cart, lines: [...cart.lines, line] };
      return cart;
    },

    async setQuantity(cartItemId: string, quantity: number): Promise<Cart | null> {
      if (!cart) return null;
      cart = {
        ...cart,
        lines: cart.lines.map((line) =>
          line.id === cartItemId ? { ...line, quantity } : line,
        ),
      };
      return cart;
    },

    async removeItem(cartItemId: string): Promise<Cart | null> {
      if (!cart) return null;
      cart = { ...cart, lines: cart.lines.filter((line) => line.id !== cartItemId) };
      return cart;
    },

    async clear(): Promise<void> {
      cart = null;
    },
  };
}

export const mockCartRepository: CartRepository = createMockCartRepository();
