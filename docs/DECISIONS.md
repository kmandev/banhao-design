# Decision Log

Every entry below is evidenced by content already in this repository — either a git commit or an explicit statement inside a design canvas. Where the source document states a decision but not its alternatives, that is recorded honestly as "Not documented in source" rather than invented. For anything with no evidence at all, this log says so instead of guessing.

## DEC-001

**Date:** 2026-08-09
**Status:** Implemented
**Category:** Repository structure

### Decision

Reorganize the repository from a flat `design/` folder into `docs/`, `design/`, `assets/`, `specs/`, `archive/` (numbered lifecycle stages under `docs/`, one folder per surface under `design/`).

### Reason

Long-term maintainability as the project grows past a single design drop; scaffold matched the requested structure.

### Alternatives Considered

Not documented in source.

### Consequences

`support.js` (the design-canvas runtime) had to be duplicated 4× to keep each `.dc.html` file's relative `./support.js` reference working without editing file content (see [`CHANGELOG.md`](../CHANGELOG.md)).

**Evidence:** git commit `f3939d6` "create structure project files"; current directory layout.

---

## DEC-002

**Date:** Not documented (predates AI involvement — present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented in design, not yet implemented in code
**Category:** Payment architecture

### Decision

Order State and Payment State are modeled as two separate, parallel state machines and must never be collapsed into one field.

### Reason

Quoted from source: "ออเดอร์หนึ่งใบมีสองสถานะเดินคู่กันเสมอ ห้ามยุบเป็นสถานะเดียว เพราะออเดอร์ที่ยกเลิกแล้วยังมีเงินค้างอยู่ในระบบจนกว่าจะคืนเสร็จ" — a cancelled order can still have money sitting in the system until the refund finishes, so a single merged state would hide that.

### Alternatives Considered

Not documented in source.

### Consequences

Any future implementation must persist Order state and Payment state as independent fields/tables with an explicit mapping between them (see the pairing table in `docs/ARCHITECTURE.md`).

**Evidence:** `docs/04-payment/BANHAO Payment Architecture.dc.html`, section "02 — STATE MACHINE".

---

## DEC-003

**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented in design, not yet implemented in code
**Category:** Payment architecture

### Decision

Payment confirmation must come only from a verified provider webhook — never from client-reported state.

### Reason

Quoted from source: "แอปไม่ใช่ผู้ตัดสินว่าจ่ายสำเร็จหรือยัง มีแต่ backend ที่ได้รับการยืนยันจากผู้ให้บริการชำระเงินเท่านั้นที่ตัดสินได้" — the app is never the judge of payment success; only a backend confirmed by the payment provider can decide.

### Alternatives Considered

Not documented in source.

### Consequences

`SUCCESS` and `REFUNDED` payment states are marked "actor: Webhook เท่านั้น" (webhook only) in the state table — no other code path may set them. Every webhook handler must be idempotent, keyed on a single payment reference.

**Evidence:** `docs/04-payment/BANHAO Payment Architecture.dc.html`, sections "01 — ARCHITECTURE" and "02 — STATE MACHINE".

---

## DEC-004

**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented in design, not yet implemented in code
**Category:** Payment / ledger

### Decision

Cash a driver collects from a customer is recorded as a liability owed to the platform ("Cash Collection"), not as driver income, and must be shown separately from actual driver earnings in any driver-facing UI.

### Reason

Quoted from source: "ไรเดอร์เป็นคนถือเงินของแพลตฟอร์มไว้ชั่วคราว ระบบจึงต้องบันทึกเป็นหนี้ที่ไรเดอร์ต้องนำส่ง … ไม่งั้นไรเดอร์จะเข้าใจว่าเงินในกระเป๋าคือรายได้ทั้งหมด" — a driver temporarily holds the platform's money; without separating it, a driver would mistake all the cash in hand for personal income.

### Alternatives Considered

Not documented in source.

### Consequences

Driver earnings UI must show "รายได้วันนี้" (today's earnings) and "เงินสดที่เก็บมาแทนบ้านเฮา" (cash collected on the platform's behalf) as two distinct numbers (see wireframe `P-D2`).

**Evidence:** `docs/04-payment/BANHAO Payment Architecture.dc.html`, section "04 — LEDGER" and wireframe `P-D2`.

---

## DEC-005

**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented in design, not yet implemented in code
**Category:** Data model

### Decision

Model the domain around five generic entities — Merchant, Product, Order, Delivery, Driver — instead of food-specific naming (e.g. not "Restaurant", not "Dish").

### Reason

Quoted from source: "คอมโพเนนต์ทุกตัวจึงตั้งชื่อตาม entity กลาง (Merchant, Product, Order, Delivery) ไม่ผูกกับคำว่า 'ร้านอาหาร'" — components are named after the central entity, not tied to the word "restaurant" — explicitly to support Phase 2–4 (Parcel, Ride, Shopping) without a rewrite.

### Alternatives Considered

Not documented in source.

### Consequences

The scaling table in `docs/05-architecture` shows how each entity's meaning shifts per phase (e.g. `Product` = menu item in Food, vehicle type in Ride) while the entity name and, by extension, the schema shape stay constant.

**Evidence:** `design/design-system/BANHAO Design System.dc.html:34`; `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "06 — SCALING".

---

## DEC-006

**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented intention, not a confirmed implementation decision
**Category:** Platform choice

### Decision

Driver App is planned as a mobile app built with Flutter. Merchant Web and Admin Web are planned as desktop-first responsive web apps (no framework specified).

### Reason

Not documented in source beyond the platform label itself — no rationale text accompanies this choice.

### Alternatives Considered

Not documented in source.

### Consequences

This is the only concrete implementation-technology signal anywhere in the repository. It should be treated as a design-time intention to confirm with whoever owns the technical stack, not as a locked decision — no sign-off, date, or rationale is recorded for it.

**Evidence:** `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "02 — SITEMAP" sitemap data (`platform:'Mobile · Flutter'`, `platform:'Responsive · Desktop first'`, `platform:'Desktop first'`).

---

## DEC-007

**Date:** Not documented (present in the initial design drop, commit `7d0a7d5`)
**Status:** Documented in design, governs future scope decisions
**Category:** Product strategy

### Decision

Any feature that lengthens the Phase 1 core path (open app → choose shop → choose food → order → wait → receive) — even by one step — is deferred to a later phase. Unavailable services appear as dimmed, unclickable "coming soon" cards with no destination screen.

### Reason

Quoted from source: "หลักตัดสินใจตลอด Phase 1" — the deciding principle throughout Phase 1.

### Alternatives Considered

Not documented in source.

### Consequences

Future scope requests for Phase 1 should be evaluated against this rule before being added; this is the basis for treating Driver/Merchant/Admin apps as out of scope for the current design pass.

**Evidence:** `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "01 — STRATEGY".

---

## Historical decisions not documented

No other product or architecture decisions have recorded evidence in this repository (e.g. why อ.บุณฑริก was chosen as the launch area, why Phase order is Food → Parcel → Ride → Shopping, why PromptPay specifically). These are treated as given product facts from the project brief, not decisions this log can source or date.
