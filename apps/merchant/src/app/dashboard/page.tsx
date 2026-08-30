'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import { AppShell } from '../../components/AppShell';

/**
 * M-1's dashboard is a placeholder shell — Phase G (order board etc.) is
 * explicitly out of scope for this phase. What matters here is that the
 * restaurant scope is re-validated against a fresh membership read on every
 * visit, not merely read from localStorage: a merchant whose access to the
 * currently-scoped restaurant was revoked since their last visit is bounced
 * back to `/` to let the gate re-decide, never shown this restaurant's data.
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
      <div style={{ maxWidth: 640 }}>
        <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Merchant Dashboard</h1>
        <p style={{ fontSize: 15, color: '#7A6E64', margin: 0 }}>
          กำลังเตรียมระบบจัดการออเดอร์
        </p>
      </div>
    </AppShell>
  );
}
