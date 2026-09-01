'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import type { MenuOptionGroupInput } from '@banhao/validation';
import type { MenuItem, MenuOptionGroup, OptionSelectPreset } from '../domain/menu';
import { presetToRange, rangeToPreset } from '../domain/menu';
import { useModalFocus } from '../hooks/useModalFocus';
import { menuCopy } from '../lib/menuCopy';
import { formatPriceDelta, parseBahtToSatang, satangToBahtInput } from '../lib/menuDisplay';
import * as m from '../lib/menuStyles';

/**
 * M-11 §06 — option groups.
 *
 * ## Three presets, not two number inputs
 *
 * `min_select` / `max_select` exist so BQ-009 (single- vs multi-select) stays
 * data rather than schema. Asking a merchant to encode that as arithmetic
 * would leak a schema decision into the shop (M11-D07), so the editor offers
 * the three shapes the customer app can already render and writes the numbers
 * underneath. The stored pair is shown in mono beside the rule, so an operator
 * can always read what was actually stored — which also covers a pair no
 * preset produces, since the schema permits `min 2 / max 3` even though no
 * preset writes it.
 *
 * ## Saving replaces every group
 *
 * One `PUT`, matching `replace_menu_item_option_groups`. Safe because
 * `order_item_options` snapshots group and option names as text, so no history
 * depends on a group's id surviving.
 */

interface DraftOption {
  label: string;
  /** Baht as typed. Converted at submit, like the dish price. */
  delta: string;
  isAvailable: boolean;
}

interface DraftGroup {
  title: string;
  preset: OptionSelectPreset;
  maxSelect: number;
  options: DraftOption[];
}

function toDraft(groups: MenuOptionGroup[]): DraftGroup[] {
  return groups.map((group) => ({
    title: group.title,
    preset: rangeToPreset(group.minSelect, group.maxSelect),
    maxSelect: group.maxSelect,
    options: group.options.map((option) => ({
      label: option.label,
      delta: satangToBahtInput(option.priceDeltaSatang),
      isAvailable: option.isAvailable,
    })),
  }));
}

export interface OptionGroupEditorProps {
  open: boolean;
  item: MenuItem | null;
  groups: MenuOptionGroup[];
  loading: boolean;
  saving: boolean;
  failure: { forbidden: boolean } | null;
  onSave: (menuItemId: string, groups: MenuOptionGroupInput[]) => void;
  onClose: () => void;
}

export function OptionGroupEditor({
  open,
  item,
  groups,
  loading,
  saving,
  failure,
  onSave,
  onClose,
}: OptionGroupEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<DraftGroup[]>([]);
  const [submitted, setSubmitted] = useState(false);

  /**
   * Which dish's groups the draft currently holds.
   *
   * Seeding on every change of the `groups` prop looks equivalent and is not:
   * `groups` arrives asynchronously, so a merchant who added a group while the
   * fetch was still in flight would have it silently wiped the moment the
   * fetch resolved. Seeding once per dish, and only after loading finishes,
   * means the draft is written exactly when there is something real to write
   * and never again.
   */
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !item) {
      seededFor.current = null;
      return;
    }
    if (loading || seededFor.current === item.id) return;

    seededFor.current = item.id;
    setDraft(toDraft(groups));
    setSubmitted(false);
  }, [open, item, loading, groups]);

  useModalFocus({ containerRef, open, onClose });

  if (!open || !item) return null;

  const update = (index: number, patch: Partial<DraftGroup>) => {
    setDraft((prev) => prev.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<DraftOption>) => {
    setDraft((prev) =>
      prev.map((group, i) =>
        i === groupIndex
          ? {
              ...group,
              options: group.options.map((option, j) =>
                j === optionIndex ? { ...option, ...patch } : option,
              ),
            }
          : group,
      ),
    );
  };

  const errors = draft.map(validateGroup);
  const valid = errors.every((error) => error === null);

  const submit = () => {
    setSubmitted(true);
    if (!valid || saving) return;

    const payload: MenuOptionGroupInput[] = draft.map((group) => {
      const { minSelect, maxSelect } = presetToRange(group.preset, group.maxSelect);
      return {
        title: group.title.trim(),
        minSelect,
        maxSelect,
        options: group.options.map((option) => {
          const parsed = parseBahtToSatang(option.delta === '' ? '0' : option.delta);
          return {
            label: option.label.trim(),
            priceDeltaSatang: parsed.ok ? parsed.satang : 0,
            isAvailable: option.isAvailable,
          };
        }),
      };
    });

    onSave(item.id, payload);
  };

  return (
    <>
      <div style={m.scrim} onClick={onClose} data-testid="option-editor-scrim" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={m.drawer}
        data-testid="option-editor"
      >
        <header style={{ padding: spacing.lg, borderBottom: `1px solid ${colors.border}` }}>
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
            {menuCopy.optionsTitle(item.name)}
          </h2>
        </header>

        <div style={m.drawerBody}>
          {loading ? <p style={m.fieldHint}>{menuCopy.loading}</p> : null}

          {loading ? null : draft.map((group, groupIndex) => {
            const { minSelect, maxSelect } = presetToRange(group.preset, group.maxSelect);
            const error = errors[groupIndex];

            return (
              <fieldset
                key={groupIndex}
                style={{ ...m.panel, display: 'flex', flexDirection: 'column', gap: spacing.sm }}
              >
                <legend style={m.fieldLabel}>{group.title || menuCopy.optionGroupTitle}</legend>

                <input
                  style={m.textInput}
                  aria-label={menuCopy.optionGroupTitle}
                  value={group.title}
                  onChange={(event) => update(groupIndex, { title: event.target.value })}
                  data-testid={`group-title-${groupIndex}`}
                />

                <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    style={{ ...m.textInput, flex: '1 1 200px' }}
                    aria-label={menuCopy.maxSelectable}
                    value={group.preset}
                    onChange={(event) =>
                      update(groupIndex, { preset: event.target.value as OptionSelectPreset })
                    }
                    data-testid={`group-preset-${groupIndex}`}
                  >
                    <option value="REQUIRED_ONE">{menuCopy.presetRequiredOne}</option>
                    <option value="OPTIONAL_ONE">{menuCopy.presetOptionalOne}</option>
                    <option value="MULTIPLE">{menuCopy.presetMultiple}</option>
                  </select>

                  {group.preset === 'MULTIPLE' ? (
                    <input
                      type="number"
                      min={1}
                      style={{ ...m.textInput, width: 96 }}
                      aria-label={menuCopy.maxSelectable}
                      value={group.maxSelect}
                      onChange={(event) =>
                        update(groupIndex, { maxSelect: Number(event.target.value) || 1 })
                      }
                    />
                  ) : null}

                  {/* The stored pair, in mono — so an operator can read what
                      was actually written, including a pair no preset makes. */}
                  <span style={{ ...m.price, fontSize: 12, color: colors.textMuted }}>
                    min {minSelect} / max {maxSelect}
                  </span>
                </div>

                {minSelect >= 1 ? <p style={m.fieldHint}>{menuCopy.requiredGroupNote}</p> : null}

                {group.options.map((option, optionIndex) => {
                  const parsed = parseBahtToSatang(option.delta === '' ? '0' : option.delta);
                  return (
                    <div
                      key={optionIndex}
                      style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <input
                        style={{ ...m.textInput, flex: '1 1 160px' }}
                        aria-label={`${menuCopy.optionLabel} ${optionIndex + 1}`}
                        value={option.label}
                        onChange={(event) =>
                          updateOption(groupIndex, optionIndex, { label: event.target.value })
                        }
                        data-testid={`option-label-${groupIndex}-${optionIndex}`}
                      />
                      <input
                        inputMode="decimal"
                        style={{ ...m.textInput, ...m.price, width: 120 }}
                        aria-label={`${menuCopy.optionDelta} ${optionIndex + 1}`}
                        value={option.delta}
                        onChange={(event) =>
                          updateOption(groupIndex, optionIndex, { delta: event.target.value })
                        }
                      />
                      <span style={{ ...m.price, fontSize: 12, color: colors.textMuted }}>
                        {parsed.ok ? formatPriceDelta(parsed.satang) : '—'}
                      </span>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: m.TOUCH_TARGET }}>
                        <input
                          type="checkbox"
                          checked={option.isAvailable}
                          onChange={(event) =>
                            updateOption(groupIndex, optionIndex, { isAvailable: event.target.checked })
                          }
                        />
                        <span style={{ fontSize: 12, color: colors.textMuted }}>
                          {option.isAvailable ? menuCopy.available : menuCopy.unavailable}
                        </span>
                      </label>
                      <button
                        type="button"
                        style={m.iconButton}
                        aria-label={`${menuCopy.remove} ${option.label || optionIndex + 1}`}
                        onClick={() =>
                          update(groupIndex, {
                            options: group.options.filter((_, j) => j !== optionIndex),
                          })
                        }
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}

                {submitted && error ? (
                  <p style={m.fieldError} role="alert">
                    {error}
                  </p>
                ) : null}

                <div style={{ display: 'flex', gap: spacing.sm }}>
                  <button
                    type="button"
                    style={m.secondaryButton}
                    onClick={() =>
                      update(groupIndex, {
                        options: [...group.options, { label: '', delta: '0.00', isAvailable: true }],
                      })
                    }
                    data-testid={`add-option-${groupIndex}`}
                  >
                    {menuCopy.addOption}
                  </button>
                  <button
                    type="button"
                    style={m.secondaryButton}
                    onClick={() => setDraft((prev) => prev.filter((_, i) => i !== groupIndex))}
                    data-testid={`remove-group-${groupIndex}`}
                  >
                    {menuCopy.remove}
                  </button>
                </div>
              </fieldset>
            );
          })}

          <button
            type="button"
            style={{ ...m.secondaryButton, alignSelf: 'flex-start' }}
            disabled={loading}
            onClick={() =>
              setDraft((prev) => [
                ...prev,
                {
                  title: '',
                  preset: 'OPTIONAL_ONE',
                  maxSelect: 1,
                  options: [{ label: '', delta: '0.00', isAvailable: true }],
                },
              ])
            }
            data-testid="add-option-group"
          >
            {menuCopy.addOptionGroup}
          </button>

          {failure ? (
            <p style={m.fieldError} role="alert" data-testid="option-editor-error">
              {failure.forbidden ? menuCopy.saveForbidden : menuCopy.saveFailed}
            </p>
          ) : null}
        </div>

        <div style={m.drawerFooter}>
          <button type="button" style={{ ...m.secondaryButton, flex: 1 }} onClick={onClose}>
            {menuCopy.cancel}
          </button>
          <button
            type="button"
            style={{ ...m.primaryButton, flex: 1, opacity: valid && !saving ? 1 : 0.6 }}
            aria-disabled={!valid || saving}
            onClick={submit}
            data-testid="option-editor-save"
          >
            {saving ? menuCopy.saving : menuCopy.save}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * A group needs a title and at least one option to be worth saving (M-11 §05).
 * That "at least one" is the design's rule, not the schema's — the table has
 * no CHECK on emptiness — and a group a customer cannot answer is not a group.
 */
function validateGroup(group: DraftGroup): string | null {
  if (group.title.trim() === '') return menuCopy.categoryNameRequired;
  if (group.options.length === 0) return menuCopy.optionsRequired;
  if (group.options.some((option) => option.label.trim() === '')) return menuCopy.optionsRequired;
  return null;
}
