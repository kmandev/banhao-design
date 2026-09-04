'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError } from '../lib/apiClient';
import { repositories, type MerchantAvailabilityRepository } from '../repositories';
import { availabilityErrorMessage } from '../lib/availabilityDisplay';
import type { RestaurantAvailabilityMode } from '@banhao/validation';

/**
 * M-13 Merchant Availability (Normal / Busy / Paused) — the board header's
 * mode state, mirroring `useRestaurantProfile.ts`'s load/save shape.
 *
 * ## Server-confirmed state only — AV-D04
 *
 * `mode`/`busyPrepMinutes` are set only from what Supabase returns on load
 * and what `RestaurantAvailabilityController` returns on a successful save
 * (re-read, not echoed — the same posture M-10/M-12 already establish). A
 * command in flight never optimistically changes them: AC-02/AC-13 require
 * that a failed request leave the rendered pill unchanged, and that two
 * concurrent sessions each converge on whichever write actually landed
 * rather than displaying a stale local guess. `reload()` after every
 * successful save is what makes that convergence visible without Realtime.
 */

export type AvailabilityState =
  | { status: 'loading' }
  | { status: 'error'; forbidden: boolean }
  | { status: 'ready'; mode: RestaurantAvailabilityMode; busyPrepMinutes: number | null };

export type AvailabilitySaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'failed'; message: string };

export interface UseAvailability {
  state: AvailabilityState;
  saveState: AvailabilitySaveState;
  reload: () => void;
  /** Resolves `true` on success, `false` on failure — the caller's one signal for whether to close its own dialog (`saveState` alone is a stale closure by the time an async caller reads it). */
  setNormal: () => Promise<boolean>;
  setBusy: (busyPrepMinutes: number) => Promise<boolean>;
  setPaused: () => Promise<boolean>;
}

function isForbidden(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN')
  );
}

export function useAvailability(
  restaurantId: string | null,
  repository: MerchantAvailabilityRepository = repositories.merchantAvailability,
): UseAvailability {
  const [state, setState] = useState<AvailabilityState>({ status: 'loading' });
  const [saveState, setSaveState] = useState<AvailabilitySaveState>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setState({ status: 'loading' });

    repository
      .getAvailability(restaurantId)
      .then((row) => {
        if (cancelled) return;
        setState({ status: 'ready', mode: row.availability_mode, busyPrepMinutes: row.busy_prep_minutes });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', forbidden: isForbidden(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, nonce, repository]);

  const applyChange = useCallback(
    async (input: Parameters<MerchantAvailabilityRepository['setAvailability']>[1]): Promise<boolean> => {
      if (!restaurantId) return false;

      setSaveState({ status: 'saving' });
      try {
        const response = await repository.setAvailability(restaurantId, input);
        setState({
          status: 'ready',
          mode: response.availabilityMode,
          busyPrepMinutes: response.busyPrepMinutes,
        });
        setSaveState({ status: 'idle' });
        return true;
      } catch (error: unknown) {
        // AC-02: on failure, the rendered state is left exactly as it was —
        // `state` is never touched here, only `saveState`.
        setSaveState({ status: 'failed', message: availabilityErrorMessage(error) });
        return false;
      }
    },
    [restaurantId, repository],
  );

  const setNormal = useCallback(() => applyChange({ mode: 'NORMAL' }), [applyChange]);
  const setBusy = useCallback(
    (busyPrepMinutes: number) => applyChange({ mode: 'BUSY', busyPrepMinutes: busyPrepMinutes as 10 | 20 | 30 | 45 | 60 }),
    [applyChange],
  );
  const setPaused = useCallback(() => applyChange({ mode: 'PAUSED' }), [applyChange]);

  return { state, saveState, reload, setNormal, setBusy, setPaused };
}
