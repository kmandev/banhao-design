import { isRestaurantOpenAt, type OpeningWindowRow } from './restaurant-open';

/** A Bangkok wall-clock instant. Bangkok is UTC+7 with no DST. */
function bkk(iso: string): Date {
  return new Date(`${iso}+07:00`);
}

// 2026-11-08 is a Sunday (day_of_week 0); 2026-11-09 a Monday (1).
const DAILY_9_TO_20: OpeningWindowRow[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day_of_week: day,
  opens_at: '09:00:00',
  closes_at: '20:00:00',
}));

describe('isRestaurantOpenAt', () => {
  it.each([
    ['2026-11-08T08:59:00', false, 'a minute before opening'],
    ['2026-11-08T09:00:00', true, 'the opening minute'],
    ['2026-11-08T13:30:00', true, 'mid-day'],
    ['2026-11-08T19:59:00', true, 'the last open minute'],
    ['2026-11-08T20:00:00', false, 'the closing minute is already closed'],
    ['2026-11-08T00:40:00', false, 'after midnight — the case that let a test order through'],
  ])('%s Bangkok → %p (%s)', (at, expected) => {
    expect(isRestaurantOpenAt(DAILY_9_TO_20, null, bkk(at))).toBe(expected);
  });

  it('judges by Bangkok time, not the server clock: 02:00 UTC is 09:00 in Bangkok', () => {
    expect(isRestaurantOpenAt(DAILY_9_TO_20, null, new Date('2026-11-08T02:00:00Z'))).toBe(true);
    expect(isRestaurantOpenAt(DAILY_9_TO_20, null, new Date('2026-11-08T01:59:00Z'))).toBe(false);
  });

  it('uses day_of_week 0 = Sunday', () => {
    const mondayOnly: OpeningWindowRow[] = [{ day_of_week: 1, opens_at: '09:00', closes_at: '20:00' }];
    expect(isRestaurantOpenAt(mondayOnly, null, bkk('2026-11-08T12:00:00'))).toBe(false); // Sunday
    expect(isRestaurantOpenAt(mondayOnly, null, bkk('2026-11-09T12:00:00'))).toBe(true); // Monday
  });

  it('honours a split day and is closed in the gap', () => {
    const split: OpeningWindowRow[] = [
      { day_of_week: 0, opens_at: '10:00:00', closes_at: '14:00:00' },
      { day_of_week: 0, opens_at: '17:00:00', closes_at: '21:00:00' },
    ];
    expect(isRestaurantOpenAt(split, null, bkk('2026-11-08T11:00:00'))).toBe(true);
    expect(isRestaurantOpenAt(split, null, bkk('2026-11-08T15:00:00'))).toBe(false);
    expect(isRestaurantOpenAt(split, null, bkk('2026-11-08T18:00:00'))).toBe(true);
  });

  it('treats a restaurant with no hours as closed', () => {
    expect(isRestaurantOpenAt([], null, bkk('2026-11-08T12:00:00'))).toBe(false);
  });

  it('a future temporary closure closes an otherwise open shop; a past one is ignored', () => {
    const now = bkk('2026-11-08T12:00:00');
    expect(isRestaurantOpenAt(DAILY_9_TO_20, '2026-11-08T13:00:00+07:00', now)).toBe(false);
    expect(isRestaurantOpenAt(DAILY_9_TO_20, '2026-11-08T11:00:00+07:00', now)).toBe(true);
  });

  it('a malformed time closes that window rather than opening it', () => {
    const broken: OpeningWindowRow[] = [{ day_of_week: 0, opens_at: 'nine', closes_at: '20:00' }];
    expect(isRestaurantOpenAt(broken, null, bkk('2026-11-08T12:00:00'))).toBe(false);
  });
});
