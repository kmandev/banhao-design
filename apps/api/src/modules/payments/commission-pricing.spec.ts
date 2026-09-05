import { calculateFoodSubtotalCommissionSatang } from './commission-pricing';

describe('calculateFoodSubtotalCommissionSatang — DEC-043 (8% of food subtotal, whole-baht rounding)', () => {
  it('a normal food subtotal returns exactly 8%, no rounding needed', () => {
    // ฿100 subtotal (10000 satang) × 8% = ฿8 (800 satang) exactly.
    expect(calculateFoodSubtotalCommissionSatang(10000)).toBe(800);
  });

  it('an exact whole-baht result is returned unchanged', () => {
    // ฿75 subtotal (7500 satang) × 8% = ฿6.00 exactly (600 satang).
    expect(calculateFoodSubtotalCommissionSatang(7500)).toBe(600);
  });

  it('a fractional-baht result rounds to the nearest whole baht (round-half-up)', () => {
    // ฿120 subtotal (12000 satang) × 8% = ฿9.60 → rounds up to ฿10 (1000 satang).
    expect(calculateFoodSubtotalCommissionSatang(12000)).toBe(1000);
    // ฿95 subtotal (9500 satang) × 8% = ฿7.60 → rounds up to ฿8 (800 satang).
    expect(calculateFoodSubtotalCommissionSatang(9500)).toBe(800);
    // ฿6.25 subtotal (625 satang) × 8% = ฿0.50 exactly → round-half-up to ฿1 (100 satang).
    expect(calculateFoodSubtotalCommissionSatang(625)).toBe(100);
    // A case that rounds DOWN: ฿180 subtotal (18000 satang) × 8% = ฿14.40 → ฿14 (1400 satang).
    expect(calculateFoodSubtotalCommissionSatang(18000)).toBe(1400);
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
    // ฿10,000,000.00 subtotal (1,000,000,000 satang) × 8% = ฿800,000.00 exactly.
    expect(calculateFoodSubtotalCommissionSatang(1_000_000_000)).toBe(80_000_000);
  });

  it('always returns a non-negative integer number of whole baht in satang', () => {
    const subtotals = [0, 1, 50, 625, 7500, 9500, 12000, 18000, 100000, 9_999_999];

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
