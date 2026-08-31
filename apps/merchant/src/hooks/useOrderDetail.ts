'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { repositories } from '../repositories';
import type { MerchantOrderSummary } from '../domain/order';
import type { MerchantOrderDetail } from '../domain/orderDetail';

/**
 * The Order Detail Panel's data layer (M-04) — design
 * `docs/design/BANHAO M-04 Merchant Order Detail Panel.dc.html` §07/§09
 * (M04-D07).
 *
 * Takes the **live board order**, not an id: `order` is expected to be
 * `useOrderBoard`'s own reconciled `MerchantOrderSummary` for whichever card
 * is selected (`OrderBoard`'s `selectedOrder`, found by id in its `orders`
 * array), the same object the card itself renders from. This hook opens no
 * channel and makes no direct Supabase call of its own — the board's single
 * `orders` subscription remains the only one, and this hook only reacts to
 * the object reference it is handed.
 *
 * ## Why watching the object reference is enough — no manual state diff
 *
 * `useOrderBoard` never mutates an order in place: an order is replaced in
 * its board `Map` only by an actual Realtime `INSERT`/`UPDATE` for that
 * order's id, so a specific order object keeps the same reference across
 * renders unless that exact order changed. A plain `useEffect(..., [order])`
 * therefore already has the two properties M04-D07 asks for, for free:
 *
 * - **Refetches when the open order's state changes** — a Realtime event for
 *   this order produces a new object, the effect re-fires.
 * - **Never refetches for an unrelated board event** — a different order's
 *   event never touches this one's `Map` entry, so this object's reference
 *   (and therefore the effect) is untouched.
 *
 * ## One fetch does the whole detail, every time
 *
 * There is only one query, `getOrderDetail` (`repositories/merchantOrders.ts`
 * → `data/orderQueries.ts`'s embedded select), reused for both the initial
 * open and every subsequent state-change refetch — not a second, narrower
 * "history only" query. `order_items`/`order_item_options` carry
 * `reject_mutation()` triggers, so re-fetching them alongside a fresh
 * `order_status_history` read is inert, never wrong; adding a second query
 * function purely to shave a few already-immutable columns off a background
 * refetch was judged not worth a second repository method for M-04.
 *
 * ## Switch vs. refresh — two different pictures, on purpose
 *
 * A genuine switch (a different `order.id`) clears `detail` and shows the
 * loading skeleton — the previous order's items must never linger on screen
 * while a different order loads (design §05's own skeleton note: "the
 * identity data is in memory before the fetch starts... only the fetched
 * regions have a loading state" is about a *fresh* open, not stale content
 * from a *different* order). A same-id refetch (the state-change case above)
 * leaves the already-displayed detail on screen — it is still correct, since
 * only `state` (read from the board row, never from this hook) can have
 * changed — and swaps in the refreshed detail once it resolves, with no
 * skeleton flash.
 */

export interface UseOrderDetail {
  detail: MerchantOrderDetail | null;
  loading: boolean;
  error: string | null;
  /** Re-issues the fetch for the currently-open order. No-op when nothing is open. */
  refetch: () => void;
}

export function useOrderDetail(order: MerchantOrderSummary | null): UseOrderDetail {
  const [detail, setDetail] = useState<MerchantOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Which order id `detail`/the in-flight fetch belongs to — set synchronously, never from inside a promise callback (avoids a race between two rapid state-change refetches). */
  const detailOrderIdRef = useRef<string | null>(null);
  /** Monotonic fetch token — only the latest issued token may write state. */
  const fetchTokenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Nothing in flight may write state after this point.
      fetchTokenRef.current += 1;
    };
  }, []);

  const runFetch = useCallback((target: MerchantOrderSummary) => {
    const token = (fetchTokenRef.current += 1);

    repositories.merchantOrders
      .getOrderDetail(target.id, target.restaurantId)
      .then((result) => {
        if (!mountedRef.current) return;
        if (token !== fetchTokenRef.current) return; // superseded by a newer fetch
        setDetail(result);
        setError(null);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!mountedRef.current) return;
        if (token !== fetchTokenRef.current) return;
        setError(cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาด');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!order) {
      // Closed (or nothing ever selected). Invalidate any in-flight fetch
      // immediately — not merely when the next one starts — so a response
      // for the order that was just closed cannot land after this point.
      fetchTokenRef.current += 1;
      detailOrderIdRef.current = null;
      setDetail(null);
      setLoading(false);
      setError(null);
      return;
    }

    const isSwitch = order.id !== detailOrderIdRef.current;
    detailOrderIdRef.current = order.id;

    if (isSwitch) {
      setDetail(null);
      setError(null);
      setLoading(true);
    }

    runFetch(order);
  }, [order, runFetch]);

  const refetch = useCallback(() => {
    if (!order) return;
    setError(null);
    // Only re-raise the skeleton if there is nothing already on screen —
    // the retry button appears exclusively in the error state, where detail
    // is already null, but this stays correct even if that ever changes.
    setLoading(detail === null);
    runFetch(order);
  }, [order, detail, runFetch]);

  return { detail, loading, error, refetch };
}
