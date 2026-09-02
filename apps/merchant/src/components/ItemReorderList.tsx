'use client';

import { useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import type { MenuItem } from '../domain/menu';
import { menuCopy } from '../lib/menuCopy';
import { formatBahtFixed } from '../lib/orderBoardDisplay';
import * as m from '../lib/menuStyles';

/**
 * M-11 §17 addendum — dish order within one category.
 *
 * Reuses category reorder's shape exactly (M11-D13): a local, unsent draft
 * order, explicit `บันทึกลำดับ`, and `↑`/`↓` as the fully keyboard-operable
 * path (`CategoryManagerDialog`'s own precedent). The one addition the
 * addendum asks for that category reorder deliberately skipped is pointer
 * drag — implemented here with native HTML5 drag-and-drop (no new
 * dependency), strictly *layered on top of* the button path rather than
 * replacing it, exactly as §17-I specifies.
 *
 * Inline, not a dialog: the addendum's own mockup (§17-B) shows the rows
 * transformed in place within the same section card, not an overlay. So this
 * component does not use `useModalFocus` (a real focus trap + scrim) — there
 * is no scrim here, and trapping Tab inside one section of a longer page
 * would be wrong. Escape and focus-return are handled directly instead.
 *
 * The draft order is captured once, from the items this component mounts
 * with, and never resynced from a later `items` prop — nothing else can
 * write to this category's items while its rows are in reorder mode (normal
 * actions are suppressed, §17-C "Interaction with availability / edit"), so
 * there is nothing to resync from.
 */

export interface ItemReorderListProps {
  categoryName: string;
  items: MenuItem[];
  saving: boolean;
  failed: boolean;
  onSave: (menuItemIds: string[]) => void;
  onCancel: () => void;
}

export function ItemReorderList({
  categoryName,
  items,
  saving,
  failed,
  onSave,
  onCancel,
}: ItemReorderListProps) {
  const [order, setOrder] = useState<MenuItem[]>(items);
  const [announcement, setAnnouncement] = useState('');
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const originalIds = items.map((item) => item.id).join(',');
  const changed = order.map((item) => item.id).join(',') !== originalIds;

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setOrder(next);
    setAnnouncement(menuCopy.movedItem(moved.name, target + 1, next.length));
  };

  const moveTo = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || toIndex >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setOrder(next);
    setAnnouncement(menuCopy.movedItem(moved.name, toIndex + 1, next.length));
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column' }}
      data-testid={`reorder-list-${categoryName}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          padding: `${spacing.sm}px 0`,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: 8,
            backgroundColor: colors.surfaceAccent,
            color: colors.primary,
          }}
          data-testid="reorder-mode-badge"
        >
          {menuCopy.reorderModeLabel}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {order.map((item, index) => (
          <div
            key={item.id}
            draggable={!saving}
            onDragStart={(event) => {
              if (saving) return;
              dragIndex.current = index;
              event.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(event) => {
              if (saving || dragIndex.current === null) return;
              event.preventDefault();
              setDragOverIndex(index);
            }}
            onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragIndex.current;
              dragIndex.current = null;
              setDragOverIndex(null);
              if (from === null || saving) return;
              moveTo(from, index);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setDragOverIndex(null);
            }}
            style={{
              ...m.itemRow,
              backgroundColor: dragOverIndex === index ? colors.surfaceAccent : undefined,
            }}
            data-testid={`reorder-row-${item.name}`}
          >
            <span
              aria-label={menuCopy.dragHandleLabel(item.name)}
              style={{ cursor: saving ? 'not-allowed' : 'grab', color: colors.textMuted, fontSize: 16, flex: '0 0 auto' }}
              data-testid={`reorder-handle-${item.name}`}
            >
              ⠿
            </span>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                backgroundColor: colors.surfaceAccent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: colors.textMuted,
                flex: '0 0 auto',
              }}
              data-testid={`reorder-position-${item.name}`}
            >
              {index + 1}
            </span>
            <span style={{ ...m.itemName, flex: 1 }}>{item.name}</span>
            <span style={m.price}>{formatBahtFixed(item.basePriceSatang)}</span>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={m.iconButton}
                aria-label={`${menuCopy.moveUp}: ${item.name}`}
                disabled={index === 0 || saving}
                onClick={() => move(index, -1)}
                data-testid={`reorder-up-${item.name}`}
              >
                ↑
              </button>
              <button
                type="button"
                style={m.iconButton}
                aria-label={`${menuCopy.moveDown}: ${item.name}`}
                disabled={index === order.length - 1 || saving}
                onClick={() => move(index, 1)}
                data-testid={`reorder-down-${item.name}`}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>

      {failed ? (
        <div role="alert" style={{ ...m.panel, borderColor: colors.danger, marginTop: spacing.sm }} data-testid="reorder-error">
          <span style={{ color: colors.danger, fontSize: 14 }}>{menuCopy.reorderSaveFailed}</span>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm }}>
        <span style={{ ...m.fieldHint, flex: 1 }} data-testid="reorder-footer-note">
          {changed ? menuCopy.reorderChanged : ''}
        </span>
        <button
          type="button"
          style={m.secondaryButton}
          disabled={saving}
          onClick={onCancel}
          data-testid="reorder-cancel"
        >
          {menuCopy.cancel}
        </button>
        <button
          type="button"
          style={{ ...m.primaryButton, opacity: !changed || saving ? 0.6 : 1 }}
          aria-disabled={!changed || saving}
          onClick={() => {
            if (!changed || saving) return;
            onSave(order.map((item) => item.id));
          }}
          data-testid="reorder-save"
        >
          {saving ? menuCopy.saving : menuCopy.saveOrder}
        </button>
      </div>

      <span style={m.visuallyHidden} aria-live="polite" data-testid="reorder-announcement">
        {announcement}
      </span>
    </div>
  );
}
