import { formatPrepEstimate, prepEstimateMinutes } from './catalogDisplay';

describe('prepEstimateMinutes (M-13)', () => {
  it('NORMAL reads avgPrepMinutes', () => {
    expect(
      prepEstimateMinutes({ availabilityMode: 'NORMAL', avgPrepMinutes: 15, busyPrepMinutes: null }),
    ).toBe(15);
  });

  it('NORMAL with no avgPrepMinutes returns null — never fabricated (AV-E5)', () => {
    expect(
      prepEstimateMinutes({ availabilityMode: 'NORMAL', avgPrepMinutes: null, busyPrepMinutes: null }),
    ).toBeNull();
  });

  it('BUSY reads busyPrepMinutes, never avgPrepMinutes (AV-D01)', () => {
    expect(
      prepEstimateMinutes({ availabilityMode: 'BUSY', avgPrepMinutes: 15, busyPrepMinutes: 45 }),
    ).toBe(45);
  });

  it('PAUSED has no estimate regardless of stored values', () => {
    expect(
      prepEstimateMinutes({ availabilityMode: 'PAUSED', avgPrepMinutes: 15, busyPrepMinutes: 45 }),
    ).toBeNull();
  });
});

describe('formatPrepEstimate (M-13)', () => {
  it('formats a NORMAL estimate', () => {
    expect(
      formatPrepEstimate({ availabilityMode: 'NORMAL', avgPrepMinutes: 20, busyPrepMinutes: null }),
    ).toBe('เวลาทำอาหารประมาณ 20 นาที');
  });

  it('formats a BUSY estimate from busyPrepMinutes', () => {
    expect(
      formatPrepEstimate({ availabilityMode: 'BUSY', avgPrepMinutes: 20, busyPrepMinutes: 45 }),
    ).toBe('เวลาทำอาหารประมาณ 45 นาที');
  });

  it('returns null for PAUSED', () => {
    expect(
      formatPrepEstimate({ availabilityMode: 'PAUSED', avgPrepMinutes: 20, busyPrepMinutes: null }),
    ).toBeNull();
  });

  it('never labels the estimate as a delivery ETA or arrival time', () => {
    const label = formatPrepEstimate({
      availabilityMode: 'NORMAL',
      avgPrepMinutes: 20,
      busyPrepMinutes: null,
    });
    expect(label).not.toMatch(/จัดส่ง|มาถึง|ETA/i);
  });
});
