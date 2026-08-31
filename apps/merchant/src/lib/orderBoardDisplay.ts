/**
 * Presentation-only derivations for the Order Board (M-2.6).
 *
 * Every function here is pure: `MerchantOrderSummary` + `Date.now()` in,
 * a display string/tone out. Nothing here calls the repository, Realtime,
 * or any mutation endpoint — this file exists precisely so `OrderBoard.tsx`
 * and `OrderCard.tsx` do not have to inline that logic themselves.
 *
 * Source of truth: `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html`
 * (visual/copy) and `docs/design/BANHAO-UX-SPEC-V1.md` §6 (behaviour). Every
 * literal Thai string below is transcribed from one of those two documents,
 * not authored — same discipline `apps/customer/src/lib/orderDisplay.ts`
 * already established for the Customer App.
 *
 * ## No timers
 *
 * M-2.6's own scope rules forbid `setInterval`/recurring timers in the UI,
 * the same as M-2.5's data layer. Every value below is therefore computed
 * from a `nowMs` the caller passes in (normally `Date.now()` at render
 * time), not from a ticking clock this module owns. A countdown or elapsed
 * label is exactly correct at the moment it renders and stays on screen
 * until the next render — which an active board gets often, from Realtime
 * traffic, `refetch()`, or user interaction — rather than smoothly counting
 * down every second. This is a deliberate fidelity trade-off against the
 * design's "ticks client-side" language, made to honour the stricter,
 * explicitly repeated "no timers" rule; see the M-2.6 final report.
 */

import type { Satang } from '@banhao/types';
import type { MerchantOrderSummary, OrderState } from '../domain/order';

// ---------------------------------------------------------------------------
// Column membership — docs/design §06 "State → column mapping" (SPECIFIED)
// ---------------------------------------------------------------------------

export type BoardColumnId = 'NEW' | 'PREPARING' | 'READY';

/**
 * `null` for every state the design's mapping table marks "Removed from the
 * board" — `PICKED_UP`, `DELIVERING`, `DELIVERED`, `CANCELLED`, and (by the
 * same "fixed membership" rule, §07) every other state the nine/five-state
 * vocabulary allows. Three columns, fixed membership, no fourth column.
 */
export function boardColumnForState(state: OrderState): BoardColumnId | null {
  switch (state) {
    case 'PAID':
      return 'NEW';
    case 'MERCHANT_ACCEPTED':
    case 'PREPARING':
      return 'PREPARING';
    case 'READY_FOR_PICKUP':
      return 'READY';
    default:
      return null;
  }
}

export interface BoardColumnDef {
  id: BoardColumnId;
  /** Column header — design §02 `columns[].title`. */
  title: string;
  /** Column-specific empty copy — design §04 `emptyCols[].empty`. Column 1's is pinned exactly by the M-2.6 brief. */
  emptyCopy: string;
  /** The mono state-code line in the column header — design §02 `columns[].states`. */
  statesLabel: string;
}

export const BOARD_COLUMNS: readonly BoardColumnDef[] = [
  { id: 'NEW', title: 'ใหม่ · รอตอบรับ', emptyCopy: 'ยังไม่มีออเดอร์ใหม่', statesLabel: 'PAID' },
  {
    id: 'PREPARING',
    title: 'กำลังทำ',
    emptyCopy: 'ไม่มีออเดอร์ที่กำลังทำ',
    statesLabel: 'MERCHANT_ACCEPTED · PREPARING',
  },
  { id: 'READY', title: 'พร้อมให้ไรเดอร์รับ', emptyCopy: 'ไม่มีออเดอร์รอไรเดอร์', statesLabel: 'READY_FOR_PICKUP' },
];

/**
 * Buckets the reconciled board into its three columns. `useOrderBoard`
 * already dedupes by id (M-2.5) and this does not re-sort within a column —
 * it preserves `orders`' own `placedAt DESC` ordering, per M-2.5's §15 and
 * the design's own "sort is oldest-first inside every column" note being a
 * DESIGN CHOICE, not something this data-layer-adjacent function decides.
 */
export function groupOrdersByColumn(
  orders: readonly MerchantOrderSummary[],
): Record<BoardColumnId, MerchantOrderSummary[]> {
  const grouped: Record<BoardColumnId, MerchantOrderSummary[]> = { NEW: [], PREPARING: [], READY: [] };
  for (const order of orders) {
    const column = boardColumnForState(order.state);
    if (column) grouped[column].push(order);
  }
  return grouped;
}

// ---------------------------------------------------------------------------
// Money — design §01 anatomy: "Rendered ฿ with two decimals, Mono so
// columns of totals align vertically." A merchant-local formatter because
// cross-app imports are forbidden (STRICT ARCHITECTURE RULES) — this is not
// a new money representation, just the same satang→บาท conversion
// `apps/customer/src/lib/money.ts` performs, with the decimal-count choice
// this board's own design specifies instead of that screen's.
// ---------------------------------------------------------------------------

export function formatBahtFixed(satang: Satang): string {
  return `฿${(satang / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Time — Asia/Bangkok clock + elapsed, computed from `nowMs`, never ticking.
// ---------------------------------------------------------------------------

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/** `11:42` — Bangkok wall-clock HH:MM. `null` for an unparseable timestamp. */
export function formatClockTime(isoTimestamp: string): string | null {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // hour12:false renders midnight as "24" in some ICU builds — normalise, the
  // same quirk apps/customer/src/lib/orderDisplay.ts's bangkokDateParts documents.
  const hour = String(Number.parseInt(lookup('hour'), 10) % 24).padStart(2, '0');
  const minute = lookup('minute');
  return `${hour}:${minute}`;
}

/** Seconds since `fromIso`, clamped to zero. Never negative, never NaN. */
export function elapsedSeconds(fromIso: string, nowMs: number): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 1000));
}

/**
 * `46 วิ.` / `2 นาที` — the short elapsed form design §02's actual board
 * fixture (`c1`) uses, distinct from the fuller `... นาทีที่แล้ว` wording the
 * §01/§03 explainer panels use for the same fact. The real board (§02,
 * "STATE A — DESKTOP BOARD") is the implementation target, so its shorter
 * form is what this renders.
 */
export function formatElapsedShort(seconds: number): string {
  if (seconds < 60) return `${seconds} วิ.`;
  return `${Math.floor(seconds / 60)} นาที`;
}

/** `12 วินาที` — arrival banner wording (design §03 State C), spelled out, no "ago" suffix. */
export function formatArrivalSeconds(seconds: number): string {
  return `${seconds} วินาที`;
}

// ---------------------------------------------------------------------------
// Accept-window countdown — docs/ORDER_LIFECYCLE.md §6 / docs/BUSINESS_RULES.md
// §6: "ACCEPTED — merchant accept window 3 minutes." The WINDOW LENGTH is an
// accepted business number; only the EXPIRY BEHAVIOUR is open (BQ-013). This
// mirrors the existing precedent of `ACCEPT_WINDOW_SECONDS = 60` in
// apps/api/src/modules/rider/dispatch-policy.ts for the rider's DEC-037
// window — a named constant for an already-decided figure, used here purely
// for a client-side display countdown. Per the design's own relationship
// table: "ticks client-side, authority stays server-side" — this NEVER
// drives a transition, a rejection, or any write. It only decides what a
// card's countdown chip says.
// ---------------------------------------------------------------------------

export const MERCHANT_ACCEPT_WINDOW_SECONDS = 180;

export type CountdownPhase = 'normal' | 'warning' | 'expired';

export interface AcceptWindowState {
  remainingSeconds: number;
  phase: CountdownPhase;
}

/**
 * `remainingSeconds` never goes negative; `phase` is `'warning'` in the
 * final third of the window and `'expired'` at zero — exactly the design's
 * "turns warning-coloured in its final third" / "at zero shows หมดเวลาตอบรับ"
 * rule (UX-SPEC §6).
 */
export function acceptWindowState(placedAtIso: string, nowMs: number): AcceptWindowState {
  const elapsed = elapsedSeconds(placedAtIso, nowMs);
  const remainingSeconds = Math.max(0, MERCHANT_ACCEPT_WINDOW_SECONDS - elapsed);
  const phase: CountdownPhase =
    remainingSeconds <= 0 ? 'expired' : remainingSeconds <= MERCHANT_ACCEPT_WINDOW_SECONDS / 3 ? 'warning' : 'normal';
  return { remainingSeconds, phase };
}

/** `2:14`, `0:38`, `0:00` — mm:ss, never negative, minutes unpadded (design §01 anatomy). */
export function formatCountdown(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The 30-second arrival window (design §03 State C: "Card inserts... ring
 * pulses for 30s, then settles"). Derived from `placedAt` alone — a
 * genuinely new order's `placedAt` is necessarily recent, so no separate
 * "this came from a Realtime INSERT" signal, extra state, or timer is
 * needed to know a card just arrived.
 */
export function isRecentArrival(placedAtIso: string, nowMs: number): boolean {
  return elapsedSeconds(placedAtIso, nowMs) < 30;
}

// ---------------------------------------------------------------------------
// Per-card presentation — one function per column, matching design §01/§02
// exactly. `null` for a state with no board presentation (defensive; every
// caller has already filtered via `boardColumnForState`).
// ---------------------------------------------------------------------------

export type ChipTone = 'new' | 'warning' | 'expired' | 'cooking' | 'ready';
export type TimerTone = 'ok' | 'warning' | 'expired' | 'neutral';
/** `'button'` — a real, disabled `<button>` (M-3/M-4/M-5 will wire it). `'status'` — the design's non-tappable waiting strip, not a button at all. */
export type ActionKind = 'button' | 'status';
export type ActionStyle = 'primary' | 'dark' | 'off' | 'waiting';

export interface OrderCardPresentation {
  chipLabel: string;
  chipTone: ChipTone;
  /** The state code shown next to the chip, e.g. `PAID` — design §01 anatomy: "never depends on colour alone." */
  stateCode: OrderState;
  timerLabel: string;
  timerTone: TimerTone;
  timeLine: string;
  actionLabel: string;
  actionKind: ActionKind;
  actionStyle: ActionStyle;
  isNewArrival: boolean;
  isExpired: boolean;
}

function paidCardPresentation(order: MerchantOrderSummary, nowMs: number): OrderCardPresentation {
  const { remainingSeconds, phase } = acceptWindowState(order.placedAt, nowMs);
  const clock = formatClockTime(order.placedAt) ?? '--:--';
  const elapsed = formatElapsedShort(elapsedSeconds(order.placedAt, nowMs));

  const byPhase: Record<CountdownPhase, Pick<OrderCardPresentation, 'chipLabel' | 'chipTone' | 'timerTone' | 'actionLabel' | 'actionStyle'>> = {
    normal: { chipLabel: 'ใหม่ · รอตอบรับ', chipTone: 'new', timerTone: 'ok', actionLabel: 'รับออเดอร์', actionStyle: 'primary' },
    warning: { chipLabel: 'ใกล้หมดเวลา', chipTone: 'warning', timerTone: 'warning', actionLabel: 'รับออเดอร์', actionStyle: 'primary' },
    expired: {
      chipLabel: 'หมดเวลาตอบรับ',
      chipTone: 'expired',
      timerTone: 'expired',
      actionLabel: 'ติดต่อผู้ดูแลระบบ',
      actionStyle: 'off',
    },
  };

  return {
    ...byPhase[phase],
    stateCode: 'PAID',
    timerLabel: formatCountdown(remainingSeconds),
    timeLine: `${clock} · ${elapsed}`,
    actionKind: 'button',
    isNewArrival: isRecentArrival(order.placedAt, nowMs),
    isExpired: phase === 'expired',
  };
}

function merchantAcceptedCardPresentation(order: MerchantOrderSummary): OrderCardPresentation {
  const clock = order.acceptedAt ? formatClockTime(order.acceptedAt) : null;
  return {
    chipLabel: 'รับแล้ว · ยังไม่เริ่มทำ',
    chipTone: 'cooking',
    stateCode: 'MERCHANT_ACCEPTED',
    timerLabel: 'รับแล้ว',
    timerTone: 'neutral',
    timeLine: clock ? `รับเมื่อ ${clock}` : 'รับแล้ว',
    actionLabel: 'เริ่มทำอาหาร',
    actionKind: 'button',
    actionStyle: 'dark',
    isNewArrival: false,
    isExpired: false,
  };
}

function preparingCardPresentation(order: MerchantOrderSummary, nowMs: number): OrderCardPresentation {
  const clock = order.acceptedAt ? formatClockTime(order.acceptedAt) : null;
  const cookingMinutes = order.acceptedAt ? Math.floor(elapsedSeconds(order.acceptedAt, nowMs) / 60) : 0;
  return {
    chipLabel: 'กำลังทำอาหาร',
    chipTone: 'cooking',
    stateCode: 'PREPARING',
    timerLabel: `${cookingMinutes} นาที`,
    timerTone: 'neutral',
    timeLine: clock ? `รับเมื่อ ${clock}` : 'กำลังทำอาหาร',
    actionLabel: 'อาหารพร้อม',
    actionKind: 'button',
    actionStyle: 'dark',
    isNewArrival: false,
    isExpired: false,
  };
}

function readyForPickupCardPresentation(order: MerchantOrderSummary, nowMs: number): OrderCardPresentation {
  const clock = order.readyAt ? formatClockTime(order.readyAt) : null;
  const waitingMinutes = order.readyAt ? Math.floor(elapsedSeconds(order.readyAt, nowMs) / 60) : 0;
  return {
    chipLabel: 'รอไรเดอร์มารับ',
    chipTone: 'ready',
    stateCode: 'READY_FOR_PICKUP',
    timerLabel: `${waitingMinutes} นาที`,
    timerTone: 'neutral',
    timeLine: clock ? `พร้อมเมื่อ ${clock}` : 'รอไรเดอร์มารับ',
    // Design §01 anatomy: "The waiting strip is a status, not a button — it
    // is not tappable." Same label reused for both the chip and the strip,
    // exactly as the design's own `variants`/`c3` fixtures do.
    actionLabel: 'รอไรเดอร์มารับ',
    actionKind: 'status',
    actionStyle: 'waiting',
    isNewArrival: false,
    isExpired: false,
  };
}

/** `null` for any state `boardColumnForState` would also reject — this order does not belong on the board. */
export function presentOrderCard(order: MerchantOrderSummary, nowMs: number): OrderCardPresentation | null {
  switch (order.state) {
    case 'PAID':
      return paidCardPresentation(order, nowMs);
    case 'MERCHANT_ACCEPTED':
      return merchantAcceptedCardPresentation(order);
    case 'PREPARING':
      return preparingCardPresentation(order, nowMs);
    case 'READY_FOR_PICKUP':
      return readyForPickupCardPresentation(order, nowMs);
    default:
      return null;
  }
}
