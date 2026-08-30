'use client';

import type { ReactNode } from 'react';
import { colors, spacing } from '@banhao/ui/theme';
import { useAuth } from '../hooks/useAuth';

interface AppShellProps {
  restaurantName: string;
  restaurantCount: number;
  onSwitchRestaurant?: () => void;
  children: ReactNode;
}

/**
 * The authenticated shell — M-1's Phase 6. Establishes header chrome
 * (restaurant identity, logout, a nav stub) and a responsive tablet/desktop
 * frame. Deliberately no order functionality: the content area is whatever
 * the current page renders, and for M-1 that is only the dashboard
 * placeholder.
 */
export function AppShell({ restaurantName, restaurantCount, onSwitchRestaurant, children }: AppShellProps) {
  const { signOut } = useAuth();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: colors.surface }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing.md,
          flexWrap: 'wrap',
          padding: `${spacing.md}px ${spacing.xl}px`,
          backgroundColor: colors.surfaceRaised,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, color: colors.textMuted, letterSpacing: '0.08em' }}>
            BANHAO · ร้านค้า
          </span>
          <strong style={{ fontSize: 18, color: colors.textPrimary }} data-testid="current-restaurant-name">
            {restaurantName}
          </strong>
        </div>

        <nav
          aria-label="เมนูหลัก"
          style={{ display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}
        >
          {/* Placeholder navigation only — order board etc. arrive in M-2+. */}
          <span style={{ fontSize: 14, color: colors.textPrimary, fontWeight: 600 }}>แดชบอร์ด</span>

          {restaurantCount > 1 && onSwitchRestaurant ? (
            <button
              type="button"
              onClick={onSwitchRestaurant}
              style={{
                fontSize: 14,
                color: colors.textMuted,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                minHeight: 44,
                padding: `0 ${spacing.sm}px`,
              }}
            >
              เปลี่ยนร้าน
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => signOut()}
            style={{
              fontSize: 14,
              color: colors.textMuted,
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              cursor: 'pointer',
              minHeight: 44,
              padding: `0 ${spacing.lg}px`,
            }}
          >
            ออกจากระบบ
          </button>
        </nav>
      </header>

      <main style={{ padding: spacing.xl }}>{children}</main>
    </div>
  );
}
