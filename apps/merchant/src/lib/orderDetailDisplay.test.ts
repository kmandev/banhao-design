import {
  formatMerchantPhone,
  formatOptionLabel,
  formatPriceDelta,
  formatQuantity,
  orderHistoryActorLabel,
  orderHistoryStateLabel,
  paymentMethodDetailLine,
  telHref,
} from './orderDetailDisplay';

describe('orderHistoryStateLabel', () => {
  it('maps the states the design fixture and UX-SPEC §10 name', () => {
    expect(orderHistoryStateLabel('CREATED')).toBe('สร้างออเดอร์');
    expect(orderHistoryStateLabel('PENDING_PAYMENT')).toBe('รอชำระเงิน');
    expect(orderHistoryStateLabel('PAID')).toBe('ชำระเงินแล้ว');
    expect(orderHistoryStateLabel('MERCHANT_ACCEPTED')).toBe('รับแล้ว · เริ่มทำอาหาร');
    expect(orderHistoryStateLabel('PREPARING')).toBe('กำลังทำอาหาร');
    expect(orderHistoryStateLabel('READY_FOR_PICKUP')).toBe('รอไรเดอร์มารับ');
    expect(orderHistoryStateLabel('PICKED_UP')).toBe('ส่งมอบให้ไรเดอร์แล้ว');
    expect(orderHistoryStateLabel('DELIVERING')).toBe('กำลังจัดส่ง');
    expect(orderHistoryStateLabel('DELIVERED')).toBe('สำเร็จ');
    expect(orderHistoryStateLabel('CANCELLED')).toBe('ออเดอร์ถูกยกเลิก');
  });

  it('returns null for the four still-PROPOSED exception states (C-06) — no invented Thai for an unapproved name', () => {
    expect(orderHistoryStateLabel('PAYMENT_FAILED')).toBeNull();
    expect(orderHistoryStateLabel('PAYMENT_EXPIRED')).toBeNull();
    expect(orderHistoryStateLabel('MERCHANT_REJECTED')).toBeNull();
    expect(orderHistoryStateLabel('DELIVERY_FAILED')).toBeNull();
  });
});

describe('orderHistoryActorLabel', () => {
  it('maps every actor_type value', () => {
    expect(orderHistoryActorLabel('CUSTOMER')).toBe('ลูกค้า');
    expect(orderHistoryActorLabel('MERCHANT')).toBe('ร้านค้า');
    expect(orderHistoryActorLabel('RIDER')).toBe('ไรเดอร์');
    expect(orderHistoryActorLabel('OPERATOR')).toBe('ผู้ดูแลระบบ');
    expect(orderHistoryActorLabel('SYSTEM')).toBe('ระบบ');
  });

  it('gives WEBHOOK its own label — the design fixture\'s "ระบบชำระเงิน" for the payment-webhook actor', () => {
    expect(orderHistoryActorLabel('WEBHOOK')).toBe('ระบบชำระเงิน');
  });
});

describe('formatMerchantPhone', () => {
  it('formats stored E.164 with dashes — design §02 literal example', () => {
    expect(formatMerchantPhone('+66892345678')).toBe('089-234-5678');
  });

  it('formats bare national-with-country-code digits the same way', () => {
    expect(formatMerchantPhone('66892345678')).toBe('089-234-5678');
  });

  it('formats an already-national number unchanged in shape', () => {
    expect(formatMerchantPhone('0892345678')).toBe('089-234-5678');
  });

  it('returns the input unchanged for an unrecognisable value rather than inventing a format', () => {
    expect(formatMerchantPhone('not-a-phone')).toBe('not-a-phone');
    expect(formatMerchantPhone('12345')).toBe('12345');
  });
});

describe('telHref', () => {
  it('uses the raw E.164 value, not the display form', () => {
    expect(telHref('+66892345678')).toBe('tel:+66892345678');
  });
});

describe('formatQuantity', () => {
  it('renders "N×"', () => {
    expect(formatQuantity(2)).toBe('2×');
    expect(formatQuantity(1)).toBe('1×');
  });
});

describe('formatOptionLabel', () => {
  it('composes "group · option"', () => {
    expect(formatOptionLabel('ความเผ็ด', 'เผ็ดมาก')).toBe('ความเผ็ด · เผ็ดมาก');
  });
});

describe('formatPriceDelta', () => {
  it('renders a positive delta with a leading plus', () => {
    expect(formatPriceDelta(2000)).toBe('+฿20.00');
  });

  it('renders a zero delta as "+฿0.00", never bare or omitted — design §02 fixture', () => {
    expect(formatPriceDelta(0)).toBe('+฿0.00');
  });

  it('renders a negative delta with the minus sign, not a hyphen', () => {
    expect(formatPriceDelta(-1000)).toBe('−฿10.00');
  });
});

describe('paymentMethodDetailLine', () => {
  it('renders the design\'s literal ONLINE line', () => {
    expect(paymentMethodDetailLine('ONLINE')).toBe('ชำระออนไลน์แล้ว · payment_method = ONLINE');
  });

  it('renders the bare technical fact for CASH — no design fixture exists for it (DEC-016 disables it in phase 1)', () => {
    expect(paymentMethodDetailLine('CASH')).toBe('payment_method = CASH');
  });
});
