import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Satang } from '@banhao/types';
import type { Cart } from '../domain/cart';
import { cartItemCount, cartSubtotalSatang } from '../domain/cart';
import { repositories } from '../repositories';
import type { AddCartItemInput } from '../repositories';
import { useAuth } from './useAuth';

/**
 * Cart state, backed by the persisted Supabase cart (Phase D / D-5).
 *
 * ## The cart is not React state
 *
 * DEC-D-02: the row in `carts` **is** the cart. This hook holds a cached copy
 * of it for rendering, and every mutation returns the reloaded server cart
 * rather than a locally-patched one, so the two cannot drift. The practical
 * consequence is the point of the decision: the cart survives logout,
 * reinstall, and moving to another device, because it was never living in the
 * app to begin with.
 *
 * ## No guest cart
 *
 * DEC-D-03: an unauthenticated customer cannot add to a cart, and no local
 * stand-in is created for them. This is not merely a product rule — every cart
 * policy keys on `auth.uid()`, so there is no anonymous cart for the client to
 * write even if it wanted one. Signing out clears the cached copy; it does not
 * delete the cart, which is waiting on the next sign-in.
 *
 * ## No invented money — DEC-D-01
 *
 * The only total exposed here is `subtotalSatang`, computed from live catalog
 * prices in integer satang. Delivery fee, service fee and discount are **not**
 * here, because their numbers are still OPEN (BQ-026, BQ-027, BQ-030) and
 * UX-SPEC § C-09 requires an unknowable fee to render as `คำนวณเมื่อยืนยัน`
 * rather than a number the app made up. The grand total arrives with the server
 * at `POST /cart/validate` (D-6) and freezes at the order snapshot (Phase E).
 */

interface CartState {
  /** Null when there is no session, or the customer has no open cart. */
  cart: Cart | null;
  /** True while the first load for the current session is in flight. */
  loading: boolean;
  /** Last failure, as a message. Cleared by a successful operation. */
  error: string | null;
  /** DEC-D-03 — false when signed out; adding is impossible, not merely hidden. */
  canModify: boolean;
  itemCount: number;
  /** Food subtotal only. Never a grand total (DEC-D-01). */
  subtotalSatang: Satang;
  addItem: (input: AddCartItemInput) => Promise<void>;
  increase: (cartItemId: string) => Promise<void>;
  decrease: (cartItemId: string) => Promise<void>;
  remove: (cartItemId: string) => Promise<void>;
  clear: () => Promise<void>;
  refresh: () => Promise<void>;
}

const CartContext = createContext<CartState | undefined>(undefined);

export function CartProvider({
  children,
  /**
   * Test-only: start from this cart and skip the initial load.
   *
   * Production never passes it, so the default path is always "read the cart
   * from the database". Without the skip a seed would be pointless — the load
   * effect would immediately overwrite it with whatever the session implies.
   */
  seed = null,
}: {
  children: React.ReactNode;
  seed?: Cart | null;
}) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [cart, setCart] = useState<Cart | null>(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against a stale load landing after the session changed.
   *
   * Without this, signing out during an in-flight load would repopulate the
   * cart of the user who just left.
   */
  const requestRef = useRef(0);

  /** Consumed once, so a seeded provider still reloads after a mutation. */
  const skipInitialLoad = useRef(seed !== null);

  const load = useCallback(async () => {
    const request = (requestRef.current += 1);

    if (!userId) {
      // Not an error state — a signed-out customer simply has no cart in view.
      setCart(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const next = await repositories.cart.getCart();
      if (requestRef.current !== request) return;
      setCart(next);
      setError(null);
    } catch (cause) {
      if (requestRef.current !== request) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [userId]);

  // Reloads on sign-in and clears on sign-out — this is where DEC-D-02's
  // "restored after authentication" actually happens.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void load();
  }, [load]);

  /**
   * Runs a mutation and adopts the server's cart as the new state.
   *
   * Errors are re-thrown as well as recorded: a caller such as the item screen
   * needs to branch on `MixedRestaurantError` (the C-09 dialog), which it
   * cannot do if the failure is swallowed into a message.
   */
  const mutate = useCallback(async (operation: () => Promise<Cart | null>) => {
    try {
      const next = await operation();
      setCart(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  }, []);

  const addItem = useCallback(
    async (input: AddCartItemInput) => {
      // The repository refuses this too, and RLS refuses it after that. Checking
      // here just avoids a pointless round trip for a signed-out tap.
      if (!userId) throw new Error('NOT_AUTHENTICATED');
      await mutate(() => repositories.cart.addItem(input));
    },
    [userId, mutate],
  );

  const increase = useCallback(
    async (cartItemId: string) => {
      const line = cart?.lines.find((candidate) => candidate.id === cartItemId);
      if (!line) return;
      await mutate(() => repositories.cart.setQuantity(cartItemId, line.quantity + 1));
    },
    [cart, mutate],
  );

  const decrease = useCallback(
    async (cartItemId: string) => {
      const line = cart?.lines.find((candidate) => candidate.id === cartItemId);
      if (!line) return;
      // Floor at 1; removing is an explicit action, matching the design. The
      // database agrees — `quantity > 0` is a CHECK constraint, so a decrement
      // to zero would be rejected rather than deleting the line by accident.
      if (line.quantity <= 1) return;
      await mutate(() => repositories.cart.setQuantity(cartItemId, line.quantity - 1));
    },
    [cart, mutate],
  );

  const remove = useCallback(
    async (cartItemId: string) => {
      await mutate(() => repositories.cart.removeItem(cartItemId));
    },
    [mutate],
  );

  const clear = useCallback(async () => {
    await mutate(async () => {
      await repositories.cart.clear();
      return null;
    });
  }, [mutate]);

  const value = useMemo<CartState>(
    () => ({
      cart,
      loading,
      error,
      canModify: userId !== null,
      itemCount: cart ? cartItemCount(cart) : 0,
      subtotalSatang: cart ? cartSubtotalSatang(cart) : 0,
      addItem,
      increase,
      decrease,
      remove,
      clear,
      refresh: load,
    }),
    [cart, loading, error, userId, addItem, increase, decrease, remove, clear, load],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}

/** Re-exported so screens import line arithmetic from one place. */
export { lineTotalSatang, optionLabels } from '../domain/cart';
