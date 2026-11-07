import { staffSetRestaurantAvailabilitySchema, BUSY_PREP_MINUTE_VALUES, setRestaurantAvailabilitySchema } from './restaurant-availability';

describe('setRestaurantAvailabilitySchema', () => {
  it('accepts NORMAL with no other fields', () => {
    expect(setRestaurantAvailabilitySchema.safeParse({ mode: 'NORMAL' }).success).toBe(true);
  });

  it('accepts PAUSED with no other fields', () => {
    expect(setRestaurantAvailabilitySchema.safeParse({ mode: 'PAUSED' }).success).toBe(true);
  });

  it.each(BUSY_PREP_MINUTE_VALUES)('accepts BUSY with busyPrepMinutes = %d', (minutes) => {
    const result = setRestaurantAvailabilitySchema.safeParse({ mode: 'BUSY', busyPrepMinutes: minutes });
    expect(result.success).toBe(true);
  });

  it('rejects BUSY with no busyPrepMinutes', () => {
    expect(setRestaurantAvailabilitySchema.safeParse({ mode: 'BUSY' }).success).toBe(false);
  });

  it.each([0, -10, 15, 25, 35, 50, 61, 100, 5.5])(
    'rejects BUSY with busyPrepMinutes outside the five approved values (%s)',
    (minutes) => {
      const result = setRestaurantAvailabilitySchema.safeParse({ mode: 'BUSY', busyPrepMinutes: minutes });
      expect(result.success).toBe(false);
    },
  );

  it('rejects PAUSED with a busyPrepMinutes field — the union forbids it, not just ignores it', () => {
    const result = setRestaurantAvailabilitySchema.safeParse({ mode: 'PAUSED', busyPrepMinutes: 20 });
    expect(result.success).toBe(false);
  });

  it('rejects NORMAL with a busyPrepMinutes field', () => {
    const result = setRestaurantAvailabilitySchema.safeParse({ mode: 'NORMAL', busyPrepMinutes: 20 });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown mode', () => {
    expect(setRestaurantAvailabilitySchema.safeParse({ mode: 'CLOSED' }).success).toBe(false);
  });

  it('rejects a missing mode', () => {
    expect(setRestaurantAvailabilitySchema.safeParse({}).success).toBe(false);
  });

  it('rejects availability_set_by / setterType or any other extra field — no such field exists in this contract', () => {
    const result = setRestaurantAvailabilitySchema.safeParse({
      mode: 'PAUSED',
      availabilitySetBy: 'MERCHANT',
    });
    expect(result.success).toBe(false);
  });

  it('BUSY_PREP_MINUTE_VALUES is exactly the five M-05 presets, in the same order', () => {
    expect(BUSY_PREP_MINUTE_VALUES).toEqual([10, 20, 30, 45, 60]);
  });
});

describe('staffSetRestaurantAvailabilitySchema (DEC-068 C3)', () => {
  it.each([
    [{ mode: 'NORMAL', reason: 'ร้านกลับมาพร้อมขาย' }],
    [{ mode: 'PAUSED', reason: 'ร้านแจ้งว่าไฟดับ' }],
    [{ mode: 'BUSY', busyPrepMinutes: 30, reason: 'ครัวเต็ม' }],
  ])('accepts %j', (body) => {
    expect(staffSetRestaurantAvailabilitySchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['no reason', { mode: 'PAUSED' }],
    ['an empty reason', { mode: 'PAUSED', reason: '' }],
    ['a blank reason', { mode: 'PAUSED', reason: '   ' }],
    ['BUSY without minutes', { mode: 'BUSY', reason: 'x' }],
    ['minutes outside the five values', { mode: 'BUSY', busyPrepMinutes: 25, reason: 'x' }],
    ['minutes on PAUSED', { mode: 'PAUSED', busyPrepMinutes: 20, reason: 'x' }],
    ['an unknown mode', { mode: 'CLOSED', reason: 'x' }],
    ['an extra actor field', { mode: 'PAUSED', reason: 'x', actorType: 'MERCHANT' }],
  ])('rejects %s', (_label, body) => {
    expect(staffSetRestaurantAvailabilitySchema.safeParse(body).success).toBe(false);
  });

  it('trims the reason', () => {
    const parsed = staffSetRestaurantAvailabilitySchema.parse({ mode: 'PAUSED', reason: '  ไฟดับ  ' });
    expect(parsed.reason).toBe('ไฟดับ');
  });
});
