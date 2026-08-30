'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useRestaurantScope } from '../../hooks/useRestaurantScope';
import { Spinner } from '../../components/Spinner';
import { NetworkErrorState } from '../../components/ErrorState';
import * as styles from '../../lib/styles';

/**
 * M-02 — shown only when a merchant has more than one active restaurant
 * membership and no valid stored scope. The zero/one-restaurant cases are
 * handled centrally by the root gate (`app/page.tsx`); a merchant who lands
 * here directly (bookmark, back button) while those conditions don't hold
 * is bounced back to `/` to let the gate re-decide, rather than duplicating
 * that decision here.
 */
export default function SelectRestaurantPage() {
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
    if (scope.state.memberships.length <= 1) {
      router.replace('/');
    }
  }, [initialising, session, scope.state, router]);

  if (scope.state.status === 'error') {
    return <NetworkErrorState onRetry={scope.reload} />;
  }

  if (scope.state.status !== 'ready' || scope.state.memberships.length <= 1) {
    return <Spinner label="กำลังโหลดร้านค้า…" />;
  }

  function onSelect(restaurantId: string) {
    scope.selectRestaurant(restaurantId);
    router.replace('/dashboard');
  }

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: 480 }}>
        <div>
          <h1 style={styles.title}>เลือกร้านค้า</h1>
          <p style={styles.subtitle}>คุณมีสิทธิ์จัดการมากกว่าหนึ่งร้าน เลือกร้านที่ต้องการ</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {scope.state.memberships.map((m) => (
            <button
              key={m.restaurantId}
              type="button"
              data-testid={`restaurant-option-${m.restaurantId}`}
              style={styles.restaurantOption}
              onClick={() => onSelect(m.restaurantId)}
            >
              <strong style={{ fontSize: 16 }}>{m.restaurantName}</strong>
              <span style={styles.subtitle}>{m.memberRole}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
