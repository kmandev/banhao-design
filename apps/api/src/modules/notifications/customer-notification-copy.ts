/**
 * DEC-068 D1 — the Thai title/body shown to a CUSTOMER for each of the nine
 * order events the system emits, plus DEC-069 §1's three cancel/refund events. The wording is the Product Owner's, copied
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
  // DEC-069 §1 — three more, approved 2026-11-08.
  OrderCancelled: { title: 'ออเดอร์ถูกยกเลิกแล้ว', body: 'ถ้าชำระเงินแล้ว เราจะคืนเงินเต็มจำนวน' },
  RefundInitiated: { title: 'เริ่มคืนเงินแล้ว', body: 'ตรวจอีเมลเพื่อกรอกบัญชีรับเงินคืน' },
  RefundSucceeded: { title: 'คืนเงินสำเร็จ', body: 'เงินคืนเข้าบัญชีของคุณแล้ว' },
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

/**
 * DEC-072 — merchant and rider wording, approved by the owner on 2026-11-08
 * from `docs/NOTIFICATION_COPY_DRAFT.md`. Changing a string here is changing
 * an approved decision.
 */
const MERCHANT_COPY: Readonly<Record<string, NotificationCopy>> = {
  PaymentSucceeded: { title: 'ออเดอร์ใหม่เข้ามา', body: 'กดรับออเดอร์ภายใน 5 นาที' },
  RiderAssigned: { title: 'ไรเดอร์รับงานแล้ว', body: 'ไรเดอร์กำลังไปที่ร้าน' },
  OrderPickedUp: { title: 'ไรเดอร์รับอาหารแล้ว', body: 'ออเดอร์กำลังไปส่งลูกค้า' },
  OrderDelivered: { title: 'ส่งถึงลูกค้าแล้ว', body: 'ออเดอร์นี้เสร็จเรียบร้อย' },
  OrderNoRiderFound: { title: 'ยังหาไรเดอร์ไม่ได้', body: 'ทีมงานกำลังช่วยหาไรเดอร์ให้' },
  OrderCancelled: { title: 'ออเดอร์ถูกยกเลิก', body: 'ไม่ต้องเตรียมอาหารสำหรับออเดอร์นี้' },
  OrderDeliveryFailed: { title: 'ส่งอาหารไม่สำเร็จ', body: 'ทีมงานจะติดต่อกลับ' },
};

const RIDER_COPY: Readonly<Record<string, NotificationCopy>> = {
  RiderOfferAvailable: { title: 'มีงานใหม่ใกล้คุณ', body: 'เปิดแอปเพื่อรับงาน' },
  RiderAssigned: { title: 'ได้งานแล้ว', body: 'ไปรับอาหารที่ร้านได้เลย' },
  OrderReady: { title: 'อาหารพร้อมแล้ว', body: 'ไปรับที่ร้านได้เลย' },
  OrderCancelled: { title: 'งานนี้ถูกยกเลิก', body: 'ไม่ต้องไปรับอาหารแล้ว' },
};

/**
 * DEC-072: a merchant is not told about an order before it is paid (it can do
 * nothing with it), nor about "food ready", which the merchant pressed itself.
 */
const SILENT_FOR_MERCHANT: ReadonlySet<string> = new Set(['OrderCreated', 'OrderReady']);

/** Whether this recipient is deliberately sent nothing for this event. */
export function isSilentFor(eventType: string, recipientType: string): boolean {
  if (recipientType === 'CUSTOMER') return SILENT_FOR_CUSTOMER.has(eventType);
  if (recipientType === 'MERCHANT') return SILENT_FOR_MERCHANT.has(eventType);
  return false;
}

/**
 * The approved text for this event and recipient — customer (DEC-068 D1 +
 * DEC-069), merchant or rider (DEC-072) — or `null`, in which case the caller
 * keeps its old behaviour (the raw event name), never an invented sentence.
 */
export function notificationCopyFor(eventType: string, recipientType: string): NotificationCopy | null {
  if (recipientType === 'CUSTOMER') return CUSTOMER_COPY[eventType] ?? null;
  if (recipientType === 'MERCHANT') return MERCHANT_COPY[eventType] ?? null;
  if (recipientType === 'RIDER') return RIDER_COPY[eventType] ?? null;
  return null;
}

/** The approved customer text for an event, or `null` when the recipient is not a customer or the event is not one of the nine. */
export function customerCopyFor(eventType: string, recipientType: string): NotificationCopy | null {
  if (recipientType !== 'CUSTOMER') return null;
  return CUSTOMER_COPY[eventType] ?? null;
}

/** The approved event names (DEC-068 D1's nine plus DEC-069's three), for tests. */
export const CUSTOMER_COPY_EVENT_TYPES: readonly string[] = Object.keys(CUSTOMER_COPY);
/** DEC-072's approved merchant and rider event names, for tests. */
export const MERCHANT_COPY_EVENT_TYPES: readonly string[] = Object.keys(MERCHANT_COPY);
export const RIDER_COPY_EVENT_TYPES: readonly string[] = Object.keys(RIDER_COPY);
