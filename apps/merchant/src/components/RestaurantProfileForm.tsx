'use client';

import { useRef, useState } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import { useRestaurantProfile } from '../hooks/useRestaurantProfile';
import { profileCopy } from '../lib/menuCopy';
import { resolveImageUrl } from '../lib/imageUrl';
import { repositories, type MerchantProfileRepository } from '../repositories';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorState } from './ErrorState';
import { Spinner } from './Spinner';
import * as m from '../lib/menuStyles';

/**
 * M-10 — the restaurant's descriptive profile.
 *
 * One form, one save (M10-D08) — no per-field save button, matching M-12's
 * own precedent for this app. The cover photo is the exception: it commits
 * immediately on a successful upload (M10-D01, reusing
 * `RestaurantCoverController` exactly as it exists today), independent of the
 * text-field save below it.
 *
 * `status`, `lat` and `lng` render read-only. There is no control anywhere on
 * this page that can change any of them — `status` transitions and
 * lat/lng editing are both explicitly out of scope (M10-D05, M10-D06).
 */
export function RestaurantProfileForm({
  restaurantId,
  restaurantName,
  repository = repositories.merchantProfile,
}: {
  restaurantId: string;
  restaurantName: string;
  repository?: MerchantProfileRepository;
}) {
  const profile = useRestaurantProfile(restaurantId, repository);
  const [discarding, setDiscarding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (profile.state.status === 'loading') {
    return <Spinner label={profileCopy.loading} />;
  }

  if (profile.state.status === 'error') {
    return profile.state.forbidden ? (
      <ErrorState title={profileCopy.saveForbidden} />
    ) : (
      <ErrorState
        title={profileCopy.loadFailed}
        retryLabel={profileCopy.retry}
        onRetry={profile.reload}
      />
    );
  }

  const saving = profile.saveState.status === 'saving';
  const blocked = profile.issues.nameRequired || profile.issues.phoneInvalid;
  const saveDisabled = !profile.dirty || blocked || saving;
  const uploading = profile.photoState.status === 'uploading';
  const photoUrl = resolveImageUrl(profile.imageObjectKey);

  function onPickPhoto() {
    if (uploading) return;
    fileInputRef.current?.click();
  }

  function onPhotoSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void profile.uploadCoverPhoto(file);
  }

  return (
    <div style={m.contentPage} data-testid="restaurant-profile-form">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.textPrimary, margin: 0 }}>
            {profileCopy.pageTitle}
          </h1>
          {/* Only ACTIVE has confirmed Thai copy (M-10 §10) — every other
              status renders its raw value rather than an invented label, since
              the design leaves the other four unspecified (assumption #6). */}
          <span style={m.badge} data-testid="restaurant-status-pill">
            {profile.restaurantStatus === 'ACTIVE'
              ? 'เปิดให้บริการ'
              : (profile.restaurantStatus ?? '')}
          </span>
        </div>
        <p style={{ ...m.fieldHint, marginTop: 4 }} data-testid="profile-save-footer">
          {profile.dirty ? profileCopy.dirtyFooter : profileCopy.savedFooter('')}
        </p>
      </div>

      {/* Cover photo — §05, states 1/2/4/5/6. Independent of the text-field save. */}
      <div style={m.panel} data-testid="profile-photo-panel">
        <div
          style={{
            position: 'relative',
            aspectRatio: '16 / 9',
            width: '100%',
            borderRadius: 12,
            overflow: 'hidden',
            backgroundColor: colors.surfaceAccent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          data-testid="profile-photo-preview"
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={profileCopy.photoAlt(restaurantName)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <span style={{ fontSize: 13, color: colors.textMuted }} aria-hidden="true">
              {profileCopy.photoNoPhoto}
            </span>
          )}

          {uploading ? (
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
              data-testid="profile-photo-uploading"
            >
              <span style={{ color: colors.textInverse, fontSize: 13 }}>{profileCopy.saving}</span>
            </div>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onPhotoSelected}
          style={m.visuallyHidden}
          data-testid="profile-photo-input"
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
          <button
            type="button"
            style={m.secondaryButton}
            aria-label={profileCopy.photoReplaceAria}
            onClick={onPickPhoto}
            disabled={uploading}
            data-testid="profile-photo-replace"
          >
            {profileCopy.photoReplace}
          </button>
          <p style={{ ...m.fieldHint, margin: 0 }}>{profileCopy.photoGuidance}</p>
        </div>

        {profile.photoState.status === 'failed' ? (
          <p style={m.fieldError} role="alert" data-testid="profile-photo-error">
            {profileCopy.photoUploadFailed}
          </p>
        ) : null}
        {profile.photoState.status === 'success' ? (
          <p style={{ fontSize: 13, color: colors.success, margin: 0 }} role="status" data-testid="profile-photo-success">
            {profileCopy.photoUploadSuccess}
          </p>
        ) : null}
      </div>

      {/* Text fields — §04. */}
      <div style={{ ...m.panel, display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={m.fieldLabel}>{profileCopy.fieldName}</span>
          <input
            type="text"
            style={m.textInput}
            value={profile.draft.name}
            onChange={(event) => profile.setField('name', event.target.value)}
            aria-invalid={profile.issues.nameRequired ? true : undefined}
            aria-describedby={profile.issues.nameRequired ? 'profile-name-error' : undefined}
            data-testid="profile-field-name"
          />
          {profile.issues.nameRequired ? (
            <p id="profile-name-error" style={m.fieldError} role="alert">
              {profileCopy.nameRequired}
            </p>
          ) : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={m.fieldLabel}>{profileCopy.fieldPhone}</span>
          <input
            type="text"
            style={m.textInput}
            value={profile.draft.phone}
            onChange={(event) => profile.setField('phone', event.target.value)}
            aria-invalid={profile.issues.phoneInvalid ? true : undefined}
            aria-describedby={profile.issues.phoneInvalid ? 'profile-phone-error' : undefined}
            data-testid="profile-field-phone"
          />
          {profile.issues.phoneInvalid ? (
            <p id="profile-phone-error" style={m.fieldError} role="alert">
              {profileCopy.phoneInvalid}
            </p>
          ) : null}
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={m.fieldLabel}>{profileCopy.fieldDescription}</span>
          <textarea
            style={{ ...m.textInput, minHeight: 96, paddingTop: spacing.sm, paddingBottom: spacing.sm }}
            value={profile.draft.description}
            onChange={(event) => profile.setField('description', event.target.value)}
            data-testid="profile-field-description"
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={m.fieldLabel}>{profileCopy.fieldAddress}</span>
          <input
            type="text"
            style={m.textInput}
            value={profile.draft.addressLine}
            onChange={(event) => profile.setField('addressLine', event.target.value)}
            data-testid="profile-field-address"
          />
          {/* Advisory only (M10-Q-02 unresolved) — never blocks save. */}
          {profile.issues.addressAdvisory ? (
            <p style={m.fieldHint} data-testid="profile-address-advisory">
              {profileCopy.addressAdvisory}
            </p>
          ) : null}
        </label>

        {profile.coordinates ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={m.fieldLabel}>{profileCopy.fieldCoordinates}</span>
            <p style={{ ...m.textInput, display: 'flex', alignItems: 'center', color: colors.textMuted, backgroundColor: colors.surface }}>
              {profile.coordinates.lat.toFixed(4)}° N, {profile.coordinates.lng.toFixed(4)}° E
            </p>
            <p style={m.fieldHint}>{profileCopy.coordinatesHint}</p>
          </div>
        ) : null}
      </div>

      {profile.saveState.status === 'failed' ? (
        <div role="alert" style={{ ...m.panel, borderColor: colors.danger }} data-testid="profile-save-error">
          <strong style={{ color: colors.danger, fontSize: 14 }}>
            {profile.saveState.forbidden ? profileCopy.saveForbidden : profileCopy.saveFailed}
          </strong>
        </div>
      ) : null}

      {profile.saveState.status === 'saved' ? (
        <p style={{ fontSize: 14, color: colors.success }} role="status" data-testid="profile-saved">
          {profileCopy.saved}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: spacing.sm }}>
        <button
          type="button"
          style={{ ...m.secondaryButton, flex: 1 }}
          onClick={() => (profile.dirty ? setDiscarding(true) : undefined)}
          data-testid="profile-cancel"
        >
          {profileCopy.cancel}
        </button>
        <button
          type="button"
          style={{ ...m.primaryButton, flex: 1, opacity: saveDisabled ? 0.6 : 1 }}
          aria-disabled={saveDisabled}
          aria-label={saveDisabled ? profileCopy.saveDisabledReason : undefined}
          onClick={() => {
            if (saveDisabled) return;
            void profile.save();
          }}
          data-testid="profile-save"
        >
          {saving ? profileCopy.saving : profileCopy.save}
        </button>
      </div>

      <ConfirmDialog
        open={discarding}
        title={profileCopy.discardTitle}
        body={[]}
        confirmLabel={profileCopy.discardLeave}
        cancelLabel={profileCopy.discardStay}
        onConfirm={() => {
          profile.reset();
          setDiscarding(false);
        }}
        onCancel={() => setDiscarding(false)}
        testId="profile-discard-dialog"
      />
    </div>
  );
}
