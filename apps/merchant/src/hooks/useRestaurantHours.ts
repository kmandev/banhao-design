'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DAYS_OF_WEEK,
  validateWeeklyHours,
  type DayOfWeek,
  type HoursValidationIssue,
  type RestaurantHoursDay,
} from '@banhao/validation';
import { ApiClientError } from '../lib/apiClient';
import { repositories, type MerchantHoursRepository } from '../repositories';
import type { WeeklyHoursDraft } from '../domain/restaurantHours';

/**
 * M-12's form state: the whole week, one dirty flag, one save.
 *
 * ## Why the draft always holds seven days
 *
 * The database stores only the days that have intervals, and a closed day is
 * simply absent. The form is the opposite: all seven are always rendered, so a
 * mistakenly-closed Sunday is visible rather than missing (M12-D02). This hook
 * is where those two shapes meet — {@link toDraft} fills the gaps and
 * {@link toRequest} drops them again.
 *
 * ## Turning a day off keeps its times
 *
 * `isOpen` lives only in the draft. A merchant may toggle a day by accident,
 * so the times survive in form state until save and come back when the day is
 * switched on again; losing them on a tap would make the switch dangerous
 * (M12-D04). At save, a closed day contributes no rows, which *is* how a day
 * is closed.
 *
 * ## No default times
 *
 * Opening a day with no stored hours gives one empty interval, not
 * `09:00–17:00`. A pre-filled plausible schedule is one a merchant might save
 * without noticing they never chose it (M12-D05).
 */

export type HoursState =
  | { status: 'loading' }
  | { status: 'error'; forbidden: boolean }
  | { status: 'ready' };

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'failed'; forbidden: boolean };

export interface UseRestaurantHours {
  state: HoursState;
  draft: WeeklyHoursDraft;
  issues: HoursValidationIssue[];
  dirty: boolean;
  saveState: SaveState;
  reload: () => void;
  setDayOpen: (dayOfWeek: DayOfWeek, isOpen: boolean) => void;
  setInterval: (dayOfWeek: DayOfWeek, index: number, patch: { opensAt?: string; closesAt?: string }) => void;
  addInterval: (dayOfWeek: DayOfWeek) => void;
  removeInterval: (dayOfWeek: DayOfWeek, index: number) => void;
  /** Fills the other six days from this one. Form only — nothing is written. */
  copyToAllDays: (dayOfWeek: DayOfWeek) => void;
  /** Reverts every field to the loaded schedule. */
  reset: () => void;
  save: () => Promise<void>;
}

/** Stored days to the seven-row form. A day with no rows renders closed. */
export function toDraft(days: RestaurantHoursDay[]): WeeklyHoursDraft {
  const byDay = new Map(days.map((day) => [day.dayOfWeek, day.intervals]));

  return DAYS_OF_WEEK.map((dayOfWeek) => {
    const intervals = byDay.get(dayOfWeek) ?? [];
    return {
      dayOfWeek,
      isOpen: intervals.length > 0,
      intervals: intervals.map((interval) => ({ ...interval })),
    };
  });
}

/**
 * The form back to a request.
 *
 * A closed day contributes an empty `intervals` array rather than being
 * omitted: the contract accepts either, and sending all seven makes the
 * request legible next to the screen that produced it. The server writes rows
 * only for the intervals, so a closed day still ends up as no rows.
 */
export function toRequest(draft: WeeklyHoursDraft) {
  return {
    days: draft.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      intervals: day.isOpen ? day.intervals : [],
    })),
  };
}

/** Only the open days' intervals are validated — a closed day cannot be wrong. */
function validateDraft(draft: WeeklyHoursDraft): HoursValidationIssue[] {
  return validateWeeklyHours(
    draft
      .filter((day) => day.isOpen)
      .map((day) => ({ dayOfWeek: day.dayOfWeek, intervals: day.intervals })),
  );
}

export function useRestaurantHours(
  restaurantId: string | null,
  repository: MerchantHoursRepository = repositories.merchantHours,
): UseRestaurantHours {
  const [state, setState] = useState<HoursState>({ status: 'loading' });
  const [loaded, setLoaded] = useState<WeeklyHoursDraft>(() => toDraft([]));
  const [draft, setDraft] = useState<WeeklyHoursDraft>(() => toDraft([]));
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setState({ status: 'loading' });

    repository
      .listHours(restaurantId)
      .then((days) => {
        if (cancelled) return;
        const next = toDraft(days);
        setLoaded(next);
        setDraft(next);
        setState({ status: 'ready' });
        setSaveState({ status: 'idle' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const forbidden =
          error instanceof ApiClientError &&
          (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN');
        setState({ status: 'error', forbidden });
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, nonce, repository]);

  const issues = useMemo(() => validateDraft(draft), [draft]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(loaded), [draft, loaded]);

  const patchDay = useCallback(
    (dayOfWeek: DayOfWeek, patch: (day: WeeklyHoursDraft[number]) => WeeklyHoursDraft[number]) => {
      setDraft((prev) => prev.map((day) => (day.dayOfWeek === dayOfWeek ? patch(day) : day)));
      setSaveState({ status: 'idle' });
    },
    [],
  );

  const setDayOpen = useCallback(
    (dayOfWeek: DayOfWeek, isOpen: boolean) => {
      patchDay(dayOfWeek, (day) => ({
        ...day,
        isOpen,
        // Opening a day that has never had hours gives one empty interval with
        // no invented default. Turning a day off keeps whatever was there.
        intervals:
          isOpen && day.intervals.length === 0 ? [{ opensAt: '', closesAt: '' }] : day.intervals,
      }));
    },
    [patchDay],
  );

  const setIntervalValue = useCallback(
    (dayOfWeek: DayOfWeek, index: number, patch: { opensAt?: string; closesAt?: string }) => {
      patchDay(dayOfWeek, (day) => ({
        ...day,
        intervals: day.intervals.map((interval, i) => (i === index ? { ...interval, ...patch } : interval)),
      }));
    },
    [patchDay],
  );

  const addInterval = useCallback(
    (dayOfWeek: DayOfWeek) => {
      patchDay(dayOfWeek, (day) => ({
        ...day,
        isOpen: true,
        intervals: [...day.intervals, { opensAt: '', closesAt: '' }],
      }));
    },
    [patchDay],
  );

  const removeInterval = useCallback(
    (dayOfWeek: DayOfWeek, index: number) => {
      patchDay(dayOfWeek, (day) => {
        const intervals = day.intervals.filter((_, i) => i !== index);
        return {
          ...day,
          intervals,
          // Removing the last interval switches the day to closed, keeping the
          // switch and the intervals consistent with each other.
          isOpen: intervals.length > 0,
        };
      });
    },
    [patchDay],
  );

  const copyToAllDays = useCallback((dayOfWeek: DayOfWeek) => {
    setDraft((prev) => {
      const source = prev.find((day) => day.dayOfWeek === dayOfWeek);
      if (!source) return prev;
      return prev.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? day
          : {
              ...day,
              isOpen: source.isOpen,
              intervals: source.intervals.map((interval) => ({ ...interval })),
            },
      );
    });
    setSaveState({ status: 'idle' });
  }, []);

  const reset = useCallback(() => {
    setDraft(loaded);
    setSaveState({ status: 'idle' });
  }, [loaded]);

  const save = useCallback(async () => {
    if (!restaurantId) return;
    // No request is sent while the form is invalid (M-12 §05 S5).
    if (validateDraft(draft).length > 0) return;

    setSaveState({ status: 'saving' });
    try {
      const response = await repository.saveHours(restaurantId, toRequest(draft));
      // The saved week is re-read rather than assumed, so what the merchant
      // sees afterwards is what the database holds (M-12 §05 S4).
      const next = toDraft(response.days);
      setLoaded(next);
      setDraft(next);
      setSaveState({ status: 'saved' });
    } catch (error: unknown) {
      const forbidden =
        error instanceof ApiClientError &&
        (error.code === 'NOT_RESTAURANT_MEMBER' || error.code === 'FORBIDDEN');
      setSaveState({ status: 'failed', forbidden });
    }
  }, [restaurantId, draft, repository]);

  return {
    state,
    draft,
    issues,
    dirty,
    saveState,
    reload,
    setDayOpen,
    setInterval: setIntervalValue,
    addInterval,
    removeInterval,
    copyToAllDays,
    reset,
    save,
  };
}
