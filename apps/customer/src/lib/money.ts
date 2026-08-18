import type { Satang } from '@banhao/types';

/**
 * Money formatting for display.
 *
 * Production home for `formatBaht`, moved out of `src/mocks/pricing.ts` in
 * Phase C / C-2: formatting is presentation logic that real catalog screens
 * depend on, and it must not sit behind a `mocks/` import once those screens
 * render live data.
 *
 * Behaviour is unchanged from the original. Amounts stay integer satang
 * everywhere in the domain (CON-003) — the conversion to Baht happens here, at
 * the last possible moment, and only for display.
 */

/** Formats satang as the design displays it, e.g. `฿130`, `฿130.50`. */
export function formatBaht(satang: Satang): string {
  const baht = satang / 100;
  return `฿${Number.isInteger(baht) ? baht : baht.toFixed(2)}`;
}
