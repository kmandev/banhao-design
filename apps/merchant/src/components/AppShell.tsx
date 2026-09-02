'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { colors, spacing } from '@banhao/ui/theme';
import { useAuth } from '../hooks/useAuth';

/**
 * The five merchant destinations the UX specification fixes (§12), in its
 * order. M-11 occupies the third slot and M-12 sits under `ร้านของฉัน`
 * (M12-D10), so hours is a page of that section rather than a sixth top-level
 * item — a page edited monthly should not crowd the two used daily. Now that
 * M-10 exists, `ร้านของฉัน` opens the restaurant profile directly (M10-D03),
 * and the profile page itself links onward to `/restaurant/hours` — before
 * M-10, this pointed straight at the hours page for lack of anywhere else to
 * go.
 *
 * `ประวัติ` and `ตั้งค่า` have no route yet: M-09 and M-14 are unbuilt and
 * undesigned. They render as plain, non-interactive labels rather than links
 * to a 404 — a nav item that goes nowhere is worse than one that visibly does
 * not go anywhere yet.
 */
const NAV_ITEMS: { key: string; label: string; href: string | null }[] = [
  { key: 'orders', label: 'ออเดอร์วันนี้', href: '/dashboard' },
  { key: 'history', label: 'ประวัติ', href: null },
  { key: 'menu', label: 'เมนู', href: '/menu' },
  { key: 'restaurant', label: 'ร้านของฉัน', href: '/restaurant' },
  { key: 'settings', label: 'ตั้งค่า', href: null },
];

export type MerchantNavKey = (typeof NAV_ITEMS)[number]['key'];

interface AppShellProps {
  restaurantName: string;
  restaurantCount: number;
  onSwitchRestaurant?: () => void;
  /** Which nav item is the current page. Omitted on a page outside the five. */
  activeNav?: MerchantNavKey;
  children: ReactNode;
}

/**
 * The authenticated shell — M-1's Phase 6, with the real navigation M-11
 * needed (M11-C04). Establishes header chrome (restaurant identity, nav,
 * logout) and a responsive tablet/desktop frame. The content area is whatever
 * the current page renders; the shell knows nothing about orders, menu or
 * hours beyond which nav item is current.
 */
export function AppShell({
  restaurantName,
  restaurantCount,
  onSwitchRestaurant,
  activeNav,
  children,
}: AppShellProps) {
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
          {NAV_ITEMS.map((item) => {
            const active = item.key === activeNav;
            // The active treatment is the one already used for the old
            // แดชบอร์ด label: 600 weight on textPrimary, inactive items muted.
            const style = {
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? colors.textPrimary : colors.textMuted,
              backgroundColor: active ? colors.surfaceAccent : 'transparent',
              borderRadius: 12,
              // 44px tall, matching sizes.touchTarget — this is used on a
              // counter tablet, not only a desktop.
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              padding: `0 ${spacing.sm}px`,
              textDecoration: 'none',
            } as const;

            if (!item.href) {
              return (
                <span key={item.key} style={{ ...style, color: colors.textMuted }}>
                  {item.label}
                </span>
              );
            }

            return (
              <Link
                key={item.key}
                href={item.href}
                style={style}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}

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
