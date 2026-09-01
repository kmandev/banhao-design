'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import type { MenuCategory } from '../domain/menu';
import { useModalFocus } from '../hooks/useModalFocus';
import { menuCopy } from '../lib/menuCopy';
import * as m from '../lib/menuStyles';

/**
 * M-11 §07 — create, rename and reorder categories.
 *
 * ## Reorder is one save, not one save per move
 *
 * `sort_order` is an int on every row, so reordering rewrites several rows at
 * a time. An explicit `บันทึกลำดับ` makes that one request and one failure to
 * report; saving per drag would invite partial saves and collisions (M11-D08).
 *
 * ## Keyboard is a first-class path, not a fallback
 *
 * Each row exposes `ย้ายขึ้น` / `ย้ายลง` at 44px (M-11 §11). This component
 * ships **only** that path: pointer drag-and-drop is not implemented, because
 * a hand-rolled drag interaction that is inaccessible by keyboard would be a
 * worse outcome than buttons that work for everyone, and the design's own
 * accessibility section requires the buttons regardless. Each move announces
 * itself through the live region.
 *
 * ## Rename is inline
 *
 * `name` is the only editable field — nothing else on `menu_categories` is
 * merchant-facing. Enter commits, Escape reverts.
 */

export interface CategoryManagerDialogProps {
  open: boolean;
  categories: MenuCategory[];
  /** Active item count per category id, for the archive block message. */
  itemCounts: Map<string, number>;
  busy: boolean;
  onCreate: (name: string) => void;
  onRename: (categoryId: string, name: string) => void;
  onArchive: (category: MenuCategory) => void;
  onSaveOrder: (categoryIds: string[]) => void;
  onClose: () => void;
}

export function CategoryManagerDialog({
  open,
  categories,
  itemCounts,
  busy,
  onCreate,
  onRename,
  onArchive,
  onSaveOrder,
  onClose,
}: CategoryManagerDialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const newNameId = useId();

  const [order, setOrder] = useState<MenuCategory[]>(categories);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [newName, setNewName] = useState('');
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!open) return;
    setOrder(categories);
    setEditingId(null);
    setNewName('');
    setAnnouncement('');
  }, [open, categories]);

  useModalFocus({ containerRef, open, onClose });

  if (!open) return null;

  const orderChanged = order.some((category, index) => categories[index]?.id !== category.id);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    setOrder(next);
    setAnnouncement(menuCopy.moved(moved.name, target + 1));
  };

  const commitRename = (category: MenuCategory) => {
    const trimmed = draftName.trim();
    setEditingId(null);
    if (trimmed === '' || trimmed === category.name) return;
    onRename(category.id, trimmed);
  };

  return (
    <>
      <div style={m.scrim} onClick={onClose} data-testid="category-dialog-scrim" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={m.dialog}
        data-testid="category-dialog"
      >
        <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
          {menuCopy.categoriesTitle}
        </h2>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          {order.map((category, index) => {
            const count = itemCounts.get(category.id) ?? 0;
            const editing = editingId === category.id;

            return (
              <li
                key={category.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing.sm,
                  padding: `${spacing.sm}px 0`,
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                {editing ? (
                  <input
                    autoFocus
                    style={{ ...m.textInput, flex: 1 }}
                    value={draftName}
                    aria-label={`${menuCopy.rename}: ${category.name}`}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitRename(category);
                      if (event.key === 'Escape') {
                        // Stop the dialog's own Escape handler from closing
                        // the whole dialog — Escape here reverts the rename.
                        event.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                    onBlur={() => commitRename(category)}
                    data-testid={`category-rename-input-${category.name}`}
                  />
                ) : (
                  <>
                    <span style={{ flex: 1, fontSize: 15, color: colors.textPrimary }}>{category.name}</span>
                    <span style={m.badge}>{menuCopy.itemCount(count)}</span>
                  </>
                )}

                <button
                  type="button"
                  style={m.iconButton}
                  aria-label={`${menuCopy.moveUp}: ${category.name}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  style={m.iconButton}
                  aria-label={`${menuCopy.moveDown}: ${category.name}`}
                  disabled={index === order.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  style={m.iconButton}
                  aria-label={`${menuCopy.rename}: ${category.name}`}
                  onClick={() => {
                    setEditingId(category.id);
                    setDraftName(category.name);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  style={m.iconButton}
                  aria-label={`${menuCopy.remove}: ${category.name}`}
                  // A category holding dishes cannot be removed: category_id is
                  // ON DELETE RESTRICT, and M11-Q-01 is unresolved. The reason
                  // is the accessible name, not a tooltip.
                  disabled={count > 0}
                  title={count > 0 ? menuCopy.removeCategoryBlocked(count) : undefined}
                  onClick={() => onArchive(category)}
                  data-testid={`category-archive-${category.name}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>

        {order.length === 0 ? <p style={m.fieldHint}>{menuCopy.emptyCategory}</p> : null}

        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
            <label htmlFor={newNameId} style={m.fieldLabel}>
              {menuCopy.addCategory}
            </label>
            <input
              id={newNameId}
              style={m.textInput}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              data-testid="new-category-name"
            />
          </div>
          <button
            type="button"
            style={m.secondaryButton}
            aria-disabled={newName.trim() === '' || busy}
            onClick={() => {
              if (newName.trim() === '' || busy) return;
              onCreate(newName.trim());
              setNewName('');
            }}
            data-testid="create-category"
          >
            {menuCopy.save}
          </button>
        </div>

        <div style={{ display: 'flex', gap: spacing.sm }}>
          <button type="button" style={{ ...m.secondaryButton, flex: 1 }} onClick={onClose}>
            {menuCopy.cancel}
          </button>
          <button
            type="button"
            style={{ ...m.primaryButton, flex: 1, opacity: orderChanged && !busy ? 1 : 0.6 }}
            aria-disabled={!orderChanged || busy}
            onClick={() => {
              if (!orderChanged || busy) return;
              onSaveOrder(order.map((category) => category.id));
            }}
            data-testid="save-category-order"
          >
            {menuCopy.saveOrder}
          </button>
        </div>

        <span style={m.visuallyHidden} aria-live="polite" data-testid="category-announcement">
          {announcement}
        </span>
      </div>
    </>
  );
}
