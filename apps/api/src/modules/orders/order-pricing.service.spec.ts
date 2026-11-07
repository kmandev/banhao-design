import { OrderPricingService } from './order-pricing.service';
import { calculateServiceFeeSatang } from './service-fee-pricing';

/**
 * The Phase 1 fee amounts, written as literals on purpose.
 *
 * Not imported from the service: the constants there are private, and a test
 * that imported them would only prove the service equals itself. Spelled out
 * here, this file fails the day an amount changes without a new decision.
 *
 * DEC-035 — delivery: flat ฿10 = 1000 satang, independent of everything.
 * DEC-061 D-03/D-04 — service: 5% of the food subtotal, floor ฿5 (500), cap ฿15 (1500).
 */
const DELIVERY_FEE_SATANG = 1000;

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

describe('OrderPricingService.resolveOrderFees', () => {
  it('returns flat ฿10 delivery and the D-03/D-04 service fee for the subtotal', () => {
    const subject = new OrderPricingService();

    expect(subject.resolveOrderFees('restaurant-1', 12000)).toEqual({ deliveryFeeSatang: 1000, serviceFeeSatang: 600 });
    expect(subject.resolveOrderFees('restaurant-1', 4000)).toEqual({ deliveryFeeSatang: 1000, serviceFeeSatang: 500 });
    expect(subject.resolveOrderFees('restaurant-1', 50000)).toEqual({ deliveryFeeSatang: 1000, serviceFeeSatang: 1500 });
  });

  it.each([0, 1, 100, 4999, 12000, 100000, 9_999_999])(
    'keeps delivery flat at 1000 satang for a subtotal of %i (DEC-035)',
    (subtotal) => {
      expect(new OrderPricingService().resolveOrderFees('restaurant-1', subtotal).deliveryFeeSatang).toBe(
        DELIVERY_FEE_SATANG,
      );
    },
  );

  it.each(['restaurant-1', 'restaurant-2', '00000000-0000-0000-0000-000000000000', ''])(
    'gives the same fees for restaurant %j — neither fee is restaurant-specific',
    (restaurantId) => {
      expect(new OrderPricingService().resolveOrderFees(restaurantId, 15000)).toEqual({
        deliveryFeeSatang: 1000,
        serviceFeeSatang: 750,
      });
    },
  );

  it.each([-1, -100000, Number.NaN, Number.POSITIVE_INFINITY, undefined, null])(
    'fails closed on a subtotal of %p — throws, never a zero or default fee',
    (subtotal) => {
      expect(() => new OrderPricingService().resolveOrderFees('restaurant-1', subtotal as unknown as number)).toThrow();
    },
  );

  it('refuses a hostile object in the subtotal slot instead of pricing it', () => {
    const smuggled = {
      deliveryFeeSatang: 0,
      serviceFeeSatang: 0,
      grandTotalSatang: 0,
      toString: () => 'restaurant-1',
      valueOf: () => 0,
    };

    expect(() =>
      new OrderPricingService().resolveOrderFees(smuggled as unknown as string, smuggled as unknown as number),
    ).toThrow();
  });

  it('reads nothing from the network, the database or the environment', () => {
    expect(OrderPricingService.length).toBe(0);

    const subject = new OrderPricingService();
    const before = { ...process.env };
    process.env.DELIVERY_FEE_SATANG = '99999';
    process.env.SERVICE_FEE_SATANG = '99999';
    try {
      expect(subject.resolveOrderFees('restaurant-1', 12000)).toEqual({ deliveryFeeSatang: 1000, serviceFeeSatang: 600 });
    } finally {
      process.env = before;
    }
  });

  it('cannot be poisoned — a mutated result does not affect the next order', () => {
    const subject = new OrderPricingService();

    const first = subject.resolveOrderFees('restaurant-1', 12000);
    first.deliveryFeeSatang = 0;
    first.serviceFeeSatang = 0;

    const second = subject.resolveOrderFees('restaurant-1', 12000);
    expect(second).toEqual({ deliveryFeeSatang: 1000, serviceFeeSatang: 600 });
    expect(second).not.toBe(first);
  });
});

describe('OrderPricingService.resolveOrderCommission — D-01 (10% of food subtotal), D-02 rounding', () => {
  it('resolves 10% of the food subtotal as a resolved amount, and returns the exact base it used', () => {
    const subject = new OrderPricingService();

    // ฿120 × 10% = ฿12 exactly.
    expect(subject.resolveOrderCommission(12000)).toEqual({ commissionSatang: 1200, foodSubtotalSatang: 12000 });
  });

  it('preserves whole-baht round-half-up exactly as the canonical function does', () => {
    const subject = new OrderPricingService();

    // ฿125 × 10% = ฿12.50 → ฿13; ฿184 × 10% = ฿18.40 → ฿18; ฿5 × 10% = ฿0.50 → ฿1.
    expect(subject.resolveOrderCommission(12500).commissionSatang).toBe(1300);
    expect(subject.resolveOrderCommission(18400).commissionSatang).toBe(1800);
    expect(subject.resolveOrderCommission(500).commissionSatang).toBe(100);
  });

  it('is independent of the delivery and service fees — they are never part of the commission base', () => {
    const subject = new OrderPricingService();
    const fees = subject.resolveOrderFees('restaurant-1', 12000);

    expect(subject.resolveOrderCommission(12000).commissionSatang).toBe(1200);
    expect(subject.resolveOrderCommission(12000 + fees.deliveryFeeSatang + fees.serviceFeeSatang).commissionSatang).not.toBe(
      1200,
    );
  });

  it('throws on an invalid subtotal — commission resolution fails closed before any order is created', () => {
    const subject = new OrderPricingService();

    expect(() => subject.resolveOrderCommission(-1)).toThrow(/non-negative integer/);
    expect(() => subject.resolveOrderCommission(120.5)).toThrow(/non-negative integer/);
  });
});
