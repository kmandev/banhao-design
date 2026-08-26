import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { RiderOfferSummary } from '../domain/riderOffer';
import { repositories } from '../repositories';
import { ApiClientError } from '../lib/apiClient';

/**
 * The rider's offer inbox — G-7.1 (V1.1 §9, `rider_assignment_attempts`).
 *
 * ## Foreground-only polling, per the TQ-002 decision (POLLING)
 *
 * `rider_assignment_attempts` is not in the `supabase_realtime` publication
 * and adding it would be a schema change the migration lock forbids
 * (`docs/OPEN_TECHNICAL_QUESTIONS.md` TQ-002; `docs/DRIVER_APP_DESIGN_QUESTIONS.md`
 * DQ-G7-02). So: fetch on focus, poll on a bounded interval while this screen
 * is the focused one, and stop — timer cleared, not just left to fire into the
 * void — the moment it blurs or unmounts. No Realtime, no push, no background
 * task. `useFocusEffect`'s own cleanup is what guarantees at most one timer is
 * ever alive.
 *
 * The interval is a plain implementation choice, not a second architecture
 * decision: comfortably inside DEC-037's 60-second offer window, and far from
 * the "never poll aggressively" line V1.1 §18 risk 11 draws.
 */
const POLL_INTERVAL_MS = 15_000;

export type OfferInboxView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; offers: RiderOfferSummary[] };

export interface RiderOfferInboxController {
  view: OfferInboxView;
  /** Fetches immediately, outside the poll cadence — e.g. a manual "refresh" tap. */
  refresh: () => void;
  /** The offer currently being accepted or declined, if any. Only one action runs at a time. */
  busyOfferId: string | null;
  /** The last accept/decline failure, cleared when a new action starts. */
  actionError: string | null;
  acceptOffer: (offerId: string) => Promise<void>;
  declineOffer: (offerId: string) => Promise<void>;
}

/** A poll or manual refresh failure. The repository's own message — see `riderOfferQueries.ts`'s `raise`. */
function loadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

/**
 * An accept/decline failure. `ApiClientError.code` is the contract to branch
 * on (its own doc-comment: "never on `message`") — this resolves the offer
 * surface's known codes to short, neutral copy and falls back for anything
 * else, rather than ever showing a server-facing string to the rider.
 */
const ACTION_ERROR_COPY: Record<string, string> = {
  OFFER_TAKEN: 'งานนี้ถูกไรเดอร์คนอื่นรับไปแล้ว',
  OFFER_EXPIRED: 'งานนี้หมดเวลารับแล้ว',
  RIDER_HAS_ACTIVE_DELIVERY: 'คุณมีงานที่กำลังดำเนินการอยู่แล้ว',
  NOT_FOUND: 'ไม่พบงานนี้แล้ว',
  FORBIDDEN: 'บัญชีนี้ยังไม่ได้รับอนุมัติให้รับงาน',
};

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return ACTION_ERROR_COPY[error.code] ?? 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่';
  }
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

export function useRiderOfferInbox(): RiderOfferInboxController {
  const [view, setView] = useState<OfferInboxView>({ status: 'loading' });
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Guards the one poll tick in flight — a slow response must not overlap
  // with the next timer tick or a manual refresh.
  const loading = useRef(false);
  // Set when a `load()` call arrives while one is already in flight. Rather
  // than dropping that call (the original bug: an accept/decline's guaranteed
  // post-action refresh silently swallowed by a same-moment poll tick), it is
  // coalesced into exactly one more read once the in-flight one settles — no
  // concurrent reads, no unbounded queue, just "run once more".
  const refreshPending = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) {
      refreshPending.current = true;
      return;
    }
    loading.current = true;

    try {
      const offers = await repositories.offers.listPendingOffers();
      setView({ status: 'ready', offers });
    } catch (error) {
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

  const runAction = useCallback(
    async (offerId: string, action: (id: string) => Promise<unknown>) => {
      setActionError(null);
      setBusyOfferId(offerId);

      try {
        await action(offerId);
      } catch (error) {
        setActionError(actionErrorMessage(error));
      } finally {
        setBusyOfferId(null);
        // The server's response is the only authority, in both directions: a
        // success moved the offer out of PENDING, and a 409 means someone
        // else already did. Either way the list just read is stale — it is
        // re-read, never patched locally from a guess.
        await load();
      }
    },
    [load],
  );

  const acceptOffer = useCallback(
    (offerId: string) => runAction(offerId, (id) => repositories.offerActions.acceptOffer(id)),
    [runAction],
  );

  const declineOffer = useCallback(
    (offerId: string) => runAction(offerId, (id) => repositories.offerActions.declineOffer(id)),
    [runAction],
  );

  return { view, refresh, busyOfferId, actionError, acceptOffer, declineOffer };
}
