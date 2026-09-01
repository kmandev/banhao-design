import {
  bangkokDayOfWeek,
  formatPriceDelta,
  parseBahtToSatang,
  satangToBahtInput,
  summariseMenu,
} from './menuDisplay';
import type { MenuSection } from '../domain/menu';

describe('satangToBahtInput', () => {
  it.each([
    [6500, '65.00'],
    [0, '0.00'],
    [5, '0.05'],
    [123456, '1234.56'],
  ])('renders %i satang as %s baht', (satang, expected) => {
    expect(satangToBahtInput(satang)).toBe(expected);
  });
});

describe('parseBahtToSatang', () => {
  it.each([
    ['65', 6500],
    ['65.00', 6500],
    ['65.5', 6550],
    ['0', 0],
    ['0.01', 1],
    ['1,234.56', 123456],
  ])('parses %p to %i satang', (input, satang) => {
    expect(parseBahtToSatang(input)).toEqual({ ok: true, satang });
  });

  it('repairs binary floating point rather than rounding a merchant’s number', () => {
    // 65.7 * 100 === 6569.999999999999 in IEEE 754. The two-decimal check has
    // already proven the value is exact in satang by this point.
    expect(parseBahtToSatang('65.7')).toEqual({ ok: true, satang: 6570 });
    expect(parseBahtToSatang('0.29')).toEqual({ ok: true, satang: 29 });
  });

  it.each([
    ['', 'REQUIRED'],
    ['   ', 'REQUIRED'],
    ['abc', 'NOT_A_NUMBER'],
    ['65฿', 'NOT_A_NUMBER'],
    ['-1', 'NEGATIVE'],
    ['-0.5', 'NEGATIVE'],
    ['65.555', 'TOO_PRECISE'],
  ])('refuses %p with %s', (input, reason) => {
    expect(parseBahtToSatang(input)).toEqual({ ok: false, reason });
  });

  it('never silently rounds an over-precise price', () => {
    // A merchant who typed 65.555 is told, not handed 65.56 they did not choose.
    expect(parseBahtToSatang('65.555').ok).toBe(false);
  });
});

describe('formatPriceDelta', () => {
  it.each([
    [0, '+฿0'],
    [1000, '+฿10.00'],
    [-500, '−฿5.00'],
  ])('renders %i as %s', (satang, expected) => {
    expect(formatPriceDelta(satang)).toBe(expected);
  });
});

describe('summariseMenu', () => {
  const section = (items: { isAvailable: boolean }[]): MenuSection =>
    ({
      category: { id: 'c', name: 'x', sortOrder: 0, archivedAt: null },
      items: items.map((item, index) => ({
        id: `i${index}`,
        categoryId: 'c',
        name: 'x',
        description: null,
        basePriceSatang: 100,
        imageUrl: null,
        isAvailable: item.isAvailable,
        sortOrder: index,
        archivedAt: null,
        updatedAt: '2026-09-01T00:00:00Z',
        optionGroupCount: 0,
      })),
    }) as MenuSection;

  it('counts items and the unavailable subset across every section', () => {
    expect(
      summariseMenu([
        section([{ isAvailable: true }, { isAvailable: false }]),
        section([{ isAvailable: true }]),
      ]),
    ).toEqual({ itemCount: 3, unavailableCount: 1 });
  });

  it('reports zero for an empty menu', () => {
    expect(summariseMenu([])).toEqual({ itemCount: 0, unavailableCount: 0 });
  });
});

describe('bangkokDayOfWeek', () => {
  /**
   * The whole point: the day is resolved in the shop's zone, not the device's.
   * 0 = Sunday, matching `restaurant_hours.day_of_week`.
   */
  it.each([
    ['2026-08-16T12:00:00Z', 0, 'Sunday'],
    ['2026-08-17T12:00:00Z', 1, 'Monday'],
    ['2026-08-22T12:00:00Z', 6, 'Saturday'],
  ])('resolves %s to %i (%s)', (iso, expected) => {
    expect(bangkokDayOfWeek(new Date(iso))).toBe(expected);
  });

  it('uses Bangkok, not UTC, across the date boundary', () => {
    // 2026-08-16T18:00Z is Sunday in UTC but already Monday 01:00 in Bangkok.
    // A tablet reading UTC would highlight the wrong row.
    expect(bangkokDayOfWeek(new Date('2026-08-16T18:00:00Z'))).toBe(1);
    // And 2026-08-17T02:00Z is Monday in UTC and still Monday 09:00 in Bangkok.
    expect(bangkokDayOfWeek(new Date('2026-08-17T02:00:00Z'))).toBe(1);
  });

  it('does not shift the week by one anywhere in the cycle', () => {
    const sunday = Date.parse('2026-08-16T05:00:00Z');
    const days = Array.from({ length: 7 }, (_, offset) =>
      bangkokDayOfWeek(new Date(sunday + offset * 24 * 60 * 60 * 1000)),
    );

    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
