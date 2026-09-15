import { calculateFoodSubtotalCommissionSatang } from './commission-pricing';

describe('calculateFoodSubtotalCommissionSatang — DEC-061 D-01 (10% of food subtotal), D-02 whole-baht rounding', () => {
  it('a normal food subtotal returns exactly 10%, no rounding needed', () => {
    // ฿100 subtotal (10000 satang) × 10% = ฿10 (1000 satang) exactly.
    expect(calculateFoodSubtotalCommissionSatang(10000)).toBe(1000);
  });

  it('an exact whole-baht result is returned unchanged', () => {
    // ฿80 subtotal (8000 satang) × 10% = ฿8.00 exactly (800 satang).
    expect(calculateFoodSubtotalCommissionSatang(8000)).toBe(800);
    // ฿120 subtotal (12000 satang) × 10% = ฿12.00 exactly (1200 satang).
    expect(calculateFoodSubtotalCommissionSatang(12000)).toBe(1200);
  });

  it('a fractional-baht result rounds to the nearest whole baht (round-half-up)', () => {
    // ฿125 subtotal (12500 satang) × 10% = ฿12.50 → rounds up to ฿13 (1300 satang).
    expect(calculateFoodSubtotalCommissionSatang(12500)).toBe(1300);
    // ฿95 subtotal (9500 satang) × 10% = ฿9.50 → rounds up to ฿10 (1000 satang).
    expect(calculateFoodSubtotalCommissionSatang(9500)).toBe(1000);
    // ฿6.25 subtotal (625 satang) × 10% = ฿0.625 → rounds up to ฿1 (100 satang).
    expect(calculateFoodSubtotalCommissionSatang(625)).toBe(100);
    // A case that rounds DOWN: ฿184 subtotal (18400 satang) × 10% = ฿18.40 → ฿18 (1800 satang).
    expect(calculateFoodSubtotalCommissionSatang(18400)).toBe(1800);
    // ฿14.50 subtotal (1450 satang) × 10% = ฿1.45 → ฿1 (100 satang).
    expect(calculateFoodSubtotalCommissionSatang(1450)).toBe(100);
  });

  it('the exact half-baht boundary rounds up, and just below it rounds down', () => {
    // ฿5.00 subtotal (500 satang) × 10% = ฿0.50 exactly → round-half-up to ฿1.
    expect(calculateFoodSubtotalCommissionSatang(500)).toBe(100);
    // ฿4.99 subtotal (499 satang) × 10% = ฿0.499 → ฿0.
    expect(calculateFoodSubtotalCommissionSatang(499)).toBe(0);
    // ฿15.00 subtotal (1500 satang) × 10% = ฿1.50 exactly → ฿2.
    expect(calculateFoodSubtotalCommissionSatang(1500)).toBe(200);
  });

  it('a zero food subtotal returns zero commission — zero is valid, not an error', () => {
    expect(calculateFoodSubtotalCommissionSatang(0)).toBe(0);
  });

  it('rejects a negative food subtotal rather than guessing', () => {
    expect(() => calculateFoodSubtotalCommissionSatang(-1)).toThrow(/non-negative integer/);
    expect(() => calculateFoodSubtotalCommissionSatang(-12000)).toThrow(/non-negative integer/);
  });

  it('rejects a non-integer food subtotal rather than guessing', () => {
    expect(() => calculateFoodSubtotalCommissionSatang(120.5)).toThrow(/non-negative integer/);
    expect(() => calculateFoodSubtotalCommissionSatang(Number.NaN)).toThrow(/non-negative integer/);
    expect(() => calculateFoodSubtotalCommissionSatang(Number.POSITIVE_INFINITY)).toThrow(
      /non-negative integer/,
    );
  });

  it('a large, realistic food subtotal is computed correctly with pure integer arithmetic', () => {
    // ฿10,000,000.00 subtotal (1,000,000,000 satang) × 10% = ฿1,000,000.00 exactly.
    expect(calculateFoodSubtotalCommissionSatang(1_000_000_000)).toBe(100_000_000);
  });

  it('always returns a non-negative integer number of whole baht in satang', () => {
    const subtotals = [0, 1, 50, 499, 500, 625, 7500, 9500, 12000, 12500, 18400, 100000, 9_999_999];

    for (const subtotal of subtotals) {
      const commission = calculateFoodSubtotalCommissionSatang(subtotal);
      expect(Number.isInteger(commission)).toBe(true);
      expect(commission).toBeGreaterThanOrEqual(0);
      expect(commission % 100).toBe(0); // whole baht, never a satang fraction of a baht
    }
  });

  it('never derives commission from anything but the food subtotal argument — delivery/service fee are not parameters', () => {
    // The function signature itself is the proof: it accepts exactly one
    // argument. This test pins that shape so a future change cannot silently
    // widen the base to include delivery or service fee without this file
    // failing.
    expect(calculateFoodSubtotalCommissionSatang.length).toBe(1);
  });
});
