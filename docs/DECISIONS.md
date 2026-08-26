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

**Status:** ACCEPTED — MODEL · **numeric pricing resolved 2026-08-24 by DEC-035**
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

None / The `OPEN — NUMERIC PRICING` half is resolved by **DEC-035** (flat ฿10,
1000 satang). The money-flow model recorded here is unchanged and still stands.

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

**Status:** ACCEPTED — MODEL · OPEN — NUMERIC RATE
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

None / None.

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
unchanged. / None.

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
