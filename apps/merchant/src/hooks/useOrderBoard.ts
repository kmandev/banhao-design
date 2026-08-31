'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { repositories } from '../repositories';
import type { MerchantOrderSummary } from '../domain/order';
import {
  useOrderRealtime,
  type MerchantOrderRealtimeEvent,
  type MerchantOrderRealtimeStatus,
} from './useOrderRealtime';

/**
 * The Order Board's state and reconciliation layer (M-2.5) — the single
 * place where M-2.3's authoritative repository snapshot and M-2.4's
 * normalized Realtime events are merged into one coherent board.
 *
 *   auth → restaurant scope → useOrderBoard → (M-2.6 OrderBoard UI)
 *
 * **This is not the UI task.** It produces a reconciled
 * `MerchantOrderSummary[]` and the raw Realtime status; it does not derive
 * board columns, filter lifecycle states, or translate status into UX copy
 * ("การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่" is M-2.6's). It also never
 * queries Supabase itself: the repository is the only data-access seam and
 * `useOrderRealtime` is the only subscription — there is no `.channel()` or
 * `postgres_changes` in this file, by design.
 *
 * `restaurantId` must be an already-membership-verified value
 * (`useRestaurantScope`'s `currentRestaurantId`) — this hook does not read
 * `localStorage`, does not resolve membership, and adds no authorization of
 * its own. `orders_select_merchant` RLS remains the security boundary; the
 * restaurant checks below are *client-state correctness*, keeping one
 * restaurant's rows out of another's board, not a second access check.
 *
 * ## Pattern C — subscribe → fetch → reconcile (M2-RT-001)
 *
 * The lifecycle is strictly ordered, and the ordering is the correctness
 * argument:
 *
 * ```text
 * scope set → barrier armed (buffering)
 *   → channel subscribes
 *   → status settles                     ← fetch is gated on this, see below
 *   → repository snapshot requested
 *   → events arriving meanwhile are BUFFERED, never dropped, never applied
 *   → snapshot establishes the board
 *   → buffer replayed in arrival (commit) order
 *   → barrier lifted; later events apply live
 * ```
 *
 * The initial fetch does **not** start when the channel is merely created;
 * it starts when `useOrderRealtime` reports a *settled* status. That gate is
 * what makes the no-timestamp reconciliation sound (see "Freshness" below):
 * it guarantees the subscription was already live when the snapshot was
 * read, so no commit can fall into a gap between "too late for the snapshot"
 * and "too early for the subscription".
 *
 * A settled status is any status that is not `'IDLE'`/`'CONNECTING'` — i.e.
 * `SUBSCRIBED` (the healthy path, full guarantee) **or** a terminal
 * `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` (the degraded path). The degraded
 * path exists so a Realtime outage cannot leave the merchant staring at a
 * board that never loads: the snapshot is fetched anyway, `realtimeStatus`
 * tells the UI it is not live, and the later transition *into* `SUBSCRIBED`
 * triggers one refetch that repairs whatever was missed. There is no timer
 * of our own behind this — `channel.subscribe()`'s own timeout is what turns
 * a channel that never connects into `TIMED_OUT`, and that is the callback
 * this hook waits on.
 *
 * ## Freshness: `updated_at` was available in the database, and is
 * deliberately not used
 *
 * `public.orders` does carry `updated_at`, maintained by the
 * `orders_set_updated_at` trigger (`20260811000005_order_domain.sql`). It is
 * nonetheless **not** in M-2.2's `MerchantOrderSummary`, not in M-2.3's
 * `ORDER_BOARD_COLUMNS` projection, and therefore not in M-2.4's normalized
 * event. This hook does not add it, and does not invent a substitute: no
 * client clock, no arrival counter dressed up as a timestamp, no lifecycle
 * "rank" comparator (which would be wrong for `CANCELLED` /
 * `MERCHANT_REJECTED`, terminal states that are not later in the linear
 * DEC-019 sequence).
 *
 * Instead the barrier itself supplies the ordering, and the guarantee is:
 *
 * > Replaying the buffered events, in commit order, on top of the snapshot
 * > yields the state as of the newest of {snapshot, last buffered event}.
 *
 * Both directions hold without comparing anything:
 *
 * - Snapshot older than a buffered event → replay carries the board forward
 *   to the newer value. (This is §14's second race: a fetch that returns an
 *   older representation cannot move an order backward, because the newer
 *   event is replayed *after* it.)
 * - Snapshot already newer than a buffered event → replaying that event
 *   writes a stale value, but every commit newer than it is also in the
 *   buffer (the subscription was live before the snapshot was read), later
 *   in commit order, and overwrites it. The last write wins and is the
 *   newest.
 *
 * **The one limitation, stated exactly.** An event committed before the
 * snapshot was read but *delivered* after the buffer was flushed applies
 * over a newer snapshot and regresses that one card. Without `updated_at`
 * the hook cannot detect this. It is transient, not terminal: the commit
 * that made the snapshot newer is itself in flight on the same channel and
 * in commit order, so the board converges as soon as it lands, and any
 * refetch trigger re-establishes authority regardless. The smallest change
 * that would close the window outright is adding `updated_at` to
 * `ORDER_BOARD_COLUMNS`, `OrderBoardRow`, `isOrderBoardRow` and
 * `MerchantOrderSummary` — an amendment to M-2.2/M-2.3, not something M-2.5
 * may do silently, and not required by anything M-2.5 was asked to
 * guarantee.
 *
 * ## No polling
 *
 * One channel, one restaurant, no `setInterval`, no recurring timer, no
 * second subscription. Refetches are event-driven only: manual `refetch()`,
 * `visibilitychange` → `visible`, and a transition into `SUBSCRIBED` after
 * the subscription had dropped.
 */

export interface UseOrderBoard {
  /** Reconciled board, deduplicated by `order.id`, `placedAt` DESC (M-2.3's ordering). */
  orders: MerchantOrderSummary[];
  /** True from the moment a restaurant is scoped until its first fetch settles. Background refetches never re-raise it. */
  loading: boolean;
  /** Last fetch failure. Never replaces a valid board with an empty one; cleared by the next successful fetch. */
  error: string | null;
  /** M-2.4's status, passed through unchanged — M-2.6 owns the copy. */
  realtimeStatus: MerchantOrderRealtimeStatus;
  /** Re-reads the authoritative snapshot for the current restaurant. No-op when nothing is scoped. */
  refetch: () => void;
}

type OrderBoardMap = Map<string, MerchantOrderSummary>;

/**
 * A status the fetch may proceed on. `'IDLE'`/`'CONNECTING'` mean the
 * subscription has not yet resolved either way, and Pattern C says the
 * snapshot waits for that; everything else is either a live subscription or
 * a definitive failure, and both are actionable.
 */
function isSettled(status: MerchantOrderRealtimeStatus): boolean {
  return status !== 'IDLE' && status !== 'CONNECTING';
}

/**
 * Deterministic board ordering — `placed_at` DESC, exactly the convention
 * `fetchRestaurantOrders` already orders by; the repository query is not
 * changed. `id` breaks ties so two orders placed in the same millisecond
 * cannot swap between renders. Falls back to string comparison if a
 * timestamp is not parseable, rather than silently ordering by `NaN`.
 */
function sortBoard(board: OrderBoardMap): MerchantOrderSummary[] {
  return Array.from(board.values()).sort((a, b) => {
    const at = Date.parse(a.placedAt);
    const bt = Date.parse(b.placedAt);
    if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return bt - at;
    if (Number.isNaN(at) || Number.isNaN(bt)) {
      if (a.placedAt !== b.placedAt) return a.placedAt < b.placedAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Applies one normalized event to the keyed board.
 *
 * M-2.4 already validated the Supabase payload, so this does not re-validate
 * it (no second `isOrderBoardRow`). It does refuse values that could not
 * come from a correct M-2.4 — a missing id, or an order belonging to a
 * different restaurant — because those would corrupt board state rather
 * than merely being noise, and the hook must not crash on them.
 *
 * INSERT and UPDATE are both a keyed `set`: an INSERT whose id already
 * exists replaces rather than duplicating, and an UPDATE for an order the
 * board has not seen is added. Never an append.
 */
function applyEvent(
  board: OrderBoardMap,
  event: MerchantOrderRealtimeEvent,
  scopedRestaurantId: string | null,
): void {
  if (event.type === 'DELETE') {
    if (typeof event.orderId === 'string' && event.orderId.length > 0) board.delete(event.orderId);
    return;
  }

  const order = event.order;
  if (!order || typeof order.id !== 'string' || order.id.length === 0) return;
  if (scopedRestaurantId !== null && order.restaurantId !== scopedRestaurantId) return;
  board.set(order.id, order);
}

export function useOrderBoard(restaurantId: string | null): UseOrderBoard {
  const [orders, setOrders] = useState<MerchantOrderSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(restaurantId !== null);
  const [error, setError] = useState<string | null>(null);

  /** Authoritative board, keyed by id. State mirrors this; reconciliation happens here. */
  const boardRef = useRef<OrderBoardMap>(new Map());
  /** Events received while the barrier is up, in arrival (= commit) order. */
  const bufferRef = useRef<MerchantOrderRealtimeEvent[]>([]);
  /** The barrier: true while no snapshot is authoritative for the in-flight fetch. */
  const bufferingRef = useRef<boolean>(restaurantId !== null);
  /** Monotonic fetch token. Only the latest issued token may write board state. */
  const fetchTokenRef = useRef(0);
  /** The scope every async result is checked against — §17, independent of RLS. */
  const restaurantIdRef = useRef<string | null>(restaurantId);
  /** Whether any fetch has been started for the current scope. */
  const fetchStartedRef = useRef(false);
  /** Previous Realtime status, for detecting *transitions* rather than repeats. */
  const prevStatusRef = useRef<MerchantOrderRealtimeStatus>('IDLE');
  const mountedRef = useRef(true);

  const publish = useCallback(() => {
    setOrders(sortBoard(boardRef.current));
  }, []);

  /** Drains the barrier onto the current board, in order, and lifts it. */
  const flushBuffer = useCallback(() => {
    const buffered = bufferRef.current;
    bufferRef.current = [];
    bufferingRef.current = false;
    for (const event of buffered) applyEvent(boardRef.current, event, restaurantIdRef.current);
  }, []);

  /**
   * One fetch of the authoritative snapshot. Safe to overlap: the token and
   * scope checks mean an older response can never overwrite a newer one, and
   * neither can a response for a restaurant the merchant has since left
   * (§13, §17). The buffer is deliberately *not* cleared here — events
   * captured during a fetch that ends up stale still belong to the next
   * snapshot's replay.
   */
  const startFetch = useCallback(
    (scopeId: string) => {
      const token = (fetchTokenRef.current += 1);
      fetchStartedRef.current = true;
      bufferingRef.current = true;

      repositories.merchantOrders
        .listRestaurantOrders(scopeId)
        .then((rows) => {
          if (!mountedRef.current) return;
          if (token !== fetchTokenRef.current) return; // superseded by a newer fetch
          if (scopeId !== restaurantIdRef.current) return; // superseded by a restaurant switch

          // Establish the snapshot, then replay everything buffered during it.
          const next: OrderBoardMap = new Map();
          for (const order of rows) {
            if (order.restaurantId === scopeId) next.set(order.id, order);
          }
          boardRef.current = next;
          flushBuffer();

          setError(null);
          setLoading(false);
          publish();
        })
        .catch((cause: unknown) => {
          if (!mountedRef.current) return;
          if (token !== fetchTokenRef.current) return;
          if (scopeId !== restaurantIdRef.current) return;

          // A failed fetch establishes nothing: the last known good board
          // stays exactly as it was (§11, §12). The buffered events are
          // still real changes, so they are applied rather than discarded.
          flushBuffer();

          setError(cause instanceof Error ? cause.message : 'เกิดข้อผิดพลาด');
          setLoading(false);
          publish();
        });
    },
    [flushBuffer, publish],
  );

  const handleEvent = useCallback(
    (event: MerchantOrderRealtimeEvent) => {
      if (!mountedRef.current) return;
      if (bufferingRef.current) {
        bufferRef.current.push(event);
        return;
      }
      applyEvent(boardRef.current, event, restaurantIdRef.current);
      publish();
    },
    [publish],
  );

  const { status: realtimeStatus } = useOrderRealtime(restaurantId, handleEvent);

  // Scope lifecycle. Declared before the status effect so that on a
  // restaurant switch the new scope is installed before any fetch decision
  // is taken for it.
  useEffect(() => {
    restaurantIdRef.current = restaurantId;
    // Invalidate in flight work immediately, not merely when the next fetch
    // starts: between a switch and the new channel subscribing there is no
    // new token, and a delayed response for the old restaurant must not be
    // able to land in that window.
    fetchTokenRef.current += 1;
    boardRef.current = new Map();
    bufferRef.current = [];
    // Armed as soon as a restaurant is scoped, so an event that beats the
    // fetch is buffered rather than written onto a board the snapshot is
    // about to replace.
    bufferingRef.current = restaurantId !== null;
    fetchStartedRef.current = false;

    setOrders([]);
    setError(null);
    setLoading(restaurantId !== null);
    // `prevStatusRef` is intentionally NOT reset: it is a transition
    // detector, and for one render after a switch `realtimeStatus` is still
    // the old channel's value. Leaving it alone makes that repeat compare
    // equal and be ignored, instead of being mistaken for the new channel
    // having settled — which would start the fetch before the new
    // subscription exists and break the Pattern C barrier.
  }, [restaurantId]);

  // Fetch triggers driven by the subscription's own status.
  useEffect(() => {
    const previous = prevStatusRef.current;
    prevStatusRef.current = realtimeStatus;

    if (!restaurantId) return;
    if (realtimeStatus === previous) return; // repeat notification, not a transition

    if (!fetchStartedRef.current) {
      // Pattern C: the snapshot waits for the subscription to settle.
      if (isSettled(realtimeStatus)) startFetch(restaurantId);
      return;
    }

    // Already loaded once: a transition *into* SUBSCRIBED means the channel
    // resubscribed after a drop, and anything missed while it was down is
    // repaired by one authoritative re-read. Repeats are filtered above, so
    // a duplicate SUBSCRIBED cannot fetch twice.
    if (realtimeStatus === 'SUBSCRIBED') startFetch(restaurantId);
  }, [realtimeStatus, restaurantId, startFetch]);

  // Visibility restore. Event-driven only — this fires on a transition, so
  // it cannot become a poll while the tab simply stays visible.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const scopeId = restaurantIdRef.current;
      if (!scopeId) return;
      startFetch(scopeId);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [startFetch]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Nothing in flight may write state after this point.
      fetchTokenRef.current += 1;
    };
  }, []);

  const refetch = useCallback(() => {
    const scopeId = restaurantIdRef.current;
    if (!scopeId) return;
    startFetch(scopeId);
  }, [startFetch]);

  return { orders, loading, error, realtimeStatus, refetch };
}
