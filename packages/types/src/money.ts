/**
 * Money is represented in the smallest currency unit (satang for THB) as an
 * integer. Never use floating point for money — see AGENTS.md and CON-003
 * (every order's ledger must balance to exactly zero).
 *
 * 100 satang = 1 THB. A ฿130.50 order is `13050`.
 */
export type Satang = number;

export const THB = 'THB' as const;
export type Currency = typeof THB;

export interface Money {
  amount: Satang;
  currency: Currency;
}

export function satangToBaht(amount: Satang): number {
  return amount / 100;
}

export function bahtToSatang(baht: number): Satang {
  return Math.round(baht * 100);
}
