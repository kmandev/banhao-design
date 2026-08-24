import { OrderPricingService } from './order-pricing.service';

/**
 * The Phase 1 fee amounts, written as literals on purpose.
 *
 * These are deliberately NOT imported from the service — the constants there
 * are private, and a test that imported them would only prove the service
 * equals itself. Spelled out here, this file fails the day either amount is
 * changed without a new Product Owner decision, which is the point.
 *
 * DEC-035 — delivery: flat ฿10 = 1000 satang, independent of distance.
 * DEC-036 — service:  fixed ฿5 =  500 satang, not a percentage.
 */
const DELIVERY_FEE_SATANG = 1000;
const SERVICE_FEE_SATANG = 500;

describe('OrderPricingService.resolveOrderFees — the approved amounts (DEC-035, DEC-036)', () => {
  it('returns exactly 1000 satang delivery and 500 satang service', () => {
    const subject = new OrderPricingService();

    expect(subject.resolveOrderFees('restaurant-1', 12000)).toEqual({
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    });
  });

  it('returns integer satang, never a float and never a baht figure', () => {
    const subject = new OrderPricingService();
    const fees = subject.resolveOrderFees('restaurant-1', 12000);

    // CON-003: money is integer satang. ฿10 and ฿5 as baht numbers (10, 5)
    // would both pass an "is an integer" check on their own, so the amounts
    // are asserted above as well — this guards the representation.
    expect(Number.isInteger(fees.deliveryFeeSatang)).toBe(true);
    expect(Number.isInteger(fees.serviceFeeSatang)).toBe(true);
    expect(fees.deliveryFeeSatang).toBeGreaterThan(0);
    expect(fees.serviceFeeSatang).toBeGreaterThan(0);
  });

  it('charges 1500 satang of fees in total — ฿15 on top of any subtotal', () => {
    const subject = new OrderPricingService();
    const fees = subject.resolveOrderFees('restaurant-1', 12000);

    expect(fees.deliveryFeeSatang + fees.serviceFeeSatang).toBe(1500);
  });
});

describe('OrderPricingService.resolveOrderFees — flat and fixed, not derived', () => {
  const SUBTOTALS = [0, 1, 100, 4999, 12000, 100000, 9_999_999];

  it.each(SUBTOTALS)('returns the same fees for a subtotal of %i satang', (subtotalSatang) => {
    const subject = new OrderPricingService();

    // DEC-036 rules out a percentage of the subtotal, and DEC-035 rules out
    // any basket-size component. A subtotal that moves by three orders of
    // magnitude must move neither fee by one satang.
    expect(subject.resolveOrderFees('restaurant-1', subtotalSatang)).toEqual({
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    });
  });

  it.each([
    'restaurant-1',
    'restaurant-2',
    '00000000-0000-0000-0000-000000000000',
    '',
  ])('returns the same fees for restaurant %j', (restaurantId) => {
    const subject = new OrderPricingService();

    // DEC-035 is flat across every restaurant — no per-restaurant delivery
    // fee, no distance from the restaurant's coordinates — and DEC-036 is
    // explicit that the service fee is not restaurant-specific.
    expect(subject.resolveOrderFees(restaurantId, 12000)).toEqual({
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    });
  });

  it('is identical across every combination of the inputs it is given', () => {
    const subject = new OrderPricingService();

    const results = ['restaurant-1', 'restaurant-2', ''].flatMap((restaurantId) =>
      SUBTOTALS.map((subtotal) => subject.resolveOrderFees(restaurantId, subtotal)),
    );

    for (const fees of results) {
      expect(fees).toEqual(results[0]);
    }
  });
});

describe('OrderPricingService.resolveOrderFees — no zero or default path', () => {
  it('never returns zero for either fee, on any input including hostile ones', () => {
    const subject = new OrderPricingService();

    // DEC-E-01 forbids a zero fee and a silent fallback. Nothing a caller can
    // pass — including values a cart could never legitimately produce — may
    // produce a free order.
    const hostile: Array<[string, number]> = [
      ['', 0],
      ['', -1],
      ['restaurant-1', -100000],
      ['restaurant-1', Number.NaN],
      ['restaurant-1', Number.POSITIVE_INFINITY],
      ['restaurant-1', Number.MAX_SAFE_INTEGER],
      [undefined as unknown as string, undefined as unknown as number],
      [null as unknown as string, null as unknown as number],
    ];

    for (const [restaurantId, subtotalSatang] of hostile) {
      const fees = subject.resolveOrderFees(restaurantId, subtotalSatang);
      expect(fees.deliveryFeeSatang).toBe(DELIVERY_FEE_SATANG);
      expect(fees.serviceFeeSatang).toBe(SERVICE_FEE_SATANG);
    }
  });

  it('returns the amounts without touching the network, the database or the environment', () => {
    // The service takes no constructor dependencies at all, so there is no
    // Supabase client, no config service and no provider it could read a fee
    // from — the amounts cannot be changed by a deployment or by data.
    expect(OrderPricingService.length).toBe(0);

    const subject = new OrderPricingService();
    const before = { ...process.env };

    // A deployment must not be able to move the price. DEC-035/DEC-036 are
    // decisions, not configuration.
    process.env.DELIVERY_FEE_SATANG = '99999';
    process.env.SERVICE_FEE_SATANG = '99999';
    try {
      expect(subject.resolveOrderFees('restaurant-1', 12000)).toEqual({
        deliveryFeeSatang: DELIVERY_FEE_SATANG,
        serviceFeeSatang: SERVICE_FEE_SATANG,
      });
    } finally {
      process.env = before;
    }
  });
});

describe('OrderPricingService.resolveOrderFees — server-side authority', () => {
  it('ignores money fields a caller tries to smuggle in alongside the arguments', () => {
    const subject = new OrderPricingService();

    // The signature exposes no fee parameter, so a client cannot propose an
    // amount through the normal path. This casts a hostile object into each
    // argument slot to prove the SERVICE ignores it too, rather than relying
    // on the request schema alone to keep it out (the same discipline
    // `orders.service.spec.ts` applies to `create_order`'s arguments).
    const smuggled = {
      deliveryFeeSatang: 0,
      serviceFeeSatang: 0,
      grandTotalSatang: 0,
      toString: () => 'restaurant-1',
      valueOf: () => 0,
    };

    expect(
      subject.resolveOrderFees(
        smuggled as unknown as string,
        smuggled as unknown as number,
      ),
    ).toEqual({
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    });
  });

  it('cannot be poisoned — a mutated result does not affect the next order', () => {
    const subject = new OrderPricingService();

    const first = subject.resolveOrderFees('restaurant-1', 12000);
    first.deliveryFeeSatang = 0;
    first.serviceFeeSatang = 0;

    const second = subject.resolveOrderFees('restaurant-1', 12000);

    expect(second).toEqual({
      deliveryFeeSatang: DELIVERY_FEE_SATANG,
      serviceFeeSatang: SERVICE_FEE_SATANG,
    });
    expect(second).not.toBe(first);
  });
});
