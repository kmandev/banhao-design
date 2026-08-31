'use client';

import type { MerchantOrderSummary } from '../domain/order';
import {
  formatBahtFixed,
  formatArrivalSeconds,
  elapsedSeconds,
  presentOrderCard,
  type ActionStyle,
  type ChipTone,
  type TimerTone,
} from '../lib/orderBoardDisplay';

/**
 * One order-board card (M-2.6) — design
 * `docs/design/BANHAO M-2.6 Merchant Order Board.dc.html` §01/§02.
 *
 * Reads only `MerchantOrderSummary` (M-2.2) plus `now` (the render-time
 * clock the parent board passes down, never a timer this component owns).
 * `presentOrderCard` (`../lib/orderBoardDisplay`) does every derivation —
 * this component is rendering only.
 *
 * ## The primary action is a real, disabled control — never wired
 *
 * M-2.6 is the board UI, not the accept/start/ready mutations (M-3/M-4/M-5
 * own those). The button below is a semantic `<button>` with
 * `disabled` set and no `onClick` — visually it matches the design's
 * enabled styling exactly (colour is not conditioned on the HTML disabled
 * state), but it cannot be activated and performs nothing. This is the
 * safest reading of the M-2.6 brief's repeated "do not implement
 * accept/start/ready mutations": the affordance is rendered faithfully,
 * the mutation is not.
 *
 * The `READY_FOR_PICKUP` column is different by design, not by this
 * component's choice: "The waiting strip is a status, not a button — it is
 * not tappable" (§01 anatomy). That one renders as a plain status region,
 * not a `<button>` at all.
 *
 * `recipientPhoneSnapshot` is deliberately never read here — the design's
 * §07 decision log marks phone-on-the-card-face "NOT DECIDED... treated as
 * an M-04 order-detail concern."
 */

const CHIP_STYLES: Record<ChipTone, { background: string; color: string }> = {
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
}

export function OrderCard({ order, now }: OrderCardProps) {
  const presentation = presentOrderCard(order, now);
  if (!presentation) return null;

  const chipStyle = CHIP_STYLES[presentation.chipTone];
  const timerStyle = TIMER_STYLES[presentation.timerTone];
  const actionStyle = ACTION_STYLES[presentation.actionStyle];

  const cardBorder = presentation.isExpired
    ? EXPIRED_BORDER
    : presentation.isNewArrival
      ? NEW_ARRIVAL_BORDER
      : CARD_BORDER;

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

        {presentation.actionKind === 'button' ? (
          <button
            type="button"
            disabled
            aria-label={`${presentation.actionLabel} — ยังไม่เปิดใช้งานในหน้านี้`}
            style={{
              height: 52,
              borderRadius: 13,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
              fontWeight: 600,
              width: '100%',
              cursor: 'not-allowed',
              ...actionStyle,
            }}
          >
            {presentation.actionLabel}
          </button>
        ) : (
          <div
            role="status"
            style={{
              height: 52,
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
