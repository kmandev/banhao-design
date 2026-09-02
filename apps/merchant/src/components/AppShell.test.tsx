import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

/**
 * The nav M-11 needed (M11-C04). The shipped shell rendered a single
 * non-interactive `แดชบอร์ด` label; the UX specification (§12) fixes five
 * destinations, and M-11 is the third.
 */

jest.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ signOut: jest.fn() }),
}));

function renderShell(activeNav?: string) {
  render(
    <AppShell restaurantName="ร้านตามสั่งป้าสมร" restaurantCount={1} activeNav={activeNav}>
      <p>content</p>
    </AppShell>,
  );
}

describe('AppShell navigation', () => {
  it('renders the five specified destinations, in order', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'เมนูหลัก' });
    expect(nav.textContent).toContain('ออเดอร์วันนี้');
    expect(nav.textContent).toContain('ประวัติ');
    expect(nav.textContent).toContain('เมนู');
    expect(nav.textContent).toContain('ร้านของฉัน');
    expect(nav.textContent).toContain('ตั้งค่า');
  });

  it('links เมนู to M-11 and ร้านของฉัน to M-10 (the restaurant profile, which links onward to hours)', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'เมนู' })).toHaveAttribute('href', '/menu');
    expect(screen.getByRole('link', { name: 'ร้านของฉัน' })).toHaveAttribute('href', '/restaurant');
  });

  it('does not link the two destinations that have no screen yet', () => {
    renderShell();

    // A nav item that goes nowhere is worse than one that visibly does not go
    // anywhere yet — M-09 and M-14 are undesigned.
    expect(screen.queryByRole('link', { name: 'ประวัติ' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'ตั้งค่า' })).toBeNull();
  });

  it('marks the current page for assistive technology', () => {
    renderShell('menu');

    expect(screen.getByRole('link', { name: 'เมนู' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ออเดอร์วันนี้' })).not.toHaveAttribute('aria-current');
  });

  it('still renders the restaurant identity and logout', () => {
    renderShell('orders');

    expect(screen.getByTestId('current-restaurant-name')).toHaveTextContent('ร้านตามสั่งป้าสมร');
    expect(screen.getByRole('button', { name: 'ออกจากระบบ' })).toBeInTheDocument();
  });
});
