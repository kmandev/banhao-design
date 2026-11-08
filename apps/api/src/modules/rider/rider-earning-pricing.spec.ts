import { resolveDeliveryMarginEntry, resolveRiderEarningSatang } from './rider-earning-pricing';

describe('resolveRiderEarningSatang (DEC-071: 80% of the order fee, at least ฿12)', () => {
  it.each([
    [1000, 1200],
    [1500, 1200],
    [2000, 1600],
    [2500, 2000],
    [3500, 2800],
  ])('fee %i → %i', (fee, earning) => {
    expect(resolveRiderEarningSatang(fee)).toBe(earning);
  });

  it('refuses an invalid fee rather than guessing an earning', () => {
    expect(() => resolveRiderEarningSatang(-1)).toThrow();
    expect(() => resolveRiderEarningSatang(12.5)).toThrow();
  });
});

describe('resolveDeliveryMarginEntry', () => {
  it('a legacy ฿10 order: BANHAO covers ฿2 as PLATFORM_WRITE_OFF (DEC-045, unchanged)', () => {
    expect(resolveDeliveryMarginEntry(1000, 1200)).toEqual({ account: 'PLATFORM_WRITE_OFF', amountSatang: 200 });
  });

  it('a DEC-071 order: the remainder is BANHAO revenue, never a write-off', () => {
    expect(resolveDeliveryMarginEntry(1500, 1200)).toEqual({ account: 'PLATFORM_REVENUE', amountSatang: 300 });
    expect(resolveDeliveryMarginEntry(2500, 2000)).toEqual({ account: 'PLATFORM_REVENUE', amountSatang: 500 });
  });

  it('posts nothing when fee and earning are equal', () => {
    expect(resolveDeliveryMarginEntry(1200, 1200)).toBeNull();
  });

  it('never yields a write-off anywhere in the ฿15–35 band', () => {
    for (let fee = 1500; fee <= 3500; fee += 1) {
      expect(resolveDeliveryMarginEntry(fee, resolveRiderEarningSatang(fee))?.account).not.toBe('PLATFORM_WRITE_OFF');
    }
  });
});
