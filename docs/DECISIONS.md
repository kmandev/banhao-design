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
