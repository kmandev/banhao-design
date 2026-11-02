# Phase 1 — owner questions, set 2

```
DECISION PREPARATION — NOTHING HERE IS LOCKED
```

Prepared 2026-11-02 while the owner was away, after DEC-066/067 and the
marketplace research. Each question lists a recommended answer first.
Questions already answered in DEC-067 are not repeated.

## A. Defect found today — needs a choice

### A1. `payment_events.payment_id` can never be filled in

**Evidence.** On staging, every real Stripe payment event logs
`payment_events.payment_id backfill failed … payment_events are append-only
except processed_at/processing_error` (09:46 and 10:05 UTC, orders
`BH-20261102-0002` and `-0003`). `payment-event-processing.service.ts` and
`refund-event-processing.service.ts` both try to set `payment_id` after
matching an event, but the `payment_events_enforce_immutable_columns`
trigger (migration `20260811000006`) forbids changing that column. Unit
tests mock the update as successful, so they never saw it.

**Impact.**

- Payment confirmation is unaffected: orders still reach `PAID`, ledger
  correct.
- **Refund reconciliation anomalies A and C are blind in real operation.**
  `refund-reconciliation-detector.service.ts` finds refund status events by
  `payment_events.payment_id`, which is always null. A refund that Stripe
  completed but BANHAO did not mark `REFUNDED` would never be flagged.
- One `ERROR` log line per payment and refund event.

**Options.**

1. **Recommended: an additive migration making `payment_id` write-once**
   (null → value allowed once, never changed after). Keeps the evidence
   immutable, matches what the code and the column comment intend, and fixes
   the detector with no code change. Needs an explicit migration instruction,
   plus a test against real Postgres.
2. Code only: have the detector match refund events by `providerPaymentId`
   inside `raw_payload`, and drop the backfill. No migration, but it changes
   reconciliation logic.
3. Leave it until refunds are used live. Not recommended: the blind spot is
   in the reconciliation safety net.

## B. Money flow — after Stripe answers

### B1. Send the questions in `Q-002-MARKETPLACE-PAYMENT-PROVIDER-RESEARCH.md` §8?

- **Recommended:** yes, to Stripe Thailand sales, plus Opn and 2C2P as a
  fallback. Only the owner can send them.

### B2. If Stripe Connect is confirmed, who pays the Stripe processing fee?

- **Recommended: the restaurant**, Stripe's default for Stripe-handled
  pricing. It is the norm for card and QR acceptance, and keeps BANHAO's ฿21
  per order intact.
- Alternative: BANHAO, which needs platform-handled pricing (฿60 per active
  account plus payout fees) or a higher application fee.

### B3. How are riders paid if restaurants are paid by Stripe?

- **Recommended: weekly bank transfer from BANHAO's own account**, using
  DEC-067 S2–S4 (Monday, Sunday 23:59 cutoff, ฿100 minimum). Stripe Thailand
  does not support transfers from the platform to other accounts.

## C. Order flow

### C1. Merchant does not accept an order (BQ-013)

- **Recommended:** if not accepted within **5 minutes**, alert the operator
  (an AI Ops escalation already exists). **No auto-cancel** in the pilot; the
  operator calls the restaurant and decides.
- Alternatives: auto-cancel with full refund after N minutes; or alert only
  the restaurant again.

### C2. Customer not reachable or no rider (UX-Q-006 / OD-04)

- **Recommended:** no safe drop-off in the pilot. Keep DEC-053's
  operator-declared failure after 2 contact attempts and 5 minutes.
- Alternative: allow leaving the food at the door with a photo.

### C3. Who may switch a restaurant to Normal, Busy or Paused (R-6 / BQ-038)

- **Recommended:** any member of the restaurant and BANHAO staff (ADMIN or
  OPERATOR), with every change audited. Matches today's behaviour plus staff.

## D. Customer-facing text

### D1. Thai notification titles (today the raw event name is shown)

**Recommended texts** (title / body), one per event the system emits today:

| Event | Title | Body |
|---|---|---|
| `PaymentSucceeded` | ชำระเงินสำเร็จ | ร้านกำลังตรวจออเดอร์ของคุณ |
| `MerchantAcceptedOrder` | ร้านรับออเดอร์แล้ว | กำลังเตรียมอาหาร |
| `RiderSearchStarted` | กำลังหาไรเดอร์ | เราจะแจ้งเมื่อมีไรเดอร์รับงาน |
| `RiderAssigned` | ไรเดอร์รับงานแล้ว | ไรเดอร์กำลังไปที่ร้าน |
| `OrderReady` | อาหารพร้อมแล้ว | รอไรเดอร์มารับ |
| `OrderPickedUp` | ไรเดอร์รับอาหารแล้ว | กำลังนำส่งถึงคุณ |
| `OrderDelivered` | ส่งถึงแล้ว | ขอให้อร่อยกับมื้อนี้ |
| `OrderNoRiderFound` | ยังหาไรเดอร์ไม่ได้ | ทีมงานกำลังช่วยดูแลออเดอร์ของคุณ |
| `OrderDeliveryFailed` | ส่งอาหารไม่สำเร็จ | ทีมงานจะติดต่อกลับ |

Also recommended: every notification carries its `orderId` so the app can
open the order; delivery-sourced events currently carry none.

## E. Pilot scope

### E1. Confirm the reduced pilot scope

- **Recommended:** today's fixed fees (delivery ฿10, service ฿5, commission
  10%, rider ฿12); no promotions; no distance pricing or routing; latest
  rider position only.

### E2. Privacy Policy and Terms

- **Recommended:** let Claude draft both in Thai from what the system
  actually collects (phone, email, address, latest rider position, proof
  photos), for the owner to review. App Store and Google Play require them.
  Not legal advice.
