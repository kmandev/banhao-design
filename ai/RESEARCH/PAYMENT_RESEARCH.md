# Payment Provider Research

All data checked **2026-08-09** against providers' own sites and documentation. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a payment provider** — Q-001 remains `OPEN`.

---

## 🚨 Critical finding: PromptPay refunds are not natively supported, sector-wide

**This directly contradicts BANHAO's documented design and must be resolved before payment implementation begins.**

`docs/04-payment` specifies a full refund state machine — `REFUND_PENDING → REFUND_PROCESSING → REFUNDED` — and `docs/05-architecture` specifies that cancelling before `PREPARING` triggers a **full automatic refund**. The research finds this is not achievable through gateway-native PromptPay refunds with any provider examined:

| Provider | PromptPay refund capability |
|---|---|
| **Opn / Omise** | **Impossible.** Verbatim: *"PromptPay charges cannot be voided or refunded through Omise."* |
| **Xendit** | Channel matrix marks Refund, Partial Refund, and Multiple Partial Refund all as unsupported (though it lists a 30-day refund validity, which is ambiguous — **confirm with Xendit**) |
| **Beam Checkout** | Excluded. Only `CARD`, `CARD_INSTALLMENTS`, `ALIPAY`, `WECHAT_PAY` support refunds; partial refunds are card-only |
| **2C2P** | Partial refunds supported, but only for **settled** transactions |
| **Stripe** | Supported — but *"your customer must tell us where to return the funds"* via an automated email requesting their bank account number, or the refund may fail |

**This is a structural characteristic of the PromptPay rail, not a provider quirk.** For a food-delivery app where cancellations are routine and orders are small (฿80–200), an email round-trip per refund is not viable operationally.

**Implication:** an off-rail refund mechanism must be designed from day one — most plausibly wallet/store credit on a BANHAO balance, with manual PromptPay transfer as an exception path. This is a **product design decision**, not just an engineering one, and it changes what the documented refund rules actually mean in practice. See **Q-020**.

---

## Provider assessments

### 1. Xendit Thailand (acquired GB Prime Pay)

**The only provider with first-class, publicly documented marketplace split + sub-merchant payouts in THB.**

- **PromptPay:** Yes. Channel `PROMPTPAY`, THB, min **1**, max **700,000**, instant processing and settlement, aggregator fund flow.
- **Marketplace capability — the differentiator:** Split Rules (`POST /split_rules`) with a `routes` array supporting **multiple destination accounts**, flat or percentage, in **THB**. Sub-accounts (`owned` vs `managed`), balance transfers (master↔sub and sub↔sub), and payouts on behalf of sub-accounts via the `for-user-id` header.
- **⭐ Individuals can be onboarded** — the finding that matters most for BANHAO's drivers. Thailand onboarding states verbatim: *"Individual applications are only allowed if they are XP sub-accounts."* So individual drivers and small unregistered restaurants **can** be onboarded, but only as XenPlatform sub-accounts under BANHAO.
- **Payout rail:** Local PromptPay, THB, ETA **15 minutes**, limit 2,000,000, B2B and B2C.
- **⚠️ Weaker webhook security:** Xendit uses a **static shared token** in the `x-callback-token` header, *not* a per-payload HMAC signature. Retries up to six times with exponential backoff. Given CON-002, compensating controls are advisable — IP allowlisting and re-fetching the resource by ID before acting on any webhook.
- **Fees (published):** PromptPay **2.50%, min ฿10.00** + **฿7.00** processing fee. Domestic cards 3.20% + ฿10 + ฿7. Bank payouts **1.00%, min ฿20** + ฿7.
- **⚠️ Unpublished fees that affect unit economics:** a **sub-account activity fee** per monthly-active sub-account and an **in-house transaction fee** on transfers/splits. Exact THB rates are **not published** (docs show only a worked IDR example computing 0.5%; do not treat that as a THB quote). On ฿80–200 orders these could be material.
- **Split caveats:** a 100% split fails because fees can't be deducted; splits are same-currency only; and on refunds, *"your split fees will not be returned to the source account automatically."*
- Sandbox: yes, with a dedicated xenPlatform testing guide. Docs: good.

### 2. Opn Payments (Omise)

*(Note: `docs.opn.ooo` does not resolve — the live docs are at `docs.omise.co`.)*

- **PromptPay:** Yes. Min **฿20**, max **฿150,000**. QR expires 24h by default, configurable. Requires enabling via support.
- **⭐ Best webhook security of the group:** HMAC-SHA256 with `Omise-Signature` and `Omise-Signature-Timestamp` headers; signed payload is `<TIMESTAMP>.<RAW_BODY>`; supports two comma-separated signatures during key rotation; docs explicitly call for constant-time comparison and replay-window checks. This is exactly what CON-002 needs.
- **Marketplace capability: partial and gated.** Recipients API + Transfers API exist, but *"third-party transfer recipients have to be verified by Omise."* Charges carry a `platform_fee` object. A PayFac/"Master Merchant" product with sub-merchant KYC exists but **has no public API documentation** — it is sales-gated.
- **⚠️ KYB conflicts with the driver side:** the Thailand document list enumerates **12 legal entity types — none of which is a natural person**. Individual drivers cannot be Omise merchants, and verifying them as transfer recipients at scale is unproven. Fine for collection, awkward for payout.
- **Fees (published):** PromptPay **1.65%**, cards 3.65%, transfers ≤2M THB **฿20/transaction**. ⚠️ *"subject to 7% VAT"* — **VAT is added, not included**, unlike some competitors.
- **Refunds:** PromptPay refunds impossible (see critical finding). General Refund API supports partial refunds (<15 per charge, within 365 days).
- Sandbox: yes. Docs: very good, versioned.

### 3. Beam Checkout

**Best pure-collection option; provides nothing for the payout side.**

- **PromptPay:** Yes, dedicated `QR_PROMPT_PAY_LINK` charge source.
- **⭐ Best documentation of the group** — `llms.txt`, OpenAPI spec, Postman collection, dedicated idempotency and error-handling pages, and a **published webhook test vector** (signature + HMAC key + exact raw body) so you can self-verify your implementation. Webhook auth is HMAC-SHA256 base64 in `X-Beam-Signature`.
- **Marketplace: not found in public docs.** No split, sub-account, or connected-account pages. Pricing mentions payouts "to one or more bank accounts" — the merchant's own, not third-party payees.
- **Fees (published):** **QR PromptPay "Starts from Free"**; cards from 1.80% (non-premium). Payouts **T+1 for QR PromptPay**, T+3 for cards, business days. Fees stated *"inclusive of gateway and other fees, exclusive of prevailing taxes."*
- **KYC/KYB: not retrieved** — the pricing FAQ contains "Can individuals sign up for Beam?" but the answer is JavaScript-collapsed. **Worth asking directly; a "yes" would be significant.**
- Sandbox: yes (Playground with published test data and go-live checklist).

### 4. 2C2P

- **⚠️ PromptPay unconfirmed:** the word "PromptPay" appears **zero times** in the entire developer docs index. What *is* documented is QR channel groups QRC / CSQR / **THQR (Thai QR Payment)** / SGQR. Thai QR is the PromptPay-based standard so support is very likely — but 2C2P does not say so publicly. Confirm with sales.
- **Payouts: yes, via a separate Payout product.** `POST /payouts/.../payout/create` with beneficiary details, plus a Beneficiary Registration API whose fields include **`IdCard`, `dateOfBirth`, `nationality`** — i.e. individual beneficiaries (drivers) are modelled. Note this is payout-**by-instruction**, not split-at-capture: BANHAO would receive full settlement then instruct payouts.
- **Refunds:** Yes, partial supported via `processType: "R"` with `actionAmount`. Constraint: *"refunds can only be requested for settled transactions."*
- **Webhooks:** Yes — server-to-server POST whose body is a **JWT signed with HMAC SHA-256** using the merchant secret. Note their QR flow *also* expects front-end polling of a Transaction Status API.
- **⚠️ No published pricing** — both `/pricing` URLs 404. Enterprise contract sales.
- **⚠️ Heaviest integration:** refund requests use JWE (RSA-OAEP + A256GCM) with JWS PS256 — meaningfully more crypto work than Omise or Beam.
- Sandbox: yes. Docs: thorough but heavy. Expect a sales cycle, no self-serve signup.

### 5. Stripe — effectively disqualified

PromptPay *is* genuinely supported (TH business location, THB, Connect "Yes"). But Stripe fails on **two independent grounds**:

- **Blocker 1 — Connect money movement.** For Thailand, only **Direct Charges** are supported. Verbatim: *"We do not support separate charges and transfer"* and *"We do not support top-ups to your platform account."* Without separate charges and transfers, **BANHAO cannot collect once and fan out to both a merchant and a driver** — which is the entire marketplace model.
- **Blocker 2 — restricted industries.** Stripe's list of businesses it cannot support on Connect in Thailand explicitly includes **"Food"** and **"Transportation Services"**. A food-delivery marketplace lands on two of them.

Also: platform users in Thailand cannot self-serve Custom or Express connected accounts. Fees would have been competitive (PromptPay 1.65%, cards 3.65% + ฿10), but the above is decisive.

### Briefly checked

- **ChillPay** — QR PromptPay supported. "Chill Pro" transaction fee **3.25%**, T+1 settlement, partial refund listed. "Chill Max" requires **monthly TPV ≥ ฿10 million**. Developer docs are **downloadable PDFs** rather than a web reference; webhook/signature details not verifiable publicly. No marketplace capability found.
- **SCB API Market** — QR Code Payment API generating Thai QR Tag 30, documented sandbox. **Collection-only** bank acquiring API, not a marketplace payout platform; would need a separate payout mechanism.
- **KBank / Kasikorn** — QR open API exists; same shape as SCB (bank-direct collection, bank-relationship onboarding, no documented marketplace split/payout).
- **Rabbit LINE Pay** — a wallet, not a gateway. Most practically consumed *through* a PSP (Omise documents it as a payment method). Treat as a Phase 2 payment method, not a provider candidate.
- **Paysolutions** — **not verified.** Official developer documentation could not be located in this pass. No claims made.

---

## Comparison table

| | Xendit (TH) | Omise / Opn | Beam | 2C2P | Stripe |
|---|---|---|---|---|---|
| PromptPay QR | Yes (฿1–700k) | Yes (฿20–150k) | Yes | THQR documented; "PromptPay" never named | Yes |
| **PromptPay refund** | Matrix says no | **No** (explicit) | **No** | Partial, settled txns only | Yes, but customer must email bank details |
| **Marketplace split / multi-payout** | **Yes — Split Rules, sub-accounts, payouts on behalf, THB** | Recipients+Transfers (Omise-verified); PayFac sales-gated | **Not found** | Payout-by-instruction + beneficiary registration | **Not supported in TH** |
| **Individuals (drivers) onboardable** | **Yes, as XP sub-accounts** | **No** — 12 entity types, none a natural person | Unretrieved | Likely (IdCard/DOB fields) | Blocked anyway |
| Webhook signature | ⚠️ Static token | **HMAC-SHA256, timestamped, rotation-aware** | **HMAC-SHA256 + test vector** | JWT HMAC-SHA256 | HMAC (standard) |
| Published fees | Yes — PromptPay 2.50% min ฿10 + ฿7 | Yes — PromptPay 1.65% + 7% VAT | Yes — PromptPay "from Free" | **No** | Yes — PromptPay 1.65% |
| Sandbox | Yes | Yes | Yes | Yes | Yes |
| Docs quality | Good | Very good | **Excellent** | Thorough but heavy | Excellent |
| Key blocker | Weak webhook auth; unpublished platform fees | No PromptPay refunds; company-only KYB | No marketplace layer | PromptPay unconfirmed; no pricing | **Food + Transport restricted** |

---

## Findings that matter most for BANHAO

1. **Xendit is the strongest structural fit** for a three-sided customer → platform → merchant + driver flow — the only provider with documented THB marketplace splits *and* an explicit path to onboard individual drivers. Two things to resolve before committing: whether PromptPay refunds actually work, and the **unpublished** xenPlatform sub-account activity and in-house transfer fees, which directly affect unit economics on ฿80–200 orders.
2. **PromptPay refunds must be designed around, not assumed.** See the critical finding above — this affects product design, not just integration.
3. **Stripe is out** — not for lack of PromptPay, but because TH Connect blocks separate charges and transfers *and* restricts Food and Transportation.
4. **Omise's KYB shape conflicts with the driver side** — excellent for collection and the best webhook security of any provider, but its entity model has no natural-person category.
5. **Nobody solves the cash leg.** Phase 1 cash orders sit entirely outside all five providers — the driver collects, BANHAO reconciles internally. **The ledger design must be gateway-agnostic regardless of provider choice**, which reinforces CON-003 and PROP-004.
6. **The regulatory question remains open and is the real gate.** Whether BANHAO receiving customer funds and remitting to merchants and drivers constitutes regulated payment facilitation under Bank of Thailand rules — and whether a "master merchant / sub-account" structure keeps BANHAO out of licensing scope or pulls it in — was **not determined** by this research and requires counsel. See `ai/RESEARCH/THAILAND_COMPLIANCE.md` §2 and Q-002.

**A note on decision sequencing:** the provider choice (Q-001) is partly downstream of the legal structure question (Q-002). Choosing a provider before the licensing boundary is understood risks selecting one whose model doesn't fit the eventual legal structure.
