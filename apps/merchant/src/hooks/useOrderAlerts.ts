'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MerchantOrderSummary } from '../domain/order';
import { countTodayOrders, countWaitingOrders } from '../lib/boardCounts';
import { getSoundPreference, setSoundPreference } from '../lib/soundPreference';
import { createAlertPlayer, type AlertPlayer } from '../lib/alertSound';

/**
 * Arrival alerting and header-count side effects for the Order Board (M-03),
 * layered entirely on top of `useOrderBoard`'s (M-2.5) already-reconciled
 * `orders` snapshot. This hook opens no channel, makes no request, and reads
 * no Supabase client of its own — `orders` is its only input besides the
 * render-time clock the board already threads through (`OrderBoard.tsx`'s
 * `now`, not a timer this hook owns either.
 *
 * ## What counts as a "new arrival"
 *
 * The order that is `PAID` at the moment this hook first runs is not a new
 * arrival — it was already sitting on the board before this hook (or the
 * page) existed. Only a `PAID` order id that appears *afterward* — a real
 * Realtime `INSERT`, or an `UPDATE` into `PAID` — is one. This is tracked
 * with a plain `Set` of previously-seen `PAID` ids, seeded (without alerting)
 * on the first effect run, exactly analogous to how `isRecentArrival` in
 * `orderBoardDisplay.ts` uses `placedAt` age for the *visual* ring — this is
 * the same "genuinely new, not just present" distinction, applied to sound
 * instead of a border.
 *
 * ## Repeating without a timer
 *
 * M-2.6/M-2.7 forbid `setInterval`/`setTimeout`/polling, and this hook adds
 * none. "Repeats until accepted" is instead re-evaluated on every `orders`
 * change: as long as at least one order that triggered an alert is still
 * `PAID` (i.e. still unresolved) when a *later*, unrelated board event
 * causes `orders` to change again (another Realtime event, a `refetch()`, a
 * visibility-restore re-read), the alert plays again. This is genuinely
 * event-driven repetition, not a fixed cadence — the practical consequence,
 * stated plainly rather than left implicit, is that the repeat rate tracks
 * how much Realtime traffic the board is already receiving, not a metronome.
 * A board that goes quiet while one order sits unaccepted will not chime
 * again until something else happens.
 *
 * ## The stop conditions that exist, and the one that does not
 *
 * The design's own note ("Audible alert repeats until the card is opened or
 * accepted") names two stop conditions. M-2.6 has no order-detail screen
 * (M-04) and therefore no "opened" interaction to hook — inventing one here
 * would be scope creep into a screen this milestone is explicitly not
 * building. So only two stop conditions exist: the order leaves `PAID`
 * (accepted — the id drops out of the tracked set automatically, since the
 * set is recomputed from current state every run), or the merchant mutes.
 * This is a stated, accepted limitation, not a silent omission.
 */

export interface UseOrderAlerts {
  /** Whether the arrival alert may play. Defaults to the last stored preference, or ON. */
  soundEnabled: boolean;
  /** Toggles the preference and persists it. Called from a real click, so also the legitimate moment to unlock/resume the audio context. */
  toggleSound: () => void;
  /** True once a play attempt has been refused by the browser's autoplay policy — the bell should say so, not pretend it worked. */
  audioBlocked: boolean;
  /** `ออเดอร์วันนี้ N` — every order placed today (Asia/Bangkok), any state. */
  todayCount: number;
  /** The NEW column's count — orders still `PAID`, awaiting accept/reject. Drives the tab title. */
  waitingCount: number;
}

const BASE_TAB_TITLE = 'ออเดอร์วันนี้ — BANHAO';

export function useOrderAlerts(orders: readonly MerchantOrderSummary[], nowMs: number): UseOrderAlerts {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioBlocked, setAudioBlocked] = useState(false);

  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const playerRef = useRef<AlertPlayer | null>(null);
  if (!playerRef.current) playerRef.current = createAlertPlayer();

  const seenPaidIdsRef = useRef<Set<string> | null>(null);
  const alertingIdsRef = useRef<Set<string>>(new Set());

  const todayCount = countTodayOrders(orders, nowMs);
  const waitingCount = countWaitingOrders(orders);

  // Sync the stored preference once the component is mounted in a real
  // browser — not during the initial render, so server-rendered and
  // first-client-rendered HTML match (no localStorage read before hydration).
  useEffect(() => {
    setSoundEnabled(getSoundPreference());
  }, []);

  const attemptPlay = useCallback(() => {
    if (!soundEnabledRef.current) return;
    const player = playerRef.current;
    if (!player) return;
    void player.play().then((result) => {
      setAudioBlocked(!result.played && result.reason === 'blocked');
    });
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((previous) => {
      const next = !previous;
      setSoundPreference(next);
      if (next) {
        // A real click — the legitimate user gesture to unlock/resume the
        // audio context, and a short confirmation tone that the toggle took.
        soundEnabledRef.current = true;
        attemptPlay();
      }
      return next;
    });
  }, [attemptPlay]);

  useEffect(() => {
    const currentPaidIds = new Set<string>();
    for (const order of orders) {
      if (order.state === 'PAID') currentPaidIds.add(order.id);
    }

    if (seenPaidIdsRef.current === null) {
      // First run: whatever is already PAID pre-dates this hook and is not
      // a new arrival. See the module doc comment.
      seenPaidIdsRef.current = currentPaidIds;
      return;
    }

    let hasNewArrival = false;
    for (const id of currentPaidIds) {
      if (!seenPaidIdsRef.current.has(id)) {
        alertingIdsRef.current.add(id);
        hasNewArrival = true;
      }
    }
    seenPaidIdsRef.current = currentPaidIds;

    // Resolve: anything no longer PAID (accepted, or any other transition)
    // stops being alerted for.
    for (const id of Array.from(alertingIdsRef.current)) {
      if (!currentPaidIds.has(id)) alertingIdsRef.current.delete(id);
    }

    if (alertingIdsRef.current.size > 0) {
      // Either a fresh arrival just joined, or a previously-alerted order is
      // still unresolved and this is another genuine board event — both are
      // legitimate reasons to sound again; see "Repeating without a timer".
      void hasNewArrival; // documented above; kept for readability, not branched on
      attemptPlay();
    }
  }, [orders, attemptPlay]);

  // Tab title — captures the pre-existing title exactly once, restores it
  // exactly once on unmount, independent of how many times waitingCount
  // changes in between.
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    originalTitleRef.current = document.title;
    return () => {
      if (originalTitleRef.current !== null) document.title = originalTitleRef.current;
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = waitingCount > 0 ? `(${waitingCount}) ${BASE_TAB_TITLE}` : BASE_TAB_TITLE;
  }, [waitingCount]);

  return { soundEnabled, toggleSound, audioBlocked, todayCount, waitingCount };
}
