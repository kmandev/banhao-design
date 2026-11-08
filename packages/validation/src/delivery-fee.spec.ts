import {
  computeDeliveryFeeSatang,
  computeRiderEarningSatang,
  deliveryFeeSettingRequestSchema,
  previewDeliveryFee,
  type DeliveryFeeSetting,
} from './delivery-fee';

const FIXED = (fixedSatang: number): DeliveryFeeSetting => ({ mode: 'FIXED', fixedSatang });
const PERCENT = (bp: number, min: number | null = null, max: number | null = null): DeliveryFeeSetting => ({
  mode: 'PERCENT',
  percentBasisPoints: bp,
  minSatang: min,
  maxSatang: max,
});

describe('computeDeliveryFeeSatang (DEC-071)', () => {
  it('FIXED returns its amount, whatever the basket', () => {
    expect(computeDeliveryFeeSatang(FIXED(1500), 0)).toBe(1500);
    expect(computeDeliveryFeeSatang(FIXED(2500), 100000)).toBe(2500);
  });

  it.each([
    [800, 10000, 1500, '8% of ฿100 = ฿8 → lifted to the ฿15 floor'],
    [800, 25000, 2000, '8% of ฿250 = ฿20'],
    [800, 30625, 2450, '8% of ฿306.25 = ฿24.50'],
    [800, 100000, 3500, '8% of ฿1,000 = ฿80 → held to the ฿35 cap'],
  ])('PERCENT %i bp of %i satang → %i (%s)', (bp, food, fee) => {
    expect(computeDeliveryFeeSatang(PERCENT(bp), food)).toBe(fee);
  });

  it('PERCENT honours its own min and max inside the band', () => {
    expect(computeDeliveryFeeSatang(PERCENT(800, 2000, 3000), 10000)).toBe(2000);
    expect(computeDeliveryFeeSatang(PERCENT(800, 2000, 3000), 50000)).toBe(3000);
  });

  it('always lands inside ฿15–35', () => {
    for (const setting of [PERCENT(1), PERCENT(10000), FIXED(1500), FIXED(3500)]) {
      for (let food = 0; food <= 200000; food += 1373) {
        const fee = computeDeliveryFeeSatang(setting, food);
        expect(fee).toBeGreaterThanOrEqual(1500);
        expect(fee).toBeLessThanOrEqual(3500);
        expect(Number.isInteger(fee)).toBe(true);
      }
    }
  });

  it('refuses an invalid subtotal', () => {
    expect(() => computeDeliveryFeeSatang(FIXED(1500), -1)).toThrow();
    expect(() => computeDeliveryFeeSatang(FIXED(1500), 1.5)).toThrow();
  });
});

describe('computeRiderEarningSatang (D-05/D-06)', () => {
  it.each([
    [1000, 1200, 'a legacy ฿10 order: 80% is ฿8, the floor gives ฿12'],
    [1500, 1200, '฿15: 80% is exactly ฿12'],
    [2500, 2000, '฿25: 80% is ฿20'],
    [3500, 2800, '฿35: 80% is ฿28'],
    [1999, 1599, '฿19.99: 80% is ฿15.992 → ฿15.99'],
  ])('fee %i → rider %i (%s)', (fee, rider) => {
    expect(computeRiderEarningSatang(fee)).toBe(rider);
  });

  it('never exceeds the fee anywhere in the band — BANHAO never makes up a shortfall', () => {
    for (let fee = 1500; fee <= 3500; fee += 1) {
      expect(computeRiderEarningSatang(fee)).toBeLessThanOrEqual(fee);
    }
  });
});

describe('previewDeliveryFee', () => {
  it('reports fee, rider and BANHAO margin per sample basket', () => {
    expect(previewDeliveryFee(FIXED(2500), [5000])).toEqual([
      { foodSubtotalSatang: 5000, deliveryFeeSatang: 2500, riderEarningSatang: 2000, banhaoDeliveryMarginSatang: 500 },
    ]);
  });
});

describe('deliveryFeeSettingRequestSchema', () => {
  it('accepts a FIXED setting inside the band with a reason', () => {
    expect(deliveryFeeSettingRequestSchema.safeParse({ mode: 'FIXED', fixedSatang: 2000, reason: 'pilot' }).success).toBe(true);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ mode: 'FIXED', fixedSatang: 1000, reason: 'r' }, 'below ฿15'],
    [{ mode: 'FIXED', fixedSatang: 4000, reason: 'r' }, 'above ฿35'],
    [{ mode: 'FIXED', fixedSatang: 2000, reason: '  ' }, 'blank reason'],
    [{ mode: 'FIXED', fixedSatang: 2000 }, 'no reason'],
    [{ mode: 'PERCENT', percentBasisPoints: 0, reason: 'r' }, '0%'],
    [{ mode: 'PERCENT', percentBasisPoints: 800, minSatang: 3000, maxSatang: 2000, reason: 'r' }, 'min above max'],
    [{ mode: 'PERCENT', percentBasisPoints: 800, minSatang: 1000, reason: 'r' }, 'min below ฿15'],
    [{ mode: 'FIXED', fixedSatang: 2000, reason: 'r', riderShare: 5000 }, 'extra field'],
  ])('refuses %j (%s)', (body) => {
    expect(deliveryFeeSettingRequestSchema.safeParse(body).success).toBe(false);
  });

  it('defaults PERCENT min/max to null', () => {
    const parsed = deliveryFeeSettingRequestSchema.parse({ mode: 'PERCENT', percentBasisPoints: 800, reason: 'r' });
    expect(parsed).toMatchObject({ minSatang: null, maxSatang: null });
  });
});
