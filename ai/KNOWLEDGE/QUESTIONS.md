# Open Questions

Migrated from `docs/TODO.md` § "Questions Requiring Product Decision", plus the P0 stack questions from the same file's P0 list, given structured IDs. When a question is resolved, update its `Status` to `RESOLVED` and its `Decision` field to the `DEC-NNN` that answers it — do not delete the entry.

---

## Q-001

```yaml
id: Q-001
type: OPEN_QUESTION
status: OPEN
priority: P0
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, closing note; docs/TODO.md
```

**Question:** Which payment provider(s) will BANHAO integrate with for PromptPay QR in Phase 1?

**Why it matters:** Blocks all payment implementation; the payment architecture doc explicitly states it is not yet bound to any provider.

**Blocking:** Payment implementation, provider webhook integration, REQ-003, CON-002.

**Note (2026-08-09):** still `OPEN` by deliberate choice. The application foundation ships a `PaymentProvider` abstraction with no real implementation (DEC-015), so this question can be answered later without rework. Provider choice remains downstream of Q-002 (legal/settlement model) and Q-020 (refund mechanism).

**Candidates:** Xendit is the only researched provider with documented THB marketplace splits and individual-driver onboarding; Omise has the strongest webhook security but no natural-person KYB; Beam is collection-only. Stripe is disqualified. See `ai/RESEARCH/PAYMENT_RESEARCH.md`.

**Decision:** TBD

---

## Q-002

```yaml
id: Q-002
type: OPEN_QUESTION
status: OPEN
priority: P0
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, closing note
```

**Question:** What is the legal/marketplace settlement model — who is the merchant of record for payment purposes?

**Why it matters:** Determines KYC/KYB requirements, tax/accounting treatment, and how payouts to merchants/drivers are structured.

**Blocking:** Payment implementation, legal/compliance review (`docs/TODO.md` P1).

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-003

```yaml
id: Q-003
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, section "03 — ORDER STATE MACHINE"
```

**Question:** What is the full refund policy, beyond the three rules already documented (auto-refund before `PREPARING`; shop-confirmed refund during `PREPARING`; support-center-only after `PICKED_UP`)?

**Why it matters:** Edge cases (partial refunds, disputed deliveries, merchant-caused delays) are not yet covered.

**Blocking:** Full refund-flow implementation.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-004

```yaml
id: Q-004
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "05 — DRIVER"
```

**Question:** What exact cash-remittance limit triggers "stop assigning new jobs" for a driver?

**Why it matters:** The document states a limit exists ("ถ้ายังมีเงินสดค้างนำส่งเกินวงเงินที่กำหนด") but never gives the number.

**Blocking:** Driver-app job-assignment logic.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-005

```yaml
id: Q-005
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: UNKNOWN / NOT VERIFIED — not mentioned anywhere in the repository
```

**Question:** What is the target timeline / launch date for Phase 1?

**Why it matters:** Affects prioritization of the remaining design and technical work.

**Blocking:** Roadmap planning (`docs/ROADMAP.md`).

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-006

```yaml
id: Q-006
type: OPEN_QUESTION
status: RESOLVED
priority: P0
resolved_by: DEC-011
resolved_date: 2026-08-09
date: 2026-08-09
source: docs/TODO.md P0; docs/AI_CONTEXT.md § Technology Stack
```

**Question:** What backend technology stack (language, framework, hosting) will BANHAO use?

**Why it matters:** No implementation of any kind can begin until this is decided. This task's scope explicitly excludes making this choice (see `docs/DECISIONS.md` — no such decision has been recorded).

**Blocking:** ~~All implementation work.~~ Unblocked.

**Candidates:** NestJS / Laravel / Go — see `ai/RESEARCH/BACKEND_COMPARISON.md`.

**Decision:** **NestJS + TypeScript**, REST with OpenAPI. Accepted by the Product Owner 2026-08-09 — see DEC-011.

---

## Q-007

```yaml
id: Q-007
type: OPEN_QUESTION
status: RESOLVED
priority: P0
resolved_by: DEC-010
resolved_date: 2026-08-09
date: 2026-08-09
source: docs/TODO.md P0; docs/AI_CONTEXT.md § Technology Stack
```

**Question:** What database technology will BANHAO use?

**Why it matters:** The Order and Payment state machines are fully specified at the product level and ready to become a schema once this is decided.

**Blocking:** ~~All implementation work.~~ Unblocked.

**Candidates:** PostgreSQL / MySQL / MongoDB — see `ai/RESEARCH/DATABASE_COMPARISON.md`.

**Decision:** **Supabase (PostgreSQL + PostGIS)**, also providing Auth, Storage, and Realtime. Accepted by the Product Owner 2026-08-09 — see DEC-010.

---

## Q-008

```yaml
id: Q-008
type: OPEN_QUESTION
status: OPEN
priority: P3
date: 2026-08-09
source: FACT-009; docs/TODO.md P3
```

**Question:** What is `design/.thumbnail` for, and can it be classified or safely archived?

**Why it matters:** Low stakes, but an unclassified file should eventually get a home.

**Blocking:** Nothing.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-009

```yaml
id: Q-009
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/INFRASTRUCTURE.md; ai/RESEARCH/COST_MODEL.md
```

**Question:** What is the expected initial infrastructure budget, and is there a hosting preference (self-managed VPS vs. managed platform vs. major cloud vs. Thailand-local provider)?

**Why it matters:** Infrastructure options range from a few dollars a month to substantially more, with very different operational burdens. Cost tolerance and who will operate the system are Product Owner inputs that this research cannot supply.

**Blocking:** Infrastructure selection; parts of the cost model.

**Candidates:** See `ai/RESEARCH/INFRASTRUCTURE.md`.

**Decision:** TBD

---

## Q-010

```yaml
id: Q-010
type: OPEN_QUESTION
status: OPEN
priority: P0
date: 2026-08-09
source: ai/RESEARCH/MARKETPLACE_PAYMENT_MODEL.md; docs/04-payment ledger examples
```

**Question:** What is BANHAO's platform fee — the actual percentage or formula charged to merchants and/or drivers?

**Why it matters:** "ค่าธรรมเนียมแพลตฟอร์ม" / "รายได้บ้านเฮา" appears as a real line item in the documented ledger examples, but no rate or formula is documented anywhere. The ledger cannot be implemented to balance to zero (CON-003) without knowing how the platform's share is computed.

**Blocking:** Ledger implementation, settlement engine, merchant/driver onboarding terms.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-011

```yaml
id: Q-011
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/MARKETPLACE_PAYMENT_MODEL.md; ai/RESEARCH/RISK_MATRIX.md
```

**Question:** How are chargebacks handled — when a customer disputes a charge with their bank rather than requesting a refund through BANHAO?

**Why it matters:** Refund flows are fully designed, but chargebacks are not mentioned anywhere in the repository. Money can be pulled back after BANHAO has already paid out the merchant and driver, leaving the platform short.

**Blocking:** Payment implementation completeness; merchant/driver contract terms.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-012

```yaml
id: Q-012
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/THAILAND_COMPLIANCE.md §1; ai/RESEARCH/SECURITY_ARCHITECTURE.md
```

**Question:** What is the data retention and access policy for sensitive data — particularly continuous driver GPS location, customer delivery addresses, and phone numbers — under PDPA?

**Why it matters:** Driver location tracking is among the most sensitive data flows in the design, and no retention, access-control, or lawful-basis analysis exists. PDPA carries administrative and potential criminal penalties.

**Blocking:** PDPA compliance; database schema decisions around retention.

**Candidates:** Requires professional legal review, not an engineering choice alone.

**Decision:** TBD

---

## Q-013

```yaml
id: Q-013
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: ai/RESEARCH/SECURITY_ARCHITECTURE.md; ai/RESEARCH/RISK_MATRIX.md
```

**Question:** What anti-fraud mechanisms should exist for driver fraud (false delivery status, GPS spoofing), merchant fraud (false ready status), and customer fraud (false non-delivery claims)?

**Why it matters:** All three vectors are implied by the domain; none has any mitigation designed. Options (photo proof of delivery, customer confirmation codes, GPS plausibility checks) are product-design decisions with real UX cost, not purely technical choices.

**Blocking:** Nothing immediately, but harder to retrofit after launch.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-014

```yaml
id: Q-014
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: ai/RESEARCH/SECURITY_ARCHITECTURE.md
```

**Question:** What authorization granularity is needed beyond the four top-level roles — specifically, does Admin need sub-roles (e.g. who may approve merchant/driver applications, who may force-unassign a driver, who may issue refunds)?

**Why it matters:** The Admin design includes privileged actions (approval queue, force-unassign) with no indication of whether every Admin user may perform them. Also unstated: the presumably-intended rule that a Merchant may only access their own shop's orders.

**Blocking:** Authorization implementation.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-015

```yaml
id: Q-015
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/THAILAND_COMPLIANCE.md (priority finding)
```

**Question:** Does BANHAO need to file an ETDA notification under the Royal Decree on Digital Platform Service Businesses B.E. 2565 — and if so, short-form or full-form?

**Why it matters:** The decree applies to intermediary services connecting business users and consumers, which structurally matches BANHAO. Full-form applies above THB 50M revenue or 5,000 monthly active users; short-form appears to apply "otherwise", suggesting a filing obligation may exist even at Stage 1 scale. ETDA announced increased enforcement in 2025 including potential criminal penalties.

**Blocking:** Legal readiness to operate.

**Candidates:** Requires professional legal review.

**Decision:** TBD

---

## Q-016

```yaml
id: Q-016
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/BACKEND_COMPARISON.md; ai/RESEARCH/MULTI_APP_ARCHITECTURE.md
```

**Question:** What are the team's skill constraints, and is there a mobile framework preference (does the documented Flutter intention in DEC-006 still hold)?

**Why it matters:** Backend and mobile technology comparisons can rank options on objective criteria, but "what can the people building this actually maintain" is decisive and only the Product Owner knows it. DEC-006's Flutter intention has no recorded rationale and may or may not still reflect intent.

**Blocking:** Backend stack decision (Q-006); mobile implementation approach.

**Candidates:** See `ai/RESEARCH/BACKEND_COMPARISON.md`.

**Decision:** TBD

---

## Q-017

```yaml
id: Q-017
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: ai/RESEARCH/THAILAND_COMPLIANCE.md §6
```

**Question:** Do the OCPB "Dee-Delivery" cash-on-delivery requirements apply to BANHAO's Phase 1 cash payment flow, and does any Direct Sales/Direct Marketing Act licensing obligation attach to a food-delivery marketplace?

**Why it matters:** Phase 1 explicitly includes cash payment, and OCPB has an active initiative specifically targeting cash-on-delivery in logistics/delivery services.

**Blocking:** Legal readiness for the cash flow specifically.

**Candidates:** Requires professional legal review.

**Decision:** TBD

---

## Q-018

```yaml
id: Q-018
type: OPEN_QUESTION
status: OPEN
priority: P1
date: 2026-08-09
source: ai/RESEARCH/MAPS_LOCATION.md
```

**Question:** How accurate is map and address data for อำเภอบุณฑริก in practice — and does Longdo (Thai-local) outperform Google/Mapbox/OSM there?

**Why it matters:** **No provider publishes district-level coverage or accuracy data for Thailand**, and no independent measurement for Buntharik exists. OSM has the administrative boundary and town node, but administrative geometry does not imply house-number coverage. Thai rural addressing (บ้านเลขที่ / หมู่ / ตำบล) is poorly represented in OSM generally — and the design's own example address, "88 หมู่ 4 บ้านบุณฑริก ต.บุณฑริก อ.บุณฑริก", is exactly the format most likely to geocode poorly.

**Why this cannot be desk-researched:** it requires field spot-checking real Buntharik addresses against each provider. Map data quality in the launch area is arguably more consequential than pricing.

**Blocking:** Maps provider selection; address-entry UX design (a district with poor geocoding may need pin-drop or landmark-based addressing instead of text entry).

**Candidates:** Google, Mapbox, Longdo, self-hosted OSM — see `ai/RESEARCH/MAPS_LOCATION.md`.

**Decision:** TBD

---

## Q-019

```yaml
id: Q-019
type: OPEN_QUESTION
status: OPEN
priority: P2
date: 2026-08-09
source: ai/RESEARCH/NOTIFICATIONS.md
```

**Question:** Which SMS sender identity will BANHAO register with NBTC, and when does registration start?

**Why it matters:** NBTC requires Sender ID registration and KYC for domestic A2P senders. Approval reportedly takes ~2 weeks *(third-party source, unverified)*. Separately, since 21 October 2025, Thai operators prepend an **alert symbol to SMS originating overseas** — meaning a foreign SMS provider would deliver OTPs with a warning marker attached, undermining the trust an OTP exists to establish.

**Blocking:** OTP delivery at launch. This has calendar lead time and must start well before launch, not during it.

**Candidates:** Thai domestic gateway (e.g. ThaiBulkSMS at ฿0.15/credit) strongly favoured over Twilio ($0.0305/message) on both cost and deliverability grounds.

**Decision:** TBD

---

## Q-020

```yaml
id: Q-020
type: OPEN_QUESTION
status: OPEN
priority: P0
date: 2026-08-09
source: ai/RESEARCH/PAYMENT_RESEARCH.md (critical finding)
```

**Question:** How will BANHAO refund a PromptPay payment, given that **no examined provider supports native PromptPay refunds**?

**Why it matters — this contradicts the documented design.** `docs/04-payment` specifies a full refund state machine (`REFUND_PENDING → REFUND_PROCESSING → REFUNDED`) and `docs/05-architecture` specifies automatic full refund when a customer cancels before `PREPARING`. Research found this is not achievable natively: Omise states PromptPay charges "cannot be voided or refunded"; Beam excludes the method; Xendit's channel matrix marks it unsupported; Stripe supports it only by emailing the customer to request their bank account number. This is a characteristic of the PromptPay rail, not a provider quirk.

**Why it is a product decision, not just engineering:** the likely answer — wallet/store credit on a BANHAO balance, with manual PromptPay transfer as an exception path — changes what the documented refund rules *mean* to a customer, and introduces a stored-value concept that may itself have regulatory implications (see Q-002, and the e-money category in `ai/RESEARCH/THAILAND_COMPLIANCE.md` §2).

**Blocking:** Payment implementation; the refund UX in the Customer App; possibly the legal structure question.

**Candidates:** Wallet/store credit; manual bank transfer; cash refund via driver; or restricting cancellation windows further. None documented in repository.

**Decision:** TBD
