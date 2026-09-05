'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '../lib/apiClient';
import { repositories, type MerchantMenuRepository } from '../repositories';
import type { MenuSection } from '../domain/menu';
import { ALLOWED_COVER_MIME_TYPES } from '../lib/imageUrl';

/**
 * The M-11 overview's data: load, refetch, and the optimistic availability
 * switch.
 *
 * ## Why availability is optimistic here and nowhere else
 *
 * The UX specification calls `ปิดขายวันนี้` the single most frequent merchant
 * action during service and requires it to cost nothing. A merchant taps it
 * while cooking and does not watch the result, so the switch moves at once and
 * **reverts** if the write fails (M11-D03) — the same pattern
 * `useOrderActions` already applies to a failed board transition, so no new
 * failure vocabulary is introduced.
 *
 * Every other write refetches instead. They happen inside a drawer the
 * merchant is already looking at, so a round trip is not the cost the switch's
 * is, and a refetch is the honest answer about what the server now holds.
 *
 * ## No Realtime
 *
 * No catalog table is in `supabase_realtime` (M11-C08). Two devices editing
 * one menu will not see each other, and this hook does not pretend otherwise:
 * it refetches on window focus and nothing more.
 */

export type MenuState =
  | { status: 'loading' }
  | { status: 'error'; forbidden: boolean }
  | { status: 'ready'; sections: MenuSection[] };

/**
 * M-MENU-IMG — the menu-item image upload's state, scoped to whichever item
 * is mid-upload. `idle` unless a `menuItemId` is present, so a caller can
 * tell whether a given open drawer should render it (see `MenuOverview`).
 */
export type MenuItemImageState =
  | { status: 'idle' }
  | { status: 'uploading'; menuItemId: string }
  | { status: 'failed'; menuItemId: string }
  | { status: 'success'; menuItemId: string };

export interface UseMenu {
  state: MenuState;
  /** Refetches from the server. Used after every write except the switch. */
  reload: () => void;
  /** Moves the switch immediately; reverts and reports on failure. */
  setAvailability: (menuItemId: string, isAvailable: boolean) => Promise<void>;
  /** The id whose availability write is in flight, so the row can dim. */
  pendingAvailabilityId: string | null;
  /** Set when an availability write failed; cleared by the next attempt. */
  availabilityError: boolean;
  dismissAvailabilityError: () => void;
  /** The menu-item image upload's current state (M11-D09, edit-only). */
  itemImageState: MenuItemImageState;
  /**
   * The resolved public URL from the most recent successful upload, paired
   * with the item it belongs to. `null` until a success — the drawer falls
   * back to `item.imageUrl` (the stored object key) until then, exactly the
   * way `useRestaurantProfile.imageObjectKey` is read before its first upload.
   */
  itemImageUrl: { menuItemId: string; imageUrl: string } | null;
  /**
   * Two-step upload against the existing `menu-items/:menuItemId/image`
   * routes — no new mechanism. Deliberately does **not** mutate the `item`
   * object a drawer holds: doing so would give `MenuItemDrawer`'s `baseline`
   * a new reference and reset any unsaved name/price/description edit the
   * merchant has mid-typed. The caller reads the result from `itemImageState`
   * / `itemImageUrl` instead.
   */
  uploadItemImage: (menuItemId: string, file: File) => Promise<void>;
}

export function useMenu(
  restaurantId: string | null,
  repository: MerchantMenuRepository = repositories.merchantMenu,
): UseMenu {
  const [state, setState] = useState<MenuState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const [pendingAvailabilityId, setPendingAvailabilityId] = useState<string | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [itemImageState, setItemImageState] = useState<MenuItemImageState>({ status: 'idle' });
  const [itemImageUrl, setItemImageUrl] = useState<{ menuItemId: string; imageUrl: string } | null>(
    null,
  );

  // Read inside the focus listener so it always sees the current value without
  // the listener needing to be torn down and rebuilt on every state change.
  const restaurantIdRef = useRef(restaurantId);
  restaurantIdRef.current = restaurantId;

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setState({ status: 'loading' });

    repository
      .listMenu(restaurantId)
      .then((sections) => {
        if (!cancelled) setState({ status: 'ready', sections });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A 403 is not a network problem and offering a retry for it would be
        // dishonest — the UX specification's error table gives it its own copy
        // and no retry.
        const forbidden =
          error instanceof ApiClientError &&
          (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN');
        setState({ status: 'error', forbidden });
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, nonce, repository]);

  // Refetch when the tab regains focus — the closest this screen gets to
  // staying current without Realtime it does not have.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onFocus = () => {
      if (restaurantIdRef.current) reload();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const setAvailability = useCallback(
    async (menuItemId: string, isAvailable: boolean) => {
      setAvailabilityError(false);
      setPendingAvailabilityId(menuItemId);

      // Optimistic: the switch moves before the request is sent.
      setState((previous) =>
        previous.status === 'ready'
          ? { ...previous, sections: patchAvailability(previous.sections, menuItemId, isAvailable) }
          : previous,
      );

      try {
        await repository.setItemAvailability(menuItemId, isAvailable);
      } catch {
        // Revert to exactly the previous position. The optimistic write is
        // never left ambiguous (M-11 §03 A4).
        setState((previous) =>
          previous.status === 'ready'
            ? {
                ...previous,
                sections: patchAvailability(previous.sections, menuItemId, !isAvailable),
              }
            : previous,
        );
        setAvailabilityError(true);
      } finally {
        setPendingAvailabilityId(null);
      }
    },
    [repository],
  );

  const dismissAvailabilityError = useCallback(() => setAvailabilityError(false), []);

  const uploadItemImage = useCallback(
    async (menuItemId: string, file: File) => {
      if (!ALLOWED_COVER_MIME_TYPES.includes(file.type as (typeof ALLOWED_COVER_MIME_TYPES)[number])) {
        setItemImageState({ status: 'failed', menuItemId });
        return;
      }

      setItemImageState({ status: 'uploading', menuItemId });
      try {
        const { uploadUrl, objectKey } = await repository.requestItemImageUpload(
          menuItemId,
          file.type,
        );

        // The presigned R2 URL, not the API — bytes never transit Cloud Run
        // (MenuItemImageController's own doc comment).
        const putResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!putResponse.ok) {
          // Preserve whatever image state existed before this attempt —
          // nothing here has touched it.
          setItemImageState({ status: 'failed', menuItemId });
          return;
        }

        const { imageUrl } = await repository.completeItemImageUpload(menuItemId, objectKey);
        setItemImageUrl({ menuItemId, imageUrl });
        setItemImageState({ status: 'success', menuItemId });
        // Deliberately no reload() here. `MenuOverview.categories` is a
        // `useMemo` over `state.sections`, and `MenuItemDrawer.baseline` is a
        // `useMemo` over `categories` — so a reload gives `baseline` a new
        // object reference purely from the array being recreated, which
        // reruns the drawer's "reset the form" effect and would silently
        // discard an unsaved name/price/description edit even though `item`
        // itself never changed. The drawer already shows the new photo from
        // `itemImageUrl` above; the background list catches up next time
        // `reload()` runs for an unrelated reason (another write, or the
        // existing refetch-on-window-focus).
      } catch {
        setItemImageState({ status: 'failed', menuItemId });
      }
    },
    [repository],
  );

  return {
    state,
    reload,
    setAvailability,
    pendingAvailabilityId,
    availabilityError,
    dismissAvailabilityError,
    itemImageState,
    itemImageUrl,
    uploadItemImage,
  };
}

function patchAvailability(
  sections: MenuSection[],
  menuItemId: string,
  isAvailable: boolean,
): MenuSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.id === menuItemId ? { ...item, isAvailable } : item,
    ),
  }));
}
