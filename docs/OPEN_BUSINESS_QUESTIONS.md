# Open Business Questions

Business decisions that must be made by the **Product Owner** before the
corresponding code can be written. Produced by EVENT-013 (Business Rules &
Domain Modelling, 2026-08-10).

**Updated 2026-08-10 (EVENT-014)** after the Product Owner locked seventeen
decisions, DEC-016…DEC-032. Entries answered by that lock are marked `ACCEPTED`
with their `DEC-NNN`; everything else is still undecided.

**An AI agent may never move a question out of `OPEN` on its own.** Where a
recommendation is given it is an argued suggestion from analysis, not an
instruction — see `ai/DEVELOPMENT_RULES.md` rule 4.

## How this file relates to the existing question log

`ai/KNOWLEDGE/QUESTIONS.md` holds the twenty pre-existing `Q-NNN` questions and
remains the canonical record for those. This file adds a new `BQ-NNN`
(**B**usiness **Q**uestion) series for questions raised by the domain-modelling
pass, and **cross-references the `Q-NNN` items rather than restating them** —
so no question has two homes. Where a `BQ` extends a `Q`, it says so.

## Priority definitions

| Priority | Meaning |
|---|---|
| **P0** | Blocks writing the Order, Payment, or Settlement code at all. An implementation cannot be started, only guessed at. |
| **P1** | Blocks a specific feature or a launch-readiness item, but the core order path can be built without it. |
| **P2** | Refinement. Can be decided after Phase 1 launch without rework. |

## Status values

| Status | Meaning |
|---|---|
| `OPEN` | Undecided. **An AI agent may never move a question out of this state.** |
| `ACCEPTED` | Answered by the Product Owner and recorded as a `DEC-NNN` |
| `ACCEPTED — MODEL · OPEN — …` | The relationship is decided; the number is not |
| `DEFERRED` | Out of scope for Phase 1 by decision. **Not answered** — it returns when the scope does |

---

## What the 2026-08-10 decision lock answered

`ACCEPTED` — seventeen decisions, DEC-016…DEC-032 (`docs/DECISIONS.md`).

| Question | Now | Decision |
|---|---|---|
| BQ-010 — one merchant per cart? | **ACCEPTED** — yes, one cart = one restaurant | DEC-017 |
| BQ-012 — the missing `PENDING_PAYMENT` state | **ACCEPTED** — it exists in the approved lifecycle | DEC-019 |
| BQ-014 — `NO_DRIVER` / "food not cooked" contradiction | **ACCEPTED** — search starts at `MERCHANT_ACCEPTED`; no-rider is not an order state | DEC-019, DEC-022 |
| BQ-019 — dispatch model | **ACCEPTED** — broadcast → first accept | DEC-020 |
| BQ-025 — no-rider fallback | **ACCEPTED (shape)** — retry → manual dispatch → operator decision; never auto-cancel. Timings still `OPEN` | DEC-022 |
| BQ-026 — delivery fee | **RESOLVED** — model funds rider compensation; Phase 1 fee is **flat ฿10 (1000 satang)** | DEC-023, DEC-035 |
| BQ-027 — service fee | **RESOLVED (amount)** — BANHAO revenue; Phase 1 fee is **fixed ฿5 (500 satang)**. **Refundability still `OPEN`** (Phase F) | DEC-024, DEC-036 |
| BQ-028 — merchant commission | **ACCEPTED (model)** — BANHAO revenue. **Rate `OPEN`** | DEC-025 |

Also decided, and not previously tracked as a `BQ`: online-payment-only with
COD disabled but extensible (DEC-016), four separate state domains (DEC-018),
rider cancellation never cancels the order (DEC-021), settlement as its own
domain (DEC-026), refund lives in the payment domain (DEC-027), payment
idempotency (DEC-028), late-payment resolvability (DEC-029), duplicate-payment
protection (DEC-030), manual operations as an intentional capability (DEC-031),
and operator fallback (DEC-032).

### Deferred by DEC-016, **not** answered

**BQ-023** (rider cash float at pickup) · **BQ-033** (cash-order fee netting,
negative merchant balance) · **Q-004** (cash remittance limit) · the cash half
of **BQ-034**. Cash on Delivery is disabled in Phase 1, so none of these blocks
launch — and every one of them returns unchanged the day COD is switched back
on. **Decide them before then, not during.**

---

## Summary — what still blocks implementation

### P0 — nothing can be built correctly without these

| ID | Decision needed | Blocks |
|---|---|---|
| Q-001 | **Payment provider** — more urgent since DEC-016 made online the only method | Payment module, webhooks |
| Q-002 | Legal / settlement model, merchant of record · `LEGAL_REVIEW_REQUIRED` | Payment, settlement, onboarding terms |
| Q-010 / BQ-028 | Commission **rate** (model accepted, DEC-025) | Ledger, settlement |
| Q-020 | **PromptPay refund mechanism** — DEC-016 removed the cash-refund fallback | Refund flow, customer refund UX |
| BQ-015 | Who bears the cost of cooked-but-undelivered food | Ledger, merchant terms. Sharpened by DEC-022: an operator cancelling a no-rider order needs this answer |
| BQ-027 | Service fee **refundability** only — the amount is decided (DEC-036). Phase F scope; does **not** block order creation | Refund flow, ledger |
| BQ-030 | Who funds promotions and discounts | Ledger, settlement |

**Seven remain, down from fifteen.** The eight cleared are BQ-010, BQ-012,
BQ-014, BQ-019, BQ-023 (deferred), BQ-025, the model halves of BQ-026/027/028,
and — as of 2026-08-24 — the **numeric** halves of BQ-026 (DEC-035) and BQ-027
(DEC-036). Only BQ-027's refundability question is still carried above, and it
is Phase F scope rather than an order-creation blocker.

### P1 — blocks a feature or launch readiness

Q-003, Q-009, Q-011, Q-012, Q-015, Q-016, Q-018, Q-019 ·
BQ-001, BQ-002, BQ-003, BQ-005, BQ-006, BQ-007, BQ-008, BQ-011, BQ-013,
BQ-016, BQ-017, BQ-018, BQ-020, BQ-021, BQ-022, BQ-024, BQ-029, BQ-031,
BQ-032, BQ-034, BQ-035

### P2 — refinement

Q-005, Q-008, Q-013, Q-014, Q-017 · BQ-004, BQ-009, BQ-036, BQ-037, BQ-038,
BQ-039

### Deferred with COD

Q-004 · BQ-023 · BQ-033 · the cash half of BQ-034

---

## Customer, address and service area

### BQ-001 — Address model for a district with unverified geocoding

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Address module, delivery-fee calculation, Driver App navigation
related: Q-018, DQ-04
```

**Question:** What exactly is a delivery address made of — free text, a map pin,
a landmark, or all three — and which parts are mandatory?

**Why it matters:** Q-018 records that no provider publishes district-level
geocoding accuracy for Thailand, and that the design's own sample address
("88 หมู่ 4 บ้านบุณฑริก ต.บุณฑริก อ.บุณฑริก") is exactly the rural Thai format
most likely to geocode poorly. Distance-based delivery fees (BQ-026) and rider
navigation both depend on a usable coordinate. If text addresses cannot be
geocoded reliably, the address model has to carry a pin from day one — that is
a schema decision, not a UI tweak.

**Options:**
- **A. Pin-first.** Map pin is mandatory; text is a human-readable label.
- **B. Text-first with optional pin.** Matches the design's current screen.
- **C. Pin + landmark + text, all captured, pin authoritative for distance.**

**Recommendation:** **C**, with the pin authoritative for any distance
computation. In a district where street addressing is weak, a landmark
("ใกล้ตลาดสดบุณฑริก") is what a local rider actually navigates by, and the pin
is what the fee formula needs. Capturing all three costs one screen and cannot
be retrofitted onto addresses already saved.

**Impact if wrong:** Wrong delivery fees, riders unable to find customers, and
a migration over live customer data.

---

### BQ-002 — Multiple addresses, default address, editing

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Address module
related: DQ-04
```

**Question:** May a customer store multiple addresses, edit and delete them, and
is exactly one always the default?

**Why it matters:** `11 ที่อยู่จัดส่ง` shows a selectable list and a
`+ เพิ่มที่อยู่ใหม่` affordance, and the account sitemap lists `ที่อยู่ของฉัน` —
but no add/edit form is designed, which is exactly what DQ-04 records. The
Customer App currently implements **selection only**.

**Options:**
- **A. Multiple addresses, one default, full CRUD.**
- **B. Multiple addresses, no editing** — add and delete only.
- **C. Single address**, overwritten each time.

**Recommendation:** **A**, with delete as a soft delete: an address referenced
by a historical order must remain readable on that order. Orders must store an
address **snapshot**, not a foreign key alone — otherwise editing an address
silently rewrites delivery history.

**Impact if wrong:** Order history becomes unreliable evidence in a dispute.

---

### BQ-003 — Out-of-area and out-of-radius orders

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Checkout validation, ServiceArea configuration
related: BQ-008, BQ-026
```

**Question:** What happens when a customer's address falls outside the BANHAO
service area, or inside the service area but outside a specific merchant's
delivery radius?

**Why it matters:** The merchant sitemap has a per-shop `รัศมีส่ง`
(delivery radius) and the admin sitemap has `โซนให้บริการ + สูตรค่าส่ง`
(service zones + fee formula) — two separate limits with no documented
precedence. Nothing in the design shows the rejection state.

**Options:**
- **A. Hard block at address selection** — merchant not shown at all.
- **B. Show merchant, block at checkout** with an explanatory state.
- **C. Allow with a surcharge** beyond the radius.

**Recommendation:** **A for the platform service area** (out of area = the app
says BANHAO does not deliver there yet, and captures the address as demand
signal for expansion) and **B for the per-merchant radius** (the customer can
still browse the menu, and learns why they cannot order). Option C should wait
until real distance data exists.

**Impact if wrong:** Riders sent on unprofitable long trips, or customers
silently unable to order with no explanation.

---

### BQ-004 — Customer account deletion and data-subject requests

```yaml
priority: P2
owner: PRODUCT_OWNER + LEGAL_REVIEW_REQUIRED
status: OPEN
blocks: PDPA readiness
related: Q-012
```

**Question:** What happens to orders, ratings, and ledger entries when a
customer asks for their account and data to be deleted?

**Why it matters:** Financial records must be retained (CON-003 requires the
ledger to reconcile historically) while PDPA gives data subjects erasure rights.
These pull in opposite directions and the resolution is legal, not technical.

**Options:**
- **A. Anonymise the customer, retain the financial record.**
- **B. Full deletion including order history.**
- **C. Retain for a defined statutory period, then anonymise.**

**Recommendation:** **A or C**, decided with Thai counsel under Q-012. Note as a
constraint on any answer: **ledger entries must never be deleted** — CON-003 and
DEC-014 allow correction only by reversing entry.

**Impact if wrong:** Either a PDPA violation or an unreconcilable ledger.

---

## Merchant and catalogue

### BQ-005 — Merchant onboarding requirements and approval authority

```yaml
priority: P1
owner: PRODUCT_OWNER + LEGAL_REVIEW_REQUIRED
status: OPEN
blocks: Merchant app, admin approval queue
related: Q-002
```

**Question:** What must a restaurant provide to be approved, and who approves
it?

**Why it matters:** The admin approval queue (`A-12`) shows real document types
— `ทะเบียนพาณิชย์` (commercial registration) and `บัญชีธนาคาร` (bank account) —
so a document set is implied but never specified. The answer is partly legal:
Q-002 (merchant of record) and KYB requirements from the eventual PSP will
dictate the minimum, not product preference.

**Options:**
- **A. Minimum viable** — shop name, owner ID, phone, bank account, photos.
- **B. Full KYB** — commercial registration, tax ID, food licence, bank account
  verification.
- **C. Tiered** — minimum to list, full KYB before the first payout.

**Recommendation:** **C.** It lets merchant acquisition start immediately in a
district of 20–30 shops, while making sure no money moves before the PSP's KYB
requirements are satisfied. Which documents are actually mandatory is a
`LEGAL_REVIEW_REQUIRED` input, not an engineering choice.

**Impact if wrong:** Payouts blocked at launch, or onboarding friction that
kills merchant acquisition in a market this small.

---

### BQ-006 — Restaurant lifecycle states

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Merchant module schema
related: BQ-007
```

**Question:** Is the proposed lifecycle
`DRAFT → PENDING_APPROVAL → ACTIVE → PAUSED / SUSPENDED / CLOSED` correct?

**Why it matters:** The design documents only a binary
`ร้านเปิดอยู่` / `ร้านปิดอยู่` plus a `รออนุมัติ` (awaiting approval) screen and
an admin `ระงับ / ปลดระงับ` (suspend / unsuspend) action. Those three facts
imply approval, open/closed and suspension exist — but the exact state set is
**PROPOSED**, not documented. See `docs/BUSINESS_RULES.md` § Restaurant
lifecycle.

**Options:**
- **A. The six-state model as proposed.**
- **B. A smaller set** — `PENDING`, `ACTIVE`, `SUSPENDED` — with open/closed as
  a separate boolean derived from hours.
- **C. Something else the Product Owner has in mind.**

**Recommendation:** **B, plus `DRAFT`.** Keep *approval status* (lifecycle) and
*is it accepting orders right now* (derived from opening hours + a temporary
pause flag) as two separate concepts. Merging them is the usual source of "the
shop is suspended but shows as open" bugs.

**Impact if wrong:** Suspended merchants able to receive orders, or open
merchants invisible.

---

### BQ-007 — Opening hours, holidays, temporary close, and order cutoff

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Catalogue module, order validation
related: BQ-006, BQ-017
```

**Question:** How are opening hours modelled, and what is the cutoff rule near
closing time?

**Why it matters:** The design shows `เปิด 09:00–20:00 ทุกวัน` (a single
uniform daily window) and a closed state that promises
`ร้านจะเปิดอีกครั้งพรุ่งนี้ 10:00 น.` — a *next opening time*, which requires
per-day hours to compute. The merchant sitemap has `เวลาเปิด-ปิด` and
`เปิด/ปิดร้านชั่วคราว` (temporary close) as separate items. Nothing documents
what happens to an order placed at 19:58 for a shop closing at 20:00.

**Options:**
- **A. Per-day open/close intervals** (possibly several per day for shops that
  close in the afternoon) + a temporary-close flag with a reason and an
  auto-reopen time + a holiday calendar.
- **B. One weekly schedule only**, no holidays, no temporary close.
- **C. Manual only** — the merchant toggles open/closed by hand.

**Recommendation:** **A**, minus the holiday calendar for Phase 1 — temporary
close with an auto-reopen time covers a Thai public holiday adequately, and a
separate calendar is a second thing to maintain. Cutoff: **stop accepting new
orders `preparation_time` before closing**, so the kitchen is never asked to
cook after it has shut. `preparation_time` is per-merchant (the design tracks
`เวลาทำเฉลี่ย 11 นาที`).

**Impact if wrong:** Orders accepted by a closed kitchen — the fastest way to
lose merchants and customers simultaneously in a small district.

---

### BQ-008 — Minimum order value and per-merchant delivery radius

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Cart validation, checkout
related: BQ-003, BQ-026
```

**Question:** Who sets the minimum order value and the delivery radius — the
merchant, BANHAO, or both — and what happens below the minimum?

**Why it matters:** The merchant sitemap lists `ยอดขั้นต่ำ / รัศมีส่ง` as
merchant-editable settings, but the customer design never shows a
below-minimum state, and the promotion `สั่งครบ 100 บาท` already establishes a
฿100 threshold concept for a different purpose.

**Options:**
- **A. Merchant sets both**, platform sets a ceiling on the radius.
- **B. Platform sets both**, uniform across the district.
- **C. Merchant sets minimum, platform sets radius (zones).**

**Recommendation:** **C.** The merchant knows what order size is worth cooking;
the platform owns the geography and the fee formula, so it should own the
radius. Below minimum: **block checkout with the shortfall shown**
("สั่งเพิ่มอีก ฿35"), never silently.

**Impact if wrong:** Merchants losing money on tiny orders, or an unexplained
disabled checkout button.

---

### BQ-009 — Item availability and option-group semantics

```yaml
priority: P2
owner: PRODUCT_OWNER
status: OPEN
blocks: Catalogue module
```

**Question:** How does a merchant mark an item sold out, does it reset
automatically, and can option groups be multi-select or quantity-bearing?

**Why it matters:** The design shows three option groups
(`เลือกเนื้อสัตว์` marked `ต้องเลือก`, `ระดับความเผ็ด`, `เพิ่มไข่`) all rendered
as single-select with price deltas, and the merchant sitemap has
`ราคา + สถานะขาย` (price + sale status). Multi-select add-ons — the normal case
for a real menu — are not shown, so supporting them is an assumption.

**Options:**
- **A. Single-select groups only**, matching the design exactly.
- **B. Single-select and multi-select groups**, with min/max per group.
- **C. B plus per-option quantity** ("ไข่ดาว ×2").

**Recommendation:** **B.** Multi-select with `min`/`max` covers real menus at
almost no extra modelling cost and is painful to retrofit into saved carts and
historical order lines. Sold-out: a manual flag with an **optional** auto-reset
at the next opening time.

**Impact if wrong:** A schema migration over live menu data, and merchants
working around the limit by creating duplicate items.

---

## Cart

### BQ-010 — One merchant per cart?

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED
decision: DEC-017
blocks: Cart schema, Order schema, delivery-fee model, dispatch
```

> **DECIDED 2026-08-10 — DEC-017.** One cart = one restaurant. Option A.
> A customer cannot build a multi-restaurant cart in Phase 1.

**Question:** May a cart contain items from more than one restaurant?

**Why it matters:** This is the single most structural cart question and it
changes the shape of `Order`, `Delivery`, and the fee model. The design's cart
screen shows **one shop header above the lines**
(`ส้มตำป้าทองดี · 1.2 กม. · 20–25 นาที`) and the delivery fee is quoted per
shop distance — strong evidence for one merchant per cart, but it is never
stated, and inference is not decision.

**Options:**
- **A. One merchant per cart.** Adding an item from another shop prompts to
  clear the cart.
- **B. Multiple merchants, one delivery.** Requires multi-pickup routing.
- **C. Multiple merchants, split into separate orders and deliveries.**

**Recommendation:** **A**, unambiguously, for Phase 1. B multiplies dispatch
complexity in a district with 8–12 riders and would violate CON-004 (never
lengthen the core path). C is A with extra checkout steps. The current Customer
App is already built as if A were true.

**Impact if wrong:** Rebuilding cart, order, dispatch, and the fee formula.

---

### BQ-011 — Cart validity: price, availability and closure changes

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Cart module, checkout
related: BQ-007, BQ-009
```

**Question:** What happens when, between adding to cart and paying, an item
sells out, its price changes, the shop closes, or the promotion expires?

**Why it matters:** Nothing in the design covers a stale cart, yet every one of
these will happen daily. It also determines whether the order stores a **price
snapshot** — which it must, if the customer is to be charged what they were
shown.

**Options:**
- **A. Revalidate at checkout, show a diff, require re-confirmation.**
- **B. Silently update to current prices.**
- **C. Honour the cart price for a fixed window** (e.g. 30 minutes).

**Recommendation:** **A**, plus this as a hard rule regardless of the option
chosen: **an order stores its own immutable line prices, fee amounts and
discount amounts in satang at creation time.** Recomputing an order's total
from the current catalogue later would break CON-003 the moment a menu price
changes.

**Impact if wrong:** Customers charged a different amount than displayed — a
consumer-protection issue (Q-017 territory), not just a bug.

---

## Order lifecycle

### BQ-012 — The missing `PENDING_PAYMENT` order state

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED
decision: DEC-019
blocks: Order state machine, Payment pairing
related: CON-001, REQ-002
```

> **DECIDED 2026-08-10 — DEC-019.** Option A. `PENDING_PAYMENT` is a real
> Order state in the approved core lifecycle, so the Payment State Machine no
> longer references a state that does not exist.

**Question:** Should `PENDING_PAYMENT` be added as an Order state before `NEW`?

**Why it matters — this is a genuine contradiction between two accepted
documents.** The Payment State Machine pairs `CREATED`, `PENDING`, `PROCESSING`,
`FAILED` and `EXPIRED` with an Order state named **`PENDING_PAYMENT`**, but the
Order State Machine's twelve states do not include it. Something must give:
either the order exists in an unnamed state while a PromptPay QR is unpaid, or
the pairing column is wrong. REQ-002 makes this load-bearing — every client
reads one canonical state, so an unnamed state cannot be displayed.

**Options:**
- **A. Add `PENDING_PAYMENT`** as the initial Order state for prepaid orders;
  `NEW` then means "sent to the merchant".
- **B. Keep 12 states**; the order simply does not exist until payment succeeds
  (create the Order row only on webhook confirmation).
- **C. Keep 12 states**; treat `NEW` as covering unpaid orders and let the
  Payment state disambiguate.

**Recommendation:** **A.** Option B loses the order if payment never completes
— but the design explicitly requires surviving that case ("ปิดแอประหว่างรอ QR …
เปิดแอปกลับมาเจอ QR เดิมพร้อมเวลาที่เหลือ", and `QR หมดอายุ … ออเดอร์ยังอยู่
ไม่สร้างออเดอร์ใหม่`). Option C would show the merchant an order nobody has
paid for. A is the only option consistent with both documents; it makes the
Order State Machine 13 states.

**Impact if wrong:** Merchants cooking unpaid orders, or customers losing carts
on a backgrounded app.

---

### BQ-013 — Merchant accept timeout behaviour

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Order state machine, merchant SLA
```

**Question:** The merchant has 3 minutes to accept (`กดรับใน 3 นาที`). What
happens at 3:00 exactly?

**Why it matters:** The design states the window and the `REJECTED` state, but
never says whether expiry auto-rejects, escalates to a human, or keeps ringing.
For a district with 20–30 shops where a rejected order likely means a lost
customer, "auto-reject silently" may be the wrong default.

**Options:**
- **A. Auto-reject at 3:00**, refund automatically, suggest nearby shops
  (the design's own error flow: `ร้านปฏิเสธ → แจ้งลูกค้าทันที → คืนเงินอัตโนมัติ
  → แนะนำร้านใกล้เคียง`).
- **B. Escalate to admin** at 3:00 — admin phones the shop (viable at launch
  volume, not at scale).
- **C. Keep alerting** with no timeout.

**Recommendation:** **A as the system rule, with B as an ops overlay** during
the first months: auto-reject after 3 minutes, but raise an admin alert at
~90 seconds so a phone call can still save the order. This is exactly the kind
of manual assist §22 of the brief anticipates.

**Impact if wrong:** Silent order loss, or customers waiting indefinitely.

---

### BQ-014 — `NO_DRIVER` semantics, and the "food not cooked" contradiction

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED
decision: DEC-019, DEC-022
blocks: Order state machine, refund rules, dispatch
related: BQ-015, BQ-025
```

> **DECIDED 2026-08-10 — DEC-019 and DEC-022.** Option A. Rider search starts
> at `MERCHANT_ACCEPTED`, in parallel with `PREPARING`, so the Customer App
> copy is correct. `NO_DRIVER` is **not** an Order state — the condition is a
> prolonged `RIDER_SEARCHING` in the delivery domain, and it never
> auto-cancels. **The cost question (BQ-015) is still open.**

**Question:** When exactly does `NO_DRIVER` occur, is it terminal, and is the
food already cooked when it does?

**Why it matters — two accepted documents contradict each other.**
- `docs/05-architecture` documents the transition **`READY → NO_DRIVER`** after
  a 5-minute search. `READY` means `อาหารพร้อมแล้ว` — the food is cooked.
- The Customer App's `🛵 ไม่มีไรเดอร์` state tells the customer
  **"อาหารของคุณยังไม่ถูกปรุง หากยกเลิกตอนนี้จะได้เงินคืนเต็มจำนวน"** — your
  food has not been cooked, cancel now for a full refund.

Both cannot be true. Whichever is right determines who absorbs the cost of the
food (BQ-015) and whether a full automatic refund is even fair to the merchant.

**Options:**
- **A. Dispatch starts at `ACCEPTED`** (in parallel with cooking) and
  `NO_DRIVER` is raised *before* `READY` — the Customer App copy is then correct
  and the state-machine arrow is wrong.
- **B. Dispatch starts at `READY`** — the state machine is correct and the
  Customer App copy is wrong and must change; a full refund then means the
  merchant is out a cooked meal unless BANHAO pays for it.
- **C. Both** — dispatch attempts start at `ACCEPTED`, and `NO_DRIVER` can be
  raised at either point, with different customer copy and different refund
  treatment for each.

**Recommendation:** **A**, and treat `NO_DRIVER` as **transient, not terminal** —
a flag on an order that is still searching, which resolves to `DRIVER_ASSIGNED`
or to `CANCELLED`. Starting the rider search when the merchant accepts is also
what makes the ≤5% no-rider cancellation target realistic with 8–12 riders. The
design's own `PREPARING` row already says the rider sees
`งานถูกจับคู่ · ไปที่ร้าน` — matched during preparation — which supports A.

**Impact if wrong:** Either merchants absorb wasted food with no compensation
rule, or the customer app tells customers something false at the worst moment.

---

### BQ-015 — Who bears the cost of cooked-but-undelivered food

```yaml
priority: P0
owner: PRODUCT_OWNER
status: OPEN
blocks: Ledger, merchant/rider terms, refund rules
related: BQ-014, BQ-017, Q-003
```

**Question:** When an order fails after the merchant has cooked it — no rider
found, customer not reachable, customer refuses delivery — who pays for the
food?

**Why it matters:** CON-003 requires every order's ledger to balance to exactly
zero. A refunded customer plus a merchant who must still be paid means someone
funds the difference, and that someone must be named in the ledger. No document
addresses this. The design's cash edge case
(`ลูกค้าเงินสดไม่รับของ → ไม่มีการเก็บเงิน ไม่ต้องคืนเงิน บันทึกเป็นออเดอร์เสียหาย`)
records a **damaged-order** concept but assigns no cost to anyone.

**Options:**
- **A. BANHAO absorbs it** — merchant paid in full, customer refunded in full,
  platform books the loss.
- **B. Merchant absorbs it** — no payout for a failed order.
- **C. Split by cause** — platform pays when the platform failed (no rider),
  merchant pays when the merchant failed (rejected after accepting), customer
  pays when the customer failed (unreachable, refused).
- **D. Customer pays** where the customer is at fault.

**Recommendation:** **C**, with a documented cause code on every failed order,
and BANHAO absorbing the no-rider case specifically — that failure is the
platform's, and pushing it onto merchants in a 20–30-shop district would end
merchant participation quickly. Whatever is chosen must appear as an explicit
ledger account (e.g. `PLATFORM_WRITE_OFF`), not as a rounding difference.

**Impact if wrong:** The ledger cannot balance, and merchant/rider agreements
have to be renegotiated after launch.

---

### BQ-016 — Cancellation windows, fees, and post-pickup policy

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Order module, refund rules
related: Q-003 (extends it), BQ-015
```

**Question:** Beyond the three documented rules, what is the full cancellation
policy — is there ever a cancellation fee, and what can the support centre
actually do after `PICKED_UP`?

**Why it matters:** Q-003 already records that the documented rules (auto-refund
before `PREPARING`, shop-confirmed during `PREPARING`, support-only after
`PICKED_UP`) are incomplete. The domain pass adds two specifics: (a) the rules
are written in terms of Order state, but a customer perceives *time*, and
(b) "support-center-only" describes a channel, not an outcome — nothing says
whether a post-pickup cancellation is ever refunded.

**Options:**
- **A. No cancellation fee ever**, refund decided by cause code.
- **B. Free before `PREPARING`, partial refund during, none after `PICKED_UP`.**
- **C. B plus a repeat-canceller penalty** (rate-limit or account flag).

**Recommendation:** **B for Phase 1**, with the partial-refund split defined by
BQ-031, and C's abuse handling deferred — at launch volume, abuse is visible to
a human operator without automation.

**Impact if wrong:** Refund disputes with no written policy to point at.

---

### BQ-017 — Delivery failure: customer unreachable or refusing

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Order state machine, Driver App, ledger
related: BQ-015, BQ-018
```

**Question:** What does a rider do when the customer does not answer or refuses
the order, and what state does the order end in?

**Why it matters:** The Order State Machine has no `DELIVERY_FAILED` state, but
the payment canvas already anticipates the case for cash
(`ลูกค้าเงินสดไม่รับของ`) and the Driver App has a
`ลูกค้าจ่ายไม่ครบ / มีปัญหา` escape hatch. For a prepaid order the money has
already moved, so an outcome must be defined.

**Options:**
- **A. Add `DELIVERY_FAILED`** as a distinct terminal state with a cause code,
  and a wait-time rule (e.g. rider waits 10 minutes, calls twice, then fails
  the delivery).
- **B. Reuse `CANCELLED`** with a cause code.
- **C. Rider decides** — leave at door, or return to shop.

**Recommendation:** **A.** `CANCELLED` and `DELIVERY_FAILED` have different money
consequences (BQ-015) and different rider compensation (BQ-024); collapsing
them destroys exactly the distinction the ledger needs. Add a documented wait
rule so the rider is not the one improvising.

**Impact if wrong:** Riders stranded with food and no procedure; unrecordable
losses.

---

### BQ-018 — Proof of delivery

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Driver App, dispute handling
related: Q-013, Q-012
```

**Question:** What proves an order was delivered — a rider tap, a photo, a
customer confirmation code, or a GPS check?

**Why it matters:** The Driver App sitemap lists
`ยืนยันส่งสำเร็จ + ถ่ายรูป` (confirm delivery + take a photo), so a photo is a
documented intention — but nothing says whether it is mandatory, where it is
stored, how long it is kept (PDPA, Q-012), or what happens if the customer
disputes delivery anyway (Q-013).

**Options:**
- **A. Rider tap only.**
- **B. Mandatory photo** stored with a retention limit.
- **C. Customer confirmation code** read out at handover.
- **D. Photo for contactless, code for hand-to-hand.**

**Recommendation:** **B for Phase 1**, with an explicit retention period set
under Q-012 and no faces or house numbers required in frame. A photo is
one tap for the rider and settles most disputes. Confirmation codes add a step
to every delivery for a fraud rate that is unknown and probably low in a
district where riders and customers often know each other.

**Impact if wrong:** Unresolvable disputes, or PDPA exposure from unbounded
photo retention.

---

## Rider

### BQ-019 — Dispatch model

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED
decision: DEC-020
blocks: Dispatch engine, Driver App, admin manual dispatch
related: BQ-020, BQ-025
```

> **DECIDED 2026-08-10 — DEC-020.** Model C: broadcast to eligible online
> riders, first to accept wins, with operator manual dispatch (DEC-032) as an
> always-available override. No scoring or optimisation in Phase 1.

**Question:** Which dispatch model does BANHAO use — first-available,
zone-based, broadcast/first-accept, or manual?

**Why it matters:** The rider pool is 8–12 people. Dispatch is the single
constraint that most shapes the product, and the design records the *symptoms*
of a model (a countdown on a job card, an accept/decline pair, an admin
`จ่ายงานด้วยมือ` manual-dispatch action) without naming the model itself.

**Options:** See `docs/RIDER_LIFECYCLE.md` § Dispatch models for the full
comparison of A (nearest-first sequential offer), B (zone-based), C (broadcast /
first accept), and D (manual dispatch).

**Recommendation:** **C — broadcast to all eligible online riders, first to
accept wins — with D (admin manual dispatch) as an always-available override.**
With 8–12 riders in one district, sequential offers (A) waste the scarcest
resource in the system: seconds. Zones (B) fragment a pool that is already too
small to fragment. C is also the least code. Revisit at Stage 2 when the pool
supports zoning.

**Impact if wrong:** Slow assignment, unhappy riders, and the ≤5% no-rider
cancellation target missed.

---

### BQ-020 — Accept window duration and the offer cascade

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Dispatch engine, Driver App
related: BQ-019
```

**Question:** How long does a rider have to accept, and what happens when
everyone declines?

**Why it matters:** The design is internally inconsistent — wireframe `D-05` is
titled `งานใหม่เข้า (นับถอยหลัง 20 วิ)` (20-second countdown) while the button
inside it reads `รับงาน · 12 วิ` (12 seconds). One is the window, the other is a
mid-countdown snapshot, but the document does not say which.
`ai/RESEARCH/THAILAND_COMPLIANCE.md` §5 cites "the documented 12-second accept
window" — it read the button state, so **12 seconds should not be treated as
established**.

**Options:**
- **A. 20 seconds**, one broadcast round, then retry every 30 s for 5 minutes.
- **B. 12 seconds**, faster rounds.
- **C. No timer** under a broadcast model — the offer stands until taken or the
  order times out.

**Recommendation:** **A**, and make it **configuration, not a constant**, so it
can be tuned against real Buntharik data without a release. Under broadcast (C
is tempting) a visible countdown still creates the urgency that gets an offer
accepted.

**Impact if wrong:** Either riders feel harassed by an impossible timer, or
orders sit unassigned.

---

### BQ-021 — Concurrent orders per rider (batching)

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Dispatch engine, earnings model
```

**Question:** May a rider hold more than one active order at a time?

**Why it matters:** With 8–12 riders, batching two nearby orders is the cheapest
capacity increase available — and also the fastest way to make both customers
late. Nothing in the design addresses it; the Driver App shows a single-job
flow with one primary button per state.

**Options:**
- **A. One order at a time.**
- **B. Two, only when both pickups are the same merchant.**
- **C. Two, when pickup and dropoff are both within a distance threshold.**

**Recommendation:** **A for launch**, revisit with real data. The design's own
one-button-per-state Driver App assumes a single job, and B/C both need a UI
that does not exist. This is a capacity lever to pull *after* measuring, not
before.

**Impact if wrong:** Either wasted capacity or systematically late deliveries.

---

### BQ-022 — Rider onboarding, working area, and contractor status

```yaml
priority: P1
owner: PRODUCT_OWNER + LEGAL_REVIEW_REQUIRED
status: OPEN
blocks: Driver App, admin approval, rider agreement
related: Q-002, THAILAND_COMPLIANCE §5
```

**Question:** What does a rider submit, who approves it, is there a defined
working area per rider, and what is the contractual relationship?

**Why it matters:** The design documents the artefacts (`ยืนยันตัวตน + เอกสาร`,
`ข้อมูลรถ`, `รออนุมัติ`, and an approval queue showing
`ใบขับขี่ + ทะเบียนรถ` — licence and vehicle registration) but not the rules.
The contractual half is explicitly `LEGAL_REVIEW_REQUIRED`:
`ai/RESEARCH/THAILAND_COMPLIANCE.md` §5 flags that algorithmic dispatch, accept
timers and the auto-suspension-on-cash-limit rule are precisely the factors a
worker-reclassification argument turns on.

**Options:** Not an engineering menu — this is legal drafting plus a product
choice about how much control the platform exerts.

**Recommendation:** Commission the rider-agreement review together with Q-002
(they share counsel and lead time). Product-side, model `working_area` as a
nullable zone reference now even if every rider is district-wide at launch —
adding it later means migrating live rider records.

**Impact if wrong:** Worker-classification exposure; rework of dispatch when
zones arrive.

---

### BQ-023 — Rider cash float at pickup

```yaml
priority: P0
owner: PRODUCT_OWNER
status: DEFERRED — COD disabled in Phase 1
decision: DEC-016 (defers, does not answer)
blocks: Cash ledger, rider terms, dispatch eligibility
related: Q-004, BQ-033, BQ-034
```

> **DEFERRED 2026-08-10 — DEC-016 disables COD in Phase 1, which removes the
> situation without answering the question.** No rider handles cash, so no
> float is needed at launch. This returns unchanged the day COD is reintroduced
> — decide it before then, not during.

**Question:** On a cash order, does the rider pay the merchant in cash at
pickup — before collecting anything from the customer?

**Why it matters:** The documented cash design says yes, twice, and it has never
been called out:
- Merchant finance: *"ออเดอร์เงินสดไม่เข้ารอบโอน เพราะร้านได้รับเงินจากไรเดอร์
  หน้าร้านแล้ว"* — cash orders skip the transfer round because the shop already
  received the money **from the rider at the counter**.
- The cash ledger example books `ร้านได้รับเงินสดหน้าร้านแล้ว −฿108`.

That means a rider must carry a working float and is out of pocket between
pickup and delivery. On a ฿130 order the rider fronts ฿108 to earn ฿12. A rider
running four cash orders needs several hundred baht of their own money in hand,
and carries the loss if a customer refuses delivery.

**Options:**
- **A. Confirm as designed** — rider pays the merchant at pickup; define a
  minimum float and compensate the rider when a customer refuses.
- **B. Merchant is paid by BANHAO in the next transfer round** for cash orders
  too; the rider remits the full ฿130 and never fronts money.
- **C. Hybrid** — rider pays at pickup only below a cash-order value threshold.

**Recommendation:** **B.** It removes a real barrier to rider recruitment in a
district where 8–12 riders is the entire supply, makes the rider's remittance
one number instead of a running float, and keeps merchant payouts on one
mechanism instead of two. It costs BANHAO working capital and changes the
documented merchant-finance screen — which is exactly why it is a Product Owner
decision and not an implementation detail.

**Impact if wrong:** Riders unable to work a full shift; unrecoverable losses on
refused cash orders; a cash ledger that models the wrong flow.

---

### BQ-024 — Rider cancellation, compensation, and waiting time

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Dispatch, earnings, ledger
related: BQ-017, BQ-029
```

**Question:** May a rider cancel after accepting, is there a penalty, and is a
rider paid for a job cancelled through no fault of theirs (or for waiting at a
slow kitchen)?

**Why it matters:** The Order State Machine has no rider-cancellation path at
all, yet `CANCELLED` lists `งานถูกยกเลิก` as what the rider sees, and the admin
has a `บังคับปลดงาน` (force-unassign) button — so unassignment demonstrably
exists. If a rider rides to a shop and the order is cancelled there, either they
are compensated or they stop accepting far pickups.

**Options:**
- **A. No compensation.**
- **B. Fixed compensation** when the cancellation is not the rider's fault.
- **C. B plus a waiting fee** after N minutes at the merchant.

**Recommendation:** **B for launch, C when there is data on kitchen delays.** Any
compensation must be a named ledger line (`RIDER_COMPENSATION`), never folded
into delivery earnings — REQ-001's separation logic applies to any money a rider
receives.

**Impact if wrong:** Riders decline distant pickups, concentrating supply on a
few shops.

---

### BQ-025 — No-rider fallback policy

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED — POLICY SHAPE · OPEN — TIMINGS
decision: DEC-022
blocks: Dispatch, refunds, ops runbook
related: BQ-014, BQ-015, BQ-019
```

> **PARTLY DECIDED 2026-08-10 — DEC-022.** The shape is accepted:
> `retry → manual dispatch → operator decision`, and an order is **never**
> auto-cancelled because a search failed. Operator options include continuing
> the search, merchant delivery, and cancel + refund. **Still open:** the retry
> and escalation timings, whether merchant delivery is a per-merchant opt-in,
> and who absorbs the cost when the operator cancels (BQ-015).

**Question:** Paid order, merchant accepted, no rider available — what does the
system do?

**Why it matters:** This is the failure mode most likely to happen at launch and
the one the design sets an explicit target against: cancellations caused by no
rider must stay **below 5%**. The documented behaviour stops at "search 5
minutes, then `NO_DRIVER`", plus a customer-facing offer to keep waiting 3 more
minutes.

**Options analysed in full in `docs/RIDER_LIFECYCLE.md` § No-rider scenario:**
keep waiting · notify and let the customer choose · merchant self-delivery ·
admin manual dispatch · cancel and refund · retry with an incentive.

**Recommendation:** A documented **ladder**, not a single answer — 0–5 min
silent retry, 5–8 min tell the customer and offer to keep waiting or cancel
free, 5 min onward raise an admin alert for manual dispatch, and only cancel
with a full refund when the customer chooses it or the ladder is exhausted.
Merchant self-delivery should be a per-merchant opt-in flag, not an
assumption — some shops have a family member with a motorbike and some do not.

**Impact if wrong:** The 5% target is missed and early customers do not come
back — which is fatal against the design's own success metric (35% repeat
ordering within 14 days).

---

## Money — pricing, fees, earnings

### BQ-026 — Delivery fee model and values

```yaml
priority: P0
owner: PRODUCT_OWNER
status: RESOLVED — MODEL (DEC-023) · NUMERIC PRICING (DEC-035)
decision: DEC-023 (model) + DEC-035 (Phase 1 model and amount)
blocks: nothing further — rider earnings remain BQ-029
related: Q-018, BQ-001, BQ-029
```

> **PARTLY DECIDED 2026-08-10 — DEC-023.** The model is accepted:
> `Customer → delivery fee → rider earning`.
>
> **RESOLVED 2026-08-24 — DEC-035.** Phase 1 uses a **flat delivery fee of
> 1000 satang (฿10) per order**, with no distance component, no bands and no
> zones. Distance-banded pricing (the option this entry recommends below) is
> **explicitly not approved for Phase 1**; adopting it later needs a new
> Product Owner decision plus the coordinate/geocoding infrastructure it
> depends on. No schema or configuration table is required for the flat fee.
> The discussion below is retained as the record of how the decision was
> reached — read it as history, not as an open question.

**Question:** How is the delivery fee computed, and what are the actual numbers?

**Why it matters:** The design's own sample data is inconsistent — onboarding
promises `ค่าส่งเริ่มต้น 10 บาท`, shop cards show `ค่าส่ง ฿10`, and the shop
page and checkout both show `ค่าส่ง ฿15` for 1.2 km with the line labelled
`ค่าส่ง (1.2 กม.)`. The label implies distance-based; the values imply a base
of ฿10 with distance on top. Neither is stated as a rule. Distance-based pricing
also depends on BQ-001 (can we even measure distance reliably?).

**Options:**
- **A. Flat fee** district-wide.
- **B. Distance banded** — e.g. 0–2 km / 2–5 km / 5–10 km.
- **C. Base + per-km.**
- **D. Zone-to-zone matrix.**

**Recommendation:** **B**, with bands and prices held in `ServiceArea`
configuration rather than code (per §32 of the brief), and the band shown to the
customer before checkout. Banding tolerates imprecise geocoding far better than
per-km (C), where a 200 m error changes the price. D is the right Stage-2
answer, not the Stage-1 one. The design's positioning statement — that BANHAO
wins on *fee and time accuracy*, not feature count — makes this decision more
strategic than it looks.

**Impact if wrong:** The platform's stated competitive advantage evaporates, and
rider economics (BQ-029) are built on the wrong base.

---

### BQ-027 — The service fee: purpose, bearer, refundability

```yaml
priority: P0
owner: PRODUCT_OWNER
status: RESOLVED — MODEL (DEC-024) · AMOUNT (DEC-036) · OPEN — REFUNDABILITY
decision: DEC-024 (model) + DEC-036 (Phase 1 shape and amount)
blocks: Refunds only (Phase F). Does not block order creation
related: BQ-028, BQ-031
```

> **PARTLY DECIDED 2026-08-10 — DEC-024.** The model is accepted:
> `Customer → service fee → BANHAO`.
>
> **AMOUNT RESOLVED 2026-08-24 — DEC-036.** Phase 1 uses a **fixed service fee
> of 500 satang (฿5) per order**. No percentage, cap, minimum, tier or
> restaurant-specific variant is approved.
>
> ⚠️ **Still open: refundability.** Whether the service fee survives a refund is
> **not** decided by DEC-036 and must not be inferred from it. It is Phase F
> scope and does not block `POST /orders`, which reads only the amount. The
> options and recommendation below remain live for that question alone.

**Question:** What is the ฿5 `ค่าบริการ` for, is it platform revenue, and is it
refunded on cancellation?

**Why it matters:** It appears on every customer-facing price breakdown in the
design and in the implemented Customer App, and it is included in the ledger's
`รายได้บ้านเฮา (ค่าธรรมเนียม + ค่าบริการ)` line — so it is platform revenue.
But there is no rule for whether it survives a refund, and a fee the customer
pays but never gets back on a platform-caused cancellation is a consumer
complaint waiting to happen.

**Options:**
- **A. Always refunded** with the order.
- **B. Never refunded** — it pays for a service already rendered.
- **C. Refunded when the platform or merchant is at fault; retained when the
  customer cancels late.**

**Recommendation:** **A for Phase 1.** ฿5 is not worth a dispute, and "we kept
your service fee on an order we failed to deliver" is a bad first impression in
a district where word of mouth is the entire marketing channel.

**Impact if wrong:** Small money, disproportionate reputational cost.

---

### BQ-028 — Merchant commission model and rate

```yaml
priority: P0
owner: PRODUCT_OWNER
status: ACCEPTED — MODEL · OPEN — NUMERIC RATE
decision: DEC-025 (model only)
blocks: Ledger, settlement, merchant terms
related: Q-010 (extends it)
```

> **PARTLY DECIDED 2026-08-10 — DEC-025.** The model is accepted:
> `Merchant → commission → BANHAO`. **The rate is not approved, and DEC-025
> states explicitly that the 10% design example must not become a business rule
> by default.**

**Question:** Percentage, fixed fee, hybrid, or subscription — and at what rate?

**Why it matters:** Q-010 records that no rate is documented. The domain pass
found that the design's sample data **is internally consistent at 10% of the
food subtotal**: `฿120→฿12`, `฿180→฿18`, `฿260→฿26`, `฿75→฿8`, `฿95→฿10`
(the last two rounded up), and the merchant finance card states
`ค่าธรรมเนียมเดือนนี้ ฿4,610 · 10% ของยอดอาหาร` outright. **That is a design
sample, not an accepted rate** — but it is a coherent anchor, which Q-010 did
not record.

**Options:**
- **A. Percentage of the food subtotal** (the design's implicit model).
- **B. Fixed fee per order.**
- **C. Hybrid** — smaller percentage plus a per-order fee.
- **D. Monthly subscription**, zero or low per-order commission.

Trade-offs are compared in `docs/SETTLEMENT_MODEL.md` § Commission models.

**Recommendation:** **A**, at a rate the Product Owner sets, because it is the
model merchants already understand from national platforms and it is the only
one whose arithmetic the design has already validated end to end. Note that
**a merchant-friendly rate is a competitive weapon here** — the national
platforms charge substantially more, and a 20–30-shop district is won by
merchant relationships, not marketing. Also decide: is the rate charged on the
food subtotal only (as the design does) or on the order total including fees?
The design's answer — food only — is the merchant-friendly one and should be
stated explicitly, not left implicit.

**Impact if wrong:** The ledger cannot be built (CON-003), and every merchant
agreement has to be renegotiated.

---

### BQ-029 — Rider earnings formula

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Ledger, settlement, Driver App, rider terms
related: BQ-024, BQ-026
```

**Question:** How is a rider paid — per order, by distance, base + distance,
with bonuses, surge, or a minimum guarantee — and are tips supported?

**Why it matters:** The design's samples describe a real structure but no
formula: `D-13` shows `ค่าส่ง 12 งาน ฿408` (≈ ฿34/job),
`โบนัสชั่วโมงเร่งด่วน ฿72` (a **peak-hour bonus** — surge exists as a concept),
and `ค่าธรรมเนียมแพลตฟอร์ม −฿38` — **riders pay a platform fee too**, which is
not mentioned anywhere else in the repository. `P-D2` shows a different day at
`ค่าจัดส่ง ฿350 + โบนัส ฿50`.

There is also a structural finding worth naming: in the documented per-order
ledger the customer is charged **฿15 delivery** while the rider receives
**฿12** and the platform keeps the difference — but a second reading of the
same numbers (customer pays ฿130 = food ฿120 + net fees ฿10) makes delivery
revenue ฿10 against ฿12 paid out, i.e. **delivery runs at a loss covered by
commission**. Which reading is intended changes the entire unit economics.
Tips do not appear anywhere in the design.

**Options:** per-order flat · distance-based · base + distance (the industry
norm) · zone-based · any of these plus peak bonus, minimum guarantee, or tips.

**Recommendation:** **Base + distance, plus a configurable peak bonus**, and
resolve the delivery-fee-versus-rider-pay relationship explicitly as part of
BQ-026 — decide whether delivery is intended to break even, subsidise, or be
subsidised. Add tips only if the Product Owner wants them; they add a payment
path, a refund case and a tax question for a small amount of money.

**Impact if wrong:** Riders quit (the scarcest resource), or the platform loses
money silently on every delivery.

---

### BQ-030 — Who funds promotions and discounts

```yaml
priority: P0
owner: PRODUCT_OWNER
status: OPEN
blocks: Ledger, settlement, promotion engine
related: BQ-028, CON-003
```

**Question:** When an order carries a ฿10 `BANHAO7` discount, whose money is it
— BANHAO's, the merchant's, or shared?

**Why it matters:** CON-003 means a discount must be funded by a named party in
the ledger. Working the design's own numbers through: customer pays ฿130
(food ฿120 + delivery ฿15 + service ฿5 − discount ฿10); merchant receives ฿108
(full ฿120 less 10% commission); rider receives ฿12; BANHAO receives ฿10.
The merchant is made whole on the full menu price, so in the design's own
example **the platform absorbs the discount entirely**. That is derived from a
sample, not stated as policy.

**Options:**
- **A. Platform-funded** — merchant paid on the pre-discount subtotal.
- **B. Merchant-funded** — merchant's own promotion, paid on the discounted
  amount.
- **C. Both types exist**, each promotion tagged with its funder.
- **D. Shared** by a configured split.

**Recommendation:** **C**, with the funder recorded on every promotion and
carried onto the order. Both types will exist in reality (a shop wanting to push
a slow item versus BANHAO buying first orders), and retrofitting a funder field
onto live promotions and settled orders is painful. Also decide **stacking**:
recommend at most one coupon plus one merchant promotion per order.

**Impact if wrong:** Merchants under- or over-paid on every promoted order, and
a ledger that cannot be reconciled.

---

### BQ-031 — Partial refund composition

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Refund module, settlement reversal
related: Q-003, Q-020, BQ-027, DQ-03
```

**Question:** When a refund is partial, which components are refunded — food,
delivery, service fee, discount — and in what order?

**Why it matters:** The design's refund UI shows one number and a reason, never
a breakdown. But a partial refund (one missing item; food arrived cold) has to
decide whether the delivery fee is refunded too, and what happens to a discount
that was conditional on a minimum spend the refunded order no longer meets. Each
answer produces different reversal entries against the merchant, the rider, and
platform revenue.

**Options:**
- **A. Refund line items only**; fees are never partially refunded.
- **B. Refund proportionally** across every component.
- **C. Cause-based** — a merchant fault refunds food, a platform fault refunds
  the fees.

**Recommendation:** **C**, and make every refund carry the same four-way
decomposition as the original payment so the reversal entries write themselves.
Note the constraint that **rider earnings should not normally be clawed back**
for a merchant's error — the rider did the work.

**Impact if wrong:** Refunds that leave the ledger unbalanced, or riders
penalised for merchant mistakes.

---

### BQ-032 — Settlement cycle, cutoff, minimum payout, failed transfers

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Settlement engine
related: Q-002, BQ-033, BQ-034
```

**Question:** How often are merchants and riders paid, with what cutoff, what
minimum, and what happens when a transfer fails?

**Why it matters:** The design shows weekly transfer rounds
(`โอนทุกวันจันทร์ เวลา 10:00 น.`) and dated rounds in both the merchant and
rider screens — but the merchant card also says `โอนแล้วเดือนนี้ ฿41,470 · 6 รอบ`
(**6 rounds in a month**, which is not weekly), and the settlement history shows
a `ล้มเหลว` (failed) round with no defined recovery. So the cadence is
approximately documented and the exception path is not documented at all.

**Options:** daily · every 2–3 days · weekly (the design's apparent intent) ·
on demand above a threshold.

**Recommendation:** **Weekly at launch** — it is what the design shows, it
minimises transfer fees and reconciliation work for a solo operator, and it is
what merchants in this market expect. Define explicitly: the cutoff instant, a
minimum payout amount below which the balance rolls forward, retry behaviour for
a failed transfer, and who is alerted. Note that **payout timing may be
constrained by Q-002** — the legal settlement model can dictate how long
platform-held funds may sit.

**Impact if wrong:** Merchant cash-flow complaints, or money stuck with no
recovery procedure.

---

### BQ-033 — Cash-order fee netting and negative merchant balances

```yaml
priority: P1
owner: PRODUCT_OWNER
status: DEFERRED — COD disabled in Phase 1
decision: DEC-016 (defers, does not answer)
blocks: Settlement engine
related: BQ-023, BQ-032
```

> **DEFERRED 2026-08-10 — DEC-016.** With no cash orders, every merchant
> payment flows through transfer rounds, so the "fee owed, no transfer due"
> state does not arise in Phase 1. Returns with COD.

**Question:** A cash order pays the merchant directly, so BANHAO's commission is
deducted from the *next* transfer round. What happens when there is no next
round large enough — a cash-only merchant whose balance goes negative?

**Why it matters:** The netting rule is documented
(`ระบบหักค่าธรรมเนียมจากยอดโอนรอบถัดไปแทน`), but a merchant with mostly cash
orders accrues a debt to the platform with no payout to net it against. This is
a real scenario in a rural district where cash is the default.

**Options:**
- **A. Allow a negative balance**, carried forward and collected later.
- **B. Invoice the merchant** for the shortfall.
- **C. Cap it** — suspend cash orders for merchants past a debt limit.
- **D. Eliminate the case** by adopting BQ-023 option B, so all merchant money
  flows through transfer rounds.

**Recommendation:** **D, with A as the safety net.** BQ-023-B removes the
underlying cause; a carried negative balance handles the residue. C mirrors the
rider cash limit and is the right escalation if debts persist.

**Impact if wrong:** Uncollectable commission on the payment method most
customers will use.

---

### BQ-034 — Rider payout netting and negative balances

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Settlement engine, dispatch eligibility
related: Q-004, REQ-001, BQ-023
```

**Question:** Rider earnings are netted against cash owed before transfer. What
happens when cash owed exceeds earnings, and how is the shortfall recovered?

**Why it matters:** The design documents the netting
(`หักเงินสดค้างนำส่ง` before the transfer round) and the auto-suspension
(`ถ้ายังมีเงินสดค้างนำส่งเกินวงเงินที่กำหนด ระบบจะหยุดจ่ายงานใหม่ให้อัตโนมัติ`)
— but Q-004 records that the limit's actual number was never given, and no
document covers a rider who stops working while holding platform cash.

**Options:** carry the balance forward · suspend dispatch (documented) · require
remittance before going online · escalate to admin recovery after N days.

**Recommendation:** All four as a ladder, and set the cash limit (Q-004) as
**configuration** — likely a few thousand baht, calibrated to how often
remittance is practical in Buntharik, which is local knowledge the Product Owner
has and this analysis does not. Keep REQ-001's separation absolute in every
screen and every ledger view.

**Impact if wrong:** Unrecoverable cash losses, which at launch volume could
exceed a month's platform revenue.

---

## Cross-cutting

### BQ-035 — Notification event × channel matrix

```yaml
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Notification module
related: Q-019
```

**Question:** Which of the order events go to which channel — push, SMS, LINE,
in-app — for which actor?

**Why it matters:** The design has an in-app notification list and status
updates, and Q-019 already covers SMS sender-ID registration (with ~2 weeks of
lead time) for OTP. But nothing says whether order updates are pushed, SMS'd, or
only shown in-app — and SMS at ฿0.15/message across a dozen events per order is
a real cost line. LINE is worth naming explicitly: it is how much of rural
Thailand actually communicates, and merchants may be more reachable there than
in a merchant app.

**Options / recommendation:** Push + in-app for customers (free, sufficient);
**a loud, persistent channel for merchants** — the design demands
`เสียงเตือนดังจนกว่าจะกดรับ`, an alarm that will not stop until acknowledged,
which is a merchant-app requirement, not a notification-provider one; push for
riders. Reserve SMS for OTP and for money events. No provider should be selected
here — see `ai/RESEARCH/NOTIFICATIONS.md`.

**Impact if wrong:** Missed orders at the merchant end, or an unexpected SMS
bill.

---

### BQ-036 — Rating: edit window, moderation, consequences

```yaml
priority: P2
owner: PRODUCT_OWNER
status: OPEN
blocks: Rating module
```

**Question:** Can a rating be edited or deleted, is it moderated, and what
happens to a merchant or rider whose rating falls?

**Why it matters:** The design has 5-star ratings for both merchant and rider,
tag chips (`อาหารอร่อย`, `ส่งเร็ว`, …), a skip option, and it displays rating
counts (`4.8 (326 รีวิว)`) — but no comment field, no moderation, and no
consequence. In a district where everyone knows everyone, a single unfair
one-star is more consequential than in a city, and abuse is more personal.

**Options / recommendation:** For Phase 1 — one rating per order, editable for
24 hours, then frozen; **no free-text comments at launch** (the design does not
have them, and unmoderated text in a small community is a liability with no
moderator to staff it); ratings visible to admin, aggregate visible publicly
only above a minimum count; no automated suspension — a human reviews low
ratings. Consequences belong with BQ-022's rider agreement.

**Impact if wrong:** Unfair reputational damage to a local business with no
appeal route.

---

### BQ-037 — Support ticket scope and SLA

```yaml
priority: P2
owner: PRODUCT_OWNER
status: OPEN
blocks: Support module
```

**Question:** What can a support ticket be about, who answers it, and how fast?

**Why it matters:** The design commits publicly to
`ติดต่อฝ่ายช่วยเหลือได้ทุกวัน 08:00–21:00 น.` — a 13-hour daily support window,
printed on the payment detail screen. For a solo founder that is a staffing
commitment, and the post-`PICKED_UP` cancellation rule routes customers to
exactly this channel.

**Options / recommendation:** Phase 1 support should be a **phone/LINE channel
with a ticket record created by admin**, not a self-service ticketing product —
the volume does not justify one and the stated hours are already ambitious.
Revisit the published hours against who is actually answering.

**Impact if wrong:** A published promise the operation cannot keep.

---

### BQ-038 — Admin authority and audit

```yaml
priority: P2
owner: PRODUCT_OWNER
status: OPEN
blocks: Admin app, authorization
related: Q-014 (extends it)
```

**Question:** Which admin actions require which permission, and what is audited?

**Why it matters:** The design gives admin real power — `จ่ายงานด้วยมือ`
(manual dispatch), `บังคับปลดงาน` (force-unassign a rider), `ระงับ / ปลดระงับ`
(suspend), refunds, and approvals. Q-014 asks whether sub-roles are needed.
The domain pass adds the audit half: **every manual money or state override must
be attributable to a person**, whatever the role model turns out to be.

**Recommendation:** A single admin role is acceptable at launch (there is one
operator), **provided** every override writes an audit record with actor,
timestamp, before/after state and reason. Sub-roles can be added later; missing
audit history cannot be reconstructed.

**Impact if wrong:** Unattributable money movements — the thing an auditor asks
about first.

---

### BQ-039 — Search and discovery ranking

```yaml
priority: P2
owner: PRODUCT_OWNER
status: OPEN
blocks: Search, home feed
related: DQ-05
```

**Question:** How are search results and the home feed ordered, and is paid
placement ever allowed?

**Why it matters:** DQ-05 records that `06 ค้นหา` returns shops and menu items
in one list with no specified ranking; the Customer App implements shops first,
then items, in mock order. The home feed has `ร้านแนะนำ / ใกล้ฉัน` (recommended
/ near me) with no rule behind either word. With 20–30 shops, ranking is a
relationship question as much as an algorithm.

**Options / recommendation:** Distance, then open-now, then rating, with
**closed shops shown but sorted below open ones** rather than hidden — in a
district this small, "which shops exist" is itself useful. No paid placement in
Phase 1; introducing it early would poison merchant trust while the platform is
still recruiting.

**Impact if wrong:** Merchants suspecting favouritism — expensive in a market
built on personal relationships.

---

## Design questions from the Customer App (DQ-01…DQ-05)

Required by §29 of the task brief. Source:
`docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md`.

| DQ | Subject | Business status after this pass |
|---|---|---|
| **DQ-01** | Cash payment path after checkout | **Moot for Phase 1 — DEC-016 disables COD.** There is no cash path to design; the Customer App's cash option must be **disabled** instead, which is the actual follow-up. The documented cash flow (`เลือกเงินสด → แจ้งยอดที่เตรียมมา → ส่งออเดอร์ให้ร้าน`, Payment = `CASH_PENDING`) is retained for the phase that reintroduces COD, at which point DQ-01 reopens alongside BQ-023. |
| **DQ-02** | What triggers `12f จ่ายซ้ำ / จ่ายแล้ว` | **Answerable from existing documents.** The payment canvas edge case `กดจ่ายซ้ำ / กด Back แล้วเข้ามาใหม่` specifies it exactly: reuse the same payment reference, create nothing new, and if already paid show "ออเดอร์นี้ชำระเงินแล้ว". So 12f is the UI for REQ-003 idempotency, reached whenever a client re-enters payment for an already-`SUCCESS` payment. Recorded in `docs/PAYMENT_LIFECYCLE.md` § Idempotency. Recommend closing DQ-02 as documented, not open. |
| **DQ-03** | Refund entry point | **Blocked on business decision.** Reachability is a UI question, but *what a refund means* is Q-020 (no provider supports native PromptPay refunds) plus BQ-031 (partial composition). Keep DQ-03 open, tracked against **Q-020** and **BQ-031**. |
| **DQ-04** | Address editing | **Superseded by business questions.** Tracked as **BQ-001** (address model) and **BQ-002** (multiple addresses, default, CRUD). DQ-04 should be closed in favour of those. |
| **DQ-02 update** | Duplicate-payment trigger | Now formalised as **DEC-030** — a duplicate payment never increases an order's value; the surplus is a refund obligation. Screen 12f is the UI for it. |
| **DQ-05** | Search scope and ranking | **Superseded by a business question.** Tracked as **BQ-039**. |

## Pre-existing questions — status after this pass

No `Q-NNN` was resolved by this pass. Cross-references added:

| Q | Subject | Related BQ |
|---|---|---|
| Q-001 | Payment provider | `docs/PAYMENT_LIFECYCLE.md` |
| Q-002 | Legal / settlement model | BQ-005, BQ-022, BQ-032 |
| Q-003 | Full refund policy | **BQ-016** (extends), BQ-031 |
| Q-004 | Cash-remittance limit | **BQ-034** (extends), BQ-023 |
| Q-010 | Platform fee | **BQ-028** (extends) |
| Q-011 | Chargebacks | `docs/PAYMENT_LIFECYCLE.md` § Chargebacks |
| Q-012 | PDPA retention | BQ-004, BQ-018 |
| Q-013 | Anti-fraud | BQ-018 |
| Q-014 | Authorization granularity | **BQ-038** (extends) |
| Q-018 | Map/address accuracy | BQ-001, BQ-026 |
| Q-019 | SMS sender ID | BQ-035 |
| Q-020 | PromptPay refund mechanism | BQ-031, DQ-03 |

## Items requiring legal review

`LEGAL_REVIEW_REQUIRED` — no AI agent and no engineer may conclude that any of
these is lawful. Consolidated from `ai/RESEARCH/THAILAND_COMPLIANCE.md` and this
pass:

| Area | Trigger in BANHAO's own design | Tracked as |
|---|---|---|
| Payment facilitation licensing | Platform calculates splits, runs transfer rounds, holds driver cash as a liability | Q-002 |
| ETDA platform notification | BANHAO is an intermediary connecting business users and consumers | Q-015 |
| PDPA — location, addresses, phone, delivery photos | Continuous rider GPS, saved addresses, proof-of-delivery photos | Q-012, BQ-004, BQ-018 |
| Rider worker classification | Algorithmic dispatch, accept timer, auto-suspension on cash limit | BQ-022 |
| Consumer protection / cash on delivery | **Deferred but not closed** — DEC-016 removed cash from Phase 1; OCPB "Dee-Delivery" applies again the day COD returns | Q-017 |
| **Merchant of record** | Explicitly **not accepted** by the 2026-08-10 lock | Q-002 |
| **Payment provider** | **NOT SELECTED.** Omise / 2C2P / Xendit / Stripe all unselected; no integration permitted | Q-001, DEC-015 |
| **Settlement legal structure · tax structure · regulatory classification** | Explicitly **not accepted** by the lock | Q-002, Q-015 |
| Tax, VAT, withholding | Commission revenue, merchant and rider payouts | Q-002 |
| Refund policy enforceability | Customer UI promises refund "ภายใน 1–3 วันทำการ" to the original PromptPay account, which Q-020 found is not natively possible | Q-020 |
| Stored value / wallet | Any wallet-credit refund workaround may itself be regulated e-money | Q-020, Q-002 |
