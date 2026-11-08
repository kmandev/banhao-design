import { CUSTOMER_COPY_EVENT_TYPES, customerCopyFor, isSilentFor } from './customer-notification-copy';

/**
 * DEC-068 D1 approved exactly nine events and their Thai wording. These tests
 * pin the set and the text so neither can drift without a visible change here.
 */
describe('customerCopyFor (DEC-068 D1)', () => {
  it('covers exactly the approved events — DEC-068 D1\'s nine and DEC-069\'s three', () => {
    expect([...CUSTOMER_COPY_EVENT_TYPES].sort()).toEqual(
      [
        'OrderCancelled',
        'RefundInitiated',
        'RefundSucceeded',
        'MerchantAcceptedOrder',
        'OrderDeliveryFailed',
        'OrderDelivered',
        'OrderNoRiderFound',
        'OrderPickedUp',
        'OrderReady',
        'PaymentSucceeded',
        'RiderAssigned',
        'RiderSearchStarted',
      ].sort(),
    );
  });

  it.each([
    ['PaymentSucceeded', 'ชำระเงินสำเร็จ', 'ร้านกำลังตรวจออเดอร์ของคุณ'],
    ['MerchantAcceptedOrder', 'ร้านรับออเดอร์แล้ว', 'กำลังเตรียมอาหาร'],
    ['RiderSearchStarted', 'กำลังหาไรเดอร์', 'เราจะแจ้งเมื่อมีไรเดอร์รับงาน'],
    ['RiderAssigned', 'ไรเดอร์รับงานแล้ว', 'ไรเดอร์กำลังไปที่ร้าน'],
    ['OrderReady', 'อาหารพร้อมแล้ว', 'รอไรเดอร์มารับ'],
    ['OrderPickedUp', 'ไรเดอร์รับอาหารแล้ว', 'กำลังนำส่งถึงคุณ'],
    ['OrderDelivered', 'ส่งถึงแล้ว', 'ขอให้อร่อยกับมื้อนี้'],
    ['OrderNoRiderFound', 'ยังหาไรเดอร์ไม่ได้', 'ทีมงานกำลังช่วยดูแลออเดอร์ของคุณ'],
    ['OrderDeliveryFailed', 'ส่งอาหารไม่สำเร็จ', 'ทีมงานจะติดต่อกลับ'],
  ])('%s -> %s / %s', (eventType, title, body) => {
    expect(customerCopyFor(eventType, 'CUSTOMER')).toEqual({ title, body });
  });

  it('answers only for customers', () => {
    for (const recipient of ['MERCHANT', 'RIDER', 'OPERATOR']) {
      expect(customerCopyFor('OrderDelivered', recipient)).toBeNull();
    }
  });

  it('is silent for a customer on OrderCreated, and for a merchant on OrderCreated and OrderReady (DEC-072)', () => {
    expect(isSilentFor('OrderCreated', 'CUSTOMER')).toBe(true);
    expect(isSilentFor('OrderCreated', 'MERCHANT')).toBe(true);
    expect(isSilentFor('OrderReady', 'MERCHANT')).toBe(true);
    expect(isSilentFor('MerchantAcceptedOrder', 'MERCHANT')).toBe(true);
    expect(isSilentFor('MerchantAcceptedOrder', 'CUSTOMER')).toBe(false);
    expect(isSilentFor('OrderReady', 'RIDER')).toBe(false);
    for (const eventType of CUSTOMER_COPY_EVENT_TYPES) {
      expect(isSilentFor(eventType, 'CUSTOMER')).toBe(false);
    }
  });

  it('answers null for an event outside the nine', () => {
    expect(customerCopyFor('OrderCreated', 'CUSTOMER')).toBeNull();
    expect(customerCopyFor('SomethingElse', 'CUSTOMER')).toBeNull();
  });
});

describe('customerCopyFor — DEC-069 §1 cancel and refund wording', () => {
  it.each([
    ['OrderCancelled', 'ออเดอร์ถูกยกเลิกแล้ว', 'ถ้าชำระเงินแล้ว เราจะคืนเงินเต็มจำนวน'],
    ['RefundInitiated', 'เริ่มคืนเงินแล้ว', 'ตรวจอีเมลเพื่อกรอกบัญชีรับเงินคืน'],
    ['RefundSucceeded', 'คืนเงินสำเร็จ', 'เงินคืนเข้าบัญชีของคุณแล้ว'],
  ])('%s → the approved text', (event, title, body) => {
    expect(customerCopyFor(event, 'CUSTOMER')).toEqual({ title, body });
  });

  it('gives the merchant no customer wording for OrderCancelled', () => {
    expect(customerCopyFor('OrderCancelled', 'MERCHANT')).toBeNull();
  });
});
