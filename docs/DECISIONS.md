# Decision Log

Every entry below is evidenced by content already in this repository — either a git commit, an explicit statement inside a design canvas, or an explicit human instruction given directly to an AI session (cited as such). Where the source states a decision but not its alternatives, that is recorded honestly as "Not documented in source" rather than invented. Where no evidence exists at all, this log says `Historical decision not verified.` instead of guessing.

**Format note (v2):** this file was migrated on 2026-08-09 to the richer per-decision format used by the AI Memory System v2 (`Status / Date / Owner / Decision / Why / Alternatives / Consequences / Evidence / Related Requirements / Related Architecture / Supersedes / Superseded By`). No decision's meaning, evidence, or date was changed in the migration — only the field structure. See `ai/KNOWLEDGE/EVENTS.md` EVENT-004.

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
