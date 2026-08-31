import type { MerchantOrderSummary } from '../domain/order';
import {
  BOARD_COLUMNS,
  MERCHANT_ACCEPT_WINDOW_SECONDS,
  acceptWindowState,
  boardColumnForState,
  formatArrivalSeconds,
  formatBahtFixed,
  formatClockTime,
  formatCountdown,
  formatElapsedShort,
  groupOrdersByColumn,
  isRecentArrival,
  presentOrderCard,
} from './orderBoardDisplay';

function order(overrides: Partial<MerchantOrderSummary> & { id: string }): MerchantOrderSummary {
  return {
    orderNumber: `BH-${overrides.id}`,
    state: 'PAID',
    restaurantId: 'rest-a',
    recipientNameSnapshot: 'คุณสมชาย ใจดี',
    recipientPhoneSnapshot: '+66812345678',
    grandTotalSatang: 18500,
    placedAt: '2026-08-31T04:42:00.000Z',
    acceptedAt: null,
    readyAt: null,
    pickedUpAt: null,
    ...overrides,
  };
}

const NOW = Date.parse('2026-08-31T04:42:00.000Z');

describe('boardColumnForState', () => {
  it('maps PAID to NEW, MERCHANT_ACCEPTED/PREPARING to PREPARING, READY_FOR_PICKUP to READY', () => {
    expect(boardColumnForState('PAID')).toBe('NEW');
    expect(boardColumnForState('MERCHANT_ACCEPTED')).toBe('PREPARING');
    expect(boardColumnForState('PREPARING')).toBe('PREPARING');
    expect(boardColumnForState('READY_FOR_PICKUP')).toBe('READY');
  });

  it('excludes every terminal/off-board state', () => {
    const excluded: MerchantOrderSummary['state'][] = [
      'CREATED',
      'PENDING_PAYMENT',
      'PICKED_UP',
      'DELIVERING',
      'DELIVERED',
      'PAYMENT_FAILED',
      'PAYMENT_EXPIRED',
      'MERCHANT_REJECTED',
      'CANCELLED',
      'DELIVERY_FAILED',
    ];
    for (const state of excluded) expect(boardColumnForState(state)).toBeNull();
  });
});

describe('BOARD_COLUMNS', () => {
  it('pins the exact three column titles and the specified empty copy', () => {
    expect(BOARD_COLUMNS.map((c) => c.id)).toEqual(['NEW', 'PREPARING', 'READY']);
    expect(BOARD_COLUMNS.find((c) => c.id === 'NEW')?.title).toBe('ใหม่ · รอตอบรับ');
    expect(BOARD_COLUMNS.find((c) => c.id === 'NEW')?.emptyCopy).toBe('ยังไม่มีออเดอร์ใหม่');
    expect(BOARD_COLUMNS.find((c) => c.id === 'PREPARING')?.title).toBe('กำลังทำ');
    expect(BOARD_COLUMNS.find((c) => c.id === 'READY')?.title).toBe('พร้อมให้ไรเดอร์รับ');
  });
});

describe('groupOrdersByColumn', () => {
  it('buckets orders by state and drops off-board states, preserving input order', () => {
    const orders = [
      order({ id: '1', state: 'PAID' }),
      order({ id: '2', state: 'DELIVERED' }),
      order({ id: '3', state: 'MERCHANT_ACCEPTED' }),
      order({ id: '4', state: 'PREPARING' }),
      order({ id: '5', state: 'READY_FOR_PICKUP' }),
      order({ id: '6', state: 'CANCELLED' }),
    ];

    const grouped = groupOrdersByColumn(orders);
    expect(grouped.NEW.map((o) => o.id)).toEqual(['1']);
    expect(grouped.PREPARING.map((o) => o.id)).toEqual(['3', '4']);
    expect(grouped.READY.map((o) => o.id)).toEqual(['5']);
  });

  it('returns empty arrays for every column given no orders', () => {
    const grouped = groupOrdersByColumn([]);
    expect(grouped).toEqual({ NEW: [], PREPARING: [], READY: [] });
  });
});

describe('formatBahtFixed', () => {
  it('always renders two decimals, even for a whole-baht amount', () => {
    expect(formatBahtFixed(18500)).toBe('฿185.00');
    expect(formatBahtFixed(9600)).toBe('฿96.00');
    expect(formatBahtFixed(0)).toBe('฿0.00');
  });
});

describe('formatClockTime', () => {
  it('renders HH:MM in Asia/Bangkok', () => {
    // 04:42 UTC == 11:42 Bangkok (+7)
    expect(formatClockTime('2026-08-31T04:42:00.000Z')).toBe('11:42');
  });

  it('returns null for an unparseable timestamp', () => {
    expect(formatClockTime('not-a-date')).toBeNull();
  });
});

describe('formatElapsedShort', () => {
  it('uses วิ. under a minute and นาที at or above it', () => {
    expect(formatElapsedShort(0)).toBe('0 วิ.');
    expect(formatElapsedShort(46)).toBe('46 วิ.');
    expect(formatElapsedShort(59)).toBe('59 วิ.');
    expect(formatElapsedShort(60)).toBe('1 นาที');
    expect(formatElapsedShort(125)).toBe('2 นาที');
  });
});

describe('formatArrivalSeconds', () => {
  it('spells out seconds with no suffix', () => {
    expect(formatArrivalSeconds(12)).toBe('12 วินาที');
  });
});

describe('acceptWindowState', () => {
  it('is normal well within the window', () => {
    const placedAt = new Date(NOW - 10_000).toISOString();
    const { phase, remainingSeconds } = acceptWindowState(placedAt, NOW);
    expect(phase).toBe('normal');
    expect(remainingSeconds).toBe(MERCHANT_ACCEPT_WINDOW_SECONDS - 10);
  });

  it('turns warning in the final third of the 3-minute window', () => {
    // final third starts at remaining <= 60s, i.e. elapsed >= 120s
    const placedAt = new Date(NOW - 130_000).toISOString();
    const { phase, remainingSeconds } = acceptWindowState(placedAt, NOW);
    expect(phase).toBe('warning');
    expect(remainingSeconds).toBe(50);
  });

  it('is expired at exactly the window boundary and never goes negative', () => {
    const atBoundary = new Date(NOW - MERCHANT_ACCEPT_WINDOW_SECONDS * 1000).toISOString();
    expect(acceptWindowState(atBoundary, NOW)).toEqual({ phase: 'expired', remainingSeconds: 0 });

    const wellPast = new Date(NOW - (MERCHANT_ACCEPT_WINDOW_SECONDS + 600) * 1000).toISOString();
    expect(acceptWindowState(wellPast, NOW)).toEqual({ phase: 'expired', remainingSeconds: 0 });
  });
});

describe('formatCountdown', () => {
  it('renders mm:ss with unpadded minutes and never negative', () => {
    expect(formatCountdown(134)).toBe('2:14');
    expect(formatCountdown(38)).toBe('0:38');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('isRecentArrival', () => {
  it('is true under 30 seconds and false at or beyond it', () => {
    expect(isRecentArrival(new Date(NOW - 12_000).toISOString(), NOW)).toBe(true);
    expect(isRecentArrival(new Date(NOW - 29_000).toISOString(), NOW)).toBe(true);
    expect(isRecentArrival(new Date(NOW - 30_000).toISOString(), NOW)).toBe(false);
    expect(isRecentArrival(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
  });
});

describe('presentOrderCard — PAID', () => {
  it('normal phase: primary action, new chip, countdown timer', () => {
    const placedAt = new Date(NOW - 10_000).toISOString();
    const p = presentOrderCard(order({ id: '1', state: 'PAID', placedAt }), NOW)!;

    expect(p.chipLabel).toBe('ใหม่ · รอตอบรับ');
    expect(p.chipTone).toBe('new');
    expect(p.stateCode).toBe('PAID');
    expect(p.timerTone).toBe('ok');
    expect(p.actionLabel).toBe('รับออเดอร์');
    expect(p.actionKind).toBe('button');
    expect(p.actionStyle).toBe('primary');
    expect(p.isExpired).toBe(false);
    expect(p.isNewArrival).toBe(true);
    expect(p.timeLine).toBe('11:41 · 10 วิ.');
  });

  it('warning phase in the final third', () => {
    const placedAt = new Date(NOW - 130_000).toISOString();
    const p = presentOrderCard(order({ id: '1', state: 'PAID', placedAt }), NOW)!;

    expect(p.chipLabel).toBe('ใกล้หมดเวลา');
    expect(p.chipTone).toBe('warning');
    expect(p.timerTone).toBe('warning');
    expect(p.actionLabel).toBe('รับออเดอร์');
    expect(p.isNewArrival).toBe(false);
  });

  it('expired phase: disabled-looking action, timeout chip, action label changes', () => {
    const placedAt = new Date(NOW - 400_000).toISOString();
    const p = presentOrderCard(order({ id: '1', state: 'PAID', placedAt }), NOW)!;

    expect(p.chipLabel).toBe('หมดเวลาตอบรับ');
    expect(p.chipTone).toBe('expired');
    expect(p.timerLabel).toBe('0:00');
    expect(p.actionLabel).toBe('ติดต่อผู้ดูแลระบบ');
    expect(p.actionStyle).toBe('off');
    expect(p.isExpired).toBe(true);
  });

  it('never exposes recipientPhoneSnapshot in the presentation object', () => {
    const p = presentOrderCard(order({ id: '1' }), NOW)!;
    expect(p).not.toHaveProperty('recipientPhoneSnapshot');
    expect(p).not.toHaveProperty('phone');
  });
});

describe('presentOrderCard — MERCHANT_ACCEPTED', () => {
  it('static "รับแล้ว" timer, no countdown, dark action', () => {
    const p = presentOrderCard(
      order({ id: '1', state: 'MERCHANT_ACCEPTED', acceptedAt: '2026-08-31T04:39:00.000Z' }),
      NOW,
    )!;

    expect(p.chipLabel).toBe('รับแล้ว · ยังไม่เริ่มทำ');
    expect(p.chipTone).toBe('cooking');
    expect(p.timerLabel).toBe('รับแล้ว');
    expect(p.timerTone).toBe('neutral');
    expect(p.timeLine).toBe('รับเมื่อ 11:39');
    expect(p.actionLabel).toBe('เริ่มทำอาหาร');
    expect(p.actionKind).toBe('button');
    expect(p.actionStyle).toBe('dark');
  });
});

describe('presentOrderCard — PREPARING', () => {
  it('elapsed-since-accepted minutes, neutral tone, never red', () => {
    const acceptedAt = new Date(NOW - 8 * 60_000).toISOString();
    const p = presentOrderCard(order({ id: '1', state: 'PREPARING', acceptedAt }), NOW)!;

    expect(p.chipLabel).toBe('กำลังทำอาหาร');
    expect(p.timerLabel).toBe('8 นาที');
    expect(p.timerTone).toBe('neutral');
    expect(p.actionLabel).toBe('อาหารพร้อม');
    expect(p.actionStyle).toBe('dark');
  });
});

describe('presentOrderCard — READY_FOR_PICKUP', () => {
  it('is a status strip, not a button, and reuses the chip label as the action label', () => {
    const readyAt = new Date(NOW - 4 * 60_000).toISOString();
    const p = presentOrderCard(order({ id: '1', state: 'READY_FOR_PICKUP', readyAt }), NOW)!;

    expect(p.chipLabel).toBe('รอไรเดอร์มารับ');
    expect(p.timerLabel).toBe('4 นาที');
    expect(p.timerTone).toBe('neutral');
    expect(p.actionKind).toBe('status');
    expect(p.actionLabel).toBe('รอไรเดอร์มารับ');
    expect(p.timeLine).toBe('พร้อมเมื่อ 11:38');
  });
});

describe('presentOrderCard — off-board state', () => {
  it('returns null rather than fabricating a presentation', () => {
    expect(presentOrderCard(order({ id: '1', state: 'DELIVERED' }), NOW)).toBeNull();
    expect(presentOrderCard(order({ id: '1', state: 'CANCELLED' }), NOW)).toBeNull();
  });
});
