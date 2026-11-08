import { OrderPricingService } from './order-pricing.service';
import { calculateServiceFeeSatang } from './service-fee-pricing';
import type { DeliveryFeeSettingsService } from './delivery-fee-settings.service';

/**
 * The Phase 1 fee amounts, written as literals on purpose.
 *
 * Not imported from the service: the constants there are private, and a test
 * that imported them would only prove the service equals itself. Spelled out
 * here, this file fails the day an amount changes without a new decision.
 *
 * DEC-071 — delivery: from the back-office setting, always ฿15–35.
 * DEC-061 D-03/D-04 — service: 5% of the food subtotal, floor ฿5 (500), cap ฿15 (1500).
 */

describe('calculateServiceFeeSatang — D-03/D-04: 5% of food, floor ฿5, cap ฿15', () => {
  it.each([
    // [food subtotal satang, expected fee satang, why]
    [0, 500, 'empty basket still pays the floor'],
    [4000, 500, '฿40 → 5% is ฿2, floor lifts it to ฿5'],
    [10000, 500, '฿100 → exactly ฿5, floor and percentage meet'],
    [10100, 505, '฿101 → ฿5.05, satang precision kept'],
    [15000, 750, '฿150 → ฿7.50 (the §8A.3 matrix figure)'],
    [20000, 1000, '฿200 → ฿10'],
    [30000, 1500, '฿300 → exactly ฿15, percentage and cap meet'],
    [30100, 1500, '฿301 → ฿15.05, cap holds it at ฿15'],
    [100000, 1500, '฿1,000 → cap'],
  ])('food %i satang → fee %i satang (%s)', (subtotal, fee) => {
    expect(calculateServiceFeeSatang(subtotal)).toBe(fee);
  });

  it('rounds a sub-satang fraction half-up to the nearest satang, never to whole baht', () => {
    // 5% of 12_345 satang = 617.25 → 617; 5% of 12_350 = 617.5 → 618.
    expect(calculateServiceFeeSatang(12345)).toBe(617);
    expect(calculateServiceFeeSatang(12350)).toBe(618);
    // D-02's whole-baht rule would have given 600 for both — deliberately not used.
  });

  it('always returns an integer between the floor and the cap', () => {
    for (let subtotal = 0; subtotal <= 40000; subtotal += 7) {
      const fee = calculateServiceFeeSatang(subtotal);
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThanOrEqual(500);
      expect(fee).toBeLessThanOrEqual(1500);
    }
  });

  it('never decreases as the basket grows', () => {
    let previous = calculateServiceFeeSatang(0);
    for (let subtotal = 1; subtotal <= 40000; subtotal += 13) {
      const fee = calculateServiceFeeSatang(subtotal);
      expect(fee).toBeGreaterThanOrEqual(previous);
      previous = fee;
    }
  });

  it.each([-1, -100000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses a subtotal of %p rather than guessing a fee',
    (subtotal) => {
      expect(() => calculateServiceFeeSatang(subtotal)).toThrow('non-negative integer');
    },
  );
});

function withSetting(setting: unknown) {
  const current = jest.fn().mockResolvedValue(setting);
  return { subject: new OrderPricingService({ current } as unknown as DeliveryFeeSettingsService), current };
}

describe('OrderPricingService.resolveOrderFees — DEC-071 delivery fee from the back-office setting', () => {
  it('FIXED: the setting\'s amount, plus the D-03/D-04 service fee', async () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    await expect(subject.resolveOrderFees('restaurant-1', 12000)).resolves.toEqual({
      deliveryFeeSatang: 1500,
      serviceFeeSatang: 600,
    });
  });

  it('PERCENT: a percentage of the food subtotal, held to ฿15–35', async () => {
    const { subject } = withSetting({ mode: 'PERCENT', percentBasisPoints: 800, minSatang: null, maxSatang: null });

    await expect(subject.resolveOrderFees('r', 10000)).resolves.toMatchObject({ deliveryFeeSatang: 1500 });
    await expect(subject.resolveOrderFees('r', 25000)).resolves.toMatchObject({ deliveryFeeSatang: 2000 });
    await expect(subject.resolveOrderFees('r', 100000)).resolves.toMatchObject({ deliveryFeeSatang: 3500 });
  });

  it.each(['restaurant-1', 'restaurant-2', ''])('does not vary by restaurant (%j)', async (restaurantId) => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 2000 });

    await expect(subject.resolveOrderFees(restaurantId, 15000)).resolves.toEqual({
      deliveryFeeSatang: 2000,
      serviceFeeSatang: 750,
    });
  });

  it('fails closed when the setting cannot be read — no order is priced on a guess', async () => {
    const current = jest.fn().mockRejectedValue(new Error('Delivery fee is not configured'));
    const subject = new OrderPricingService({ current } as unknown as DeliveryFeeSettingsService);

    await expect(subject.resolveOrderFees('r', 12000)).rejects.toThrow('not configured');
  });

  it.each([-1, Number.NaN, undefined, null])('refuses a subtotal of %p before reading the setting', async (subtotal) => {
    const { subject, current } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    await expect(subject.resolveOrderFees('r', subtotal as unknown as number)).rejects.toThrow();
    expect(current).not.toHaveBeenCalled();
  });

  it('ignores money a caller tries to smuggle in — a hostile subtotal object is refused', async () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });
    const smuggled = { deliveryFeeSatang: 0, valueOf: () => 0 };

    await expect(subject.resolveOrderFees('r', smuggled as unknown as number)).rejects.toThrow();
  });

  it('cannot be poisoned — a mutated result does not affect the next order', async () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    const first = await subject.resolveOrderFees('r', 12000);
    first.deliveryFeeSatang = 0;
    const second = await subject.resolveOrderFees('r', 12000);

    expect(second.deliveryFeeSatang).toBe(1500);
    expect(second).not.toBe(first);
  });
});

describe('OrderPricingService.resolveOrderCommission — D-01 (10% of food subtotal), D-02 rounding', () => {
  it('resolves 10% of the food subtotal as a resolved amount, and returns the exact base it used', () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    // ฿120 × 10% = ฿12 exactly.
    expect(subject.resolveOrderCommission(12000)).toEqual({ commissionSatang: 1200, foodSubtotalSatang: 12000 });
  });

  it('preserves whole-baht round-half-up exactly as the canonical function does', () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    // ฿125 × 10% = ฿12.50 → ฿13; ฿184 × 10% = ฿18.40 → ฿18; ฿5 × 10% = ฿0.50 → ฿1.
    expect(subject.resolveOrderCommission(12500).commissionSatang).toBe(1300);
    expect(subject.resolveOrderCommission(18400).commissionSatang).toBe(1800);
    expect(subject.resolveOrderCommission(500).commissionSatang).toBe(100);
  });

  it('is independent of the delivery and service fees — they are never part of the commission base', async () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });
    const fees = await subject.resolveOrderFees('restaurant-1', 12000);

    expect(subject.resolveOrderCommission(12000).commissionSatang).toBe(1200);
    expect(subject.resolveOrderCommission(12000 + fees.deliveryFeeSatang + fees.serviceFeeSatang).commissionSatang).not.toBe(
      1200,
    );
  });

  it('throws on an invalid subtotal — commission resolution fails closed before any order is created', () => {
    const { subject } = withSetting({ mode: 'FIXED', fixedSatang: 1500 });

    expect(() => subject.resolveOrderCommission(-1)).toThrow(/non-negative integer/);
    expect(() => subject.resolveOrderCommission(120.5)).toThrow(/non-negative integer/);
  });
});
