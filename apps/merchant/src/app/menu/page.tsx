'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import { AppShell } from '../../components/AppShell';
import { MenuOverview } from '../../components/MenuOverview';
import { menuCopy } from '../../lib/menuCopy';

/**
 * M-11 — `เมนู`.
 *
 * The auth gate, the scope re-validation on every visit and the `/` bounce for
 * a revoked membership are `dashboard/page.tsx`'s, unchanged: a merchant's
 * membership can be revoked between visits, and every page that reads
 * restaurant-scoped data has to re-check rather than trust a stored id.
 */
export default function MenuPage() {
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
    return <Spinner label={menuCopy.loading} />;
  }

  const restaurantName =
    state.memberships.find((membership) => membership.restaurantId === state.currentRestaurantId)
      ?.restaurantName ?? 'ร้านค้า';

  return (
    <AppShell
      restaurantName={restaurantName}
      restaurantCount={state.memberships.length}
      onSwitchRestaurant={() => router.push('/select-restaurant')}
      activeNav="menu"
    >
      <MenuOverview restaurantId={state.currentRestaurantId} />
    </AppShell>
  );
}
