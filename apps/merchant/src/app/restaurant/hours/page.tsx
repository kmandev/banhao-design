'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';
import { useRestaurantScope } from '../../../hooks/useRestaurantScope';
import { Spinner } from '../../../components/Spinner';
import { NetworkErrorState } from '../../../components/ErrorState';
import { AppShell } from '../../../components/AppShell';
import { WeeklyHoursForm } from '../../../components/WeeklyHoursForm';
import { hoursCopy } from '../../../lib/menuCopy';

/**
 * M-12 — `เวลาทำการ`, under `ร้านของฉัน`.
 *
 * Not its own top-level nav item: the UX specification fixes the five merchant
 * destinations, and hours is one page of the restaurant profile (M12-D10).
 * Adding a sixth item for a page edited monthly would crowd the two used
 * daily.
 *
 * `/restaurant` has no index page yet — M-10 (restaurant profile) is undesigned
 * and unbuilt, so `ร้านของฉัน` points here directly rather than at a section
 * landing page that does not exist.
 */
export default function RestaurantHoursPage() {
  const router = useRouter();
  const { initialising, session } = useAuth();
  const scope = useRestaurantScope(!initialising && session !== null);

  useEffect(() => {
    if (initialising) return;
    if (!session) {
      router.replace('/login');
      return;
    }
    if (scope.state.status !== 'ready') return;
    if (!scope.state.currentRestaurantId) {
      router.replace('/');
    }
  }, [initialising, session, scope.state, router]);

  const state = scope.state;

  if (state.status === 'error') {
    return <NetworkErrorState onRetry={scope.reload} />;
  }

  if (state.status !== 'ready' || !state.currentRestaurantId) {
    return <Spinner label={hoursCopy.loading} />;
  }

  const restaurantName =
    state.memberships.find((membership) => membership.restaurantId === state.currentRestaurantId)
      ?.restaurantName ?? 'ร้านค้า';

  return (
    <AppShell
      restaurantName={restaurantName}
      restaurantCount={state.memberships.length}
      onSwitchRestaurant={() => router.push('/select-restaurant')}
      activeNav="restaurant"
    >
      <WeeklyHoursForm restaurantId={state.currentRestaurantId} />
    </AppShell>
  );
}
