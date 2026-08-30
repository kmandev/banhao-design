'use client';

import { useCallback, useEffect, useState } from 'react';
import { repositories } from '../repositories';
import type { RestaurantMembership } from '../domain/restaurantMembership';
import {
  getStoredRestaurantId,
  setStoredRestaurantId,
  clearStoredRestaurantId,
} from '../lib/restaurantScope';

/**
 * Resolves the signed-in merchant's restaurant memberships and current
 * restaurant scope.
 *
 * "Current restaurant" is never trusted from localStorage alone — every read
 * here re-fetches `restaurant_members` fresh (no caching, matching
 * CapabilitiesService's own "read now" posture, DEC-APP-004) and a stored id
 * only survives into `currentRestaurantId` if it matches a restaurant the
 * merchant is still an active member of *right now*. A stale or
 * hand-edited id is silently dropped, not trusted and not surfaced as an
 * error — the caller just sees `currentRestaurantId: null` and routes back
 * to selection.
 */

export type RestaurantScopeState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; memberships: RestaurantMembership[]; currentRestaurantId: string | null };

export interface UseRestaurantScope {
  state: RestaurantScopeState;
  reload: () => void;
  /** No-ops if `restaurantId` is not one of this merchant's active memberships. */
  selectRestaurant: (restaurantId: string) => void;
}

export function useRestaurantScope(enabled: boolean): UseRestaurantScope {
  const [state, setState] = useState<RestaurantScopeState>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'loading' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    repositories.merchantRestaurant
      .listOwnMemberships()
      .then((memberships) => {
        if (cancelled) return;
        const stored = getStoredRestaurantId();
        const validStored =
          stored && memberships.some((m) => m.restaurantId === stored) ? stored : null;
        if (stored && !validStored) clearStoredRestaurantId();
        setState({ status: 'ready', memberships, currentRestaurantId: validStored });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'เกิดข้อผิดพลาด',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, nonce]);

  const selectRestaurant = useCallback((restaurantId: string) => {
    setState((prev) => {
      if (prev.status !== 'ready') return prev;
      const isMember = prev.memberships.some((m) => m.restaurantId === restaurantId);
      if (!isMember) return prev;
      setStoredRestaurantId(restaurantId);
      return { ...prev, currentRestaurantId: restaurantId };
    });
  }, []);

  return { state, reload, selectRestaurant };
}
