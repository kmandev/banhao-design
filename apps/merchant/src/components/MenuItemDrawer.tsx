'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import type { CreateMenuItemInput, UpdateMenuItemInput } from '@banhao/validation';
import type { MenuCategory, MenuItem } from '../domain/menu';
import type { MenuItemImageState } from '../hooks/useMenu';
import { useModalFocus } from '../hooks/useModalFocus';
import { menuCopy } from '../lib/menuCopy';
import { formatClockTime } from '../lib/orderBoardDisplay';
import { parseBahtToSatang, satangToBahtInput } from '../lib/menuDisplay';
import { resolveImageUrl } from '../lib/imageUrl';
import { ConfirmDialog } from './ConfirmDialog';
import * as m from '../lib/menuStyles';

/**
 * M-11 §04 — create and edit, one drawer, two modes.
 *
 * The 520px right drawer, scrim and focus trap are M-04's, reused rather than
 * a second overlay paradigm (M11-D04). Create opens empty with `พร้อมขาย`
 * preset on, matching `is_available default true`; edit opens prefilled.
 *
 * ## Save is disabled until valid **and** dirty
 *
 * A merchant who opened a dish to look at it cannot write an identical row.
 * The button stays focusable with `aria-disabled` rather than the `disabled`
 * attribute, so a screen-reader user can find it and hear why (M-11 §11).
 *
 * ## The discard guard
 *
 * ✕, ยกเลิก, Escape and the scrim all raise `ปิดหน้าต่างนี้โดยไม่บันทึก?`
 * once the form is dirty, and close silently when it is not — exactly M-04's
 * behaviour. The discard dialog is a second dialog above this one and takes
 * focus on cancel.
 *
 * ## The image field (M-MENU-IMG)
 *
 * Disabled in create mode, with the reason stated. Both upload endpoints are
 * keyed by `menuItemId`, so no key exists before the dish is saved (M11-D09).
 * Rather than invent a pre-create upload, create says
 * `บันทึกรายการก่อน แล้วจึงเพิ่มรูปภาพ`. The edit-mode field reuses the
 * existing two-step upload — this drawer adds no second image system, and the
 * preview/uploading/failure treatment is the same one `RestaurantProfileForm`
 * already uses for the restaurant cover photo.
 *
 * Upload state (`photoState`, `imageOverrideUrl`) is owned by `useMenu`, not
 * this component and not the `item` prop — deliberately. Updating `item`
 * itself after a successful upload would give `baseline` (below) a new
 * object reference and re-run the "reset the form" effect, silently
 * discarding any name/price/description edit the merchant has mid-typed. The
 * preview instead prefers `imageOverrideUrl` over `item.imageUrl` and never
 * touches the form.
 */

export interface MenuItemDrawerProps {
  open: boolean;
  /** `null` is create mode. */
  item: MenuItem | null;
  categories: MenuCategory[];
  /** Preselected category in create mode, when the merchant used a section's own add action. */
  defaultCategoryId?: string | null;
  saving: boolean;
  /** A failed save. `forbidden` renders the 403 copy and offers no retry. */
  failure: { forbidden: boolean } | null;
  onCreate: (input: CreateMenuItemInput) => void;
  onUpdate: (menuItemId: string, input: UpdateMenuItemInput) => void;
  onClose: () => void;
  /** Opens the option editor for the dish being edited. Absent in create mode. */
  onEditOptions?: (item: MenuItem) => void;
  /**
   * M-MENU-IMG. Scoped to `item.id` by the caller — `{ status: 'idle' }` when
   * this is not the item currently uploading. Absent in create mode, where
   * the field stays disabled (M11-D09).
   */
  imagePhotoState?: MenuItemImageState;
  /** The resolved public URL from the most recent successful upload of `item`, if any. */
  imageOverrideUrl?: string | null;
  /** Opens the file picker's result; absent in create mode. */
  onUploadImage?: (file: File) => void;
}

interface FormState {
  name: string;
  description: string;
  price: string;
  categoryId: string;
  isAvailable: boolean;
}

function initialForm(item: MenuItem | null, defaultCategoryId: string | null, categories: MenuCategory[]): FormState {
  if (item) {
    return {
      name: item.name,
      description: item.description ?? '',
      price: satangToBahtInput(item.basePriceSatang),
      categoryId: item.categoryId,
      isAvailable: item.isAvailable,
    };
  }

  return {
    name: '',
    description: '',
    price: '',
    categoryId: defaultCategoryId ?? categories[0]?.id ?? '',
    // Matches `is_available default true`.
    isAvailable: true,
  };
}

export function MenuItemDrawer({
  open,
  item,
  categories,
  defaultCategoryId = null,
  saving,
  failure,
  onCreate,
  onUpdate,
  onClose,
  onEditOptions,
  imagePhotoState = { status: 'idle' },
  imageOverrideUrl = null,
  onUploadImage,
}: MenuItemDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const priceId = useId();
  const categoryId = useId();

  const [form, setForm] = useState<FormState>(() => initialForm(item, defaultCategoryId, categories));
  const [submitted, setSubmitted] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const baseline = useMemo(
    () => initialForm(item, defaultCategoryId, categories),
    [item, defaultCategoryId, categories],
  );

  // Reset whenever the drawer opens on a different dish (or on create).
  useEffect(() => {
    if (!open) return;
    setForm(baseline);
    setSubmitted(false);
    setDiscarding(false);
  }, [open, baseline]);

  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const dirty =
    form.name !== baseline.name ||
    form.description !== baseline.description ||
    form.price !== baseline.price ||
    form.categoryId !== baseline.categoryId ||
    form.isAvailable !== baseline.isAvailable;

  const requestClose = () => {
    if (saving) return;
    if (dirty) {
      setDiscarding(true);
      return;
    }
    onClose();
  };

  // The discard dialog owns focus while it is up, so the drawer's own trap
  // must stand down — two traps fighting is how focus ends up nowhere.
  useModalFocus({
    containerRef,
    open: open && !discarding,
    onClose: requestClose,
    initialFocusSelector: 'input, select',
  });

  if (!open) return null;

  const submit = () => {
    setSubmitted(true);
    if (!valid || !dirty || saving) {
      // Move focus to the first invalid field, per M-11 §11.
      const firstInvalid = containerRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      firstInvalid?.focus();
      return;
    }

    const parsed = parseBahtToSatang(form.price);
    if (!parsed.ok) return;

    if (item) {
      // A patch of only what changed — the API rejects an empty one, and
      // sending unchanged fields would touch `updated_at` for nothing.
      const patch: UpdateMenuItemInput = {};
      if (form.name !== baseline.name) patch.name = form.name.trim();
      if (form.description !== baseline.description) {
        patch.description = form.description.trim() === '' ? null : form.description.trim();
      }
      if (form.price !== baseline.price) patch.basePriceSatang = parsed.satang;
      if (form.categoryId !== baseline.categoryId) patch.categoryId = form.categoryId;
      if (form.isAvailable !== baseline.isAvailable) patch.isAvailable = form.isAvailable;
      onUpdate(item.id, patch);
      return;
    }

    onCreate({
      categoryId: form.categoryId,
      name: form.name.trim(),
      ...(form.description.trim() === '' ? {} : { description: form.description.trim() }),
      basePriceSatang: parsed.satang,
      isAvailable: form.isAvailable,
    });
  };

  const showError = (field: keyof typeof errors) => submitted && errors[field];
  const lastEdited = item ? formatClockTime(item.updatedAt) : null;

  // M-MENU-IMG. `imageOverrideUrl` (the just-uploaded public URL) wins over
  // `item.imageUrl` (the stored object key, resolved to a URL) — never the
  // other way around, so a completed upload shows immediately without
  // waiting on the item prop to catch up.
  const imageSrc = imageOverrideUrl ?? resolveImageUrl(item?.imageUrl ?? null);
  const uploadingImage = imagePhotoState.status === 'uploading';

  function onImageSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onUploadImage?.(file);
  }

  return (
    <>
      <div style={m.scrim} onClick={requestClose} data-testid="item-drawer-scrim" />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={m.drawer}
        data-testid="item-drawer"
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: spacing.md,
            padding: spacing.lg,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div>
            <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
              {item ? menuCopy.editItemTitle : menuCopy.createItemTitle}
            </h2>
            {item ? (
              <p style={{ ...m.fieldHint, marginTop: 4 }}>
                {item.name}
                {lastEdited ? ` · ${menuCopy.lastEdited(lastEdited)}` : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={menuCopy.cancel}
            style={m.iconButton}
            data-testid="item-drawer-close"
          >
            ✕
          </button>
        </header>

        <div style={m.drawerBody}>
          <Field
            id={nameId}
            label={menuCopy.fieldName}
            requirement={menuCopy.required}
            hint="text not null"
            error={showError('name') ? menuCopy.nameRequired : null}
          >
            <input
              id={nameId}
              style={m.textInput}
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              aria-invalid={showError('name') ? true : undefined}
              aria-describedby={showError('name') ? `${nameId}-error` : undefined}
            />
          </Field>

          <Field
            id={descriptionId}
            label={menuCopy.fieldDescription}
            requirement={menuCopy.optional}
            hint=""
            error={null}
          >
            <input
              id={descriptionId}
              style={m.textInput}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            />
          </Field>

          <Field
            id={priceId}
            label={menuCopy.fieldPrice}
            requirement={menuCopy.required}
            hint=""
            error={showError('price') ? errors.price ?? null : null}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <span aria-hidden style={{ ...m.price, fontSize: 16 }}>
                ฿
              </span>
              <input
                id={priceId}
                // A tablet raises a numeric keypad. The merchant never types ฿.
                inputMode="decimal"
                style={{ ...m.textInput, ...m.price }}
                value={form.price}
                onChange={(event) => setForm((prev) => ({ ...prev, price: event.target.value }))}
                aria-invalid={showError('price') ? true : undefined}
                aria-describedby={showError('price') ? `${priceId}-error` : undefined}
              />
            </div>
          </Field>

          <Field
            id={categoryId}
            label={menuCopy.fieldCategory}
            requirement={menuCopy.required}
            hint=""
            error={showError('categoryId') ? menuCopy.categoryRequired : null}
          >
            <select
              id={categoryId}
              style={m.textInput}
              value={form.categoryId}
              onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}
              aria-invalid={showError('categoryId') ? true : undefined}
              aria-describedby={showError('categoryId') ? `${categoryId}-error` : undefined}
            >
              <option value="">—</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
            <span style={m.fieldLabel}>{menuCopy.fieldAvailability}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, minHeight: m.TOUCH_TARGET }}>
              <input
                type="checkbox"
                checked={form.isAvailable}
                onChange={(event) => setForm((prev) => ({ ...prev, isAvailable: event.target.checked }))}
                style={{ width: 20, height: 20 }}
              />
              <span style={{ fontSize: 14, color: colors.textPrimary }}>
                {form.isAvailable ? menuCopy.available : menuCopy.unavailable}
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
            <span style={m.fieldLabel}>{menuCopy.fieldImage}</span>
            {item ? (
              <>
                <div
                  style={{
                    position: 'relative',
                    width: 120,
                    aspectRatio: '1 / 1',
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: colors.surfaceAccent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  data-testid="item-image-preview"
                >
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={menuCopy.imageAlt(item.name)}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: spacing.xs }} aria-hidden="true">
                      JPEG, PNG, WebP
                    </span>
                  )}

                  {uploadingImage ? (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'rgba(31, 26, 22, 0.45)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      role="status"
                      aria-live="polite"
                      data-testid="item-image-uploading"
                    >
                      <span style={{ color: colors.textInverse, fontSize: 12 }}>{menuCopy.saving}</span>
                    </div>
                  ) : null}
                </div>

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={onImageSelected}
                  style={m.visuallyHidden}
                  data-testid="item-image-input"
                />

                <button
                  type="button"
                  style={{ ...m.secondaryButton, alignSelf: 'flex-start' }}
                  onClick={() => imageInputRef.current?.click()}
                  disabled={uploadingImage}
                  data-testid="item-image-replace"
                >
                  {menuCopy.imageReplace}
                </button>

                {imagePhotoState.status === 'failed' ? (
                  <p style={m.fieldError} role="alert" data-testid="item-image-error">
                    {menuCopy.imageUploadFailed}
                  </p>
                ) : null}
                {imagePhotoState.status === 'success' ? (
                  <p style={{ fontSize: 13, color: colors.success, margin: 0 }} role="status" data-testid="item-image-success">
                    {menuCopy.imageUploadSuccess}
                  </p>
                ) : null}
              </>
            ) : (
              <p style={m.fieldHint} data-testid="image-create-hint">
                {menuCopy.imageEditOnly}
              </p>
            )}
          </div>

          {item && onEditOptions ? (
            <button
              type="button"
              onClick={() => onEditOptions(item)}
              style={{ ...m.secondaryButton, alignSelf: 'flex-start' }}
              data-testid="open-option-editor"
            >
              {menuCopy.optionsTitle(item.name)}
            </button>
          ) : null}

          {failure ? (
            <p style={m.fieldError} role="alert" data-testid="item-drawer-error">
              {failure.forbidden ? menuCopy.saveForbidden : menuCopy.saveFailed}
            </p>
          ) : null}
        </div>

        <div style={m.drawerFooter}>
          <button type="button" onClick={requestClose} style={{ ...m.secondaryButton, flex: 1 }}>
            {menuCopy.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            // aria-disabled, not disabled: a screen-reader user must be able to
            // find the button and hear why it will not act.
            aria-disabled={!valid || !dirty || saving}
            style={{
              ...m.primaryButton,
              flex: 1,
              opacity: !valid || !dirty || saving ? 0.6 : 1,
            }}
            data-testid="item-drawer-save"
          >
            {saving ? menuCopy.saving : menuCopy.save}
          </button>
        </div>

        {!valid || !dirty ? (
          <span style={m.visuallyHidden} aria-live="polite">
            {menuCopy.saveDisabledReason}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        open={discarding}
        title={menuCopy.discardTitle}
        body={[]}
        confirmLabel={menuCopy.discardConfirm}
        cancelLabel={menuCopy.cancel}
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
        onCancel={() => setDiscarding(false)}
        testId="discard-dialog"
      />
    </>
  );
}

/**
 * Every rule here mirrors a database constraint and stops there (M11-D11).
 * No length limit, no minimum price, no duplicate-name check — the schema
 * declares none and no document asks for one.
 */
function validate(form: FormState): Partial<Record<'name' | 'price' | 'categoryId', string>> {
  const errors: Partial<Record<'name' | 'price' | 'categoryId', string>> = {};

  if (form.name.trim() === '') errors.name = menuCopy.nameRequired;
  if (form.categoryId === '') errors.categoryId = menuCopy.categoryRequired;

  const price = parseBahtToSatang(form.price);
  if (!price.ok) {
    errors.price =
      price.reason === 'REQUIRED'
        ? menuCopy.priceRequired
        : price.reason === 'NEGATIVE'
          ? menuCopy.priceNegative
          : price.reason === 'TOO_PRECISE'
            ? menuCopy.pricePrecision
            : menuCopy.priceRequired;
  }

  return errors;
}

function Field({
  id,
  label,
  requirement,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  requirement: string;
  hint: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
      {/* A visible label tied by id. No placeholder-as-label anywhere. */}
      <label htmlFor={id} style={m.fieldLabel}>
        {label}
        <span style={{ fontSize: 12, color: requirement === menuCopy.required ? colors.danger : colors.textMuted }}>
          {requirement}
        </span>
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} style={m.fieldError}>
          {error}
        </p>
      ) : hint ? (
        <p style={m.fieldHint}>{hint}</p>
      ) : null}
    </div>
  );
}
