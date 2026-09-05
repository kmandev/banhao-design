# BANHAO — Settlement Model

Who gets paid what, when, and how the books stay balanced.

Written 2026-08-10 (EVENT-013), locked to the approved decisions 2026-08-10
(EVENT-014). Companion: [`BUSINESS_RULES.md`](BUSINESS_RULES.md) ·
[`PAYMENT_LIFECYCLE.md`](PAYMENT_LIFECYCLE.md) ·
[`RIDER_LIFECYCLE.md`](RIDER_LIFECYCLE.md) ·
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md)

All amounts are integer **satang** (CON-003) — `฿130` is `13000`.

## Status legend

`ACCEPTED` — approved by the Product Owner (`DEC-NNN`) or accepted product truth
· `PROPOSED` — awaiting approval · `OPEN` — undecided, do not guess ·
`LEGAL_REVIEW_REQUIRED` — no agent may conclude this is lawful.

> **IMPLEMENTATION: NOT STARTED, and blocked.** DEC-026 accepts settlement as a
> domain; it explicitly does not authorise building it. Every number in the
> model was `OPEN` (DEC-023, DEC-024, DEC-025) — **as of 2026-09-05 all three
> are numerically resolved** (delivery **DEC-035**, service fee **DEC-036**,
> commission **DEC-043** — 8% of food subtotal, round to whole baht). **This
> does not itself authorise building the ledger.** DEC-026's authorisation gap
> is unchanged, no ledger-posting code has been written, and this is a
> documentation lock only — see DEC-043's own Consequences clause.

---

## 0. The invariant

`ACCEPTED` — CON-003:

> **Every order's ledger balances to exactly zero.**
> *"ทุกออเดอร์ต้องกระทบยอดเป็นศูนย์ … ห้ามมีเศษหายไปในระบบ"*

Related accepted rules: **DEC-014** — PostgreSQL is the sole system of record;
Realtime, caches and app state are projections, never financial truth.
**DEC-018** — Settlement is one of four separate state domains.
**DEC-026** — Settlement is its own financial domain, reading the ledger rather
than the order table.

---

## 1. Money flow

`ACCEPTED` — **DEC-026**, with the Phase 1 scope set by **DEC-016**.

```mermaid
flowchart TD
    C[Customer]
    P[Payment provider<br/>NOT SELECTED — Q-001]
    B[(BANHAO financial records<br/>ledger — system of record)]
    M[Merchant settlement]
    R[Rider settlement]
    F[BANHAO revenue]

    C -->|online payment| P
    P -->|settles| B
    B -->|transfer round| M
    B -->|transfer round| R
    B --> F
```

**Phase 1 has one money path.** Cash on Delivery is disabled (DEC-016), so the
rider-held-cash path — and with it the netting, the remittance and the
cash-limit dispatch block — is dormant. It is documented in § 4 for the phase
that reintroduces COD, and must not be implemented now.

⚖️ `LEGAL_REVIEW_REQUIRED` — whether BANHAO calculating splits, running transfer
rounds and (later) holding rider cash constitutes regulated **payment
facilitation** under the Payment Systems Act is **Q-002**, the single most
important compliance question in the project. Merchant of record, settlement
legal structure, tax structure and regulatory classification all remain `OPEN`.

---

## 2. The three approved fee relationships

`ACCEPTED — MODEL`. Direction of money is decided for all three; **the
customer-facing amounts and the commission rate are now all approved** — only
the rider's side of the delivery fee remains open.

| Flow | Decision | Model | Numbers |
|---|---|---|---|
| `Customer → delivery fee → rider earning` | **DEC-023** | `ACCEPTED` | Customer side **`ACCEPTED`** — flat ฿10 / 1000 satang (**DEC-035**). Rider side **`ACCEPTED`** — flat ฿12 / 1200 satang per completed delivery (**DEC-044**, resolving BQ-029) |
| `Customer → service fee → BANHAO` | **DEC-024** | `ACCEPTED` | **`ACCEPTED`** — fixed ฿5 / 500 satang (**DEC-036**) |
| `Merchant → commission → BANHAO` | **DEC-025** | `ACCEPTED` | **`ACCEPTED`** — 8% of the food subtotal, rounded to whole baht (**DEC-043**) |

> **No agent may invent a price.** The design's `฿15` delivery, `฿5` service,
> `฿10` coupon and `10%` commission are illustrative samples — the payment
> canvas says so about itself. DEC-025 states explicitly that the 10% example
> must not become a business rule by default, and **DEC-043 confirms the
> approved commission rate is 8%, not 10% — the two are not the same number
> and the old sample is not retroactively relabelled.** `apps/customer/src/mocks/pricing.ts`
> labels its constants `SAMPLE_*` for the same reason; do not copy them into
> backend code.

---

## 3. Ledger accounts

`PROPOSED` names; the concepts are `ACCEPTED`.

| Account | Meaning | Phase 1 |
|---|---|---|
| `CUSTOMER_PAYMENT` | Money received from a customer online | Active — posting design **locked** (§ 3.1, 2026-09-05); posting itself **not implemented** |
| `MERCHANT_PAYABLE` | What the platform owes a merchant | Active |
| `RIDER_PAYABLE` | What the platform owes a rider for delivery work | Active |
| `PLATFORM_REVENUE` | Commission + service fee + delivery margin | Active |
| `PROMOTION_FUNDING` | Whoever funds a discount | Active — funder model **resolved** (DEC-046: per-promotion, `PLATFORM` or `MERCHANT`, no split); posting **not implemented**. Stacking still `OPEN` (BQ-030) |
| `REFUND_PAYABLE` | Money owed back to a customer | Active — mechanism `OPEN` (Q-020) |
| `RIDER_COMPENSATION` | Paid to a rider for a job lost through no fault of theirs | Active — amount `OPEN` (BQ-024) |
| `PLATFORM_WRITE_OFF` | Cost the platform absorbs — food wasted on an operator cancellation (policy still `OPEN`, BQ-015), and, **as of DEC-045**, the ฿2 delivery-side funding gap per completed delivery | Active — BQ-015 half `OPEN`; delivery-gap half `ACCEPTED` (DEC-045) **and implemented** (`b813b5c6`) as part of the rider-earning completion ledger flow. This does not mean full settlement/payout or a `CUSTOMER_PAYMENT` ledger is implemented — those remain outside DEC-045's scope |
| `RIDER_CASH_HELD` | Cash a rider holds on the platform's behalf | **Dormant — DEC-016** |

Rules, `ACCEPTED` via DEC-014 / CON-003 / DEC-028:

1. **Append-only.** Never update, never delete. Correct with a reversing entry.
2. **One transaction.** Ledger entries are written in the same database
   transaction as the Payment and Order changes that caused them.
3. **Grouped and keyed.** Every group carries an idempotency key, so a duplicate
   webhook cannot write it twice.
4. **Integer satang.** No floats anywhere in the path.

### 3.1 CUSTOMER_PAYMENT posting design — locked 2026-09-05

**Architecture design, not a business decision.** Every fact this design relies
on is already `ACCEPTED` (CON-003, DEC-014, DEC-023/024/025, DEC-028, DEC-034,
DEC-035/036, DEC-043/044/045). No new DEC number was raised for it, matching
this repository's own precedent: the `MERCHANT_COMMISSION` group's shape
(`payment-event-processing.service.ts`, `postCommissionLedger`) and the
`RIDER_EARNING` group's shape (`delivery-completion.service.ts`,
`insertRiderEarningEntry`) were likewise never given their own `DEC-`, only
implemented under the business decisions that authorized their accounts and
amounts (DEC-043 and DEC-044/045 respectively). This design does the same for
`CUSTOMER_PAYMENT`. **Not yet implemented** — see `docs/CURRENT_STATUS.md`.

**Model: Hybrid payment-funding group (Model C).** `CUSTOMER_PAYMENT` posts
into its own ledger group, independent of the existing `MERCHANT_COMMISSION`
and `RIDER_EARNING` groups, linked to them only by the shared `order_id`
column — exactly the relationship those two groups already have to each
other. This is the only model that fits the current append-only,
insert-once-per-event architecture: `ledger_entry_groups.group_key` anchors
one deterministic economic event, and payment success, commission
recognition, and delivery completion are three genuinely separate events,
firing from two different services at two different times. A single
full-order group (funding the customer payment and every downstream
allocation in one group) would require inserting into that group again after
delivery completes — but idempotency for a *later* insert on an *existing*
group has no established pattern here (`group_key` uniqueness authorizes
creating a group, not extending one), and would collapse two independent,
already-idempotent event anchors into one, coupling the payment-processing
tick to a delivery event it has no other reason to know about. Model A alone
(posting `CUSTOMER_PAYMENT` with nothing else ever added) is a strict subset
of Model C and is not distinguished from it here; Model C is simply Model A's
entry considered alongside the sub-ledgers that already exist.

**Anchor / economic finality:** `payments → SUCCESS` and the guarded
`orders PENDING_PAYMENT → PAID` transition, together — the same instant
`postCommissionLedger` already anchors to. `CUSTOMER_PAYMENT` posts from
inside `completeSuccessSideEffects`, alongside `postCommissionLedger`, on
both places it already runs today: the fresh-transition branch and the
already-PAID self-heal branch. It must **not** post for `SURPLUS_PAYMENT` or
`LATE_PAYMENT` — the same scope boundary `postCommissionLedger`'s own
class-level doc comment already states for commission, for the same reason: a
payment that never (or no longer) genuinely settles this order should not
fund this order's ledger.

**Entry:**
```
CUSTOMER_PAYMENT  +payment.amount_satang   party_type: CUSTOMER, party_id: orders.customer_id
```
One row, one group, one insert. `payment.amount_satang` is already established
equal to `orders.grand_total_satang` at payment creation
(`payments.service.ts`, `initializePayment`) and is immutable afterwards
(`payments_enforce_immutable_columns`) — no new read or calculation is needed;
the value the ledger posting code already holds in memory (`payment.amount_satang`,
the same `PaymentRow` `postCommissionLedger` receives) is the correct amount.
It represents the customer's total charge — subtotal + delivery fee + service
fee − discount, per `orders_total_check` — not any single component; delivery
fee and service fee are *funded* by this one entry without a separate
`DELIVERY_FEE_REVENUE`/`SERVICE_FEE_REVENUE` account, exactly as the existing
`RIDER_PAYABLE`/`PLATFORM_WRITE_OFF` group already funds delivery **without**
one — component-level revenue recognition (e.g. `PLATFORM_REVENUE` for the
service fee) remains a distinct, separately-unimplemented gap this design does
not close (see Consequences below).

**Sign:** positive, following the existing convention where a party-neutral
"money enters the system" entry is positive (`PLATFORM_REVENUE +commission`,
`PLATFORM_WRITE_OFF +200`) and an obligation the platform owes is negative
(`MERCHANT_PAYABLE -commission`, `RIDER_PAYABLE -1200`). `CUSTOMER_PAYMENT` is
money entering, not an obligation, so it is positive.

**Party:** `party_type: 'CUSTOMER'`, `party_id: orders.customer_id` — already
read on the winning-transition branch (`transitionedOrder.customer_id`,
`completeSuccessSideEffects`) and cheaply re-readable on the self-heal branch
exactly the way `postCommissionLedger` already does its own independent
`orders` read rather than depend on the caller's partial `select`.

**Group key:** `payment:<paymentId>:<providerTransactionId>` — the same
`payment_transactions.provider_transaction_id` event identity `commission:…`
already uses for DEC-030, and the literal shape the schema's own authoring
comment anticipated (`ledger_entry_groups.group_key`,
`20260811000007_ledger_domain.sql`: `"payment:PAY-BH000125:txn:<providerTxnId>"`).
Reusing this identity, rather than inventing a new one, means a duplicate
webhook or a retried partially-completed event can never post the group
twice, for exactly the reason `commission:…` already can't.

**Idempotency / crash / concurrency:** identical pattern to
`postCommissionLedger`/`ensureCommissionEntriesRecorded` — attempt the
`ledger_entry_groups` insert; on a unique-constraint conflict, re-read the
existing group by `group_key`, check whether its `ledger_entries` row already
exists, and insert the single `CUSTOMER_PAYMENT` row only if missing. First
success: fresh insert, one entry written. Duplicate webhook / repeated event
processing / already-PAID self-heal: group insert conflicts, entry already
present, no-op. Crash after payment SUCCESS but before this entry posts: the
next tick's retry re-enters `completeSuccessSideEffects`, the group insert
conflicts (already created by the crashed run) or succeeds (if the crash was
before the group insert), and the missing entry is filled in exactly the way
`ensureCommissionEntriesRecorded` already fills in a missing commission entry
today. Concurrent processing: `ledger_entry_groups_group_key_key` is the sole
concurrency authority — exactly one caller's insert wins, per DEC-028.

**Atomicity:** a single `ledger_entries` row is sufficient — there is nothing
to keep in sync within the entry itself. No new database transaction or RPC is
needed; the existing pattern (sequential guarded inserts, each independently
safe to retry) already gives this the same correctness the commission and
rider-earning postings already have, without wrapping multiple statements in
an explicit transaction.

**Zero-sum:** the `CUSTOMER_PAYMENT` group is **not** required to sum to zero
on its own, and must not be forced to. It is a single-entry group by design —
matching the rider-earning group's own precedent, which DEC-045 explicitly
left with a `-1000` residual specifically *because* it does not contain
`CUSTOMER_PAYMENT`. Symmetrically, the `CUSTOMER_PAYMENT` group does not
contain the commission or rider-earning entries either. DEC-034's zero-sum
invariant is a property of the **order as a whole** — commission group nets
to zero internally by coincidence of its own two-party design, `CUSTOMER_PAYMENT`
nets to +grand_total alone, and rider-earning nets to -1000 alone; a correct
reconciliation sums all of an order's groups together, not any single group
in isolation. Today, without this entry, an order's ledger groups net to
`-1000` (rider-earning's own residual) with no `+grand_total` to offset it
anywhere; posting `CUSTOMER_PAYMENT` is what eventually lets a full-order
reconciliation balance, once `PLATFORM_REVENUE` also picks up the service fee
(a distinct, separately-unimplemented gap — see Consequences).

**Interaction with commission:** unchanged and untouched. `CUSTOMER_PAYMENT
+grand_total` and `MERCHANT_PAYABLE -commission / PLATFORM_REVENUE +commission`
remain two independent groups, as they are today for `RIDER_PAYABLE`/
`PLATFORM_WRITE_OFF`. `CUSTOMER_PAYMENT` does not fund commission specifically
— it is the platform's total inbound funding for the order; commission is one
of several claims against that funding, alongside the merchant's food payable,
the rider's earning, and the platform's own fee revenue, none of which this
design changes.

**Interaction with rider earning / write-off:** same relationship as
commission's — independent groups, joined only by shared `order_id`.
`CUSTOMER_PAYMENT`'s +1000-satang delivery-fee component is part of what
(eventually, once reconciled at the order level) offsets `RIDER_PAYABLE`'s
-1200 and `PLATFORM_WRITE_OFF`'s +200; this design does not change DEC-044 or
DEC-045, and does not modify `delivery-completion.service.ts`.

**DEC-046 / discounts:** `discount_satang` is always `0` in every real order
today (§6 of the prior BQ-030 prep recon), so `payment.amount_satang` already
equals `orders.grand_total_satang` with a zero discount baked in — this design
can be implemented today, independently of the promotion engine, with no
special-casing. When a non-zero discount eventually exists, `CUSTOMER_PAYMENT`
still posts the same way (`+payment.amount_satang`, which by
`orders_total_check` already nets the discount out of `grand_total_satang`) —
nothing about the `CUSTOMER_PAYMENT` entry itself changes. What a promotion
engine will need to add later is a **separate** `PROMOTION_FUNDING` entry
(`-discount`, party `PLATFORM` or `MERCHANT` per DEC-046's funder, no split)
in its own group, so that `CUSTOMER_PAYMENT` (the full amount actually
charged) and `PROMOTION_FUNDING` (who is out the discount) stay distinct
facts. This design neither builds nor blocks that; DEC-046's funder model and
BQ-030's open stacking question are both untouched.

**Refunds:** not designed here. No contradiction: a future `REFUND_PAYABLE`
entry is a **reversing** entry in a **new** group (per this document's own
append-only rule), never a mutation of the `CUSTOMER_PAYMENT` row it offsets —
consistent with how every other account here is already treated. BQ-027
(service-fee refundability) and BQ-031 (partial refund composition) remain
exactly as open as before this design.

**Settlement:** this design is a **prerequisite** for future reconciliation
— it gives "money actually received" a ledger row for the first time — but
does not itself enable settlement/payout. A settlement engine still needs the
deferred `settlements`/`settlement_items` tables (`docs/DATABASE_DESIGN.md`),
a gross-merchant-payable computation (not just the commission deduction that
exists today), and the still-open BQ-032/BQ-034. None of that is built or
authorized by this design.

**Reconciliation:** `payment_transactions.amount_satang` (DEC-030's
money-movement record) and `CUSTOMER_PAYMENT.amount_satang` will always be
equal by construction, since both are populated from the same in-memory
`payment.amount_satang` value in the same request. They remain two distinct
facts serving two distinct purposes: `payment_transactions` proves a specific
provider transaction was durably received (the payment domain's own record,
keyed by `provider_transaction_id`); `CUSTOMER_PAYMENT` is the accounting
ledger's claim that this money is now available to fund the order's
downstream obligations (the ledger domain's record, keyed by `group_key`).
Future reconciliation should compare them as two independent sources that
ought to agree — proving `CUSTOMER_PAYMENT` from `payment_transactions`,
never treating `payment_transactions` as the ledger itself.

**Historical immutability:** yes — `ledger_entries` already forbids UPDATE and
DELETE for every role (`reject_mutation` trigger), unconditionally. A
`CUSTOMER_PAYMENT` row is exactly as immutable as every other ledger entry;
this design introduces no exception.

**Existing schema:** **no migration required.** `CUSTOMER_PAYMENT` already
exists in the `ledger_entries.account` CHECK
(`20260811000007_ledger_domain.sql`), `party_type` already allows
`'CUSTOMER'`, `amount_satang` is already a signed `bigint` with no sign CHECK,
and `ledger_entry_groups.group_key` already provides the idempotency this
design relies on. Every column and constraint this design needs is already
live.

**No new module:** this design does not introduce a finance/ledger module.
The smallest change consistent with existing conventions is one new private
method inside `PaymentEventProcessingService` (alongside
`postCommissionLedger`), called from the same two call sites, following the
same insert-then-self-heal shape already proven there — not a new service,
controller, or module.

### 4.1 Online order — the Phase 1 path

Figures from the design's own ledger for order `BH000125`, rebuilt in satang.
**Illustrative arithmetic, not approved pricing** (DEC-023/024/025).

**What the customer paid**

| Component | Satang | ฿ |
|---|---:|---:|
| Food subtotal | 12 000 | 120 |
| Delivery fee | 1 500 | 15 |
| Service fee | 500 | 5 |
| Discount `BANHAO7` | −1 000 | −10 |
| **Total charged** | **13 000** | **130** |

**How it distributes**

| Ledger line | Satang | ฿ |
|---|---:|---:|
| `CUSTOMER_PAYMENT` (in) | +13 000 | +130 |
| `MERCHANT_PAYABLE` — food less 10% commission | −10 800 | −108 |
| `RIDER_PAYABLE` | −1 200 | −12 |
| `PLATFORM_REVENUE` | −1 000 | −10 |
| **Remaining** | **0** | **฿0** ✓ |

**Where the platform's ฿10 comes from** — derived, not stated by the design:

```
  commission on food      +1 200      (10% of 12 000 — a sample, DEC-025)
+ delivery fee collected  +1 500
+ service fee             +  500
− paid to the rider       −1 200
− discount absorbed       −1 000
= platform revenue         1 000
```

Three unit-economics findings the Product Owner should carry into the pricing
decisions. **None is settled by this lock:**

1. **The platform funds the discount.** The merchant is paid commission on the
   full ฿120 menu price, not the discounted total. As of **DEC-046** (2026-09-05)
   this is now a recognized valid Phase 1 shape — a `PLATFORM`-funded
   promotion — rather than an unexamined default; whether *this specific*
   `BANHAO7` sample would be tagged `PLATFORM` or `MERCHANT` is a promotion-
   definition detail, not decided by this worked example.
2. **Delivery does not pay for itself.** ฿10 of net delivery-side revenue
   against ฿12 paid to the rider; commission covers the gap. DEC-023 fixes the
   *direction* of the money, not that it balances. **DEC-035 has since set the
   Phase 1 delivery fee at exactly this ฿10**, so the gap this worked example
   describes is now the approved position rather than a sample.
   **Resolved 2026-09-05 by DEC-044: the rider side is also now locked, at
   exactly this ฿12** (flat, per completed delivery) — so the ฿2-per-delivery
   gap between the two is the actual Phase 1 position, not a sample.
   **Resolved 2026-09-05 by DEC-045: BANHAO intentionally absorbs this ฿2
   (200 satang) as a platform delivery write-off (`PLATFORM_WRITE_OFF`),
   independent of commission or service fee.** Commission does not fund the
   gap — that reading of this example was never locked as a rule, and
   DEC-045 explicitly declines it.
3. **10% is internally consistent** across every sample (120→12, 180→18,
   260→26, 95→10, 75→8) and stated outright as `10% ของยอดอาหาร`. **DEC-025
   explicitly refuses to let that become the rate by default** → Q-010, BQ-028.
   **Resolved 2026-09-05 by DEC-043: the approved Phase 1 rate is 8% of the
   food subtotal, round to whole baht — not 10%.** This worked example's own
   arithmetic is left as originally published, at the design's illustrative
   10%, and is not recomputed at 8% here.

### 4.2 Cash order — dormant, retained for the COD phase

**Not applicable in Phase 1 (DEC-016).** Kept because the model must remain
extensible and because the open question inside it does not go away.

| Ledger line | Satang | ฿ |
|---|---:|---:|
| `RIDER_CASH_HELD` — rider collects from the customer | +13 000 | +130 |
| Merchant received cash **at the counter** | −10 800 | −108 |
| Rider earning, retained from the cash held | −1 200 | −12 |
| Rider must remit to BANHAO | −1 000 | −10 |
| **Remaining** | **0** | **฿0** ✓ |

🚩 **BQ-023 is deferred, not answered.** This model has the rider paying the
merchant ฿108 **at pickup**, before collecting anything — a working-capital
requirement on the scarcest resource in the system. It returns unchanged the day
COD is switched back on. **Decide it before then, not during.**

---

## 5. Commission models

`ACCEPTED` — **DEC-025** fixes the direction (`Merchant → commission → BANHAO`).
**RESOLVED 2026-09-05 — DEC-043: the model shape and the rate are both now
approved as Percentage of food subtotal, 8%, rounded to whole baht.** The
comparison below is retained as the record of how that decision was reached —
read it as history and rationale, not as an open question.

| Model | Merchant friendliness | BANHAO revenue | Operational simplicity | Tax / accounting |
|---|---|---|---|---|
| **Percentage of food subtotal** — **approved, DEC-043, at 8%** | Familiar; scales with the merchant's own take | Scales with GMV; low on small orders | **Simplest** — one number per merchant | Straightforward service revenue |
| **Fixed fee per order** — not chosen | Punishing on cheap orders — and ส้มตำ orders *are* cheap | Predictable; poor upside on large orders | Simple | Straightforward |
| **Hybrid** (small % + small fixed) — not chosen | Harder to explain | Covers per-order cost, keeps upside | Medium | Straightforward |
| **Monthly subscription** — not chosen | Good for high-volume shops, hostile to occasional ones | Predictable but capped | Adds billing, dunning, suspension | Recurring-revenue accounting |

The two things this table used to leave implicit are now stated, by DEC-043:

- **The base — food subtotal only** (the design's answer, and the
  merchant-friendly one). The whole-order-including-fees alternative was
  considered and not chosen.
- **The rounding rule — whole baht**, matching the samples (95→10, 75→8) and
  CON-003's ban on any remainder.

In a district won by relationships, the rate is a competitive instrument, not
just a revenue dial — the reasoning DEC-043 itself records for choosing 8%
over the design's illustrative 10%.

---

## 6. Settlement lifecycle

`ACCEPTED` — **DEC-026** that the domain exists and is separate. `PROPOSED` —
the state names.

```mermaid
stateDiagram-v2
    [*] --> ACCRUING : payable builds per DELIVERED order
    ACCRUING --> PENDING : cutoff reached, round created
    PENDING --> PROCESSING : transfer instructed
    PROCESSING --> PAID : bank confirms
    PROCESSING --> FAILED : transfer rejected
    FAILED --> PENDING : corrected and retried
    PAID --> [*]
    PENDING --> CANCELLED : round voided by an operator (audited)
```

An amount becomes **payable** only when the order reaches `DELIVERED`
(DEC-019) — the documented merchant-payout flow covers online-paid,
successfully-delivered orders.

### Cycle parameters — `OPEN`, BQ-032

| Parameter | Design says | Status |
|---|---|---|
| Cadence | `โอนทุกวันจันทร์ เวลา 10:00 น.` — weekly | Sample, and contradicted by `โอนแล้วเดือนนี้ · 6 รอบ` |
| Cutoff instant | — | `OPEN` |
| Minimum payout | — | `OPEN` — proposal: roll forward below the minimum |
| Failed-transfer recovery | A `ล้มเหลว` round is shown; no recovery defined | `OPEN` |
| Payout account | One bank account per payee | `ACCEPTED` |

Weekly is the recommendation for launch — fewest transfers, fewest fees, one
reconciliation session a week for one operator. **Payout timing may be
constrained by Q-002**, so this cannot be finalised ahead of legal review.

---

## 7. Merchant settlement

`ACCEPTED` — the mechanism; `OPEN` — every number.

The merchant sees today's sales, the amount awaiting transfer, the amount
transferred this month, fees this month, a table of delivered-and-awaiting-transfer
orders, and a transfer-round history. *"ร้านไม่ต้องเช็กสลิปเอง"* — the merchant
never checks payment slips.

```
merchant round net =
    Σ (food subtotal − commission)   for DELIVERED online orders
  − Σ reversals for refunded orders
  + carried-forward balance (may be negative)
```

**Simplified by DEC-016.** The documented cash rule — cash orders skip the
transfer round because the shop already holds the money, with the commission
netted from the next round — **does not apply in Phase 1**, because there are no
cash orders. Consequences:

- The awkward "fee owed, no transfer due" state does not arise in Phase 1.
- **BQ-033** (cash-order fee netting, negative merchant balances) is **deferred**
  along with COD. It returns if COD does.
- Every merchant's money now flows through one mechanism, which is materially
  simpler to build and to reconcile.

---

## 8. Rider settlement

`ACCEPTED` — the mechanism. **RESOLVED 2026-09-05 — DEC-044**: delivery
earnings are a flat ฿12 (1200 satang) per completed delivery, with no bonus
and no rider-side platform fee in Phase 1. Compensation and cash remain as
below.

**The customer delivery fee (DEC-035, ฿10) and this rider earning (DEC-044,
฿12) are separate values, not the same number read twice.** The rider is
paid ฿12 regardless of what the customer's ฿10 delivery-fee charge alone
could cover. **RESOLVED 2026-09-05 — DEC-045**: the ฿2 (200 satang)
difference is a BANHAO platform write-off (`PLATFORM_WRITE_OFF`), not a draw
against merchant commission or service fee.

```
rider round net =
    Σ delivery earnings                   (flat ฿12 / delivery — DEC-044)
  + compensation for platform-caused failures  (BQ-024 — still OPEN, likelier under DEC-021)
  − outstanding cash held                 (DORMANT — DEC-016)
```

No bonus term and no rider-side platform-fee deduction appear in Phase 1's
formula — both were considered (the `D-13` design sample assumes a peak-hour
bonus and a rider-side platform fee) and **neither is activated** by DEC-044.

With COD disabled the cash-netting term is zero and the automatic cash-limit
dispatch block cannot trigger. **DEC-004 and REQ-001 remain ACCEPTED and must
not be deleted** — cash is still a liability, still displayed separately, the
moment COD returns.

Note that **DEC-021 makes rider reassignment routine**: a rider who rides to a
shop for a job that is then reassigned away will happen, and BQ-024
(compensation) is the question that answers what they are owed. Any compensation
must be its own ledger line, never folded into delivery earnings.

`OPEN` — BQ-034: recovery when a rider's balance goes negative. The cash half is
deferred; the compensation and platform-fee half is live.

---

## 9. Refund and cancellation impact

`ACCEPTED` — **DEC-027**: refund is a payment-domain event; the order is
`CANCELLED`, the payment is `REFUNDED`. Four distinct movements — collapsing
them is how refunds corrupt a ledger:

| Movement | Question it answers |
|---|---|
| Payment refund | How much goes back, by what mechanism (🚨 Q-020) |
| Merchant settlement reversal | Is the merchant's payable reduced? |
| Rider compensation | Does the rider still get paid? **Normally yes if they rode** |
| Platform fee reversal | Does BANHAO keep commission and service fee? |

| Cause | Customer | Merchant | Rider | Platform | Status |
|---|---|---|---|---|---|
| Cancelled before `MERCHANT_ACCEPTED` | Full refund | Nothing accrued | Nothing | Fee reversed | `ACCEPTED` |
| Merchant rejected / timed out | Full refund | Nothing | Nothing | Fee reversed | `ACCEPTED` |
| Cancelled during `PREPARING` (merchant agrees) | Full refund | `OPEN` — food may exist | Nothing | Fee reversed | Partly `OPEN` |
| **Operator cancels for no rider, food cooked** (DEC-022) | Full refund | **`OPEN`** | Compensation? | **`PLATFORM_WRITE_OFF`?** | **`OPEN` — BQ-015, P0** |
| Rider cancelled, delivery reassigned (DEC-021) | No refund | Paid | Compensation to the first rider | Absorbs it | Amount `OPEN` — BQ-024 |
| Delivery failed — customer unreachable | `OPEN` | Paid | **Paid** | `OPEN` | `OPEN` — BQ-017 |
| Missing item | Partial | Item reversal | **Paid in full** | Commission reversed proportionally | `OPEN` — BQ-031 |
| Duplicate payment (DEC-030) | Refund the duplicate | Unaffected | Unaffected | Unaffected | Mechanism `OPEN` |

Two rules across every row: **a refund never mutates the original entries** —
it writes reversing entries, and the pair still sums to zero; and a **cancelled
order legitimately sits with money still held** until the refund completes
(DEC-018 / DEC-027).

---

## 10. Promotion funding

**Funder model RESOLVED — DEC-046 (2026-09-05).** Every promotion carries a
funder, decided per promotion, and the funder is copied onto the order. Phase
1 allows exactly two funders — no other party, and no split:

```
PROMOTION_FUNDING (platform-funded)  → PLATFORM_REVENUE absorbs the discount
PROMOTION_FUNDING (merchant-funded)  → MERCHANT_PAYABLE is reduced by it
```

The third line this section previously carried — a configured platform/merchant
split — is **not supported in Phase 1** (DEC-046 rejects it explicitly). A
future decision could add it back; nothing here forecloses that, but it is not
today's rule.

**Stacking remains `OPEN` — BQ-030.** DEC-046 resolves only who may fund a
promotion, not how many promotions may combine on one order.

**Posting is not implemented.** No `promotions`/`coupons` table, no `funder`
column, and no `PROMOTION_FUNDING` ledger entry exist yet — DEC-046 is a
business decision, not an engineering task, and building any of this remains
separately unauthorized. Without them, a discounted order still cannot be
reconciled — CON-003 would fail on the first coupon redemption — but the rule
that will govern that ledger entry, once built, is no longer a guess.

---

## 11. Reconciliation

`ACCEPTED`. The operator's morning screen is a reconciliation view, not a revenue
chart: *"หน้าที่แอดมินเปิดทุกเช้าคือหน้ากระทบยอด ไม่ใช่กราฟรายได้"*.

Phase 1 identities, with the cash term removed by DEC-016:

```
(1)  online received                                                = total sales
(2)  merchant payouts + rider payouts + platform revenue + refunds  = total sales
```

Per-payment statuses `ตรงกัน` / `รอยืนยัน` / `ไม่ตรง` are `ACCEPTED`. Mismatches
are resolved by manual matching or by refunding — an operator capability under
**DEC-032**.

`PROPOSED` additions: reconcile against the **provider's settlement report** on a
schedule, not only against inbound webhooks; give **late payments** (DEC-029)
their own queue; and alert on any order whose ledger group does not sum to zero
— that should be impossible, and if it happens it is the most important alert in
the system.

### 11.1 `payment_transactions` ↔ `CUSTOMER_PAYMENT` reconciliation — locked 2026-09-05

**Architecture design, not a business decision** — same footing as § 3.1: every
fact this relies on is already `ACCEPTED` (CON-003, DEC-028/029/030, DEC-034,
and § 3.1 itself). No new `DEC-` was raised. **Not implemented** — read-only
design only; see `docs/CURRENT_STATUS.md`.

**Model: A — payment-transaction-centric.** For every eligible
`payment_transactions` row, reconstruct its expected `CUSTOMER_PAYMENT`
identity and look it up directly — never the reverse walk, and never a
combined bidirectional scan as the primary path (Model C's second direction
is retained only as a cheap orphan sweep, below). Model D (order-centric) was
evaluated and rejected: `payments.order_id` is unique, so an order→payment
join looks equally clean, but a genuine `SURPLUS_PAYMENT` inserts a **second**
`payment_transactions` row against the same `payment_id` — walking from the
order would see two transactions and one `CUSTOMER_PAYMENT`, misreading the
surplus row as `MISSING_CUSTOMER_PAYMENT_LEDGER` unless it also re-derives
which transaction was the *eligible* one. That re-derivation is exactly
Model A, so Model D adds a join without adding a capability — rejected as
unnecessary coupling, per the prompt's own suspicion.

**Eligibility — which `payment_transactions` row, exactly.** Not "every row
for a `SUCCESS` payment" — `payment_transactions` carries no flag
distinguishing the settling transaction from a later surplus one. This design
reuses, rather than invents, the exact rule `recordTransactionAndComplete`
already applies to tell self-heal from surplus
(`payment-event-processing.service.ts`): **the eligible transaction is the
one with the earliest `occurred_at` for that `payment_id`**, restricted to
payments where `payments.state = 'SUCCESS'`. Any other `payment_transactions`
row sharing that `payment_id` is a surplus by construction and is correctly
excluded — it was never given a `completeSuccessSideEffects` run, so it was
never expected to have a `CUSTOMER_PAYMENT` entry, and reconciliation must
not manufacture one.

**Primary match key:** the reconstructed ledger group key,
`payment:<payment_id>:<provider_transaction_id>` — taking `provider_transaction_id`
from the eligible transaction identified above — looked up directly against
`ledger_entry_groups.group_key` (its own unique constraint). This is the
identical string the posting code itself builds
(`postCustomerPaymentLedger`), not a new identifier; DEC-030's
`provider_transaction_id`-as-event-identity is reused unchanged.

**Secondary validation fields**, once the group is found:
- `order_id` — `payments.order_id` (via the eligible transaction's
  `payment_id`) must equal `ledger_entry_groups.order_id`.
- `amount_satang` — `payments.amount_satang` must equal the
  `CUSTOMER_PAYMENT` entry's `amount_satang` (see Amount invariant below;
  note `payment_transactions.amount_satang` is itself always a copy of
  `payments.amount_satang` at insert time — `recordTransactionAndComplete`
  never writes anything else there — so this is really one invariant, not
  two independent ones).
- `party_id` — the `CUSTOMER_PAYMENT` entry's `party_id` must equal
  `orders.customer_id` for that same order.

**Amount invariant:** exact `bigint` equality, **no tolerance, ever** —
satang is already the smallest unit BANHAO represents, so there is no
sub-unit rounding question and no floating-point comparison of any kind.
`payment_transactions.amount_satang` is DB-constrained `> 0`;
`ledger_entries.amount_satang` carries no sign CHECK, so a `CUSTOMER_PAYMENT`
row found with a non-positive amount is itself a hard invariant violation,
not merely a mismatch. Currency: both tables default `'THB'`; Phase 1 has no
multi-currency path, so this design does not compare `currency` beyond
confirming it is present — a genuine currency mismatch would be a schema-level
anomaly outside this design's scope.

**Eligible payment statuses:** only `payments.state = 'SUCCESS'`, and within
that, only the one eligible transaction defined above. `PENDING`,
`PROCESSING`, `FAILED`, `EXPIRED`, `CANCELLED` payments are not eligible —
they were never supposed to fund an order and `completeSuccessSideEffects`
never ran for them. A payment event classified `SURPLUS_PAYMENT` or
`LATE_PAYMENT` (`reconciliation_cases.kind`) is **excluded from the normal
`CUSTOMER_PAYMENT` expectation by construction**, not by an extra filter this
design adds — the eligibility rule above already excludes exactly these rows,
because `completeSuccessSideEffects` (the only place `CUSTOMER_PAYMENT` is
ever posted) never ran for them either.

**Duplicate detection:**
- `DUPLICATE_CUSTOMER_PAYMENT` — more than one `ledger_entries` row with
  `account = 'CUSTOMER_PAYMENT'` under one `group_id`. **Not** prevented by a
  database constraint — `ledger_entries` has no uniqueness on
  `(group_id, account)` — so this is a genuine, checkable reconciliation
  category, not a structurally-impossible one. Its existence would mean the
  posting code's own "check entries exist before inserting" guard was
  bypassed (a bug, or a manual/out-of-band insert), never an expected outcome.
- `DUPLICATE_PAYMENT_TRANSACTION` — **omitted from the practical output
  vocabulary.** `payment_transactions_provider_txn_key` (unique on
  `provider_transaction_id`) already makes two transactions sharing one
  provider identity structurally impossible at the database level; a second,
  *distinct* transaction against the same `payment_id` is a genuine surplus
  (already classified `SURPLUS_PAYMENT` at ingest), not a duplicate. Including
  this category here would either be unreachable or would misname an existing,
  already-classified case.

**Missing ledger — `MISSING_CUSTOMER_PAYMENT_LEDGER`:** the eligible
transaction exists and `payments.state = 'SUCCESS'`, but no
`ledger_entry_groups` row exists for the reconstructed `group_key` (or it
exists with zero `CUSTOMER_PAYMENT` entries). **Retryable, not fatal, within
the grace period** (below) — this is exactly the crash window
`ensureCustomerPaymentEntryRecorded`'s self-heal already exists to close, and
the very next tick that reprocesses the same event closes it without any
reconciliation-side repair. Only past the grace period does it become a
genuine anomaly worth surfacing for manual review — the reconciliation scan
itself never repairs it (read-only, per this task's own gate).

**Orphan ledger — `ORPHAN_CUSTOMER_PAYMENT`:** a `CUSTOMER_PAYMENT` entry
whose `group_key`'s embedded `payment_id` does not correspond to any
`payments` row in `SUCCESS` state (including: the payment row does not exist
at all, or exists but never reached `SUCCESS`). **Should be impossible under
current invariants** — `postCustomerPaymentLedger` only ever runs after the
guarded `PENDING_PAYMENT → PAID` transition already committed, which itself
only follows `payments.state = 'SUCCESS'`. A row in this category is
therefore a hard accounting-integrity violation, not an expected edge case —
manual review, never auto-reversible (no reversal mechanism exists, and this
design does not invent one).

**Amount mismatch — `PAYMENT_LEDGER_AMOUNT_MISMATCH`:** exact `bigint`
inequality between the eligible transaction's (i.e. `payments.amount_satang`,
per the Amount invariant above) and the `CUSTOMER_PAYMENT` entry's
`amount_satang`. **Severity: critical, not repairable by reconciliation.**
Both values trace to the same immutable `payments.amount_satang` by
construction, so a mismatch here means the ledger row was corrupted, hand-
edited (impossible under `reject_mutation`, so this would mean inserted
wrong at write time), or written by code other than
`postCustomerPaymentLedger` — always a bug, always manual review, never a
ledger mutation.

**Identity mismatch — `PAYMENT_LEDGER_IDENTITY_MISMATCH`:** `order_id`
disagreement (`ledger_entry_groups.order_id` ≠ the eligible transaction's own
`payments.order_id`) or `party_id` disagreement (`CUSTOMER_PAYMENT.party_id`
≠ `orders.customer_id`) are both **hard failures** — under current write
paths both are read fresh from the same order row at posting time, so
disagreement is unreachable except via a bug or manual tampering. A
`provider_transaction_id` mismatch is not a separate category: it is what the
primary-match-key lookup itself already tests (the key either resolves or it
doesn't — see Missing/Orphan above), so there is no secondary
`provider_transaction_id` check to define.

**Legacy handling:** any `payments.state = 'SUCCESS'` row whose
`succeeded_at` predates this feature's deployment has a `MERCHANT_COMMISSION`
group but **no** `CUSTOMER_PAYMENT` group — expected, not a defect — and must
be classified `LEGACY_NOT_APPLICABLE`, excluded from `MISSING_CUSTOMER_PAYMENT_LEDGER`,
using a cutover timestamp (this feature's deploy time), never by attempting
to backfill or rewrite historical ledger rows (forbidden — `reject_mutation`,
and this task's own gate). The M05-VERIFY-\* and G71-\* fixtures
(`docs/CURRENT_STATUS.md`) need no special case at all: they are UI-state
fixtures with no `payments`/`payment_transactions` rows behind them, so they
never appear in the eligible set to begin with.

**Eventual consistency / grace period:** a genuine window exists between the
guarded `orders → PAID` UPDATE committing and `postCustomerPaymentLedger`'s
own insert committing — the same class of crash window `ensureOrderHistoryRecorded`
and `ensureCommissionEntriesRecorded` already tolerate. Reconciliation must
not treat an eligible payment inside this window as a hard mismatch: classify
it `IN_FLIGHT` / `GRACE_PERIOD` while its `succeeded_at` (or `orders.paid_at`)
age is below a threshold sized to **at least one full tick interval** — the
exact interval is an operational/deployment config this design does not
invent a number for. Past the threshold, self-heal should already have closed
it on the next tick regardless, so a still-missing entry past the grace
period is the genuine `MISSING_CUSTOMER_PAYMENT_LEDGER` anomaly, not a timing
artifact.

**Read-only / concurrency:** reconciliation only ever `SELECT`s — it competes
with nothing, because the posting path's own idempotency
(`ledger_entry_groups.group_key` uniqueness) is what keeps posting correct
under concurrency, not reconciliation. Running reconciliation concurrently
with a live tick is safe by ordinary MVCC: a row not yet committed is simply
not yet visible, which the grace-period rule already absorbs. Repeated scans
are deterministic because the reconstructed match key is a pure function of
already-immutable data (`payment_id`, the eligible transaction's
`provider_transaction_id`) — the same inputs always reconstruct the same key
and therefore the same classification.

**Zero-sum — explicitly not extended.** This design does not require the
`CUSTOMER_PAYMENT` group to sum to zero (§ 3.1 already settled that), does
not require the `RIDER_EARNING` group's `-1000` residual to change (DEC-045),
and does not invent a full-order balancing check across all of an order's
groups — that would be a distinct, larger, separately-unauthorized capability
(§ 3.1's own "Zero-sum" note already flags it as future work). This design's
scope is the narrower pairwise check named in its title: one payment
transaction, one `CUSTOMER_PAYMENT` entry, matching amounts and identities.

**What this proves:** that a specific, real, provider-confirmed money
movement (`payment_transactions`) has exactly one corresponding accounting
record (`CUSTOMER_PAYMENT`) with agreeing amount and identity — i.e., that
received customer funds are properly reflected in the ledger.

**What this does NOT prove:** that an order's full economics balance to zero
(a separate, larger check spanning every group an order has); that
`PLATFORM_REVENUE` correctly reflects the service fee (component-level
revenue recognition remains unimplemented, § 3.1); that a merchant or rider
will eventually be paid correctly (no settlement engine exists); refund
correctness (no `REFUND_PAYABLE` posting exists); or promotion-funding
correctness (`PROMOTION_FUNDING` remains unposted, DEC-046).

**Future refunds:** a `REFUND_PAYABLE` entry, when it eventually exists, is a
**new, separate** ledger entry in a **new** group — never a mutation of the
`CUSTOMER_PAYMENT` row it offsets (consistent with this document's own
append-only rule). This design's per-payment 1:1 `CUSTOMER_PAYMENT`
invariant is therefore unaffected by a later refund: the original
`CUSTOMER_PAYMENT` entry still reconciles exactly as it did the day it
posted. Reconciling `REFUND_PAYABLE` against `refunds` is a distinct, future,
unimplemented concern this design does not build, and BQ-027/BQ-031 remain
exactly as open as before.

**Future settlement:** this design is an **upstream control**, not a
replacement — a settlement engine should never trust an order's
`CUSTOMER_PAYMENT` funding without this reconciliation having already
verified it. It does not compute a merchant or rider payable, does not
create a settlement table, and does not decide settlement timing (BQ-032) or
netting (BQ-034).

**DEC-046 interaction:** unaffected. `CUSTOMER_PAYMENT`'s amount is always
`payments.amount_satang`, which already nets out any future `discount_satang`
via `orders_total_check` — this design's amount check works identically
whether or not a discount exists on the order, with no special-casing added
for DEC-046. Reconciling a future `PROMOTION_FUNDING` entry against a
promotion's funder is a distinct, unimplemented concern; stacking (still
`OPEN`, BQ-030) is untouched.

**Business decisions required: none.** Every fact this design depends on
(CON-003, DEC-028/029/030, DEC-034, § 3.1) is already `ACCEPTED`. Checked
against BQ-024, BQ-027, BQ-030, BQ-031, BQ-032, BQ-034: none blocks this
design and this design introduces no new dependency on any of them — it
operates entirely within `payments`/`payment_transactions`/`ledger_entries`,
never touching commission, rider earning, promotions, or settlement-cycle
mechanics.

**Architectural scope — smallest initial implementation.** A **read-only**
SQL query or a single read-only NestJS service method, run on demand or from
a report endpoint — not a scheduled job, not a database constraint, and
**not yet a write into `reconciliation_cases`**: that table's own
`kind` CHECK (`20260811000010_audit_notification_infra_domain.sql`) is
closed to exactly `('LATE_PAYMENT', 'SURPLUS_PAYMENT', 'AMOUNT_MISMATCH',
'UNMATCHED_EVENT')` and has no room for this design's categories without a
migration this design does not authorize — the same shape of schema
constraint Phase J's AI Operations recon already flagged for
`reconciliation_cases`. The smallest correct implementation therefore reports
its findings (log output, or an admin-only read endpoint) rather than
persisting them, until persistence is separately authorized.

**Output categories (smallest practical set):** `MATCH`,
`MISSING_CUSTOMER_PAYMENT_LEDGER`, `ORPHAN_CUSTOMER_PAYMENT`,
`PAYMENT_LEDGER_AMOUNT_MISMATCH`, `PAYMENT_LEDGER_IDENTITY_MISMATCH`,
`DUPLICATE_CUSTOMER_PAYMENT`, `LEGACY_NOT_APPLICABLE`, `IN_FLIGHT` /
`GRACE_PERIOD`. `DUPLICATE_PAYMENT_TRANSACTION` is omitted (see Duplicate
detection above). `MISSING_CUSTOMER_PAYMENT_LEDGER` and `IN_FLIGHT` are
warnings/retryable by nature; `ORPHAN_CUSTOMER_PAYMENT`,
`PAYMENT_LEDGER_AMOUNT_MISMATCH`, `PAYMENT_LEDGER_IDENTITY_MISMATCH`, and
`DUPLICATE_CUSTOMER_PAYMENT` are hard anomalies for manual review.

**Invariants proposed for future automation** (validated against actual
schema capabilities above, not asserted speculatively):
1. Every eligible `SUCCESS` payment's earliest transaction maps to exactly
   one `CUSTOMER_PAYMENT` entry — checkable today via the reconstructed
   `group_key`.
2. That entry's amount equals `payments.amount_satang` exactly — checkable,
   no tolerance.
3. That entry's `order_id`/`party_id` match `payments.order_id`/
   `orders.customer_id` — checkable, both already stored.
4. No eligible payment's `group_key` resolves to more than one
   `CUSTOMER_PAYMENT` entry — checkable, not DB-enforced (see Duplicate
   detection).
5. No `CUSTOMER_PAYMENT` entry exists whose `payment_id` isn't a `SUCCESS`
   payment — checkable by construction of the match key.
6. `SURPLUS_PAYMENT`/`LATE_PAYMENT`-classified events are excluded from
   invariant 1 by the eligibility rule itself, not by a separate filter.

---

## 12. Cost and complexity

`ACCEPTED` — **DEC-031**. Every choice below is justified by one solo operator
at launch volume:

| Choice | Why it suits a solo founder |
|---|---|
| Online-only in Phase 1 (DEC-016) | Removes cash reconciliation, rider floats and remittance entirely |
| Weekly transfer rounds | Fewer transfers, fewer fees, one reconciliation session a week |
| Percentage commission (if chosen) | One number per merchant; no billing system |
| Append-only ledger | Auditable by construction |
| PostgreSQL only (DEC-014) | One store to reconcile, one transaction to trust |
| Manual operator resolution (DEC-032) | A phone call beats an algorithm at this volume |

Deliberately not built: accounting integration, automated tax filing,
multi-currency, instant payouts, rider wallets.

---

## 13. Open questions owned by this document

**Resolved by this lock:** settlement as a separate domain (DEC-026) · the three
fee directions (DEC-023, DEC-024, DEC-025) · refund/order separation (DEC-027) ·
duplicate payment (DEC-030).

**Deferred by DEC-016:** BQ-023 (rider cash float) · BQ-033 (cash fee netting) ·
Q-004 (cash limit) · the cash half of BQ-034.

**Still `OPEN` — P0:** Q-002 (legal settlement model) · BQ-027 (service fee
**refundability** only — the amount is set by DEC-036) · BQ-030 (**stacking**
only — the funder model is resolved by DEC-046) · BQ-015 (who bears the cost
of wasted food). **Resolved 2026-08-24:** BQ-026 (DEC-035, flat ฿10) and the
amount half of BQ-027 (DEC-036, fixed ฿5). **Resolved 2026-09-05:** Q-010 /
BQ-028 (**DEC-043** — commission is 8% of the food subtotal, rounded to whole
baht) · BQ-029 (**DEC-044** — rider earning is a flat ฿12 per completed
delivery; BQ-024 is unaffected and stays open below) · BQ-040 (**DEC-045** —
the ฿2 delivery funding gap is a BANHAO platform write-off) · the **funder-model**
half of BQ-030 (**DEC-046** — per-promotion funder, `PLATFORM` or `MERCHANT`,
no split; stacking is unaffected and stays open above).
**Still `OPEN` — P1:** BQ-024 (rider cancellation/waiting compensation) ·
BQ-031 (partial refund composition) · BQ-032 (settlement cycle) · BQ-034
(negative balances) · Q-011 (chargebacks).

⚖️ `LEGAL_REVIEW_REQUIRED` before any of this is implemented: payment
facilitation licensing (Q-002), merchant of record, settlement legal structure,
tax structure and regulatory classification, VAT on commission, and withholding
on merchant and rider payouts. **None of these may be marked accepted by an
agent.**
