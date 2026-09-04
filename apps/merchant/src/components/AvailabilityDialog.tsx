'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PREP_MINUTE_PRESETS } from './AcceptConfirmDialog';
import type { AvailabilitySaveState } from '../hooks/useAvailability';

/**
 * M-13 — the Busy prep-time picker and the Pause confirmation, one component
 * with two modes rather than two dialogs, because both are the same shape: a
 * scrim, a focus-trapped panel, one required decision, a confirm and a
 * cancel. Scrim/focus-trap/Escape/Tab-cycling are `AcceptConfirmDialog`'s
 * (M-04/M-05), reused rather than reinvented — see that component's own doc
 * comment for the pattern's origin.
 *
 * `PREP_MINUTE_PRESETS` (10/20/30/45/60) is imported from
 * `AcceptConfirmDialog`, not redeclared: the M-13 design package's own words
 * are "Same set, same nothing-preselected rule" — a second constant would
 * risk the two ever disagreeing.
 *
 * ## What this component does not decide
 *
 * It never closes itself on success — `useAvailability.setBusy`/`setPaused`
 * resolve into the hook's own re-read state, and `OrderBoard` closes this
 * dialog by no longer passing a mode (mirroring how M-05's dialog is owned by
 * its caller, not by itself). A failure leaves the dialog open with an inline
 * error, exactly like `AcceptConfirmDialog`'s own failure treatment.
 */

export type AvailabilityDialogMode = 'BUSY' | 'PAUSE' | null;

export interface AvailabilityDialogProps {
  /** Which dialog is open, or `null` when closed. */
  mode: AvailabilityDialogMode;
  saveState: AvailabilitySaveState;
  onConfirmBusy: (busyPrepMinutes: number) => void;
  onConfirmPause: () => void;
  onClose: () => void;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function AvailabilityDialog({
  mode,
  saveState,
  onConfirmBusy,
  onConfirmPause,
  onClose,
}: AvailabilityDialogProps) {
  const [busyPrepMinutes, setBusyPrepMinutes] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const groupLabelId = `${baseId}-group-label`;

  const pending = saveState.status === 'saving';

  // A newly opened dialog means a new question: nothing is preselected,
  // ever — the same rule M05-D03 states for the accept dialog, and the M-13
  // design package restates verbatim for Busy ("nothing is preselected").
  useEffect(() => {
    setBusyPrepMinutes(null);
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    if (mode === 'BUSY') {
      const first = groupRef.current?.querySelector<HTMLElement>('[data-preset]');
      if (first) first.focus();
      else dialogRef.current?.focus();
    } else {
      dialogRef.current?.focus();
    }
  }, [mode]);

  const closeIfIdle = useCallback(() => {
    if (pending) return;
    onClose();
  }, [pending, onClose]);

  useEffect(() => {
    if (!mode) return;

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
  }, [mode, closeIfIdle]);

  if (!mode) return null;

  const onPresetKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      setBusyPrepMinutes(PREP_MINUTE_PRESETS[index]!);
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
    setBusyPrepMinutes(PREP_MINUTE_PRESETS[next]!);
    groupRef.current
      ?.querySelector<HTMLElement>(`[data-preset="${PREP_MINUTE_PRESETS[next]}"]`)
      ?.focus();
  };

  const canConfirmBusy = busyPrepMinutes !== null && !pending;

  const handleConfirm = () => {
    if (mode === 'BUSY') {
      if (!canConfirmBusy || busyPrepMinutes === null) return;
      onConfirmBusy(busyPrepMinutes);
    } else {
      if (pending) return;
      onConfirmPause();
    }
  };

  const heading = mode === 'BUSY' ? 'เปลี่ยนเป็น กำลังยุ่ง' : 'หยุดรับออเดอร์ชั่วคราว';

  return (
    <>
      <style>{`
        .banhao-availability-dialog { width: 480px; max-width: calc(100vw - 32px); }
        .banhao-availability-presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .banhao-availability-preset { height: 56px; }
        .banhao-availability-action { height: 52px; }
        @media (max-width: 1024px) {
          .banhao-availability-dialog { width: min(92vw, 560px); }
          .banhao-availability-presets { grid-template-columns: repeat(3, 1fr); }
          .banhao-availability-preset { height: 64px; }
          .banhao-availability-action { height: 56px; }
        }
      `}</style>

      <div
        onClick={closeIfIdle}
        data-testid="availability-dialog-scrim"
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
        data-testid="availability-dialog"
        className="banhao-availability-dialog"
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
          }}
        >
          <h2 id={headingId} style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.5 }}>
            {heading}
          </h2>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'BUSY' ? (
            <div>
              <div id={groupLabelId} style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.6 }}>
                ใช้เวลาทำอาหารประมาณ
              </div>
              <div style={{ fontSize: 12.5, color: '#7A6E64', marginTop: 4, lineHeight: 1.6 }}>
                ลูกค้าที่สั่งใหม่จะเห็นเวลานี้ก่อนสั่งซื้อ
              </div>

              <div
                ref={groupRef}
                role="radiogroup"
                aria-labelledby={groupLabelId}
                className="banhao-availability-presets"
                style={{ marginTop: 12 }}
              >
                {PREP_MINUTE_PRESETS.map((minutes, index) => {
                  const selected = busyPrepMinutes === minutes;
                  const tabStop = busyPrepMinutes === null ? index === 0 : selected;
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
                      onClick={() => setBusyPrepMinutes(minutes)}
                      onKeyDown={(event) => onPresetKeyDown(event, index)}
                      className="banhao-availability-preset"
                      style={{
                        borderRadius: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        cursor: pending ? 'default' : 'pointer',
                        ...(selected
                          ? { border: '2px solid #8A6412', background: '#FDF3E6', color: '#8A6412' }
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
          ) : (
            <div style={{ fontSize: 14, lineHeight: 1.75, color: '#3D342C' }}>
              ออเดอร์ที่มีอยู่แล้วดำเนินการตามปกติ ระบบจะไม่รับออเดอร์ใหม่จนกว่าคุณจะกดเปิดรับอีกครั้ง
            </div>
          )}

          {saveState.status === 'failed' ? (
            <div
              role="alert"
              data-testid="availability-dialog-error"
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
              {saveState.message}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
            <button
              type="button"
              onClick={closeIfIdle}
              disabled={pending}
              className="banhao-availability-action"
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
            <button
              type="button"
              data-testid="availability-dialog-confirm"
              onClick={handleConfirm}
              disabled={pending || (mode === 'BUSY' && !canConfirmBusy)}
              className="banhao-availability-action"
              style={{
                flex: 1,
                borderRadius: 14,
                border: 'none',
                background:
                  mode === 'BUSY' ? (canConfirmBusy ? '#8A6412' : '#EAD9B4') : pending ? '#EFC4B4' : '#B23030',
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: pending || (mode === 'BUSY' && !canConfirmBusy) ? 'default' : 'pointer',
              }}
            >
              {pending
                ? 'กำลังส่งให้ระบบ…'
                : mode === 'BUSY'
                  ? 'ยืนยันกำลังยุ่ง'
                  : 'ยืนยันหยุดรับออเดอร์'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
