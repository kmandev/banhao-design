'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import { AppShell } from '../../components/AppShell';
import { OrderBoard } from '../../components/OrderBoard';

/**
 * M-2.6 replaces M-1's placeholder body with the Order Board. Everything
 * above the board — auth gate, restaurant-scope re-validation on every
 * visit, the `/` bounce for a revoked membership — is unchanged from M-1;
 * only what renders once scope is `ready` and a restaurant is selected has
 * changed. `state.currentRestaurantId` is passed straight into `OrderBoard`,
 * the same already-membership-verified value `AppShell` already receives —
 * `OrderBoard` does not re-derive or re-check it.
 */
export default function DashboardPage() {
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
    return <Spinner label="กำลังโหลดข้อมูลร้าน…" />;
  }

  // currentRestaurantId is only ever set to an id present in `memberships`
  // (see useRestaurantScope), so this should always resolve. Fall back
  // rather than crash if it somehow doesn't.
  const restaurantName =
    state.memberships.find((m) => m.restaurantId === state.currentRestaurantId)?.restaurantName ??
    'ร้านค้า';

  return (
    <AppShell
      restaurantName={restaurantName}
      restaurantCount={state.memberships.length}
      onSwitchRestaurant={() => router.push('/select-restaurant')}
    >
      <OrderBoard restaurantId={state.currentRestaurantId} />
    </AppShell>
  );
}
