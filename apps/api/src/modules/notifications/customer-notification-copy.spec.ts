import { CUSTOMER_COPY_EVENT_TYPES, customerCopyFor, isSilentFor } from './customer-notification-copy';

/**
 * DEC-068 D1 approved exactly nine events and their Thai wording. These tests
 * pin the set and the text so neither can drift without a visible change here.
 */
describe('customerCopyFor (DEC-068 D1)', () => {
  it('covers exactly the nine approved events', () => {
    expect([...CUSTOMER_COPY_EVENT_TYPES].sort()).toEqual(
      [
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

  it('is silent for a customer on OrderCreated only, and never for anyone else', () => {
    expect(isSilentFor('OrderCreated', 'CUSTOMER')).toBe(true);
    expect(isSilentFor('OrderCreated', 'MERCHANT')).toBe(false);
    for (const eventType of CUSTOMER_COPY_EVENT_TYPES) {
      expect(isSilentFor(eventType, 'CUSTOMER')).toBe(false);
    }
  });

  it('answers null for an event outside the nine', () => {
    expect(customerCopyFor('OrderCreated', 'CUSTOMER')).toBeNull();
    expect(customerCopyFor('SomethingElse', 'CUSTOMER')).toBeNull();
  });
});
