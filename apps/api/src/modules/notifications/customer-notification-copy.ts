/**
 * DEC-068 D1 — the Thai title/body shown to a CUSTOMER for each of the nine
 * order events the system emits. The wording is the Product Owner's, copied
 * verbatim from `docs/PHASE-1-OWNER-QUESTIONS.md` §D1; changing a string here
 * is changing an approved decision.
 *
 * The decision authorizes these nine events and these texts for the customer
 * only. It says nothing about merchant or rider wording, and no event or text
 * beyond these nine may be added without a new decision. So:
 *
 * - `customerCopyFor` answers only for `CUSTOMER` recipients;
 * - any other recipient, and any event not listed, gets `null`, and the
 *   caller keeps its existing behaviour for them.
 */

export interface NotificationCopy {
  title: string;
  body: string;
}

const CUSTOMER_COPY: Readonly<Record<string, NotificationCopy>> = {
  PaymentSucceeded: { title: 'ชำระเงินสำเร็จ', body: 'ร้านกำลังตรวจออเดอร์ของคุณ' },
  MerchantAcceptedOrder: { title: 'ร้านรับออเดอร์แล้ว', body: 'กำลังเตรียมอาหาร' },
  RiderSearchStarted: { title: 'กำลังหาไรเดอร์', body: 'เราจะแจ้งเมื่อมีไรเดอร์รับงาน' },
  RiderAssigned: { title: 'ไรเดอร์รับงานแล้ว', body: 'ไรเดอร์กำลังไปที่ร้าน' },
  OrderReady: { title: 'อาหารพร้อมแล้ว', body: 'รอไรเดอร์มารับ' },
  OrderPickedUp: { title: 'ไรเดอร์รับอาหารแล้ว', body: 'กำลังนำส่งถึงคุณ' },
  OrderDelivered: { title: 'ส่งถึงแล้ว', body: 'ขอให้อร่อยกับมื้อนี้' },
  OrderNoRiderFound: { title: 'ยังหาไรเดอร์ไม่ได้', body: 'ทีมงานกำลังช่วยดูแลออเดอร์ของคุณ' },
  OrderDeliveryFailed: { title: 'ส่งอาหารไม่สำเร็จ', body: 'ทีมงานจะติดต่อกลับ' },
};

/**
 * Events a customer must not be notified about.
 *
 * `OrderCreated` fires the moment the customer places the order. It is not one
 * of the nine approved events, so it has no approved wording, and showing the
 * raw event name to someone who just tapped the button themselves is noise at
 * best. The restaurant still gets it. Silence is the only option that invents
 * nothing: DEC-068 D1 forbids new customer events and wording beyond the nine.
 */
const SILENT_FOR_CUSTOMER: ReadonlySet<string> = new Set(['OrderCreated']);

/** Whether this recipient is deliberately sent nothing for this event. */
export function isSilentFor(eventType: string, recipientType: string): boolean {
  return recipientType === 'CUSTOMER' && SILENT_FOR_CUSTOMER.has(eventType);
}

/** The approved customer text for an event, or `null` when the recipient is not a customer or the event is not one of the nine. */
export function customerCopyFor(eventType: string, recipientType: string): NotificationCopy | null {
  if (recipientType !== 'CUSTOMER') return null;
  return CUSTOMER_COPY[eventType] ?? null;
}

/** The nine approved event names, for tests. */
export const CUSTOMER_COPY_EVENT_TYPES: readonly string[] = Object.keys(CUSTOMER_COPY);
