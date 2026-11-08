'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import { AppShell } from '../../components/AppShell';
import { EarningsView } from '../../components/EarningsView';

/** DEC-073 — `รายได้`, the restaurant's earnings (plain table, DEC-070 Q5). */
export default function EarningsPage() {
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
    return <Spinner label="กำลังโหลด" />;
  }

  const restaurantName =
    state.memberships.find((membership) => membership.restaurantId === state.currentRestaurantId)
      ?.restaurantName ?? 'ร้านค้า';

  return (
    <AppShell
      restaurantName={restaurantName}
      restaurantCount={state.memberships.length}
      onSwitchRestaurant={() => router.push('/select-restaurant')}
      activeNav="earnings"
    >
      <EarningsView restaurantId={state.currentRestaurantId} />
    </AppShell>
  );
}
