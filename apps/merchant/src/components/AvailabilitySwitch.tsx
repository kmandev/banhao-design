'use client';

import { colors } from '@banhao/ui/theme';
import { menuCopy } from '../lib/menuCopy';
import * as m from '../lib/menuStyles';

/**
 * `ปิดขายวันนี้` — M-11 §03.
 *
 * A real `<button role="switch">` with `aria-checked`, reachable by Tab and
 * toggled by Space or Enter. Never a bare div, and never a checkbox styled to
 * look like a switch: a screen reader must announce it as a switch and read
 * back its state.
 *
 * The `พร้อมขาย` / `ปิดขายวันนี้` text label is **always present**, so
 * availability is never carried by the switch colour alone (M-11 §11, and
 * UX-FINDING-02 on colour as the sole signal).
 *
 * Pending dims the switch to 60% rather than disabling it, so the row stays
 * readable and the control keeps its accessible name while a write is in
 * flight. No spinner overlays anything — the write is one boolean.
 */
export function AvailabilitySwitch({
  itemName,
  isAvailable,
  pending,
  onToggle,
}: {
  itemName: string;
  isAvailable: boolean;
  pending: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        role="switch"
        aria-checked={isAvailable}
        aria-label={menuCopy.availabilityLabel(itemName)}
        aria-busy={pending || undefined}
        onClick={() => onToggle(!isAvailable)}
        style={m.switchHitArea}
        data-testid={`availability-switch-${itemName}`}
      >
        <span style={m.switchTrack(isAvailable, pending)} aria-hidden>
          <span style={m.switchKnob} />
        </span>
      </button>
      <span
        style={{
          fontSize: 13,
          color: isAvailable ? colors.success : colors.textMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {isAvailable ? menuCopy.available : menuCopy.unavailable}
      </span>
    </span>
  );
}
