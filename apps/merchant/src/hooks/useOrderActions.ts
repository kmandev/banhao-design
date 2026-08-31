'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { repositories } from '../repositories';
import type { MerchantOrderSummary, OrderState } from '../domain/order';
import { orderActionErrorMessage, type OrderActionCommand } from '../lib/orderBoardDisplay';

/**
 * Per-card action state for the Order Board's three merchant commands (M-2.7).
 *
 *   OrderCard → onAction → useOrderActions → merchantOrders.transitionOrder
 *     → apiClient → POST /api/v1/orders/:id/{accept|start-preparing|mark-ready}
 *     → server guarded UPDATE → Realtime UPDATE → useOrderRealtime
 *     → useOrderBoard → the card moves
 *
 * This hook owns exactly two things — which card has a command in flight, and
 * which card's last command failed. It owns **no order data**. `useOrderBoard`
 * remains the single board-state authority, and nothing here writes to it.
 *
 * ## The response is never applied to the board
 *
 * `transitionOrder` resolves with the server's `{ orderId, state }`, and this
 * hook deliberately throws it away. Writing it into the board would be a
 * second state-management mechanism racing the first, and — worse — it would
 * make the card move because *the request succeeded* rather than because the
 * order actually changed. M-2.7's brief is explicit: "Do not locally fabricate
 * the new state merely because the mutation request succeeded."
 *
 * This also disposes of the stale-response hazard rather than mitigating it.
 * `useOrderBoard` already guards its own async writes with a monotonic fetch
 * token and a scope check, and its board is a `Map` keyed by order id written
 * only by (a) the token-guarded snapshot and (b) Realtime events. A mutation
 * response is neither, so it cannot overwrite a newer Realtime state no matter
 * how late it arrives. The existing architecture is sufficient here and is
 * left unchanged, exactly as the brief requires.
 *
 * ## Why success does not clear the pending state
 *
 * A pending entry records the state the command was issued *from*, and a card
 * reads as pending only while `pending[id] === order.state`. So:
 *
 * - **Success** leaves the entry alone. The button stays busy through the
 *   whole mutation → Realtime → re-render path, and resolves at the exact
 *   moment the order's state actually changes — because the entry then no
 *   longer matches. The spinner therefore means "waiting for this to become
 *   true", not "waiting for HTTP", which is the honest claim and the one the
 *   merchant cares about.
 * - **Failure** clears the entry and records a message, because nothing is
 *   coming: the state will not change, so nothing else would ever resolve it.
 *
 * The alternative — clearing on HTTP success — would re-enable `รับออเดอร์` on
 * an order the server has already accepted, for however long the Realtime hop
 * takes. That invites a second press whose only possible outcome is an
 * `INVALID_TRANSITION` the merchant did nothing to deserve.
 *
 * A consequence worth stating plainly: if the mutation succeeds and Realtime
 * never delivers, the card stays busy. That is intended. Retrying would not
 * help (the server has already moved the order, so a retry earns
 * `INVALID_TRANSITION`), the board's own reconnect banner already says the
 * connection is down, and `useOrderBoard` re-reads authoritatively on both
 * resubscribe and tab-visibility restore — so the state self-heals without a
 * timer here. M-2.7 forbids timers, and this design needs none.
 *
 * ## Scope
 *
 * No restaurant id is passed or checked. The board only ever renders orders
 * `orders_select_merchant` RLS already returned for the scoped restaurant, and
 * the server re-derives the caller's merchant capabilities on every command
 * (`NOT_RESTAURANT_MEMBER`) from the bearer token rather than from anything
 * this client sends. Adding a client-side restaurant check would be a third
 * copy of an authorization decision that is already made twice, in the two
 * places that can actually enforce it.
 */

/** The state a card's in-flight command was issued from, keyed by order id. */
type PendingMap = Record<string, OrderState>;
/** The failure of a card's last command, keyed by order id. */
type ErrorMap = Record<string, { state: OrderState; message: string }>;

export interface UseOrderActions {
  /** True while this order has a command in flight that its current state has not yet resolved. */
  isPending(order: MerchantOrderSummary): boolean;
  /** The Thai failure message for this order's last command, or `null`. Cleared once the order's state moves on. */
  errorFor(order: MerchantOrderSummary): string | null;
  /** Issues one command. A no-op if this order already has one in flight. */
  runAction(order: MerchantOrderSummary, command: OrderActionCommand): void;
}

export function useOrderActions(): UseOrderActions {
  const [pending, setPending] = useState<PendingMap>({});
  const [errors, setErrors] = useState<ErrorMap>({});

  /**
   * Mirrors `pending` for the duplicate-submission guard. Read synchronously
   * inside `runAction` because two clicks in the same tick would both observe
   * the same pre-update `pending` value from the closure — a `useState` read
   * cannot reject the second press, a ref can.
   */
  const pendingRef = useRef<PendingMap>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runAction = useCallback((order: MerchantOrderSummary, command: OrderActionCommand) => {
    // Duplicate submission guard. Deliberately keyed on state as well as id,
    // so it blocks a second press of *this* command while it is unresolved,
    // yet never blocks the next, legitimately different command once the
    // order has moved on (accept → start-preparing on the same card).
    if (pendingRef.current[order.id] === order.state) return;

    pendingRef.current = { ...pendingRef.current, [order.id]: order.state };
    setPending((prev) => ({ ...prev, [order.id]: order.state }));
    setErrors((prev) => {
      if (!(order.id in prev)) return prev;
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

    repositories.merchantOrders
      .transitionOrder(order.id, command)
      .then(() => {
        // Intentionally empty. The response is not applied to board state and
        // the pending entry is not cleared — see this module's doc comment.
      })
      .catch((cause: unknown) => {
        // The ref must be released even after unmount, so a remounted board
        // is not left permanently unable to retry this order.
        const next = { ...pendingRef.current };
        delete next[order.id];
        pendingRef.current = next;

        if (!mountedRef.current) return;

        setPending((prev) => {
          if (!(order.id in prev)) return prev;
          const updated = { ...prev };
          delete updated[order.id];
          return updated;
        });
        setErrors((prev) => ({
          ...prev,
          [order.id]: { state: order.state, message: orderActionErrorMessage(cause) },
        }));
      });
  }, []);

  const isPending = useCallback(
    (order: MerchantOrderSummary) => pending[order.id] === order.state,
    [pending],
  );

  /**
   * Scoped to the state the failure happened in, for the same reason
   * `isPending` is: once the order moves, a message about the previous state
   * is stale — whether it moved because a retry worked or because someone
   * else acted. A stale entry is simply never read; it is overwritten by this
   * order's next failure and discarded with the board.
   */
  const errorFor = useCallback(
    (order: MerchantOrderSummary) => {
      const failure = errors[order.id];
      return failure && failure.state === order.state ? failure.message : null;
    },
    [errors],
  );

  return { isPending, errorFor, runAction };
}
