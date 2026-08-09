# Constraints

Things the system must **never** violate. These are the highest-severity entries in the knowledge base — a conflict touching one of these should be treated as P0 in any `ai/PROMPTS/CONFLICT_CHECK.md` run. See also `AGENTS.md` at the repository root, which is the binding rule set these constraints are drawn from/aligned with.

---

## CON-001

```yaml
id: CON-001
type: CONSTRAINT
status: ACCEPTED
priority: P0
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "02 — STATE MACHINE"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Constraint

Order State and Payment State must remain two separate, independently-persisted state machines. They must never be collapsed into a single field.

### Why

Quoted: "ออเดอร์หนึ่งใบมีสองสถานะเดินคู่กันเสมอ ห้ามยุบเป็นสถานะเดียว เพราะออเดอร์ที่ยกเลิกแล้วยังมีเงินค้างอยู่ในระบบจนกว่าจะคืนเสร็จ" — a cancelled order can still have money sitting in the system until the refund completes; a merged state would hide that.

### Related Decisions

DEC-002

### Related Requirements

None directly

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, section "02"; `docs/ARCHITECTURE.md` § Order/Payment State Machine tables; `AGENTS.md` § Payments.

---

## CON-002

```yaml
id: CON-002
type: CONSTRAINT
status: ACCEPTED
priority: P0
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, sections "01" and "02"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Constraint

Payment may only transition to `SUCCESS` or `REFUNDED` via a verified backend webhook from the payment provider. Client-reported payment state must never be trusted for these transitions.

### Why

Quoted: "แอปไม่ใช่ผู้ตัดสินว่าจ่ายสำเร็จหรือยัง มีแต่ backend ที่ได้รับการยืนยันจากผู้ให้บริการชำระเงินเท่านั้นที่ตัดสินได้" — the app is never the arbiter of payment success.

### Related Decisions

DEC-003

### Related Requirements

REQ-003

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, sections "01"/"02" (state table marks `SUCCESS`/`REFUNDED` actor as "Webhook เท่านั้น"); `AGENTS.md` § Payments.

---

## CON-003

```yaml
id: CON-003
type: CONSTRAINT
status: ACCEPTED
priority: P1
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "04 — LEDGER"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Constraint

Every order's ledger must balance to exactly zero: customer payment in = merchant payout + driver payout + platform fee + refunds out, with no unaccounted remainder.

### Why

Quoted: "ทุกออเดอร์ต้องกระทบยอดเป็นศูนย์ … ห้ามมีเศษหายไปในระบบ".

### Related Decisions

DEC-004

### Related Requirements

REQ-001

### Evidence

`docs/04-payment/BANHAO Payment Architecture.dc.html`, section "04"; `docs/ARCHITECTURE.md` § Ledger Model.

---

## CON-004

```yaml
id: CON-004
type: CONSTRAINT
status: ACCEPTED
priority: P2
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, section "01 — STRATEGY"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Constraint

No Phase 1 feature may ship if it lengthens the core path (open app → choose shop → choose food → order → wait → receive), even by one step. Unavailable services must render as a disabled "coming soon" card with no destination screen — not a half-built flow.

### Why

Quoted: "หลักตัดสินใจตลอด Phase 1" — the deciding principle throughout Phase 1.

### Related Decisions

DEC-007

### Related Requirements

None directly

### Evidence

`docs/05-architecture/BANHAO Product Architecture.dc.html`, section "01".

---

## CON-005

```yaml
id: CON-005
type: CONSTRAINT
status: ACCEPTED
priority: P0
date: 2026-08-09
source: AGENTS.md (repository root)
confidence: HIGH
owner: PRODUCT_OWNER
```

### Constraint

No secrets, API keys, tokens, passwords, or payment-provider credentials may ever be committed to Git — not even in example/test files. No payment provider credential may be hardcoded anywhere in the codebase.

### Why

Standard security hygiene; stated as a binding rule for all agents in `AGENTS.md`.

### Related Decisions

None — predates any specific decision entry, stated directly as a repository-wide rule.

### Related Requirements

None directly

### Evidence

`AGENTS.md` § Secrets & credentials. (Not duplicated further here — `AGENTS.md` is the canonical source; this entry is a pointer.)
