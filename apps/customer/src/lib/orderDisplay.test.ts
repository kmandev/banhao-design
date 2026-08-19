import type { OrderState } from '../domain/order';
import {
  formatOrderPlacedAt,
  orderStateLabel,
  orderStateTone,
  paymentMethodLabel,
  summariseItems,
} from './orderDisplay';

/**
 * Phase E-3B.3 — the presentation layer between the real order domain and the
 * two order screens.
 *
 * The point of these tests is that the copy is *transcribed*: each expected
 * string below is the one in `docs/design/BANHAO-UX-SPEC-V1.md` §10, so a
 * later edit that "improves" the wording fails here rather than silently
 * diverging from the approved design.
 */

describe('orderStateLabel — UX-SPEC §10 customer vocabulary', () => {
  it.each([
    ['PENDING_PAYMENT', 'รอชำระเงิน'],
    ['PAID', 'ส่งให้ร้านแล้ว · รอร้านรับออเดอร์'],
    ['MERCHANT_ACCEPTED', 'ร้านรับออเดอร์แล้ว'],
    ['PREPARING', 'ร้านกำลังทำอาหาร'],
    ['READY_FOR_PICKUP', 'อาหารพร้อมแล้ว'],
    ['PICKED_UP', 'ไรเดอร์รับอาหารแล้ว'],
    ['DELIVERING', 'กำลังไปส่ง'],
    ['DELIVERED', 'จัดส่งสำเร็จ'],
    ['CANCELLED', 'ออเดอร์ถูกยกเลิก'],
  ] as [OrderState, string][])('%s renders the approved copy', (state, expected) => {
    expect(orderStateLabel(state)).toBe(expected);
  });

  it('returns null for CREATED — §10 lists it as transient, with no screen and no copy', () => {
    expect(orderStateLabel('CREATED')).toBeNull();
  });

  it.each(['PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'MERCHANT_REJECTED', 'DELIVERY_FAILED'] as OrderState[])(
    'returns null for the unimplemented exception state %s rather than leaking the identifier',
    (state) => {
      // §10: "No state name, cause code, or error code is ever rendered to a
      // user." These four remain PROPOSED and DEC-APP-006 leaves them out of V1.
      expect(orderStateLabel(state)).toBeNull();
    },
  );

  it('never returns an English identifier for any state the schema permits', () => {
    const everyState: OrderState[] = [
      'CREATED',
      'PENDING_PAYMENT',
      'PAID',
      'MERCHANT_ACCEPTED',
      'PREPARING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'DELIVERING',
      'DELIVERED',
      'PAYMENT_FAILED',
      'PAYMENT_EXPIRED',
      'MERCHANT_REJECTED',
      'CANCELLED',
      'DELIVERY_FAILED',
    ];

    for (const state of everyState) {
      expect(orderStateLabel(state)).not.toBe(state);
    }
  });
});

describe('orderStateTone', () => {
  it('maps the design foundation colours onto the four available badge tones', () => {
    expect(orderStateTone('DELIVERED')).toBe('success');
    expect(orderStateTone('PAID')).toBe('success');
    expect(orderStateTone('PENDING_PAYMENT')).toBe('warning');
    expect(orderStateTone('PREPARING')).toBe('primary');
    expect(orderStateTone('PICKED_UP')).toBe('neutral');
    expect(orderStateTone('CANCELLED')).toBe('neutral');
  });

  it('falls back to neutral for a state with no assigned colour', () => {
    expect(orderStateTone('DELIVERY_FAILED')).toBe('neutral');
  });
});

describe('paymentMethodLabel — schema vocabulary, not the mock', () => {
  it('renders ONLINE as พร้อมเพย์', () => {
    expect(paymentMethodLabel('ONLINE')).toBe('พร้อมเพย์');
  });

  it('renders CASH as เงินสด — DEC-016 disables it but keeps it representable', () => {
    expect(paymentMethodLabel('CASH')).toBe('เงินสด');
  });
});

describe('summariseItems', () => {
  it('joins lines in the design canvas format', () => {
    expect(
      summariseItems([
        { nameSnapshot: 'ก๋วยเตี๋ยวเรือน้ำตก', quantity: 2 },
        { nameSnapshot: 'เกี๊ยวทอด', quantity: 1 },
      ]),
    ).toBe('ก๋วยเตี๋ยวเรือน้ำตก ×2, เกี๊ยวทอด ×1');
  });

  it('is empty for an order with no readable lines', () => {
    expect(summariseItems([])).toBe('');
  });
});

describe('formatOrderPlacedAt — Asia/Bangkok, design canvas format', () => {
  it('renders the Bangkok wall clock, not the runtime zone', () => {
    // 2026-08-06T12:02:00Z is 19:02 in Bangkok (UTC+7) — the exact value the
    // design canvas fixture shows as `6 ส.ค. 19:02 น.`.
    expect(formatOrderPlacedAt('2026-08-06T12:02:00Z')).toBe('6 ส.ค. 19:02 น.');
  });

  it('rolls the date forward when Bangkok is already on the next day', () => {
    // 23:30Z on the 5th is 06:30 on the 6th in Bangkok.
    expect(formatOrderPlacedAt('2026-08-05T23:30:00Z')).toBe('6 ส.ค. 06:30 น.');
  });

  it('renders Bangkok midnight as 00, not 24', () => {
    expect(formatOrderPlacedAt('2026-08-05T17:00:00Z')).toBe('6 ส.ค. 00:00 น.');
  });

  it('uses the Thai abbreviation for each month', () => {
    expect(formatOrderPlacedAt('2026-01-15T05:00:00Z')).toBe('15 ม.ค. 12:00 น.');
    expect(formatOrderPlacedAt('2026-12-15T05:00:00Z')).toBe('15 ธ.ค. 12:00 น.');
  });

  it('returns null for an unparseable timestamp rather than printing Invalid Date', () => {
    expect(formatOrderPlacedAt('not-a-timestamp')).toBeNull();
  });
});
