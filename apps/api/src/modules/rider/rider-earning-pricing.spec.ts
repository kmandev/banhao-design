import { resolveRiderEarningSatang } from './rider-earning-pricing';

describe('resolveRiderEarningSatang — DEC-044 (flat ฿12 per completed delivery)', () => {
  it('returns exactly 1200 satang', () => {
    expect(resolveRiderEarningSatang()).toBe(1200);
  });

  it('returns an integer satang amount, never a float and never a baht figure', () => {
    const amount = resolveRiderEarningSatang();
    expect(Number.isInteger(amount)).toBe(true);
    expect(amount).toBeGreaterThan(0);
  });

  it('takes no arguments — nothing (distance, order, restaurant) can influence it', () => {
    // DEC-044 rules out distance, base+distance, zone, surge, minimum
    // guarantee and tips for Phase 1. A zero-arity function is the proof:
    // there is nothing here for any of those inputs to attach to.
    expect(resolveRiderEarningSatang.length).toBe(0);
  });

  it('is identical across repeated calls — flat, not derived from any changing state', () => {
    const first = resolveRiderEarningSatang();
    const second = resolveRiderEarningSatang();
    const third = resolveRiderEarningSatang();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('returns the amount without touching the network, the database, or the environment', () => {
    expect(resolveRiderEarningSatang.length).toBe(0);
    const before = { ...process.env };
    process.env.RIDER_EARNING_SATANG = '99999';
    try {
      expect(resolveRiderEarningSatang()).toBe(1200);
    } finally {
      process.env = before;
    }
  });
});
