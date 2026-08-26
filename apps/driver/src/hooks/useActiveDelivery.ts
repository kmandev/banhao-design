import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { RiderActiveDelivery, DeliveryAction } from '../domain/riderDelivery';
import type { RiderOrderDetail } from '../domain/riderOrder';
import { repositories } from '../repositories';
import { ApiClientError } from '../lib/apiClient';

/**
 * The rider's active delivery — Phase G-7.2.
 *
 * ## Polling: the same mechanics as G-7.1, deliberately unchanged
 *
 * Fetch on focus, poll on a bounded interval while this screen is the focused
 * one, clear the timer on blur or unmount. `useFocusEffect`'s own cleanup is
 * what guarantees at most one timer is ever alive **on this screen**, and
 * because only one screen is focused at a time, this hook's timer and
 * `useRiderOfferInbox`'s can never run concurrently — no stacked pollers, no
 * background task, no Realtime (TQ-002 is still `OPEN`).
 *
 * The interval is the same 15 s constant `useRiderOfferInbox` uses, for the
 * same reason it is a plain implementation choice there rather than a second
 * architecture decision. It matters here for one thing the rider cannot
 * otherwise learn: the **merchant** moving the order to `READY_FOR_PICKUP`.
 * Every other transition on this screen is the rider's own action, and those
 * refresh immediately rather than waiting for a tick.
 *
 * ## Server authority, in both directions
 *
 * No optimistic transition and no local state patching. An action's outcome is
 * whatever the API returned, and the delivery is always **re-read** afterwards
 * — the same discipline `useRiderOfferInbox.runAction` establishes. A rider
 * who taps a stale button gets `INVALID_TRANSITION` from the server and sees
 * the true state on the re-read; the client never decides a transition is
 * illegal on its own.
 *
 * ## Completion
 *
 * A successful `delivered` sets {@link ActiveDeliveryController.completedAt}
 * and the re-read then returns `null`, because `DELIVERED` is terminal and not
 * in `ACTIVE_DELIVERY_STATES`. Both facts are exposed rather than one: without
 * `completedAt` the screen would snap from "delivering" to "no active
 * delivery" with no confirmation that the delivery succeeded, which is exactly
 * the "silence drawn as calm" the redesign forbids.
 */
const POLL_INTERVAL_MS = 15_000;

export type ActiveDeliveryView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'empty' }
  | { status: 'ready'; delivery: RiderActiveDelivery; order: RiderOrderDetail | null };

export interface ActiveDeliveryController {
  view: ActiveDeliveryView;
  /** Fetches immediately, outside the poll cadence — e.g. a manual retry tap. */
  refresh: () => void;
  /** True while a transition command is in flight. Only one runs at a time. */
  busy: boolean;
  /** The last transition failure, cleared when a new action starts. */
  actionError: string | null;
  /** `deliveries.delivered_at` from a successful completion in this session, else `null`. */
  completedAt: string | null;
  /** Dismisses the completion confirmation and returns the screen to its normal states. */
  acknowledgeCompletion: () => void;
  runStep: (deliveryId: string, action: DeliveryAction) => Promise<void>;
}

/** A load failure. The repository's own message — see `riderDeliveryQueries.ts`'s `raise`. */
function loadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

/**
 * A transition failure. `ApiClientError.code` is the contract to branch on
 * (its own doc-comment: "never on `message`") — this resolves the delivery
 * surface's known codes to short, neutral copy and falls back for anything
 * else, rather than ever showing a server-facing string to the rider.
 *
 * Same shape and the same rule as `useRiderOfferInbox`'s `ACTION_ERROR_COPY`.
 */
const ACTION_ERROR_COPY: Record<string, string> = {
  INVALID_TRANSITION: 'สถานะงานเปลี่ยนไปแล้ว ระบบกำลังโหลดสถานะล่าสุด',
  NOT_ASSIGNED_RIDER: 'งานนี้ไม่ใช่งานของคุณแล้ว',
  NOT_FOUND: 'ไม่พบงานนี้แล้ว',
  FORBIDDEN: 'บัญชีนี้ยังไม่ได้รับอนุมัติให้รับงาน',
};

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return ACTION_ERROR_COPY[error.code] ?? 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';
  }
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

export function useActiveDelivery(): ActiveDeliveryController {
  const [view, setView] = useState<ActiveDeliveryView>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  // Guards the one read in flight — a slow response must not overlap with the
  // next timer tick or a post-action refresh.
  const loading = useRef(false);
  // Set when a `load()` arrives while one is already in flight. Rather than
  // dropping it (which would silently swallow a post-action refresh), it is
  // coalesced into exactly one more read once the in-flight one settles — the
  // same `refreshPending` mechanism `useRiderOfferInbox` uses, and for the
  // same bug.
  const refreshPending = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) {
      refreshPending.current = true;
      return;
    }
    loading.current = true;

    try {
      const delivery = await repositories.delivery.getActiveDelivery();

      if (!delivery) {
        setView({ status: 'empty' });
        return;
      }

      // The order half is a second read, and it is allowed to fail on its own:
      // the delivery is what the rider acts on, and every action below needs
      // only `deliveryId`. Losing the address is a degraded screen; losing the
      // delivery would be a lost job. `rider_order_view` returns nothing until
      // the rider is assigned, so `null` here is also the legitimate answer
      // during a brief window rather than always an error.
      let order: RiderOrderDetail | null = null;
      try {
        order = await repositories.riderOrderView.getAssignedOrder();
      } catch {
        order = null;
      }

      setView({ status: 'ready', delivery, order });
    } catch (error) {
      // Never rendered as "no active delivery" — that would tell a rider
      // mid-delivery that they have no job.
      setView({ status: 'error', message: loadErrorMessage(error) });
    } finally {
      loading.current = false;
      if (refreshPending.current) {
        refreshPending.current = false;
        void load();
      }
    }
  }, []);

  const refresh = useCallback(() => {
    setView({ status: 'loading' });
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      setView({ status: 'loading' });
      void load();

      const timer = setInterval(() => {
        void load();
      }, POLL_INTERVAL_MS);

      return () => clearInterval(timer);
    }, [load]),
  );

  const runStep = useCallback(
    async (deliveryId: string, action: DeliveryAction) => {
      setActionError(null);
      setBusy(true);

      try {
        const actions = repositories.deliveryActions;

        if (action === 'delivered') {
          const result = await actions.markDelivered(deliveryId);
          // Only reached on a 200. `completedAt` is never set optimistically
          // and never from a local clock — it is the server's own
          // `deliveries.delivered_at`.
          setCompletedAt(result.deliveredAt ?? new Date().toISOString());
        } else if (action === 'arrived') {
          await actions.markArrived(deliveryId);
        } else if (action === 'pickedUp') {
          await actions.markPickedUp(deliveryId);
        } else {
          await actions.markEnRoute(deliveryId);
        }
      } catch (error) {
        setActionError(actionErrorMessage(error));
      } finally {
        setBusy(false);
        // The server's response is the only authority, in both directions: a
        // success moved the delivery, and a 409 means it was already moved by
        // something else. Either way the state just read is stale — it is
        // re-read, never patched locally from a guess.
        await load();
      }
    },
    [load],
  );

  const acknowledgeCompletion = useCallback(() => setCompletedAt(null), []);

  return { view, refresh, busy, actionError, completedAt, acknowledgeCompletion, runStep };
}
