'use client';

import type { MerchantOrderSummary } from '../domain/order';
import {
  formatBahtFixed,
  formatArrivalSeconds,
  elapsedSeconds,
  presentOrderCard,
  type ActionStyle,
  type ChipTone,
  type OrderActionCommand,
  type TimerTone,
} from '../lib/orderBoardDisplay';

/**
 * One order-board card (M-2.6 visuals, M-2.7 behaviour) — design
 * `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html` §01/§02.
 *
 * Reads only `MerchantOrderSummary` (M-2.2) plus `now` (the render-time
 * clock the parent board passes down, never a timer this component owns).
 * `presentOrderCard` (`../lib/orderBoardDisplay`) does every derivation —
 * this component is rendering only. It holds no state of its own: `pending`
 * and `actionError` are props, owned by `useOrderActions` above it, so the
 * card stays a pure function of the board's state.
 *
 * ## The primary action, and what happens when nobody is listening
 *
 * M-2.7 wires the three merchant commands. The button is enabled only when
 * this card genuinely has a command to issue **and** a handler was supplied:
 *
 * - `onAction` omitted → the button renders disabled. This is the card's
 *   contract, not a leftover: a card with no handler has nothing to invoke,
 *   and rendering it live would be an affordance that silently does nothing.
 *   M-2.6's tests exercise exactly this shape and continue to pass unchanged.
 * - `actionCommand === null` → disabled regardless of the handler. Two cards
 *   do this, both deliberately: an **expired** `PAID` card, whose
 *   `ติดต่อผู้ดูแลระบบ` action has no endpoint because BQ-013 is still `OPEN`
 *   (the design's §07 log renders it disabled "because the expiry rule is
 *   undecided... not because rejection occurred"), and `READY_FOR_PICKUP`,
 *   which is not a `<button>` at all.
 * - `pending` → disabled while the command is unresolved, which is what stops
 *   a double press. See `useOrderActions` for why "unresolved" outlasts the
 *   HTTP response.
 *
 * The `READY_FOR_PICKUP` column is different by design, not by this
 * component's choice: "The waiting strip is a status, not a button — it is
 * not tappable" (§01 anatomy). That one renders as a plain status region,
 * not a `<button>` at all — M-2.7 does not change this.
 *
 * `recipientPhoneSnapshot` is deliberately never read here — the design's
 * §07 decision log marks phone-on-the-card-face "NOT DECIDED... treated as
 * an M-04 order-detail concern."
 *
 * ## Opening the detail panel (M-04)
 *
 * `onOpenDetail`, wrapping the informational rows only — order number,
 * chip/code, recipient name, total/time — never the action button below
 * them, which stays a sibling (design M04-D10: "no nested-button markup and
 * no propagation to stop in the first place"). Omitted → those rows render
 * as a plain (non-interactive) wrapper, exactly as before M-04, so every
 * existing test that never passes it keeps its "zero buttons" assertions
 * (e.g. `READY_FOR_PICKUP`'s status-only render) true unchanged.
 */

/** Exported so `OrderDetailPanel` (M-04) renders "the same chip vocabulary as the card" (design §01/§02) rather than a second copy of it. */
export const CHIP_STYLES: Record<ChipTone, { background: string; color: string }> = {
  new: { background: '#FDEEE7', color: '#C2431F' },
  warning: { background: '#FDF3E6', color: '#8A6412' },
  expired: { background: '#FBEAEA', color: '#B32B2B' },
  cooking: { background: '#FBF1DC', color: '#9A7810' },
  ready: { background: '#EAF6EF', color: '#0F8B5F' },
};

const TIMER_STYLES: Record<TimerTone, { background: string; color: string }> = {
  ok: { background: '#EAF6EF', color: '#0F8B5F' },
  warning: { background: '#FDF3E6', color: '#B98418' },
  expired: { background: '#FBEAEA', color: '#D93A3A' },
  neutral: { background: '#F2EBE1', color: '#8B7F73' },
};

const ACTION_STYLES: Record<ActionStyle, { background: string; color: string; border?: string }> = {
  primary: { background: '#E4572E', color: '#fff' },
  dark: { background: '#1F1A16', color: '#fff' },
  off: { background: '#EFE7DC', color: '#B0A294' },
  waiting: { background: '#F7F2EA', color: '#7A6E64', border: '1px dashed #DDD2C4' },
};

const CARD_BORDER = '1px solid #EAE1D6';
const EXPIRED_BORDER = '1px solid #EFCFCF';
const NEW_ARRIVAL_BORDER = '2px solid #E4572E';

export interface OrderCardProps {
  order: MerchantOrderSummary;
  /** Render-time clock, in ms — see the module doc comment on why this is not a timer this component owns. */
  now: number;
  /** Issues this card's command. Omitted → the action renders disabled; see the module doc comment. */
  onAction?: (order: MerchantOrderSummary, command: OrderActionCommand) => void;
  /** True while a command for this card is unresolved. Owned by `useOrderActions`, never by this component. */
  pending?: boolean;
  /** Thai copy for this card's last failed command, or `null`/omitted when there is none. */
  actionError?: string | null;
  /** Opens this order's M-04 detail panel. Omitted → the informational rows render inert; see the module doc comment. */
  onOpenDetail?: (order: MerchantOrderSummary) => void;
  /** True while this card's detail panel is open — reuses the new-arrival ring rather than a second highlight (design §02 "SELECTED CARD"). */
  isSelected?: boolean;
}

export function OrderCard({
  order,
  now,
  onAction,
  pending = false,
  actionError = null,
  onOpenDetail,
  isSelected = false,
}: OrderCardProps) {
  const presentation = presentOrderCard(order, now);
  if (!presentation) return null;

  const chipStyle = CHIP_STYLES[presentation.chipTone];
  const timerStyle = TIMER_STYLES[presentation.timerTone];
  const actionStyle = ACTION_STYLES[presentation.actionStyle];

  const command = presentation.actionCommand;
  const actionable = command !== null && onAction !== undefined;
  const disabled = !actionable || pending;

  const cardBorder = presentation.isExpired
    ? EXPIRED_BORDER
    : presentation.isNewArrival || isSelected
      ? NEW_ARRIVAL_BORDER
      : CARD_BORDER;

  const infoContent = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 14, fontWeight: 600 }}>
          #{order.orderNumber}
        </div>
        <div
          aria-live="polite"
          style={{
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: 12.5,
            fontWeight: 600,
            padding: '4px 9px',
            borderRadius: 9,
            ...timerStyle,
          }}
        >
          {presentation.timerLabel}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 9px', borderRadius: 8, ...chipStyle }}>
          {presentation.chipLabel}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 10.5, color: '#A2968A' }}>
          {presentation.stateCode}
        </div>
      </div>

      <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.55 }}>{order.recipientNameSnapshot}</div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600 }}>
          {formatBahtFixed(order.grandTotalSatang)}
        </div>
        <div style={{ fontSize: 11.5, color: '#7A6E64' }}>{presentation.timeLine}</div>
      </div>
    </>
  );

  return (
    <div
      data-testid={`order-card-${order.id}`}
      data-state={order.state}
      style={{
        borderRadius: 16,
        background: '#fff',
        border: cardBorder,
        boxShadow: presentation.isNewArrival ? '0 4px 16px rgba(228,87,46,.14)' : undefined,
        overflow: 'hidden',
      }}
    >
      {presentation.isNewArrival ? (
        <div
          style={{
            background: '#E4572E',
            color: '#fff',
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} aria-hidden />
          ออเดอร์ใหม่ · เพิ่งเข้ามา {formatArrivalSeconds(elapsedSeconds(order.placedAt, now))}
        </div>
      ) : null}

      {presentation.isExpired ? (
        <div style={{ background: '#FBEAEA', color: '#B32B2B', padding: '9px 14px', fontSize: 12.5, fontWeight: 700 }}>
          หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ
        </div>
      ) : null}

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {onOpenDetail ? (
          <button
            type="button"
            data-testid={`order-card-open-${order.id}`}
            onClick={() => onOpenDetail(order)}
            aria-expanded={isSelected}
            aria-label={`เปิดรายละเอียด ออเดอร์ #${order.orderNumber}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              margin: 0,
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {infoContent}
          </button>
        ) : (
          <div data-testid={`order-card-open-${order.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {infoContent}
          </div>
        )}

        {/*
          Failure of this card's last command. `role="alert"` so a merchant
          who pressed the button and looked away is told, rather than having
          to notice a line of text appear. Sits above the action because the
          action is the retry — see `orderActionErrorMessage` for the copy's
          DESIGN CHOICE provenance.
        */}
        {actionError ? (
          <div
            role="alert"
            data-testid={`order-action-error-${order.id}`}
            style={{
              fontSize: 12.5,
              lineHeight: 1.6,
              color: '#B32B2B',
              background: '#FBEAEA',
              borderRadius: 10,
              padding: '8px 10px',
            }}
          >
            {actionError}
          </div>
        ) : null}

        {presentation.actionKind === 'button' ? (
          <button
            type="button"
            disabled={disabled}
            aria-busy={pending}
            // Only explain the disabling when it is *this card's* permanent
            // condition. A pending button is already announced by aria-busy,
            // and an unwired one is a harness/contract case, not something to
            // narrate to a merchant.
            aria-label={
              command === null ? `${presentation.actionLabel} — ยังไม่เปิดใช้งานในหน้านี้` : presentation.actionLabel
            }
            onClick={actionable && !pending ? () => onAction(order, command) : undefined}
            className="banhao-order-action"
            style={{
              // Tablet raises this to 56px via `--banhao-action-height`, set
              // by OrderBoard's media query. The literal here is the desktop
              // value and the standalone fallback — see OrderBoard.tsx.
              height: 'var(--banhao-action-height, 52px)',
              borderRadius: 13,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 15,
              fontWeight: 600,
              width: '100%',
              cursor: disabled ? 'not-allowed' : 'pointer',
              ...actionStyle,
            }}
          >
            {pending ? (
              <span
                aria-hidden
                className="banhao-order-action-spinner"
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: '50%',
                  border: '2.5px solid rgba(255,255,255,.35)',
                  borderTopColor: 'currentColor',
                  display: 'inline-block',
                  flex: '0 0 auto',
                }}
              />
            ) : null}
            {presentation.actionLabel}
          </button>
        ) : (
          <div
            role="status"
            style={{
              height: 'var(--banhao-action-height, 52px)',
              borderRadius: 13,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 600,
              width: '100%',
              ...actionStyle,
            }}
          >
            {presentation.actionLabel}
          </div>
        )}
      </div>
    </div>
  );
}
