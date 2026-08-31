import { countTodayOrders, countWaitingOrders, isBangkokSameDay } from './boardCounts';
import type { MerchantOrderSummary } from '../domain/order';

function order(overrides: Partial<MerchantOrderSummary> & { id: string; placedAt: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 10000,
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

describe('isBangkokSameDay', () => {
  it('is true for two instants on the same Bangkok calendar day', () => {
    // 2026-08-31 08:00 and 16:00 Bangkok — both well inside the same day.
    const a = Date.parse('2026-08-31T01:00:00.000Z'); // 08:00 Bangkok
    const b = Date.parse('2026-08-31T09:00:00.000Z'); // 16:00 Bangkok
    expect(isBangkokSameDay(a, b)).toBe(true);
  });

  it('is false for yesterday vs today in Bangkok', () => {
    const today = Date.parse('2026-08-31T08:00:00.000Z');
    const yesterday = Date.parse('2026-08-30T08:00:00.000Z');
    expect(isBangkokSameDay(today, yesterday)).toBe(false);
  });

  it('resolves the UTC/Bangkok boundary correctly — late UTC evening is already tomorrow in Bangkok', () => {
    // 2026-08-31T18:00:00Z is 2026-09-01T01:00 in Bangkok (+7): the next day.
    const lateUtc = Date.parse('2026-08-31T18:00:00.000Z');
    const earlyBangkokNextDay = Date.parse('2026-09-01T00:00:00.000Z'); // 07:00 Bangkok, 09-01
    const stillAug31Bangkok = Date.parse('2026-08-31T15:00:00.000Z'); // 22:00 Bangkok, 08-31

    expect(isBangkokSameDay(lateUtc, earlyBangkokNextDay)).toBe(true);
    expect(isBangkokSameDay(lateUtc, stillAug31Bangkok)).toBe(false);
  });
});

describe('countTodayOrders', () => {
  const nowMs = Date.parse('2026-08-31T08:00:00.000Z'); // 15:00 Bangkok, Aug 31

  it('is zero for an empty board', () => {
    expect(countTodayOrders([], nowMs)).toBe(0);
  });

  it('counts an order placed earlier today (Bangkok)', () => {
    const orders = [order({ id: '1', placedAt: '2026-08-31T01:30:00.000Z' })]; // 08:30 Bangkok
    expect(countTodayOrders(orders, nowMs)).toBe(1);
  });

  it('excludes an order placed yesterday (Bangkok)', () => {
    const orders = [order({ id: '1', placedAt: '2026-08-30T10:00:00.000Z' })];
    expect(countTodayOrders(orders, nowMs)).toBe(0);
  });

  it('counts every state, not just board-active ones — this is a daily total', () => {
    const orders = [
      order({ id: '1', placedAt: '2026-08-31T02:00:00.000Z', state: 'DELIVERED' }),
      order({ id: '2', placedAt: '2026-08-31T03:00:00.000Z', state: 'CANCELLED' }),
      order({ id: '3', placedAt: '2026-08-31T04:00:00.000Z', state: 'PAID' }),
    ];
    expect(countTodayOrders(orders, nowMs)).toBe(3);
  });

  it('reflects whatever restaurant-scoped array it is given, mixed or not', () => {
    const orders = [
      order({ id: '1', placedAt: '2026-08-31T02:00:00.000Z', restaurantId: 'rest-a' }),
      order({ id: '2', placedAt: '2026-08-31T03:00:00.000Z', restaurantId: 'rest-b' }),
    ];
    expect(countTodayOrders(orders, nowMs)).toBe(2);
    expect(countTodayOrders(orders.filter((o) => o.restaurantId === 'rest-a'), nowMs)).toBe(1);
  });

  it('ignores an order with an unparseable placedAt rather than throwing', () => {
    const orders = [order({ id: '1', placedAt: 'not-a-date' })];
    expect(countTodayOrders(orders, nowMs)).toBe(0);
  });
});

describe('countWaitingOrders', () => {
  it('is zero for an empty board', () => {
    expect(countWaitingOrders([])).toBe(0);
  });

  it('counts only PAID orders', () => {
    const orders = [
      order({ id: '1', placedAt: '2026-08-31T02:00:00.000Z', state: 'PAID' }),
      order({ id: '2', placedAt: '2026-08-31T02:00:00.000Z', state: 'MERCHANT_ACCEPTED' }),
      order({ id: '3', placedAt: '2026-08-31T02:00:00.000Z', state: 'PREPARING' }),
      order({ id: '4', placedAt: '2026-08-31T02:00:00.000Z', state: 'READY_FOR_PICKUP' }),
    ];
    expect(countWaitingOrders(orders)).toBe(1);
  });

  it('counts multiple PAID orders, including ones whose accept window has expired', () => {
    const orders = [
      order({ id: '1', placedAt: '2026-08-31T02:00:00.000Z', state: 'PAID' }),
      order({ id: '2', placedAt: '2026-08-30T02:00:00.000Z', state: 'PAID' }),
    ];
    expect(countWaitingOrders(orders)).toBe(2);
  });
});
