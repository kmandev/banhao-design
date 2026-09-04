'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useOrderBoard } from '../hooks/useOrderBoard';
import { useOrderActions } from '../hooks/useOrderActions';
import { useOrderAlerts } from '../hooks/useOrderAlerts';
import { useAvailability } from '../hooks/useAvailability';
import type { MerchantOrderRealtimeStatus } from '../hooks/useOrderRealtime';
import type { MerchantOrderSummary } from '../domain/order';
import { BOARD_COLUMNS, groupOrdersByColumn, type BoardColumnId, type OrderActionCommand } from '../lib/orderBoardDisplay';
import { OrderCard } from './OrderCard';
import { OrderDetailPanel } from './OrderDetailPanel';
import { AcceptConfirmDialog } from './AcceptConfirmDialog';
import { AvailabilityDialog, type AvailabilityDialogMode } from './AvailabilityDialog';

/**
 * The Order Board (M-2.6) — design
 * `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html`.
 *
 * Consumes `useOrderBoard(restaurantId)` (M-2.5) exclusively: no direct
 * Supabase access, no second repository, no second Realtime subscription,
 * no polling. `restaurantId` is expected to already be a membership-verified
 * value (`useRestaurantScope`'s `currentRestaurantId`, passed down from
 * `dashboard/page.tsx`) — this component neither reads `localStorage` nor
 * re-derives scope.
 *
 * State → column mapping and every piece of Thai copy are exactly the
 * design's §06/§07 "SPECIFIED" list; see `../lib/orderBoardDisplay` for the
 * derivations and their citations. Rejection, accept/start/ready mutations,
 * the order-detail panel, and everything else the design's own "OUT OF
 * SCOPE FOR M-2.6" box lists are not implemented here.
 *
 * ## No ticking timer
 *
 * `now` is read once per render (`Date.now()`), not from a `setInterval` —
 * M-2.6's own rules forbid introducing a timer here, the same as M-2.5's
 * data layer forbids one for fetching. See `orderBoardDisplay.ts`'s module
 * doc comment for the fidelity trade-off this implies against the design's
 * "ticks client-side" language.
 *
 * ## Tablet breakpoint
 *
 * 768–1024px collapses to two columns (`ใหม่ · รอตอบรับ`, `กำลังทำ`) plus a
 * bottom tray for `พร้อมให้ไรเดอร์รับ` — the one column with no merchant
 * action (UX-SPEC §6). Implemented with a CSS media query, not a resize
 * listener (no new client-side machinery, same technique `Spinner.tsx`
 * already uses for its keyframes). The tray's manual expand/collapse is a
 * plain click toggle; the design's "auto-expands once for 5 seconds" tray
 * behaviour is explicitly tagged a DESIGN CHOICE, not SPECIFIED (§07), and
 * implementing it would need a timer — so it is intentionally omitted here.
 * Below 768px, the same tablet layout is kept as a floor rather than
 * building an unspecified third layout (§07 marks anything under 768px
 * "NOT DECIDED... a safety net, not a proposed mobile workflow").
 *
 * ## Header chrome (M-03)
 *
 * The connection pill, sound bell and `ออเดอร์วันนี้ N` badge live in the
 * design's own board-panel header (§02's `height:72px` bar), not in
 * `AppShell`'s outer app chrome — `AppShell` already owns the restaurant
 * identity/switch/logout row, a separate concern. `BoardHeaderBar` below
 * reuses this component's own `useOrderBoard`/`useOrderRealtime` state
 * (`orders`, `realtimeStatus`) via `useOrderAlerts` — no second Realtime
 * subscription, no second data fetch, exactly the seam M-03's brief requires.
 *
 * ## Order detail panel (M-04)
 *
 * `selectedOrderId` is owned here, not in `OrderCard` or `OrderDetailPanel`:
 * `OrderCard` stays presentational (M-2.7's own rule) and the panel receives
 * only the already-selected order, never a raw id it would have to resolve
 * itself. `selectedOrder` is looked up by id in this component's own
 * `orders` array on every render — never stored separately — so a Realtime
 * event that changes that order produces a new object automatically, and an
 * order that leaves the array (only possible via a restaurant switch, since
 * orders cannot be deleted) makes `selectedOrder` resolve to `null` and the
 * panel close itself, with no separate "is this still in scope" check
 * needed. `restaurantId` changing also explicitly clears the selection and
 * returns focus to the board — see the effect below.
 *
 * No second Realtime subscription and no direct Supabase read happen here:
 * `OrderDetailPanel` → `useOrderDetail` fetches through the same
 * `repositories.merchantOrders` seam `useOrderBoard` already uses.
 *
 * ## Accept confirmation (M-05)
 *
 * `รับออเดอร์` no longer issues the command. It opens `AcceptConfirmDialog`,
 * which collects a prep time and calls back into the same
 * `useOrderActions.runAction` the other two commands use — the button's
 * `onAction` contract is unchanged in shape, only what this board does with
 * an `'accept'` is (M05-D02). The other two commands are dispatched
 * immediately, exactly as before.
 *
 * `acceptOrderId` is a lookup into `orders`, the same way `selectedOrderId`
 * is, so the dialog always sees the live row. The dialog closes when that row
 * is **no longer `PAID`** — which only Realtime can make true (M05-D05/D06).
 * Nothing here closes it on an HTTP success, applies a mutation response, or
 * fabricates `MERCHANT_ACCEPTED`; there is no timer and no second
 * subscription.
 *
 * M-04 and M-05 are mutually exclusive: opening one clears the other, so two
 * scrims and two focus traps can never be stacked. `openerRef` is shared —
 * only one overlay is ever open, so one return target is enough, and focus
 * returns to the originating card in every close path.
 */

function isDegraded(status: MerchantOrderRealtimeStatus): boolean {
  return status !== 'IDLE' && status !== 'CONNECTING' && status !== 'SUBSCRIBED';
}

function ColumnHeader({
  title,
  statesLabel,
  count,
  accent,
  badgeBackground,
  badgeColor,
}: {
  title: string;
  statesLabel: string;
  count: number | null;
  accent: string;
  badgeBackground: string;
  badgeColor: string;
}) {
  return (
    <>
      <div style={{ height: 4, background: accent }} aria-hidden />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid #F1E9DE',
        }}
      >
        <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{title}</h2>
        {count !== null ? (
          <div
            style={{
              minWidth: 26,
              height: 26,
              padding: '0 8px',
              borderRadius: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: 13,
              fontWeight: 600,
              background: badgeBackground,
              color: badgeColor,
            }}
          >
            {count}
          </div>
        ) : null}
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 10.5,
            color: '#A2968A',
            textAlign: 'right',
            lineHeight: 1.5,
          }}
        >
          {statesLabel}
        </div>
      </div>
    </>
  );
}

const COLUMN_ACCENT: Record<BoardColumnId, { accent: string; badgeBackground: string; badgeColor: string }> = {
  NEW: { accent: '#E4572E', badgeBackground: '#FDEEE7', badgeColor: '#C2431F' },
  PREPARING: { accent: '#B98418', badgeBackground: '#FBF1DC', badgeColor: '#9A7810' },
  READY: { accent: '#0F8B5F', badgeBackground: '#EAF6EF', badgeColor: '#0F8B5F' },
};

function BoardSkeletonColumn({ title, accent }: { title: string; accent: string }) {
  return (
    <div style={{ borderRadius: 18, background: '#fff', border: '1px solid #EAE1D6', overflow: 'hidden' }}>
      <div style={{ height: 4, background: accent }} aria-hidden />
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #F1E9DE' }}>
        <h2 style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="banhao-board-skeleton-block" style={{ height: 80, borderRadius: 12 }} />
        <div className="banhao-board-skeleton-block" style={{ height: 80, borderRadius: 12 }} />
      </div>
    </div>
  );
}

function BoardError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{
        borderRadius: 20,
        border: '1px solid #E2D8CB',
        background: '#F6F0E7',
        minHeight: 296,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            background: '#FBEAEA',
            color: '#D93A3A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            fontWeight: 700,
            margin: '0 auto 16px',
          }}
        >
          !
        </div>
        <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.5 }}>โหลดออเดอร์ไม่สำเร็จ</div>
        <div style={{ fontSize: 14, color: '#5A4E42', lineHeight: 1.7, marginTop: 8 }}>
          ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง ถ้ายังไม่ได้ ให้ติดต่อผู้ดูแลระบบ
        </div>
        {message ? (
          <div style={{ fontSize: 12, color: '#A2968A', marginTop: 8 }}>{message}</div>
        ) : null}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onRetry}
            style={{
              height: 56,
              padding: '0 26px',
              borderRadius: 16,
              background: '#E4572E',
              color: '#fff',
              border: 'none',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner({ tone, text }: { tone: 'reconnecting' | 'error'; text: string }) {
  const palette =
    tone === 'reconnecting'
      ? { background: '#FDF3E6', border: '#F0DFC4', color: '#8A6412' }
      : { background: '#FBEAEA', border: '#EFCFCF', color: '#B32B2B' };

  return (
    <div
      role="status"
      style={{
        background: palette.background,
        borderBottom: `1px solid ${palette.border}`,
        borderRadius: '20px 20px 0 0',
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: `2.5px solid ${palette.color}55`,
          borderTopColor: palette.color,
          display: 'inline-block',
          flex: '0 0 auto',
        }}
        className="banhao-board-spin"
      />
      <div style={{ fontSize: 14, fontWeight: 700, color: palette.color }}>{text}</div>
    </div>
  );
}

/**
 * `● เชื่อมต่ออยู่` / `● กำลังเชื่อมต่อใหม่`, the bell, and `ออเดอร์วันนี้ N` —
 * design §01/§02's board-panel header, minus the restaurant identity block
 * `AppShell` already renders. Pure presentation: every value it shows comes
 * from `useOrderAlerts`'s return and `isDegraded(realtimeStatus)`, both
 * computed by the caller.
 */
/**
 * M-13. The board header's mode pill and its 1-2 actions — added into the
 * existing M-2.6/M-03 header bar, not a new panel (seams table: "The mode
 * control is added into it, not pla[ced elsewhere]"). Pure presentation, same
 * as the rest of this bar: every value comes from `useAvailability`'s
 * server-confirmed state (AV-D04 — never an optimistic mode), and every
 * action is a callback the caller owns.
 */
function AvailabilityPill({
  state,
  onSetBusy,
  onSetPaused,
  onResume,
}: {
  state: import('../hooks/useAvailability').AvailabilityState;
  onSetBusy: () => void;
  onSetPaused: () => void;
  onResume: () => void;
}) {
  if (state.status !== 'ready') return null;

  const { mode } = state;
  const palette =
    mode === 'PAUSED'
      ? { bg: '#FBEAEA', border: '#F0C9C9', dot: '#B23030', fg: '#B23030', label: 'หยุดรับออเดอร์ชั่วคราว' }
      : mode === 'BUSY'
        ? { bg: '#FDF3E6', border: '#F0DFC4', dot: '#8A6A3A', fg: '#8A6A3A', label: 'กำลังยุ่ง' }
        : { bg: '#F3FAF6', border: '#CDE7DB', dot: '#0A6B49', fg: '#0A6B49', label: 'เปิดปกติ' };

  return (
    <>
      <div
        role="status"
        data-testid="availability-pill"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '0 14px',
          borderRadius: 12,
          border: `1px solid ${palette.border}`,
          background: palette.bg,
          fontSize: 13.5,
          fontWeight: 600,
          color: palette.fg,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: palette.dot }} aria-hidden />
        {palette.label}
        {mode === 'BUSY' && state.busyPrepMinutes !== null ? ` · ${state.busyPrepMinutes} นาที` : null}
      </div>

      {mode === 'PAUSED' ? (
        <button
          type="button"
          data-testid="availability-action-resume"
          onClick={onResume}
          style={availabilityActionButtonStyle}
        >
          เปิดรับออเดอร์
        </button>
      ) : (
        <>
          <button
            type="button"
            data-testid="availability-action-busy"
            onClick={onSetBusy}
            style={availabilityActionButtonStyle}
          >
            เปลี่ยนเป็น กำลังยุ่ง
          </button>
          <button
            type="button"
            data-testid="availability-action-pause"
            onClick={onSetPaused}
            style={{ ...availabilityActionButtonStyle, borderColor: '#E0AFAF', color: '#B23030' }}
          >
            หยุดรับออเดอร์
          </button>
        </>
      )}
    </>
  );
}

const availabilityActionButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 44,
  padding: '0 16px',
  borderRadius: 12,
  border: '1px solid #E9E0D5',
  background: '#fff',
  fontSize: 13.5,
  fontWeight: 600,
  color: '#5A4E42',
  cursor: 'pointer',
};

function BoardHeaderBar({
  degraded,
  soundEnabled,
  audioBlocked,
  todayCount,
  onToggleSound,
  availability,
  onSetBusy,
  onSetPaused,
  onResume,
}: {
  degraded: boolean;
  soundEnabled: boolean;
  audioBlocked: boolean;
  todayCount: number;
  onToggleSound: () => void;
  availability: import('../hooks/useAvailability').AvailabilityState;
  onSetBusy: () => void;
  onSetPaused: () => void;
  onResume: () => void;
}) {
  const pillColor = degraded ? '#B98418' : '#0F8B5F';
  const pillLabel = degraded ? 'กำลังเชื่อมต่อใหม่' : 'เชื่อมต่ออยู่';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        flexWrap: 'wrap',
        padding: '12px 16px',
        marginBottom: 12,
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #EAE1D6',
      }}
    >
      <AvailabilityPill state={availability} onSetBusy={onSetBusy} onSetPaused={onSetPaused} onResume={onResume} />

      <div style={{ width: 1, alignSelf: 'stretch', background: '#EAE1D6' }} aria-hidden />

      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '0 14px',
          borderRadius: 12,
          border: '1px solid #E9E0D5',
          fontSize: 13.5,
          fontWeight: 600,
          color: '#5A4E42',
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: pillColor }} aria-hidden />
        {pillLabel}
      </div>

      <button
        type="button"
        onClick={onToggleSound}
        aria-pressed={soundEnabled}
        aria-label={
          audioBlocked && soundEnabled
            ? 'เสียงแจ้งเตือน · เบราว์เซอร์บล็อกเสียงไว้ · กดเพื่อลองใหม่'
            : `เสียงแจ้งเตือน · ${soundEnabled ? 'เปิด' : 'ปิด'}`
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 44,
          padding: '0 16px',
          borderRadius: 12,
          border: audioBlocked && soundEnabled ? '1px solid #F0C4C4' : '1px solid #E9E0D5',
          background: audioBlocked && soundEnabled ? '#FBEAEA' : 'none',
          fontSize: 13.5,
          fontWeight: 600,
          color: '#1F1A16',
          cursor: 'pointer',
        }}
      >
        🔔 เสียงแจ้งเตือน · {soundEnabled ? (audioBlocked ? 'บล็อกอยู่' : 'เปิด') : 'ปิด'}
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 44,
          padding: '0 16px',
          borderRadius: 12,
          border: '1px solid #E9E0D5',
          fontSize: 13.5,
          fontWeight: 600,
          color: '#5A4E42',
        }}
      >
        ออเดอร์วันนี้ {todayCount}
      </div>
    </div>
  );
}

export interface OrderBoardProps {
  restaurantId: string | null;
}

export function OrderBoard({ restaurantId }: OrderBoardProps) {
  const { orders, loading, error, realtimeStatus, refetch } = useOrderBoard(restaurantId);
  // M-2.7. Per-card, never global: `isPending`/`errorFor` are asked about one
  // order at a time, so a command on one card leaves every other card fully
  // interactive and never draws a board-wide overlay.
  const actions = useOrderActions();
  // M-13. Independent of `actions` — availability is a restaurant-level
  // mode, not a per-order command, and reuses this hook's own server-read
  // state exactly as `actions` reuses none of `useOrderBoard`'s.
  const availability = useAvailability(restaurantId);
  const [availabilityDialogMode, setAvailabilityDialogMode] = useState<AvailabilityDialogMode>(null);
  const [trayExpanded, setTrayExpanded] = useState(false);
  // Read once per render — not a ticking clock. See the module doc comment.
  const now = Date.now();

  const grouped = groupOrdersByColumn(orders);
  const hasAnyOrders = orders.length > 0;
  const degraded = isDegraded(realtimeStatus);

  // M-03. Reuses this component's own `orders`/`now` — no second Realtime
  // subscription, no second fetch. See the module doc comment.
  const alerts = useOrderAlerts(orders, now);

  // M-04. See the module doc comment for why `selectedOrder` is a lookup,
  // never a second piece of stored order state.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const selectedOrder = selectedOrderId ? (orders.find((o) => o.id === selectedOrderId) ?? null) : null;

  // M-05. Same lookup discipline as M-04's, for the same reason: the dialog
  // must read the live row so a Realtime change reaches it.
  const [acceptOrderId, setAcceptOrderId] = useState<string | null>(null);
  const acceptOrder = acceptOrderId ? (orders.find((o) => o.id === acceptOrderId) ?? null) : null;

  /** The element that opened the overlay — focus returns here on close (design §06 / M-05 §07). */
  const openerRef = useRef<HTMLElement | null>(null);
  /** Fallback focus target when the opener is gone (its order left the board via a restaurant switch). */
  const boardContainerRef = useRef<HTMLDivElement | null>(null);

  /** Focus return, shared by both overlays — only one is ever open at a time. */
  const returnFocus = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && document.contains(opener)) {
      opener.focus();
    } else {
      boardContainerRef.current?.focus();
    }
  }, []);

  const handleOpenDetail = useCallback((order: MerchantOrderSummary) => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Opening M-04 must not create an M-05 confirmation state, and vice
    // versa — never two scrims, never two focus traps.
    setAcceptOrderId(null);
    setSelectedOrderId(order.id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedOrderId(null);
    returnFocus();
  }, [returnFocus]);

  /**
   * M05-D02 — `รับออเดอร์` opens the dialog; every other command is issued
   * straight away, unchanged. This is the only behavioural change to the
   * card's action, and the card itself is untouched.
   */
  const handleCardAction = useCallback(
    (order: MerchantOrderSummary, command: OrderActionCommand) => {
      if (command !== 'accept') {
        actions.runAction(order, { command });
        return;
      }
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSelectedOrderId(null);
      setAcceptOrderId(order.id);
    },
    [actions],
  );

  const handleCloseAccept = useCallback(() => {
    setAcceptOrderId(null);
    returnFocus();
  }, [returnFocus]);

  /**
   * M-13. Opening either availability dialog closes the M-04/M-05 overlays
   * first — never two scrims, never two focus traps, the same discipline
   * `handleOpenDetail`/`handleCardAction` already hold for each other.
   */
  const handleOpenBusyDialog = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedOrderId(null);
    setAcceptOrderId(null);
    setAvailabilityDialogMode('BUSY');
  }, []);

  const handleOpenPauseDialog = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedOrderId(null);
    setAcceptOrderId(null);
    setAvailabilityDialogMode('PAUSE');
  }, []);

  const handleCloseAvailabilityDialog = useCallback(() => {
    setAvailabilityDialogMode(null);
    returnFocus();
  }, [returnFocus]);

  // Closes only on success — a failure leaves the dialog open with its own
  // inline error (`availability.saveState`), the same posture
  // `AcceptConfirmDialog` holds for a failed accept.
  const handleConfirmBusy = useCallback(
    (busyPrepMinutes: number) => {
      void availability.setBusy(busyPrepMinutes).then((succeeded) => {
        if (!succeeded) return;
        setAvailabilityDialogMode(null);
        returnFocus();
      });
    },
    [availability, returnFocus],
  );

  const handleConfirmPause = useCallback(() => {
    void availability.setPaused().then((succeeded) => {
      if (!succeeded) return;
      setAvailabilityDialogMode(null);
      returnFocus();
    });
  }, [availability, returnFocus]);

  // AV-T2/AV-T5 — Busy/Paused -> Normal is "One tap", no confirmation
  // dialog: the design states this explicitly for both resume transitions,
  // unlike Normal -> Paused, which requires one because it stops revenue.
  const handleResumeNormal = useCallback(() => {
    void availability.setNormal();
  }, [availability]);

  const handleConfirmAccept = useCallback(
    (order: MerchantOrderSummary, prepMinutes: number) => {
      // Fire and forget. The dialog is NOT closed here: HTTP success is not
      // the fact the merchant is waiting on, and the effect below closes it
      // when the order actually leaves PAID (M05-D05).
      actions.runAction(order, { command: 'accept', prepMinutes });
    },
    [actions],
  );

  /**
   * The one thing that closes M-05 after a confirm: the order is no longer
   * `PAID`, which only the board — i.e. Realtime, or an authoritative
   * re-read — can make true. No timer, no polling, no mutation response.
   *
   * An order that leaves the board entirely (restaurant switch) resolves
   * `acceptOrder` to `null` and is handled by the `restaurantId` effect
   * below, which clears both overlays.
   */
  useEffect(() => {
    if (acceptOrder && acceptOrder.state !== 'PAID') {
      setAcceptOrderId(null);
      returnFocus();
    }
  }, [acceptOrder, returnFocus]);

  // A restaurant switch is the only way a selected order can leave board
  // scope (orders cannot be deleted) — close the overlays explicitly rather
  // than relying solely on the lookups resolving to `null`, so focus is
  // deliberately returned to the board instead of being left wherever it was.
  useEffect(() => {
    setSelectedOrderId(null);
    setAcceptOrderId(null);
    setAvailabilityDialogMode(null);
    openerRef.current = null;
  }, [restaurantId]);

  // Body scroll is locked while any overlay is open, released on close or
  // unmount (design §04 "SCROLL": "the board behind it does not [scroll]").
  useEffect(() => {
    if (!selectedOrderId && !acceptOrderId && !availabilityDialogMode) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [selectedOrderId, acceptOrderId, availabilityDialogMode]);

  return (
    <div ref={boardContainerRef} tabIndex={-1} style={{ position: 'relative', outline: 'none' }}>
      <style>{`
        .banhao-board-skeleton-block {
          background: linear-gradient(90deg, #F4EDE3 25%, #FAF5EE 50%, #F4EDE3 75%);
          background-size: 320px 100%;
          animation: banhao-board-shimmer 1.3s linear infinite;
        }
        @keyframes banhao-board-shimmer { 0% { background-position: -320px 0; } 100% { background-position: 320px 0; } }
        .banhao-board-spin { animation: banhao-board-spin .9s linear infinite; }
        @keyframes banhao-board-spin { to { transform: rotate(360deg); } }
        .banhao-board-columns {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          padding: 20px;
          align-items: start;
        }
        .banhao-board-ready-toggle { display: none; }
        .banhao-board-ready-body { display: flex; flex-direction: column; gap: 12px; padding: 14px; }
        .banhao-order-action-spinner { animation: banhao-board-spin .9s linear infinite; }
        @media (max-width: 1024px) {
          .banhao-board-columns { grid-template-columns: repeat(2, 1fr); }
          /*
            Design §05 (SPECIFIED): "Touch targets rise to 56px throughout"
            at the 768–1024px tablet breakpoint, matching the design's own
            tablet card markup (56px) against its desktop board markup (52px).
            Carried as a custom property rather than a height rule because
            OrderCard sets its height inline, and an inline style wins over a
            stylesheet declaration — the variable is the one channel that can
            reach it. Cards rendered outside this board keep the 52px fallback.

            Note for review: the design is internally inconsistent about the
            desktop value — §01 anatomy and the §06 accessibility list both say
            56px on desktop too, while the §02 desktop board markup renders
            52px. This follows the markup, which is what M-2.6 implemented and
            what was visually verified. Resolving that is a design question,
            not an M-2.7 decision, and is reported rather than settled here.
          */
          .banhao-board-columns { --banhao-action-height: 56px; }
          .banhao-board-column--ready {
            grid-column: 1 / -1;
            border-radius: 18px;
            box-shadow: 0 -8px 30px rgba(31,26,22,.10);
          }
          .banhao-board-ready-toggle { display: flex; }
          .banhao-board-ready-body { display: none; flex-direction: row; overflow-x: auto; }
          .banhao-board-ready-body.is-expanded { display: flex; }
        }
      `}</style>

      <BoardHeaderBar
        degraded={degraded}
        soundEnabled={alerts.soundEnabled}
        audioBlocked={alerts.audioBlocked}
        todayCount={alerts.todayCount}
        onToggleSound={alerts.toggleSound}
        availability={availability.state}
        onSetBusy={handleOpenBusyDialog}
        onSetPaused={handleOpenPauseDialog}
        onResume={handleResumeNormal}
      />

      {loading ? (
        <div style={{ borderRadius: 20, border: '1px solid #E2D8CB', background: '#F6F0E7', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: 20 }}>
            {BOARD_COLUMNS.map((column) => (
              <BoardSkeletonColumn key={column.id} title={column.title} accent={COLUMN_ACCENT[column.id].accent} />
            ))}
          </div>
          <div
            style={{
              padding: '0 16px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              fontSize: 13,
              color: '#7A6E64',
            }}
          >
            <span
              className="banhao-board-spin"
              aria-hidden
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                border: '2.5px solid #E2D8CB',
                borderTopColor: '#E4572E',
                display: 'inline-block',
              }}
            />
            กำลังโหลดออเดอร์
          </div>
        </div>
      ) : error && !hasAnyOrders ? (
        <BoardError message={error} onRetry={refetch} />
      ) : (
        <div style={{ borderRadius: 20, border: '1px solid #E2D8CB', background: '#F6F0E7', overflow: 'hidden' }}>
          {degraded ? (
            <ConnectionBanner tone="reconnecting" text="การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่" />
          ) : null}
          {error && hasAnyOrders ? (
            <ConnectionBanner tone="error" text={`อัปเดตล่าสุดล้มเหลว · ${error}`} />
          ) : null}

          <div className="banhao-board-columns">
            {BOARD_COLUMNS.map((column) => {
              const columnOrders = grouped[column.id];
              const { accent, badgeBackground, badgeColor } = COLUMN_ACCENT[column.id];
              const isReady = column.id === 'READY';

              return (
                <div
                  key={column.id}
                  className={isReady ? 'banhao-board-column--ready' : undefined}
                  style={{ borderRadius: 18, background: '#fff', border: '1px solid #EAE1D6', overflow: 'hidden' }}
                >
                  <ColumnHeader
                    title={column.title}
                    statesLabel={column.statesLabel}
                    count={columnOrders.length}
                    accent={accent}
                    badgeBackground={badgeBackground}
                    badgeColor={badgeColor}
                  />

                  {/*
                    READY is the one column with no merchant action
                    (UX-SPEC §6), so at the 768–1024px tablet breakpoint it
                    becomes a collapsed-by-default tray instead of a plain
                    column — SPECIFIED, design §05. This toggle row is
                    CSS-hidden at desktop width (`.banhao-board-ready-toggle`)
                    and is the tablet tray's summary bar; there is exactly
                    ONE body element below holding this column's cards
                    (`.banhao-board-ready-body`), shown unconditionally at
                    desktop width and gated by `trayExpanded` only at tablet
                    width — never a second, duplicate render of the same
                    orders for the two breakpoints.
                  */}
                  {isReady ? (
                    <button
                      type="button"
                      data-testid="ready-tray-toggle"
                      className="banhao-board-ready-toggle"
                      onClick={() => setTrayExpanded((expanded) => !expanded)}
                      aria-expanded={trayExpanded}
                      aria-label={`${column.title} — ${trayExpanded ? 'ปิดรายการ' : 'เปิดดูรายการ'}`}
                      style={{
                        width: '100%',
                        alignItems: 'center',
                        gap: 12,
                        padding: '0 16px',
                        height: 48,
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid #F1E9DE',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#7A6E64' }}>รอไรเดอร์มารับ · ไม่ต้องกดอะไร</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{trayExpanded ? 'ปิด ▼' : 'เปิดดู ▲'}</span>
                    </button>
                  ) : null}

                  <div
                    className={isReady ? `banhao-board-ready-body${trayExpanded ? ' is-expanded' : ''}` : undefined}
                    style={isReady ? undefined : { display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}
                  >
                    {columnOrders.length === 0 ? (
                      <div style={{ padding: '34px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#7A6E64', lineHeight: 1.6 }}>
                          {column.emptyCopy}
                        </div>
                      </div>
                    ) : (
                      columnOrders.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          now={now}
                          onAction={handleCardAction}
                          pending={actions.isPending(order)}
                          actionError={actions.errorFor(order)}
                          onOpenDetail={handleOpenDetail}
                          isSelected={order.id === selectedOrderId}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <OrderDetailPanel order={selectedOrder} now={now} onClose={handleCloseDetail} />

      <AcceptConfirmDialog
        order={acceptOrder}
        now={now}
        pending={acceptOrder ? actions.isPending(acceptOrder) : false}
        failure={acceptOrder ? actions.failureFor(acceptOrder) : null}
        onConfirm={handleConfirmAccept}
        onClose={handleCloseAccept}
      />

      <AvailabilityDialog
        mode={availabilityDialogMode}
        saveState={availability.saveState}
        onConfirmBusy={handleConfirmBusy}
        onConfirmPause={handleConfirmPause}
        onClose={handleCloseAvailabilityDialog}
      />
    </div>
  );
}
