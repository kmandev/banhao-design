import { z } from 'zod';

/**
 * DEC-070 §2 / DEC-071 — the delivery fee as a back-office setting.
 *
 * Every computed fee is held to ฿15–35 (DEC-061 D-09/D-10). The rider gets 80%
 * of the fee and never less than ฿12 (D-05/D-06). Because the fee never goes
 * below ฿15, the rider's share never exceeds it, so BANHAO never makes up a
 * shortfall on the delivery line. These are the locked numbers, held here once
 * so the API, the admin preview and the tests cannot drift apart.
 */
export const DELIVERY_FEE_MIN_SATANG = 1500;
export const DELIVERY_FEE_MAX_SATANG = 3500;
export const RIDER_SHARE_BASIS_POINTS = 8000; // 80%
export const RIDER_EARNING_FLOOR_SATANG = 1200;

export type DeliveryFeeSetting =
  | { mode: 'FIXED'; fixedSatang: number }
  | { mode: 'PERCENT'; percentBasisPoints: number; minSatang: number | null; maxSatang: number | null };

const bandSatang = z.number().int().min(DELIVERY_FEE_MIN_SATANG).max(DELIVERY_FEE_MAX_SATANG);

/** `PUT /api/v1/admin/supervisor/pricing/delivery-fee` body. A reason is required (DEC-032). */
export const deliveryFeeSettingRequestSchema = z
  .discriminatedUnion('mode', [
    z
      .object({ mode: z.literal('FIXED'), fixedSatang: bandSatang, reason: z.string().trim().min(1).max(500) })
      .strict(),
    z
      .object({
        mode: z.literal('PERCENT'),
        percentBasisPoints: z.number().int().min(1).max(10000),
        minSatang: bandSatang.nullable().default(null),
        maxSatang: bandSatang.nullable().default(null),
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
  ])
  .refine((v) => v.mode !== 'PERCENT' || v.minSatang === null || v.maxSatang === null || v.minSatang <= v.maxSatang, {
    message: 'minSatang must not exceed maxSatang',
    path: ['minSatang'],
  });

export type DeliveryFeeSettingRequest = z.infer<typeof deliveryFeeSettingRequestSchema>;

/**
 * The delivery fee for one order, in integer satang. FIXED returns its amount;
 * PERCENT takes the percentage of the food subtotal (rounded half-up to the
 * satang) and holds it to the setting's own min/max, then to ฿15–35. Throws on
 * an invalid subtotal so an order is never priced on a guess.
 */
export function computeDeliveryFeeSatang(setting: DeliveryFeeSetting, foodSubtotalSatang: number): number {
  if (!Number.isSafeInteger(foodSubtotalSatang) || foodSubtotalSatang < 0) {
    throw new Error(`food subtotal must be a non-negative integer satang amount, got ${String(foodSubtotalSatang)}`);
  }
  const raw =
    setting.mode === 'FIXED'
      ? setting.fixedSatang
      : Math.floor((foodSubtotalSatang * setting.percentBasisPoints + 5000) / 10000);

  let fee = raw;
  if (setting.mode === 'PERCENT') {
    if (setting.minSatang !== null) fee = Math.max(fee, setting.minSatang);
    if (setting.maxSatang !== null) fee = Math.min(fee, setting.maxSatang);
  }
  return Math.min(DELIVERY_FEE_MAX_SATANG, Math.max(DELIVERY_FEE_MIN_SATANG, fee));
}

/** The rider's earning for a delivery fee: 80%, rounded half-up to the satang, never below ฿12. */
export function computeRiderEarningSatang(deliveryFeeSatang: number): number {
  const share = Math.floor((deliveryFeeSatang * RIDER_SHARE_BASIS_POINTS + 5000) / 10000);
  return Math.max(RIDER_EARNING_FLOOR_SATANG, share);
}

/** Customer total, rider earning and BANHAO's delivery margin for a sample basket — the admin form's preview. */
export interface DeliveryFeePreviewRow {
  foodSubtotalSatang: number;
  deliveryFeeSatang: number;
  riderEarningSatang: number;
  banhaoDeliveryMarginSatang: number;
}

export function previewDeliveryFee(setting: DeliveryFeeSetting, foodSubtotals: readonly number[]): DeliveryFeePreviewRow[] {
  return foodSubtotals.map((foodSubtotalSatang) => {
    const deliveryFeeSatang = computeDeliveryFeeSatang(setting, foodSubtotalSatang);
    const riderEarningSatang = computeRiderEarningSatang(deliveryFeeSatang);
    return {
      foodSubtotalSatang,
      deliveryFeeSatang,
      riderEarningSatang,
      banhaoDeliveryMarginSatang: deliveryFeeSatang - riderEarningSatang,
    };
  });
}

/** `GET /api/v1/admin/supervisor/pricing/delivery-fee`. */
export interface DeliveryFeeSettingsResponse {
  current: DeliveryFeeSetting & { id: string; reason: string; createdAt: string; createdBy: string | null };
  history: (DeliveryFeeSetting & { id: string; reason: string; createdAt: string; createdBy: string | null })[];
  preview: DeliveryFeePreviewRow[];
  bounds: { minSatang: number; maxSatang: number; riderShareBasisPoints: number; riderFloorSatang: number };
}
