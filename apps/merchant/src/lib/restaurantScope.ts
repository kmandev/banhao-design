/**
 * The selected-restaurant scope, persisted so a merchant with several
 * restaurants doesn't have to re-pick one on every visit.
 *
 * This module is deliberately dumb: it only reads/writes a string in
 * localStorage. It must never be trusted as authorization by itself — the
 * id read from here is only ever used after being checked against a fresh
 * `restaurant_members` read (see useRestaurantScope.tsx), the same
 * membership list `is_restaurant_member()` enforces server-side. A stored id
 * for a restaurant the merchant no longer belongs to (or never did — e.g. a
 * value edited by hand in devtools) is worthless on its own and must fail
 * that check.
 */

const STORAGE_KEY = 'banhao_merchant_restaurant_id';
const SESSION_EXPIRED_KEY = 'banhao_merchant_session_expired';

export function getStoredRestaurantId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing / storage disabled — behave as if nothing is stored.
    return null;
  }
}

export function setStoredRestaurantId(restaurantId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, restaurantId);
  } catch {
    // Non-fatal: the merchant will just be asked to select again next time.
  }
}

export function clearStoredRestaurantId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage never worked.
  }
}

/**
 * Marks that the session ended because it expired (refresh failed), not
 * because the merchant chose to log out — read once by the login screen to
 * show "เซสชันหมดอายุ" instead of a blank login form, then cleared.
 */
export function markSessionExpired(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
  } catch {
    // If we can't record it, the login screen just won't show the banner.
  }
}

export function consumeSessionExpired(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = window.sessionStorage.getItem(SESSION_EXPIRED_KEY);
    if (value) window.sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    return value === '1';
  } catch {
    return false;
  }
}
