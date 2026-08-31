'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { MerchantOrderSummary } from '../domain/order';
import { isOrderBoardRow, toMerchantOrderSummary, type OrderBoardRow } from '../data/orderQueries';

/**
 * The Order Board's Realtime subscription seam (M-2.4) — `orders` INSERT /
 * UPDATE / DELETE events for one restaurant, normalized into a Merchant
 * domain event.
 *
 * **This is initial-fetch-free, reconciliation-free plumbing only.** M-2.5
 * owns the initial fetch, merging these events into board state, and
 * visibility/reconnect-triggered refetch; M-2.6 owns the "การเชื่อมต่อหลุด ·
 * กำลังเชื่อมต่อใหม่" UI copy for the status this hook exposes. This file
 * does neither.
 *
 * ## Scope is routing, not authorization
 *
 * `restaurant_id=eq.<restaurantId>` narrows *which* changes this client asks
 * to receive; it is not what decides whether the caller may receive them.
 * `orders_select_merchant` (`using (is_restaurant_member(restaurant_id))`,
 * `20260811000011_rls_policies.sql`) is evaluated by Realtime per
 * subscriber before a change is ever delivered — the same RLS policy the
 * M-2.3 initial fetch reads under. This hook does not, and must not, add a
 * second authorization check on top of it: no `profiles.role`, no JWT
 * claim, no membership query. `restaurantId` must already be a
 * membership-verified value (`useRestaurantScope`'s `currentRestaurantId`),
 * never read from `localStorage` here.
 *
 * ## Channel lifecycle
 *
 * One channel per restaurant, named deterministically
 * (`merchant-orders:<restaurantId>`) rather than a global singleton or a
 * random name, so a given restaurant's channel is always identifiable and
 * lifecycle behaviour is easy to reason about and test. On every
 * `restaurantId` change (including to/from `null`), the effect's cleanup —
 * which React always runs before the next effect body — removes the old
 * channel first; the new channel is only created afterwards. A channel's
 * filter is never mutated in place; a restaurant switch always tears down
 * and rebuilds. There is no polling and no manual reconnect timer: Supabase
 * Realtime reconnects and resubscribes on its own, and `subscribe()`'s own
 * status callback is how that surfaces here.
 *
 * ## Event normalization
 *
 * INSERT/UPDATE map `payload.new` through the same `OrderBoardRow` shape
 * and `toMerchantOrderSummary` mapper M-2.3's initial fetch uses — one
 * mapping boundary, not two — after `isOrderBoardRow` confirms the payload
 * actually has that shape. A payload that fails the check is dropped (never
 * fabricated into a `MerchantOrderSummary`) and logged.
 *
 * DELETE is normalized to `{ type: 'DELETE', orderId }`, never a full
 * order: M-2.1 deliberately left `orders` at `REPLICA IDENTITY DEFAULT`
 * (the primary key), because a rider's/merchant's read of *old* column
 * values — recipient name, phone, snapshots — has no legitimate use here,
 * so the DELETE payload's `old` is only reliably populated with `id`. This
 * function does not invent the rest of the row.
 */

export type MerchantOrderRealtimeEvent =
  | { type: 'INSERT'; order: MerchantOrderSummary }
  | { type: 'UPDATE'; order: MerchantOrderSummary }
  | { type: 'DELETE'; orderId: string };

/**
 * `'IDLE'` (no restaurant scoped, no channel) and `'CONNECTING'` (channel
 * created, `subscribe()` called, no status callback yet) are the only two
 * values this hook adds on top of the installed
 * `@supabase/realtime-js`'s own `REALTIME_SUBSCRIBE_STATES` — deliberately,
 * so this stays the one status vocabulary rather than a second network
 * status system next to Supabase's.
 */
export type MerchantOrderRealtimeStatus = 'IDLE' | 'CONNECTING' | `${REALTIME_SUBSCRIBE_STATES}`;

export interface UseOrderRealtime {
  status: MerchantOrderRealtimeStatus;
}

function channelNameFor(restaurantId: string): string {
  return `merchant-orders:${restaurantId}`;
}

function handlePostgresChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  onEvent: (event: MerchantOrderRealtimeEvent) => void,
): void {
  if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
    if (!isOrderBoardRow(payload.new)) {
      console.error(`useOrderRealtime: dropped malformed ${payload.eventType} payload`, payload.new);
      return;
    }
    onEvent({ type: payload.eventType, order: toMerchantOrderSummary(payload.new as OrderBoardRow) });
    return;
  }

  // DELETE: `old` is `Partial<OrderBoardRow>` under REPLICA IDENTITY DEFAULT
  // — only `id` (the primary key) is reliably present. Extract exactly that
  // and nothing more; do not fabricate the rest of the row.
  const oldId = (payload.old as Record<string, unknown> | undefined)?.id;
  if (typeof oldId !== 'string' || oldId.length === 0) {
    console.error('useOrderRealtime: dropped DELETE payload with no usable id', payload.old);
    return;
  }
  onEvent({ type: 'DELETE', orderId: oldId });
}

/**
 * Subscribes to `orders` changes for `restaurantId`, or does nothing (and
 * reports `'IDLE'`) while `restaurantId` is `null`.
 *
 * `onEvent` is read through a ref, not a `useEffect` dependency — a new
 * function identity from the caller on every render must not tear down and
 * recreate the channel; only a `restaurantId` change should.
 */
export function useOrderRealtime(
  restaurantId: string | null,
  onEvent: (event: MerchantOrderRealtimeEvent) => void,
): UseOrderRealtime {
  const [status, setStatus] = useState<MerchantOrderRealtimeStatus>('IDLE');
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!restaurantId) {
      setStatus('IDLE');
      return;
    }

    setStatus('CONNECTING');

    const channel: RealtimeChannel = supabase.channel(channelNameFor(restaurantId));

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
      (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) =>
        handlePostgresChange(payload, (event) => onEventRef.current(event)),
    );

    channel.subscribe((nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  return { status };
}
