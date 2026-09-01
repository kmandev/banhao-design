import {
  DAYS_OF_WEEK,
  normaliseTimeOfDay,
  replaceRestaurantHoursSchema,
  timeToMinutes,
  validateWeeklyHours,
  type DraftHoursDay,
  type DayOfWeek,
} from './restaurant-hours';

/** Builds one day quickly; times are `HH:MM` pairs. */
function day(dayOfWeek: DayOfWeek, ...intervals: [string, string][]): DraftHoursDay {
  return {
    dayOfWeek,
    intervals: intervals.map(([opensAt, closesAt]) => ({ opensAt, closesAt })),
  };
}

function codes(days: DraftHoursDay[]): string[] {
  return validateWeeklyHours(days).map((issue) => issue.code);
}

describe('day-of-week mapping', () => {
  it('runs 0 through 6 with no gaps', () => {
    expect(DAYS_OF_WEEK).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  /**
   * The one assertion that would catch a whole-week off-by-one. 0 is Sunday
   * because `apps/customer/src/lib/openingHours.ts`, `ShopScreen.tsx` and
   * `catalog_dev_seed.sql` already say so and the customer app has shipped
   * against it — this is a restatement, not a new choice.
   */
  it('is 0 = Sunday through 6 = Saturday, matching every existing reader', () => {
    const NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

    expect(NAMES[DAYS_OF_WEEK[0]]).toBe('อาทิตย์');
    expect(NAMES[DAYS_OF_WEEK[1]]).toBe('จันทร์');
    expect(NAMES[DAYS_OF_WEEK[6]]).toBe('เสาร์');
  });
});

describe('time helpers', () => {
  it('trims the seconds PostgREST renders on a time column', () => {
    expect(normaliseTimeOfDay('08:00:00')).toBe('08:00');
    expect(normaliseTimeOfDay('20:30')).toBe('20:30');
  });

  it('converts to minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('replaceRestaurantHoursSchema', () => {
  it('accepts a week with a split shift and an omitted (closed) day', () => {
    const parsed = replaceRestaurantHoursSchema.safeParse({
      days: [
        { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '20:00' }] },
        {
          dayOfWeek: 6,
          intervals: [
            { opensAt: '07:00', closesAt: '13:00' },
            { opensAt: '16:00', closesAt: '20:00' },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts a day with no intervals — that is how a day is closed', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({ days: [{ dayOfWeek: 0, intervals: [] }] }).success,
    ).toBe(true);
  });

  it('accepts an empty week — a restaurant with no hours at all is a real state', () => {
    expect(replaceRestaurantHoursSchema.safeParse({ days: [] }).success).toBe(true);
  });

  it('rejects a day outside 0–6', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({ days: [{ dayOfWeek: 7, intervals: [] }] }).success,
    ).toBe(false);
  });

  it('rejects the same day appearing twice — intervals belong in one entry', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({
        days: [
          { dayOfWeek: 1, intervals: [{ opensAt: '08:00', closesAt: '12:00' }] },
          { dayOfWeek: 1, intervals: [{ opensAt: '13:00', closesAt: '20:00' }] },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects more than seven days', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({
        days: [0, 1, 2, 3, 4, 5, 6, 0].map((dayOfWeek) => ({ dayOfWeek, intervals: [] })),
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown key rather than ignoring it', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({
        days: [{ dayOfWeek: 1, intervals: [], isClosed: true }],
      }).success,
    ).toBe(false);
  });

  it.each(['8:00', '08:0', '24:00', '23:60', '08:00:00', 'ปิด', ''])(
    'rejects %p as a time',
    (value) => {
      expect(
        replaceRestaurantHoursSchema.safeParse({
          days: [{ dayOfWeek: 1, intervals: [{ opensAt: value, closesAt: '20:00' }] }],
        }).success,
      ).toBe(false);
    },
  );

  it('accepts midnight as an opening time', () => {
    expect(
      replaceRestaurantHoursSchema.safeParse({
        days: [{ dayOfWeek: 1, intervals: [{ opensAt: '00:00', closesAt: '06:00' }] }],
      }).success,
    ).toBe(true);
  });
});

describe('validateWeeklyHours — the seven M-12 §04 rules', () => {
  it('reports nothing for a valid week', () => {
    expect(
      codes([day(1, ['08:00', '20:00']), day(6, ['07:00', '13:00'], ['16:00', '20:00'])]),
    ).toEqual([]);
  });

  it('reports nothing for a closed day', () => {
    expect(codes([day(0)])).toEqual([]);
  });

  it('rule 1 — a missing opening or closing time', () => {
    expect(codes([day(1, ['', '20:00'])])).toEqual(['MISSING_TIME']);
    expect(codes([day(1, ['08:00', ''])])).toEqual(['MISSING_TIME']);
  });

  it('rule 5 — a malformed time, reported before any comparison', () => {
    expect(codes([day(1, ['8am', '20:00'])])).toEqual(['INVALID_TIME_FORMAT']);
  });

  it('rule 4 — equal times are a zero-length interval', () => {
    expect(codes([day(1, ['08:00', '08:00'])])).toEqual(['EQUAL_TIMES']);
  });

  /**
   * M12-D06: a closing time earlier than the opening time is reported as the
   * unsupported overnight case, not as a mistake, because a shop trading
   * 18:00–02:00 has not made an input error.
   */
  it('rules 2 and 3 — a closing time before the opening time reads as unsupported overnight', () => {
    expect(codes([day(5, ['18:00', '02:00'])])).toEqual(['OVERNIGHT_UNSUPPORTED']);
    expect(codes([day(5, ['20:00', '08:00'])])).toEqual(['OVERNIGHT_UNSUPPORTED']);
  });

  it('rule 6 — two intervals on one day may not overlap', () => {
    expect(codes([day(1, ['08:00', '14:00'], ['12:00', '20:00'])])).toEqual([
      'OVERLAPPING_INTERVALS',
    ]);
  });

  it('rule 6 — touching endpoints are not an overlap', () => {
    // A continuous day expressed as two intervals is legal, and blocking it
    // would forbid something the schema stores happily.
    expect(codes([day(1, ['07:00', '13:00'], ['13:00', '20:00'])])).toEqual([]);
  });

  it('rule 6 — an interval fully inside another is an overlap', () => {
    expect(codes([day(1, ['08:00', '20:00'], ['10:00', '12:00'])])).toEqual([
      'OVERLAPPING_INTERVALS',
    ]);
  });

  it('rule 7 — an exact duplicate is reported as a duplicate, not an overlap', () => {
    expect(codes([day(1, ['08:00', '20:00'], ['08:00', '20:00'])])).toEqual([
      'DUPLICATE_INTERVAL',
    ]);
  });

  it('does not compare intervals across different days', () => {
    expect(codes([day(1, ['08:00', '20:00']), day(2, ['08:00', '20:00'])])).toEqual([]);
  });

  it('reports every issue, not only the first, so the footer can count them', () => {
    const issues = validateWeeklyHours([day(1, ['08:00', '08:00']), day(2, ['', ''])]);

    expect(issues).toEqual([
      { dayOfWeek: 1, intervalIndex: 0, code: 'EQUAL_TIMES' },
      { dayOfWeek: 2, intervalIndex: 0, code: 'MISSING_TIME' },
    ]);
  });

  it('locates an issue by day and interval index, so a field can take focus', () => {
    const issues = validateWeeklyHours([day(6, ['07:00', '13:00'], ['20:00', '16:00'])]);

    expect(issues).toEqual([{ dayOfWeek: 6, intervalIndex: 1, code: 'OVERNIGHT_UNSUPPORTED' }]);
  });
});
