/**
 * The merchant's arrival-alert sound on/off preference (M-03) — persisted the
 * same way `restaurantScope.ts` persists the selected restaurant: a single
 * `localStorage` string, read/written behind `typeof window === 'undefined'`
 * and `try/catch`, so this is safe during SSR, in Jest/jsdom, and in a
 * private-browsing session where storage throws.
 *
 * No backend persistence, no API call — this is a browser-only, per-device
 * preference, same as the restaurant selection.
 */

const STORAGE_KEY = 'banhao_merchant_sound_alert_enabled';

/** Default is ON — a merchant who has never touched the bell keeps hearing new-order alerts. */
const DEFAULT_ENABLED = true;

export function getSoundPreference(): boolean {
  if (typeof window === 'undefined') return DEFAULT_ENABLED;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return DEFAULT_ENABLED;
    return stored === '1';
  } catch {
    // Private browsing / storage disabled — behave as if nothing is stored.
    return DEFAULT_ENABLED;
  }
}

export function setSoundPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Non-fatal: the preference just won't survive a reload this session.
  }
}
