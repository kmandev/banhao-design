# BANHAO — Payment Architecture Decision Pack V1

Analysis only. Written 2026-09-02. **No code, schema, migration, API, provider
account or commit was created or changed by this work.**

Purpose: put Q-001 (provider), Q-002 (legal / money flow), Q-010 (commission),
Q-020 (refund), merchant settlement, rider payout and payment failure/recovery
into a state where the Product Owner can lock them.

Sources: this repository (`docs/PAYMENT_LIFECYCLE.md`, `docs/SETTLEMENT_MODEL.md`,
`docs/OPEN_BUSINESS_QUESTIONS.md`, `ai/RESEARCH/PAYMENT_RESEARCH.md`,
`ai/RESEARCH/THAILAND_COMPLIANCE.md`, the payment/ledger migrations and the
`payments` module) plus provider documentation re-checked 2026-09-02 where
noted. Everything not re-checked is carried forward as of the 2026-08-09
research pass and is labelled as such.

Status legend as elsewhere in the repo: `ACCEPTED` · `PROPOSED` · `OPEN` ·
`LEGAL_REVIEW_REQUIRED`. **Nothing in this document accepts anything.**

---

## 1. Current payment architecture — what actually exists

### 1.1 The flow, node by node

| # | Node | State | Evidence |
|---|---|---|---|
| 1 | Customer → Cart → Order | **IMPLEMENTED** | `create_order()` (migration `20260819000001`), `OrdersService`, `OrderPricingService`; fees are DEC-035 (฿10) + DEC-036 (฿5) |
| 2 | Order → Payment (1:1) | **IMPLEMENTED** | `payments` table, `PaymentsService.createPayment`, `POST /orders/:id/payment` |
| 3 | Payment → PaymentAttempt (QR, TTL) | **IMPLEMENTED** | `payment_attempts`, `PaymentAttemptExpiryService` (tick-driven) |
| 4 | Attempt → Payment provider | **PARTIAL — abstraction only** | `PaymentProvider` interface + `NullPaymentProvider`. QR string is a labelled fake; `refund()` throws `NotImplementedException` |
| 5 | Provider → webhook ingest | **IMPLEMENTED for the null provider** | raw-body HMAC verify, `payment_events` persisted before processing, unique `(provider, provider_event_id)` = duplicate protection (DEC-028) |
| 6 | Webhook → Payment `SUCCESS` → Order `PAID` | **IMPLEMENTED** | `PaymentEventProcessingService`; guarded `PENDING_PAYMENT → PAID` update, `order_status_history` row |
| 7 | Payment → **ledger** | **NOT IMPLEMENTED** | `PaymentEventProcessingService` says so in its own header: *"No `ledger_entry_groups`, no `ledger_entries`, no commission"*. Zero ledger writes exist anywhere in `apps/api/src` |
| 8 | Order → Merchant (accept, prep, ready) | **IMPLEMENTED** | merchant module, M-05 live-verified |
| 9 | Order → Rider dispatch → delivery → POD | **IMPLEMENTED** | rider module, G7 |
| 10 | Delivery `DELIVERED` → merchant payable | **DEFERRED** | `settlements` / `settlement_items` tables **do not exist** — deferred from the V1 migration set. `ledger_entry_groups.settlement_id` is a reserved column with no FK |
| 11 | Rider payout | **DEFERRED** | same; `RIDER_PAYABLE` exists only as an allowed `account` value in a CHECK constraint |
| 12 | Refund | **PARTIAL — storage only** | `refunds` table + immutability triggers exist. No service, no endpoint, no provider call, no state machine code |
| 13 | Financial reconciliation | **NOT IMPLEMENTED** | DEC-034 moved the sum-to-zero invariant to the application + a scheduled reconciliation that has not been written. The only reconciliation code in the repo is the rider-release invariant (`20260825000001`), which is not financial |
| 14 | Chargeback / dispute | **NOT IMPLEMENTED · DECISION REQUIRED** | Q-011, no model, no table |

### 1.2 What that means

- **The order → payment → PAID path is real and testable.** Everything from
  `PAID` onward is a *food* pipeline, not a *money* pipeline.
- **There is no money pipeline yet at all.** No ledger row has ever been
  written by this system. CON-003 ("every order balances to zero") is currently
  vacuously true because the ledger is empty.
- **The provider seam is clean.** `PaymentProvider` has exactly four surfaces —
  `createPayment`, `refund`, `verifyWebhookSignature`, `name`. Choosing a
  provider is an adapter, not a re-architecture. That was the point of DEC-015
  and it held.
- **The seam is also too small for a marketplace.** It has no concept of a
  sub-account, a split, a recipient, a transfer or a payout. If the money-flow
  decision is Model C (below), this interface must grow — that is a new
  Architecture Decision, not an improvisation.
- **`CASH` is dormant but present** everywhere it should be (DB CHECK,
  `create_order()` argument, `PaymentMethod` enum), per DEC-016. Nothing here
  proposes touching it.

### 1.3 Decisions already locked that constrain everything below

`CON-001` order/payment separate · `CON-002` only a signature-verified webhook
may confirm a payment · `CON-003` integer satang, balances to zero ·
`DEC-014` Postgres is the system of record · `DEC-016` online only, COD off ·
`DEC-018` four state domains · `DEC-023/024/025` fee directions ·
`DEC-026` settlement is its own domain · `DEC-027` refund lives in payment ·
`DEC-028` idempotency · `DEC-029` late payment resolvable to an attempt ·
`DEC-030` duplicate payment never increases order value ·
`DEC-031/032` manual operations are an intentional capability ·
`DEC-034` no zero-sum trigger; the application asserts it ·
`DEC-035` ฿10 delivery · `DEC-036` ฿5 service.

---

## 2. Money flow models A / B / C

The three models differ on one question: **whose money is it while it is in
motion?** Everything else follows.

### Model A — BANHAO is Merchant of Record

`Customer → BANHAO's own PSP merchant account → BANHAO bank account → manual/API payout to merchant and rider`

| Dimension | Assessment |
|---|---|
| Legal / business responsibility | BANHAO is the seller of record to the customer. Simplest consumer story; heaviest regulatory exposure |
| Payment responsibility | BANHAO's, wholly. One merchant account, one KYB, one contract |
| Refund responsibility | BANHAO's. Refund is paid out of BANHAO's own funds — which is the only refund model that works at all on PromptPay (§4) |
| Commission | Trivial: BANHAO already holds the whole amount; commission is simply not paid out |
| Merchant settlement | BANHAO pays the merchant from its own bank account, on its own cycle |
| Rider payout | Same mechanism. Riders never touch the PSP |
| Accounting / ledger | **Exact fit** to the ledger already designed. `CUSTOMER_PAYMENT` in, `MERCHANT_PAYABLE` / `RIDER_PAYABLE` / `PLATFORM_REVENUE` out |
| Provider requirements | Lowest: any Thai PSP with PromptPay collection. No marketplace product needed |
| Operational complexity | Low to build, medium to run — someone runs a weekly transfer round by hand (DEC-031 accepts this) |
| **Risk** | ⚖️ **The Q-002 risk lands here in full.** BANHAO accepts money for and on behalf of merchants and riders, holds it, nets it, and remits it. That is a plain-language description of *payment facilitation* under the Payment Systems Act B.E. 2560. Whether using a licensed PSP for the collection leg is sufficient cover is precisely what `ai/RESEARCH/THAILAND_COMPLIANCE.md` §2 says public sources do not resolve. **Also: tax.** As MoR, BANHAO's revenue arguably becomes the full order value, not the commission — a VAT and corporate-tax question with a big number attached |

### Model B — Merchant is Merchant of Record

`Customer → the restaurant's own PSP account → BANHAO invoices commission separately`

| Dimension | Assessment |
|---|---|
| Payment flow | Each restaurant onboards its own PSP merchant account; the customer pays the shop |
| Commission collection | **The hard part.** BANHAO never touches the money, so commission must be invoiced and collected after the fact — direct debit, monthly invoice, or the shop simply not paying. Dunning, suspension and bad debt become launch-blocking features |
| Refund responsibility | The merchant's. BANHAO cannot refund a payment it never received — and cannot make a customer whole for a delivery failure that was BANHAO's fault |
| Merchant onboarding | **Fatal at this scale.** A 20–30 shop district in อำเภอบุณฑริก. Many will be unregistered sole traders. Omise's Thai KYB list has 12 entity types, **none a natural person**. Each shop needs its own KYB, bank account and gateway contract before it can take an order |
| Provider support | Fine technically — it is just N ordinary merchants |
| Accounting | BANHAO's books become tiny (commission revenue only) and clean. This is the *only* dimension where B wins |
| Operational complexity | **Highest.** Nobody can reconcile a three-sided order from a two-sided payment |
| **Limitation that kills it** | **The rider cannot be paid.** The customer's ฿10 delivery fee lands in the restaurant's account. Getting it to the rider means the restaurant pays the rider — which is a worse facilitation problem than the one Model B was trying to avoid, now replicated 30 times |

### Model C — Marketplace platform collection and settlement (PSP-held sub-accounts)

`Customer → PSP platform structure → BANHAO-controlled balance + merchant sub-account + rider sub-account → PSP executes payouts`

| Dimension | Assessment |
|---|---|
| Technical fit with the current architecture | Good on the order/payment side, **poor on the provider seam** — `PaymentProvider` has no sub-account, split, recipient or payout concept. Adding them is a new ADR |
| Provider requirements | High and rare: THB split-at-capture, sub-accounts, payouts on behalf, **and the ability to onboard natural persons** (riders). Research found exactly one candidate: Xendit xenPlatform |
| Recipient / connected-account model | Every merchant *and every rider* becomes a sub-account with its own KYC. Rider onboarding gains a KYC step before their first job |
| Settlement timing | Set by the PSP, not by BANHAO. Faster and more auditable than a manual round; less controllable |
| Refund flow | **Worse, not better.** Xendit's own docs: *"your split fees will not be returned to the source account automatically"*. A refund after a split has to claw back from a merchant sub-account that may already be empty |
| Commission | Split-at-capture: clean, automatic, and it never sits on BANHAO's balance sheet |
| Rider payout | The strongest argument for C — PromptPay payout to an individual, ~15 min, executed by the licensed party |
| Ledger implications | The ledger becomes a *mirror* of the PSP's balances rather than the system of record. That is in tension with DEC-014, and reconciliation gets harder, not easier: two sources of truth |
| Regulatory | **The best answer to Q-002 available without a license** — the licensed PSP is the party accepting funds on behalf of others. Still `LEGAL_REVIEW_REQUIRED`; it reduces the risk, it does not remove it |
| Operational risk | Onboarding 30 merchants + N riders into a PSP's KYC funnel before launch. Any rider who fails KYC cannot be paid at all |

### Model A vs C in one line

**A** is fast to build and puts the regulatory question on BANHAO.
**C** is slow to build, needs a rarer provider, and puts the regulatory question
on the PSP. **B** does not survive contact with a 30-shop rural district.

---

## 3. Provider capability map

Re-checked 2026-09-02 where marked ✔; otherwise carried from the 2026-08-09
research pass. **A capability is only `SUPPORTED` where a provider's own
documentation says so.**

### 3.1 Opn Payments (Omise)

| # | Capability | Verdict | Note |
|---|---|---|---|
| 1 | Thailand merchant eligibility | **SUPPORTED** | Thai-registered company; 12 KYB entity types |
| 2 | PromptPay | **SUPPORTED** ✔ | Min ฿20 / max ฿150,000; QR expiry 24h default, `expires_at` configurable, max 24h ✔ |
| 3 | Cards | **SUPPORTED** | 3.65% |
| 4 | Merchant / recipient onboarding | **SUPPORTED WITH CONDITIONS** ✔ | Recipients API: *"Recipients may be individuals or corporations, and must have a valid bank account"* ✔ — **this partly contradicts `ai/RESEARCH/PAYMENT_RESEARCH.md`**, which concluded individuals were not onboardable. The distinction is merchant **KYB** (companies only) vs transfer **recipient** (individuals allowed). Third-party recipients must be verified by Omise. **CONFIRM** |
| 5 | Marketplace / platform model | **UNKNOWN — MUST CONFIRM** | A PayFac / "Master Merchant" product exists but has no public API docs; sales-gated |
| 6 | Connected accounts | **NOT SUPPORTED** as a self-serve product | See 5 |
| 7 | Platform commission / application fee | **SUPPORTED WITH CONDITIONS** ✔ | Charges API carries a `platform_fee` object (fixed / amount / percentage) ✔ — but it is meaningful only inside the sales-gated platform product |
| 8 | Transfers / payouts | **SUPPORTED** ✔ | Transfers API + Recipients API, THB, one-time or scheduled |
| 9 | Settlement timing | **SUPPORTED** | Standard Omise settlement cycle; confirm exact T+n in contract |
| 10 | Refund — cards | **SUPPORTED** | <15 per charge, within 365 days |
| 11 | **Refund — PromptPay** | **NOT SUPPORTED** ✔ | Verbatim, current docs, re-verified 2026-09-02: *"PromptPay charges cannot be voided or refunded through Omise."* |
| 12 | Partial refund | **SUPPORTED** for cards; **NOT SUPPORTED** for PromptPay |
| 13 | Webhooks | **SUPPORTED — best of the group** | HMAC-SHA256, `Omise-Signature` + `Omise-Signature-Timestamp`, signed payload `<TIMESTAMP>.<RAW_BODY>`, dual signatures during key rotation, docs call for constant-time compare and a replay window. This is exactly CON-002's shape |
| 14 | Idempotency | **SUPPORTED WITH CONDITIONS** | Confirm the header/semantics in the current API version |
| 15 | Failed payment recovery | **SUPPORTED** | New charge = new attempt; matches `payment_attempts` |
| 16 | Charge / dispute behaviour | **SUPPORTED** for cards; PromptPay has no chargeback rail |
| 17 | KYC / verification | Company-only for merchants; individuals as verified recipients (see 4) |
| 18 | **Is BANHAO's model supported?** | **UNKNOWN — MUST CONFIRM** | Depends entirely on 5 and on Q-002 |
| — | Published fees | PromptPay **1.65%**, transfers ≤฿2M **฿20/transfer**. ⚠️ **+7% VAT, added not included** |

### 3.2 Stripe Connect

| # | Capability | Verdict | Note |
|---|---|---|---|
| 1 | Thailand eligibility | **SUPPORTED** for ordinary businesses |
| 2 | PromptPay | **SUPPORTED** | TH location, THB |
| 3 | Cards | **SUPPORTED** |
| 4 | Merchant onboarding | **NOT SUPPORTED** for this use case ✔ | TH platforms cannot self-serve Custom or Express connected accounts in restricted industries |
| 5 | Marketplace / platform model | **NOT SUPPORTED in Thailand** ✔ | Only Direct Charges. Verbatim: *"We do not support separate charges and transfer"*; no platform top-ups |
| 6–9 | Connected accounts / application fee / transfers / settlement | **NOT SUPPORTED** for BANHAO's shape ✔ | Without separate charges and transfers, BANHAO cannot collect once and fan out to a merchant **and** a rider. That is the entire model |
| 10–12 | Refund incl. PromptPay | **SUPPORTED WITH CONDITIONS** | Stripe can refund PromptPay, but *"your customer must tell us where to return the funds"* — an emailed request for a bank account number. Not viable at ฿80–200 AOV, several times a week |
| 13 | Webhooks | **SUPPORTED** — standard HMAC |
| 14 | Idempotency | **SUPPORTED** — best-in-class |
| 15–16 | Recovery / disputes | **SUPPORTED** |
| 17 | KYC | **SUPPORTED** in general |
| 18 | **Is BANHAO's model supported?** | **NOT SUPPORTED** ✔ | Thailand Connect restricted-industry list includes **Food** *and* **Transportation Services**. BANHAO is both. Support pages state Stripe *might* support a restricted business with explicit prior approval — a sales conversation, not a plan |

**Stripe is out on two independent grounds, either of which alone is
disqualifying.** It is included here only because the brief asked for it.

### 3.3 Xendit Thailand — the third candidate, and the reason not to lock

Not in the brief, but it is the only researched provider whose product shape
matches Model C, so a Model C recommendation cannot be evaluated without it.

| Capability | Verdict |
|---|---|
| PromptPay collection | **SUPPORTED** — ฿1–700,000, instant |
| Marketplace split (THB) | **SUPPORTED WITH CONDITIONS** ✔ — Split Rules / sub-accounts; **Thailand requires Xendit to activate the feature per account** ✔ |
| **Individual (rider) onboarding** | **SUPPORTED WITH CONDITIONS** — *"Individual applications are only allowed if they are XP sub-accounts"* |
| Payout to individuals | **SUPPORTED** — PromptPay payout, ~15 min |
| **PromptPay refund** | **UNKNOWN — MUST CONFIRM** ⚠️ Marketing material now indicates Thai QR PromptPay **void** is supported and **QR refund is "coming in 2026"**. This could not be verified against primary documentation on 2026-09-02 (the source page returned HTTP 403). **Do not plan on it.** If true it materially changes Q-020 and is worth one direct question to Xendit |
| Split + refund interaction | **NOT SUPPORTED (documented gap)** ✔ — *"your split fees will not be returned to the source account automatically"* |
| Webhook signature | ⚠️ **Static shared token** (`x-callback-token`), not per-payload HMAC. Weaker than CON-002 wants; needs compensating controls (IP allowlist + re-fetch the resource by id before acting) |
| Published fees | PromptPay **2.50%, min ฿10** + **฿7** processing. Payouts 1.00% min ฿20 + ฿7 |
| Unpublished fees | ⚠️ Sub-account monthly-activity fee and in-house transfer fee — **rates not published** |

### 3.4 🚨 The unit-economics finding — this is a P0, not a footnote

On a typical BANHAO order (฿130 total, per the repo's own worked example):

| | Opn Payments | Xendit |
|---|---:|---:|
| PromptPay fee | 1.65% = ฿2.15 | 2.50% of ฿130 = ฿3.25 → **฿10 minimum applies** |
| Processing fee | — | ฿7.00 |
| VAT | +7% ≈ ฿0.15 | (confirm) |
| **Cost per order** | **≈ ฿2.30** | **≈ ฿17.00** |

BANHAO's approved customer-side fee income is ฿10 delivery + ฿5 service = **฿15
per order**, out of which the rider must be paid. **Xendit's minimum-fee
structure costs more per order than BANHAO's entire fee income**, before the
rider is paid anything and before the unpublished sub-account fees. Commission
on food would have to fund the payment processor.

This is the single most important number in this pack and it directly opposes
the structural argument for Model C. **Confirm both fee schedules in writing
before any provider is locked** — published rate cards are not quotes, and
volume terms may differ.

---

## 4. PromptPay — analysed separately from cards, as required

PromptPay is not a card rail with a different logo. Treat every card assumption
as invalid until re-proved.

| Aspect | PromptPay reality | Consequence for BANHAO |
|---|---|---|
| **Confirmation** | Push payment. The customer scans and their bank pushes funds. Confirmation arrives only as a provider webhook — there is no authorize/capture split | CON-002 is not just a policy here, it is the only mechanism that exists. The client genuinely cannot know |
| **Refund** | **Structurally absent.** Omise: cannot be voided or refunded ✔. Beam: excluded. Stripe: only by emailing the customer for bank details. Xendit: void yes / refund "coming" — unverified | **Q-020 is a P0 operational concern, not an engineering task.** Every refund in V1 is a manual outbound bank transfer performed by a human |
| **Partial refund** | Not available on the rail at all | BQ-031 (partial refund composition) is moot in V1 unless the manual mechanism supports arbitrary amounts — which it does, since it is a bank transfer. The *policy* still has to be decided |
| **Duplicate payment** | **Real and likely.** A customer whose QR appears to fail can scan a regenerated QR and pay twice. Nothing on the rail prevents it | DEC-030 already anticipates this; `payment_transactions` records the surplus. But the surplus can only be returned by manual transfer — the same P0 as refunds |
| **Failed payment** | Usually "no payment arrived" — silence, not an error event | Recovery is expiry + a new attempt (already implemented). Correct as designed |
| **Late payment** | Money arrives after the attempt expired. Common on QR rails | DEC-029 anticipates it; `payment_attempts` keeps identity after expiry. **But there is no code that handles a late webhook against an EXPIRED attempt** — decision + implementation both outstanding |
| **Reconciliation** | Bank-side settlement report is authoritative; webhooks can be missed | The reconciliation job must read the **provider settlement report**, not only the webhook stream. `docs/SETTLEMENT_MODEL.md` §11 already proposes this; nothing implements it |
| **Customer refund mechanism** | Requires the customer's bank account or PromptPay ID — **which BANHAO does not currently collect** | New data collection, new PDPA question, new UX. Not in any existing design artifact |
| **Settlement to BANHAO** | Fast (PromptPay is instant into the PSP; PSP → BANHAO on its own cycle) | Fine |
| **Chargeback** | **There is none.** No dispute rail | Good news for fraud loss, bad news for customer trust — every complaint is resolved by BANHAO's own goodwill payment. Q-011 is smaller than it looks in Phase 1 |

⚠️ **The customer-facing promise is currently unkeepable.** The Customer App
tells the customer they will be refunded *"ภายใน 1–3 วันทำการ"* to the original
PromptPay account. On the current rail nobody can do that automatically. That
promise must either be re-worded or backed by a staffed manual process with an
SLA. It is already flagged under "Refund policy enforceability" in
`docs/OPEN_BUSINESS_QUESTIONS.md`.

---

## 5. Fit scoring against BANHAO's actual architecture

1 = poor fit, 5 = excellent. Scores are against the repository as it stands
today, not against an idealised future.

| Dimension | A — BANHAO MoR | B — Merchant MoR | C — Marketplace |
|---|:--:|:--:|:--:|
| Current architecture fit | **5** — the `PaymentProvider` seam already fits; one merchant account, one webhook stream | 1 — one payment per restaurant, no platform view of the money | 2 — needs sub-account/split/payout concepts the interface does not have |
| Order model fit | **5** — order is already the unit of money | 2 — order spans a payment BANHAO cannot see | 4 — split is per-charge, so per-order; fits |
| Payment model fit | **5** — `payments` is 1:1 with orders, exactly as built | 2 — payment identity belongs to the shop | 3 — fits, but the split adds provider-side state with no table for it |
| Ledger fit | **5** — the designed accounts (`CUSTOMER_PAYMENT` / `MERCHANT_PAYABLE` / `RIDER_PAYABLE` / `PLATFORM_REVENUE`) describe Model A literally | 1 — CON-003 cannot close; BANHAO never sees most of the money | 3 — ledger becomes a mirror of PSP balances, in tension with DEC-014 |
| Merchant settlement | 4 — manual weekly round; DEC-031 explicitly accepts manual ops | 2 — no settlement, but commission collection replaces it and is worse | **5** — PSP does it |
| Rider payout | 3 — manual transfers to riders, weekly | 1 — no mechanism exists at all | **5** — PromptPay payout to an individual sub-account, ~15 min |
| Refund | 4 — BANHAO holds the funds, so it *can* refund; mechanism still manual (§4) | 1 — BANHAO cannot refund money it never held | 2 — split fees are not auto-returned; clawback from a possibly-empty sub-account |
| Operational complexity | 3 — one weekly reconciliation + transfer session for one operator | 1 — 30 gateway onboardings, invoicing, dunning, bad debt | 2 — 30 merchant + N rider KYCs before launch, plus a second source of truth to reconcile |
| Provider compatibility | **5** — any Thai PSP with PromptPay collection. Opn qualifies today | 4 — technically easy, commercially impossible here | 2 — one plausible candidate (Xendit), gated on per-account activation, with hostile fee minimums (§3.4) |
| Launch risk | 3 — ⚖️ regulatory risk concentrated on BANHAO, engineering risk low | 1 — will not launch in this district | 3 — regulatory risk lower, engineering + onboarding + unit-economics risk high |
| **Total (max 50)** | **42** | **16** | **31** |

Read the totals as "which model can BANHAO actually ship in อำเภอบุณฑริก in
Phase 1", not as "which model is the best marketplace architecture". On a
three-year horizon C scores higher. On a Phase 1 horizon it does not.

---

## 6. Critical questions, by gate

### P0 — must be answered before any payment code is written

| ID | Question | Owner | Why it is P0 |
|---|---|---|---|
| **P0-1** | ⚖️ **Does BANHAO collecting customer funds and remitting to merchants and riders require a Payment Systems Act licence/registration, and does using a licensed PSP for collection change the answer?** | Thai counsel | This is Q-002. It selects the model. Everything else is downstream |
| **P0-2** | **Who is the seller of record on the transaction, and who issues the receipt/tax invoice — BANHAO or the restaurant?** | PO + accountant | Determines whether BANHAO's revenue is the order value or the commission. Big VAT number |
| **P0-3** | **Whose bank account do customer funds land in?** | PO | The literal statement of A vs C |
| **P0-4** | **May BANHAO hold and net merchant/rider money before paying it out, and for how long?** | Counsel | A weekly cycle means holding funds for up to 7 days. If that is not permitted, the payout cadence is a legal parameter, not a product one |
| **P0-5** | **Must restaurants onboard with the payment provider (KYC/KYB)?** | PO + PSP | If yes, launch is gated on 30 shops completing a KYC funnel |
| **P0-6** | **Does the rider receive money from BANHAO or from the restaurant?** | PO | Model B cannot answer this at all |
| **P0-7** | **Q-020: what is the actual refund mechanism on PromptPay?** | PO | No provider gives it natively. Manual transfer, store credit (⚠️ possible e-money), or restricted cancellation windows. Blocks the refund flow *and* the customer-facing copy |
| **P0-8** | **Q-010 / BQ-028: the commission rate and its base** — % of food subtotal (design's implicit answer) or of order total, and the rounding rule | PO | The ledger cannot close to zero without it (CON-003) |
| **P0-9** | **Is commission deducted before or after a refund?** i.e. on a refunded order, does BANHAO keep the commission and the ฿5 service fee? | PO | This is BQ-027's refundability half plus the reversal rules. Every refund writes different entries depending on the answer |
| **P0-10** | **BQ-030: who funds a promotion?** | PO | Without a funder on the promotion, a discounted order cannot be reconciled at all |
| **P0-11** | **BQ-015: who bears the cost of cooked-but-undelivered food?** | PO | DEC-022 makes operator cancellation of a no-rider order a normal event. Needs a `PLATFORM_WRITE_OFF` policy |
| **P0-12** | **What happens when payment succeeds but the order cannot proceed** (merchant rejects, no rider, or `create_order` succeeded and acceptance failed)? | PO | The money is already collected and the refund rail does not exist. This is the most likely bad day in week one |
| **P0-13** | **Who may initiate a refund, and under what dual control?** | PO | A manual refund is a human moving real money. Single-operator authority over outbound transfers with no second signature is the classic small-platform loss |
| **P0-14** | **Confirmed fee schedule from the chosen provider, in writing** | PO | §3.4 — the published minimums can exceed BANHAO's entire per-order fee income |

### P1 — before production launch

- **P1-1** BQ-029 rider earnings formula (blocks `RIDER_PAYABLE` amounts).
- **P1-2** BQ-032 settlement cycle: cadence, cutoff instant, minimum payout, failed-transfer recovery.
- **P1-3** BQ-031 partial refund composition (food / delivery / service / discount, and the order of application).
- **P1-4** Late-payment policy: money arrives after `PAYMENT_EXPIRED` and the order is gone — refund, or revive?
- **P1-5** Duplicate-payment operational runbook (DEC-030 gives the rule; nobody has written the procedure).
- **P1-6** Reconciliation cadence and who runs it; what an unbalanced ledger group triggers.
- **P1-7** Withholding tax on merchant and rider payouts; VAT on commission.
- **P1-8** Collecting the customer's bank/PromptPay ID for refunds — PDPA basis and UX.
- **P1-9** BQ-034 negative rider/merchant balances.
- **P1-10** Q-011 chargebacks — small on the PromptPay rail, real the day cards are enabled.

### P2 — deferrable

Tips · surge/bonus accounting · cards as a second method · automated
provider-API payouts · settlement statements as a merchant-facing screen (M-09,
which has no design artifact anyway) · stored-value wallet · COD reactivation
(Q-004, BQ-023, BQ-033 already deferred with it).

---

## 7. Recommendation

### 7.1 Money flow — **Model A for Phase 1, Model C as the declared migration target**

**Recommend Model A**, conditional on P0-1 and P0-4, because:

1. **It is the model the repository already implements.** The ledger accounts in
   `20260811000007_ledger_domain.sql` — `CUSTOMER_PAYMENT` in,
   `MERCHANT_PAYABLE` / `RIDER_PAYABLE` / `PLATFORM_REVENUE` out — *are* Model A
   written as SQL. No other model closes CON-003 with the tables that exist.
2. **It is the only model in which BANHAO can refund at all** on a rail with no
   native refund (§4). In B, BANHAO does not hold the money; in C, the split has
   already left.
3. **It is the only model that pays riders in Phase 1** without a KYC funnel and
   a rare provider product.
4. **DEC-031 already accepts manual operations** as an intentional Phase 1
   capability. A weekly manual transfer round for ~30 merchants and a handful of
   riders is a morning's work, and `docs/SETTLEMENT_MODEL.md` §12 already argues
   this.
5. **Model C's advantages are real but arrive later.** Recommend recording C as
   the intended structure at scale so the ledger and settlement domain are built
   without assumptions that block it — specifically: never assume BANHAO's bank
   account is the source of a payout, and keep payee identity in BANHAO's own
   tables so a sub-account id can be added beside it.

⚖️ **This recommendation is engineering and product reasoning only. It is not a
legal conclusion and must not be treated as one.** If counsel says BANHAO may
not hold third-party funds, **the recommendation flips to C** and the provider
recommendation flips with it (Xendit becomes primary, and §3.4's fee problem
becomes a pricing problem the PO must solve).

**Model B is not recommended in any scenario** and should be closed.

### 7.2 Provider — **do not lock yet**

| Slot | Provider | Reasoning |
|---|---|---|
| **Primary (proposed)** | **Opn Payments (Omise)** | Best webhook security of any candidate and it maps 1:1 onto CON-002 (HMAC-SHA256, timestamped, rotation-aware, replay window). PromptPay 1.65% is ~7× cheaper per order than Xendit's minimum-fee structure at BANHAO's AOV (§3.4). Transfers + Recipients API supports individual recipients ✔, which covers rider payouts under Model A. Very good, versioned docs |
| **Backup** | **Xendit Thailand** | The only structural fit for Model C. Becomes primary if counsel forces C, or if the PromptPay-refund capability turns out to be real (§3.3) |
| **Excluded** | **Stripe** | Thailand Connect supports neither separate charges and transfers nor the Food / Transportation categories ✔. Two independent disqualifications |
| **Excluded** | Beam | Collection only, no payout layer |
| **Not assessed further** | 2C2P | PromptPay never named in public docs; no published pricing; heaviest crypto integration. Revisit only if Opn and Xendit both fail |

**🚫 Q-001 must NOT be locked until all four of these come back in writing:**

1. Opn confirms it will onboard a food-delivery marketplace with BANHAO as
   merchant of record, given the flow described in P0-1/P0-3.
2. Opn confirms third-party transfer recipients may be **natural persons**
   (riders) and states the verification process and its lead time.
3. Opn's fee schedule in writing, VAT-inclusive, including transfer fees and any
   minimums.
4. Counsel's answer to P0-1 and P0-4.

Until then Q-001's status is **RECOMMENDED, NOT LOCKED**.

### 7.3 Recommended V1 payment scope — the smallest launchable set

**IN:**

| # | Item | Note |
|---|---|---|
| 1 | **PromptPay QR only** | Per DEC-016. No cards in V1 |
| 2 | One provider adapter behind the existing `PaymentProvider` interface | No second provider, no fallback routing |
| 3 | Signature-verified webhook → `SUCCESS` → order `PAID` | Already implemented for the null provider; becomes real |
| 4 | **Ledger writes** — the missing half of the system | On `PAID`: `CUSTOMER_PAYMENT` in, `MERCHANT_PAYABLE` / `RIDER_PAYABLE` / `PLATFORM_REVENUE` out. In the same transaction. Asserted to sum to zero (DEC-034) |
| 5 | Commission accrual at the locked rate | Needs P0-8 |
| 6 | **Reconciliation job** — provider settlement report vs `payment_transactions` vs ledger, run on the tick | Plus the alert `docs/SETTLEMENT_MODEL.md` §11 asks for: any group not summing to zero is the highest-priority alarm in the system |
| 7 | **Manual refund with operator approval** | Refund record + reversing ledger entries + an attested outbound bank transfer. Dual control (P0-13) |
| 8 | **Manual weekly settlement round** for merchants and riders | Computed from the ledger, exported for the operator, results recorded back as ledger entries. Requires the deferred `settlements` tables — an explicitly instructed migration |
| 9 | Duplicate-payment and late-payment handling | Rules exist (DEC-029, DEC-030); the code and the runbook do not |

**DEFER:**

Cards · partial refunds · store credit / wallet (⚠️ possible e-money under
Q-002) · split-at-capture · provider-API automated payouts · merchant/rider
sub-accounts · settlement screens for merchant (M-09) and rider · promotions
beyond a funder field · chargeback handling · tips · COD.

---

## 8. Decision table

| Decision | Recommendation | Confidence | Blocker |
|---|---|---|---|
| **Q-001 Provider** | **Opn Payments primary, Xendit backup. Do not lock** | **LOW** | Three written confirmations from Opn (marketplace/MoR eligibility, natural-person recipients, full fee schedule incl. VAT and transfer minimums) + counsel on P0-1. Also downstream of Q-002 |
| **Q-002 Money flow** | **Model A — BANHAO as merchant of record, manual settlement; Model C as declared migration target** | **LOW** | ⚖️ Thai counsel. Exact question: *"Does a platform that collects customer payment through a BOT-licensed PSP, holds the funds up to 7 days, nets commission, and remits to restaurants and riders, perform licensable payment facilitation under the Payment Systems Act B.E. 2560 — and does the PSP's licence cover it?"* Second question: *"As merchant of record, is BANHAO's VATable revenue the order value or the commission?"* |
| **Q-010 Commission** | **Percentage of the food subtotal** (the design's implicit model, internally consistent across every sample), rate set by the PO, with an explicitly stated rounding rule applied in exactly one place | **MEDIUM** on the model · **N/A** on the rate | The rate is the PO's commercial decision. DEC-025 forbids 10% becoming the default by silence. Note §3.4: the rate must cover the PSP fee, since delivery + service fees do not |
| **Q-020 Refund** | **Manual outbound bank transfer, operator-initiated, dual-controlled. No wallet/store credit in V1.** Re-word the "1–3 วันทำการ to your PromptPay account" promise to match what a human can actually do | **MEDIUM** | Opn cannot refund PromptPay ✔ — verified. Xendit *may* be able to (unverified, 403). Ask Xendit directly: *"Is refund — not void — of a Thai QR PromptPay charge supported today in production, in what amounts, and within what window?"* A yes reopens this decision |
| **Merchant settlement** | Weekly manual round computed from the ledger, paid from BANHAO's bank account, recorded back as ledger entries. Needs the deferred `settlements` / `settlement_items` tables | **MEDIUM** | Cadence and cutoff may be constrained by P0-4 (how long BANHAO may hold funds). BQ-032 |
| **Rider payout** | Same weekly round, same mechanism, **separate ledger account and separate payout run** from merchants — never netted together | **MEDIUM** | BQ-029 (the earnings formula) sets the amount. Nothing can be paid until it exists |
| **Payment failure** | Expiry + new attempt (already built and correct). Late payment → refund by the manual path, do not revive the order. Duplicate payment → record the surplus in `payment_transactions`, refund by the manual path (DEC-030) | **MEDIUM** | P0-12: what happens when payment succeeded and the order cannot proceed. Also P1-4 |

---

## 9. Architecture consequences of the recommendation — design level only

If Model A + Opn + manual refund is locked, the following change. **None of it
is authorised by this document.**

1. **`PaymentProvider` adapter** — an `OpnPaymentProvider` under
   `payments/providers/`, implementing the existing four-method interface
   unchanged. The interface does **not** need sub-accounts or splits under Model
   A. That is the main engineering dividend of choosing A.
2. **`refund()` cannot be a provider call.** Opn cannot refund PromptPay. The
   interface's `refund()` stays declared and stays unimplemented for the
   PromptPay method; the refund *domain* is served by an operator-attested
   manual transfer instead. **This must be an explicit decision, not a silent
   workaround.**
3. ⚠️ **CON-002 needs an explicit, narrow amendment.** It says `REFUNDED` is
   reachable only from a signature-verified webhook. With manual refunds there
   is no webhook, so as written CON-002 makes a lawful refund unrepresentable.
   Required: a new Architecture Decision creating an **operator-attested refund
   confirmation** path — dual control, full audit row, actor recorded, distinct
   from the webhook path, and applying **only** to refunds. `SUCCESS` stays
   webhook-only, untouched. Per `CLAUDE.md`, a deviation from V1.1 requires a
   decision, not an improvisation — this is that deviation, named.
4. **Payment attempts** — unchanged. The existing model already handles QR
   regeneration, expiry and late-payment resolution correctly.
5. **Webhook** — the existing two-phase ingest (persist raw, then process) is
   already the right shape. Opn's timestamped signature adds a replay-window
   check, which the current `TickHmacGuard`-style verifier does not do.
6. **Order state transitions** — no new order states. `PAYMENT_EXPIRED`,
   `PAYMENT_FAILED` and `CANCELLED` already exist in the CHECK constraint.
   Refund never appears on the order (DEC-027).
7. **Ledger** — the largest single piece of new work, and it does not exist at
   all today. A ledger service writing entry groups in the same transaction as
   the payment/order change, asserting sum-to-zero in application code
   (DEC-034), keyed by a deterministic `group_key` for idempotency (DEC-028).
   Every account name it needs is already in the CHECK constraint.
8. **Commission** — a stored **amount** per order, never a stored rate. The
   schema already stores amounts and not rates precisely so the open number can
   be set later without a migration. Keep it that way.
9. **Merchant settlement / rider payout** — needs the deferred `settlements` and
   `settlement_items` tables. That is a new migration and therefore an
   **explicitly instructed** action under `CLAUDE.md` §10 — not a side effect of
   phase work.
10. **Reconciliation** — a tick phase, reading the provider settlement report
    against `payment_transactions` and against the ledger. Sits alongside the
    existing `OutboxDispatchService` and `PaymentAttemptExpiryService`.
11. **Operator surface** — refund approval, settlement rounds and reconciliation
    all need the **Admin app, which is still a shell with no design artifact**.
    Phase I becomes a hard prerequisite for real money, not a later nicety. This
    is currently the largest unacknowledged dependency in the plan.

---

## 10. Risks

| # | Risk | Severity | Note |
|---|---|---|---|
| R-1 | ⚖️ Counsel says BANHAO may not hold third-party funds | **Critical** | Flips the model to C, the provider to Xendit, and re-opens unit economics. Ask first, build second |
| R-2 | Provider minimum fees exceed per-order fee income (§3.4) | **Critical** | ฿17/order against ฿15 of customer-side fees. Get the written schedule before locking |
| R-3 | Every refund is manual | **High** | Staffing and an SLA, not a feature. Volume scales with cancellations, and DEC-022 makes operator cancellation routine |
| R-4 | The customer-facing refund promise cannot be kept as written | **High** | Legal exposure under consumer protection; already flagged in the repo |
| R-5 | Ledger does not exist yet | **High** | Everything downstream (settlement, payout, reconciliation, commission) is blocked on it, and it is unbuilt |
| R-6 | Admin app is a shell with no design artifact | **High** | There is no screen from which a human can approve a refund or run a settlement round |
| R-7 | Duplicate PromptPay payments | **Medium** | Likely on a QR rail; the rule exists, the handling does not |
| R-8 | Riders are paid by hand, weekly | **Medium** | Riders are the scarcest resource; a missed payout costs supply |
| R-9 | Rate/base/rounding of commission left implicit | **Medium** | CON-003 fails on the first rounding disagreement |
| R-10 | Promotion with no funder | **Medium** | The ledger cannot reconcile the first coupon redemption |
| R-11 | Provider capability drift | **Low–Medium** | Xendit's PromptPay refund position appears to have moved since the 2026-08-09 pass. Re-verify anything more than a month old before relying on it |

---

## 11. The exact questions to ask, before any implementation

**To Thai counsel (blocks everything):**

1. Does a platform collecting customer payment via a BOT-licensed PSP, holding
   funds up to 7 days, netting commission and remitting to restaurants and
   riders, perform licensable **payment facilitation** under the Payment Systems
   Act B.E. 2560 — and does the PSP's licence cover it?
2. If BANHAO is merchant of record, is its VATable revenue the **order value**
   or the **commission**?
3. Is there a maximum period BANHAO may hold merchant/rider funds before
   remitting?
4. Are withholding-tax obligations triggered on payouts to restaurants
   (companies and sole traders) and to riders (individuals)?
5. Would customer **store credit** constitute regulated e-money?
6. Does the ETDA Digital Platform Services notification obligation apply at
   single-district scale, and in which form?

**To Opn Payments (blocks Q-001):**

7. Will you onboard a food-delivery marketplace where BANHAO is merchant of
   record, collects for restaurants and riders, and remits by its own transfers?
8. May transfer recipients be **natural persons** (riders)? What is the
   verification process and its lead time? *(Your Recipients API docs say
   individuals are allowed; our earlier research read your KYB entity list as
   company-only. Which governs?)*
9. Full fee schedule in writing: PromptPay rate, any minimum, transfer fee,
   settlement timing (T+n), VAT treatment.
10. Confirm, in current production terms, that PromptPay charges cannot be
    voided or refunded — and whether any partial or alternative mechanism exists.
11. What is your platform / master-merchant product, and does it have an API?
12. Idempotency semantics on `createPayment` in the current API version.

**To Xendit (only if Model C is forced, or to re-open Q-020):**

13. Is **refund** — not void — of a Thai QR PromptPay charge supported in
    production today? In what amounts, and within what window?
14. Written fee schedule for Thailand including the **sub-account activity fee**
    and the **in-house transfer fee**, with a worked example on a ฿130 order.
15. Can riders be onboarded as individual XP sub-accounts, and what is the KYC
    lead time per rider?
16. When a split payment is refunded, what is the documented procedure for
    recovering split fees already credited to a sub-account?

**To the Product Owner (blocks the ledger):**

17. Commission: rate, base (food subtotal or order total), rounding rule.
18. On a refunded order, does BANHAO keep the commission and the ฿5 service fee?
19. Who funds promotions — platform, merchant, or per-promotion?
20. Who bears the cost of cooked-but-undelivered food?
21. Rider earnings formula.
22. Settlement cadence, cutoff, minimum payout.
23. Who may approve a refund, and who is the second signature?
24. What happens when payment succeeds and the order cannot proceed?

---

## 12. What this document does and does not do

**Does:** map the implemented system, compare three money-flow models against
it, re-verify the two providers named in the brief against current
documentation, separate PromptPay from cards, and list what must be answered.

**Does not:** select a provider, accept a model, set a rate, change any code,
schema, migration, API or configuration, or create any provider account. No
`DEC-NNN` is issued here. Q-001, Q-002, Q-010 and Q-020 remain **OPEN**.

**Sources re-verified 2026-09-02:**
[Omise PromptPay](https://docs.omise.co/promptpay) ·
[Omise Recipients API](https://docs.omise.co/recipients-api) ·
[Omise Transfers API](https://docs.omise.co/transfers-api) ·
[Omise Charges API](https://docs.omise.co/charges-api) ·
[Businesses Stripe can't support via Connect in Thailand](https://support.stripe.com/questions/businesses-stripe-cant-support-via-connect-in-thailand) ·
[Stripe Thailand support for marketplaces](https://support.stripe.com/questions/stripe-thailand-support-for-marketplaces) ·
[Xendit xenPlatform Thailand](https://www.xendit.co/en-th/products/xenplatform/) ·
[Xendit split payments](https://docs.xendit.co/docs/split-payments)
