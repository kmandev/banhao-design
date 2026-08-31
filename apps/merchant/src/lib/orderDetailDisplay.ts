/**
 * Presentation-only derivations for the Order Detail Panel (M-04) — design
 * `docs/design/BANHAO M-04 Merchant Order Detail Panel.dc.html`.
 *
 * Same discipline as `orderBoardDisplay.ts`: pure functions, no repository
 * calls, no mutation, every literal Thai string transcribed from the design
 * or from an already-approved source (`UX-SPEC-V1.md` §10), never authored
 * here without a citation. Money is formatted, never computed — every
 * `*_satang` figure is a stored column and `formatBahtFixed` (reused from
 * `orderBoardDisplay.ts`, not reimplemented) is the only arithmetic-free
 * satang→บาท conversion this file performs.
 *
 * ## History wording is deliberately not the chip vocabulary
 *
 * The state **chip** in the panel header reuses `presentOrderCard`'s
 * `chipLabel`/`chipTone` unchanged — "the panel never contradicts the
 * board" (design §01/§02). The **history timeline** is a different surface
 * with a different grammar: a completed-event audit log ("ชำระเงินแล้ว" —
 * payment completed) rather than a live pending-action prompt
 * ("ออเดอร์ใหม่ · รอตอบรับ" — new, awaiting response), matching the design's
 * own `history` fixture (§02), where `PAID` reads "ชำระเงินแล้ว" in the
 * trail but "ออเดอร์ใหม่ · รอตอบรับ" on the card/chip. `orderHistoryStateLabel`
 * is therefore a second, narrower map — not a duplicate of the chip map, and
 * not sourced from it.
 *
 * Only the states the design's own fixture or UX-SPEC §10's merchant column
 * actually name get Thai wording. The four exception states UX-SPEC §10
 * never reaches (`PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`,
 * `DELIVERY_FAILED` — still PROPOSED, C-06) return `null`, and the caller
 * falls back to the raw code in mono. Inventing Thai for a PROPOSED state
 * name is exactly what C-06 forbids.
 */

import type { Satang } from '@banhao/types';
import type { OrderStatusActorType } from '../domain/orderDetail';
import type { OrderState } from '../domain/order';

// ---------------------------------------------------------------------------
// History — state wording. §02 fixture (CREATED, PENDING_PAYMENT, PAID) +
// UX-SPEC §10 merchant column (everything after PAID, plus CANCELLED).
// ---------------------------------------------------------------------------

const HISTORY_STATE_LABEL: Partial<Record<OrderState, string>> = {
  CREATED: 'สร้างออเดอร์',
  PENDING_PAYMENT: 'รอชำระเงิน',
  PAID: 'ชำระเงินแล้ว',
  MERCHANT_ACCEPTED: 'รับแล้ว · เริ่มทำอาหาร',
  PREPARING: 'กำลังทำอาหาร',
  READY_FOR_PICKUP: 'รอไรเดอร์มารับ',
  PICKED_UP: 'ส่งมอบให้ไรเดอร์แล้ว',
  DELIVERING: 'กำลังจัดส่ง',
  DELIVERED: 'สำเร็จ',
  CANCELLED: 'ออเดอร์ถูกยกเลิก',
};

/** `null` for a state with no approved wording — the caller renders the raw code instead (C-06). */
export function orderHistoryStateLabel(state: OrderState): string | null {
  return HISTORY_STATE_LABEL[state] ?? null;
}

// ---------------------------------------------------------------------------
// History — actor wording. `WEBHOOK` gets its own, more specific label
// because CON-002 restricts that actor type to a signature-verified payment
// provider webhook — "ระบบชำระเงิน" (payment system) is the design's own
// §02 fixture wording for exactly that transition, not a guess.
// ---------------------------------------------------------------------------

const HISTORY_ACTOR_LABEL: Record<OrderStatusActorType, string> = {
  CUSTOMER: 'ลูกค้า',
  MERCHANT: 'ร้านค้า',
  RIDER: 'ไรเดอร์',
  OPERATOR: 'ผู้ดูแลระบบ',
  SYSTEM: 'ระบบ',
  WEBHOOK: 'ระบบชำระเงิน',
};

export function orderHistoryActorLabel(actorType: OrderStatusActorType): string {
  return HISTORY_ACTOR_LABEL[actorType];
}

// ---------------------------------------------------------------------------
// Recipient phone — E.164 -> 0XX-XXX-XXXX. Dashes, not the customer app's
// space-separated form: design §02 literal example is "089-234-5678". A
// merchant-local formatter because apps depend only on @banhao/* packages,
// never on each other's src (C-07) — this mirrors
// apps/customer/src/lib/phone.ts's normalisation logic, not its output
// format.
// ---------------------------------------------------------------------------

/** Returns the input unchanged when it is not a recognisable Thai mobile number. */
export function formatMerchantPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('66') ? `0${digits.slice(2)}` : digits;
  if (!/^0\d{9}$/.test(national)) return phone;
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
}

/** `tel:` needs the raw digits, not the display form — E.164 with a leading `+` is already dialable as-is. */
export function telHref(phone: string): string {
  return `tel:${phone}`;
}

// ---------------------------------------------------------------------------
// Items and options
// ---------------------------------------------------------------------------

/** `"2×"` — design §02 anatomy. */
export function formatQuantity(quantity: number): string {
  return `${quantity}×`;
}

/** `"ความเผ็ด · เผ็ดมาก"` — `group · option`, design §02. */
export function formatOptionLabel(groupNameSnapshot: string, optionNameSnapshot: string): string {
  return `${groupNameSnapshot} · ${optionNameSnapshot}`;
}

/**
 * `"+฿20.00"` / `"+฿0.00"` / `"−฿10.00"` — always signed, per the design's
 * own §02 fixture (`+฿0.00` for a zero delta, never rendered bare) and the
 * §08 contract note "Default 0, may be negative. Rendered signed." Uses the
 * same U+2212 minus glyph the board's totals already use for the discount
 * row, not an ASCII hyphen.
 */
export function formatPriceDelta(priceDeltaSatang: Satang): string {
  const magnitude = Math.abs(priceDeltaSatang) / 100;
  const sign = priceDeltaSatang < 0 ? '−' : '+';
  return `${sign}฿${magnitude.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Payment method line — design §02: "ชำระออนไลน์แล้ว · payment_method =
// ONLINE" for the only phase-1 case (DEC-016). CASH has no design fixture;
// the technical fact alone is shown rather than inventing confirmation copy
// for a payment method that cannot occur in phase 1.
// ---------------------------------------------------------------------------

export function paymentMethodDetailLine(paymentMethod: 'ONLINE' | 'CASH'): string {
  return paymentMethod === 'ONLINE'
    ? `ชำระออนไลน์แล้ว · payment_method = ONLINE`
    : `payment_method = ${paymentMethod}`;
}
