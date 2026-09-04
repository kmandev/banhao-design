import {
  deriveAvailability,
  formatNextOpening,
  formatTodayHours,
  isOpenNow,
  isTemporarilyClosed,
  nextOpening,
  parseTimeToMinutes,
  toBangkokMoment,
  windowsForDay,
} from './openingHours';
import type { OpeningWindow } from '../domain/catalog';

/**
 * All instants below are written as UTC (`Z`) and asserted against Bangkok
 * wall-clock, which is UTC+7. That is the whole point of the module: the
 * device's zone must not decide whether a shop is open.
 */

/** Sunday 2026-08-16 in Bangkok terms. `day_of_week` 0 = Sunday. */
const SUNDAY = (hhmmUtc: string) => new Date(`2026-08-16T${hhmmUtc}:00Z`);

const NINE_TO_EIGHT: OpeningWindow[] = [
  { dayOfWeek: 0, opensAt: '09:00:00', closesAt: '20:00:00' },
];

describe('toBangkokMoment', () => {
  it('projects a UTC instant into Bangkok wall-clock', () => {
    // 02:00Z on Sunday is 09:00 Sunday in Bangkok.
    expect(toBangkokMoment(SUNDAY('02:00'))).toEqual({
      dayOfWeek: 0,
      minutesSinceMidnight: 9 * 60,
    });
  });

  it('rolls the weekday forward when Bangkok is already the next day', () => {
    // 18:00Z Sunday is 01:00 Monday in Bangkok — a device in UTC would get
    // Sunday's hours wrong here.
    expect(toBangkokMoment(SUNDAY('18:00'))).toEqual({
      dayOfWeek: 1,
      minutesSinceMidnight: 60,
    });
  });

  it('handles the Bangkok midnight boundary as minute zero', () => {
    expect(toBangkokMoment(SUNDAY('17:00')).minutesSinceMidnight).toBe(0);
  });
});

describe('parseTimeToMinutes', () => {
  it.each([
    ['09:00:00', 540],
    ['09:00', 540],
    ['00:00:00', 0],
    ['23:59:00', 1439],
  ])('parses %s', (input, expected) => {
    expect(parseTimeToMinutes(input)).toBe(expected);
  });

  it.each(['', 'nonsense', '9:00', '25:00:00', '09:61:00'])('rejects %s', (input) => {
    expect(parseTimeToMinutes(input)).toBeNull();
  });
});

describe('isOpenNow', () => {
  it('is closed before opening', () => {
    // 08:59 Bangkok
    expect(isOpenNow(NINE_TO_EIGHT, null, SUNDAY('01:59'))).toBe(false);
  });

  it('is open exactly at opening time', () => {
    expect(isOpenNow(NINE_TO_EIGHT, null, SUNDAY('02:00'))).toBe(true);
  });

  it('is open during the window', () => {
    expect(isOpenNow(NINE_TO_EIGHT, null, SUNDAY('07:00'))).toBe(true);
  });

  it('is CLOSED exactly at closing time — the interval is half-open', () => {
    // 20:00 Bangkok. The kitchen has stopped; treating this as open would let
    // an order in that nobody will cook.
    expect(isOpenNow(NINE_TO_EIGHT, null, SUNDAY('13:00'))).toBe(false);
  });

  it('is closed after closing', () => {
    expect(isOpenNow(NINE_TO_EIGHT, null, SUNDAY('14:00'))).toBe(false);
  });

  it('is closed when the restaurant has no hours at all', () => {
    expect(isOpenNow([], null, SUNDAY('07:00'))).toBe(false);
  });

  it('is closed on a day with no window, even mid-afternoon', () => {
    const mondayOnly: OpeningWindow[] = [
      { dayOfWeek: 1, opensAt: '09:00:00', closesAt: '20:00:00' },
    ];
    expect(isOpenNow(mondayOnly, null, SUNDAY('07:00'))).toBe(false);
  });

  it('supports a split day, closed in the gap', () => {
    const split: OpeningWindow[] = [
      { dayOfWeek: 0, opensAt: '09:00:00', closesAt: '13:00:00' },
      { dayOfWeek: 0, opensAt: '17:00:00', closesAt: '21:00:00' },
    ];
    expect(isOpenNow(split, null, SUNDAY('03:00'))).toBe(true); // 10:00
    expect(isOpenNow(split, null, SUNDAY('08:00'))).toBe(false); // 15:00, in the gap
    expect(isOpenNow(split, null, SUNDAY('11:00'))).toBe(true); // 18:00
  });

  it('ignores a malformed time rather than treating it as open', () => {
    const broken: OpeningWindow[] = [{ dayOfWeek: 0, opensAt: 'oops', closesAt: '20:00:00' }];
    expect(isOpenNow(broken, null, SUNDAY('07:00'))).toBe(false);
  });
});

describe('temporary closure', () => {
  it('is closed while a temporary closure is active, despite regular hours', () => {
    const until = '2026-08-16T12:00:00Z';
    expect(isTemporarilyClosed(until, SUNDAY('07:00'))).toBe(true);
    expect(isOpenNow(NINE_TO_EIGHT, until, SUNDAY('07:00'))).toBe(false);
  });

  it('ignores a closure that has already expired', () => {
    const until = '2026-08-16T01:00:00Z';
    expect(isTemporarilyClosed(until, SUNDAY('07:00'))).toBe(false);
    expect(isOpenNow(NINE_TO_EIGHT, until, SUNDAY('07:00'))).toBe(true);
  });

  it('treats a future closure as in force now', () => {
    // Set days ahead: still "until", so still shut.
    expect(isTemporarilyClosed('2026-08-20T00:00:00Z', SUNDAY('07:00'))).toBe(true);
  });

  it('ignores a null or unparseable value rather than closing the shop', () => {
    expect(isTemporarilyClosed(null, SUNDAY('07:00'))).toBe(false);
    expect(isTemporarilyClosed('not-a-date', SUNDAY('07:00'))).toBe(false);
  });
});

describe('formatTodayHours', () => {
  it('formats a single window without seconds', () => {
    expect(formatTodayHours(NINE_TO_EIGHT, SUNDAY('07:00'))).toBe('09:00 - 20:00');
  });

  it('joins a split day in opening order', () => {
    const split: OpeningWindow[] = [
      { dayOfWeek: 0, opensAt: '17:00:00', closesAt: '21:00:00' },
      { dayOfWeek: 0, opensAt: '09:00:00', closesAt: '13:00:00' },
    ];
    expect(formatTodayHours(split, SUNDAY('07:00'))).toBe('09:00 - 13:00, 17:00 - 21:00');
  });

  it('returns null when the shop does not open today', () => {
    expect(formatTodayHours([], SUNDAY('07:00'))).toBeNull();
  });
});

describe('windowsForDay', () => {
  it('selects only the requested weekday', () => {
    const hours: OpeningWindow[] = [
      { dayOfWeek: 0, opensAt: '09:00:00', closesAt: '20:00:00' },
      { dayOfWeek: 1, opensAt: '10:00:00', closesAt: '21:00:00' },
    ];
    expect(windowsForDay(hours, 1)).toEqual([
      { dayOfWeek: 1, opensAt: '10:00:00', closesAt: '21:00:00' },
    ]);
  });
});

describe('deriveAvailability', () => {
  it('returns every derived value together', () => {
    expect(deriveAvailability(NINE_TO_EIGHT, null, 'NORMAL', SUNDAY('07:00'))).toEqual({
      isOpen: true,
      todayHours: '09:00 - 20:00',
      isOrderable: true,
    });
  });

  it('reports closed-but-known-hours, which is what the closed screen shows', () => {
    expect(deriveAvailability(NINE_TO_EIGHT, null, 'NORMAL', SUNDAY('14:00'))).toEqual({
      isOpen: false,
      todayHours: '09:00 - 20:00',
      isOrderable: false,
    });
  });

  it('M-13: Busy stays isOpen and isOrderable — only the estimate changes elsewhere', () => {
    const result = deriveAvailability(NINE_TO_EIGHT, null, 'BUSY', SUNDAY('07:00'));
    expect(result.isOpen).toBe(true);
    expect(result.isOrderable).toBe(true);
  });

  it('M-13: Paused stays isOpen (not the ordinary closed badge) but is not orderable', () => {
    const result = deriveAvailability(NINE_TO_EIGHT, null, 'PAUSED', SUNDAY('07:00'));
    expect(result.isOpen).toBe(true);
    expect(result.isOrderable).toBe(false);
  });

  it('M-13: Paused outside opening hours is neither open nor orderable — hours stay authoritative', () => {
    const result = deriveAvailability(NINE_TO_EIGHT, null, 'PAUSED', SUNDAY('14:00'));
    expect(result.isOpen).toBe(false);
    expect(result.isOrderable).toBe(false);
  });
});

describe('F-1 — the Intl capability this module depends on', () => {
  /**
   * `toBangkokMoment` is built on `Intl.DateTimeFormat(…{ timeZone }).formatToParts`.
   * If a runtime lacks IANA timezone data, that call does not throw — it
   * silently falls back to local time, and a shop reports the wrong open/closed
   * state with no error anywhere. Pinning the capability here makes the
   * dependency explicit and fails loudly if an environment ever lacks it.
   *
   * This runs on Node (full ICU) and so cannot speak for the on-device engine;
   * the Hermes result is recorded in the C-8 report. It is a contract check,
   * not a substitute for device verification.
   */
  it('supports formatToParts with an IANA time zone', () => {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    expect(typeof format.formatToParts).toBe('function');

    const parts = format.formatToParts(new Date('2026-08-16T02:00:00Z'));
    const value = (type: string) => parts.find((part) => part.type === type)?.value;

    // 02:00Z is 09:00 Sunday in Bangkok. A runtime without zone data would
    // report the machine's local time here instead.
    expect(value('weekday')).toBe('Sun');
    expect(value('hour')).toBe('09');
  });
});

describe('nextOpening / formatNextOpening — C-9 closed-restaurant banner', () => {
  it('finds a later window on the SAME day when closed before it opens', () => {
    // Split hours: lunch 09:00-13:00, dinner 17:00-21:00. It is 15:00 Bangkok.
    const split: OpeningWindow[] = [
      { dayOfWeek: 0, opensAt: '09:00:00', closesAt: '13:00:00' },
      { dayOfWeek: 0, opensAt: '17:00:00', closesAt: '21:00:00' },
    ];
    expect(nextOpening(split, SUNDAY('08:00'))).toEqual({ daysAhead: 0, time: '17:00' });
    expect(formatNextOpening(split, SUNDAY('08:00'))).toBe('เปิด 17:00 วันนี้');
  });

  it('does not treat a window already in progress as "next"', () => {
    // 10:00 Bangkok, inside 09:00-20:00 — nothing left to announce today.
    // The single window has already opened, so the scan must roll to next week.
    const next = nextOpening(NINE_TO_EIGHT, SUNDAY('03:00'));
    expect(next).not.toEqual({ daysAhead: 0, time: '09:00' });
  });

  it('rolls to tomorrow when closed for the rest of today', () => {
    // Open every day. 22:00 Bangkok, past the 09:00-20:00 window.
    const everyDay: OpeningWindow[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      opensAt: '09:00:00',
      closesAt: '20:00:00',
    }));
    expect(nextOpening(everyDay, SUNDAY('15:00'))).toEqual({ daysAhead: 1, time: '09:00' });
    expect(formatNextOpening(everyDay, SUNDAY('15:00'))).toBe('เปิด 09:00 พรุ่งนี้');
  });

  it('matches the exact UX-SPEC § 13 example verbatim', () => {
    // "ร้านปิดอยู่ · เปิด 08:00 พรุ่งนี้"
    const eightAm: OpeningWindow[] = [{ dayOfWeek: 1, opensAt: '08:00:00', closesAt: '20:00:00' }];
    expect(formatNextOpening(eightAm, SUNDAY('15:00'))).toBe('เปิด 08:00 พรุ่งนี้');
  });

  it('skips a closed day and finds the correct weekday name further out', () => {
    // Open only Wednesdays (3). Sunday (0) + 3 days ahead = Wednesday.
    const wednesdaysOnly: OpeningWindow[] = [
      { dayOfWeek: 3, opensAt: '10:00:00', closesAt: '18:00:00' },
    ];
    expect(nextOpening(wednesdaysOnly, SUNDAY('07:00'))).toEqual({ daysAhead: 3, time: '10:00' });
    expect(formatNextOpening(wednesdaysOnly, SUNDAY('07:00'))).toBe('เปิด 10:00 วันพุธ');
  });

  it('wraps a full week forward when open only one day, already passed today', () => {
    // Sunday-only hours, already closed today (22:00 Bangkok). The true next
    // opening is next Sunday — seven days ahead, not "nothing".
    expect(nextOpening(NINE_TO_EIGHT, SUNDAY('15:00'))).toEqual({ daysAhead: 7, time: '09:00' });
    expect(formatNextOpening(NINE_TO_EIGHT, SUNDAY('15:00'))).toBe('เปิด 09:00 วันอาทิตย์');
  });

  it('returns null when the restaurant has no hours at all', () => {
    expect(nextOpening([], SUNDAY('07:00'))).toBeNull();
    expect(formatNextOpening([], SUNDAY('07:00'))).toBeNull();
  });

  it('ignores a malformed opening time when scanning forward', () => {
    const broken: OpeningWindow[] = [
      { dayOfWeek: 0, opensAt: 'oops', closesAt: '20:00:00' },
      { dayOfWeek: 1, opensAt: '08:00:00', closesAt: '20:00:00' },
    ];
    expect(nextOpening(broken, SUNDAY('07:00'))).toEqual({ daysAhead: 1, time: '08:00' });
  });
});
