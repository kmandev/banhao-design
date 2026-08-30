'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../hooks/useAuth';
import { useRestaurantScope } from '../hooks/useRestaurantScope';
import { Spinner } from '../components/Spinner';
import { NetworkErrorState } from '../components/ErrorState';

/**
 * The root route is the auth/restaurant-scope gate — the single place that
 * decides which screen a merchant lands on, mirroring the role
 * `RootNavigator` plays in the mobile apps (session-driven tree). App
 * Router has no equivalent single switch component, so every other
 * protected route redirects back here if it finds its own preconditions
 * unmet, rather than re-implementing this decision locally.
 *
 * Decision order:
 *   no session               → /login
 *   0 active memberships     → /unauthorized
 *   1 active membership      → auto-select it, → /dashboard
 *   >1, valid stored scope   → /dashboard
 *   >1, no valid stored scope→ /select-restaurant
 */
export default function RootGate() {
  const router = useRouter();
  const { initialising, session } = useAuth();
  const scope = useRestaurantScope(!initialising && session !== null);
  const selectedAutoScope = useRef(false);

  useEffect(() => {
    if (initialising) return;
    if (!session) {
      router.replace('/login');
      return;
    }

    if (scope.state.status !== 'ready') return;

    const { memberships, currentRestaurantId } = scope.state;

    if (memberships.length === 0) {
      router.replace('/unauthorized');
      return;
    }

    if (memberships.length === 1) {
      // Guard against re-running after the redirect has already been issued.
      if (!selectedAutoScope.current) {
        selectedAutoScope.current = true;
        scope.selectRestaurant(memberships[0]!.restaurantId);
      }
      router.replace('/dashboard');
      return;
    }

    if (currentRestaurantId) {
      router.replace('/dashboard');
    } else {
      router.replace('/select-restaurant');
    }
  }, [initialising, session, scope.state, router]);

  if (scope.state.status === 'error') {
    return <NetworkErrorState onRetry={scope.reload} />;
  }

  return <Spinner label="กำลังตรวจสอบสิทธิ์การเข้าใช้งาน…" />;
}
