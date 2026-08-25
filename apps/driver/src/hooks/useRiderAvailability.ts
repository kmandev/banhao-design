import { useCallback, useEffect, useState } from 'react';
import type { RiderAvailability } from '../domain/riderAvailability';
import { repositories } from '../repositories';

/**
 * The rider's availability, and the two transitions that change it.
 *
 * ## The order of operations is the whole point
 *
 * Going online is **position first, flag second**:
 *
 *   foreground permission → one reading → POST /api/v1/rider/location → is_online = true
 *
 * DEC-037 makes dispatch eligibility `APPROVED` + online + *a valid recorded
 * location*, and `BroadcastDispatchStrategy` filters on
 * `is_online = true AND location IS NOT NULL`. Setting the flag first would
 * produce a rider who is online in the UI and in the table but still outside
 * the candidate pool — visibly available, receiving nothing, with no way to
 * tell. Every failure below therefore stops before the flag is written, and the
 * rider stays offline and is told why.
 *
 * There is a second reason for this order: `rider_availability` rows are created
 * lazily by `RiderLocationService` on a rider's first location write. For a
 * rider who has never been online, the location POST is what brings the row
 * into existence — so the flag write has something to guard against.
 *
 * Going offline is the flag alone. No position is captured, and none is needed:
 * a rider stepping away should not have to hand over a location to do it.
 *
 * ## What this hook deliberately does not do
 *
 * No interval, no `watchPositionAsync`, no background task, no re-capture on a
 * timer. The only two triggers are the rider tapping the toggle and the rider
 * tapping refresh — see `lib/deviceLocation.ts` for why (Q-012 and TQ-016 are
 * both `OPEN`, and V1.1 §18 risk 11 warns against aggressive polling).
 */

export type AvailabilityView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; availability: RiderAvailability };

export interface RiderAvailabilityController {
  view: AvailabilityView;
  /** True while a toggle is in flight. The control is inert, never optimistic. */
  busy: boolean;
  /** The last transition failure, cleared when a new one starts. */
  actionError: string | null;
  goOnline: () => Promise<void>;
  goOffline: () => Promise<void>;
  refresh: () => void;
}

/**
 * Stand-in for a rider the gate has already refused.
 *
 * Never rendered as a status — `HomeScreen` shows the approval gate instead of
 * any availability UI when `enabled` is false. It exists so the hook has a
 * settled, non-loading value rather than hanging in `loading` forever for a
 * rider it will never query for.
 */
const OFFLINE_PLACEHOLDER: RiderAvailability = { isOnline: false, locationRecordedAt: null };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
}

/**
 * @param enabled Whether to read at all. False for a rider the approval gate
 *   has already refused — there is no reason to query availability for someone
 *   who cannot be offered work, and no screen to show it on.
 */
export function useRiderAvailability(enabled: boolean): RiderAvailabilityController {
  const [view, setView] = useState<AvailabilityView>(
    enabled ? { status: 'loading' } : { status: 'ready', availability: OFFLINE_PLACEHOLDER },
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setView({ status: 'loading' });

    repositories.availability
      .getOwnAvailability()
      .then((availability) => {
        if (!cancelled) setView({ status: 'ready', availability });
      })
      .catch((error: unknown) => {
        if (!cancelled) setView({ status: 'error', message: messageOf(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const goOnline = useCallback(async () => {
    setActionError(null);
    setBusy(true);

    try {
      // 1. Permission, then exactly one foreground reading.
      const position = await repositories.deviceLocation.capturePosition();

      // 2. The server records it. Only the service role may write the
      //    coordinate columns, so this is the only path they have.
      await repositories.location.reportPosition(position);

      // 3. Only now is the flag set — and the value that lands in state is the
      //    one the server reports back, never the one that was requested.
      const availability = await repositories.availability.setOnline(true);
      setView({ status: 'ready', availability });
    } catch (error) {
      // The rider stays offline. Whatever failed — permission, the fix, the
      // network, the write — the flag was not set, and the UI must not suggest
      // otherwise.
      setActionError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const goOffline = useCallback(async () => {
    setActionError(null);
    setBusy(true);

    try {
      const availability = await repositories.availability.setOnline(false);
      setView({ status: 'ready', availability });
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }, []);

  return { view, busy, actionError, goOnline, goOffline, refresh };
}
