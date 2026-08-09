# Requirements

Things the system **must do**, evidenced directly by explicit statements already present in the design documentation. No requirement below was invented for this file — each cites the exact source sentence/section it comes from. See `ai/KNOWLEDGE/CONSTRAINTS.md` for the companion list of things the system must **not** violate.

---

## REQ-001

```yaml
id: REQ-001
type: REQUIREMENT
status: ACCEPTED
priority: P1
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "04 — LEDGER"; wireframe P-D2
confidence: HIGH
owner: PRODUCT_OWNER
```

### Requirement

Cash collected by a driver from a customer must be recorded as a liability owed to the platform ("Cash Collection") and displayed separately from the driver's actual earnings in any driver-facing UI.

### Rationale

Quoted: "ไรเดอร์เป็นคนถือเงินของแพลตฟอร์มไว้ชั่วคราว ระบบจึงต้องบันทึกเป็นหนี้ที่ไรเดอร์ต้องนำส่ง … ไม่งั้นไรเดอร์จะเข้าใจว่าเงินในกระเป๋าคือรายได้ทั้งหมด" — without this separation, a driver would mistake platform money for personal income.

### Acceptance Criteria

- Driver earnings screen shows "รายได้วันนี้" (today's earnings) and "เงินสดที่เก็บมาแทนบ้านเฮา" (cash collected on the platform's behalf) as two distinct, separately-labeled numbers.
- The two amounts are never summed into one displayed total.

### Related Decisions

DEC-004

### Related Architecture

`docs/ARCHITECTURE.md` § Ledger Model

---

## REQ-002

```yaml
id: REQ-002
type: REQUIREMENT
status: ACCEPTED
priority: P0
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, section "03 — ORDER STATE MACHINE"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Requirement

All four client surfaces (Customer, Driver, Merchant, Admin) must read order status from one shared, backend-owned Order State Machine. No client may compute or infer its own order status locally.

### Rationale

Quoted: "ทุก client อ่านจาก state เดียวกัน แต่แสดงคนละถ้อยคำ ตารางนี้คือสัญญาระหว่างดีไซน์กับ backend — ห้ามมีหน้าจอไหนคิดสถานะขึ้นเอง" — every client reads from the same state and shows different wording; no screen may compute status on its own.

### Acceptance Criteria

- Every screen's order-status display is driven by the canonical 12-state value (see FACT-005), never a locally-derived approximation.
- Per-role wording differences (customer/driver/shop) are presentation-only, not separate state.

### Related Decisions

None directly — this is an architectural requirement stated alongside the Order State Machine documentation.

### Related Architecture

`docs/ARCHITECTURE.md` § Client / State Relationship

---

## REQ-003

```yaml
id: REQ-003
type: REQUIREMENT
status: ACCEPTED
priority: P0
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "01 — ARCHITECTURE"
confidence: HIGH
owner: PRODUCT_OWNER
```

### Requirement

Payment webhook processing must be idempotent, keyed on a single payment reference: a duplicate callback must read back the existing result, not create a new payment/ledger record.

### Rationale

Quoted: "ทุกขั้นทำแบบ idempotent ด้วย payment reference เดียว ถ้า callback ซ้ำ ระบบต้องอ่านผลเดิมไม่สร้างรายการใหม่".

### Acceptance Criteria

- Two identical webhook deliveries for the same payment reference produce exactly one Payment/Order/Ledger state transition, not two.

### Related Decisions

DEC-003

### Related Architecture

`docs/ARCHITECTURE.md` § Payment Confirmation Flow

---

## REQ-004

```yaml
id: REQ-004
type: REQUIREMENT
status: ACCEPTED
priority: P1
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, section "06 — SCALING"; design/design-system/BANHAO Design System.dc.html:34
confidence: HIGH
owner: PRODUCT_OWNER
```

### Requirement

The domain model must be built around generic entities — Merchant, Product, Order, Delivery, Driver — not food-specific naming (e.g. not "Restaurant", not "Dish").

### Rationale

Quoted: "คอมโพเนนต์ทุกตัวจึงตั้งชื่อตาม entity กลาง (Merchant, Product, Order, Delivery) ไม่ผูกกับคำว่า 'ร้านอาหาร'" — so Phases 2–4 can reuse the same model without a rewrite.

### Acceptance Criteria

- Component and (eventually) schema naming uses the entity names above, with phase-specific meaning documented per phase (see the scaling table in `docs/ARCHITECTURE.md`), not literal food-domain nouns.

### Related Decisions

DEC-005

### Related Architecture

`docs/ARCHITECTURE.md` § Core Entities
