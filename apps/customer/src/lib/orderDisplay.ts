/**
 * Presentation helpers for order data (Phase E-3B.3).
 *
 * Same discipline as `catalogDisplay.ts`: these turn domain values into
 * display strings and live outside the domain, because `DELIVERING` is a fact
 * and `กำลังไปส่ง` is a wording choice.
 *
 * **Every Thai string in this file is transcribed, not authored.** Sources are
 * named per constant below. Nothing here invents copy, and where no approved
 * copy exists the helper returns `null` rather than inventing one or leaking an
 * English identifier — `docs/design/BANHAO-UX-SPEC-V1.md` §10 is explicit:
 * *"No state name, cause code, or error code is ever rendered to a user."*
 */

import type { BadgeTone } from '@banhao/ui';
import type { OrderPaymentMethod, OrderState } from '../domain/order';

/**
 * Customer-facing state copy, transcribed verbatim from the "Customer sees"
 * column of `docs/design/BANHAO-UX-SPEC-V1.md` §10 ("One state value, four
 * vocabularies" — REQ-002 / DEC-UX-001).
 *
 * Only the nine DEC-019 core states plus `CANCELLED` appear, because §10 says
 * exactly that: *"States are the nine ACCEPTED values (DEC-019) plus
 * `CANCELLED`; nothing else is implemented in V1 (DEC-APP-006)."* The four
 * exception states the database CHECK constraint still permits
 * (`PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`,
 * `DELIVERY_FAILED`) are deliberately absent — they remain PROPOSED in
 * `docs/ORDER_LIFECYCLE.md` §3 and have no approved customer wording anywhere
 * in the design.
 *
 * `CREATED` is listed by §10 as *"(transient — no screen)"* with no copy, so
 * it is absent here too.
 */
const ORDER_STATE_LABEL: Partial<Record<OrderState, string>> = {
  PENDING_PAYMENT: 'รอชำระเงิน',
  PAID: 'ส่งให้ร้านแล้ว · รอร้านรับออเดอร์',
  MERCHANT_ACCEPTED: 'ร้านรับออเดอร์แล้ว',
  PREPARING: 'ร้านกำลังทำอาหาร',
  READY_FOR_PICKUP: 'อาหารพร้อมแล้ว',
  PICKED_UP: 'ไรเดอร์รับอาหารแล้ว',
  DELIVERING: 'กำลังไปส่ง',
  DELIVERED: 'จัดส่งสำเร็จ',
  CANCELLED: 'ออเดอร์ถูกยกเลิก',
};

/**
 * The approved customer wording for a state, or `null` when the design has
 * none.
 *
 * `null` is a real answer, not a failure: a caller must then render no status
 * rather than an English identifier (§10's "no state name is ever rendered")
 * or an invented phrase. In V1 this cannot arise from live data — `CREATED` is
 * the only state anything writes today, and the four exception states are
 * unimplemented (DEC-APP-006).
 */
export function orderStateLabel(state: OrderState): string | null {
  return ORDER_STATE_LABEL[state] ?? null;
}

/**
 * Badge tone per state.
 *
 * `Badge` offers four tones; the design foundation
 * (`docs/design/BANHAO Design Foundation.dc.html`, `STATUS` table) assigns each
 * state an explicit background/foreground pair. This maps those colours onto
 * the four available tones — presentation only, and lossy by necessity:
 *
 *   `#EAF6EF/#0F8B5F` green  → success   (PAID, DELIVERED)
 *   `#FDF3E6/#B98418` amber  → warning   (PENDING_PAYMENT)
 *   `#FBF1DC/#9A7810` amber  → warning   (READY_FOR_PICKUP)
 *   `#FDEEE7/#C2431F` brand  → primary   (MERCHANT_ACCEPTED, PREPARING)
 *   `#1F1A16/#FFFFFF` dark   → primary   (DELIVERING)
 *   `#EFEAE4/#5A4E42` muted  → neutral   (PICKED_UP)
 *   `#FBEAEA/#D93A3A` red    → neutral   (CANCELLED — `Badge` has no danger
 *                                         tone, and the screen this replaces
 *                                         already rendered CANCELLED neutral)
 */
const ORDER_STATE_TONE: Partial<Record<OrderState, BadgeTone>> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'success',
  MERCHANT_ACCEPTED: 'primary',
  PREPARING: 'primary',
  READY_FOR_PICKUP: 'warning',
  PICKED_UP: 'neutral',
  DELIVERING: 'primary',
  DELIVERED: 'success',
  CANCELLED: 'neutral',
};

export function orderStateTone(state: OrderState): BadgeTone {
  return ORDER_STATE_TONE[state] ?? 'neutral';
}

/**
 * Payment method copy.
 *
 * Unchanged wording from the screen this replaces; only the discriminant moved
 * from the mock's `'PROMPTPAY'` to the schema's own `payment_method` vocabulary
 * (`'ONLINE' | 'CASH'`, `orders` CHECK constraint). DEC-016 disables cash in
 * Phase 1 but keeps the column extensible, so `CASH` stays representable here
 * for exactly the same reason it stays in the schema.
 */
export function paymentMethodLabel(method: OrderPaymentMethod): string {
  return method === 'CASH' ? 'เงินสด' : 'พร้อมเพย์';
}

/**
 * The value of screen 19's `ชำระโดย` row — `พร้อมเพย์ QR`, not `พร้อมเพย์`.
 *
 * The design canvas genuinely uses two different strings for the same fact:
 * the C-16 history card badges the method as `พร้อมเพย์`, while C-19's
 * `ชำระโดย` row spells out `พร้อมเพย์ QR`
 * (`docs/design/BANHAO Customer App.dc.html`). Both are transcribed rather
 * than normalised to one — picking a "consistent" wording would be overriding
 * the design, not following it.
 *
 * `CASH` keeps `เงินสด` with no suffix: `QR` is PromptPay's mechanism, and the
 * design shows no cash variant of this row to copy.
 */
export function paymentMethodDetailLabel(method: OrderPaymentMethod): string {
  return method === 'CASH' ? 'เงินสด' : 'พร้อมเพย์ QR';
}

/**
 * `ก๋วยเตี๋ยวเรือน้ำตก ×2, เกี๊ยวทอด ×1` — the history card's item line.
 *
 * Format transcribed from the `history` fixture in the design canvas
 * (`docs/design/BANHAO Customer App.dc.html`): name, `×`, quantity, joined by
 * `, `. Both separators come from the design; neither is chosen here.
 */
export function summariseItems(items: { nameSnapshot: string; quantity: number }[]): string {
  return items.map((item) => `${item.nameSnapshot} ×${item.quantity}`).join(', ');
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/**
 * Thai month abbreviations. Calendar vocabulary, not product copy — and `ส.ค.`
 * is the exact form the design canvas's own history fixture uses
 * (`'6 ส.ค. 19:02 น.'`).
 */
const THAI_MONTH_ABBREVIATIONS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

/**
 * `6 ส.ค. 19:02 น.` — the history card's date line.
 *
 * Read in **Asia/Bangkok**, for the same reason `openingHours.ts` derives
 * opening times there: the order was placed in Buntharik, and rendering it in
 * the device's zone would date a traveller's own order wrongly. Built on
 * `Intl.DateTimeFormat(...).formatToParts`, the pattern that module already
 * proves works in this runtime.
 *
 * The design canvas shows two forms for this line — this absolute one, and a
 * relative `เมื่อวาน 12:14 น.`. Only the absolute form is implemented:
 * choosing when a date becomes "yesterday" is behaviour the design states
 * nowhere, and implementing one of two documented forms omits copy rather than
 * inventing it. No year is rendered because the history card shows none
 * (screen 19's detail header does, in Buddhist era — a separate screen, and
 * not this one's problem).
 *
 * Returns `null` for an unparseable timestamp, so a caller omits the line
 * rather than printing `Invalid Date`.
 */
interface BangkokDateParts {
  day: number;
  monthLabel: string;
  /** Buddhist-era year, as the design renders it. */
  buddhistYear: number;
  hour: string;
  minute: string;
}

/** The Bangkok wall-clock pieces both formats below are assembled from. */
function bangkokDateParts(isoTimestamp: string): BangkokDateParts | null {
  const placedAt = new Date(isoTimestamp);
  if (Number.isNaN(placedAt.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(placedAt);

  const lookup = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const day = Number.parseInt(lookup('day'), 10);
  const month = Number.parseInt(lookup('month'), 10);
  const year = Number.parseInt(lookup('year'), 10);
  const monthLabel = THAI_MONTH_ABBREVIATIONS[month - 1];

  if (!monthLabel || Number.isNaN(day) || Number.isNaN(year)) return null;

  return {
    day,
    monthLabel,
    // The design canvas dates a 2026 order `2569` — the Thai civil calendar's
    // Buddhist era, which is the Gregorian year plus 543.
    buddhistYear: year + 543,
    // `hour12: false` renders midnight as "24" in some ICU versions — the same
    // quirk `toBangkokMoment` documents and normalises.
    hour: String(Number.parseInt(lookup('hour'), 10) % 24).padStart(2, '0'),
    minute: lookup('minute'),
  };
}

export function formatOrderPlacedAt(isoTimestamp: string): string | null {
  const parts = bangkokDateParts(isoTimestamp);
  if (!parts) return null;

  return `${parts.day} ${parts.monthLabel} ${parts.hour}:${parts.minute} น.`;
}

/**
 * `5 ส.ค. 2569 · 12:14 น.` — screen 19's date line.
 *
 * The longer sibling of `formatOrderPlacedAt`: C-19 shows the Buddhist-era
 * year and separates date from time with `·`, where the C-16 card shows
 * neither. Both forms are transcribed from the design canvas rather than
 * unified — a history card and a detail header legitimately carry different
 * amounts of date.
 */
export function formatOrderPlacedAtLong(isoTimestamp: string): string | null {
  const parts = bangkokDateParts(isoTimestamp);
  if (!parts) return null;

  return `${parts.day} ${parts.monthLabel} ${parts.buddhistYear} · ${parts.hour}:${parts.minute} น.`;
}
