'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import { AppShell } from '../../components/AppShell';
import { RestaurantProfileForm } from '../../components/RestaurantProfileForm';
import { profileCopy } from '../../lib/menuCopy';

/**
 * M-10 — `ร้านของฉัน`, opened directly (M10-D03: no tabs, no sub-nav).
 *
 * `restaurant/hours/page.tsx` used to be this route's destination — its own
 * comment said so explicitly, because M-10 did not exist yet. Now that it
 * does, `AppShell`'s `ร้านของฉัน` nav item points here, and the hours page is
 * reached from the link this screen renders instead (M12-D10: hours is one
 * page of the restaurant profile, not a sixth top-level nav item).
 */
export default function RestaurantProfilePage() {
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
    return <Spinner label={profileCopy.loading} />;
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
      <RestaurantProfileForm restaurantId={state.currentRestaurantId} restaurantName={restaurantName} />
      <a
        href="/restaurant/hours"
        onClick={(event) => {
          event.preventDefault();
          router.push('/restaurant/hours');
        }}
        style={{ fontSize: 14, color: 'inherit', textDecoration: 'underline', marginTop: 8, display: 'inline-block' }}
        data-testid="profile-hours-link"
      >
        {profileCopy.hoursLink} →
      </a>
    </AppShell>
  );
}
