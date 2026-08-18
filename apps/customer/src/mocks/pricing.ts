import type { Satang } from '@banhao/types';

/**
 * Order pricing, transcribed from the design artifact's own calculation:
 *
 *   total() { return Math.max(0, this.subtotal() + 15 + 5 - 10); }
 *
 * ⚠️ These are DESIGN SAMPLE VALUES, not agreed business rules.
 * The real platform fee is Q-010, which is still OPEN — the ledger cannot be
 * built to balance (CON-003) until it is answered. Do not treat these numbers
 * as authoritative, and do not copy them into backend code.
 *
 * All values are integer satang.
 */
export const SAMPLE_DELIVERY_FEE_SATANG: Satang = 1500;
export const SAMPLE_SERVICE_FEE_SATANG: Satang = 500;
export const SAMPLE_DISCOUNT_SATANG: Satang = 1000;
export const SAMPLE_DISCOUNT_CODE = 'BANHAO7';

export interface OrderTotals {
  subtotalSatang: Satang;
  deliveryFeeSatang: Satang;
  serviceFeeSatang: Satang;
  discountSatang: Satang;
  totalSatang: Satang;
}

export function calculateTotals(subtotalSatang: Satang): OrderTotals {
  const total = Math.max(
    0,
    subtotalSatang +
      SAMPLE_DELIVERY_FEE_SATANG +
      SAMPLE_SERVICE_FEE_SATANG -
      SAMPLE_DISCOUNT_SATANG,
  );

  return {
    subtotalSatang,
    deliveryFeeSatang: SAMPLE_DELIVERY_FEE_SATANG,
    serviceFeeSatang: SAMPLE_SERVICE_FEE_SATANG,
    discountSatang: SAMPLE_DISCOUNT_SATANG,
    totalSatang: total,
  };
}

/**
 * Re-exported from its production home so existing fixture code keeps working.
 * Production modules must import it from `src/lib/money.ts` (Phase C / C-2).
 */
export { formatBaht } from '../lib/money';
