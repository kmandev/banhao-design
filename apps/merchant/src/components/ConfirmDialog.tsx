'use client';

import { useId, useRef } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import { useModalFocus } from '../hooks/useModalFocus';
import * as m from '../lib/menuStyles';

/**
 * The shared confirmation dialog behind every destructive M-11 / M-12 action.
 *
 * **Focus starts on cancel, never on the destructive button** (M-11 §11): an
 * accidental Enter must not remove a dish or discard a week of edits. That is
 * enforced here rather than left to each caller, which is the main reason this
 * is one component instead of three.
 *
 * The caller supplies the copy. This component composes none of it — in
 * particular it never renders the word `ลบ`, because removal in this product
 * is an archive and the copy must not promise deletion (M11-D06).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = true,
  pending = false,
  onConfirm,
  onCancel,
  testId,
}: {
  open: boolean;
  title: string;
  /** One paragraph per entry. Each is a complete statement of fact. */
  body: readonly string[];
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useModalFocus({
    containerRef,
    open,
    onClose: onCancel,
    initialFocusSelector: '[data-confirm-cancel]',
  });

  if (!open) return null;

  return (
    <>
      <div style={m.scrim} onClick={onCancel} data-testid={testId ? `${testId}-scrim` : undefined} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={m.dialog}
        data-testid={testId}
      >
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          {title}
        </h2>

        {body.map((paragraph) => (
          <p key={paragraph} style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.7, margin: 0 }}>
            {paragraph}
          </p>
        ))}

        <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm }}>
          <button
            type="button"
            data-confirm-cancel
            onClick={onCancel}
            style={{ ...m.secondaryButton, flex: 1 }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            style={{
              ...(destructive ? m.dangerButton : m.primaryButton),
              flex: 1,
              opacity: pending ? 0.6 : 1,
            }}
            data-testid={testId ? `${testId}-confirm` : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
