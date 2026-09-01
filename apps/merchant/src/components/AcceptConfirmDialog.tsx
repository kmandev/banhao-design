'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MerchantOrderSummary } from '../domain/order';
import type { OrderActionFailure } from '../hooks/useOrderActions';
import { acceptWindowState, formatBahtFixed, formatCountdown } from '../lib/orderBoardDisplay';

/**
 * M-05 — the accept confirmation dialog, design
 * `docs/design/BANHAO M-05 Merchant Accept Confirmation.dc.html`.
 *
 * A modal that sits between the board card's `รับออเดอร์` press and the
 * existing accept command, for the sole purpose of making the merchant name a
 * preparation time first. It is not a screen and it is not the M-04 drawer:
 * the drawer is a reading surface a merchant leaves open while the board keeps
 * moving, and this is a two-second required answer under a 3-minute clock, so
 * it takes the smallest overlay that can own the keyboard (M05-D01). The
 * scrim, focus trap, Escape and focus-return behaviour are M-04's, reused
 * rather than reinvented.
 *
 * ## What this component does not decide
 *
 * - **It never closes itself on success.** `onConfirm` fires the command and
 *   this component learns nothing from it. The dialog closes when its order is
 *   no longer `PAID` — i.e. when Realtime says the order actually moved — and
 *   `OrderBoard` owns that observation (M05-D05/D06). There is no timer, no
 *   polling, no second subscription and no locally fabricated
 *   `MERCHANT_ACCEPTED` anywhere in this file.
 * - **It owns no clock.** `now` is the board's render-time clock, passed down
 *   exactly as `OrderDetailPanel` takes it. The accept-window strip renders
 *   `acceptWindowState(order.placedAt, now)` and adds no phase, no threshold
 *   and no behaviour of its own (M05-D08). The `≤15s` red treatment is
 *   emphasis inside the existing `warning` phase, not a fourth phase.
 * - **It writes no error vocabulary.** `failure.message` is
 *   `orderActionErrorMessage`'s output, rendered here instead of on the card.
 *
 * ## Expiry
 *
 * At `phase === 'expired'` the body is *replaced*, not disabled: with the
 * window closed there is nothing left to confirm, so the preset group and the
 * confirm button are removed and `ปิด` is the only control (M05-D10). An
 * accept already in flight is not cancelled client-side — the server's guarded
 * `WHERE state = 'PAID'` is the only authority on whether it lands, and
 * BQ-013 has defined no expiry rule for it to enforce.
 */

/** The five presets M-05 offers. A UI policy — the database allows any positive integer (M05-Q-01). */
export const PREP_MINUTE_PRESETS = [10, 20, 30, 45, 60] as const;

export interface AcceptConfirmDialogProps {
  /** The order being accepted, or `null` when the dialog is closed. */
  order: MerchantOrderSummary | null;
  /** Render-time clock, ms — from `OrderBoard`, never a timer this component owns. */
  now: number;
  /** True while this order's accept is unresolved (`useOrderActions.isPending`). */
  pending: boolean;
  /** This order's last failure, or `null` (`useOrderActions.failureFor`). */
  failure: OrderActionFailure | null;
  /** Issues the accept with the chosen prep time. Never told whether it worked. */
  onConfirm: (order: MerchantOrderSummary, prepMinutes: number) => void;
  /** Cancel, Escape, scrim, close, `ปิด`. Ignored by this component while `pending`. */
  onClose: () => void;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/** Green > 60s, amber ≤ 60s, red ≤ 15s, red at 0 — design §06. */
function stripPalette(remainingSeconds: number, expired: boolean) {
  if (expired) return { background: '#FBEAEA', color: '#B32B2B', border: '#EFCFCF' };
  if (remainingSeconds <= 15) return { background: '#FBEAEA', color: '#D93A3A', border: '#EFCFCF' };
  if (remainingSeconds <= 60) return { background: '#FDF3E6', color: '#B98418', border: '#F0DFC4' };
  return { background: '#EAF6EF', color: '#0F8B5F', border: '#EAE1D6' };
}

export function AcceptConfirmDialog({
  order,
  now,
  pending,
  failure,
  onConfirm,
  onClose,
}: AcceptConfirmDialogProps) {
  const [prepMinutes, setPrepMinutes] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const groupLabelId = `${baseId}-group-label`;
  const hintId = `${baseId}-hint`;

  const orderId = order?.id ?? null;

  // A new order means a new question: nothing is preselected, ever (M05-D03).
  useEffect(() => {
    setPrepMinutes(null);
  }, [orderId]);

  // Focus the first preset on open — "the first thing to do is choose"
  // (design §07). Not the container and not the confirm button.
  useEffect(() => {
    if (!orderId) return;
    const first = groupRef.current?.querySelector<HTMLElement>('[data-preset]');
    if (first) first.focus();
    else dialogRef.current?.focus();
  }, [orderId]);

  /**
   * Escape and the scrim close while idle and are **ignored in flight**: the
   * command cannot be recalled, and closing would hide the only surface
   * reporting it (design §07).
   */
  const closeIfIdle = useCallback(() => {
    if (pending) return;
    onClose();
  }, [pending, onClose]);

  useEffect(() => {
    if (!orderId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeIfIdle();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = dialogRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [orderId, closeIfIdle]);

  if (!order) return null;

  const { remainingSeconds, phase } = acceptWindowState(order.placedAt, now);
  const expired = phase === 'expired';
  const palette = stripPalette(remainingSeconds, expired);

  // Only these two cannot succeed on a retry, so only these two remove the
  // confirm button (M05-D07). Everything else keeps the selection and the
  // same button, pressed again.
  const retryBlocked = failure !== null && !failure.retryable;
  const showForm = !expired && !retryBlocked;
  const canConfirm = showForm && prepMinutes !== null && !pending;

  /**
   * Arrow keys move *and select* within the group; Enter selects and
   * deliberately does not submit (M05-D04) — one keystroke must separate
   * choosing from committing the kitchen. Space selects, as a radio does.
   */
  const onPresetKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      setPrepMinutes(PREP_MINUTE_PRESETS[index]!);
      return;
    }

    const delta =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (delta === 0) return;

    event.preventDefault();
    const next = (index + delta + PREP_MINUTE_PRESETS.length) % PREP_MINUTE_PRESETS.length;
    setPrepMinutes(PREP_MINUTE_PRESETS[next]!);
    groupRef.current?.querySelector<HTMLElement>(`[data-preset="${PREP_MINUTE_PRESETS[next]}"]`)?.focus();
  };

  const handleConfirm = () => {
    // `canConfirm` already gates the button, and `useOrderActions`' own
    // `pendingRef` is the authoritative duplicate-submission guard behind it
    // (M05-C08). This is the visual layer, not a replacement for it.
    if (!canConfirm || prepMinutes === null) return;
    onConfirm(order, prepMinutes);
  };

  return (
    <>
      <style>{`
        .banhao-accept-dialog { width: 480px; max-width: calc(100vw - 32px); }
        .banhao-accept-presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .banhao-accept-preset { height: 56px; }
        .banhao-accept-action { height: 52px; }
        .banhao-accept-close { width: 44px; height: 44px; }
        @media (max-width: 1024px) {
          /* M05-D12 — three parameters, not a new pattern. Not a bottom sheet. */
          .banhao-accept-dialog { width: min(92vw, 560px); }
          .banhao-accept-presets { grid-template-columns: repeat(3, 1fr); }
          .banhao-accept-preset { height: 64px; }
          .banhao-accept-action { height: 56px; }
          .banhao-accept-close { width: 56px; height: 56px; }
        }
      `}</style>

      {/* Scrim — M-04's, verbatim. Closes while idle, ignored in flight. */}
      <div
        onClick={closeIfIdle}
        data-testid="accept-dialog-scrim"
        aria-hidden
        style={{ position: 'absolute', inset: 0, background: 'rgba(31,26,22,.32)', zIndex: 3 }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={pending || undefined}
        tabIndex={-1}
        data-testid="accept-confirm-dialog"
        className="banhao-accept-dialog"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          borderRadius: 22,
          background: '#FBF7F1',
          border: '1px solid #E2D8CB',
          boxShadow: '0 24px 64px rgba(31,26,22,.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          zIndex: 4,
          outline: 'none',
        }}
      >
        <div
          style={{
            background: '#fff',
            borderBottom: '1px solid #EAE1D6',
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={headingId} style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.5 }}>
              รับออเดอร์{' '}
              <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600 }}>#{order.orderNumber}</span>
            </h2>
            <div style={{ fontSize: 12.5, color: '#7A6E64', marginTop: 6, lineHeight: 1.6 }}>
              {order.recipientNameSnapshot} · {formatBahtFixed(order.grandTotalSatang)}
            </div>
          </div>
          <button
            type="button"
            onClick={closeIfIdle}
            disabled={pending}
            aria-label="ปิดหน้าต่างยืนยันรับออเดอร์"
            className="banhao-accept-close"
            style={{
              borderRadius: 12,
              border: '1px solid #E9E0D5',
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              color: '#5A4E42',
              flex: '0 0 auto',
              cursor: pending ? 'default' : 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/*
            The accept-window strip reports; it does not enforce (M05-D08).
            `aria-live="off"` deliberately: a per-second live region would
            make this dialog unusable with a screen reader.
          */}
          <div
            data-testid="accept-window-strip"
            aria-live="off"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 40,
              padding: '0 14px',
              borderRadius: 12,
              background: palette.background,
              color: palette.color,
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            <span>{expired ? 'หมดเวลาตอบรับ' : 'เหลือเวลาตอบรับ'}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 15 }}>
              {formatCountdown(remainingSeconds)}
            </span>
          </div>

          {expired ? (
            /*
              M05-D10 — the body is replaced, not greyed: with the window
              closed there is nothing to confirm. The board's existing copy is
              reused verbatim, and BQ-013 stays untouched — nothing here
              rejects, refunds or cancels anything.
            */
            <div
              role="alert"
              data-testid="accept-dialog-expired"
              style={{
                borderRadius: 14,
                background: '#FBEAEA',
                border: '1px solid #EFCFCF',
                color: '#B32B2B',
                padding: '14px 16px',
                fontSize: 14,
                fontWeight: 600,
                lineHeight: 1.7,
              }}
            >
              หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ
            </div>
          ) : (
            <>
              {showForm ? (
                <div>
                  <div id={groupLabelId} style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.6 }}>
                    ใช้เวลาทำอาหารประมาณ
                  </div>
                  <div id={hintId} style={{ fontSize: 12.5, color: '#7A6E64', marginTop: 4, lineHeight: 1.6 }}>
                    เลือกเวลาก่อนจึงจะยืนยันได้ · ลูกค้าจะเห็นเวลานี้
                  </div>

                  {/*
                    A radiogroup, not five buttons (M05-D11): "exactly one,
                    required" is expressed natively to assistive technology,
                    and the group is ONE tab stop — `tabIndex` is 0 on the
                    checked option, or on the first when none is checked, and
                    -1 on every other.
                  */}
                  <div
                    ref={groupRef}
                    role="radiogroup"
                    aria-labelledby={groupLabelId}
                    className="banhao-accept-presets"
                    style={{ marginTop: 12 }}
                  >
                    {PREP_MINUTE_PRESETS.map((minutes, index) => {
                      const selected = prepMinutes === minutes;
                      const tabStop = prepMinutes === null ? index === 0 : selected;
                      return (
                        <button
                          key={minutes}
                          type="button"
                          role="radio"
                          data-preset={minutes}
                          aria-checked={selected}
                          aria-label={`${minutes} นาที`}
                          tabIndex={tabStop ? 0 : -1}
                          disabled={pending}
                          onClick={() => setPrepMinutes(minutes)}
                          onKeyDown={(event) => onPresetKeyDown(event, index)}
                          className="banhao-accept-preset"
                          style={{
                            borderRadius: 14,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 1,
                            cursor: pending ? 'default' : 'pointer',
                            ...(pending
                              ? selected
                                ? { border: '2px solid #E9C6B8', background: '#FBF1EC', color: '#C79C8B' }
                                : { border: '1px solid #EFE7DC', background: '#F7F2EA', color: '#B0A294' }
                              : selected
                                ? { border: '2px solid #E4572E', background: '#FDEEE7', color: '#C2431F' }
                                : { border: '1px solid #E9E0D5', background: '#fff', color: '#3D342C' }),
                          }}
                        >
                          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 17, fontWeight: 600 }}>
                            {minutes}
                          </span>
                          <span style={{ fontSize: 11 }}>นาที</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/*
                The consequence summary. `aria-live="polite"` so the sentence
                is heard once the value settles, not on every arrow press.
                Colour is never the only signal for the selection — this line
                restates the chosen number in words.
              */}
              {showForm ? (
                <div
                  aria-live="polite"
                  data-testid="accept-dialog-summary"
                  style={{
                    borderRadius: 14,
                    background: '#FDF3E6',
                    border: '1px solid #F0DFC4',
                    padding: '12px 14px',
                    fontSize: 13,
                    color: '#8A6412',
                    lineHeight: 1.7,
                  }}
                >
                  {pending
                    ? 'รอระบบยืนยัน · ออเดอร์จะย้ายไปคอลัมน์ กำลังทำ เมื่อระบบยืนยันแล้ว'
                    : prepMinutes === null
                      ? 'เลือกเวลาก่อนจึงจะยืนยันได้'
                      : `ยืนยันแล้วออเดอร์จะย้ายไปคอลัมน์ กำลังทำ และลูกค้าจะเห็นว่า ร้านใช้เวลาทำอาหารประมาณ ${prepMinutes} นาที`}
                </div>
              ) : null}

              {failure ? (
                <div
                  role="alert"
                  data-testid="accept-dialog-error"
                  style={{
                    borderRadius: 11,
                    background: '#FBEAEA',
                    border: '1px solid #EFCFCF',
                    color: '#B32B2B',
                    padding: '12px 14px',
                    fontSize: 13.5,
                    fontWeight: 600,
                    lineHeight: 1.7,
                  }}
                >
                  {/* `orderActionErrorMessage`'s output — this dialog writes no second vocabulary. */}
                  {failure.message}
                  <div style={{ fontWeight: 400, marginTop: 4 }}>
                    ออเดอร์ยังอยู่ที่ ออเดอร์ใหม่ และยังไม่ถูกรับ
                  </div>
                </div>
              ) : null}
            </>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
            {showForm ? (
              <>
                <button
                  type="button"
                  onClick={closeIfIdle}
                  disabled={pending}
                  className="banhao-accept-action"
                  style={{
                    minWidth: 110,
                    padding: '0 18px',
                    borderRadius: 14,
                    border: '1px solid #E9E0D5',
                    background: '#fff',
                    color: '#5A4E42',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: pending ? 'default' : 'pointer',
                  }}
                >
                  ยกเลิก
                </button>
                {/*
                  `aria-disabled`, not `disabled`, while nothing is chosen
                  (M05-D03): the button stays focusable so a keyboard user can
                  reach it and be told why, rather than finding a control that
                  silently is not there. It becomes genuinely `disabled` only
                  in flight, where it must not be re-activated at all.
                */}
                <button
                  type="button"
                  data-testid="accept-dialog-confirm"
                  onClick={handleConfirm}
                  disabled={pending}
                  aria-disabled={!canConfirm}
                  aria-describedby={prepMinutes === null ? hintId : undefined}
                  className="banhao-accept-action"
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    border: 'none',
                    background: canConfirm ? '#E4572E' : '#EFC4B4',
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    cursor: canConfirm ? 'pointer' : 'default',
                  }}
                >
                  {pending ? (
                    <>
                      <span
                        aria-hidden
                        className="banhao-order-action-spinner"
                        style={{
                          width: 15,
                          height: 15,
                          borderRadius: '50%',
                          border: '2.5px solid rgba(255,255,255,.45)',
                          borderTopColor: '#fff',
                          display: 'inline-block',
                        }}
                      />
                      กำลังส่งให้ระบบ…
                    </>
                  ) : (
                    'ยืนยันรับออเดอร์'
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="accept-dialog-dismiss"
                onClick={closeIfIdle}
                className="banhao-accept-action"
                style={{
                  flex: 1,
                  borderRadius: 14,
                  border: '1px solid #E9E0D5',
                  background: '#fff',
                  color: '#5A4E42',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ปิด
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
