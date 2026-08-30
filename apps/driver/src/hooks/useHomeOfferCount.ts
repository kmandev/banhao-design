import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { repositories } from '../repositories';

/**
 * T2.4 / DG-05 — the informational pending-offer count on Home's offer row.
 *
 * One read per Home focus, reusing `RiderOfferInboxRepository.listPendingOffers`
 * — the exact query the offer inbox itself runs, never a second poller and
 * never a timer (Driver App Redesign §H, DG-05's own recommendation: "Fetch
 * it once on focus, with no timer, reusing the existing repository — one
 * read per Home focus, the same shape as the profile read").
 *
 * `null` means "not known right now" — loading, not yet fetched, or the read
 * failed — and is deliberately distinct from `0`, a real answer this hook
 * also gives. A failed count read is informational only: it is swallowed
 * here, never surfaced as Home's or the availability panel's error state.
 */
export function useHomeOfferCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        setCount(null);
        return;
      }

      let cancelled = false;

      repositories.offers
        .listPendingOffers()
        .then((offers) => {
          if (!cancelled) setCount(offers.length);
        })
        .catch(() => {
          if (!cancelled) setCount(null);
        });

      return () => {
        cancelled = true;
      };
    }, [enabled]),
  );

  return count;
}
