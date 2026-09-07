# Decision Log

Every entry below is evidenced by content already in this repository — either a git commit, an explicit statement inside a design canvas, or an explicit human instruction given directly to an AI session (cited as such). Where the source states a decision but not its alternatives, that is recorded honestly as "Not documented in source" rather than invented. Where no evidence exists at all, this log says `Historical decision not verified.` instead of guessing.

**Format note (v2):** this file was migrated on 2026-08-09 to the richer per-decision format used by the AI Memory System v2 (`Status / Date / Owner / Decision / Why / Alternatives / Consequences / Evidence / Related Requirements / Related Architecture / Supersedes / Superseded By`). No decision's meaning, evidence, or date was changed in the migration — only the field structure. See `ai/KNOWLEDGE/EVENTS.md` EVENT-004.

---

## Index

| ID | Decision | Status | Date | Related documents |
|---|---|---|---|---|
| DEC-001 | Reorganise repository into docs/design/assets/specs/archive | ACCEPTED | 2026-08-09 | `docs/AI_CONTEXT.md` |
| DEC-002 | Order State and Payment State are separate state machines | ACCEPTED | design drop | `docs/ARCHITECTURE.md`, CON-001 |
| DEC-003 | Payment confirmation is webhook-only | ACCEPTED | design drop | `docs/PAYMENT_LIFECYCLE.md`, CON-002 |
| DEC-004 | Driver-collected cash is a platform liability | ACCEPTED · dormant in Phase 1 (DEC-016) | design drop | `docs/SETTLEMENT_MODEL.md`, REQ-001 |
| DEC-005 | Generic domain entities, not food-specific naming | ACCEPTED | design drop | `docs/DOMAIN_MODEL.md`, REQ-004 |
| DEC-006 | Driver App as Flutter; Merchant/Admin desktop-first web | ACCEPTED · superseded by DEC-012 | design drop | — |
| DEC-007 | Phase 1 scope discipline: never lengthen the core path | ACCEPTED | design drop | CON-004 |
| DEC-008 | AI Memory System is filesystem-based only | ACCEPTED | 2026-08-09 | `ai/README.md` |
| DEC-009 | Modular monolith backend architecture | ACCEPTED | 2026-08-09 | `apps/api/src/modules/README.md` |
| DEC-010 | Supabase (PostgreSQL + PostGIS) as database and platform | ACCEPTED | 2026-08-09 | `supabase/README.md` |
| DEC-011 | NestJS + TypeScript for the backend | ACCEPTED | 2026-08-09 | `apps/api/` |
| DEC-012 | React Native + Expo for mobile; Next.js for admin | ACCEPTED | 2026-08-09 | `apps/` |
| DEC-013 | Monorepo with pnpm and Turborepo | ACCEPTED | 2026-08-09 | `pnpm-workspace.yaml` |
| DEC-014 | PostgreSQL is the system of record for financial data | ACCEPTED | 2026-08-09 | `docs/SETTLEMENT_MODEL.md` |
| DEC-015 | Payment provider access via abstraction layer only | ACCEPTED | 2026-08-09 | `docs/PAYMENT_LIFECYCLE.md` |
| **DEC-016** | **Phase 1 is online payment only; COD disabled but extensible** | **ACCEPTED** | **2026-08-10** | `docs/BUSINESS_RULES.md`, `docs/PAYMENT_LIFECYCLE.md` |
| **DEC-017** | **One cart = one restaurant** | **ACCEPTED** | **2026-08-10** | `docs/BUSINESS_RULES.md`, `docs/DOMAIN_MODEL.md` |
| **DEC-018** | **Order, Payment, Delivery and Settlement are four separate state domains** | **ACCEPTED** | **2026-08-10** | `docs/DOMAIN_MODEL.md`, CON-001 |
| **DEC-019** | **Approved Order core lifecycle, with PREPARING and RIDER_SEARCHING in parallel** | **ACCEPTED** | **2026-08-10** | `docs/ORDER_LIFECYCLE.md` |
| **DEC-020** | **Rider search starts at MERCHANT_ACCEPTED; dispatch is broadcast → first accept** | **ACCEPTED** | **2026-08-10** | `docs/RIDER_LIFECYCLE.md` |
| **DEC-021** | **Rider cancellation reassigns; it never cancels the order** | **ACCEPTED** | **2026-08-10** | `docs/RIDER_LIFECYCLE.md` |
| **DEC-022** | **No-rider escalates to operator decision; never auto-cancels** | **ACCEPTED** | **2026-08-10** | `docs/RIDER_LIFECYCLE.md` |
| **DEC-023** | **Delivery fee funds rider compensation (model only)** | **ACCEPTED — MODEL** · pricing resolved by DEC-035 | **2026-08-10** | `docs/SETTLEMENT_MODEL.md` |
| **DEC-024** | **Service fee is BANHAO revenue (model only)** | **ACCEPTED — MODEL** · amount resolved by DEC-036 | **2026-08-10** | `docs/SETTLEMENT_MODEL.md` |
| **DEC-025** | **Merchant commission is BANHAO revenue (model only)** | **ACCEPTED — MODEL · OPEN — RATE** | **2026-08-10** | `docs/SETTLEMENT_MODEL.md` |
| **DEC-026** | **Settlement is a separate financial domain** | **ACCEPTED — DOMAIN · NOT IMPLEMENTED** | **2026-08-10** | `docs/SETTLEMENT_MODEL.md` |
| **DEC-027** | **Refund belongs to the payment domain, not order cancellation** | **ACCEPTED** | **2026-08-10** | `docs/PAYMENT_LIFECYCLE.md` |
| **DEC-028** | **Payment operations must be idempotent** | **ACCEPTED** | **2026-08-10** | `docs/PAYMENT_LIFECYCLE.md`, REQ-003 |
| **DEC-029** | **Late payment must be resolvable to an order and attempt** | **ACCEPTED — TECHNICAL · OPEN — POLICY** | **2026-08-10** | `docs/PAYMENT_LIFECYCLE.md` |
| **DEC-030** | **Duplicate payment must never increase an order's value** | **ACCEPTED** | **2026-08-10** | `docs/PAYMENT_LIFECYCLE.md` |
| **DEC-031** | **Buntharik-first: manual operations are an intentional Phase 1 capability** | **ACCEPTED** | **2026-08-10** | `docs/BUSINESS_RULES.md` |
| **DEC-032** | **Operator fallback for exceptional situations (capability, not an app)** | **ACCEPTED — REQUIREMENT · NOT IMPLEMENTED** | **2026-08-10** | `docs/BUSINESS_RULES.md` |
| **DEC-033** | **Multi-role identity: domain membership, not a single `profiles.role`** | **ACCEPTED** | **2026-08-11** | `docs/DATABASE_DESIGN.md` |
| **DEC-034** | **Phase 1 financial integrity without a zero-sum database trigger** | **ACCEPTED** | **2026-08-11** | `docs/DATABASE_DESIGN.md` |
| **DEC-035** | **Phase 1 delivery fee is flat ฿10 (1000 satang), no distance component** | **ACCEPTED** | **2026-08-24** | `docs/BUSINESS_RULES.md` § 5.2, BQ-026 |
| **DEC-036** | **Phase 1 service fee is a fixed ฿5 (500 satang)** | **ACCEPTED** | **2026-08-24** | `docs/BUSINESS_RULES.md` § 5.3, BQ-027 |
| **DEC-037** | **Phase 1 dispatch parameters: 60 s accept window, one active delivery per rider, no eligibility radius** | **ACCEPTED** | **2026-08-24** | `docs/RIDER_LIFECYCLE.md` § 6, BQ-020, BQ-021, BQ-022 (part) |
| **DEC-038** | **Proof of delivery is a mandatory photo, stored in a private bucket, with no no-photo completion path** | **ACCEPTED** | **2026-08-26** | `docs/RIDER_LIFECYCLE.md` § 10, BQ-018 |
| **DEC-039** | **POD retention: 90 days (referenced) / 7 days (orphan), automatic purge via the tick — Q-012's lawful basis stays `LEGAL_REVIEW_REQUIRED`** | **ACCEPTED — DURATION ONLY · NOT A PDPA/GO-LIVE APPROVAL** | **2026-08-26** | `apps/api/src/modules/rider/pod-retention-policy.ts`, Q-012 |
| **DEC-040** | **Phase J — AI Operations + Human Supervisor is an authorized future phase, after Phase I; AI orchestrates within an explicit command catalog and never holds domain, database or financial authority** | **ACCEPTED — PHASE AUTHORIZATION · IMPLEMENTATION STARTED 2026-09-03 (see the entry's implementation-status section)** | **2026-09-03** | `docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html`, `supabase/migrations/20260903000001_audit_logs_ai_actor_type.sql` |
| **DEC-041** | **Merchant operational availability (M-AV): a separate additive field on `restaurants`, never `status`, never the temporary-closure columns** | **ACCEPTED — STORAGE AND TRANSITION MODEL ONLY · NOT an answer to BQ-013, BQ-007, AV-Q03** | **2026-09-04** | `supabase/migrations/20260904000001_restaurant_availability_mode.sql` |
| **DEC-042** | **The customer-quoted preparation estimate is persisted on the order (AC-04)** | **ACCEPTED** | **2026-09-04** | `supabase/migrations/20260904000002_orders_customer_quoted_prep_minutes.sql` |
| **DEC-043** | **Merchant commission rate: 8% of the food subtotal, rounded to whole baht** | **ACCEPTED** | **2026-09-05** | `docs/SETTLEMENT_MODEL.md` § 5, `apps/api/src/modules/payments/commission-pricing.ts`, Q-010/BQ-028 |
| **DEC-044** | **Rider earning model: flat ฿12 (1200 satang) per completed delivery** | **ACCEPTED** | **2026-09-05** | `docs/SETTLEMENT_MODEL.md` § 8, `docs/RIDER_LIFECYCLE.md` § 9, BQ-029 |
| **DEC-045** | **The ฿2 (200 satang) delivery funding gap between the ฿10 delivery fee and the ฿12 rider earning is a BANHAO `PLATFORM_WRITE_OFF`** | **ACCEPTED** | **2026-09-05** | `docs/SETTLEMENT_MODEL.md` § 3, § 4.1, § 8, BQ-040 |
| **DEC-046** | **Promotion/discount funder model: platform or merchant, per promotion, no split (Option C)** | **ACCEPTED** | **2026-09-05** | `docs/SETTLEMENT_MODEL.md` § 3, § 10, `docs/BUSINESS_RULES.md` § 11, BQ-030 (funder half) |
| **DEC-047** | **Phase 1 service fee revenue recognition: `PLATFORM_REVENUE` at the successful-payment economic-finality point** | **ACCEPTED — RECOGNITION TIMING · IMPLEMENTED 2026-09-06** | **2026-09-06** | `docs/SETTLEMENT_MODEL.md` § 3.2, `apps/api/src/modules/payments/payment-event-processing.service.ts`, BQ-027 (timing half) |
| **DEC-048** | **Service fee refundability: included in an eligible full order refund (Option A)** | **ACCEPTED — REFUNDABILITY · NOT IMPLEMENTED** | **2026-09-06** | `docs/SETTLEMENT_MODEL.md` § 9, `docs/OPEN_BUSINESS_QUESTIONS.md` BQ-027 (resolved) |
| **DEC-049** | **Refund ledger architecture: independent reversal groups over a mutable refund domain record; no `REFUND_PAYABLE` bridge, no zero-sum requirement, posting only at verified refund finality** | **ACCEPTED — ARCHITECTURE · NOT IMPLEMENTED** | **2026-09-07** | `docs/SETTLEMENT_MODEL.md` § 3.1, § 3.2, § 9, § 11.1, `supabase/migrations/20260811000007_ledger_domain.sql` |
| **DEC-050** | **Phase 1 cancellation window and refund eligibility: free through `MERCHANT_ACCEPTED`, no cancellation fee, merchant-confirmed `PREPARING` cancellation is a full refund** | **ACCEPTED — POLICY · RUNTIME NOT IMPLEMENTED** | **2026-09-07** | `docs/BUSINESS_RULES.md` § 2.4, `docs/ORDER_LIFECYCLE.md` § 5, `docs/PAYMENT_LIFECYCLE.md` § 8, BQ-016 (resolved) |
| **DEC-051** | **Cooked-food loss is allocated by cause — platform-caused to BANHAO (`PLATFORM_WRITE_OFF`), merchant-caused to the merchant — from `PREPARING` onward, valued at `orders.subtotal_satang`** | **ACCEPTED — POLICY · RUNTIME NOT IMPLEMENTED** | **2026-09-07** | `docs/SETTLEMENT_MODEL.md` § 3, § 9, `docs/ORDER_LIFECYCLE.md` § 5, § 6, BQ-015 (resolved) |
| **DEC-052** | **Customer-caused pre-pickup cooked-food loss is absorbed by BANHAO (`PLATFORM_WRITE_OFF`) — a narrow clarification closing DEC-051's recorded residual** | **ACCEPTED — POLICY · RUNTIME NOT IMPLEMENTED** | **2026-09-07** | `docs/DECISIONS.md` DEC-051, `docs/SETTLEMENT_MODEL.md` § 9, BQ-015 (remains resolved) |
| **DEC-053** | **Post-pickup delivery failure: operator-resolved `DELIVERY_FAILED` / delivery `FAILED`, 2 contact attempts + 5-minute wait from `ARRIVED`, cause-dependent economics** | **ACCEPTED — POLICY · RUNTIME NOT IMPLEMENTED** | **2026-09-07** | `docs/ORDER_LIFECYCLE.md` § 4, § 5, § 6, `docs/SETTLEMENT_MODEL.md` § 9, BQ-017 (resolved) |
| **DEC-054** | **Customer-arrival anchor `EN_ROUTE → ARRIVED` (distinct from `AT_MERCHANT`), and a narrow DEC-APP-006 carve-out letting DEC-053 use `DELIVERY_FAILED` while BQ-013 stays `OPEN`** | **ACCEPTED — POLICY / ARCHITECTURE · RUNTIME NOT IMPLEMENTED** | **2026-09-07** | `docs/RIDER_LIFECYCLE.md` § 4, `docs/BANHAO-APP-ARCHITECTURE-V1.md` (DEC-APP-006), DEC-053 |
| **DEC-D-01** | **Cart validation returns a subtotal only; unknowable fees render as `คำนวณเมื่อยืนยัน`** | **ACCEPTED** | **2026-08-18** | `docs/design/BANHAO-UX-SPEC-V1.md` § C-09 |
| **DEC-D-02** | **The persisted Supabase cart is the cart source of truth** | **ACCEPTED** | **2026-08-18** | `supabase/migrations/20260811000004_cart_domain.sql` |
| **DEC-D-03** | **No guest cart: an unauthenticated user cannot add to a cart** | **ACCEPTED** | **2026-08-18** | `supabase/migrations/20260811000011_rls_policies.sql` |
| **DEC-E-01** | **No production order may be created while BQ-026/BQ-027 fee amounts are OPEN** | **ACCEPTED** | **2026-08-19** | `supabase/migrations/20260811000005_order_domain.sql` |
| **DEC-E-02** | **Order creation is atomic, via an additive `SECURITY INVOKER` Postgres function** | **ACCEPTED — MECHANISM · NOT IMPLEMENTED** | **2026-08-19** | `supabase/migrations/20260811000013_rider_reassignment_atomicity.sql` |
| **DEC-E-03** | **`order_number` is `BH-YYYYMMDD-NNNN`, generated server-side on the Asia/Bangkok business day** | **ACCEPTED** | **2026-08-19** | `docs/OPEN_DATABASE_QUESTIONS.md` DBQ-011 |
| **DEC-E-04** | **Order address snapshots come from the authenticated customer's server-validated address; zone checks stay OPEN** | **ACCEPTED** | **2026-08-19** | `apps/api/src/modules/users/addresses.controller.ts` |
| **DEC-E-05** | **Phase E implementation boundary — what the order phase may and may not build** | **ACCEPTED** | **2026-08-19** | `docs/BANHAO-APP-ARCHITECTURE-V1.md` §19 |

DEC-016 through DEC-032 were approved by the Product Owner in the Business
Decision Workshop and locked on 2026-08-10 — see `ai/KNOWLEDGE/EVENTS.md`
EVENT-014. DEC-033 and DEC-034 were approved on 2026-08-11 — EVENT-017.

> ### ⚠️ Numbering note — DEC-033 / DEC-034
>
> The 2026-08-11 approval instruction labelled these two decisions **"DEC-014 —
> Multi-role Identity Model"** and **"DEC-015 — Phase 1 Financial Integrity"**.
> **Those IDs were already taken** by DEC-014 (PostgreSQL is the system of record)
> and DEC-015 (payment provider abstraction), both `ACCEPTED` on 2026-08-09 and
> cited across 17 and 21 files respectively — including a code comment in
> `apps/api/src/modules/payments/payment-provider.interface.ts`.
>
> Reusing those numbers would have silently redefined two decisions the whole
> repository depends on, so the new decisions were given the **next free IDs**
> instead. The instruction's own rule — *"Do NOT overwrite an existing ID"* —
> points the same way.
>
> | Approval label | Recorded as | Not to be confused with |
> |---|---|---|
> | "DEC-014 — Multi-role Identity Model" | **DEC-033** | DEC-014 — PostgreSQL is the system of record |
> | "DEC-015 — Phase 1 Financial Integrity" | **DEC-034** | DEC-015 — Payment provider abstraction |
>
> Both original decisions remain `ACCEPTED` and unchanged.

---

## DEC-001 — Reorganize repository into docs/design/assets/specs/archive structure

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** HUMAN (repository owner, via explicit task instruction to an AI session; work was reviewed and built upon in subsequent sessions without being reverted)

### Decision

Reorganize the repository from a flat `design/` folder into `docs/`, `design/`, `assets/`, `specs/`, `archive/` (numbered lifecycle stages under `docs/`, one folder per surface under `design/`).

### Why

Long-term maintainability as the project grows past a single design drop; scaffold matched the requested structure.

### Alternatives

Not documented in source.

### Consequences

`support.js` (the design-canvas runtime) had to be duplicated 4× to keep each `.dc.html` file's relative `./support.js` reference working without editing file content (see FACT-010, `docs/CHANGELOG.md`).

### Evidence

git commit `f3939d6` "create structure project files"; current directory layout.

### Related Requirements

None directly.

### Related Architecture

`docs/AI_CONTEXT.md` § Repository Structure.

### Supersedes

None.

### Superseded By

None.

---

## DEC-002 — Order State and Payment State are separate state machines

**Status:** ACCEPTED
**Date:** Not documented (predates AI involvement — present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Order State and Payment State are modeled as two separate, parallel state machines and must never be collapsed into one field.

### Why

Quoted from source: "ออเดอร์หนึ่งใบมีสองสถานะเดินคู่กันเสมอ ห้ามยุบเป็นสถานะเดียว เพราะออเดอร์ที่ยกเลิกแล้วยังมีเงินค้างอยู่ในระบบจนกว่าจะคืนเสร็จ" — a cancelled order can still have money sitting in the system until the refund finishes, so a single merged state would hide that.

### Alternatives

Not documented in source.

### Consequences

Any future implementation must persist Order state and Payment state as independent fields/tables with an explicit mapping between them (see the pairing table in `docs/ARCHITECTURE.md`). Implementation itself has not started.

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, section "02 — STATE MACHINE".

### Related Requirements

None directly (this decision underlies CON-001, not a positive requirement).

### Related Architecture

`docs/ARCHITECTURE.md` § Payment State Machine; `ai/KNOWLEDGE/CONSTRAINTS.md` CON-001.

### Supersedes

None.

### Superseded By

None.

---

## DEC-003 — Payment confirmation is webhook-only

**Status:** ACCEPTED
**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Payment confirmation must come only from a verified provider webhook — never from client-reported state.

### Why

Quoted from source: "แอปไม่ใช่ผู้ตัดสินว่าจ่ายสำเร็จหรือยัง มีแต่ backend ที่ได้รับการยืนยันจากผู้ให้บริการชำระเงินเท่านั้นที่ตัดสินได้" — the app is never the judge of payment success; only a backend confirmed by the payment provider can decide.

### Alternatives

Not documented in source.

### Consequences

`SUCCESS` and `REFUNDED` payment states are marked "actor: Webhook เท่านั้น" (webhook only) in the state table — no other code path may set them. Every webhook handler must be idempotent, keyed on a single payment reference.

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, sections "01 — ARCHITECTURE" and "02 — STATE MACHINE".

### Related Requirements

REQ-003 (idempotent webhook processing).

### Related Architecture

`docs/ARCHITECTURE.md` § Payment Confirmation Flow; `ai/KNOWLEDGE/CONSTRAINTS.md` CON-002.

### Supersedes

None.

### Superseded By

None.

---

## DEC-004 — Driver-collected cash is a platform liability, not driver income

**Status:** ACCEPTED
**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Cash a driver collects from a customer is recorded as a liability owed to the platform ("Cash Collection"), not as driver income, and must be shown separately from actual driver earnings in any driver-facing UI.

### Why

Quoted from source: "ไรเดอร์เป็นคนถือเงินของแพลตฟอร์มไว้ชั่วคราว ระบบจึงต้องบันทึกเป็นหนี้ที่ไรเดอร์ต้องนำส่ง … ไม่งั้นไรเดอร์จะเข้าใจว่าเงินในกระเป๋าคือรายได้ทั้งหมด" — a driver temporarily holds the platform's money; without separating it, a driver would mistake all the cash in hand for personal income.

### Alternatives

Not documented in source.

### Consequences

Driver earnings UI must show "รายได้วันนี้" (today's earnings) and "เงินสดที่เก็บมาแทนบ้านเฮา" (cash collected on the platform's behalf) as two distinct numbers (see wireframe `P-D2`).

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, section "04 — LEDGER" and wireframe `P-D2`.

### Related Requirements

REQ-001.

### Related Architecture

`docs/ARCHITECTURE.md` § Ledger Model; `ai/KNOWLEDGE/CONSTRAINTS.md` CON-003.

### Supersedes

None.

### Superseded By

None.

---

## DEC-005 — Domain model uses generic entities, not food-specific naming

**Status:** ACCEPTED
**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Model the domain around five generic entities — Merchant, Product, Order, Delivery, Driver — instead of food-specific naming (e.g. not "Restaurant", not "Dish").

### Why

Quoted from source: "คอมโพเนนต์ทุกตัวจึงตั้งชื่อตาม entity กลาง (Merchant, Product, Order, Delivery) ไม่ผูกกับคำว่า 'ร้านอาหาร'" — components are named after the central entity, not tied to the word "restaurant" — explicitly to support Phase 2–4 (Parcel, Ride, Shopping) without a rewrite.

### Alternatives

Not documented in source.

### Consequences

The scaling table in `docs/05-architecture` shows how each entity's meaning shifts per phase (e.g. `Product` = menu item in Food, vehicle type in Ride) while the entity name and, by extension, the schema shape stay constant.

### Evidence

`design/design-system/BANHAO Design System.dc.html:34`; `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "06 — SCALING".

### Related Requirements

REQ-004.

### Related Architecture

`docs/ARCHITECTURE.md` § Core Entities.

### Supersedes

None.

### Superseded By

None.

---

## DEC-006 — Driver App intended as Flutter mobile; Merchant/Admin as desktop-first web

**Status:** ACCEPTED (as a documented design-time intention — see caveat below)
**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Driver App is planned as a mobile app built with Flutter. Merchant Web and Admin Web are planned as desktop-first responsive web apps (no framework specified).

### Why

Not documented in source beyond the platform label itself — no rationale text accompanies this choice.

### Alternatives

Not documented in source.

### Consequences

This is the only concrete implementation-technology signal anywhere in the repository. It should be treated as a design-time intention to confirm with whoever owns the technical stack, not as a locked decision — no rationale is recorded for it, and no backend/frontend technology decision has been made to go with it (see Q-006, Q-007).

### Evidence

`docs/05-architecture/BANHAO Product Architecture.dc.html`, section "02 — SITEMAP" sitemap data (`platform:'Mobile · Flutter'`, `platform:'Responsive · Desktop first'`, `platform:'Desktop first'`).

### Related Requirements

None directly.

### Related Architecture

`docs/ARCHITECTURE.md` § Frontend; `ai/KNOWLEDGE/FACTS.md` FACT-008; `ai/KNOWLEDGE/ASSUMPTIONS.md` ASM-001.

### Supersedes

None.

### Superseded By

None.

---

## DEC-007 — Phase 1 scope discipline: never lengthen the core path

**Status:** ACCEPTED
**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`, 2026-08-09)
**Owner:** PRODUCT_OWNER (embedded in the original design canvas as shipped/committed by the repository's original author)

### Decision

Any feature that lengthens the Phase 1 core path (open app → choose shop → choose food → order → wait → receive) — even by one step — is deferred to a later phase. Unavailable services appear as dimmed, unclickable "coming soon" cards with no destination screen.

### Why

Quoted from source: "หลักตัดสินใจตลอด Phase 1" — the deciding principle throughout Phase 1.

### Alternatives

Not documented in source.

### Consequences

Future scope requests for Phase 1 should be evaluated against this rule before being added; this is the basis for treating Driver/Merchant/Admin apps as out of scope for the current design pass.

### Evidence

`docs/05-architecture/BANHAO Product Architecture.dc.html`, section "01 — STRATEGY".

### Related Requirements

None directly.

### Related Architecture

`ai/KNOWLEDGE/CONSTRAINTS.md` CON-004.

### Supersedes

None.

### Superseded By

None.

---

## DEC-008 — AI Memory System is filesystem-based only (Markdown + Git, no database)

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** HUMAN (explicit instruction in the task that created the AI Memory System v2: "ห้ามเพิ่ม database / vector database / embedding service / external SaaS / API server … ใช้ Markdown, Git, Directory Structure เท่านั้น")

### Decision

The BANHAO AI Memory System (`ai/`, `docs/`) is implemented entirely as Markdown files in Git, organized by directory structure. No database, vector database, embedding service, external SaaS, or API server may be added to implement it.

### Why

Explicit human instruction, given directly to the AI session that built the memory system, rather than inferred from any design document.

### Alternatives

Not documented in source (a database or vector-search-backed memory system was implicitly ruled out by the instruction, but no comparison was recorded).

### Consequences

Memory scales by file organization and cross-referencing (IDs like `FACT-NNN`, `DEC-NNN`) rather than by query; `ai/MEMORY.md` and `ai/HANDOFF.md` are kept deliberately short to stay readable as the system grows (see `ai/README.md` § No Database, and the size-management rule in the originating task instructions).

### Evidence

Human task instructions during the 2026-08-09 AI Memory System v2 session (this is a direct instruction to the AI, not a document already in the repository prior to this session — recorded per the Source of Truth hierarchy in `ai/README.md`, "Human / Product Owner Decision" is the top of the chain).

### Related Requirements

None directly.

### Related Architecture

`ai/KNOWLEDGE/ARCHITECTURE.md`; `ai/README.md` § No Database.

### Supersedes

None.

### Superseded By

None.

---

## Historical decisions not verified

No other product or architecture decisions have recorded evidence in this repository (e.g. why อ.บุณฑริก was chosen as the launch area, why Phase order is Food → Parcel → Ride → Shopping, why PromptPay specifically). These are treated as given product facts from the project brief, not decisions this log can source or date. `Historical decision not verified.`

---

## DEC-009 — Modular Monolith backend architecture

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

The backend is a single deployable NestJS service organised into internal modules (auth, users, merchants, restaurants, catalog, orders, payments, refunds, ledger, settlements, drivers, delivery, notifications, admin). Microservices are explicitly excluded.

### Why

CON-001 and CON-003 — the project's two hardest constraints — are about transactional correctness between Order, Payment, and Ledger. A monolith gets that from a single database transaction; a service split would require distributed-transaction patterns to achieve the same guarantee. Stage 1–2 volumes present no scaling problem microservices would solve, and the team is one founder using AI.

### Alternatives

Microservices, serverless, and distributed event-driven were all researched (`ai/RESEARCH/ARCHITECTURE_PATTERN.md`) and rejected as disproportionate to current scale and harmful to the money-correctness constraints.

### Consequences

Module boundaries must be enforced by discipline — no cross-module table access. A module can be extracted later if a concrete scaling need appears.

### Evidence

Product Owner instruction, 2026-08-09 session. Research basis: `ai/RESEARCH/ARCHITECTURE_PATTERN.md`, PROP-001.

### Related Requirements

REQ-002

### Related Architecture

`apps/api/src/modules/README.md`

### Supersedes / Superseded By

PROP-001 (accepted) / None.

---

## DEC-010 — Supabase (PostgreSQL + PostGIS) as database and platform

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

Supabase provides PostgreSQL, PostGIS, Auth, Storage, and Realtime. This resolves **Q-007**.

### Why

PostgreSQL was the highest-confidence recommendation in the research: the only option best-in-class on all three criteria BANHAO's constraints weight — Serializable Snapshot Isolation for ledger integrity, PostGIS indexed KNN for driver matching, and GIN-indexed `jsonb` for phase-generic entities. Supabase bundles auth, storage, and realtime, which suits a solo founder.

### Alternatives

MySQL/MariaDB and MongoDB were researched (`ai/RESEARCH/DATABASE_COMPARISON.md`). MongoDB was rejected because multi-document transactions work against the grain of a financial ledger.

### Consequences

PostgreSQL is the system of record for financial data (DEC-014). Row Level Security must be maintained as a second line of defence. PgBouncer-style connection pooling will be needed as load grows — Supabase provides this.

### Evidence

Product Owner instruction, 2026-08-09. Research basis: `ai/RESEARCH/DATABASE_COMPARISON.md`.

### Related Requirements

REQ-004

### Related Architecture

`supabase/README.md`

### Supersedes / Superseded By

None / None.

---

## DEC-011 — NestJS + TypeScript for the backend

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

The API is NestJS with TypeScript, exposing REST with OpenAPI. This resolves **Q-006**.

### Why

Research found a genuine three-way trade (NestJS / Laravel / Go) with no objective winner, and identified team capability as the deciding input. The Product Owner is a solo founder using AI as the development team — NestJS's enforced structure and TypeScript's compile-time feedback are the strongest fit for AI-assisted development, and TypeScript is shared with all four client apps.

### Alternatives

Laravel (deepest Thai hiring pool, best queue tooling) and Go (best real-time efficiency, runs at Grab) — see `ai/RESEARCH/BACKEND_COMPARISON.md`.

### Consequences

One language across backend and all clients, so shared packages work without a language boundary. Note Laravel's Horizon has no NestJS equivalent — queue supervision will need assembling when background jobs are built.

### Evidence

Product Owner instruction, 2026-08-09. Research basis: `ai/RESEARCH/BACKEND_COMPARISON.md`.

### Related Requirements

REQ-002, REQ-003

### Related Architecture

`apps/api/`

### Supersedes / Superseded By

None / None.

---

## DEC-012 — React Native + Expo for mobile; Next.js for admin

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

Customer, Merchant, and Driver apps are React Native + Expo with TypeScript. Admin is Next.js with TypeScript.

### Why

Keeps one language (TypeScript) across every surface, so `@banhao/types`, `@banhao/validation`, and `@banhao/api-client` are shared directly rather than duplicated or generated across a language boundary.

### Alternatives

Flutter for the Driver App was the previously documented design-time intention (DEC-006), with no recorded rationale.

### Consequences

**This supersedes DEC-006's Flutter intention.** Sharing types across all four apps is now a compile-time guarantee. The Merchant app is React Native rather than the "Responsive · Desktop first" web the design sitemap assumed — worth revisiting against the design's tablet-behind-the-counter use case when Merchant UI work starts.

### Evidence

Product Owner instruction, 2026-08-09.

### Related Architecture

`apps/customer/`, `apps/merchant/`, `apps/driver/`, `apps/admin/`

### Supersedes / Superseded By

Supersedes DEC-006 (Flutter driver-app intention) / None.

---

## DEC-013 — Monorepo with pnpm and Turborepo

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

One repository containing all apps and shared packages, managed with pnpm workspaces and Turborepo.

### Why

CON-001 and REQ-002 require all four clients to agree on the same Order and Payment state values. A shared types package makes that a compile-time guarantee rather than a process one. Also preserves this repository as the single source of truth, which the AI Memory System depends on.

### Alternatives

Multiple repositories — rejected because it fragments the memory system and weakens the shared-contract guarantee (`ai/RESEARCH/REPOSITORY_STRATEGY.md`).

### Consequences

CI must stay scoped as the repo grows; Turborepo caching handles this.

### Evidence

Product Owner instruction, 2026-08-09. Research basis: PROP-002.

### Related Architecture

`pnpm-workspace.yaml`, `turbo.json`

### Supersedes / Superseded By

PROP-002 (accepted) / None.

---

## DEC-014 — PostgreSQL is the system of record for financial data

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

PostgreSQL is the sole system of record for `orders`, `payments`, `refunds`, `ledger_entries`, and `settlements`. Supabase Realtime, Redis, and frontend state are projections and must never be treated as financial truth. Every financial operation must be idempotent, auditable, and transactional.

### Why

CON-003 requires every order's ledger to balance to exactly zero. That guarantee is only meaningful if one store is authoritative. Realtime and caches are lossy by design.

### Alternatives

Not documented — this follows directly from CON-003.

### Consequences

Financial tables need unique constraints on operation keys (idempotency), append-only ledger entries corrected by reversing entries, and order/ledger changes committed in one transaction. This applies from the first financial migration, not retrofitted.

### Evidence

Product Owner instruction, 2026-08-09. Constraint basis: CON-003, REQ-003.

### Related Requirements

REQ-003

### Related Architecture

`supabase/README.md`

### Supersedes / Superseded By

None / None.

---

## DEC-015 — Payment provider access via abstraction layer only

**Status:** ACCEPTED
**Date:** 2026-08-09
**Owner:** PRODUCT_OWNER

### Decision

All payment provider access goes through a `PaymentProvider` interface. No business logic may import a provider SDK directly. **No provider is selected — Q-001 remains OPEN.**

### Why

Q-001 (provider) is downstream of Q-002 (legal/settlement model), which needs Thai legal review. The abstraction lets the foundation be built now without prejudging that answer, and keeps provider choice reversible.

### Alternatives

Integrating a provider now — rejected as premature given the open legal question and the finding that no provider supports native PromptPay refunds (Q-020).

### Consequences

`NullPaymentProvider` throws on every operation deliberately, so money paths cannot silently appear functional. Provider SDK imports are confined to `payments/providers/`.

### Evidence

Product Owner instruction, 2026-08-09. Research basis: `ai/RESEARCH/PAYMENT_RESEARCH.md`.

### Related Requirements

REQ-003

### Related Architecture

`apps/api/src/modules/payments/payment-provider.interface.ts`

### Supersedes / Superseded By

None / None.

---

## DEC-016 — Phase 1 is online payment only; Cash on Delivery is disabled but the model stays extensible

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

Phase 1 launches with **online payment only**. **Cash on Delivery is disabled.**
COD must **not** be hard-coded as permanently unsupported: `payment_method`
remains an extensible concept so COD can be reintroduced later without
redesigning Order, Payment, Delivery or Settlement.

### Why

Product Owner decision in the Business Decision Workshop, 2026-08-10. Online-only
removes the entire cash-handling surface from a Phase 1 operated by one person:
no rider float, no cash remittance, no cash reconciliation, no cash-limit
dispatch blocking, and no OCPB cash-on-delivery exposure at launch.

### Alternatives

Cash + PromptPay, as the original design canvas specified for Phase 1
("Phase 1 เงินสด + พร้อมเพย์ QR"). Rejected for this phase.

### Consequences

**This supersedes the design canvas's Phase 1 payment scope.** Specifically:

- `docs/04-payment` documents an entire cash subsystem — rider collection,
  change calculation, cash-as-liability, remittance, cash-limit auto-blocking,
  and cash-order fee netting. **All of it is deferred, none of it is deleted.**
- **DEC-004 and REQ-001 remain ACCEPTED but dormant.** Cash collected by a rider
  is still a platform liability and must still be displayed separately from
  earnings — there is simply no cash in Phase 1. Do not remove either record.
- Payment states `CASH_PENDING` and `CASH_COLLECTED` stay in the payment model,
  unreachable in Phase 1.
- **Q-004** (cash remittance limit) and the cash portion of **Q-017** (OCPB
  "Dee-Delivery") stop being Phase 1 blockers. They remain `OPEN` for the phase
  that reintroduces COD.
- **BQ-023** (rider cash float at pickup) is **deferred, not resolved** — the
  underlying question returns unchanged with COD.
- ⚠️ **This makes Q-001 and Q-020 strictly more blocking, not less.** With cash
  removed, 100% of Phase 1 revenue depends on a payment provider that has not
  been selected, and 100% of refunds depend on a PromptPay refund mechanism that
  research found no provider supports natively. There is no longer a cash
  fallback for either.
- ⚠️ Demand-side risk to monitor, not resolved here: a customer without a
  banking app cannot order at all in Phase 1.
- The Customer App currently implements a cash option at checkout (screen 10)
  and a cash-prepared-amount selector. **That UI must be disabled** — tracked as
  follow-up work, not done in this documentation step.

### Evidence

Product Owner approval, 2026-08-10 Business Decision Workshop (Step 4.2
instruction, sections 3 and 18).

### Related Requirements

REQ-001 (dormant in Phase 1)

### Related Architecture

`docs/BUSINESS_RULES.md` § 10, `docs/PAYMENT_LIFECYCLE.md`,
`docs/SETTLEMENT_MODEL.md`

### Supersedes

The Phase 1 payment scope stated in `docs/04-payment/BANHAO Payment
Architecture.dc.html` (cash + PromptPay) — for Phase 1 only.

### Superseded By

None.

---

## DEC-017 — One cart equals one restaurant

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

A customer cannot build a multi-restaurant cart in Phase 1. One `Cart` belongs
to exactly one `Restaurant`.

### Why

Product Owner decision, 2026-08-10. Multi-merchant carts multiply dispatch
complexity — multi-pickup routing against a pool of 8–12 riders — and would
lengthen the core path, which CON-004 forbids.

### Alternatives

Multiple merchants in one delivery (rejected: routing complexity); multiple
merchants split into separate orders (rejected: extra checkout steps for the
same result).

### Consequences

Adding an item from a different restaurant clears or blocks the cart, with an
explicit prompt. `Cart` carries a `restaurant_id`. The delivery fee has exactly
one pickup point to measure from. The Customer App is already built as if this
were true, so no rework is implied. **Resolves BQ-010.**

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 4).

### Related Requirements

None directly.

### Related Architecture

`docs/DOMAIN_MODEL.md` § 4.3, `docs/BUSINESS_RULES.md` § 4

### Supersedes / Superseded By

None / None.

---

## DEC-018 — Order, Payment, Delivery and Settlement are four separate state domains

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The system keeps **four** independent state domains: **Order State**, **Payment
State**, **Delivery State**, **Settlement State**. No giant Order status enum
containing every financial and delivery outcome may be created.

### Why

Product Owner decision, 2026-08-10. This extends DEC-002 and CON-001 from two
domains to four for the same reason the original split existed: a cancelled
order still holds money until the refund completes, and an order whose rider
cancelled is not itself cancelled (DEC-021). Collapsing them hides exactly the
states operations needs to see.

### Alternatives

A single order status enum. Rejected — it is the failure mode DEC-002 was
written to prevent, and it makes DEC-021 and DEC-022 unrepresentable.

### Consequences

Each domain owns its own states, transitions and actors. Cross-domain effects
are explicit mappings, never shared fields. The customer-facing status remains
derived from **Order State** alone (REQ-002); delivery detail is operational.
`OrderState` and `PaymentState` already exist as separate union types in
`apps/customer/src/mocks/types.ts`; `DeliveryState` and `SettlementState` join
them.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 5).

### Related Requirements

REQ-002

### Related Architecture

`docs/DOMAIN_MODEL.md` § 2, `ai/KNOWLEDGE/CONSTRAINTS.md` CON-001

### Supersedes

Extends DEC-002 (two domains → four). DEC-002 remains ACCEPTED and is not
replaced.

### Superseded By

None.

---

## DEC-019 — Approved Order core lifecycle, with PREPARING and RIDER_SEARCHING running in parallel

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The Order core lifecycle is:

```
CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED → PREPARING
        → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED
```

After `MERCHANT_ACCEPTED`, **`PREPARING` (order domain) and `RIDER_SEARCHING`
(delivery domain) are parallel operational processes.** The restaurant must not
wait for rider assignment before starting preparation.

### Why

Product Owner decision, 2026-08-10. Serialising rider search after the food is
ready wastes the only window in which searching is free, and it is the direct
cause of the design's documented `READY → NO_DRIVER` path landing on cooked
food.

### Alternatives

The 2026-08-09 design canvas machine (`NEW → ACCEPTED → PREPARING → READY →
DRIVER_ASSIGNED → …`) with `READY → NO_DRIVER`. Superseded.

### Consequences

**This supersedes the canonical Order state machine documented on 2026-08-09.**

- **Resolves BQ-012.** `PENDING_PAYMENT` is now a real Order state, so the
  Payment State Machine's pairing column is no longer dangling.
- **Resolves BQ-014.** The `READY → NO_DRIVER` contradiction disappears: rider
  search starts at `MERCHANT_ACCEPTED`, so the Customer App's copy
  ("อาหารของคุณยังไม่ถูกปรุง") is consistent with the flow. `NO_DRIVER` ceases to
  be an Order state — the equivalent condition is `RIDER_SEARCHING` in the
  delivery domain (DEC-022).
- State names change: `NEW → PAID`/`MERCHANT_ACCEPTED`, `READY →
  READY_FOR_PICKUP`, `COMPLETED → DELIVERED`, and `DRIVER_ASSIGNED` moves to the
  delivery domain as `RIDER_ASSIGNED`.
- **FACT-005 now describes the historical design artifact, not the canonical
  machine.** It stays VERIFIED as a statement about that document.
- The Customer App's `OrderState` union and its tracking timeline encode the old
  twelve values and **will need updating**. Not done in this step — no code was
  touched.
- Exception states (payment failure, expiry, merchant rejection, customer
  cancellation, delivery failure) are **not** part of this approval. Their names
  remain `PROPOSED` in `docs/ORDER_LIFECYCLE.md`.
- REQ-002 is unaffected in principle: one canonical state, per-role wording.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 6).

### Related Requirements

REQ-002

### Related Architecture

`docs/ORDER_LIFECYCLE.md`, `docs/DOMAIN_MODEL.md`

### Supersedes

The Order State Machine documented in `docs/05-architecture/BANHAO Product
Architecture.dc.html` § 03 and restated in `docs/ARCHITECTURE.md` and FACT-005.

### Superseded By

None.

---

## DEC-020 — Rider search starts at MERCHANT_ACCEPTED; dispatch is broadcast → first accept

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

Rider search begins when the order reaches `MERCHANT_ACCEPTED`. The dispatch
model is **broadcast to eligible online riders, first to accept wins**. No
scoring, ranking or route optimisation in Phase 1.

### Why

Product Owner decision, 2026-08-10. With 8–12 riders the whole district is one
pool, and assignment speed is the only lever that moves the documented ≤5%
no-rider cancellation ceiling. Broadcast is also the least code to build and
maintain for a solo founder.

### Alternatives

Nearest-first sequential offer and zone-based dispatch — both compared in
`docs/RIDER_LIFECYCLE.md` § 5 and rejected for Phase 1: sequential spends
seconds the system does not have, zones fragment a pool too small to fragment.

### Consequences

Every offer is recorded so "why did nobody take this?" is answerable. A
tie-break (fewer jobs today, or nearer the merchant) may be added later without
changing the model. Reassess at Stage 2, roughly past 30 riders. The dispatcher
should sit behind an interface so the model is swappable — the same discipline
DEC-015 applies to payment providers. **Resolves BQ-019.** The accept-window
duration remains `OPEN` (BQ-020) — the design contradicts itself, 20 s in the
wireframe title versus 12 s on its button.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 7).

### Related Requirements

None directly.

### Related Architecture

`docs/RIDER_LIFECYCLE.md` § 5

### Supersedes / Superseded By

None / None.

---

## DEC-021 — A rider cancelling reassigns the delivery; it never cancels the order

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

When a rider accepts and then cancels:

```
RIDER_ASSIGNED → RIDER_REASSIGNING → RIDER_SEARCHING → broadcast
```

The Order is **not** automatically cancelled.

### Why

Product Owner decision, 2026-08-10. A rider changing their mind is a delivery
event, not an order outcome. Cancelling a paid order with cooked food because
one rider dropped it would convert a recoverable delay into a refund, a wasted
meal and a lost customer.

### Alternatives

Auto-cancel and refund. Rejected.

### Consequences

`RIDER_REASSIGNING` exists as a distinct delivery state so operations can see
the difference between "never assigned" and "assigned and lost". Requires
DEC-018's domain separation to be representable at all. Rider compensation for
a job cancelled through no fault of theirs, and any consequence for a rider who
cancels repeatedly, remain `OPEN` (BQ-024).

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 8).

### Related Requirements

None directly.

### Related Architecture

`docs/RIDER_LIFECYCLE.md` § 4

### Supersedes / Superseded By

None / None.

---

## DEC-022 — No rider available escalates to an operator decision; it never auto-cancels

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

When no rider is available:

```
RIDER_SEARCHING → retry → manual dispatch → operator decision
```

An order is **never** cancelled merely because the first rider search failed.
Operator options may include continuing the search, merchant delivery,
cancel + refund, or another approved operational resolution.

### Why

Product Owner decision, 2026-08-10. At launch volume a human can resolve almost
every no-rider case, and an automatic cancellation destroys a recoverable order.

### Alternatives

Auto-cancel after a fixed timeout — the behaviour the 2026-08-09 design implied
via `READY → NO_DRIVER`. Rejected.

### Consequences

`NO_DRIVER` is not an Order state (DEC-019); the condition lives in the delivery
domain as a prolonged `RIDER_SEARCHING` plus an operator alert. The customer
must still be informed rather than left in silence — the existing 5-minute
notification and 3-minute extension UI already does this and remains valid.
**Resolves the policy half of BQ-025.** Still `OPEN`: the retry and escalation
timings, whether merchant delivery is a per-merchant opt-in, and — importantly —
**who bears the cost of food already cooked when the operator chooses cancel +
refund (BQ-015)**.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, sections 9 and 20).

### Related Requirements

None directly.

### Related Architecture

`docs/RIDER_LIFECYCLE.md` § 7, `docs/ORDER_LIFECYCLE.md`

### Supersedes / Superseded By

None / None.

---

## DEC-023 — Delivery fee funds rider compensation (model only)

**Status:** ACCEPTED — MODEL · **customer side resolved 2026-08-24 by DEC-035 · rider side resolved 2026-09-05 by DEC-044**
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The approved conceptual money flow is `Customer → delivery fee → rider earning`.
The delivery fee is conceptually associated with delivery compensation.
**No numeric pricing is approved.**

### Why

Product Owner decision, 2026-08-10. The relationship is settled so the ledger
and settlement model can be designed; the numbers require unit-economics work
that has not happened.

### Alternatives

Not applicable — this fixes a relationship, not a price.

### Consequences

The ledger models a delivery-fee inflow and a rider-earning outflow as related
lines. **No agent may invent a delivery price, a distance band or a rider rate.**
The design's `฿10`/`฿15` samples are illustrative and inconsistent with each
other. Note for unit economics: in the design's own worked example the net
delivery-side contribution is ฿10 against a ฿12 rider payment, so the model as
sampled does not cover itself — see `docs/SETTLEMENT_MODEL.md` § 3. BQ-026 and
BQ-029 remain `OPEN` for the numbers.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, sections 10 and 22).

### Related Requirements

CON-003

### Related Architecture

`docs/SETTLEMENT_MODEL.md`

### Supersedes / Superseded By

None / The `OPEN — NUMERIC PRICING` half is resolved in two parts: the
customer-side delivery fee by **DEC-035** (flat ฿10, 1000 satang), and the
rider-side earning by **DEC-044** (flat ฿12, 1200 satang per completed
delivery). The money-flow model recorded here is unchanged and still stands.

---

## DEC-024 — Service fee is BANHAO revenue (model only)

**Status:** ACCEPTED — MODEL · **amount resolved 2026-08-24 by DEC-036** · refundability still `OPEN`
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The approved conceptual money flow is `Customer → service fee → BANHAO`.
**No amount is approved.**

### Why

Product Owner decision, 2026-08-10.

### Alternatives

Not applicable.

### Consequences

The service fee is a platform revenue line in the ledger, distinct from
commission and from the delivery fee. The `฿5` in the design and in
`apps/customer/src/mocks/pricing.ts` is a sample and must not be copied into
backend code. Whether the service fee is refunded when an order fails remains
`OPEN` (BQ-027).

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, sections 11 and 22).

### Related Requirements

CON-003

### Related Architecture

`docs/SETTLEMENT_MODEL.md`

### Supersedes / Superseded By

None / The `OPEN — NUMERIC PRICING` half is resolved by **DEC-036** (fixed ฿5,
500 satang). Refundability remains `OPEN` under BQ-027 and is Phase F scope.

---

## DEC-025 — Merchant commission is BANHAO revenue (model only)

**Status:** ACCEPTED — MODEL · **numeric rate resolved 2026-09-05 by DEC-043**
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The approved conceptual money flow is `Merchant → commission → BANHAO`.
**No commission percentage is approved.** Existing design examples — notably the
10% that appears consistently in the payment canvas — **must not** become a
business rule by default.

### Why

Product Owner decision, 2026-08-10. Commission is both a revenue lever and a
merchant-acquisition lever in a 20–30-shop district; it needs a deliberate
decision, not inheritance from a mock-up.

### Alternatives

Percentage, fixed fee, hybrid and subscription models are compared in
`docs/SETTLEMENT_MODEL.md` § 5. The **model shape** is not fixed by this
decision either — only the direction of the money.

### Consequences

Q-010 and BQ-028 remain `OPEN`. Until answered, the ledger cannot be closed to
zero for a real order (CON-003), so **no settlement code may be written**. The
`10% ของยอดอาหาร` note and the 120→12 / 180→18 / 260→26 samples remain evidence
of what the design assumed, nothing more.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, sections 12 and 22).

### Related Requirements

CON-003

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 5

### Supersedes / Superseded By

None / The `OPEN — NUMERIC RATE` half is resolved by **DEC-043** (8% of food
subtotal, round to whole baht). The money-flow model recorded here is
unchanged and still stands.

---

## DEC-026 — Settlement is a separate financial domain

**Status:** ACCEPTED — DOMAIN MODEL · IMPLEMENTATION NOT STARTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

Settlement is its own domain, conceptually:

```
Customer payment → BANHAO financial records → merchant settlement
                                             → rider settlement
                                             → BANHAO revenue
```

**No settlement is to be implemented yet.**

### Why

Product Owner decision, 2026-08-10, consistent with DEC-018's four-domain split
and DEC-014's system-of-record rule.

### Alternatives

Settling inline with order completion. Rejected — it merges a periodic financial
process into a transactional one.

### Consequences

Settlement has its own states, its own cycle and its own reconciliation, and it
reads the ledger rather than the order table. Implementation is blocked on
Q-002 (legal settlement model), Q-001 (provider) and the pricing questions —
none of which is an engineering choice.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, sections 13 and 28).

### Related Requirements

CON-003, DEC-014

### Related Architecture

`docs/SETTLEMENT_MODEL.md`

### Supersedes / Superseded By

None / None.

---

## DEC-027 — Refund belongs to the payment domain and is not a substitute for order cancellation

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

`REFUNDED` is a **payment** state and must not be used as an order outcome. The
correct representation of a refunded, cancelled order is:

```
Order   = CANCELLED
Payment = REFUNDED
```

### Why

Product Owner decision, 2026-08-10. Directly follows CON-001 and DEC-018: an
order and its money have separate fates, and the window in which an order is
cancelled but not yet refunded is real and must be visible.

### Alternatives

A `REFUNDED` order status. Rejected.

### Consequences

Operations can see cancelled-but-unrefunded orders as a queue. The refund
**policy** — what is refunded, when, and in what proportion — remains `OPEN`
(Q-003, BQ-016, BQ-031), as does the **mechanism** (Q-020).

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 14).

### Related Requirements

CON-001, CON-002

### Related Architecture

`docs/PAYMENT_LIFECYCLE.md` § 8

### Supersedes / Superseded By

None / None.

---

## DEC-028 — Payment operations must be idempotent

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

Payment operations must support idempotency so that a duplicate operation cannot
create duplicate financial value for one order. The required concepts are
`order_id`, `payment_reference` and `idempotency_key`. **Not to be implemented
yet.**

### Why

Product Owner decision, 2026-08-10, confirming REQ-003 and DEC-003 at the
architecture level.

### Alternatives

None considered — this is a correctness requirement, not a preference.

### Consequences

Every payment operation carries an explicit idempotency key; the raw webhook
event is persisted before processing and keyed so a repeat delivery reads back
the stored result; ledger writes carry a unique entry-group key so a second
insert fails loudly rather than silently duplicating. The already-shipped
`PaymentProvider` interface enforces the key at the type level, so this is
satisfied by construction when a provider is eventually chosen.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 15).

### Related Requirements

REQ-003

### Related Architecture

`docs/PAYMENT_LIFECYCLE.md` § 5,
`apps/api/src/modules/payments/payment-provider.interface.ts`

### Supersedes / Superseded By

None / None.

---

## DEC-029 — Late payment must be resolvable to an order and a payment attempt

**Status:** ACCEPTED — TECHNICAL REQUIREMENT · OPEN — FINAL BUSINESS HANDLING
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The architecture must handle a payment that succeeds **after** the order or
payment attempt has timed out. Given a late payment the system must be able to
determine: which order, which payment attempt, the order's current state, and
whether the payment should be accepted, refunded, or manually reviewed. **The
final business handling is not decided.**

### Why

Product Owner decision, 2026-08-10. A 10-minute QR window and a real-world bank
rail guarantee this case occurs; the system must never be unable to identify
whose money arrived.

### Alternatives

Ignoring late payments. Rejected — the money exists regardless.

### Consequences

Payment attempts are first-class and retain their identity after expiry; a
payment reference resolves to an order for as long as the order exists. The
resolution policy — auto-accept if the order is still viable, refund, or queue
for review — is `OPEN` and interacts with Q-020, because "refund" may not be
mechanically available. Reconciliation must surface late payments as a distinct
category, not as a generic mismatch.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 16).

### Related Requirements

REQ-003

### Related Architecture

`docs/PAYMENT_LIFECYCLE.md` § 7

### Supersedes / Superseded By

None / None.

---

## DEC-030 — A duplicate payment must never increase an order's value

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

If an order expects ฿185 and two separate ฿185 payments succeed, the order's
value must **not** become ฿370. The second transaction is detected as a
duplicate and handled through the financial/refund workflow.

### Why

Product Owner decision, 2026-08-10. A customer who transfers twice must not be
recorded as having bought twice; the order's value is a property of the order,
not a sum of received transfers.

### Alternatives

Treating the second payment as an overpayment credit. Not approved.

### Consequences

Order value is authoritative and immutable at creation; received transactions
are matched against it. A surplus transaction becomes a refund obligation, not
order value — which means **this decision depends on Q-020 being answerable**;
until then a duplicate PromptPay payment can be detected but not automatically
returned. The Customer App already promises automatic refund of a double
transfer on screen 12f, so the promise exists ahead of the mechanism.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 17).

### Related Requirements

REQ-003, CON-003

### Related Architecture

`docs/PAYMENT_LIFECYCLE.md` § 5

### Supersedes / Superseded By

None / None.

---

## DEC-031 — Buntharik-first: manual operations are an intentional Phase 1 capability

**Status:** ACCEPTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

The system assumes roughly 50 restaurants, a small rider pool, local geography,
a solo operator and low initial transaction volume. **Manual operations are an
intentional Phase 1 capability**, and automation must not be treated as a
requirement for every edge case.

### Why

Product Owner decision, 2026-08-10. At launch volume a phone call outperforms an
algorithm, and every automated edge case is code a solo founder maintains
forever.

### Alternatives

Automating every exception path before launch. Rejected as disproportionate.

### Consequences

An edge case may legitimately be answered with "an operator handles it" —
that is a design outcome, not a gap. Nothing about the launch district may be
hard-coded: `ServiceArea`, `Zone` and delivery-fee bands stay configuration so
expansion is a row, not a release. Where a manual process replaces automation,
it must still be **recorded** — see DEC-032.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 19).

### Related Requirements

None directly.

### Related Architecture

`docs/BUSINESS_RULES.md` § 16, § 19

### Supersedes / Superseded By

None / None.

---

## DEC-032 — Operator fallback for exceptional situations is a required capability

**Status:** ACCEPTED — OPERATIONAL REQUIREMENT · IMPLEMENTATION NOT STARTED
**Date:** 2026-08-10
**Owner:** PRODUCT_OWNER

### Decision

An operator must be able to resolve exceptional situations manually — no rider,
rider cancellation, customer unreachable, restaurant issue, refund review. **No
Admin App is to be built now**; the capability is documented only.

### Why

Product Owner decision, 2026-08-10. Follows directly from DEC-031 and is the
mechanism DEC-022 escalates into.

### Alternatives

Fully automated exception handling. Rejected for Phase 1.

### Consequences

The domain model must make manual intervention **expressible and attributable**:
manual dispatch, force-unassign, cancel, refund, approve/suspend, and
reconciliation matching all exist as documented operator capabilities.
`PROPOSED` and not yet approved: that every manual override writes an audit
record with actor, timestamp, before/after state and reason (BQ-038, Q-014).
Building the Admin App itself remains out of scope.

### Evidence

Product Owner approval, 2026-08-10 (Step 4.2 instruction, section 20).

### Related Requirements

None directly.

### Related Architecture

`docs/BUSINESS_RULES.md` § 14

### Supersedes / Superseded By

None / None.

---

## DEC-033 — Multi-role identity: domain membership, not a single `profiles.role`

**Status:** ACCEPTED
**Date:** 2026-08-11
**Owner:** PRODUCT_OWNER

*(Approved under the label "DEC-014 — Multi-role Identity Model"; recorded here
because DEC-014 was already taken — see the numbering note at the top of this
file.)*

### Decision

`profiles` represents the user's **identity**. A single `profiles.role` column
**must not be the authoritative role model.** A user may participate in several
domains at once — Customer, Merchant, Rider, Operator, Admin.

Role and capability membership is represented through **domain-specific
relationships** (`restaurant_members`, `riders`, operator/admin membership), not
through a generic RBAC layer. **Do not build generic RBAC infrastructure where
domain membership is sufficient.**

The authoritative question is **"what relationship does this user have with this
domain?"** — never "what single role does this user have?"

### Why

Product Owner decision, 2026-08-11. Two drivers:

1. **A single role column breaks a routine case.** In Buntharik a rider orders
   food and a restaurant owner orders food. Setting `role = 'DRIVER'` would
   strip that person's ability to be a customer.
2. **A global `MERCHANT` role authorises nothing useful.** The real question is
   *which restaurant*, which only `restaurant_members` can answer. A role column
   would still need the membership table, so it adds a second, weaker answer to
   the same question.

### Alternatives

- **Keep the single `profiles.role`.** Rejected — see above.
- **A generic `user_roles` table** (the database design's own earlier
  recommendation). **Rejected by the Product Owner**: it duplicates information
  the domain tables already hold, and it re-creates the "what role is this
  person?" framing that DEC-033 explicitly replaces. Where a domain table exists,
  membership *is* the grant.

### Consequences

- **Customer is implicit.** Every authenticated profile may order. No row, no
  grant, no membership record.
- `restaurant_members` becomes the merchant authorization boundary; `riders`
  becomes the rider one; a small **`platform_staff`** table carries
  operator/admin membership, since those two have no other domain table.
- **`profiles.role` is no longer authoritative** and is deprecated. It cannot be
  dropped by a documentation change: `RolesGuard`, `set_user_role()` and the
  `role` clause of `enforce_profile_immutable_columns()` all read it. That is
  implementation work, not a design change.
- Authorization checks become relationship lookups. RLS policies must express
  membership (`exists (select 1 from restaurant_members …)`), never
  `profiles.role = …`.
- **No generic RBAC tables** — no `roles`, `permissions`, `role_permissions`, or
  `user_roles`. Adding one later needs a new decision.
- The live `user_role` enum stays for now, but only as legacy scaffolding behind
  the deprecated column.

### Evidence

Product Owner approval, 2026-08-11 (Step 6.1 instruction, "DEC-014 — Multi-role
Identity Model").

### Related Requirements

None directly. Supersedes the `user_roles` recommendation in
`docs/DATABASE_DESIGN.md` § 4.2 and answers **DBQ-002**.

### Related Architecture

`docs/DATABASE_DESIGN.md` § 4, § 18 · `docs/TECHNICAL_ARCHITECTURE.md` § 13

### Supersedes / Superseded By

Supersedes the authority of `profiles.role` established in migration
`20260809000002_profiles_and_roles.sql`. The column and migration remain in
place. / None.

---

## DEC-034 — Phase 1 financial integrity without a zero-sum database trigger

**Status:** ACCEPTED
**Date:** 2026-08-11
**Owner:** PRODUCT_OWNER

*(Approved under the label "DEC-015 — Phase 1 Financial Integrity"; recorded here
because DEC-015 was already taken — see the numbering note at the top of this
file.)*

### Decision

For Phase 1, BANHAO will **not** enforce a full accounting zero-sum invariant
through PostgreSQL triggers. Financial integrity is achieved instead by:

- **immutable financial records**
- **database constraints** (unique, check, foreign key, not-null)
- **NestJS database transactions**
- **idempotency**
- **auditability**
- **reconciliation queries and processes**

**Financial history must not be silently rewritten.** Corrections use
compensating records where appropriate.

The architecture must preserve the ability to answer: how much the customer
paid · how much the merchant is owed · how much the rider is owed · BANHAO's
revenue · how much was refunded · **and what financial events produced those
values.**

A stronger zero-sum or ledger invariant **may** be introduced in a future phase.
**No future accounting rules are invented now.**

### Why

Product Owner decision, 2026-08-11. A deferred constraint trigger is powerful
but puts a rule in the database that ADR-001 otherwise keeps in NestJS, fails at
commit time with little domain context, and is unfamiliar to maintain. At Phase 1
volume, transactional writes plus a reconciliation process give the same
practical assurance with a much smaller surface — and reconciliation surfaces a
discrepancy with context rather than aborting a transaction.

### Alternatives

- **`DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting
  `sum = 0` per entry group** — the database design's own recommendation
  (DBQ-010). **Rejected for Phase 1**, explicitly available for a later one.
- **No financial records beyond `orders`/`refunds`.** Rejected — it cannot
  answer *"what financial events produced these values?"*, which this decision
  requires.

### Consequences

- **CON-003 is not repealed.** Every order's ledger still balances to zero; what
  changes is **where that is enforced** — the ledger service asserts it inside
  the transaction, and a reconciliation job verifies it continuously. The
  invariant moves from *physically impossible to violate* to *asserted and
  monitored*.
- A **reconciliation process becomes mandatory, not optional.** Without the
  trigger it is the only thing that would notice a drift, so it needs an alert
  (TQ-006) and must run on a schedule.
- Financial tables stay **append-only and immutable**; the immutability triggers
  in `DATABASE_DESIGN.md` § 13 are **unaffected** — those prevent rewriting
  history, which this decision explicitly requires.
- `ledger_entry_groups.group_key` keeps its unique constraint: that is
  idempotency (DEC-028), not zero-sum enforcement.
- Corrections are reversing/compensating entries, never edits (unchanged,
  DEC-014).
- **Answers DBQ-010.** DBQ-003 (running balances) is untouched and stays `OPEN`.

### Evidence

Product Owner approval, 2026-08-11 (Step 6.1 instruction, "DEC-015 — Phase 1
Financial Integrity").

### Related Requirements

CON-003 (enforcement mechanism changed, invariant intact), REQ-003, DEC-014,
DEC-028

### Related Architecture

`docs/DATABASE_DESIGN.md` § 10, § 13 · `docs/SETTLEMENT_MODEL.md`

### Supersedes / Superseded By

Supersedes the zero-sum trigger recommendation in `docs/DATABASE_DESIGN.md`
§ 10. / None. Explicitly revisitable in a later phase.


---

## DEC-035 — Phase 1 delivery fee is a flat ฿10, with no distance component

**Status:** ACCEPTED · **Date:** 2026-08-24 · **Owner:** PRODUCT_OWNER

### Decision

The Phase 1 delivery fee is **flat: 1000 satang (฿10) per order**, charged
regardless of distance.

Phase 1 has **no** distance calculation, **no** distance bands, **no** zones and
**no** routing or geocoding dependency in the fee. One order, one delivery fee.

This resolves the numeric half of **BQ-026**, which DEC-023 left `OPEN`.

### Why

Product Owner decision, 2026-08-24. Buntharik is a single district, and the
inputs a distance-based fee would need do not exist: customer addresses carry no
coordinates (DQ-04-07 sends `lat`/`lng` as `null`, and there is no map picker),
no geocoding or routing provider has been selected (TQ-004, `OPEN`), and Q-018
records that no provider publishes district-level accuracy for Thailand. A flat
fee is the only model whose inputs are all present today, and it removes the
last product blocker on `POST /api/v1/orders`.

### Alternatives

- **Distance-banded** (0–2 / 2–5 / 5–10 km) — the model `BUSINESS_RULES.md` § 5.2
  and BQ-026 both flagged as the eventual preference. Rejected **for Phase 1
  only**: it cannot be computed without customer coordinates, and it would
  require `delivery_fee_bands` / `service_areas` / `zones`, none of which exist
  in the locked schema.
- **Base + per-km** — rejected; most sensitive of all to geocoding error while
  Q-018 is open.
- **Zone-to-zone matrix** — rejected for Phase 1; a later-stage answer.

### Consequences

- `OrderPricingService.resolveOrderFees()` may now return a delivery fee. That
  implementation is **a separate task** — this decision records the number, it
  does not write code, and the service still throws until that task runs.
- **No schema change, no migration and no new table are required.** `orders`
  already stores amounts rather than rates, and `create_order()` already accepts
  `p_delivery_fee_satang`. The database schema lock is untouched.
- ⚠️ **Distance-based pricing is NOT approved and must not be treated as
  Phase 1 behaviour.** Moving to it later requires a new Product Owner decision
  *and* the coordinate/geocoding infrastructure that decision depends on. Do not
  pre-build for it.
- The design's `฿10` / `฿15` samples remain samples. `฿10` now coincides with the
  approved figure, but the authority is this decision — not the design canvas and
  not `apps/customer/src/mocks/pricing.ts`, whose `SAMPLE_DELIVERY_FEE_SATANG`
  is `1500` and remains an **unapproved sample**.
- ⚠️ Unit economics remain unresolved: **BQ-029 (rider earnings) is still
  `OPEN`**, so whether a flat ฿10 covers rider compensation is not settled by
  this decision. DEC-023's note — that the design's sampled ฿10 against a ฿12
  rider payment does not cover itself — still stands as an open question for
  BQ-029, not an objection answered here.

### Evidence

Product Owner instruction, 2026-08-24 ("LOCK BQ-026 / BQ-027 PHASE 1 PRICING
DECISION").

### Related Requirements

BQ-026 (numeric half resolved) · BQ-029 (rider earnings, still `OPEN`)

### Related Architecture

`docs/BUSINESS_RULES.md` § 5.2 · `docs/SETTLEMENT_MODEL.md` ·
`apps/api/src/modules/orders/order-pricing.service.ts` (not yet implemented) ·
CON-003 (integer satang)

### Supersedes / Superseded By

Resolves the `OPEN — NUMERIC PRICING` half of DEC-023, which otherwise stands
unchanged. / None.

---

## DEC-036 — Phase 1 service fee is a fixed ฿5

**Status:** ACCEPTED · **Date:** 2026-08-24 · **Owner:** PRODUCT_OWNER

### Decision

The Phase 1 service fee is **fixed: 500 satang (฿5) per order**.

It is a flat amount. It is **not** a percentage, **not** a percentage with a cap
or a minimum, **not** tiered, and **not** restaurant-specific.

This resolves the amount half of **BQ-027**, which DEC-024 left `OPEN`.

### Why

Product Owner decision, 2026-08-24. A flat amount is what the design has always
shown, it needs no subtotal-dependent arithmetic, and it removes the second
product blocker on `POST /api/v1/orders`.

### Alternatives

Percentage of subtotal, percentage with cap, percentage with minimum, tiered,
and restaurant-specific fees were all considered and **rejected for Phase 1**.

### Consequences

- `OrderPricingService.resolveOrderFees()` may now return a service fee. As with
  DEC-035, the implementation is **a separate task**.
- **No schema change and no migration are required** — `create_order()` already
  accepts `p_service_fee_satang`, and the schema stores amounts, never rates.
- ⚠️ **Refundability is NOT decided by this decision.** Whether the service fee
  survives a refund remains the open half of BQ-027 and is **Phase F scope**. It
  must not be inferred from this pricing decision in either direction. It does
  not block `POST /orders`: order creation reads only the amount.
- `SAMPLE_SERVICE_FEE_SATANG = 500` in `apps/customer/src/mocks/pricing.ts`
  numerically matches the approved figure. It remains an **unapproved sample**
  and must not be imported into backend code or relabelled as the source of
  truth — the authority is this decision. The client is still not the pricing
  authority; the server prices every order.

### Evidence

Product Owner instruction, 2026-08-24 ("LOCK BQ-026 / BQ-027 PHASE 1 PRICING
DECISION").

### Related Requirements

BQ-027 (amount resolved; refundability still `OPEN`, Phase F)

### Related Architecture

`docs/BUSINESS_RULES.md` § 5.3 · `docs/SETTLEMENT_MODEL.md` ·
`docs/PAYMENT_LIFECYCLE.md` (refund scope) · CON-003 (integer satang)

### Supersedes / Superseded By

Resolves the `OPEN — NUMERIC PRICING` half of DEC-024, which otherwise stands
unchanged. / None — but the refundability question this decision's own
Consequences clause left `OPEN` is separately answered by **DEC-048**
(included in an eligible full order refund). This decision's own ฿5 amount
and model are unchanged by DEC-048.

---

## DEC-037 — Phase 1 broadcast dispatch parameters: 60 s accept window, one active delivery per rider, no radius

**Status:** ACCEPTED · **Date:** 2026-08-24 · **Owner:** PRODUCT_OWNER

### Decision

The four dispatch parameters DEC-020 deliberately left open are now fixed for
Phase 1:

| Parameter | Phase 1 value | Resolves |
|---|---|---|
| Rider accept window per offer | **60 seconds** | **BQ-020** |
| Concurrent deliveries per rider | **1 active delivery** | **BQ-021** |
| Dispatch eligibility | **`APPROVED` + online + a valid recorded location** — **no numeric radius, no distance threshold, no zone, no ranking, no fairness or proximity score** | **BQ-022, working-area half only** |
| Dispatch round interval | **60 seconds**, aligned to the existing one-minute tick (DEC-APP-010) | the `OPEN` round interval in `RIDER_LIFECYCLE.md` § 6 |

**DEC-020 is unchanged and remains authoritative**: broadcast to eligible online
riders, first valid acceptance wins, no scoring or route optimisation, with
operator manual dispatch (DEC-032) as an always-available override. This
decision supplies DEC-020's missing numbers; it does not revisit the model.

⚠️ **BQ-022 is only partly resolved.** What a rider submits, who approves it,
and the contractual relationship remain **`OPEN` and `LEGAL_REVIEW_REQUIRED`**.
This decision fixes the *dispatch eligibility filter* and nothing else — see
"Consequences" below.

### Why

Product Owner decision, 2026-08-24.

- **60 s accept window.** No document ever established a value: the design
  contradicts itself (wireframe title `นับถอยหลัง 20 วิ`, button
  `รับงาน · 12 วิ`), and `ai/RESEARCH/THAILAND_COMPLIANCE.md` §5's "12 seconds"
  was read off the button, which `BQ-020` records explicitly as *not*
  established. 60 s is longer than every figure the design suggested, which
  reduces — rather than increases — the time pressure on a rider.
- **One active delivery.** The Driver App is designed as a one-button-per-state
  single-job flow; batching needs a UI that does not exist. It is also the
  option the approved application architecture already assumes: V1.1 § 6 lists
  `RIDER_HAS_ACTIVE_DELIVERY` as an error of
  `POST /rider/offers/:id/accept`, which is meaningful only under this rule.
- **No radius.** The inputs a distance filter needs are not there, for the same
  reason DEC-035 rejected distance-based pricing: customer coordinates are null
  (DQ-04-07), no geocoding or routing provider is selected (TQ-004 `OPEN`), and
  BQ-008 / BQ-003 leave service area and radius undecided. DEC-E-04 already
  refused to invent exactly this number for `ADDRESS_OUT_OF_ZONE`. DEC-020's own
  rationale — *"with 8–12 riders the whole district is one pool"* — is the
  argument for not filtering the pool at all in Phase 1.
- **60 s rounds.** DEC-APP-010 fixes one Cloudflare Worker cron POSTing
  `/internal/tick` every 60 seconds and forbids a second scheduler. A 30-second
  round (the `RIDER_LIFECYCLE.md` § 6 *proposal*) could not be delivered by that
  tick without new infrastructure, which DEC-APP-010 rules out.

### Alternatives

- **20 s / 12 s accept window** (BQ-020 options A and B). Rejected: both derive
  from a self-contradictory wireframe, and a short timer is the working
  condition `THAILAND_COMPLIANCE.md` §5 flags as a reclassification factor.
- **No timer at all** (BQ-020 option C). Rejected — an offer that never expires
  cannot be re-broadcast, and `rider_assignment_attempts.expires_at` exists
  precisely to bound it.
- **Batching two orders** (BQ-021 options B and C). Rejected for Phase 1; a
  capacity lever to pull after measuring, not before.
- **A provisional eligibility radius** (1 / 3 / 5 / 10 km, or a district
  polygon). Rejected — that is inventing BQ-008's answer, and a rider wrongly
  excluded from a broadcast is invisible to everyone.

### Consequences

- **No schema change, no migration, no new table, no new index.** The locked
  schema already carries everything: `rider_assignment_attempts.expires_at` is
  nullable with no default, so a 60 s window is `offered_at + interval
  '60 seconds'` written by the dispatcher; `riders.status`,
  `rider_availability.is_online` and `rider_availability.location` supply the
  whole eligibility filter.
- ⚠️ **`DBQ-007` becomes answerable but is NOT answered here.** One active
  delivery per rider is enforced **in the service layer**, as
  `docs/DATABASE_DESIGN.md` § 11 already specifies. A partial unique index on
  `deliveries (rider_id)` would need a migration and the schema is LOCKED —
  this decision authorises neither.
- ⚠️ **The residual same-rider race is real and unresolved.**
  `rider_assignments_one_active` is unique on `delivery_id`, so it guarantees
  *one rider per delivery* — it does **not** guarantee *one delivery per rider*.
  Two offers accepted by the same rider in the same instant touch different
  `deliveries` rows and do not block each other under `READ COMMITTED`. The G2
  implementation must put the check inside the guarded `UPDATE`'s `WHERE`
  clause (ADR-003 — never `SELECT`-then-check-then-`UPDATE`) and treat the
  remaining window as a known limitation recoverable by
  `release_rider_assignment()` plus operator action (DEC-031, DEC-032). Closing
  it atomically would require a database constraint, therefore a new decision.
- **Timer shape is unchanged.** `ORDER_LIFECYCLE.md` § 4 and DEC-031 still
  require timers to be configuration rather than constants. This decision fixes
  the *value*, not where it is stored.
- ⚠️ **A 60 s window on a 60 s tick means an offer is observed as expired at the
  following tick.** The dispatcher must therefore treat `expires_at` as the
  authority at read time, not the moment the sweeper happens to run.
- ⚠️ **No rider location write path exists.**
  `supabase/migrations/20260811000011_rls_policies.sql` grants a rider
  `update (is_online)` and nothing else, and no location endpoint is defined in
  V1.1. Until an API-side write path exists, `rider_availability.location` is
  null for every rider and the "valid location" clause excludes everyone. That
  path is ordinary Phase G work — the *current position* column is already
  sanctioned; only **location history** is gated (Q-012, DBQ-005) — but it must
  land before broadcast dispatch can select a candidate in production.
- ⚠️ **This decision concludes nothing about lawfulness.** BQ-022's contractual
  half and Q-002 remain `LEGAL_REVIEW_REQUIRED`, and
  `THAILAND_COMPLIANCE.md` §5 names algorithmic dispatch and accept timers as
  factors a worker-reclassification argument turns on. Counsel may require this
  window to change; that would be a new decision, not a bug.
- Rider economics stay `OPEN`. **`deliveries.rider_earning_satang` remains
  `NULL`** — BQ-029 is untouched and no default may be invented.
- G2 is money-neutral: no payment, refund, reconciliation, ledger, commission or
  settlement behaviour is created, changed, or implied.

### Evidence

Product Owner instruction, 2026-08-24 ("BANHAO — G2 DISPATCH POLICY LOCK").

### Related Requirements

BQ-020 (resolved) · BQ-021 (resolved) · BQ-022 (working-area half only; the rest
`OPEN` + `LEGAL_REVIEW_REQUIRED`) · BQ-029 (rider earnings, still `OPEN`) ·
DBQ-007 (unblocked as a question; not answered) · Q-012, Q-002
(`LEGAL_REVIEW_REQUIRED`, untouched)

### Related Architecture

`docs/RIDER_LIFECYCLE.md` § 3, § 6 · `docs/ORDER_LIFECYCLE.md` § 4 ·
`docs/TECHNICAL_ARCHITECTURE.md` § 8.2 ·
`docs/BANHAO-APP-ARCHITECTURE-V1.md` § 9, DEC-APP-010 ·
`supabase/migrations/20260811000008_rider_domain.sql` ·
`supabase/migrations/20260811000009_delivery_domain.sql`

### Supersedes / Superseded By

Supplies the parameters DEC-020 left `OPEN`; DEC-020 itself stands unchanged. /
None.

---

## DEC-D-01 — Cart validation returns a subtotal only

**Status:** ACCEPTED · **Date:** 2026-08-18 · **Owner:** Product Owner

### Decision

`POST /api/v1/cart/validate` returns the **server-authoritative food subtotal
and nothing else**. Delivery fee, service fee and discount are not calculated in
Phase D. Where the cart UI has a row for a fee it cannot yet know, that row
renders the literal string `คำนวณเมื่อยืนยัน`.

### Why

The **models** for these amounts are accepted (DEC-023, DEC-024, DEC-025) but
every **number** is still OPEN — BQ-026 (delivery fee), BQ-027 (service fee),
BQ-030 (who funds discounts), Q-010 (commission rate). The subtotal is the only
total derivable from data the customer app can actually read, because item and
option prices are real columns while no fee is.

This is not a new position. UX-SPEC § C-09 already required it: *"Fee lines
appear here as server-provided amounts; if any fee is not yet knowable, the row
shows `คำนวณเมื่อยืนยัน` rather than a number the app invented."* The decision
ratifies that line and makes it binding on the API as well as the UI.

### Alternatives considered

- **Wait for BQ-026/BQ-027 before building the cart.** Rejected — it would stall
  the whole order path behind a pricing question that gates only real money
  (DEC-APP-007).
- **Keep the design's sample figures (฿15 / ฿5 / ฿10 `BANHAO7`).** Rejected, and
  this is the decision's real purpose. Those numbers were illustrative from the
  start; shipping them makes a fabricated total indistinguishable from an agreed
  one, which CLAUDE.md forbids outright ("do not invent a default anywhere in
  the application").

### Consequences

- `apps/customer/src/mocks/pricing.ts` is no longer reachable from the cart.
- The cart shows no grand total, and the `ดูตะกร้า` / `ยืนยันการสั่ง` buttons
  carry no amount — a subtotal on a CTA reads as the amount payable.
- The `BANHAO7` discount row is removed rather than blanked; no promotion
  mechanism exists to replace it.
- When BQ-026/BQ-027 are answered, the fee rows gain server-supplied numbers
  with no change to the domain — the schema stores amounts, never rates.

### Related

DEC-023, DEC-024, DEC-025, BQ-026, BQ-027, BQ-030, Q-010, CON-003 ·
UX-SPEC § C-09, § 13

---

## DEC-D-02 — The persisted Supabase cart is the source of truth

**Status:** ACCEPTED · **Date:** 2026-08-18 · **Owner:** Product Owner

### Decision

The row in `carts` **is** the cart. The client holds a cached copy for
rendering only. A customer's cart survives logout, reinstall and a change of
device, and is restored after authentication.

### Why

The schema was already built for it: `carts_user_id_key` is UNIQUE on
`user_id`, so "the cart" is unambiguous per customer, and DEC-APP-008 names the
cart as one of exactly two domains a client may write directly — precisely
because a cart is not financial data. Holding the cart in React state instead
would mean the one thing the customer assembled by hand is the one thing the
system forgets.

### Alternatives considered

- **Client-only cart, uploaded at checkout.** Rejected — it loses the cart on
  reinstall, cannot be resumed on another device, and makes the first write a
  large one at the least forgiving moment.
- **Server-owned cart written through the API.** Rejected — DEC-APP-008 already
  settled this: routing non-financial writes through the container adds a cold
  start and buys no safety RLS is not already providing.

### Consequences

- Every cart mutation returns the reloaded server cart, so local and remote
  cannot drift.
- Prices are re-read from the live catalog on every load: a cart shows today's
  price, which is what makes staleness visible instead of plausible.
- A line whose menu item is no longer readable (archived, or its restaurant left
  `ACTIVE`) cannot be named or priced. It is surfaced as `unresolvedLineIds`
  rather than silently dropped.

### Related

DEC-APP-008, DEC-017, DEC-014 · `supabase/migrations/20260811000004_cart_domain.sql`

---

## DEC-D-03 — No guest cart

**Status:** ACCEPTED · **Date:** 2026-08-18 · **Owner:** Product Owner

### Decision

An unauthenticated user cannot add to a cart. No local guest-cart architecture
is created as a stand-in.

### Why

Every cart policy — `carts_insert_own`, `cart_items_insert_own`,
`cart_item_options_insert_own` and their select/update/delete counterparts —
keys on `auth.uid()`. A signed-out client has no cart it is permitted to write,
so a guest cart would be a parallel, client-only store that must later be
merged: a second source of truth, in direct tension with DEC-D-02.

Browsing stays fully anonymous. The catalog's `*_select_active` policies are
public, so the entire menu is readable without a session; only the cart requires
one.

### Alternatives considered

- **Local guest cart, uploaded on sign-in.** Rejected — merge conflicts (guest
  cart from restaurant A, saved cart from restaurant B) collide with DEC-017,
  and the merge rule would itself need a decision.
- **Anonymous Supabase sessions.** Rejected — it creates a real `auth.users` row
  per browsing device with no way to reclaim or garbage-collect it.

### Consequences

- The add-to-cart action names what is missing (`เข้าสู่ระบบเพื่อสั่ง`) instead
  of failing on tap.
- The repository raises `NotAuthenticatedError` before any round trip; RLS
  remains the actual boundary.

### Related

DEC-D-02, DEC-APP-004, DEC-APP-008 ·
`supabase/migrations/20260811000011_rls_policies.sql`


---

## DEC-E-01 — No production order while the fee amounts are OPEN

**Status:** ACCEPTED · **condition satisfied 2026-08-24** · **Date:** 2026-08-19 · **Owner:** Product Owner

> **✅ Gate condition met, 2026-08-24.** Both amounts this decision waited on are
> now approved: **DEC-035** (delivery, flat 1000 satang) and **DEC-036**
> (service, fixed 500 satang). DEC-E-01 is **not** repealed — its prohibition on
> interim, placeholder or zero values stands permanently, and its reasoning
> (money columns are immutable for every role, so a wrong fee has no repair
> path) is unchanged. What has changed is that real approved values now exist to
> supply. `OrderPricingService` still throws until a **separate implementation
> task** wires those values in; this note records the product gate opening, not
> the code changing.

### Decision

Phase E may build and test the order path, but **no order may be created
against production data until BQ-026 (delivery fee) and BQ-027 (service fee)
have approved amounts**. No interim, placeholder, or zero value is authorised
for `orders.delivery_fee_satang` or `orders.service_fee_satang`.

### Why

The schema forces a number and then makes it permanent. In
`supabase/migrations/20260811000005_order_domain.sql`:

- `delivery_fee_satang` and `service_fee_satang` are both `bigint not null`.
- `orders_total_check` requires
  `grand_total_satang = subtotal + delivery_fee + service_fee − discount`,
  so the fees are load-bearing arithmetic, not decoration.
- `orders_enforce_immutable_columns()` rejects any later change to every money
  column **for every role including `service_role`**, and refuses `DELETE`
  outright.

So a fee written today cannot be corrected tomorrow — not by a migration, not
by an operator, not by the service role. There is no repair path.

**Zero is not a neutral placeholder.** `0` is a claim: free delivery and no
service fee. It contradicts DEC-023 (the delivery fee funds rider
compensation) and DEC-024 (the service fee is BANHAO revenue), and in Phase F
it flows into `ledger_entries`, where CON-003 requires every order's ledger to
balance to exactly zero. A wrong amount there is not a display bug; it is a
permanently wrong financial record.

V1.1 §20 risk 13 states the rule this decision applies: *"The schema stores
amounts, never rates, so these can be set without a migration. **Do not invent
a default anywhere in the application.**"* DEC-D-01 already established the
same discipline one phase earlier for the cart.

### Alternatives considered

- **Write `0` until the numbers arrive.** Rejected — see above; immutability
  makes it unrecoverable and the ledger inherits the error.
- **Make the columns nullable by migration.** Rejected — the schema is LOCKED
  at `e471ec1d`, and the constraint is correct: an order without a total is
  not an order.
- **Delay all of Phase E until pricing is decided.** Rejected — the structure
  (snapshotting, state machine, authorization, atomicity) is independent of
  the amounts and can be built and tested now against fixtures.

### Consequences

- Phase E is implementable and testable; it is **not releasable to production
  order creation**. That boundary is DEC-E-05.
- The first real order is gated on a Product Owner pricing decision, not on
  engineering.
- BQ-026 and BQ-027 **remain OPEN**. This decision does not answer them; it
  records what may not happen while they are open.

### Related

DEC-023, DEC-024, DEC-D-01, DEC-E-05, CON-003, BQ-026, BQ-027 ·
V1.1 §20 risk 13 · `supabase/migrations/20260811000005_order_domain.sql`

---

## DEC-E-02 — Order creation is atomic, via an additive Postgres function

**Status:** ACCEPTED — MECHANISM · NOT IMPLEMENTED · **Date:** 2026-08-19 ·
**Owner:** ARCHITECTURE_REVIEW

### Decision

Creating an order writes `orders`, `order_items`, `order_item_options` and
`order_status_history` **in one database transaction**. Non-atomic creation is
not an acceptable implementation, and a compensating-cleanup scheme is not an
acceptable substitute.

The sanctioned mechanism is a **single additive PostgreSQL function**
(working name `create_order`), following the `release_rider_assignment`
precedent exactly:

- **`SECURITY INVOKER`**, not `SECURITY DEFINER`.
- `revoke execute ... from public, anon, authenticated` and
  `grant execute ... to service_role` — the EXECUTE grant is the primary
  protection.
- An in-body role check as a second layer.
- All trusted values derived server-side inside the function or by the calling
  service; nothing price-bearing accepted from the client.

**The function is not written by this task, and no migration is created here.**
Its SQL, signature and security review belong to the Phase E implementation
task.

### Why

ADR-001 already requires every domain mutation to run *"inside a database
transaction"*, and V1.1 §6 spells it out for this endpoint: *"insert `orders`
(`CREATED`) + `order_items` + `order_item_options` + `order_status_history`;
**one transaction**."* That requirement is already accepted. What was missing
was a mechanism, because the API cannot currently satisfy it:

`apps/api` reaches the database only through `@supabase/supabase-js`
(PostgREST). It has no `pg` dependency, there is no `.rpc(` call anywhere in
`apps/api/src`, and no order-creation function exists in the schema. PostgREST
issues one statement per request, so the four inserts would be four
independent commits — a mid-sequence failure would leave an order with no
items, or items with no history.

`SECURITY INVOKER` is not a stylistic preference: the repository already
considered and **rejected** `DEFINER` for exactly this shape.
`20260811000013_rider_reassignment_atomicity.sql` records two reasons —
`service_role` already reaches every statement on its own privileges so no
owner substitution is needed, and under `DEFINER` the in-body `current_user`
guard becomes meaningless. CLAUDE.md lists that function's
`SECURITY INVOKER` + `service_role`-only EXECUTE as a structural safeguard
that must not be weakened; a new function in the same role should not adopt
the mode that one deliberately avoided.

### Alternatives considered

- **Direct `pg` connection with an explicit transaction.** Rejected — adds a
  dependency and a second database access path, and CLAUDE.md notes the
  database password *"is not stored in the repo at all."* Not chosen unless
  the RPC route is proven impossible, which it is not: a working precedent
  already ships.
- **Four PostgREST calls plus compensating deletes on failure.** Rejected —
  `order_items`, `order_item_options` and `order_status_history` all carry
  `reject_mutation()`, and `orders` refuses `DELETE`. The compensation is not
  merely inelegant; the schema forbids it.
- **`SECURITY DEFINER`.** Rejected for the reasons the rider migration already
  documents.

### Consequences

- Phase E's first implementation step is an **additive** migration adding one
  function. It adds no table, column, view or policy, and edits no existing
  migration.
- `OrdersService` becomes a caller of that function rather than an
  orchestrator of four writes.
- The function requires its own security review at implementation time,
  including a concurrency test in the style of
  `supabase/tests/rider_reassignment_atomicity_test.sql`.

### Related

ADR-001, ADR-003, DEC-APP-008, DEC-E-05 · V1.1 §6 ·
`supabase/migrations/20260811000013_rider_reassignment_atomicity.sql`

---

## DEC-E-03 — `order_number` is `BH-YYYYMMDD-NNNN`

**Status:** ACCEPTED · **Date:** 2026-08-19 · **Owner:** Product Owner

### Decision

The customer-visible `orders.order_number` is
**`BH-YYYYMMDD-NNNN`** — a fixed `BH-` prefix, the calendar date of the
**Asia/Bangkok business day**, and a sequence that **resets each business
day**, zero-padded to at least four digits.

- Generated **server-side only**. A client may never supply, suggest or
  influence it.
- Uniqueness is enforced by the database (`orders_order_number_key`), not by
  application checks.
- The format is fixed **before the first order exists**.

### Why

This ratifies DBQ-011's own recommendation, which weighed the alternatives and
concluded: *"date-prefixed daily sequence… Decide before the first order
exists — changing the format later means two formats in support forever."*

A plain global sequence leaks total order volume to anyone who orders twice —
at ~50 restaurants a competitor could measure BANHAO's throughput from two
orders a week apart. Random base32 avoids the leak but is hard to read aloud
in Thai phone support. The date-prefixed daily sequence leaks only that day's
volume, stays short and speakable, and sorts naturally.

Asia/Bangkok is the business-day boundary because `BUSINESS_RULES.md` states
it as a standing convention — *"Money is always integer satang (CON-003).
Times are **Asia/Bangkok**"* — and the same timezone already governs opening
hours (§3.2).

`order_number` is `not null unique` and is listed in
`orders_enforce_immutable_columns()`, so it can never be rewritten after
creation. That is precisely why the format has to be settled first.

### Alternatives considered

- **Global sequence + prefix (`BH000125`).** Rejected — volume leak.
- **Random base32.** Rejected — poor read-aloud usability for Thai support.

### Consequences

- DBQ-011 is **ANSWERED**; `docs/OPEN_DATABASE_QUESTIONS.md` records it closed
  by this decision.
- Generation is an implementation task, not part of this decision. Whether it
  is a Postgres sequence, a counter table, or derived inside `create_order`
  (DEC-E-02) is left to Phase E, with the **uniqueness guarantee owned by the
  database** in every case.
- **TQ-013 (clock authority and timer reliability) remains OPEN.** It concerns
  which clock drives timers and what happens when the worker is down — not the
  identity of the business timezone, which this decision relies on and which
  `BUSINESS_RULES.md` already fixes.

### Related

DBQ-011, TQ-013, DEC-E-02, DEC-E-05, CON-003 ·
`docs/BUSINESS_RULES.md` (preamble, §3.2) ·
`supabase/migrations/20260811000005_order_domain.sql`

---

## DEC-E-04 — Order addresses come from the authenticated customer's real address

**Status:** ACCEPTED · **Date:** 2026-08-19 · **Owner:** Product Owner

### Decision

`orders.delivery_address_snapshot`, `recipient_name_snapshot` and
`recipient_phone_snapshot` are captured from a **server-validated address row
owned by the authenticated customer**, resolved through the Phase B addresses
API (`/api/v1/me/addresses`). Mock address fixtures are never the source for a
real order.

`orders.address_id` references the source row, but **the snapshot is the
truth**: editing or archiving the address later must not change any existing
order.

**`ADDRESS_OUT_OF_ZONE` remains OPEN and unimplemented** while BQ-008 is
unresolved. No radius, polygon, coordinate list, distance threshold or zone
set may be invented to close it.

### Why

The addresses table already carries exactly the fields the order snapshots
need — `recipient_name`, `recipient_phone`, `address_line`, `landmark`,
`lat`/`lng` — and its own comment states the intent: *"an order snapshots the
address text at creation time regardless… so editing or archiving an address
never rewrites order history."*

The Phase B API exists (`GET/POST/PATCH/DELETE /api/v1/me/addresses`) and is
already scoped to the authenticated user. The customer app, however, still
binds `addresses` to `mockAddressRepository` — Phase C and D deliberately did
not rewire it. An order built from that fixture would snapshot a fabricated
recipient and address into an immutable financial record, which is the same
class of error DEC-E-01 prevents for money.

BQ-008 is `OPEN` and `P1`, and explicitly *"blocks: Checkout validation,
ServiceArea configuration."* Two separate limits exist in the design — a
per-shop delivery radius and admin-level service zones — *"with no documented
precedence,"* and no rejection state is designed. Guessing either would invent
a business rule and a customer-facing failure mode at once.

### Alternatives considered

- **Snapshot from whatever the client posts.** Rejected — the client is not
  the authority for a recipient identity written into an immutable order, and
  it would let a caller address an order to arbitrary text.
- **Ship a provisional zone check (fixed radius).** Rejected — that is
  inventing BQ-008's answer, and a wrongly-rejected order is invisible to
  everyone except the customer who gave up.

### Consequences

- Phase E must rewire the customer app's address repository from mock to the
  real API for the order path. That is in scope (DEC-E-05); rewiring unrelated
  mock screens is not.
- Until BQ-008 is answered, the order path performs **no zone validation at
  all** rather than a guessed one. This is a documented gap, not an oversight.
- `ADDRESS_OUT_OF_ZONE` is **not** added to the error catalogue until it has a
  defined behaviour.

### Related

BQ-008, BQ-001, DEC-E-01, DEC-E-05 ·
`supabase/migrations/20260811000001_identity_domain.sql` ·
`apps/api/src/modules/users/addresses.controller.ts`

---

## DEC-E-05 — Phase E implementation boundary

**Status:** ACCEPTED · **Date:** 2026-08-19 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Phase E builds the order **foundation** and stops there.

**In scope.** `POST /api/v1/orders`, authenticated customer only, identity
from the verified JWT; snapshotting of restaurant, items, options, quantities,
unit prices and address; initial `CREATED` state; the first
`order_status_history` row; the atomic mechanism of DEC-E-02; the nine
`ACCEPTED` transitions plus `CANCELLED` as commands, never `PATCH { state }`;
guarded conditional `UPDATE` per ADR-003; reconciling
`apps/customer/src/mocks/types.ts` to DEC-019; wiring the customer order path
to the real API while retaining Phase D's checkout revalidation.

**Out of scope.** Any payment work (Phase F), any delivery or rider work
(Phase G), settlement, refunds, and every exception state.

**State machine — already locked, not re-decided here.** DEC-019 fixes the
nine core states: `CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED →
PREPARING → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED`.
DEC-APP-006 adds `CANCELLED` and **excludes** `PAYMENT_FAILED`,
`PAYMENT_EXPIRED`, `MERCHANT_REJECTED` and `DELIVERY_FAILED` until their names
and policies are approved. Phase E implements exactly that set and invents no
state. There is **no `CONFIRMED` state** in this system; `MERCHANT_ACCEPTED`
is the merchant's acceptance.

**Cancellation — locked shape, open consequences.** `ORDER_LIFECYCLE.md` §5's
matrix is tagged `PROPOSED` except where a DEC is cited, and the money
consequences from `PREPARING` onward are `OPEN` (BQ-015, BQ-016). Phase E may
implement `CANCELLED` only where no open business question governs the
outcome; the refund and cost-allocation consequences are Phase F work and are
not to be guessed. DEC-021 stands: a rider cancellation never cancels the
order.

**Release gate.** DEC-E-01 stands above all of the above: the phase may be
built, tested and reviewed, but **must not create production orders** until
BQ-026 and BQ-027 are answered.

### Why

V1.1 §19 already defines Phase E's scope and its done-when (*"an order runs
`CREATED → DELIVERED` end to end with a null provider"*). What the repository
lacked was an explicit statement of the four preconditions discovered during
Phase E reconnaissance — fees, atomicity, order number, address source — and a
clear line between what is architecturally locked and what is still a business
question. Without that line the next task has to re-derive it, and the
temptation at each gap is to invent an answer.

### Alternatives considered

- **Start implementation and resolve gaps as they appear.** Rejected — three
  of the four gaps write permanent, immutable data. They must be settled
  before the first write, not during it.
- **Defer Phase E entirely until every question closes.** Rejected — only the
  fee amounts gate production, and they gate nothing structural.

### Consequences

- The next Phase E task starts from a settled boundary: DEC-E-02 names the
  mechanism, DEC-E-03 the order number, DEC-E-04 the address source, DEC-E-01
  the release gate.
- Three open business questions (BQ-026, BQ-027, BQ-008) and one open
  technical question (TQ-013) are explicitly *not* answered by this set and
  remain owned by the Product Owner.

### Related

DEC-019, DEC-APP-006, DEC-021, ADR-001, ADR-003,
DEC-E-01, DEC-E-02, DEC-E-03, DEC-E-04 ·
BQ-015, BQ-016, BQ-026, BQ-027, BQ-008 · V1.1 §6, §19

---

## DEC-038 — Proof of delivery is a mandatory photo, stored privately, with no no-photo completion path

**Status:** ACCEPTED · **Date:** 2026-08-26 · **Owner:** PRODUCT_OWNER

### Decision

Three coupled answers, locked together because none of them is safe to
implement without the other two:

| # | Question | Phase 1 answer | Resolves |
|---|---|---|---|
| 1 | Is the proof photo mandatory? | **Yes.** A delivery cannot reach `DELIVERED` without one. | **BQ-018** (Option B) |
| 2 | What does a rider who cannot photograph do? | **Contacts an operator.** There is no in-app completion path without a photo. | **POD-Q-02** |
| 3 | Where does the photo live? | **A private R2 bucket** (`R2_PRIVATE_BUCKET`), read only through a short-lived signed URL. | **POD-Q-01** storage half |

**1 — Mandatory.** With cash on delivery disabled (DEC-016), the cash-collection
confirmation no longer gates `DELIVERED`, which makes the photo the *only*
evidence a handover happened at all. `docs/RIDER_LIFECYCLE.md` § 10 already
recorded that this raises BQ-018's importance rather than lowering it.

The rule lives in the **API**, not the client: `riderDeliveredRequestSchema`
requires `objectKey`, and `DeliveryCompletionService` verifies the object
structurally and by existence *before* the state machine is touched. A client
that skipped the camera could not complete a delivery even if it tried.

**2 — No escape path, deliberately.** The alternative — a no-photo completion
with a reason code — would invent both an operator capability and a policy
about when a delivery may close unevidenced, neither of which is approved. The
operator force-unassign path is for a rider who did **not** deliver, which is a
different and untrue record. So the blocked screen says `ติดต่อผู้ดูแล` and
stops, and the delivery stays open until an operator intervenes under DEC-031 /
DEC-032's manual-operations capability.

**3 — A private bucket, not a private prefix.** Public access in Cloudflare R2
is granted **per bucket**. `R2_PUBLIC_URL` is an `*.r2.dev` development domain
bound to `R2_BUCKET`, so every object in that bucket is fetchable by anyone
holding its key. A `deliveries/` prefix inside it would be privacy by
obscurity — a 122-bit unguessable key — not privacy by authorization. A second
bucket with no public URL at all is the only structural answer, and it costs
nothing: R2 bills stored bytes and operations, never buckets.

### Alternatives considered

- **Optional photo.** Rejected — it makes the only evidence of handover
  optional in the one phase where no other evidence exists.
- **Mandatory in the UI, optional in the API.** Rejected — it puts a business
  rule in the client, contradicting ADR-001, and yields a guarantee nothing
  enforces.
- **A no-photo completion with a reason code.** Rejected for Phase 1 — see 2
  above. Revisit if operational evidence shows riders genuinely stranded.
- **One bucket with a private prefix.** Rejected — see 3 above.

### Consequences

- `apps/driver` gains a camera (`expo-camera`) and both platform permission
  declarations. A rider must grant camera access to complete any delivery.
- A rider with a broken camera or permanently denied permission **cannot close
  a delivery they actually completed** without an operator. This is a known,
  accepted cost of 1 and 2 together, and it is the first thing to revisit if it
  turns out to happen often.
- `R2_PRIVATE_BUCKET` must be provisioned before POD can run. `StorageService`
  raises rather than falling back to the public bucket when it is unset, and
  refuses to start if it names the same bucket as `R2_BUCKET`.
- **No migration.** `deliveries.proof_photo_path` already existed; the photo
  path is written in the same guarded `UPDATE` that moves `EN_ROUTE →
  DELIVERED`, so it is effectively write-once.

### What this decision does NOT answer

- **Q-012 — PDPA lawful basis and retention.** Still `OPEN`. Photos are now
  being captured with **no retention limit and no purge mechanism anywhere in
  the system**, which is a live exposure that this decision increases rather
  than reduces. BQ-018's own recommendation asked for "an explicit retention
  period set under Q-012"; that half is unanswered.
- **Q-013 — evidential weight in a dispute.** Still `OPEN`.
- **POD-Q-05 — merchant visibility.** Not in V1.
- **POD-Q-07 — database-level immutability.** The path is write-once by
  application rule (the `state = 'EN_ROUTE'` guard), not by a column trigger.
  Making it a database guarantee would need a migration against a locked schema.

### Related

DEC-016 (COD disabled — why the photo is the only evidence), DEC-018, DEC-031,
DEC-032, ADR-001, ADR-003 ·
BQ-018, Q-012, Q-013 ·
`docs/design/BANHAO POD UX Design.dc.html` (POD-Q-01 … POD-Q-07) ·
`docs/BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md` § 7.3, § 15

---

## DEC-039 — POD proof-photo retention duration (Q-012, retention half only)

**Status:** ACCEPTED — RETENTION DURATION ONLY · **NOT** A PDPA COMPLIANCE OR
GO-LIVE APPROVAL · **Date:** 2026-08-26 · **Owner:** PRODUCT_OWNER

### Decision

Three numbers and a mechanism, resolving the retention-duration half of
Q-012 for Phase 1. **Q-012's lawful-basis half is untouched and stays
`LEGAL_REVIEW_REQUIRED`** — see "What this decision does NOT answer" below,
which is not boilerplate here but the load-bearing part of the record.

| # | Question | Phase 1 answer |
|---|---|---|
| 1 | Retention for a **referenced** proof photo (`deliveries.proof_photo_path` still set) | **90 days from `delivered_at`.** |
| 2 | Retention for an **unreferenced** object (a retake's discarded predecessor, or an abandoned upload no delivery ever completed against) | **7 days from the object's own R2 creation time.** |
| 3 | Purge mechanism | **Automatic**, via the existing approved tick worker (DEC-APP-010) — no second scheduler. Bounded, batched, idempotent, fail-safe, auditable. |

**1 — 90 days for referenced photos.** With COD disabled (DEC-016) and DEC-038
making the photo the only evidence a handover happened, the retention window
has to survive the period in which that handover can still be disputed — a
payment chargeback, a customer complaint, an operator review. That window is
not independently known (Q-001, the payment provider, is still `OPEN`, so the
real chargeback window is unknown), so 90 days is a judgment: long enough to
plausibly cover a real dispute, short enough not to reach for a "keep it a
year just in case" default that PDPA's data-minimisation principle does not
tolerate. It is explicitly a number to revisit, not a permanent one — see
"Review trigger" below. Storage cost was not a factor in either direction:
at Phase 1 volume the entire feature is inside R2's free tier regardless of
which of 7/30/90/180/365 days was chosen.

**2 — 7 days for orphans, shorter than 1 because an orphan has no evidential
value at all.** `DeliveryProofService`'s own header already names retakes and
abandoned uploads as an accepted, documented consequence of the presign
pattern — accepted as *existing*, never as *permanent*. An object with no
`deliveries` row pointing at it cannot be evidence of anything, so there is no
dispute-window argument for keeping it as long as a referenced photo. 7 days
only exists to give a stuck-mid-flow rider (POD-Q-02's operator path) a short
window to actually complete before its now-superseded retake is swept.

**3 — Automatic, via the existing tick.** DEC-APP-010 already fixes the
Cloudflare Worker cron as the only scheduler in the system; `DispatchService`
and the payment-tick services already attach additional scheduled work to it
the same way. `ProofPhotoRetentionService` follows the identical shape:
bounded per-tick batches (`POD_RETENTION_BATCH_SIZE` for the referenced-photo
pass, `POD_ORPHAN_SWEEP_PAGE_SIZE` for one page of the orphan sweep — never a
paginate-to-exhaustion loop within one tick), idempotent deletes (R2's
`DeleteObject` is itself idempotent, so a retried run of an interrupted
purge is safe by construction), and a never-throws contract matching
`PaymentEventProcessingService.processOne`'s own — a bad row here must not
fail the payment or dispatch phases sharing the same tick invocation.

**Default-off, deliberately.** `POD_RETENTION_PURGE_ENABLED` (an operational
toggle, not a business value — see "Not an environment variable" below)
gates every delete. Absent, or anything other than the literal string
`'true'`, means the service still runs its listing and counting logic every
tick — so `referencedCandidates`/`orphanCandidates` are always a live report
of what a purge *would* touch — but nothing is actually deleted. A fresh
environment can never start destroying evidence by accident.

**Audit trail.** Each successfully purged *referenced* photo writes one
`audit_logs` row (`actor_type: 'SYSTEM'`, `action: 'PROOF_PHOTO_PURGED'`,
`entity_type: 'delivery'`, `before`/`after` on `proof_photo_path`, `source:
'worker'`) — the schema's existing shape, no migration. An orphan purge
writes **no** `audit_logs` row: an orphan has no `deliveries` row, and
`audit_logs.entity_id` is `not null` — inventing a placeholder delivery id to
satisfy that constraint would misrepresent what happened. The service's own
returned counts (and its logging) are the record for that half instead.

**Order of operations for a referenced purge is fixed and load-bearing:**
delete the R2 object, **then** clear `proof_photo_path` — under a
compare-and-swap guard (`WHERE proof_photo_path = <the exact key just
deleted>`), never a blind `SET proof_photo_path = NULL`. Reversing the order
would risk clearing a live pointer to an object a failed delete left in
place; the CAS guard is what stops a second, concurrent process from having
its own (different) value clobbered.

**Not an environment variable.** `POD_RETENTION_DAYS = 90` and
`POD_ORPHAN_RETENTION_DAYS = 7` are code constants in
`apps/api/src/modules/rider/pod-retention-policy.ts`, not configuration —
the same reasoning `dispatch-policy.ts` already documents for DEC-037's own
numbers (`ACCEPT_WINDOW_SECONDS`, `ROUND_INTERVAL_SECONDS`): an approved
business value belongs in the decision log and in the code that cites it,
not in per-environment configuration where it could drift with no record of
who changed it or why. `POD_RETENTION_PURGE_ENABLED` is the one genuinely
operational piece of this feature and is the one environment variable it
gets.

**No schema migration.** The schema is LOCKED. `deliveries.proof_photo_path`
is already nullable; a purge is an `UPDATE`, not a schema change.
`audit_logs` already accepts the tombstone shape this decision uses. No
`purged_at`, `retention_until`, or new table was added or is needed.

### What this decision does NOT answer

- **Q-012's lawful-basis half — still `LEGAL_REVIEW_REQUIRED`.** This
  decision sets a *duration*. It does not establish a lawful basis for
  processing the photo under PDPA, and it must not be read, cited, or
  represented anywhere as a compliance determination or as approval to store
  real proof photos in production. Nothing in the implementation claims
  otherwise: `.env.example`'s documentation of `POD_RETENTION_PURGE_ENABLED`
  states this explicitly, and enabling that flag in a real deployment remains
  a decision for whoever owns the legal review, not an engineering default.
- **Go-live.** `R2_PRIVATE_BUCKET` is still not provisioned as of this
  decision. This record makes the retention mechanism buildable and
  reviewable; it does not authorize turning it on against real customer data.
- **Q-013 — evidential weight in a dispute.** Still `OPEN`, unchanged.
- **Manual/operator deletion.** No operator deletion capability exists and
  none is built by this decision — DEC-031/DEC-032's manual-operations
  capability does not yet extend to proof photos. If that capability is
  wanted, it needs its own decision: who may delete, under what recorded
  reason, and through what surface (no Admin app exists until Phase I).
- **The customer read endpoint.** `GET /api/v1/orders/:id/delivery-proof`
  (implementation plan §8.3) is not built by this decision and is explicitly
  a separate task. A purged photo is simply unavailable to that endpoint once
  it exists — no new customer-facing copy or legal explanation is invented
  here for that state.
- **Merchant visibility of `proof_photo_path`.** The existing
  `deliveries_select_customer`/`_merchant`/`_rider` policies are unchanged.
  The Q-012 analysis that preceded this decision flagged that the
  table-wide `grant select on public.deliveries` lets a restaurant member
  read `proof_photo_path` even though POD-Q-05 says merchant visibility is
  "not in V1" — recorded here as a known issue, not resolved by this
  decision, and RLS is not touched.

### Review trigger

Re-decide the 90-day figure the first time any of the following becomes
known, rather than treating it as permanent: Q-001 names a real payment
provider (and therefore a real chargeback window), Q-013 settles evidential
weight, or the Q-012 legal review returns with a specific requirement.

### Alternatives considered

- **A single retention window for both referenced and orphan objects.**
  Rejected — an orphan has no evidential value at all, so holding it as long
  as a referenced photo has no justification and is pure PDPA exposure for
  no benefit.
- **Manual-only purge.** Rejected for Phase 1 — no operator surface exists to
  perform it, and building one was explicitly out of scope for this decision
  (see "What this decision does NOT answer").
- **A separate "dry run" flag alongside the enable flag.** Rejected — the
  disabled state already produces the full candidate report (counts, no
  deletes); a second flag would only be a second way to spell the same
  behaviour.
- **`POD_RETENTION_DAYS`/`POD_ORPHAN_RETENTION_DAYS` as environment
  variables.** Rejected — see "Not an environment variable" above.

### Consequences

- `ProofPhotoRetentionService` (`apps/api/src/modules/rider/`) runs from
  `POST /internal/tick`, additive to `TickAcceptedResponse` as `podRetention`.
- `StorageService` gains `listObjects` (one bounded page per call) —  needed
  by the orphan sweep, which has no `deliveries` row to start from. It is
  scoped to the private bucket the same way every other POD operation is.
- `object-key.ts` gains `parseAnyDeliveryProofObjectKey` — the same
  structural check `parseDeliveryProofObjectKey` already performs, minus the
  "and it's *this* delivery" comparison a caller with no delivery id to
  authorize against cannot make. Used only by the orphan sweep.
- `.env.example` documents `POD_RETENTION_PURGE_ENABLED=false` and explains
  why the two day-count numbers are code constants instead.

### Evidence

`apps/api/src/modules/rider/pod-retention-policy.ts`,
`apps/api/src/modules/rider/proof-photo-retention.service.ts` (+ `.spec.ts`),
`apps/api/src/modules/storage/storage.service.ts` (`listObjects`),
`apps/api/src/modules/storage/object-key.ts`
(`parseAnyDeliveryProofObjectKey`), `apps/api/src/modules/tick/tick.controller.ts`.

### Related

DEC-038, DEC-APP-010, DEC-037 (the constants-not-env precedent) · Q-012,
Q-013, Q-001 · BQ-018 · `docs/RIDER_LIFECYCLE.md` § 10 ·
`docs/OPEN_BUSINESS_QUESTIONS.md` (BQ-018, Q-012) ·
`docs/OPEN_DATABASE_QUESTIONS.md` DBQ-008 (retention windows, gated on Q-012)

---

## DEC-040 — Phase J: AI Operations + Human Supervisor is an authorized future phase

**Status:** ACCEPTED — **PHASE AUTHORIZATION** · **IMPLEMENTATION STARTED
2026-09-03**, separately authorized by the Product Owner after this entry was
written; see *Implementation status* at the end. · **Date:** 2026-09-03 ·
**Owner:** PRODUCT_OWNER

### Decision

**Phase J — AI Operations + Human Supervisor** is added to the Phase 1 roadmap
as an approved future phase, positioned **after Phase I**. The nine existing
phases (A–I) and F′ keep their meaning, their order and their current status
unchanged; nothing about Phase G, the branch it is being built on, or Phase I's
"not started" status is altered by this decision.

This decision resolves a governance gap, not an engineering one. The design
package
`docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html`
was committed (`3d6a7752`) and its AI-01 prerequisite was implemented and
merged (`95cc0dc4`, `supabase/migrations/20260903000001_audit_logs_ai_actor_type.sql`),
but AI Operations existed nowhere in the approved phase list — so an
implementation request for it collided with `CLAUDE.md` §10's "build only the
current phase" rule and with V1.1's "any deviation from V1.1 requires a new
Architecture Decision, not an improvisation". That collision is what this entry
removes. It authorizes an **architecture direction**; it does not start the
work, and it does not answer a single open business policy.

**What Phase J is.** One pipeline, in this fixed order:

```
outbox event → normalize → deterministic router → policy evaluation
  → agent (only if unresolved) → command request → guarded domain service
  → verify → audit → resolve / escalate
```

The ten constraints below are the authorization. A Phase J implementation that
violates any of them is not authorized by this decision.

**1 — AI is orchestration, never domain authority.** The agent may classify a
situation, correlate evidence and select an action **from an explicit command
catalog**. It may not implement domain behaviour, and it may not replace,
duplicate or wrap around an existing guarded domain service. The domain service
remains the final authority on every mutation, including the authority to
refuse one.

**2 — No database access from the AI runtime, at all.** The agent process must
not execute SQL, must not reach PostgREST or Supabase directly, must not hold a
database credential of any kind, and must not mutate the database directly. This
is the load-bearing safety property and it is enforced by **absence**, which the
design package's own AI-05 states plainly: every write path in the shipped API
uses the `service_role` client, which bypasses RLS by platform default, so an
agent is safe from RLS bypass *only* because it is handed no client whatsoever.
Least privilege for Phase J therefore lives in the command allowlist and in
scoped read projections — **not** in RLS. Any future proposal to give an agent
process a database client voids this decision's safety model and requires its
own architecture decision before it may be built.

**3 — No financial autonomy.** Refunds, payments, ledger writes, settlement,
commission, rider earnings, merchant payables and any other financial
adjustment are **L5 — never autonomous**, and are absent from the agent's
command catalog entirely rather than merely gated. CON-002 is unchanged: only a
signature-verified provider webhook may confirm a payment, and no agent, tick or
console may set `SUCCESS` or `REFUNDED`. Phase J authorizes **no** payment
behaviour and **no** financial control surface.

**4 — No new business state machines.** Phase J introduces no order, delivery,
payment, rider or merchant state. DEC-018's four separate state domains and
DEC-019's order lifecycle are untouched, and DEC-APP-006's "the nine ACCEPTED
states plus `CANCELLED`, nothing else" continues to hold. An agent that would
need a state the application does not implement (for example `DELIVERY_FAILED`,
deliberately unimplemented) must escalate, never invent the transition.

**5 — Policy is owned by decisions, never by the agent or a prompt.** Phase J
may not introduce a threshold, retry limit, cooldown, timer duration,
cancellation count, confidence cutoff, auto-pause threshold or any financial
rule that is not already an approved decision or an existing cited code
constant (DEC-037's `dispatch-policy.ts` and DEC-039's `pod-retention-policy.ts`
are the established shape: an approved number lives in the decision log and in
the code that cites it). Where a policy input does not exist, the required
behaviour is **escalate or block** — a missing decision is never a licence to
choose a default. Every action must record the policy version that authorized
it.

**6 — Autonomy levels, and confidence is not authorization.** The six levels in
the design package are authorized as the model: **L0 observe · L1 recommend ·
L2 low-risk operational mutation · L3 deterministic policy action · L4 human
approval required · L5 never autonomous.** Authorization to act comes from the
level attached to the *command*, never from the model's own confidence score. A
high-confidence model output does not promote an action's level, and no
configuration may promote an L5 action to anything else. L4 must **revalidate
the current domain state at execution time**; an approval whose underlying state
has since changed must **fail closed** and re-escalate, never execute stale.

**7 — Human Supervisor is an exceptions surface, not an admin CRUD app.** Phase
J includes a supervisor surface scoped to escalations, L4 approvals, blocked
actions, failed commands, operational incidents, AI recommendations needing
human judgement, and the audit context behind each. It is **not** authorized as
a general admin CRUD application, and it is explicitly **not** authorized to
contain any financial control (no refund, no payout, no fee adjustment). It
remains subject to DEC-032: an operator action carries a recorded reason, which
`audit_logs`' own CHECK already enforces for `actor_type = 'OPERATOR'`.

**8 — AI audit identity is `AI`, never `SYSTEM`.** Every autonomous action
writes `audit_logs.actor_type = 'AI'`, distinguishing an agent decision from the
tick, the dispatch round and the payment processor, which all legitimately write
`SYSTEM`. This prerequisite is **already satisfied and locked**: the additive
CHECK widening in `supabase/migrations/20260903000001_audit_logs_ai_actor_type.sql`
(commit `95cc0dc4`) added `'AI'` while preserving every existing actor type, the
append-only mutation-rejecting trigger, the DEC-032 operator-reason CHECK, RLS
and grants — proven by six assertions in
`supabase/tests/audit_logs_ai_actor_test.sql`, run in the domain suite. The
migration is **merged but not yet applied to `banhao-dev`**; applying it stays a
separate explicit instruction. Append-only semantics are not weakened by Phase
J: a correction is a compensating record, never an `UPDATE`.

**9 — Existing infrastructure first; no speculative infrastructure.** Phase J
reuses `outbox` (ADR-005), `jobs` (ADR-006, already the retry/attempt/dead-letter
substrate), the single Cloudflare Worker tick (DEC-APP-010 — AI operations
becomes another tick consumer, not a second scheduler), `dispatch-policy.ts`,
the existing guarded domain services, `audit_logs`, `reconciliation_cases` (a
generic operational queue since DEC-039's neighbouring work — see the
`RIDER_RELEASE_INVARIANT` precedent) and the existing notification
infrastructure. This decision authorizes **no** vector database, **no** Redis or
cache, **no** new message broker, **no** second database and **no**
`ai_operations_cases` table. The design package's own AI-02 records that the V1
console is designed against a *projection* of `jobs` + `audit_logs` +
`reconciliation_cases` precisely so that no migration is needed; a case table
remains a V2 recommendation requiring its own decision. Any new escalation
`kind` value would itself be an additive CHECK widening under the existing
migration rule in `CLAUDE.md` §10 — explicitly instructed, never opportunistic.

**10 — Driver/Delivery compatibility.** Phase J inherits, and may not silently
redefine, the delivery decisions the design package lists as locked: **OD-04**
(delivery failure and resolution — arrival, contact, timer, resolution; the
rider decides no financial outcome), **OD-05** (external Google Maps
navigation; navigation never mutates delivery state, `ARRIVED` stays a
server-side transition, no geofence — so an agent may never infer arrival from a
location ping: position is evidence, never a state change) and **OD-06** (no
unrestricted rider cancel; a required reason; release/reassign before pickup via
`release_rider_assignment()` as the sole sanctioned path, controlled resolution
after pickup, with the financial outcome outside rider and agent authority).
**BQ-013** (merchant acceptance timeout) remains an `OPEN` business question:
its deadline must stay server-side and configurable, and its auto-pause
threshold does not exist, so Phase J may not hard-code one — auto-pause is a
supervisor action with a recorded reason until a decision supplies the number.

### What this decision does NOT authorize or answer

- **It does not start Phase J.** No AI implementation code was authorized by
  this entry when it was written: no normalizer, router, policy engine, agent
  runtime, command handler, provider integration, supervisor UI, AI endpoint,
  AI database client or AI table. **The Product Owner authorized the start
  separately on 2026-09-03** — see *Implementation status* below. The ten
  constraints above bind that work unchanged; what lapsed is the "not yet",
  not a single boundary. Phase G remains the current work on `feature/g7-driver-availability`,
  and Phase I remains "not started" with no admin design artifact.
- **It does not resolve any open business policy.** Safe drop-off eligibility
  (OD-04, `UX-Q-006`), the failed-delivery outcome and who bears the cost of
  wasted food (BQ-015), merchant auto-pause thresholds (BQ-013), the no-rider
  terminal outcome, repeated-cancellation counts and windows, and every
  financial policy (Q-001, Q-002, Q-010/BQ-028, Q-020, BQ-027) all remain
  exactly as open as they were before this entry. Phase J's required behaviour
  when it meets one of them is to escalate.
- **It selects no vendor, model or region.** The design package deliberately
  locks none, and this decision locks none. Phase J must be built behind a
  provider seam so a model implementation can be plugged in later; choosing one
  is a separate decision, not an implementation detail.
- **It does not authorize a new table, a schema change or a live migration.**
  The database rule in `CLAUDE.md` §10 is unchanged, and the already-merged
  AI-01 migration is still unapplied to `banhao-dev` by design.
- **It does not rewrite the design package.** That artifact stays as authored;
  its AI-01 item ("the founder's call") is answered by this decision plus the
  merged migration, and its AI-02 and AI-05 items remain open exactly as
  written.

### Implementation status (added 2026-09-03, after the entry above)

Phase J implementation was authorized by the Product Owner on 2026-09-03 and
started the same day, on `feature/g7-driver-availability`. What exists:

| Slice | Commit | State |
|---|---|---|
| **J-01 — Merchant acceptance timeout** | `44abab39` (fix `44eed3fc`) | Full pipeline, running as a tick phase. In production the policy stage resolves `MISSING` and every routed event escalates `ESC-UNKNOWN` **without reaching the agent**, because BQ-013 supplies no deadline. That is constraint 5 working, not an unfinished path |
| **J-02 — No-rider triage** | `0726b269` | The design package's § 10 "No rider found" playbook. Policy **resolves** from DEC-022's approved decision point; the playbook has **no command at all**, so `ESC-NORIDER` is the only outcome reachable — it can never cancel a delivery, fail it, or say anything to a customer |
| **Agent-failure containment** | `dede3719` | An unavailable or unparseable agent escalates `ESC-UNKNOWN` with the failure recorded, per design package § 11 — never a silent loss, never a retry of the same prompt, and no cheaper-model fallback tier (that would be selecting a vendor) |

Held to the ten constraints, and verifiable as such: the agent is constructed
with no Supabase client, credential or HTTP client; its projections carry no
financial field; the command catalog contains no financial or state-changing
command; no table, column, RLS policy or migration was added; and every audit
row is written with `actor_type = 'AI'`.

Not built, and each blocked rather than deferred by preference:

- **Every remaining playbook in the design package § 10** — safe drop-off,
  failed delivery, customer-unavailable resolution, repeated rider
  cancellation, repeated merchant non-response and merchant auto-pause — is
  blocked on an open business decision (`UX-Q-006`, BQ-015, BQ-013, the
  repeated-cancellation counts and windows, Q-032). Constraint 5 forbids
  supplying any of those numbers to unblock the work.
- **The supervisor console** (design package § 09, S-01 … S-07) depends on
  Phase I, which has not started and has no admin design artifact. Escalations
  are durable and queryable in `audit_logs` in the meantime.
- **A model vendor.** The agent port is bound to a deterministic adapter; no
  provider, model or region is selected, exactly as this decision requires.

### The distinction this decision is making

It authorizes **"AI may operate within explicit policy and command
boundaries."** It does **not** authorize **"AI may decide business policy."**
Those are different claims and only the first is approved here.

### Alternatives considered

- **Implement AI Operations without a decision entry, treating the committed
  design package as authorization.** Rejected — a design package is analysis,
  not approval; `CLAUDE.md`'s source-of-truth hierarchy makes the approved
  architecture and phase list authoritative over any design artifact, and V1.1
  requires a decision for a deviation. Building first would have inverted that.
- **Insert AI Operations into Phase G, where the work is currently happening.**
  Rejected — it would silently redefine an in-flight phase and break the
  one-phase-at-a-time rule that the phase list exists to enforce.
- **Renumber the phases so AI Operations lands earlier.** Rejected — every
  document, commit message and handoff cites phases by letter; renumbering
  would invalidate that history for no gain.
- **Authorize an `ai_operations_cases` table now, as the design package
  recommends for V2.** Rejected for this decision — the V1 console is
  explicitly designed against a projection so that no migration is required.
  A case table can be decided on its own evidence later.
- **Defer the decision until Phase I is finished.** Rejected — the AI-01
  migration is already merged, so the repository would keep carrying an
  implemented prerequisite for a phase that officially did not exist. The
  governance record should not lag the schema.

### Consequences

- The Phase 1 roadmap is now **A–I, F′, and J**. Phase J sits after Phase I and
  depends on the phases whose events, jobs, domain services and notifications it
  orchestrates (E, G and H in particular).
- `CLAUDE.md` §9 and `docs/ROADMAP.md` gain Phase J as **AUTHORIZED — NOT
  STARTED**. No other phase's status changes.
- A future Phase J implementation task starts from this entry plus the design
  package, and must produce its own slice-level decisions for anything this
  entry leaves open.
- `docs/TODO.md` is deliberately untouched: it tracks engineering tasks, and
  Phase J has no authorized task yet.

### Evidence

`docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html`
(committed `3d6a7752`; its AI-01/AI-02/AI-05 items, the L0–L5 autonomy table,
the ESC-* escalation identifiers, and the "locked" OD-04/OD-05/OD-06 list) ·
`supabase/migrations/20260903000001_audit_logs_ai_actor_type.sql` and
`supabase/tests/audit_logs_ai_actor_test.sql` (commit `95cc0dc4`) ·
`docs/BANHAO-APP-ARCHITECTURE-V1.md` §19 (the nine phases + F′) · `CLAUDE.md`
§9/§10.

### Related

DEC-018, DEC-019, DEC-APP-006 (no new state) · DEC-032 (operator reason),
DEC-031 · CON-001, CON-002, CON-003, CON-005 · DEC-APP-005, DEC-APP-007,
DEC-APP-008 (writes go client → API → Supabase), DEC-APP-010 (one tick) ·
DEC-037, DEC-039 (approved-number-as-cited-constant precedent) · DEC-021,
DEC-022 · ADR-005 (outbox), ADR-006 (jobs) · OD-04, OD-05, OD-06 (Driver +
Delivery design package) · BQ-013, BQ-015, Q-001, Q-002, Q-020 (all still
open)

---

## DEC-041 — Merchant operational availability is a separate additive field on `restaurants`, never `status` and never the temporary-closure columns

**Status:** ACCEPTED — **STORAGE AND TRANSITION MODEL ONLY** · **NOT** an
answer to BQ-013, BQ-007, AV-Q03 · **Date:** 2026-09-04 · **Owner:**
PRODUCT_OWNER

### Decision

This entry records the decision lock that authorized the merchant
availability work implemented at `7ea20a65`
(`supabase/migrations/20260904000001_restaurant_availability_mode.sql`). The
implementation cites that lock as its authority in three places — the
migration header, `packages/validation/src/restaurant-availability.ts` and
the commit message — but the lock itself was never written into this file.
That governance gap is what this entry closes. It authorizes nothing new and
changes no shipped behaviour.

**Canonical identifier: `M-AV` (Merchant Availability — NORMAL / BUSY /
PAUSED).** The design package labels the work `M13`, which collides with
`docs/design/BANHAO-UX-SPEC-V1.md` §6, where M-13 is *Earnings* and M-14 is
*Settings / staff / profile*. Those two roadmap slots keep their meanings
unchanged and no availability item is added to the merchant roadmap. `M-AV`
extends the `AV-` namespace the work already established (`AV-Q01…Q04`,
`AV-D01…D04`, `AV-T1…T5`, `AV-E5`), so design states map `M-13.A/B/C →
M-AV.A/B/C`. Git history is not rewritten: commit `7ea20a65` keeps its
message, and this entry is the mapping.

1. **`restaurants.availability_mode`** — `NORMAL` / `BUSY` / `PAUSED`, an
   operational mode distinct from lifecycle. `restaurants.status` and its
   five-value CHECK are untouched; a Busy or Paused restaurant keeps
   `status = 'ACTIVE'`. Reusing `status` was rejected on a specific, verified
   ground: `restaurants_select_active` filters on `status = 'ACTIVE'`, so a
   status-based mode would drop the restaurant out of the public catalogue —
   the exact inverse of what Busy means.
2. **`restaurants.busy_prep_minutes`** — one of `10 / 20 / 30 / 45 / 60`,
   enforced by a database CHECK, not by application validation alone. The
   same five values M-05's accept dialog offers, reused deliberately. Never
   `restaurants.avg_prep_minutes`, which is never overwritten to signal a
   mode (**AV-D01**).
3. **The pairing constraint** — `BUSY` always carries a value; `NORMAL` and
   `PAUSED` always carry NULL. A table CHECK, so it binds every writer rather
   than one endpoint.
4. **PAUSED writes neither `temporarily_closed_until` nor
   `temporary_close_reason`.** Those columns exist and have a live
   customer-facing reader, but their semantics belong to **BQ-007**, which
   stays OPEN.
5. **PAUSED changes no existing order, no cart, no payment, no delivery, and
   creates no reconciliation or ledger row.** It blocks the door; it does not
   touch anyone already inside. The merchant board keeps showing every
   in-flight order with the same actions.
6. **`create_order()` remains the single order-creation-safety authority.**
   The PAUSED refusal is a second condition inside the existing function,
   never a second independent gate, and the pre-existing "is not ACTIVE"
   raise is byte-for-byte unchanged.
7. **Cart validation reuses the existing `RESTAURANT_CLOSED` code**
   (`apps/api/src/modules/cart/cart.service.ts`), one more named 409
   alongside `PRICE_CHANGED` / `ITEM_UNAVAILABLE` / `MIXED_RESTAURANT`. No
   second mechanism, and never a client-side-only block.
8. **No `availability_set_by`, no new actor, no new RLS policy, no new
   grant.** `audit_logs.actor_id` already records who acted;
   `grant select on public.restaurants to anon, authenticated` is
   table-level, so both new columns are covered and are public by design.
   `authenticated` still holds no UPDATE on `restaurants`.
9. **Audit:** one `audit_logs` row per real change,
   `action = 'MerchantAvailabilityChanged'`, `actor_type = 'MERCHANT'` —
   never `SYSTEM`, never `OPERATOR` — carrying the before/after mode and busy
   minutes. An identical repeat request is a no-op: no UPDATE, no audit row
   (AC-12).
10. **Transitions are guarded conditional UPDATEs** (ADR-003). Resume always
    returns to NORMAL and never directly to BUSY; `PAUSED → BUSY` is two
    calls (**AV-D02**).
11. **BQ-013 auto-pause remains deferred in full** — threshold, window,
    duration, cooldown and consequence are all OPEN, and DEC-040 §5 forbids
    supplying any of them as a default. No merchant-facing control performs
    or acknowledges an L4 operator action (AC-15), and no threshold, count,
    window, duration or cooldown value appears in any string, constant,
    config default or test fixture (AC-16).
12. **M-05's `orders.prep_minutes` is unchanged** — same column, same `> 0`
    CHECK, same accept-time write, same M05-Q-01 openness about the preset
    list.
13. **AV-Q01 is answered: Busy affects the customer-facing pre-order
    estimate only.** It does not change M-05, `orders.prep_minutes`,
    `POST /orders/:id/accept` or the accept dialog, which stays unaware of
    the mode and continues to preselect nothing. The accept dialog having no
    mode awareness is therefore correct by decision, not an omission.

### What this decision does NOT answer

- **AV-Q03 / BQ-007** — what a pause's duration means, and whether a pause
  may be indefinite. **OPEN.** The pause dialog says so in its own copy:
  `ระยะเวลาหยุด — ยังไม่กำหนด`.
- **BQ-013** in any part. **DEFERRED**, per item 11.
- **AC-04** — whether the estimate the customer was shown is persisted as
  order history. Answered separately by **DEC-042**; nothing in this entry
  decides it.

### Review trigger

Any of: BQ-013 receiving an approved threshold (which introduces a second
setter and reopens item 8); BQ-007 settling temporary-closure semantics
(which may make items 4 and 5 restate-able); a decision to let a pause carry
a duration.

### Alternatives considered

Extending `restaurants.status` (rejected — the RLS trap above); reusing the
temporary-closure columns (rejected — BQ-007 semantics); a separate
availability table (rejected — `restaurants` already stores operational
availability alongside lifecycle, and `rider_availability`'s separation
exists for continuous GPS under DBQ-005, which does not apply here);
overwriting `avg_prep_minutes` (rejected by AV-D01).

### Evidence

`supabase/migrations/20260904000001_restaurant_availability_mode.sql`,
`supabase/tests/restaurant_availability_test.sql` (22 assertions, sections
A–F), `apps/api/src/modules/merchant/restaurant-availability.{service,controller}.ts`,
`apps/api/src/modules/cart/cart.service.ts`,
`apps/api/src/modules/orders/orders.service.ts`
(`raiseFromCreateOrderError`), `packages/validation/src/restaurant-availability.ts`,
`apps/customer/src/lib/catalogDisplay.ts`,
`apps/merchant/src/components/AvailabilityDialog.tsx`,
`docs/design/BANHAO MERCHANT - NORMAL BUSY PAUSE - AVAILABILITY FLOW.dc.html`,
commit `7ea20a65`.

### Related

DEC-042 (the customer-quoted estimate this mode decides) · DEC-040 §5 (a
missing decision is never a licence to choose a default) · DEC-APP-008
(writes stay in the API) · ADR-003 · DEC-E-02 (`create_order()` atomicity) ·
DEC-D-01 / DEC-D-02 (cart validation) · DEC-032 · BQ-007, BQ-013 · AV-Q01
(answered here), AV-Q03 (open), AV-Q04 (answered here) ·
`docs/BQ-013-HANDOFF-03-DECISION-PACK.md`

---

## DEC-042 — The customer-quoted preparation estimate is persisted on the order

**Status:** ACCEPTED — **AC-04** · **Date:** 2026-09-04 · **Owner:**
PRODUCT_OWNER

### Decision

The preparation-time estimate the platform presents to a customer
immediately before they place an order is **historical order state and is
persisted server-side at creation**, in one additive nullable column on
`public.orders` — shipped as `customer_quoted_prep_minutes`
(`supabase/migrations/20260904000002_orders_customer_quoted_prep_minutes.sql`).

M-AV (DEC-041) made that estimate depend on a merchant-controlled mode that
can change at any moment, while the number itself was derived live from
`restaurants` on every render. An order placed at a Busy restaurant showed
one figure before payment and left no record of it afterwards; the merchant
could return to Normal a second later and nothing would show what the
customer had been told. This is the same class of fact the schema already
snapshots eleven times over, for the reason
`20260811000005_order_domain.sql` states about money: *"a rate changing later
must not be able to rewrite what the customer was actually charged."*

### The semantic contract

| Property | Contract |
|---|---|
| **Meaning** | The preparation-time estimate the platform presented to the customer and that was in force when the order was created |
| **Type** | Integer minutes |
| **Nullability** | Nullable, no default, **no backfill**. NULL means *no estimate was recorded* — never zero, and never "substitute the restaurant's current value" |
| **Capture point** | `create_order()`, server-side, in the same transaction and from the same `restaurants` row the availability guard already reads. **No parameter, no client input, no update-it-afterwards path** |
| **Derivation** | BUSY → `restaurants.busy_prep_minutes`; NORMAL → `restaurants.avg_prep_minutes`; PAUSED is unreachable because `create_order()` refuses it. A NULL restaurant estimate yields a NULL quote (**AV-E5**) |
| **Mutability** | **Immutable after creation**, in `orders_enforce_immutable_columns()` alongside the other snapshots — for every role, including `service_role` |
| **Not `orders.prep_minutes`** | That is the *merchant's* per-order answer, given later at accept time (M-05). Different actor, different moment, different question. The two may legitimately differ, and **neither defaults from the other in either direction** |
| **Not `orders.quoted_eta_minutes`** | That is a delivery-**arrival** estimate. This is kitchen work only, and **must not participate in any delivery-ETA calculation** unless a later decision says so explicitly. `quoted_eta_minutes` is not repurposed, written or read |
| **Visibility** | Readable by the customer on the existing order-detail path under the existing `orders_select_customer` policy — no new endpoint, no new RLS policy, no new grant (the `orders` `select` grant is table-level) |
| **Scope** | A historical quote and nothing else. Not an SLA, not a promise the platform enforces, and read by no dispatch, pricing or ledger logic |

**Exactly one field.** No mode snapshot, no quote timestamp, no second quote
column: `placed_at` already timestamps the quote and the mode is recoverable
from `audit_logs`.

**Customer surface.** C-14 order tracking renders one caption in one slot
(**AV-D03** — one estimate, never a before/after pair): the merchant's
`prep_minutes` once it exists, and the quote before that. Both are omitted
when null. Neither may be presented as a delivery ETA, an arrival time or a
guaranteed delivery time. C-19 order detail is unchanged — its design canvas
has no prep caption, and adding one would be design work this decision does
not authorize.

### What this decision does NOT answer

- **AV-Q03 / BQ-007 / BQ-013** — untouched, and not closed by any part of
  this entry.
- **Whether the quote should ever feed a delivery ETA.** It must not, until a
  separate decision says otherwise.
- **What to show a customer whose order carries no quote.** Nothing is shown,
  which is the existing `prep_minutes` behaviour; whether that should change
  is a design question nobody has asked yet.
- **Anything about orders placed before this column existed.** They carry
  NULL permanently. No reconstruction from `audit_logs` is authorized, and
  none is performed.

### Alternatives considered

**Do not persist** (amend AC-04 to make the estimate informational only) —
rejected: it leaves the dispute case unanswerable, leaves the pre-accept
tracking caption empty, and pushes anyone who needs the answer into replaying
`audit_logs` mode changes against `placed_at`, which is a column with extra
steps, no coverage of pre-M-AV orders and no immutability guarantee.
**Repurpose `orders.quoted_eta_minutes`** — rejected: it is unused but not
unowned; it means arrival, and prep time plus travel time is not an arrival
time. **Default the quote from, or into, `orders.prep_minutes`** — rejected:
it aliases two different actors' answers, exactly the mistake
`merchant-acceptance-policy.ts` refuses for policy values.

### Consequences

- One additive migration (`20260904000002`), bringing the repository total to
  **26**. No existing migration was edited.
- `create_order()` and `orders_enforce_immutable_columns()` are restated in
  full, because PL/pgSQL has no add-a-clause equivalent. Every other line of
  both is reproduced unchanged.
- 16 SQL assertions (`supabase/tests/order_customer_quoted_prep_test.sql`,
  sections A–H) prove derivation, nullability, immutability, independence
  from `prep_minutes` and separation from `quoted_eta_minutes` against real
  PostgreSQL.
- **Applied and verified on `banhao-dev` 2026-09-04**, under a separate,
  explicit operational instruction (`CLAUDE.md` §10) — `supabase migration
  list --linked` shows the migration with a matching Remote entry, and a
  direct schema read confirms `orders.customer_quoted_prep_minutes` exists
  with its designed CHECK, that `orders_enforce_immutable_columns()` protects
  it, and that every pre-existing order row reads NULL with no backfill.

### Evidence

`supabase/migrations/20260904000002_orders_customer_quoted_prep_minutes.sql`,
`supabase/tests/order_customer_quoted_prep_test.sql`,
`apps/customer/src/data/orderQueries.ts`,
`apps/customer/src/data/orderMappers.ts`,
`apps/customer/src/domain/order.ts`,
`apps/customer/src/screens/OrderTrackingScreen.tsx` (+ `.test.tsx`),
`apps/customer/src/repositories/supabaseOrderDetail.test.ts`.

### Related

DEC-041 (M-AV — the mode this quote is derived from) · DEC-E-02
(`create_order()` is the sole atomic write boundary) · DEC-E-01 (server
derives what the client must not supply) · DEC-APP-008 · ADR-003, ADR-007 ·
CON-002 (the client never decides a fact of record) · M-05
(`orders.prep_minutes`, `20260901000001`) · AV-D01, AV-D03, AV-E5 ·
`docs/design/BANHAO MERCHANT - NORMAL BUSY PAUSE - AVAILABILITY FLOW.dc.html`
AC-04

---

## DEC-043 — Merchant commission rate: 8% of the food subtotal, rounded to whole baht

**Status:** ACCEPTED · **Date:** 2026-09-05 · **Owner:** PRODUCT_OWNER

### Decision

The Phase 1 merchant commission is **Option A — percentage of the food
subtotal**, at a rate of **8%**, applied to **food subtotal only** (delivery
fee and service fee are excluded from the base), rounded to the nearest whole
baht:

```
merchant_commission_satang = round_to_whole_baht(food_subtotal_satang × 8%)
```

This resolves the numeric half of **BQ-028 / Q-010**, which DEC-025 left
`OPEN`. It does not authorize writing the ledger-posting code — see
Consequences.

### Why

Product Owner decision, 2026-09-05. Option A is the model merchants already
understand from national platforms and the only one whose arithmetic
`docs/SETTLEMENT_MODEL.md` § 4.1 has already validated end to end for a
percentage-of-food-subtotal shape. 8% is a deliberate, explicit departure from
the design's illustrative 10% — a merchant-friendly rate is treated as a
competitive instrument in a 20–30-shop district won on relationships, per
`OPEN_BUSINESS_QUESTIONS.md` BQ-028's own recommendation.

### Alternatives

Fixed fee per order, hybrid (percentage + fixed), and monthly subscription are
compared in `docs/SETTLEMENT_MODEL.md` § 5. Rejected for the same reasons that
document records: a fixed fee is punishing on the district's characteristically
cheap orders; a hybrid is harder to explain for no clear gain at this volume;
a subscription adds billing, dunning and suspension machinery a solo founder
does not need at launch.

### The base and the rounding rule, both stated explicitly

- **Base: food subtotal only.** Not the order total, not the total charged,
  not the amount after discount, and not inclusive of the delivery fee
  (DEC-023/DEC-035) or the service fee (DEC-024/DEC-036). `SETTLEMENT_MODEL.md`
  § 5 flagged this as a question every option needed answered explicitly; this
  decision answers it for Option A.
- **Rounding: to the nearest whole baht**, matching the convention already
  visible in the design's own samples (95→10, 75→8) and CON-003's ban on any
  remainder. The satang value inside a whole-baht boundary is not itself
  specified further by this decision — round-half-up is the ordinary reading
  and is left to the implementing engineer's usual rounding convention unless
  a future decision states otherwise.

### The old 10% sample is not this rate

The `10% ของยอดอาหาร` figure in the design canvas, and every sample derived
from it (120→12, 180→18, 260→26, 95→10, 75→8 in `SETTLEMENT_MODEL.md` § 4.1),
remains exactly what DEC-025 already said it was: **an illustrative design
sample, historical evidence of what the design assumed, never an approved
rate.** It is not retroactively relabeled as 8%, and it must not be read as
either confirming or approximating this decision. **8% is the only approved
commission rate as of this decision.**

### Consequences

- Q-010 and BQ-028's numeric half are resolved. Commission is confirmed as
  BANHAO revenue, consistent with DEC-025's money-flow direction
  (`Merchant → commission → BANHAO`), which this decision does not reopen.
- **BQ-029 (rider earnings formula) is untouched and remains `OPEN`.** Nothing
  in this decision supplies, implies, or constrains a rider rate, and the
  delivery-side funding gap `SETTLEMENT_MODEL.md` § 4.1 describes is not
  resolved by an 8% commission — that arithmetic is BQ-029's to settle.
- **DEC-035 (flat ฿10 delivery fee) and DEC-036 (fixed ฿5 service fee) are
  unaffected** — this decision touches only the commission line.
- This decision is **documentation/business-decision locking only.** It does
  not itself write the ledger-posting code, the commission-calculation
  function, a database migration, or any schema change. `docs/DECISIONS.md`
  and `docs/SETTLEMENT_MODEL.md`'s own consequences text for DEC-025 (§
  "Consequences": "no settlement code may be written" until the rate resolves)
  is satisfied by this decision with respect to the rate; the ledger-writing
  implementation itself remains a separate, not-yet-authorized engineering
  task.
- No schema change is required to record this rate: `ledger_entries.amount_satang`
  already stores a signed amount, not a formula (`supabase/migrations/20260811000007_ledger_domain.sql`).

### Evidence

Product Owner instruction, 2026-09-05 ("BANHAO — BQ-028 / Q-010 DECISION
LOCK").

### Related Requirements

CON-003 (ledger balances to zero, integer satang)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 5 · `docs/OPEN_BUSINESS_QUESTIONS.md` BQ-028 ·
`ai/KNOWLEDGE/QUESTIONS.md` Q-010

### Supersedes / Superseded By

Resolves the `OPEN — NUMERIC RATE` half of DEC-025, which otherwise stands
unchanged. / None.

---

## DEC-044 — Rider earning model: flat ฿12 per completed delivery

**Status:** ACCEPTED · **Date:** 2026-09-05 · **Owner:** PRODUCT_OWNER

### Decision

The Phase 1 rider earning model is **flat per completed delivery**, at
**1,200 satang (฿12)**. The earning applies when a delivery reaches the
completed/delivered state. This resolves **BQ-029**, which DEC-023 left
`OPEN` on the rider side.

No distance component, no base-plus-distance, no zone pricing, no surge or
peak-hour bonus, no minimum earnings guarantee, and no tips — none of these
exists in Phase 1. No rider-side platform fee exists in Phase 1 either (see
Consequences).

### Why

Product Owner decision, 2026-09-05. A flat per-delivery amount is the only
model whose required input (a completed-delivery count) already exists in the
live schema today — `deliveries.state` reaching its terminal delivered state.
The other documented options (distance-based, base + distance, zone-based)
each depend on a distance or zone capability that does not exist: no
geocoding or routing provider is selected, `deliveries.distance_m` is never
populated by any code path, and the zone/service-area tables are deferred
from the schema — the same infrastructure gap **DEC-035** already cited as
its own reason for rejecting distance-banded *delivery* pricing in Phase 1.

### Alternatives

- **Distance-based** and **base + distance** (`docs/RIDER_LIFECYCLE.md` § 9,
  `docs/OPEN_BUSINESS_QUESTIONS.md` BQ-029) — rejected for Phase 1: no
  distance-measurement capability exists to compute either.
- **Zone-based** — rejected for Phase 1: the zone/service-area tables this
  would need are deferred, not built.
- **Peak/surge bonus, minimum guarantee, tips** — each considered as a
  modifier layerable on the flat amount; none is approved for Phase 1. The
  design's own `D-13` sample assumes a peak bonus (`โบนัสชั่วโมงเร่งด่วน ฿72`)
  and a rider-side platform fee (`ค่าธรรมเนียมแพลตฟอร์ม −฿38`) exist —
  **neither is activated by this decision.** They remain exactly what
  DEC-023 already called the design's illustrative samples: evidence of
  intent, not an approved rule.

### Consequences

- `deliveries.rider_earning_satang` may now be computed and written — a
  separate, not-yet-authorized engineering task. This decision does not
  itself write that code, add a migration, or change the ledger.
- **No `RIDER_PAYABLE` ledger entry is authorized by this decision alone.**
  Posting one is the engineering task the Consequences clause above defers.
- **The ฿10 customer delivery fee (DEC-035) and the ฿12 rider earning locked
  here are separate business values.** There is a ฿2-per-delivery difference
  between them. This decision does **not** assign that ฿2 to merchant
  commission, service fee, or any other revenue category — no funding rule is
  created, and none should be inferred. The gap is documented, not resolved,
  exactly as `docs/SETTLEMENT_MODEL.md` § 4.1 already flagged it as an open
  unit-economics question, not something this decision settles.
- **DEC-035 (delivery fee), DEC-036 (service fee) and DEC-043 (commission)
  are unaffected** — this decision touches only the rider earning line.
- **BQ-024 (cancellation and waiting compensation) is untouched and remains
  `OPEN`.** Any future compensation is its own ledger line
  (`RIDER_COMPENSATION`), never folded into the ฿12 flat earning locked here.
- **Admin configurability is a stated future intent, not built by this
  decision.** The ฿12 amount is recorded as the Phase 1 default/current
  configured value; no Admin UI, configuration table, or API is authorized
  here. Whatever mechanism eventually makes it configurable **must not
  retroactively change an already-completed delivery's earning** — a future
  change may only affect deliveries completed after the new value takes
  effect, and a historical earning must remain auditable against the value
  that was in effect when it was calculated. This decision fixes that
  constraint; it does not design the mechanism that will satisfy it.
- No schema change is required to record this rate: `deliveries.rider_earning_satang`
  already exists as a nullable `bigint` (`20260811000009_delivery_domain.sql`),
  and `ledger_entries.amount_satang` already stores a signed amount, not a
  formula.

### Evidence

Product Owner instruction, 2026-09-05 ("BANHAO — BQ-029 RIDER EARNING MODEL —
DECISION LOCK ONLY").

### Related Requirements

CON-003 (ledger balances to zero, integer satang) · REQ-001 (compensation is
never folded into ordinary earnings)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 8 · `docs/RIDER_LIFECYCLE.md` § 9 ·
`docs/OPEN_BUSINESS_QUESTIONS.md` BQ-029 · `docs/DATABASE_DESIGN.md`
(`deliveries.rider_earning_satang`)

### Supersedes / Superseded By

Resolves the rider-side half of DEC-023's `OPEN — NUMERIC PRICING` (the
customer side was already resolved by DEC-035); DEC-023's money-flow model is
otherwise unchanged. / None — but the ฿2-per-delivery gap this decision's own
Consequences clause left unresolved is separately answered by **DEC-045**
(BANHAO platform write-off). This decision's own ฿12 amount and model are
unchanged by DEC-045.

---

## DEC-045 — The ฿2 delivery funding gap is a BANHAO platform write-off

**Status:** ACCEPTED · **Date:** 2026-09-05 · **Owner:** PRODUCT_OWNER

### Decision

Phase 1 intentionally subsidizes the difference between the customer delivery
fee and rider earning. The customer is charged ฿10 (1,000 satang) per
delivery under **DEC-035**, while the rider earns ฿12 (1,200 satang) per
completed delivery under **DEC-044**. **BANHAO absorbs the ฿2 (200 satang)
difference as a platform delivery write-off.** This write-off is independent
of merchant commission and customer service fee and must not be treated as
funded by either unless a later business decision explicitly changes this
rule.

**Accounting intent:** for each completed delivery, the ฿2 platform delivery
subsidy is represented explicitly as `PLATFORM_WRITE_OFF`, so the rider
earning obligation and its funding are auditable rather than silently
absorbed. This resolves **BQ-040**, the funding-relationship question DEC-044's
own Consequences clause left open.

### Why

Product Owner decision, 2026-09-05. Of the documented options, an explicit
write-off is the smallest change that gives the ฿2 a named, auditable meaning:
`PLATFORM_WRITE_OFF` already exists in the `ledger_entries.account` enum
(`20260811000007_ledger_domain.sql`) and is currently unused, so recording it
needs no migration and no new schema. It also avoids inventing an implicit
cross-subsidy relationship between commission and delivery economics that no
existing decision states.

### Alternatives

- **Merchant commission implicitly funds the gap** — rejected. DEC-043 defines
  only the commission *rate*; it does not earmark commission revenue for
  rider delivery funding, and asserting that here would be inventing a new
  business rule alongside a documentation lock, not recording one. It also
  would not produce an individually balanced rider-earning ledger group
  without a broader customer-payment ledger model that does not exist today.
- **A full customer-payment ledger flow** (`CUSTOMER_PAYMENT` posted at
  payment time, distributing to every account including a delivery-side line)
  — the most complete architecture, matching `SETTLEMENT_MODEL.md` § 4.1's own
  worked example shape, but materially larger than the current implementation
  and not required to answer the narrow question this decision settles: *who*
  funds the ฿2, not how the whole order's money is eventually modeled.
  Building it remains a separate, larger, not-yet-authorized engineering
  question.
- **Leave the gap unresolved** — rejected. `RIDER_PAYABLE −1200` would remain
  permanently unbalanced, and CON-003's "every order's ledger balances to
  exactly zero" would stay unsatisfied for every delivered order indefinitely.

### Consequences

- **This decision does not itself write a `PLATFORM_WRITE_OFF` ledger entry,
  modify `DeliveryCompletionService`, or change any schema.** Posting the
  offsetting entry is a separate, not-yet-authorized engineering task.
- **DEC-035 (฿10 delivery fee), DEC-036 (฿5 service fee), DEC-043 (8%
  commission) and DEC-044 (฿12 rider earning) are unaffected** — this
  decision touches only the funding relationship between two already-locked
  numbers, not either number itself.
- **Merchant commission is not reinterpreted as rider funding.** Nothing here
  earmarks `PLATFORM_REVENUE` (commission) for delivery economics; the two
  remain separate ledger lines for separate economic events.
- **Service fee is not reinterpreted as rider funding.** DEC-036's fee stays
  exactly what it was: BANHAO revenue, unrelated to delivery.
- **The existing broader ledger model is unchanged.** This decision does not
  redesign the customer-payment flow, does not require posting
  `CUSTOMER_PAYMENT`, and does not touch the merchant-commission ledger
  implementation (DEC-043) or its own self-balanced group.
- **BQ-024 (cancellation and waiting compensation) is untouched and remains
  `OPEN`.** This decision concerns only the ordinary per-delivery earning
  gap, never compensation.
- **BQ-032 (settlement cycle) and BQ-034 (rider payout netting) are untouched
  and remain `OPEN`.** This decision does not authorize or describe a
  settlement/payout implementation.
- **The intended accounting shape** is a `PLATFORM_WRITE_OFF` entry of 200
  satang, representing BANHAO's absorbed cost for the delivery. **This
  decision does not specify the exact sign convention, party fields, or code
  shape of that future ledger entry** — only its account and amount. Making
  the rider-earning group sum to zero correctly is an engineering
  responsibility for the implementation task, not something this decision
  fixes in advance.

### Evidence

Product Owner instruction, 2026-09-05 ("BANHAO — DECISION LOCK: DEC-045
Delivery Funding Gap").

### Related Requirements

CON-003 (ledger balances to zero, integer satang)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3, § 4.1, § 8 · `docs/OPEN_BUSINESS_QUESTIONS.md`
BQ-040 · `apps/api/src/modules/rider/delivery-completion.service.ts`
(`insertRiderEarningEntry`, not modified by this decision)

### Supersedes / Superseded By

None / None. Resolves **BQ-040** and closes the funding-relationship question
DEC-044's Consequences clause left open; does not supersede DEC-023, DEC-035,
DEC-036, DEC-043, or DEC-044, each of which stands unchanged.

---

## DEC-046 — Promotion/discount funder model: platform or merchant, per promotion, no split

**Status:** ACCEPTED · **Date:** 2026-09-05 · **Owner:** PRODUCT_OWNER

### Decision

**Option C.** Every promotion or discount must have an explicitly identified
funder. In Phase 1 the allowed funders are **`PLATFORM`** and **`MERCHANT`**
only — no other party may be named as a funder. The funder is a property of
the *promotion*, decided at the promotion's own definition, not inferred from
the order, the customer, or any other context. When a promotion applies to an
order, its funder must remain identifiable on or through that order, so a
future ledger/accounting implementation can correctly assign the funding leg
without guessing or defaulting.

**Accounting intent:** the funding responsibility for each discount is
attributable to a named allowed funder rather than being implicitly assumed
(as the design's own `BANHAO7` worked example did, silently, for `PLATFORM`).
This resolves the funder half of **BQ-030**.

**Split funding is NOT supported in Phase 1.** A single promotion may not
divide its discount between `PLATFORM` and `MERCHANT` by a configured ratio.
Options D (shared/split) and the split half of BQ-030's own Option C framing
("`PLATFORM` or `MERCHANT` or a split," `docs/BUSINESS_RULES.md` § 11) are
rejected for Phase 1 — see Alternatives.

**Stacking is explicitly NOT locked by this decision.** BQ-030's own
recommendation additionally proposed "at most one coupon plus one merchant
promotion per order." This decision does not adopt, reject, or otherwise rule
on that stacking question. Stacking remains a separate, open sub-question —
see Consequences and BQ-030's status below.

### Why

Product Owner decision, 2026-09-05. BQ-030's own recommendation (Option C) is
adopted because, per its own reasoning, both funding types will exist in
reality — a merchant discounting a slow-moving dish is a different economic
event from BANHAO subsidising a first-order coupon — and retrofitting a
funder field onto live promotions and already-settled orders is materially
harder than deciding it now, before any promotion engine exists. Restricting
Phase 1 to exactly two funders (no split) is the smallest version of Option C
that is still economically complete: `PROMOTION_FUNDING → PLATFORM` and
`PROMOTION_FUNDING → MERCHANT` are both single, unambiguous ledger postings,
while a split introduces a ratio that no current business rule defines and
that this decision was not asked to supply.

### Alternatives

- **Option A — Platform-funded only** — rejected as the sole Phase 1 rule.
  Matches the design's own worked example, but forecloses a real merchant-
  funded promotion (a shop discounting its own menu) that BQ-030's own
  reasoning treats as a genuine, distinct case, not a hypothetical.
- **Option B — Merchant-funded only** — rejected as the sole Phase 1 rule,
  for the same reason in reverse: it would misrepresent every
  platform-subsidised acquisition coupon as a merchant cost.
- **Option D — Shared, by a configured split** — rejected for Phase 1. No
  existing decision or business rule defines a split ratio, a ratio-storage
  location, or how a split would be validated, and inventing one here would
  be supplying a business rule this decision was not given, not recording
  one. Nothing in this decision forecloses a future decision adding split
  funding; it is simply out of scope for Phase 1.
- **Leaving BQ-030 fully open** — rejected. CON-003 (every order's ledger
  balances to exactly zero) cannot be satisfied for a discounted order
  without a named funder, and BQ-030 itself states this plainly. Deciding the
  funder model now, without also deciding stacking, is possible because the
  two questions are independent: knowing *who* pays a given promotion's
  discount does not require knowing *how many* promotions may combine on one
  order.

### Consequences

- **This decision does not itself create a `promotions`, `coupons`, or
  `coupon_redemptions` table, add a `funder` column anywhere, write any
  `PROMOTION_FUNDING` ledger entry, or modify any application code.** All of
  that remains a separate, not-yet-authorized engineering task. `orders.discount_satang`
  is unchanged and still always `0` in practice — no caller populates it today.
  See `docs/DATABASE_DESIGN.md` § (deferred tables) and
  `apps/api/src/modules/orders/orders.service.ts`.
- **This decision does not prescribe a database column, table, or schema
  shape.** It is a business decision about which parties may fund a
  promotion and at what granularity (per-promotion, not per-order or
  global) — the concrete representation is an implementation task for
  whenever a promotion engine is authorized.
- **Stacking remains open.** BQ-030's recommended stacking rule ("at most one
  coupon plus one merchant promotion per order") is **not** adopted by this
  decision and must not be treated as locked. It is a distinct question that
  may be decided independently, before or after a promotion engine exists.
- **Commission base treatment for a merchant-funded discount is an
  explicitly unresolved follow-up, not decided here.** DEC-043 fixes the
  commission base at the food subtotal captured *before* any discount is
  applied (`orders.subtotal_satang`, see `commission-pricing.ts`), and this
  decision does not reopen, reinterpret, or narrow that. But it leaves open
  whether a *merchant-funded* discount should, as a matter of business
  policy, reduce the commission base the merchant is charged against, since
  the merchant is in that case receiving less than the full subtotal. This
  decision takes no position on that question. It is not assigned a BQ
  number here — one should be raised separately if and when a promotion
  engine is designed.
- **DEC-035 (฿10 delivery fee), DEC-036 (฿5 service fee), DEC-043 (8%
  commission), DEC-044 (฿12 rider earning), and DEC-045 (฿2 platform
  write-off) are unaffected.** This decision concerns only who funds a
  discount, not any fee or earning amount, and does not touch any of their
  bases, directions, or ledger treatments.
- **Refund, cancellation, eligibility, maximum-discount, and platform-subsidy-
  limit questions remain untouched and open.** None of them is answered,
  narrowed, or implied by this decision.
- **BQ-024, BQ-027 (refundability), BQ-032, and BQ-034 are untouched and
  remain `OPEN`.** This decision does not touch rider compensation,
  service-fee refundability, settlement cycle mechanics, or rider payout
  netting.

### Evidence

Product Owner instruction, 2026-09-05 ("BANHAO — BQ-030 BUSINESS DECISION
LOCK"), approving Option C with the two-funder, no-split Phase 1 scope stated
above.

### Related Requirements

CON-003 (ledger balances to zero, integer satang)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3, § 10 · `docs/BUSINESS_RULES.md` § 11 ·
`docs/DOMAIN_MODEL.md` § 5.8 · `docs/OPEN_BUSINESS_QUESTIONS.md` BQ-030 ·
`ledger_entries.account` enum value `PROMOTION_FUNDING`
(`20260811000007_ledger_domain.sql`, unused, no migration required to record
this decision)

### Supersedes / Superseded By

None / None. Resolves the funder-model half of **BQ-030** only; does not
resolve BQ-030's stacking recommendation, which remains open; does not
supersede DEC-023, DEC-024, DEC-035, DEC-036, DEC-043, DEC-044, or DEC-045,
each of which stands unchanged.

---

## DEC-047 — Phase 1 service fee revenue recognition: at payment success, as `PLATFORM_REVENUE`

**Status:** ACCEPTED — RECOGNITION TIMING · **IMPLEMENTED 2026-09-06** — see
*Implementation status* at the end. · **Date:** 2026-09-06 · **Owner:** PRODUCT_OWNER

### Decision

The Phase 1 service fee is recognized as **`PLATFORM_REVENUE` at the existing
successful-payment economic-finality point** — the same instant the
`MERCHANT_COMMISSION` and `CUSTOMER_PAYMENT` ledger groups already post
(`payments → SUCCESS` together with the guarded `orders PENDING_PAYMENT →
PAID` transition). No later order-lifecycle milestone — acceptance,
preparation, pickup or delivery — is the recognition point.

This answers exactly one question: **when** service fee revenue is
recognized. DEC-024 fixed the direction of the money and DEC-036 fixed the
amount; neither said anything about timing, and that gap is what this
decision closes.

**Amount.** The Phase 1 amount is unchanged: **฿5 / 500 satang per order**
(DEC-036). At implementation time the amount **must** be read from the
immutable order snapshot `orders.service_fee_satang` — the value
`create_order()` captured for that specific order and that
`orders_enforce_immutable_columns` has protected ever since. The
implementation must **not** hardcode `500`, must **not** derive the service
fee from `grand_total_satang` (or from any other total), and must **not**
treat `OrderPricingService`'s current pricing constant as the historical
accounting source — that constant prices *new* orders and says nothing about
what an already-placed order was charged.

**Recognition identity and idempotency.** A future implementation must anchor
on the payment/provider-transaction identity the payment flow already uses,
`<paymentId>:<providerTransactionId>` — the same DEC-030 money-movement
identity `commission:…` and `payment:…` already anchor on — and must be
idempotent and self-healing under the established ledger-group pattern
(attempt the `ledger_entry_groups` insert, treat a `group_key` unique
violation as "already posted or partially posted", complete only what is
missing). A duplicate webhook, a retried partially-completed event, or a
concurrent tick must never produce two service-fee revenue entries.

**Ledger group.** The posting belongs in its **own** group,
`kind = 'SERVICE_FEE_REVENUE'`, with a deterministic group key derived from
that same payment/provider-transaction identity. It must **not** be merged
into the existing `CUSTOMER_PAYMENT` group: `group_key` uniqueness authorizes
*creating* a group, not extending one (`docs/SETTLEMENT_MODEL.md` § 3.1), and
the two are distinct facts — `CUSTOMER_PAYMENT` is the platform's total
inbound funding for the order, service-fee revenue is one claim against that
funding.

**Sign and account.** The entry uses the already-locked positive sign
convention for money the platform earns (`PLATFORM_REVENUE +amount`,
§ 3.1 — the same convention the implemented commission group uses).
**No new ledger account is introduced.** `PLATFORM_REVENUE` already exists in
`ledger_entries.account`'s CHECK constraint, and
`ledger_entry_groups.kind` — deliberately unconstrained free text
(`20260811000007_ledger_domain.sql`) — is what distinguishes service-fee
revenue from commission revenue. **No migration and no schema change are
required or authorized by this decision.**

**Commission interaction — unchanged.** The service fee is **not** part of
the merchant commission base. DEC-043 (8% of the food subtotal, rounded to
whole baht) is untouched, and so are `MERCHANT_PAYABLE`, `RIDER_PAYABLE`,
rider earning (DEC-044) and the platform delivery write-off (DEC-045). This
decision changes no amount, no rate and no other party's economics.

**Scope of this decision.** BANHAO system and finance architecture policy
only. It is not a claim of conformance with any external accounting standard;
no such standard is cited as its justification, and the repository holds no
authoritative accounting or legal decision that could supply one. Q-002
(legal settlement model) and the `LEGAL_REVIEW_REQUIRED` items in
`docs/SETTLEMENT_MODEL.md` § 13 are untouched.

### Why

Product Owner decision, 2026-09-06, following the recon recorded in this
entry's Evidence section.

Recognizing at payment success is the position already taken for the merchant
commission, which posts at that same instant even though the merchant has not
yet cooked anything. Recognizing the service fee later than the commission
would introduce a new asymmetry that no business rule asks for. The
recognition anchor, its idempotency identity, and the group pattern all
already exist and are proven in production code, so the decision adds no new
mechanism. And no approved milestone exists for the alternative: neither
DEC-024 nor DEC-036 names one, so choosing "acceptance" or "delivery" would
have meant inventing a policy value rather than locking one.

### Alternatives

- **Recognition at an order-lifecycle milestone** (`MERCHANT_ACCEPTED` or
  `DELIVERED`) — **rejected for Phase 1.** No business rule names a milestone
  for the service fee; selecting one would be an invented policy value. It
  would also split service-fee recognition away from commission recognition
  for no stated reason, and require a second anchor at an event the payment
  flow has no other reason to know about.
- **Deferred revenue, later reclassified into `PLATFORM_REVENUE`** —
  **rejected.** `ledger_entries.account`'s CHECK holds no deferred/unearned
  revenue account, and the ledger is append-only (`reject_mutation` blocks
  UPDATE and DELETE for every role, `service_role` included), so a
  reclassification would need both a new account and a migration. No business
  or accounting requirement in this repository asks for deferral.
- **Posting the service fee inside the existing `CUSTOMER_PAYMENT` group** —
  **rejected.** It would conflate funding with revenue, and the ledger's
  idempotency mechanism does not support extending an existing group.

### Consequences

- A future implementation task may post one `PLATFORM_REVENUE` entry per
  successfully paid order in its own `SERVICE_FEE_REVENUE` group. **That
  implementation is not authorized by this entry** — it is a separate task
  behind its own gate. Nothing is implemented by this decision.
- `PLATFORM_REVENUE` will then have **two** sources — commission and service
  fee — distinguishable only by `ledger_entry_groups.kind`. Any query that
  aggregates `PLATFORM_REVENUE` without filtering on `kind` will conflate
  them. There is no per-component column and this decision does not add one.
- **Order-level zero-sum is not achieved by this decision.** Gross merchant
  food payable is still never posted (`docs/SETTLEMENT_MODEL.md` § 4's own
  note) and the delivery fee's revenue side is still unrecognized, so an
  order's groups will not net to zero after this posting exists — they will
  net further from zero by the service-fee amount. CON-003's order-level
  invariant remains a future capability, exactly as it was before this
  decision. Both gaps are explicitly **out of scope here**.
- **Refundability is NOT decided.** BQ-027's remaining half — whether the
  service fee survives a refund — stays `OPEN` and is Phase F scope, and must
  not be inferred from this decision in either direction. Recognition and
  reversal are separate rules. If a reversal is ever required, it must be a
  **new** ledger group; historical `CUSTOMER_PAYMENT` and historical revenue
  entries are never mutated (already enforced by `ledger_entries`'
  `reject_mutation` trigger).
- **Reconciliation is not implemented by this decision.** When a service-fee
  reconciliation is eventually built it must be able to distinguish missing,
  duplicate, amount mismatch, identity mismatch, orphan, legacy-not-applicable
  and in-flight/grace-period outcomes — described here as requirements, not as
  locked category names. `PaymentReconciliationService` (read-only, payment ↔
  `CUSTOMER_PAYMENT`) is unchanged and covers a different check.
- Nothing else moves: no pricing change, no delivery-fee revenue decision, no
  promotion decision, no settlement architecture, no new dependency, no API
  surface.

### Evidence

Product Owner instruction, 2026-09-06 ("DEC-047 DECISION LOCK — Approved
Business Decision"), given after a recon of the live ledger code
(`postCommissionLedger` / `postCustomerPaymentLedger` in
`apps/api/src/modules/payments/payment-event-processing.service.ts`,
`delivery-completion.service.ts`'s `RIDER_EARNING` group), the ledger schema
(`supabase/migrations/20260811000007_ledger_domain.sql`) and
`docs/SETTLEMENT_MODEL.md` § 3.1, which together established that no
service-fee revenue entry exists anywhere today.

### Related Requirements

BQ-027 (the **amount** half is DEC-036 and the **timing** half is this
decision; **refundability remains OPEN**) · CON-003 (integer satang,
order-level zero-sum) · DEC-028 (idempotency) · DEC-030 (money-movement
identity) · DEC-034 (zero-sum asserted in the application, per group)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3, § 3.1, § 3.2 · `docs/BUSINESS_RULES.md` § 5.3 ·
`apps/api/src/modules/payments/payment-event-processing.service.ts` (the
existing recognition anchor; **unchanged by this decision**) ·
`supabase/migrations/20260811000007_ledger_domain.sql`

### Supersedes / Superseded By

None / None. Resolves the **recognition-timing** question that DEC-024 and
DEC-036 left unstated. Does not supersede or modify DEC-023, DEC-024,
DEC-035, DEC-036, DEC-043, DEC-044, DEC-045 or DEC-046, each of which stands
unchanged.

### Implementation status (added 2026-09-06, after the entry above)

Implemented the same day, in `PaymentEventProcessingService`
(`apps/api/src/modules/payments/payment-event-processing.service.ts`):
`postServiceFeeLedger` posts `PLATFORM_REVENUE +orders.service_fee_satang` in
its own `SERVICE_FEE_REVENUE` group, keyed
`servicefee:<paymentId>:<providerTransactionId>`, from both the
fresh-transition and already-PAID self-heal branches of
`completeSuccessSideEffects`, alongside `postCommissionLedger` and
`postCustomerPaymentLedger`. The amount is read fresh from the order row on
every call — never hardcoded, never derived from `grand_total_satang` or the
subtotal, never taken from `OrderPricingService`'s pricing constant. No
migration, no new `ledger_entries.account` value, no schema change. 7 new
tests (happy path, snapshot-authority, `SURPLUS_PAYMENT`/`LATE_PAYMENT`
exclusion, self-heal crash-window recreation, idempotent duplicate delivery,
commission-base isolation); full API suite 1540/1540.

This closes the *implementation* gap this decision authorized. It does not
close BQ-027 (refundability), delivery-fee revenue recognition, gross
merchant payable, order-level zero-sum (CON-003), or any of the settlement
work `docs/SETTLEMENT_MODEL.md` § 13 still lists as open — none of those was
in this decision's scope and none is resolved by this implementation.

---

## DEC-048 — Service fee refundability: included in an eligible full order refund

**Status:** ACCEPTED — REFUNDABILITY · **NOT IMPLEMENTED** · **Date:** 2026-09-06 · **Owner:** PRODUCT_OWNER

### Decision

**Option A.** When an order/payment is determined eligible for a **full order
refund**, the Phase 1 service fee (฿5 / 500 satang, DEC-036) **is included in
the refundable amount**. This resolves the refundability half of **BQ-027**,
which DEC-036 (amount) and DEC-047 (recognition timing) both left open.

This decision answers exactly one question: *is the service fee refundable
when a full refund is due?* It answers nothing about *when* a full refund is
due, *how* a refund is executed, or *how* the reversal is posted — see Scope
boundary below.

1. **Amount.** Unchanged: ฿5 / 500 satang per order (DEC-036).
2. **Trigger.** Only once an order/payment is **already determined eligible
   for a full order refund** by whatever rule eventually settles that
   question (BQ-016, BQ-015, BQ-017, and the existing `ACCEPTED` rows in
   `docs/PAYMENT_LIFECYCLE.md` §8 / `docs/SETTLEMENT_MODEL.md` §9 for
   pre-`MERCHANT_ACCEPTED` cancellation and merchant rejection/timeout). This
   decision does **not** itself decide which causes qualify.
3. **Ledger consequence, stated at the policy level only.** The
   `SERVICE_FEE_REVENUE` entry recognized under DEC-047 must **eventually**
   be reversed through a **new** reversal ledger group when the service fee
   is included in a qualifying full refund. Historical `SERVICE_FEE_REVENUE`
   entries are never mutated — the existing `ledger_entries` append-only
   guarantee (`reject_mutation` trigger) already enforces this structurally,
   and this decision adds no exception to it.
4. **Amount source for any future reversal.** The immutable order snapshot
   `orders.service_fee_satang` — never a hardcoded `500`, never derived from
   `grand_total_satang` or the subtotal. Same rule DEC-047 already states for
   the original recognition, extended to its reversal.
5. **Conceptually separate from every other reversal.** The service-fee
   reversal is its own fact, independent of:
   - `CUSTOMER_PAYMENT` reversal,
   - `MERCHANT_COMMISSION` reversal,
   - delivery-fee treatment (customer side or rider side),
   - rider earning / compensation.

   This decision does **not** determine the treatment of any of those other
   components. Each remains governed by its own existing rule or open
   question, untouched by this entry.

### Scope boundary — what this decision explicitly does NOT decide

This is a business-decision lock only. **No implementation is authorized by
this entry.** It does not decide, and must not be read as deciding:

- what cancellation causes qualify for a full refund (**BQ-016** remains
  `OPEN`),
- who bears the cost of cooked-but-undelivered food (**BQ-015** remains
  `OPEN`),
- delivery-failure refund behavior (**BQ-017** remains `OPEN`),
- partial-refund composition, including whether the service fee is refunded
  on a *partial* refund at all (**BQ-031** remains `OPEN`),
- the refund execution mechanism — PromptPay, wallet/store credit, manual
  bank transfer, or any other (**Q-020** remains `OPEN` and unresolved; no
  examined payment provider supports a native PromptPay refund),
- merchant commission reversal, delivery-fee reversal, or rider
  earning/compensation reversal — each is its own decision,
- settlement, or refund reconciliation.
- **The exact refund ledger posting shape** — whether the reversal is
  single-entry or two-entry, whether it is zero-sum, whether it is paired
  with a `REFUND_PAYABLE` entry or with a `CUSTOMER_PAYMENT` reversal — is a
  future implementation/architecture decision, not this one. This entry
  establishes only that the recognized revenue must eventually be reversed,
  never how.

None of BQ-016, BQ-015, BQ-017, BQ-031, or Q-020 is closed, narrowed, or
otherwise acted on by this decision.

### Relationship to DEC-047

DEC-047 is **unchanged**. It still governs *recognition*: the service fee is
recognized as `PLATFORM_REVENUE` at the successful-payment
economic-finality point, in its own `SERVICE_FEE_REVENUE` group, amount from
`orders.service_fee_satang`, no new account, no migration. DEC-048 governs
*reversal eligibility* only — a separate rule, exactly as DEC-047 itself
said recognition and reversal must be kept separate. DEC-048 does not alter
DEC-047's recognition trigger, identity, group shape, or implementation.

### Relationship to BQ-027

Resolves BQ-027 in full: DEC-024 (model, 2026-08-10) + DEC-036 (amount,
2026-08-24) + DEC-047 (recognition timing, 2026-09-06) + **DEC-048**
(refundability, 2026-09-06) together answer every part of BQ-027's original
question ("What is the ฿5 `ค่าบริการ` for, is it platform revenue, and is it
refunded on cancellation?"). BQ-027 carries no further open half.

### Why

Product Owner decision, 2026-09-06, following the read-only recon this
session performed (`docs/OPEN_BUSINESS_QUESTIONS.md` BQ-027's own on-file
recommendation, "A for Phase 1" — ฿5 is not worth a customer dispute, and
withholding it on an order BANHAO failed to deliver is a reputational risk
disproportionate to the amount, in a district where word of mouth is the
primary marketing channel).

### Alternatives

- **Option B — non-refundable** (`CUSTOMER_PAYMENT` reversed, `SERVICE_FEE_REVENUE`
  stands) — rejected. Creates a customer-facing inconsistency the recon
  flagged: the Customer App's existing refund copy does not distinguish
  components, so a customer told "refunded" would not expect ฿5 silently
  withheld.
- **Option C — conditional refundability** (tied to BQ-016's timing boundary
  or BQ-031's cause-based split) — rejected for this decision, not because it
  is wrong, but because it would require BQ-016 and/or BQ-031 to be decided
  first, and this entry answers only the question BQ-027 itself asks. A
  future decision may still layer a condition onto *when* a full refund is
  due; DEC-048 governs only what happens to the service fee once a full
  refund is due.

### Consequences

- BQ-027 is fully resolved; no numeric, model, timing, or refundability half
  remains open.
- **No code, test, migration, schema, or ledger posting is authorized or
  implied by this decision.** A future implementation task must design the
  reversal's exact posting shape (group key, entries, sign, idempotency) as
  its own gate, following the pattern DEC-047's own implementation already
  established for recognition.
- `docs/SETTLEMENT_MODEL.md` §9's per-cause table, which already marked "fee
  reversed" `ACCEPTED` for pre-`MERCHANT_ACCEPTED` cancellation and merchant
  rejection/timeout ahead of any DEC number existing for it, now has that
  entry.
- BQ-016, BQ-015, BQ-017, BQ-031 and Q-020 are unaffected and remain exactly
  as open as before this decision.

### Evidence

Product Owner instruction, 2026-09-06 ("BANHAO — DEC-048 SERVICE FEE
REFUNDABILITY DECISION LOCK"), following this session's BQ-027 refundability
reconnaissance (existing `refunds` table with a flat, non-decomposed
`amount_satang`; `NullPaymentProvider.refund()` unconditionally fails;
`REFUND_PAYABLE` already reserved in `ledger_entries.account`'s CHECK; no
application code writes to `refunds` or reverses any ledger group today).

### Related Requirements

BQ-027 (resolved in full by this decision, together with DEC-024/036/047) ·
BQ-016, BQ-015, BQ-017, BQ-031, Q-020 (unaffected, remain `OPEN`) · CON-003
(order-level zero-sum, unaffected — no reversal is posted by this decision) ·
DEC-034 (zero-sum asserted in the application, per group — unaffected)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3.2, § 9 · `docs/PAYMENT_LIFECYCLE.md` § 8 ·
`docs/OPEN_BUSINESS_QUESTIONS.md` BQ-027, BQ-031

### Supersedes / Superseded By

None / None. Resolves the **refundability** half of BQ-027 that DEC-036 and
DEC-047 both explicitly left open. Does not supersede or modify DEC-024,
DEC-036, DEC-043, DEC-044, DEC-045, DEC-046 or DEC-047, each of which stands
unchanged. The **refund ledger posting shape** this decision explicitly left
undecided is separately fixed by **DEC-049** (2026-09-07); this decision's own
refundability rule is unchanged by it.

---

## DEC-049 — Refund ledger architecture: independent reversal groups over a mutable refund domain record

**Status:** ACCEPTED — ARCHITECTURE · **NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

DEC-048 made the service fee refundable within an eligible full order refund
and deliberately left the **posting shape** undecided. This decision fixes
that shape — and only that shape. It is an architecture lock: it decides how
a refund reversal is *represented* in the ledger, never when a refund is
owed, what causes qualify, or how money physically returns to a customer.

**1. Two layers, permanently distinct.**
`refunds` is the **mutable refund process/domain record** — intent, approval,
and provider/execution progress. `ledger_entry_groups` and `ledger_entries`
are **append-only, immutable accounting facts**. A refund's process may
advance, fail, and be retried without ever rewriting a financial fact.
**A refund is never represented by mutating a historical ledger entry.**

**2. Independent reversal groups, one per reversed component.**
A refund reversal posts **separate ledger groups** — one per component the
refund actually reverses. **No single bridge group** may combine
`CUSTOMER_PAYMENT`, `SERVICE_FEE_REVENUE` and `REFUND_PAYABLE` into one
group. For a component a future approved business rule actually requires to
be reversed:

| Component | Account | Signed amount | Amount source |
|---|---|---|---|
| `CUSTOMER_PAYMENT` reversal | `CUSTOMER_PAYMENT` | **negative** | the authoritative recorded payment amount associated with the payment/refund being reversed |
| `SERVICE_FEE_REVENUE` reversal | `PLATFORM_REVENUE` | **negative** | **`orders.service_fee_satang`** |

Each is its own independent group. This preserves DEC-048's own requirement
that the service-fee reversal stays "conceptually separate from
`CUSTOMER_PAYMENT`," and mirrors how the originals were posted: the live
`CUSTOMER_PAYMENT` and `SERVICE_FEE_REVENUE` groups are already independent,
single-entry groups (DEC-047, `SETTLEMENT_MODEL.md` § 3.1/§ 3.2).

**3. No zero-sum requirement.**
Refund reversal groups are **not** required to sum to zero, and **no
balancing entry may be introduced merely to force zero-sum**. This follows
the established precedent: `CUSTOMER_PAYMENT` nets `+grand_total`,
`SERVICE_FEE_REVENUE` nets `+fee`, and `RIDER_EARNING` nets `−1000` — a
residual DEC-045 explicitly accepted. DEC-034 rejected a database zero-sum
trigger and names order-level answerability, verified by reconciliation, as
the goal. A reversal mirrors the fact it reverses; it does not manufacture a
counterpart.

**4. `REFUND_PAYABLE` is not used by this architecture.**
It remains a **reserved account with unresolved semantics**. This decision
does not repurpose it, does not give it a new meaning, and does not decide
what it will eventually mean in any other flow — including the
surplus/duplicate-payment obligation sketched in
`docs/TECHNICAL_ARCHITECTURE.md` § on surplus payment. Older `PROPOSED`-grade
design prose that anticipated a `REFUND_PAYABLE` entry as the refund-side
reversing entry is superseded **for the refund-reversal architecture only**;
nothing else about that account is decided here.

**5. Posting trigger: verified refund finality, represented by `REFUNDED`.**
A reversal group is posted **only** once the refund has reached `REFUNDED` —
the state that represents verified refund finality. It is **never** posted at
`REFUND_REQUESTED`, `REFUND_PENDING`, or `REFUND_PROCESSING`, which are
intent, approval, and in-flight execution respectively. This mirrors the
payment path, where all three ledger groups post only after economic finality
(`payments → SUCCESS` together with the guarded `orders → PAID`), never at
intent.

**The mechanism that establishes that finality is deliberately not fixed
here.** Whether `REFUNDED` is reached by a signature-verified provider
webhook (CON-002's existing rule for provider-mediated payments), by an
operator-confirmed manual mechanism, or by something else, is **OPEN under
Q-020** and belongs to whichever decision resolves it. This decision binds
the *trigger point*, not the *mechanism*.

**6. Identity is local.**
A reversal group is anchored to the **local refund identity** — `refunds.id`
and/or the local `refund_reference`. **Provider refund IDs and provider
transaction IDs must not be the architectural identity of a ledger group**:
`refunds.provider_refund_id` is nullable, is populated only if and when a
provider accepts, and may never exist at all under a manual mechanism. Where
the existing schema supports it, a reversal group populates
`ledger_entry_groups.refund_id` and `ledger_entry_groups.order_id` as its
structural links.

**7. Idempotency reuses the established pattern, unchanged.**
Insert the group first; on a `ledger_entry_groups.group_key` unique
violation, re-read the group and self-heal any missing entries. **No new
idempotency architecture is introduced.** `group_key` uniqueness remains the
sole concurrency authority, exactly as it is for the four live groups.

**8. Amount sources are authoritative recorded facts.**
The service-fee reversal reads **`orders.service_fee_satang`** — never a
hardcoded `500`, never derived from the grand total or the subtotal, and
never read from a mutable pricing constant. A `CUSTOMER_PAYMENT` reversal
reads the authoritative recorded payment amount associated with the
payment/refund being reversed.

**9. No schema change and no migration.**
The existing schema is sufficient: `refunds`, `payment_transactions`
(including its `direction` column, whose `OUT` value this decision does not
define — see below), `ledger_entry_groups.refund_id`, the existing
`ledger_entries.account` values, the existing `group_key` unique constraint,
and the existing append-only protections.

### Explicit non-decisions

This decision establishes the financial architecture needed to *represent* a
reversal. It does **not** decide, and must not be read as deciding:

- **Refund and cancellation eligibility** — which situations are refundable,
  cancellation windows, or cancellation fees (**BQ-016** remains `OPEN`).
- **Whether every cancellation receives a full refund**, and **whether
  `CUSTOMER_PAYMENT` is reversed at all in any given case.** DEC-049 says
  only that *if* a future approved refund policy requires that reversal, it
  is represented as its own independent append-only group.
- Who bears the cost of cooked-but-undelivered food (**BQ-015**, `OPEN`).
- Delivery-failure responsibility (**BQ-017**, `OPEN`).
- **Partial refund policy or composition** (**BQ-031**, `OPEN`).
- The **refund execution mechanism** (**Q-020**, `OPEN`) or any
  provider-specific refund implementation.
- Refund **webhook routing**, refund **reconciliation**, or refund
  **simulator/dev tooling**.
- Settlement or payout behaviour.
- **Merchant commission reversal**, **delivery-fee reversal**,
  **rider-earning or compensation reversal**, or **promotion reversal** —
  each remains its own undecided component.
- **`payment_transactions.direction = 'OUT'`** semantics — undefined here and
  left to whichever decision resolves Q-020.
- The **eventual semantics of `REFUND_PAYABLE`**, in this or any other flow.
- Any zero-sum policy for a future refund/payable model beyond the reversal
  groups this decision covers.

### Why

Product Owner decision, 2026-09-07, following this session's read-only refund
ledger architecture recon. Independent reversal groups were chosen because
they are the only shape consistent with DEC-048's own separation requirement,
because they mirror the live posting shape of the two facts being reversed
rather than introducing a new one, because they reuse an idempotency and
self-heal pattern already proven four times in production code, and because
they extend naturally to a future partial-refund policy (BQ-031) without
touching any historical fact.

### Alternatives

- **A refund-payable bridge group** (`REFUND_PAYABLE` + `CUSTOMER_PAYMENT`
  reversal + `SERVICE_FEE_REVENUE` reversal in one zero-summing group) —
  **rejected.** It contradicts DEC-048's requirement that the service-fee
  reversal be conceptually separate from `CUSTOMER_PAYMENT`, requires
  inventing a semantic for `REFUND_PAYABLE` that no decision has ever fixed,
  and presumes one refund reverses every component at once, which a future
  partial-refund policy would immediately break.
- **Posting at refund request or approval** — rejected. It would record a
  financial fact for money that demonstrably has not moved, in an append-only
  ledger that cannot withdraw it, only compensate.
- **Anchoring group identity on provider refund/transaction IDs** — rejected.
  Those identifiers are nullable, arrive late, and may never exist under a
  manual mechanism; the local refund record already supplies a per-event
  identity.

### Consequences

- DEC-048's service-fee reversal becomes buildable as a self-contained unit,
  independent of any future `CUSTOMER_PAYMENT`-reversal business decision.
- **The architecture is inert until a refund can actually reach `REFUNDED`.**
  With Q-020 unresolved there is no mechanism that establishes refund
  finality, so no reversal will post. This is accepted deliberately: the
  alternative is recording unverified facts in an append-only ledger.
- `PLATFORM_REVENUE` will eventually be written by a third group kind (the
  service-fee reversal) alongside `MERCHANT_COMMISSION` and
  `SERVICE_FEE_REVENUE`. Any query aggregating `PLATFORM_REVENUE` without
  filtering `ledger_entry_groups.kind` will conflate them.
- Older `PROPOSED` design prose in `docs/SETTLEMENT_MODEL.md` § 3.1 and
  § 11.1 anticipated a `REFUND_PAYABLE` entry as the refund-side reversing
  entry. Those passages are reconciled to point here; their append-only
  point — a refund never mutates the entry it offsets — is unchanged and
  remains correct.
- `PaymentReconciliationService` needs no change: it scans
  `payments.state = 'SUCCESS'` and `payment_transactions.direction = 'IN'`
  only, so no reversal group can enter or disturb its current output. Refund
  reconciliation remains unbuilt and undesigned.
- Order-level zero-sum (CON-003) is neither achieved nor worsened by this
  decision; it remains blocked on gross merchant payable and delivery-fee
  revenue recognition, both unposted and both outside this scope.

### Implementation status

**Not implemented.** No refund code, no reversal posting method, no refund
endpoint, no webhook branch, no reconciliation change, no migration, and no
schema change exist as of this decision. Nothing in `apps/` writes `refunds`,
`ledger_entry_groups.refund_id`, or `payment_transactions.direction = 'OUT'`.
A future implementation task is gated on this decision **plus** the business
rules that determine a refund is owed (BQ-015/BQ-016/BQ-017) **plus** the
mechanism that establishes refund finality (Q-020).

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — LOCK DEC-049 REFUND LEDGER
ARCHITECTURE"), following the read-only refund ledger architecture decision
recon performed in the same session: `refunds`' immutability trigger protects
only `payment_id`/`refund_reference`/`amount_satang` (the rest is designed to
change); `ledger_entries`/`ledger_entry_groups` carry `reject_mutation` for
every role; `ledger_entry_groups.refund_id` exists as a live FK with zero code
references; `REFUND_PAYABLE` has zero postings and no defining decision;
`payment_transactions.direction = 'OUT'` has zero writes and no documented
semantics; and the four live ledger groups establish both the single-entry
non-zero-sum precedent and the insert-first/self-heal idempotency pattern.

### Related Requirements

DEC-048 (the service-fee reversal this architecture represents; unchanged) ·
DEC-047 (recognition, unchanged) · DEC-027 (refund is a payment-domain event) ·
DEC-028 (idempotency) · DEC-030 (money-movement identity; the surplus
obligation is untouched) · DEC-034 (financial integrity without a zero-sum
trigger) · DEC-045 (accepted non-zero residual precedent) · CON-002 · CON-003 ·
Q-020, BQ-015, BQ-016, BQ-017, BQ-031 — **all remain `OPEN` and untouched**

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3.1, § 3.2, § 9, § 11.1 ·
`docs/PAYMENT_LIFECYCLE.md` § 8 ·
`supabase/migrations/20260811000006_payment_domain.sql` (`refunds`,
`payment_transactions`) ·
`supabase/migrations/20260811000007_ledger_domain.sql` (`ledger_entry_groups`,
`ledger_entries`) · ADR-001, ADR-003

### Supersedes / Superseded By

None / None. Fixes the refund ledger **posting shape** that DEC-048
explicitly deferred. Does not supersede or modify DEC-024, DEC-027, DEC-030,
DEC-034, DEC-036, DEC-045, DEC-047 or DEC-048, each of which stands
unchanged. Supersedes, for the refund-reversal architecture only, the
`PROPOSED`-grade design prose in `docs/SETTLEMENT_MODEL.md` § 3.1/§ 11.1 that
anticipated a `REFUND_PAYABLE` reversing entry — without deciding that
account's eventual semantics. **BQ-016, which this entry's non-decision list
recorded as `OPEN`, was resolved later the same day by DEC-050** (cancellation
window and refund eligibility); DEC-049's own architecture is unchanged by it,
and BQ-015, BQ-017, BQ-031 and Q-020 all remain open as recorded here.

---

## DEC-050 — Phase 1 cancellation window and refund eligibility: free through `MERCHANT_ACCEPTED`, no cancellation fee

**Status:** ACCEPTED — POLICY · **RUNTIME NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

Resolves **BQ-016** (cancellation windows, fees, and post-pickup policy). It
decides *when a customer may cancel and what refund follows*. It does not
decide how a refund is represented in the ledger (DEC-049), how money
physically returns (Q-020), or any of the cost-allocation questions listed
under *Explicit non-decisions*.

**1. Free customer cancellation window — through `MERCHANT_ACCEPTED`.**
A customer may cancel freely while the order is in `CREATED`,
`PENDING_PAYMENT`, `PAID`, or **`MERCHANT_ACCEPTED`**. Once the order enters
`PREPARING`, unconditional free cancellation ends.

**2. No cancellation fee in Phase 1.**
There is **no** cancellation fee of any kind: no fixed amount, no percentage,
no penalty, no repeat-cancellation charge. No such amount exists anywhere in
the repository and none may be invented. This adopts BQ-016's Option A on the
fee question.

**3. Cancellation during `PREPARING` requires merchant confirmation, and a
confirmed cancellation is a FULL refund.**
Customer cancellation during `PREPARING` is conditional: the merchant must
confirm it. Where the merchant confirms, the approved refund outcome is a
**full refund** — preserving the already-`ACCEPTED` product truth in
`docs/BUSINESS_RULES.md` § 2.4 and `docs/PAYMENT_LIFECYCLE.md` § 8. It is
**not** a partial refund.

**4. Repeat cancellation is an error.**
A second cancellation attempt on an already-cancelled order is an
error / invalid transition — the behaviour the running system already has. No
idempotency key, cancellation counter, abuse detection, or repeat-canceller
penalty is introduced.

**5. Service fee follows DEC-048, unchanged.**
Where a full order refund is eligible under this decision, the ฿5 / 500 satang
service fee is included, sourced from `orders.service_fee_satang`. DEC-048 is
authoritative and unaltered.

**6. Ledger representation follows DEC-049, unchanged.**
This decision supplies the *eligibility* half DEC-049 deliberately left open;
DEC-049 remains authoritative for *representation*. This decision introduces
no `REFUND_PAYABLE` usage, no zero-sum requirement, no
`payment_transactions.direction = 'OUT'` semantics, no refund mechanism, and
no ledger posting.

### Boundaries with adjacent open questions

- **`READY_FOR_PICKUP` and cooked food.** This decision does **not** allocate
  the merchant's preparation/wasted-food cost. That remains **BQ-015**,
  `OPEN`. No compensation or deduction amount is created here.
- **After `PICKED_UP`.** Customer-initiated refusal and cancellation
  scenarios past pickup belong to **BQ-017** (delivery failure), `OPEN`. This
  decision creates no post-pickup refund rule, so BQ-016 and BQ-017 do not
  overlap.
- **After `DELIVERED`.** Not ordinary customer cancellation. No new rule is
  created; post-delivery refund/dispute treatment stays with the existing
  open policy, including **BQ-031** where a partial refund would be involved.
- **Partial refunds.** Composition remains **BQ-031**, `OPEN`. "Partial
  refund" is not an outcome of any cancellation stage under this decision.
- **Refund mechanism.** Remains **Q-020**, `OPEN`. Policy eligibility is
  decidable and recorded here; no money can actually move until Q-020 is
  answered.

### Explicit non-decisions

Untouched and still `OPEN`: **BQ-015** (wasted-food cost), **BQ-017**
(delivery failure and post-pickup refusal), **BQ-031** (partial refund
composition), **Q-020** (refund mechanism), **BQ-013** (merchant accept
timeout behaviour), **BQ-024** (rider cancellation/waiting compensation), and
every component question DEC-049 already listed as undecided —
delivery-fee reversal, merchant commission reversal, rider earning /
compensation treatment, the `CUSTOMER_PAYMENT` reversal business obligation,
`payment_transactions.direction = 'OUT'` semantics, and the eventual
semantics of `REFUND_PAYABLE`. None is closed, narrowed, or acted on here.

### Why

Product Owner decision, 2026-09-07, following the read-only BQ-016
reconnaissance performed in the same session. The recon established that the
documented policy (`docs/ORDER_LIFECYCLE.md` § 5, `docs/BUSINESS_RULES.md`
§ 2.4) already granted free cancellation through `MERCHANT_ACCEPTED` while
the implementation stopped at `PAID`; that no cancellation-fee value exists
anywhere in the repository; and that BQ-016's own Option B ("partial refund
during `PREPARING`") would have overturned an already-`ACCEPTED` full-refund
rule while depending on the still-open BQ-031. This decision ratifies the
documented window, keeps the accepted full-refund rule, and declines the fee.

### Alternatives

- **Ratify the narrower implemented window (stop at `PAID`)** — rejected. It
  would contradict two documents that already grant cancellation through
  `MERCHANT_ACCEPTED`, and it would contradict the `ACCEPTED` no-rider flow
  (`docs/RIDER_LIFECYCLE.md` § 8) that offers the customer a cancel option
  five minutes after the merchant accepts.
- **BQ-016 Option B — partial refund during `PREPARING`** — **rejected, and
  now closed.** It would supersede accepted product truth (full refund on a
  merchant-confirmed cancellation) and is undecidable while BQ-031 is open.
- **BQ-016 Option C — repeat-canceller penalty** — rejected for Phase 1. No
  counter, flag, or rate limit exists in schema or code, and at launch volume
  abuse is visible to a human operator.

### Consequences

- **This creates a known runtime gap, deliberately.** The approved window
  extends through `MERCHANT_ACCEPTED`; the implementation
  (`apps/api/src/modules/orders/orders.service.ts`,
  `CUSTOMER_CANCELLABLE_STATES`) stops at `PAID`. **The current code is
  narrower than approved policy and requires a later implementation change.**
  That change is not authorized by this decision and is not made here.
- The `ACCEPTED` no-rider flow's t=5m "keep waiting or cancel" option is now
  consistent with policy — and remains unreachable in the running system
  until the window above is implemented.
- Merchant confirmation of a `PREPARING` cancellation has **no endpoint and
  no UI**. The mechanism is approved as policy only; building it is separate
  work, and merchant-initiated cancellation timing remains BQ-013.
- No refund of any kind can execute: refund initiation, provider mechanism,
  refund state transitions, ledger reversal, reconciliation and cancellation
  notifications are all unimplemented (see *Implementation status*).
- BQ-016 leaves the P1 open list. BQ-015, BQ-017, BQ-031 and Q-020 stay
  exactly where they were.
- `DEC-APP-006`'s gate on exception-path implementation is **not** lifted: it
  depends on BQ-013, BQ-015 and BQ-017 as well, and three of those four
  remain open.

### Implementation status

**DECISION LOCKED — RUNTIME NOT IMPLEMENTED.** Known gaps, none addressed
here:

- customer cancellation UI (no call site exists in `apps/customer`)
- customer cancellation through `MERCHANT_ACCEPTED` (code stops at `PAID`)
- merchant confirmation flow during `PREPARING` (no endpoint, no UI)
- refund initiation (no endpoint anywhere in the API contract)
- refund provider mechanism (`NullPaymentProvider.refund()` refuses)
- refund state transitions (nothing writes `refunds`)
- refund ledger reversal (nothing writes a reversal group)
- cancellation notifications (neither cancel path writes an outbox event)

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — LOCK BQ-016 CANCELLATION &
REFUND ELIGIBILITY"), following this session's BQ-016 reconnaissance:
`docs/ORDER_LIFECYCLE.md` § 5's cancellation matrix (customer "✅ free" at
`MERCHANT_ACCEPTED`), `docs/BUSINESS_RULES.md` § 2.4 and
`docs/PAYMENT_LIFECYCLE.md` § 8 (full refund before/during `PREPARING` with
merchant confirmation, both `ACCEPTED`), `apps/api/src/modules/orders/orders.service.ts`
(`CUSTOMER_CANCELLABLE_STATES` = `CREATED`/`PENDING_PAYMENT`/`PAID`, and
neither cancel path touching payments, refunds, ledger or outbox), and a
repository-wide search finding no cancellation-fee value of any kind.

### Related Requirements

BQ-016 (**resolved by this decision**) · BQ-015, BQ-017, BQ-031, BQ-013,
BQ-024, Q-003, Q-020 — **all remain `OPEN` and untouched** · DEC-048 (service
fee in an eligible full refund; unchanged) · DEC-049 (ledger representation;
unchanged) · DEC-027 (refund is a payment-domain event) · DEC-021 (a rider
never cancels an order) · DEC-022 (operator cancellation authority) ·
DEC-APP-006 (exception-path gate, not lifted)

### Related Architecture

`docs/BUSINESS_RULES.md` § 2.4 · `docs/ORDER_LIFECYCLE.md` § 3, § 5 ·
`docs/PAYMENT_LIFECYCLE.md` § 8 · `docs/RIDER_LIFECYCLE.md` § 8 ·
`docs/SETTLEMENT_MODEL.md` § 9 ·
`apps/api/src/modules/orders/orders.service.ts` (**unchanged by this
decision**)

### Supersedes / Superseded By

None / None. Resolves **BQ-016** and closes its Option B (partial refund
during `PREPARING`) and Option C (repeat-canceller penalty) as rejected. Does
not supersede or modify DEC-021, DEC-022, DEC-027, DEC-048 or DEC-049, each
of which stands unchanged.

---

## DEC-051 — Cooked-food loss is allocated by cause: platform-caused to BANHAO, merchant-caused to the merchant, from `PREPARING` onward

**Status:** ACCEPTED — POLICY · **RUNTIME NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

Resolves **BQ-015** (who bears the cost of cooked-but-undelivered food). It
allocates the **merchant-side economic loss** on food that has already entered
preparation. It decides no refund amount, no ledger posting, no settlement
figure, and no post-pickup outcome.

**1. Scope — pre-pickup prepared food only.**
This decision owns the merchant-side cooked-food loss arising at:

- `PREPARING`
- `READY_FOR_PICKUP`
- a no-rider operator cancellation where the merchant has already prepared the
  food

It does **not** own — and does not answer — customer-unreachable, customer
refusal, or delivery failure **after `PICKED_UP`**. Those remain **BQ-017**,
`OPEN`. BQ-015's original question text claimed two of those cases; that
overreach is corrected in `docs/OPEN_BUSINESS_QUESTIONS.md` and is not
inherited here.

**2. Allocation model — Option C, cause-based.**
The party bearing the eligible cooked-food loss depends on the cause of the
failure:

| Cause of failure | Bears the eligible cooked-food loss |
|---|---|
| **Platform-caused** — no rider found; operator cancellation arising from the platform's own inability to fulfil delivery | **BANHAO**, named as a platform write-off (§ 5) |
| **Merchant-caused** — the merchant's own late cancellation or inability to supply after accepting | **The merchant** |
| **Customer-caused after `PICKED_UP`** | **Not owned here — BQ-017**, `OPEN` |

**No merchant penalty schedule is created.** "Merchant absorbs" means the
merchant is not made whole for that food; it introduces no percentage, no
fixed penalty, no fine, no automatic charge, and no compensation formula. Any
future calculation mechanism is separate follow-up work, not this decision.

**No customer charge is created.** DEC-050 remains authoritative: **there is
no Phase 1 cancellation fee**, and this decision introduces none.

**3. Economic boundary — food is prepared from `PREPARING`.**
For this policy, food counts as prepared from the moment the order enters
`PREPARING`. `READY_FOR_PICKUP` is a later state **within** the same
prepared-food policy, not a separate threshold. The reason is DEC-050's own
shape: a merchant-confirmed cancellation during `PREPARING` already gives the
customer a **full refund**, so a merchant-side loss is live from that moment
and must be covered. **No order state is renamed and no state semantics
change.**

**4. Valuation basis — `orders.subtotal_satang`.**
The authoritative valuation basis for the food-loss allocation is the order's
immutable food-subtotal snapshot, `orders.subtotal_satang`. It is **not**
reduced by the 8% merchant commission (DEC-043), and it is **not**
`grand_total_satang`; delivery fee, service fee and promotion funding are all
excluded. No separate food-cost percentage and no fixed compensation amount is
invented.

> ⚠️ **This is a valuation basis, not a payable.** `orders.subtotal_satang`
> states what the lost food is worth for allocation purposes. It does **not**
> decide the merchant's settlement amount, the commission calculation, or the
> gross-merchant-payable architecture — all of which remain separate and
> unbuilt. Nothing here may be read as creating a merchant payable equal to
> `orders.subtotal_satang`.

**5. Platform account — `PLATFORM_WRITE_OFF`.**
Where BANHAO bears the loss, the intended economic account is the existing
`PLATFORM_WRITE_OFF`, following the DEC-045 precedent that a platform-absorbed
cost is named explicitly rather than left as a residual. **This is an account
designation only.** No ledger entry, group, posting shape or zero-sum
behaviour is designed or authorized here — **DEC-049 remains authoritative**
for ledger architecture. No new ledger account is created.

**6. Cause attribution is required.**
Cause-based allocation is only determinable if the cause is recorded, so a
failed or cancelled-after-preparation event must carry a cause code. The
existing `orders.cause_code` column is the intended domain field — it exists,
and the schema already treats it as one of the few mutable columns
(`20260811000005_order_domain.sql`). The cause taxonomy in
`docs/ORDER_LIFECYCLE.md` § 6, with its Fault column, is the intended
vocabulary and is **not expanded here**; if it proves insufficient in
implementation, that gap is raised as a new open question rather than filled
silently.

⚠️ **Not implemented.** The cancel API's request schema is `.strict()` and
currently **rejects** a `causeCode` field with `VALIDATION_FAILED`, with tests
pinning that behaviour, and no application code writes `orders.cause_code`.
Closing that gap is later implementation work; **no validation, API, schema or
test change is made by this decision.**

**7. Relationship to DEC-050 — unchanged, and deliberately separate.**
DEC-050 stands exactly as written: customer cancellation during `PREPARING`
requires merchant confirmation, a confirmed cancellation is a **full** refund,
and there is no cancellation fee. This decision determines only the
**merchant-side food-loss** consequence of such an event. **The customer's
refund and the merchant's food loss are two separate economic consequences of
one event.** No partial refund is introduced — partial refund composition
remains **BQ-031**, `OPEN`.

**8. No-rider case.** A no-rider failure falls under this decision **only**
where it produces merchant cooked-food loss **before pickup**; BANHAO bears
that eligible loss. Post-`PICKED_UP` delivery failure, refusal and
unreachable-customer cases stay with **BQ-017** and must not be collapsed into
this rule.

### Known residual — recorded, not decided

**A customer-caused cancellation of already-prepared food *before* pickup has
no bearer assigned by this decision.** The three branches locked in § 2 cover
platform-caused, merchant-caused, and customer-caused *post-pickup* (BQ-017).
A merchant-confirmed customer cancellation during `PREPARING` — permitted by
DEC-050, with a full customer refund and no cancellation fee — is
customer-caused and pre-pickup, so it falls between them.

This is recorded as an **explicit open residual of BQ-015**, not resolved by
inference. It must not be closed by assuming the merchant absorbs it because
they confirmed the cancellation, nor by assuming BANHAO absorbs it because the
customer cannot be charged. Whichever is intended requires the Product
Owner to say so. Nothing in this decision may be read as having decided it.

### Explicit non-decisions

Untouched and still `OPEN`: **BQ-017** (post-pickup refusal, unreachable
customer, delivery failure), **BQ-031** (partial refund composition),
**Q-020** (refund mechanism), **BQ-024** (rider cancellation/waiting
compensation), **BQ-013** (merchant accept-timeout behaviour), **UX-Q-006**
(operator options on a no-rider order).

Also not decided here: the refund provider or webhook mechanism, refund
transaction mechanics, rider compensation of any kind, customer-caused
post-pickup loss, **gross merchant payable**, settlement, reconciliation, and
cancellation-notification implementation. **DEC-048, DEC-049 and DEC-050 are
authoritative and unmodified.**

### Why

Product Owner decision, 2026-09-07, following the read-only BQ-015
reconnaissance in the same session. The recon established that nothing about
cooked-food cost was locked anywhere — no rule, no percentage, no amount, no
code — while an operator can already cancel a `READY_FOR_PICKUP` order in the
running system with no refund, no ledger entry and no cause recorded. It also
found the cause taxonomy and the `orders.cause_code` column already in place,
and `PLATFORM_WRITE_OFF` already proven by DEC-045. Cause-based allocation was
chosen because it is the option the question itself recommended, because the
repository already carries the fault vocabulary it needs, and because a flat
"merchant absorbs" rule risks merchant participation in a 20–30-shop district
while a flat "BANHAO absorbs" rule would have the platform funding
merchant-caused failures.

### Alternatives

- **Option A — BANHAO absorbs everything** — rejected. Simplest to operate,
  but it makes the platform fund merchant-caused failures with no limit.
- **Option B — merchant absorbs everything** — rejected. BQ-015's own text
  warns it "would end merchant participation quickly" at launch scale.
- **Option D — customer pays where at fault** — rejected for the cases this
  decision owns; it is foreclosed by DEC-050's no-cancellation-fee rule, and
  the post-pickup customer cases belong to BQ-017.
- **Requiring `READY_FOR_PICKUP` before the policy applies** — rejected. It
  would leave a merchant-confirmed `PREPARING` cancellation — already a full
  customer refund under DEC-050 — with no loss allocation at all.

### Consequences

- The `PLATFORM_WRITE_OFF` account gains a second intended use alongside
  DEC-045's ฿2 delivery gap. Its BQ-015 half moves from `OPEN` to a policy
  awaiting implementation.
- **Cause attribution becomes load-bearing.** Allocation cannot be computed
  without a recorded cause, so the cause-code gap is now a functional
  prerequisite rather than a nicety.
- Nothing changes in the running system. An operator can still cancel a
  cooked order with no refund, no cost allocation, no cause code and no
  notification; this decision makes that a documented gap rather than an
  unanswered question.
- BQ-015 leaves the P0 open list, which drops from five to four
  (Q-001, Q-002, Q-020, BQ-030).
- `DEC-APP-006`'s gate on exception-path implementation is **not** lifted: it
  also depends on BQ-013 and BQ-017, both still open.
- The residual above means BQ-015's own scope is closed but one branch of its
  allocation table remains unassigned; that is stated, not hidden.

### Implementation status

**DECISION LOCKED — RUNTIME NOT IMPLEMENTED.** Gaps, none addressed here:

- `causeCode` is rejected by the cancel API (`.strict()` schema, two tests pin
  it); nothing writes `orders.cause_code`
- no gross merchant payable exists — only the 8% commission is posted against
  `MERCHANT_PAYABLE`, so "the merchant is made whole" has no ledger substrate
- no `PLATFORM_WRITE_OFF` posting for food loss (DEC-045's delivery-gap
  posting is unrelated)
- no refund initiation, mechanism, or state transition (Q-020)
- no cancellation notification; neither cancel path emits an outbox event
- no merchant-confirmation flow for a `PREPARING` cancellation
- no settlement or reconciliation

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — BQ-015 DECISION LOCK"),
following this session's BQ-015 reconnaissance: a repository-wide search
finding **no** cooked-food rule, percentage, amount or code anywhere;
`docs/ORDER_LIFECYCLE.md` § 6's cause taxonomy with its Fault column
(`PROPOSED`); `orders.cause_code` present and mutable
(`supabase/migrations/20260811000005_order_domain.sql`);
`packages/validation/src/order.ts`'s strict cancel schema rejecting
`causeCode`; `docs/SETTLEMENT_MODEL.md` § 3's `PLATFORM_WRITE_OFF` row with
its BQ-015 half open; and § 9's cause table marking the no-rider row
`OPEN — BQ-015, P0`.

### Related Requirements

BQ-015 (**resolved by this decision**, with the residual above recorded) ·
BQ-017, BQ-031, Q-020, BQ-024, BQ-013, UX-Q-006 — **all remain `OPEN` and
untouched** · CON-003 (order-level zero-sum) · DEC-022 (operator cancellation
of a no-rider order) · DEC-043 (commission — **not** deducted from the
valuation basis) · DEC-045 (platform write-off precedent) · DEC-048, DEC-049,
DEC-050 (unchanged)

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3, § 9 · `docs/ORDER_LIFECYCLE.md` § 5, § 6 ·
`docs/BUSINESS_RULES.md` § 2.4 · `docs/PAYMENT_LIFECYCLE.md` § 8 ·
`supabase/migrations/20260811000005_order_domain.sql` (`cause_code`,
`subtotal_satang` — **both unchanged by this decision**)

### Supersedes / Superseded By

None / None. Resolves **BQ-015** and corrects its original question text,
which claimed ownership of post-pickup customer cases that belong to
**BQ-017**. Does not supersede or modify DEC-022, DEC-043, DEC-045, DEC-048,
DEC-049 or DEC-050, each of which stands unchanged. **The residual this entry
recorded under *Known residual — recorded, not decided* was closed the same
day by DEC-052**: a customer-caused cancellation of prepared food before
`PICKED_UP` is absorbed by BANHAO as `PLATFORM_WRITE_OFF`. Every other part of
this decision — the platform-caused and merchant-caused branches, the
`PREPARING` boundary, the valuation basis and BQ-017's ownership — is
unchanged by it. **The post-`PICKED_UP` boundary this entry assigned to
BQ-017 was decided the same day by DEC-053**; this decision's own pre-pickup
scope is unchanged by it.

---

## DEC-052 — Customer-caused pre-pickup cooked-food loss is absorbed by BANHAO

**Status:** ACCEPTED — POLICY · **RUNTIME NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

A **narrow clarification of DEC-051**, closing the one residual that decision
recorded and nothing else. DEC-051 remains authoritative and unamended in
every other respect.

**The rule.** Where **all** of the following hold:

1. the order is in `PREPARING` or a later prepared-food state,
2. the order has **not** reached `PICKED_UP`,
3. the customer cancellation is permitted under **DEC-050**,
4. the cancellation is **customer-caused**,
5. the customer receives the **full refund** DEC-050 requires, and
6. **no** Phase 1 cancellation fee is charged (DEC-050 locks that there is
   none),

then **BANHAO absorbs the merchant's eligible cooked-food loss**, in the
economic account **`PLATFORM_WRITE_OFF`**.

This is a **Phase 1 residual allocation rule**. It does **not** create a
customer cancellation fee, does **not** create a merchant penalty, does
**not** alter the customer's full-refund entitlement under DEC-050, and does
**not** move the event into BQ-017.

> **This is an economic allocation rule, not a fault determination.** Nothing
> here finds that the customer is or is not at fault. It answers only the
> question DEC-051 left open — *which balance sheet carries the loss* — for
> one specific combination of cause, state and timing.

**Valuation basis — unchanged from DEC-051:** `orders.subtotal_satang`. Not
reduced by the 8% commission (DEC-043), not `grand_total_satang`, excluding
delivery fee, service fee and promotion funding. No food-cost percentage and
no fixed compensation amount is created. **It remains a valuation basis, not
a merchant payable** — it decides no settlement amount and no
gross-merchant-payable architecture.

**Accounting — unchanged from DEC-051:** `PLATFORM_WRITE_OFF` is the intended
economic account, following the DEC-045 precedent. **No ledger entry, group,
posting shape or zero-sum behaviour is designed or authorized here**; DEC-049
remains authoritative for ledger architecture, and **no new account is
created**.

### Why

Each step is forced by decisions already locked; none of it is a new
judgement about the customer:

1. **DEC-050 requires a full customer refund** for a cancellation permitted in
   this window — the customer is made whole, so the loss cannot rest there.
2. **DEC-050 locks that there is no Phase 1 cancellation fee** — so there is
   no mechanism by which a customer could bear any part of it. Assigning the
   loss to the customer would require inventing the very fee DEC-050 refuses.
3. **BQ-017 owns customer-caused refusal, unreachable-customer and delivery
   failure only *after* `PICKED_UP`.** This event is **before** pickup, so it
   cannot be assigned to BQ-017 without expanding BQ-017's scope — which
   DEC-050 and DEC-051 both explicitly declined to do.
4. **DEC-051's own allocation table therefore leaves this case without a
   bearer** — its branches cover platform-caused, merchant-caused, and
   customer-caused *post-pickup*. DEC-051 recorded that gap rather than
   closing it by inference in either direction.
5. **Charging it to the merchant would be a merchant penalty**, which DEC-051
   explicitly refuses to create.

With the customer excluded by (1) and (2), BQ-017 excluded by (3), and the
merchant excluded by (5), **BANHAO is the Phase 1 residual bearer** for this
specific case.

### The complete BQ-015 allocation, after this clarification

| Cause | Timing | Bears the eligible cooked-food loss |
|---|---|---|
| **Platform-caused** (no rider; operator cancellation from the platform's own inability to deliver) | prepared, before `PICKED_UP` | **BANHAO** — `PLATFORM_WRITE_OFF` (DEC-051) |
| **Merchant-caused** (late cancellation, inability to supply after accepting) | prepared, before `PICKED_UP` | **The merchant** (DEC-051) |
| **Customer-caused** | prepared, before `PICKED_UP` | **BANHAO** — `PLATFORM_WRITE_OFF`, **residual Phase 1 rule (this decision)** |
| **Customer-caused** (refusal, unreachable) | after `PICKED_UP` | **`OPEN` — BQ-017**, not decided by BQ-015 |
| **Delivery failure / customer unreachable** | after `PICKED_UP` | **`OPEN` — BQ-017**, not decided by BQ-015 |

**BQ-015 does not resolve BQ-017.** The last two rows remain open and belong
entirely to BQ-017.

### Scope

Applies **only** to: a prepared-food state (`PREPARING` onward) **and** a
customer-caused cancellation **and** before `PICKED_UP`.

Changes nothing about: DEC-050's cancellation window, its full-refund rule or
its no-cancellation-fee rule · DEC-051's platform-caused branch, its
merchant-caused branch, its `PREPARING` boundary or its valuation basis ·
BQ-017's post-pickup ownership · BQ-031's partial refunds · Q-020's refund
mechanism · BQ-024's rider compensation · DEC-049's ledger architecture ·
DEC-048's service-fee refundability.

### Explicit non-decisions

Untouched and still `OPEN`: **BQ-017**, **BQ-031**, **Q-020**, **BQ-024**,
**BQ-013**, **UX-Q-006**.

Also not decided here: the refund mechanism, provider refund API, refund
webhook, refund state-machine implementation, partial refunds, rider
compensation, customer refusal or delivery failure after pickup, **gross
merchant payable**, settlement, reconciliation, cancellation notifications,
customer or merchant UI, and `causeCode` API support. **DEC-048, DEC-049,
DEC-050 and DEC-051 are authoritative and unmodified.**

### Alternatives

- **Assign it to the customer** — impossible without inventing a cancellation
  fee, which DEC-050 explicitly refuses for Phase 1.
- **Assign it to the merchant** — rejected. Being asked to confirm a
  cancellation is not fault, and charging the merchant would be the penalty
  schedule DEC-051 declined to create.
- **Move it into BQ-017** — rejected. BQ-017 is scoped to post-`PICKED_UP`
  events by DEC-050 and DEC-051; widening it would reintroduce exactly the
  overlap the DEC-051 scope correction removed.
- **Leave it open** — rejected. It is reachable in Phase 1 the moment
  cancellation is implemented, and an unallocated loss cannot be recorded at
  all, which CON-003 does not tolerate.

### Consequences

- DEC-051's residual is closed. BQ-015's allocation table is complete for
  every pre-pickup case; **BQ-015 stays `RESOLVED`, still pointing to
  DEC-051**, with this decision recorded as its clarification.
- `PLATFORM_WRITE_OFF` now has three intended uses: DEC-045's ฿2 delivery gap
  (**implemented**), DEC-051's platform-caused food loss (policy only), and
  this residual case (policy only).
- BANHAO's exposure widens slightly: it now absorbs the food cost of
  customer-initiated late cancellations as well as platform failures. At
  launch volume this is bounded by the merchant-confirmation requirement
  DEC-050 already imposes on a `PREPARING` cancellation.
- **Nothing changes in the running system.** No cancellation can produce a
  refund, a write-off, a cause code or a notification today.

### Implementation status

**POLICY ONLY — RUNTIME NOT IMPLEMENTED.** Unchanged from DEC-051: the cancel
API rejects `causeCode` (`.strict()` schema, pinned by tests) and nothing
writes `orders.cause_code`; no gross merchant payable exists; there is no
`PLATFORM_WRITE_OFF` posting for food loss; no refund initiation or mechanism
(Q-020); no cancellation notification; no merchant-confirmation flow.

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — BQ-015 RESIDUAL DECISION
LOCK"), closing the residual DEC-051 itself recorded under *Known residual —
recorded, not decided*.

### Related Requirements

BQ-015 (**remains RESOLVED by DEC-051**; this decision closes its recorded
residual) · DEC-050 (full refund, no cancellation fee — both unchanged and
load-bearing in the reasoning) · DEC-051 (clarified, not amended) · DEC-045
(platform write-off precedent) · DEC-043 (commission — **not** deducted from
the valuation basis) · CON-003 · BQ-017, BQ-031, Q-020, BQ-024, BQ-013,
UX-Q-006 — **all remain `OPEN` and untouched**

### Related Architecture

`docs/SETTLEMENT_MODEL.md` § 3, § 9 · `docs/ORDER_LIFECYCLE.md` § 5 ·
`docs/BUSINESS_RULES.md` § 2.4, § 6 · `docs/PAYMENT_LIFECYCLE.md` § 8

### Supersedes / Superseded By

None / None. **Clarifies DEC-051** by closing the residual it recorded; it
amends no other part of that decision. Does not supersede or modify DEC-043,
DEC-045, DEC-048, DEC-049, DEC-050 or DEC-051, each of which stands unchanged.

---

## DEC-053 — Post-pickup delivery failure and customer unreachable: operator-resolved `DELIVERY_FAILED`, cause-dependent economics

**Status:** ACCEPTED — POLICY · **RUNTIME NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

Resolves **BQ-017**. Owns the **post-`PICKED_UP`** failure boundary: customer
unreachable, customer refusal, and any other delivery that cannot be completed
after the rider has taken the food. Pre-pickup allocation stays with
DEC-050/051/052 and is not touched.

**1. Operational model — terminal states.**

| Domain | Terminal state |
|---|---|
| Delivery | **`FAILED`** |
| Order | **`DELIVERY_FAILED`** |

`CANCELLED` is **not** the normal post-pickup delivery-failure outcome. It
remains valid on the lifecycle paths where it is already defined (customer and
operator cancellation under DEC-050/DEC-022); this decision's path is
`DELIVERY_FAILED` with delivery `FAILED`.

**2. Operator-controlled resolution.** The failure is declared through an
**operator-controlled resolution path**. The rider performs the operational
steps and produces evidence; the **operator is the authority** that declares
the failure. This implements OD-04's "the rider decides no financial outcome"
and OD-06's "after pickup, controlled resolution" rather than replacing them.

The flow:

1. Delivery reaches `ARRIVED`.
2. Rider attempts to contact the customer.
3. Rider records/produces the evidence the operational system supports.
4. The contact-attempt requirement is satisfied.
5. The wait timer completes.
6. The operator declares — or confirms the resolution of — the delivery failure.
7. Delivery transitions to **`FAILED`**.
8. Order transitions to **`DELIVERY_FAILED`**.

A rider action may never, on its own, determine the refund, the merchant loss,
the platform loss, any customer financial liability, or rider compensation.
Those follow the cause and economic policy locked below.

**3. Contact and wait rule.**

| Parameter | Phase 1 value |
|---|---|
| Contact attempts | **2** |
| Wait timer | **5 minutes** |
| Timer start | when the delivery reaches **`ARRIVED`** |

Failure **cannot** be resolved before both the contact-attempt requirement and
the 5-minute wait are satisfied, and operator resolution remains required
regardless.

> ⚠️ **The wait timer is 5 minutes.** An earlier figure of 10 minutes appeared
> only as an illustrative example inside BQ-017's own open-question text. It
> was never approved and **is not the policy**. No document may state 10
> minutes as the active rule.

Per DEC-031 the timer is **configuration, not a constant**. No additional
contact channel and no evidence requirement beyond what the existing
architecture already supports is introduced here.

**4. Safe drop-off is NOT authorized.** This decision grants no safe-drop-off
permission of any kind. Safe-drop-off eligibility remains deferred to
**UX-Q-006** and **OD-04**, both still open. A delivery that cannot be
completed goes to the failure path above.

**5. Cause-dependent economics.** Post-pickup failure outcomes depend on the
cause:

| Cause | Customer refund | Service fee | Delivery fee | Cooked-food loss | Rider compensation |
|---|---|---|---|---|---|
| `CUSTOMER_UNREACHABLE` | **No** | **No** | **No** | **Merchant** | **Eligible** |
| `CUSTOMER_REFUSED` | **No** | **No** | **No** | **Merchant** | **Eligible** |
| `RIDER_CAUSED` | **Full eligible refund** | Follow DEC-048 | **Refunded** | **BANHAO** | **Eligible** |
| `MERCHANT_CAUSED` | **Full eligible refund** | Follow DEC-048 | **Refunded** | **Merchant** | **Eligible** |
| `PLATFORM_CAUSED` | **Full eligible refund** | Follow DEC-048 | **Refunded** | **BANHAO** | **Eligible** |
| `INDETERMINATE` | **Full eligible refund** | Follow DEC-048 | **Refunded** | **BANHAO — provisional** | **Eligible** |

**Customer-caused failure produces no refund of any component.** This is **not
a cancellation fee**: it is the economic consequence of a post-pickup,
customer-caused delivery failure, reached after the food has been cooked,
collected and carried to the customer. **DEC-050 is unchanged** and remains
authoritative for the pre-pickup cancellation window and its no-fee rule.

**Non-customer-caused failure gives the customer a full eligible order
refund**, executed under the refund architecture already locked — **DEC-048**
for the service fee, **DEC-049** for the ledger representation. This decision
creates **no new refund architecture**.

**6. Delivery fee.** Cause-dependent, exactly as the table states: **not
refunded** where the failure is customer-caused; **refunded** as part of the
eligible full refund otherwise. This is a customer-side fee rule and is **not**
a rider earning rule — **DEC-044 governs rider earning and is unchanged**.

**7. Cooked-food valuation.** Where cooked-food loss must be valued, the basis
is **`orders.subtotal_satang`** — never `grand_total_satang`, never the
merchant amount net of the 8% commission (DEC-043), and excluding delivery
fee, service fee and promotion funding.

> This is a **valuation basis only. It does not create or imply a merchant
> payable.** Gross merchant payable remains unbuilt and outside this decision.

Where BANHAO absorbs the loss, the intended economic account is the existing
**`PLATFORM_WRITE_OFF`** — **no new ledger account is created**, and no ledger
posting is designed or authorized here. DEC-049 remains authoritative for
ledger architecture.

**8. Rider compensation eligibility: YES.** A rider who carried out a
post-pickup failed-delivery attempt **is eligible** for separate compensation
in every cause row above, including where the rider caused the failure —
because **this decision creates no rider penalty**. The **amount**, any
waiting compensation and the calculation are **owned by BQ-024** and are not
decided here. This is distinct from DEC-044's ฿12 completed-delivery earning,
which is unchanged and does not apply to a failed delivery.

**9. Cause taxonomy.** This decision recognizes six cause classes:
`CUSTOMER_UNREACHABLE`, `CUSTOMER_REFUSED`, `RIDER_CAUSED`, `MERCHANT_CAUSED`,
`PLATFORM_CAUSED`, `INDETERMINATE`.

⚠️ **Only two of these exist today**, and only as `PROPOSED` entries in
`docs/ORDER_LIFECYCLE.md` § 6: `CUSTOMER_UNREACHABLE` and `CUSTOMER_REFUSED`,
both already mapped to terminal state `DELIVERY_FAILED`. **`RIDER_CAUSED`,
`MERCHANT_CAUSED` (post-pickup), `PLATFORM_CAUSED` (post-pickup) and
`INDETERMINATE` do not exist in any taxonomy or in any code.** Adding them,
and enforcing cause capture at all, is future runtime work recorded under
*Implementation status* — this decision claims no existing support for them.

**10. Indeterminate cause.** Where the cause cannot be determined at
resolution time, the cause is **`INDETERMINATE`** and the economic default is
**platform-like residual treatment pending investigation**: the customer
receives the full eligible refund, the service fee follows DEC-048, the
delivery fee is refunded, **BANHAO provisionally absorbs the cooked-food
loss**, and rider compensation remains eligible subject to BQ-024. This is a
**newly locked policy**, not a pre-existing repository rule.

**11. Food disposition.** The preferred operational disposition is to **return
the food to the merchant where reasonably possible**; where return is not
reasonably possible, the food is **disposed of**. **Rider retention is not a
default policy.** No recoverable-food asset model and no ledger asset for
salvaged food is created — food disposition is an operational rule and is
deliberately kept separate from who bears the economic loss.

**12. Operator cancellation after pickup.** Today `OrdersService.operatorCancel`
permits cancellation at `PICKED_UP`/`DELIVERING` while performing no refund,
writing no ledger fact, setting no cause, resolving no delivery state and
sending no notification — leaving the delivery row stranded. **For post-pickup
delivery failure, operator cancellation is henceforth a controlled
failure-resolution path**, not an ordinary order cancellation that terminates
the order without resolving the delivery and its economic consequences. **The
runtime change implementing this is later work and is not made here**; until
it lands, the gap described above remains live.

### Explicit non-decisions

This decision does **not** decide, and does not reopen:

- **BQ-024** — rider compensation amount and waiting compensation.
- **BQ-031** — partial refund composition. No partial refund is introduced.
- **Q-020** — the refund execution mechanism. Nothing here can execute until
  it is answered.
- **UX-Q-006 / OD-04** — safe-drop-off eligibility.
- **BQ-013** — merchant auto-pause and accept-timeout behaviour.
- Payment-provider webhook mechanics, refund API implementation, ledger
  runtime implementation, notification implementation, settlement/payout
  implementation.
- Any evidence schema beyond what existing policy and architecture support.
- Promotion-funding reversal and merchant commission reversal mechanics —
  each remains exactly as (un)decided elsewhere.

**DEC-044, DEC-048, DEC-049, DEC-050, DEC-051 and DEC-052 are authoritative
and unmodified.** In particular: DEC-048's service-fee refundability is
applied, not redefined; DEC-049's refund ledger architecture is used, not
redesigned; DEC-050's pre-pickup window and no-cancellation-fee rule stand;
and DEC-051/DEC-052's cooked-food allocation stays pre-pickup — this decision
owns the post-pickup half rather than extending theirs.

### Why

Product Owner decision, 2026-09-07, following this session's BQ-017
reconnaissance and decision gate. The recon established that post-pickup is
currently a one-way street to `DELIVERED`: `deliveries.state` already carries
`FAILED`/`ABANDONED` and `orders.state` already carries `DELIVERY_FAILED`, yet
nothing writes them; `release_rider_assignment()` refuses post-pickup states;
no failure route or driver affordance exists; nothing monitors post-pickup
deliveries; and no question owned the post-pickup economics once DEC-051
scoped BQ-015 to pre-pickup only.

The A+C combination was chosen because the existing `PROPOSED` cause taxonomy
already maps `CUSTOMER_UNREACHABLE` and `CUSTOMER_REFUSED` to
`DELIVERY_FAILED`, so option A needs no new state names and no migration,
while option C's operator authority is what OD-04 and OD-06 already require of
any post-pickup resolution.

### Consequences

- **`DELIVERY_FAILED` is still gated by DEC-APP-006**, which blocks the
  exception states until BQ-013, BQ-015 and BQ-017 are all closed. BQ-015 and
  BQ-017 now are; **BQ-013 is not**, so this decision does not by itself lift
  that gate.
- **Customer-caused failure retains the customer's payment while the merchant
  absorbs the food loss.** A future settlement engine must therefore
  **exclude a customer-caused `DELIVERY_FAILED` order from merchant payout** —
  otherwise the merchant would be paid from a payment that was retained
  precisely because they were not made whole. This consequence is recorded as
  an implementation requirement; the settlement engine and gross merchant
  payable remain unbuilt and outside this decision.
- Rider-caused failure has BANHAO absorbing the food loss, so **no rider
  penalty exists** — consistent with OD-06's "may not decide a penalty" and
  with DEC-051's refusal to create a merchant penalty schedule.
- `PLATFORM_WRITE_OFF` gains a fourth intended use, alongside DEC-045's ฿2
  delivery gap (implemented) and DEC-051/052's pre-pickup food loss (policy).
- Nothing executes today: no refund can be issued (Q-020), no cause can be
  recorded (the cancel API rejects `causeCode`), and no failure can be
  declared at all.

### Implementation status

**POLICY LOCKED — RUNTIME NOT IMPLEMENTED.** No runtime code, schema,
migration, API route, DTO, UI, notification, refund execution, ledger posting,
automated timer or cause-code enforcement is created by this decision. Gaps:

- no post-pickup failure route; the rider and operator have no failure action
- `release_rider_assignment()` deliberately excludes post-pickup states
- nothing monitors post-pickup deliveries; the 5-minute timer has no runner
- `deliveries.state = 'FAILED'`, `failed_at` and `failure_cause` are never written
- `orders.state = 'DELIVERY_FAILED'` is blocked by DEC-APP-006 (BQ-013 open)
- four of the six cause classes do not exist; the cancel API's `.strict()`
  schema rejects `causeCode`, pinned by tests, and nothing writes
  `orders.cause_code`
- no refund initiation or mechanism (Q-020); no `PLATFORM_WRITE_OFF` posting
  for food loss; no gross merchant payable
- no operator/supervisor command (the console's `blockedBy` still names the
  open decisions); no customer or rider notification
- operator post-pickup cancellation remains reachable with the stranding
  behaviour described in clause 12

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — DEC-053 POST-PICKUP DELIVERY
FAILURE & CUSTOMER UNREACHABLE"), following this session's BQ-017 read-only
reconnaissance and decision gate: `docs/ORDER_LIFECYCLE.md` § 4 (rider wait
`OPEN — BQ-017`), § 5 (`PICKED_UP` onward `OPEN`), § 6 (the `PROPOSED` cause
taxonomy already mapping the two customer causes to `DELIVERY_FAILED`);
`docs/SETTLEMENT_MODEL.md` § 9's delivery-failed row (`OPEN — BQ-017`);
`supabase/migrations/20260811000009_delivery_domain.sql` (`FAILED`,
`ABANDONED`, `failed_at`, `failure_cause` — all unwritten);
`supabase/migrations/20260811000013_rider_reassignment_atomicity.sql`
(release restricted to `RIDER_ASSIGNED`/`RIDER_REASSIGNING`); and the design
package's OD-04 and OD-06, which DEC-040 § 10 records as locked.

### Related Requirements

BQ-017 (**resolved by this decision**) · BQ-024 (rider compensation amount —
**`OPEN`**) · BQ-031 (partial refund composition — **`OPEN`**) · Q-020 (refund
mechanism — **`OPEN`**) · BQ-013 (merchant accept timeout — **`OPEN`**, and
still gating DEC-APP-006) · UX-Q-006, OD-04 (safe-drop-off eligibility —
**deferred**) · DEC-038 (mandatory completion photo — unchanged) · DEC-044,
DEC-048, DEC-049, DEC-050, DEC-051, DEC-052 (all unchanged) · DEC-022,
DEC-032 (operator authority and mandatory reason) · CON-003

### Related Architecture

`docs/ORDER_LIFECYCLE.md` § 3, § 4, § 5, § 6 · `docs/SETTLEMENT_MODEL.md` § 3,
§ 9 · `docs/PAYMENT_LIFECYCLE.md` § 8 · `docs/BUSINESS_RULES.md` § 2.4, § 6 ·
`supabase/migrations/20260811000005_order_domain.sql`,
`…20260811000009_delivery_domain.sql` (**both unchanged by this decision**)

### Supersedes / Superseded By

None / None. Resolves **BQ-017** and owns the post-`PICKED_UP` failure
boundary that DEC-050 and DEC-051 each explicitly assigned to it. Does not
supersede or modify DEC-022, DEC-038, DEC-043, DEC-044, DEC-045, DEC-048,
DEC-049, DEC-050, DEC-051 or DEC-052, each of which stands unchanged. **The two runtime-policy blockers this decision's
own implementation status recorded — the missing customer-arrival anchor and
DEC-APP-006's gate on `DELIVERY_FAILED` — were closed the same day by
DEC-054**; this decision's operational and economic policy is unchanged by
it, and Q-020 still blocks every refund and ledger consequence.

---

## DEC-054 — Customer-arrival anchor `EN_ROUTE → ARRIVED`, and a narrow DEC-APP-006 carve-out for DEC-053's failure path

**Status:** ACCEPTED — POLICY / ARCHITECTURE · **RUNTIME NOT IMPLEMENTED** · **Date:** 2026-09-07 · **Owner:** PRODUCT_OWNER

### Decision

Two narrow locks that unblock **DEC-053**'s runtime path. **DEC-053 remains
the authoritative operational and economic policy and is not restated,
amended or duplicated here.**

---

**1. Customer arrival is a distinct lifecycle concept from merchant arrival.**

The runtime already has a rider-arrival transition, and it means **arrival at
the merchant**:

| Concept | Transition | Meaning | Status |
|---|---|---|---|
| **Merchant arrival** | `RIDER_ASSIGNED → AT_MERCHANT` | The rider has reached the **shop**, to collect the food | **Existing, unchanged.** `POST /api/v1/rider/deliveries/:id/arrived` keeps exactly its current semantics |
| **Customer arrival** | **`EN_ROUTE → ARRIVED`** | The rider has reached the **customer's delivery location** | **New lifecycle concept**, not yet implemented |

**`AT_MERCHANT` = merchant arrival. `ARRIVED` = customer arrival.** Wherever
either word appears without qualification, documentation must say which it
means. The existing `/arrived` endpoint **must not** be reused as the
customer-arrival anchor — it fires before pickup, at the wrong end of the
journey.

**The customer-arrival timestamp is the authoritative anchor for DEC-053's
five-minute wait timer.** The timer **must not** start at merchant arrival.

DEC-053's rule is unchanged and restated here only as the anchor's
consequence: **2 customer contact attempts**, a **5-minute** wait measured
from customer arrival, and **operator-controlled** failure resolution. The
five-minute value is unchanged; the 10-minute figure remains what it always
was — an illustration inside BQ-017's historical text, never active policy.

**DEC-038 is untouched:** the mandatory completion photo and the absence of a
no-photo completion path are unchanged by this decision.

---

**2. A narrow DEC-APP-006 carve-out for `DELIVERY_FAILED`.**

`DEC-APP-006` (V1.1 § "Implement the nine ACCEPTED states plus `CANCELLED`;
nothing else") blocks `PAYMENT_FAILED`, `PAYMENT_EXPIRED`,
`MERCHANT_REJECTED` and `DELIVERY_FAILED` until "their names and policies are
approved", citing BQ-013, BQ-015, BQ-016 and BQ-017 as the open questions.
Three of those four are now closed — BQ-015 (DEC-051/052), BQ-016 (DEC-050)
and BQ-017 (DEC-053). **BQ-013 remains `OPEN`, and the Product Owner declines
to close it merely to unblock DEC-053.**

Therefore: **`DELIVERY_FAILED` may be implemented specifically for DEC-053's
post-pickup delivery-failure path, while BQ-013 stays `OPEN`.**

Per `CLAUDE.md`'s precedence rule (`DEC-` > `DEC-APP-` > `ADR-`), this
decision narrows DEC-APP-006's gate for exactly one state on exactly one
path. Everything else about DEC-APP-006 stands.

**This carve-out does NOT:**

- resolve **BQ-013**, imply its approval, or change merchant auto-pause policy
  in any way;
- unlock `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`, or any
  other exception state;
- authorize a generic `DELIVERY_FAILED` write from arbitrary code — the state
  is reachable **only** through DEC-053's controlled, operator-resolved path;
- authorize a rider-, customer- or merchant-declared failure. **Operator
  authority is preserved**: the rider performs the operational steps and
  produces evidence; the operator declares the failure;
- authorize **safe drop-off**, which remains deferred to **UX-Q-006 / OD-04**;
- authorize any cancellation outside DEC-053;
- authorize any new terminal state beyond `DELIVERY_FAILED` on this path.

---

**3. Q-020 is untouched.** This decision lifts an **operational** gate only.
It authorizes **no** provider refund call, refund route, refund webhook
handling, refund transaction or ledger reversal posting. Refund execution
stays blocked on **Q-020**, and DEC-049 remains authoritative for how a
reversal is represented when one eventually exists.

### Future implementation contract

Recorded as the contract a later implementation task must satisfy — **not
code authorized by this decision**:

```
merchant arrival   RIDER_ASSIGNED → AT_MERCHANT          (existing, unchanged)
customer arrival   EN_ROUTE       → ARRIVED              (new; timestamp recorded)
DEC-053 failure    ARRIVED → contact ×2 → 5-minute wait
                           → operator resolution → FAILED
order              →  DELIVERY_FAILED
```

The customer-arrival timestamp is the timer anchor. Failure cannot be
resolved before both the two-contact requirement and the five-minute wait are
satisfied, and operator resolution is required regardless.

⚠️ **`ARRIVED` is not yet a permitted delivery state.**
`deliveries.state`'s CHECK constraint
(`supabase/migrations/20260811000009_delivery_domain.sql`) lists
`UNASSIGNED`, `RIDER_SEARCHING`, `RIDER_ASSIGNED`, `RIDER_REASSIGNING`,
`AT_MERCHANT`, `PICKED_UP`, `EN_ROUTE`, `DELIVERED`, `FAILED`, `ABANDONED` —
**no `ARRIVED`** — and there is no customer-arrival timestamp column. A future
implementation therefore needs an **additive migration**, which under
`CLAUDE.md` § 10 requires its own explicit instruction and is **not
authorized here**. No schema change is made by this decision.

### Why

Product Owner decision, 2026-09-07, resolving the two blockers the DEC-053
runtime reconnaissance identified.

The arrival anchor was a genuine naming hazard rather than a preference:
`POST /api/v1/rider/deliveries/:id/arrived` transitions
`RIDER_ASSIGNED → AT_MERCHANT`, so an implementer wiring DEC-053's timer to
the endpoint whose name matches the policy word would have started the
five-minute clock at the shop, before the food was even collected. OD-04's
"Arrived → contact customer → timer → resolution" plainly means the customer's
door, and the driver flow's own `PROPOSED` button sequence already anticipates
a `ถึงจุดส่ง` ("arrived at drop-off") step. Making the two concepts textually
distinct removes the ambiguity before any code is written.

The carve-out was preferred to closing BQ-013 because DEC-APP-006's gate is a
*conjunction* of four unrelated questions, and BQ-013 (merchant acceptance
timeout and auto-pause thresholds) has nothing to do with post-pickup
delivery failure. Closing a live business question as a side effect of
unblocking an unrelated path would be exactly the "supply the missing value
to unblock" pattern DEC-040 § 5 forbids elsewhere in this repository.

### Alternatives

- **Reuse `/arrived` as the customer anchor** — rejected. It would silently
  redefine an existing shipped endpoint and start the timer before pickup.
- **Close BQ-013 to lift the gate wholesale** — rejected. It would resolve an
  unrelated open question by convenience and would additionally unlock
  `PAYMENT_FAILED`, `PAYMENT_EXPIRED` and `MERCHANT_REJECTED`, none of which
  has an approved policy.
- **Implement DEC-053's failure path on `CANCELLED` to avoid the gate** —
  rejected. DEC-053 §1 already refused `CANCELLED` as the post-pickup failure
  outcome, and the `PROPOSED` cause taxonomy already maps
  `CUSTOMER_UNREACHABLE`/`CUSTOMER_REFUSED` to `DELIVERY_FAILED`.

### Consequences

- DEC-053's operational path is unblocked; its **economic** half stays blocked
  on **Q-020**, unchanged.
- The delivery state machine gains a documented tenth progression state,
  `ARRIVED`, between `EN_ROUTE` and its terminal outcomes. Implementing it
  needs an additive migration under its own instruction.
- `DEC-APP-006` now has exactly one carve-out. Its other three excluded
  states, and its underlying reason, are unchanged; **BQ-013 continues to gate
  them**.
- Operator authority becomes load-bearing: with `DELIVERY_FAILED` reachable,
  the guard that keeps it operator-only is what prevents a rider from
  declaring a financial outcome (OD-04, OD-06).
- Nothing changes in the running system. No customer-arrival transition, no
  timer, no failure route and no refund exists today.

### Implementation status

**POLICY / ARCHITECTURE LOCKED — RUNTIME NOT IMPLEMENTED.** No source, schema,
migration, API route, DTO, UI, test or dependency change is made or authorized
by this decision. The gaps DEC-053 recorded are unchanged, plus the two this
decision names: no `ARRIVED` state or timestamp, and no operator failure
command.

### Evidence

Product Owner instruction, 2026-09-07 ("BANHAO — LOCK CUSTOMER ARRIVAL +
DEC-APP-006 EXCEPTION"), following the DEC-053 runtime reconnaissance:
`apps/api/src/modules/rider/delivery-arrival.service.ts` (`/arrived` performs
`RIDER_ASSIGNED → AT_MERCHANT`); `supabase/migrations/20260811000009_delivery_domain.sql`
(no `ARRIVED` in the CHECK, no customer-arrival timestamp);
`docs/BANHAO-APP-ARCHITECTURE-V1.md` DEC-APP-006 (the four-question gate);
`docs/RIDER_LIFECYCLE.md` § 4 (the delivery state diagram, which currently
goes `EN_ROUTE → FAILED` with no arrival step).

### Related Requirements

DEC-053 (**authoritative; unchanged and not restated here**) · DEC-APP-006
(**narrowed for this one state on this one path only**) · **BQ-013 — remains
`OPEN` and is not resolved, narrowed or implied by this decision** · **Q-020 —
remains `OPEN`**; refund execution stays blocked · UX-Q-006, OD-04 (safe
drop-off — **still deferred, not authorized**) · BQ-024, BQ-031 (unchanged,
`OPEN`) · DEC-038 (mandatory completion photo — unchanged) · DEC-044,
DEC-048, DEC-049, DEC-050, DEC-051, DEC-052 (all unchanged) · OD-04, OD-06
(operator authority preserved) · DEC-019, DEC-021, DEC-022

### Related Architecture

`docs/RIDER_LIFECYCLE.md` § 4 · `docs/ORDER_LIFECYCLE.md` § 3, § 4, § 5 ·
`docs/BANHAO-APP-ARCHITECTURE-V1.md` (DEC-APP-006) ·
`supabase/migrations/20260811000009_delivery_domain.sql` (**unchanged by this
decision**)

### Supersedes / Superseded By

None / None. **Narrows DEC-APP-006** for `DELIVERY_FAILED` on DEC-053's
post-pickup failure path only, and adds the customer-arrival anchor DEC-053
depends on. Does not supersede or modify DEC-019, DEC-021, DEC-022, DEC-038,
DEC-044, DEC-048, DEC-049, DEC-050, DEC-051, DEC-052 or DEC-053, each of which
stands unchanged.
