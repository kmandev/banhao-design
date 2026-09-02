'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '../lib/apiClient';
import { repositories, type MerchantProfileRepository } from '../repositories';
import {
  hasBlockingIssue,
  toDraft,
  toRequest,
  validateProfileDraft,
  type RestaurantProfileDraft,
} from '../domain/restaurantProfile';
import { ALLOWED_COVER_MIME_TYPES } from '../lib/imageUrl';

export type ProfileState =
  | { status: 'loading' }
  | { status: 'error'; forbidden: boolean }
  | { status: 'ready' };

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'failed'; forbidden: boolean };

export type PhotoState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'failed' }
  | { status: 'success' };

export interface UseRestaurantProfile {
  state: ProfileState;
  draft: RestaurantProfileDraft;
  dirty: boolean;
  issues: ReturnType<typeof validateProfileDraft>;
  saveState: SaveState;
  /** Read-only — `status` has no merchant-facing write path (M10-D05). */
  restaurantStatus: string | null;
  /** Read-only display only — lat/lng stay non-editable in Phase 1 (M10-D06). */
  coordinates: { lat: number; lng: number } | null;
  /** Bare object key from `restaurants.image_url`, or null if never set. */
  imageObjectKey: string | null;
  photoState: PhotoState;
  reload: () => void;
  setField: (field: keyof RestaurantProfileDraft, value: string) => void;
  reset: () => void;
  save: () => Promise<void>;
  uploadCoverPhoto: (file: File) => Promise<void>;
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN')
  );
}

const EMPTY_DRAFT: RestaurantProfileDraft = {
  name: '',
  description: '',
  phone: '',
  addressLine: '',
};

export function useRestaurantProfile(
  restaurantId: string | null,
  repository: MerchantProfileRepository = repositories.merchantProfile,
): UseRestaurantProfile {
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [loaded, setLoaded] = useState<RestaurantProfileDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<RestaurantProfileDraft>(EMPTY_DRAFT);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [restaurantStatus, setRestaurantStatus] = useState<string | null>(null);
  const [coordinates, setCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [imageObjectKey, setImageObjectKey] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<PhotoState>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setState({ status: 'loading' });

    repository
      .getProfile(restaurantId)
      .then((row) => {
        if (cancelled) return;
        const next = toDraft(row);
        setLoaded(next);
        setDraft(next);
        setRestaurantStatus(row.status);
        setCoordinates(row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null);
        setImageObjectKey(row.image_url);
        setState({ status: 'ready' });
        setSaveState({ status: 'idle' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', forbidden: isForbidden(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, nonce, repository]);

  const issues = useMemo(() => validateProfileDraft(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(loaded), [draft, loaded]);

  const setField = useCallback((field: keyof RestaurantProfileDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaveState({ status: 'idle' });
  }, []);

  const reset = useCallback(() => {
    setDraft(loaded);
    setSaveState({ status: 'idle' });
  }, [loaded]);

  const save = useCallback(async () => {
    if (!restaurantId) return;
    // No request is sent while the form is invalid — mirrors M-12 §05 S5.
    if (hasBlockingIssue(validateProfileDraft(draft))) return;

    setSaveState({ status: 'saving' });
    try {
      const response = await repository.saveProfile(restaurantId, toRequest(draft));
      const next = toDraft(response);
      setLoaded(next);
      setDraft(next);
      setSaveState({ status: 'saved' });
    } catch (error: unknown) {
      setSaveState({ status: 'failed', forbidden: isForbidden(error) });
    }
  }, [restaurantId, draft, repository]);

  const uploadCoverPhoto = useCallback(
    async (file: File) => {
      if (!restaurantId) return;
      if (!ALLOWED_COVER_MIME_TYPES.includes(file.type as (typeof ALLOWED_COVER_MIME_TYPES)[number])) {
        setPhotoState({ status: 'failed' });
        return;
      }

      setPhotoState({ status: 'uploading' });
      try {
        const { uploadUrl, objectKey } = await repository.requestCoverUpload(
          restaurantId,
          file.type,
        );

        // The presigned R2 URL, not the API — bytes never transit Cloud Run
        // (M-11's own `requestUploadUrl` doc comment).
        const putResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putResponse.ok) {
          setPhotoState({ status: 'failed' });
          return;
        }

        const { imageUrl } = await repository.completeCoverUpload(restaurantId, objectKey);
        setImageObjectKey(imageUrl);
        setPhotoState({ status: 'success' });
      } catch {
        setPhotoState({ status: 'failed' });
      }
    },
    [restaurantId, repository],
  );

  return {
    state,
    draft,
    dirty,
    issues,
    saveState,
    restaurantStatus,
    coordinates,
    imageObjectKey,
    photoState,
    reload,
    setField,
    reset,
    save,
    uploadCoverPhoto,
  };
}
