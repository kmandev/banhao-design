# BANHAO — Payment Lifecycle

How money enters the system, how it is confirmed, and how it comes back out.

Written 2026-08-10 (EVENT-013), locked to the approved decisions 2026-08-10
(EVENT-014). Companion: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) ·
[`ORDER_LIFECYCLE.md`](ORDER_LIFECYCLE.md) ·
[`SETTLEMENT_MODEL.md`](SETTLEMENT_MODEL.md) ·
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md)

**No payment provider is selected** (DEC-015, Q-001). Nothing here is an
integration design, and nothing here may be implemented yet.

## Status legend

`ACCEPTED` — approved by the Product Owner (`DEC-NNN`) or accepted product truth
· `PROPOSED` — awaiting approval · `OPEN` — undecided, do not guess ·
`LEGAL_REVIEW_REQUIRED` — no agent may conclude this is lawful.

---

## 0. The rules that cannot bend

| Rule | Source | Consequence |
|---|---|---|
| Only a **signature-verified provider webhook** may set `SUCCESS` or `REFUNDED` | `ACCEPTED` — CON-002 / DEC-003 | A client screen never decides that money arrived |
| Payment operations are **idempotent**; a duplicate cannot create duplicate financial value | `ACCEPTED` — **DEC-028** / REQ-003 | Keys: `order_id`, `payment_reference`, `idempotency_key` |
| Payment, Order, Delivery and Settlement are **four separate domains** | `ACCEPTED` — **DEC-018** / CON-001 | A cancelled order can still hold money until refunded |
| `REFUNDED` is a **payment** state, never an order outcome | `ACCEPTED` — **DEC-027** | `Order = CANCELLED` **and** `Payment = REFUNDED` |
| A duplicate payment **never increases an order's value** | `ACCEPTED` — **DEC-030** | ฿185 + ฿185 ≠ ฿370 |
| Provider access only through the **`PaymentProvider` abstraction** | `ACCEPTED` — DEC-015 | No SDK import outside `payments/providers/` |

The abstraction already exists in code
(`apps/api/src/modules/payments/payment-provider.interface.ts`) and
`NullPaymentProvider` throws on every call **by design** — so no money path can
appear to work untested. Do not "fix" it.

---

## 1. Phase 1 scope — online payment only

`ACCEPTED` — **DEC-016**.

| Method | Phase 1 | Note |
|---|---|---|
| **Online (PromptPay QR)** | **Enabled** — the only method | Provider not selected (Q-001) |
| **Cash on Delivery** | **Disabled** | Not removed from the model |
| Wallet / stored value | Excluded | Would raise an e-money question (Q-002) |
| Cards | Not in Phase 1 | — |

**COD must not be hard-coded as permanently unsupported.** `payment_method`
stays an extensible concept so COD can return without redesigning Order,
Payment, Delivery or Settlement. Concretely:

- `PaymentMethod` remains an open enum, not a boolean "is PromptPay".
- Payment states `CASH_PENDING` and `CASH_COLLECTED` stay in the model,
  unreachable in Phase 1.
- The cash money flow, the rider cash liability (DEC-004 / REQ-001) and the cash
  refund path stay documented and dormant.

⚠️ **Consequence the Product Owner should hold onto:** removing cash makes
**Q-001** (provider) and **Q-020** (PromptPay refund mechanism) *more* blocking,
not less. In Phase 1, 100% of revenue and 100% of refunds run through a rail
whose provider is unchosen and whose native refund capability research says does
not exist. There is no cash fallback for either.

✅ **Resolved.** The Customer App's cash option at checkout, its cash CTA
variant and the `เปลี่ยนเป็นเงินสด` fallback on payment failure have been
removed — the customer-facing surface is now online-only, matching this
section. The cash-prepared-amount selector no longer exists either. CASH
remains in the database CHECK constraint, in `create_order()`'s argument and
in the app's historical order rendering, exactly as this section requires.

---

## 2. Payment entities

`PROPOSED` shapes; the responsibilities are `ACCEPTED`.

| Entity | Purpose | Cardinality | Key rule |
|---|---|---|---|
| **`Payment`** | The payment intent for one order; holds the canonical payment state | 1 per order | Kept out of `Order` — DEC-018 |
| **`PaymentAttempt`** | One try at collecting: one QR, one expiry | many per payment | **A regenerated QR is a new attempt, not a new payment** — the reference is stable (DEC-028) |
| **`PaymentMethod`** | Extensible enum; Phase 1 allows online only | enum | DEC-016 |
| **`PaymentTransaction`** | A movement the provider reports | many per attempt | Immutable |
| **`PaymentWebhookEvent`** | Raw inbound callback + verification result | many per payment | **The idempotency anchor.** Persist *before* processing |
| **`Refund`** | A refund request against a payment | many per payment | Own state machine — DEC-027 |
| **`RefundTransaction`** | A movement executed for a refund | many per refund | Immutable |

`PaymentAttempt` exists separately because the design requires the QR to be
regenerable (`สร้าง QR ใหม่`) while the order and the payment reference survive
(*"Payment = EXPIRED แต่ Order ยังอยู่ ไม่สร้างออเดอร์ใหม่"*). Without attempts,
either the reference changes — breaking DEC-028 — or expiry history is lost.
Attempts are also what make **DEC-029** (late payment) answerable: a late
transfer must resolve to *which attempt*, not just which order.

---

## 3. Payment state machine

`ACCEPTED` — the five core states named in the decision lock are **`PENDING`,
`SUCCESS`, `FAILED`, `EXPIRED`, `REFUNDED`**. The remaining states from the
2026-08-09 design canvas are retained and marked below.

| Payment state | Status | Paired Order state (DEC-019 names) | Changed by |
|---|---|---|---|
| `CREATED` | retained | `CREATED` / `PENDING_PAYMENT` | System |
| **`PENDING`** | **`ACCEPTED`** | `PENDING_PAYMENT` | Waiting on the user |
| `PROCESSING` | retained | `PENDING_PAYMENT` | Provider |
| **`SUCCESS`** | **`ACCEPTED`** | `PAID` … `DELIVERED` | **Webhook only** (CON-002) |
| **`FAILED`** | **`ACCEPTED`** | `PENDING_PAYMENT` | Provider |
| **`EXPIRED`** | **`ACCEPTED`** | `PENDING_PAYMENT` | System (10 min) |
| `CANCELLED` | retained | `CANCELLED` | Customer / System |
| `REFUND_PENDING` | retained | `CANCELLED` | System / Operator |
| `REFUND_PROCESSING` | retained | `CANCELLED` | Provider |
| **`REFUNDED`** | **`ACCEPTED`** | `CANCELLED` | **Webhook only** (CON-002) |
| `CASH_PENDING` | **dormant** — DEC-016 | — | — |
| `CASH_COLLECTED` | **dormant** — DEC-016 | — | — |

**BQ-012 is resolved.** `PENDING_PAYMENT` is now a real Order state (DEC-019),
so the pairing column above no longer references a state that does not exist.

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> PENDING : QR issued
    PENDING --> PROCESSING : customer reports paid / provider signals
    PENDING --> EXPIRED : 10 minutes elapse
    PENDING --> CANCELLED : customer abandons
    PROCESSING --> SUCCESS : verified webhook
    PROCESSING --> FAILED : provider reports failure
    FAILED --> PENDING : retry — new attempt
    EXPIRED --> PENDING : new QR — new attempt
    SUCCESS --> REFUND_PENDING : refund requested (DEC-027)
    REFUND_PENDING --> REFUND_PROCESSING : sent to the provider
    REFUND_PROCESSING --> REFUNDED : verified webhook
    SUCCESS --> [*]
    REFUNDED --> [*]
    CANCELLED --> [*]
```

**`SUCCESS` and `REFUNDED` have exactly one inbound edge each, and both come
from a verified webhook.** A code path reaching either state any other way is a
bug (CON-002).

---

## 4. Money flows in Phase 1

`ACCEPTED` — the online flows. The cash flows are retained and dormant
(DEC-016).

| Flow | Path | Phase 1 |
|---|---|---|
| **Online payment** | cart → confirm → create Payment → issue QR → wait → **bank confirms** → `PAID` → order sent to the merchant | **Active** |
| **Refund** | order cancelled → refund request → provider → processing → **bank confirms** → refunded | Active in principle; **mechanism `OPEN` (Q-020)** |
| **Merchant payout** | order `DELIVERED` → payable accrues → transfer round → transferred | Active — DEC-026, not implemented |
| **Rider payout** | delivered → earning recorded → transfer round → transferred | Active — DEC-026, not implemented |
| ~~Cash collection~~ | rider collects, confirms, remits | **Dormant — DEC-016** |
| ~~Cash refund~~ | before/after collection split | **Dormant — DEC-016** |

Two rules that survive from the original design and must not be lost: the
platform **never announces a refund succeeded until the bank confirms it**
(*"ไม่ประกาศว่าคืนสำเร็จจนกว่าธนาคารยืนยัน"*), and money is never assumed from
client state.

---

## 5. Webhook processing

`ACCEPTED` sequence — *"ผู้ให้บริการยิงเข้ามา → ตรวจลายเซ็น → ตรวจยอดและ order →
อัปเดต Payment → อัปเดต Order → บันทึก Ledger → แจ้งลูกค้า"*.

```mermaid
sequenceDiagram
    participant P as Payment provider
    participant API as BANHAO API
    participant DB as PostgreSQL
    participant C as Customer

    P->>API: POST webhook (raw body + signature)
    API->>DB: persist PaymentWebhookEvent (raw, unprocessed)
    API->>API: verify signature — reject on failure, touch nothing
    API->>DB: look up payment by reference
    API->>API: verify amount and order match
    alt already processed (DEC-028)
        API->>P: 200 OK — read back the existing result
    else new event
        API->>DB: BEGIN
        API->>DB: Payment → SUCCESS
        API->>DB: Order → PAID
        API->>DB: append ledger entries (must sum to zero)
        API->>DB: COMMIT
        API->>C: notify
        API->>P: 200 OK
    end
```

Non-negotiable properties:

1. **Persist the raw event before processing.** An unverifiable event is still
   evidence.
2. **A failed signature changes nothing** — not the payment, not the order, not
   the ledger.
3. **Amount and order must both match** before anything is written. A valid
   signature on the wrong amount is a reconciliation case, not a success.
4. **One transaction** covers Payment + Order + Ledger — the reason DEC-009
   chose a monolith.
5. **Return 200 for a duplicate**, or the provider retries forever.
6. **Never log a secret, token or full account number.** The design already
   holds this line: *"แสดงเฉพาะเลขอ้างอิงบางส่วน"*.

---

## 6. Idempotency

`ACCEPTED` — **DEC-028** / REQ-003. Required concepts: `order_id`,
`payment_reference`, `idempotency_key`.

| Operation | Idempotency key | Duplicate behaviour |
|---|---|---|
| Create payment | The order's `payment_reference` (e.g. `PAY-BH000125`) | Return the existing payment; **never create a second** |
| Issue QR | `payment_reference` + attempt number | Return the live attempt if unexpired |
| Webhook delivery | Provider event id + `payment_reference` | Read back the stored result, return 200 |
| Refund request | Refund reference | Return the existing refund |
| Ledger write | Entry-group key | Unique constraint; a second insert **fails loudly**, never silently |

The shipped `PaymentProvider` interface already carries an explicit
`idempotencyKey` on every operation, so DEC-028 is satisfied at the type level
before any provider exists.

---

## 7. Duplicate and late payment

### Duplicate payment

`ACCEPTED` — **DEC-030**. If an order expects ฿185 and two ฿185 payments
succeed, the order does **not** become ฿370. The order's value is authoritative
and immutable at creation; received transactions are matched against it, and a
surplus becomes a **refund obligation**, not order value.

The Customer App already promises this on screen 12f:
*"ระบบจะไม่เรียกเก็บซ้ำ ถ้าคุณโอนไปสองครั้ง ทีมงานจะคืนให้อัตโนมัติ"*.
🚨 **The promise exists ahead of the mechanism** — automatic return depends on
Q-020.

### Late payment

`ACCEPTED` as a technical requirement — **DEC-029**. A payment that succeeds
after the order or attempt has timed out must be resolvable:

| The system must determine | How |
|---|---|
| Which order? | `payment_reference` resolves to an order for as long as the order exists |
| Which payment attempt? | Attempts retain identity after expiry (§ 2) |
| Current order state? | Read from the order domain (DEC-018) |
| Accept, refund, or manual review? | **`OPEN` — the business policy is not decided** |

`PROPOSED` handling until the policy lands: surface late payments as a **distinct
reconciliation category**, never as a generic mismatch, and never auto-apply
them to an order that has already been cancelled and refunded.

---

## 8. Refunds

`ACCEPTED` — **DEC-027**: refund lives in the payment domain.
`Order = CANCELLED`, `Payment = REFUNDED`. Never a `REFUNDED` order status.

```mermaid
stateDiagram-v2
    [*] --> REFUND_REQUESTED : cancellation / duplicate / dispute
    REFUND_REQUESTED --> REFUND_PENDING : approved (auto or operator)
    REFUND_REQUESTED --> REFUND_REJECTED : not eligible ⬦
    REFUND_PENDING --> REFUND_PROCESSING : sent to the provider
    REFUND_PROCESSING --> REFUNDED : verified webhook
    REFUND_PROCESSING --> REFUND_FAILED : provider rejects ⬦
    REFUND_FAILED --> REFUND_PENDING : retry or switch to a manual mechanism ⬦
    REFUNDED --> [*]
    REFUND_REJECTED --> [*]
```

⬦ = `PROPOSED`. `REFUND_FAILED` is not optional in practice: with no native
PromptPay refund, failure is the *expected* path until Q-020 is resolved.

Four movements a refund must keep separate — see
[`SETTLEMENT_MODEL.md`](SETTLEMENT_MODEL.md): the **payment refund**, the
**merchant settlement reversal**, **rider compensation** (normally *not* clawed
back — the rider did the work), and the **platform fee reversal**.

| Trigger | Amount | Status |
|---|---|---|
| Customer cancels before `PREPARING` | Full | `ACCEPTED` |
| Customer cancels during `PREPARING` (merchant confirms) | Full | `ACCEPTED` |
| Merchant rejects or times out | Full | `ACCEPTED` |
| Operator cancels for no rider (DEC-022) | Full to the customer | `ACCEPTED`; **who absorbs the food cost is `OPEN` — BQ-015** |
| Payment failed / expired | Nothing was taken | `ACCEPTED` |
| Duplicate transfer | The duplicate | `ACCEPTED` (DEC-030); mechanism `OPEN` |
| Missing or wrong item | Partial | `OPEN` — BQ-031 |
| Delivery failed | — | `OPEN` — BQ-015, BQ-017 |
| Quality complaint after delivery | — | `OPEN` — Q-003, BQ-016 |

### 🚨 The refund mechanism is still open — Q-020

The Customer App tells customers *"เงินจะเข้าบัญชีเดิมที่ใช้จ่าย ภายใน
1–3 วันทำการ"* and states the method as `คืนเข้าพร้อมเพย์เดิม`. Research found
**no examined provider supports native PromptPay refunds** — Omise states
PromptPay charges cannot be voided or refunded, Beam excludes the method,
Xendit marks it unsupported, Stripe only by emailing the customer for a bank
account. **This is a property of the rail, not a provider quirk.**

| Candidate mechanism | Problem |
|---|---|
| Wallet / store credit | May itself be regulated e-money (Q-002); the launch strategy already rejected an in-app wallet |
| Manual bank transfer | Collects bank details — new PDPA surface; manual labour per refund |
| Cash refund via rider | **No longer available in Phase 1** — DEC-016 removed cash entirely |
| Narrow the cancellation window | Reduces frequency; does not remove merchant rejection or no-rider cases |

Note that DEC-016 **deleted one of the four candidates**. Until Q-020 is
answered, the app's refund copy is a promise the platform cannot keep — a
consumer-protection exposure (Q-017), not only an engineering gap.

---

## 9. Reconciliation

`ACCEPTED`. The operator's morning screen is a reconciliation view, not a
revenue chart. With COD disabled the first identity simplifies:

```
Phase 1:  online received                                        = total sales
          merchant payouts + rider payouts + platform revenue + refunds
                                                                 = total sales
```

(The `+ cash held by riders` term returns with COD.)

Documented per-payment statuses: `ตรงกัน` (matched), `รอยืนยัน` (awaiting — e.g.
no webhook yet, 10-minute grace), `ไม่ตรง` (mismatched). Mismatches are resolved
by manual matching or by refunding the customer — an operator capability under
DEC-032.

`PROPOSED`: reconcile against the **provider's settlement report** on a
schedule, not only against inbound webhooks — a webhook that never arrived is
exactly what this catches. Late payments (DEC-029) get their own queue.

---

## 10. Chargebacks

`OPEN` — Q-011. Not mentioned anywhere in the design. A customer disputing with
their bank can pull money back **after** merchant and rider have been paid.

PromptPay is a push-based bank transfer rather than a card rail, so a card-style
chargeback may not apply in the same form — but that depends on the provider
(Q-001) and the legal model (Q-002). Do not assume the risk is zero.

---

## 11. What must not be built yet

| Not now | Why |
|---|---|
| Any provider SDK integration | Q-001 `OPEN`, DEC-015 |
| Anything setting `SUCCESS` outside a verified webhook | CON-002 |
| A refund implementation | Q-020 — the mechanism does not exist yet |
| A wallet or stored-value balance | Excluded; possible e-money exposure (Q-002) |
| Cash payment paths | **DEC-016** — disabled in Phase 1 |
| Replacing `NullPaymentProvider` with a stub returning success | It throws deliberately |

What **can** be designed once the domain model is accepted, without prejudging
Q-001: the payment, attempt, transaction, webhook-event and refund structures;
idempotency keys and unique constraints (DEC-028); the state machine and its
guards; the ledger; and the reconciliation process. That is where the
correctness risk actually lives, and none of it depends on which provider wins.

**Still no implementation in this step** — no schema, no migration, no module.

---

## 12. Open questions owned by this document

**Resolved by this lock:** BQ-012 (`PENDING_PAYMENT` — DEC-019) · the
idempotency requirement (DEC-028) · duplicate-payment semantics (DEC-030) ·
refund/order separation (DEC-027) · Phase 1 payment scope (DEC-016).

**Still `OPEN` — and P0:** Q-001 (provider) · Q-002 (legal model,
`LEGAL_REVIEW_REQUIRED`) · Q-020 (PromptPay refund mechanism) · BQ-027 (service
fee refundability).
**Still `OPEN` — P1:** Q-011 (chargebacks) · BQ-031 (partial refund
composition) · Q-003 / BQ-016 (refund policy) · the late-payment business
handling under DEC-029.

**Design question closed by this document:** DQ-02 — screen 12f's trigger is the
documented duplicate-payment case, now formalised by DEC-030.
