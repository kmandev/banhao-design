# Facts

Verified, evidence-backed facts about the BANHAO project. This is a structured **index** — each entry is a short, sourced claim with a pointer to the canonical document. It does not duplicate the full content of those documents; read the source for detail.

Do not add an entry here without a real source. Do not upgrade an `ai/KNOWLEDGE/ASSUMPTIONS.md` entry to a FACT without new evidence (see `docs/AI_CONTEXT.md` confidence rules).

---

### FACT-001

```yaml
id: FACT-001
type: FACT
status: VERIFIED
date: 2026-08-09
source: docs/AI_CONTEXT.md, root README.md
confidence: HIGH
owner: PROJECT
```

BANHAO | บ้านเฮา is a Local Super App, launching in อำเภอบุณฑริก จังหวัดอุบลราชธานี ประเทศไทย, with Phase 1 scoped to Food Delivery.

---

### FACT-002

```yaml
id: FACT-002
type: FACT
status: VERIFIED
date: 2026-08-09
source: root README.md; docs/05-architecture/BANHAO Product Architecture.dc.html, section "06 — SCALING"
confidence: HIGH
owner: PROJECT
```

Future phases, in order, are: Phase 2 Parcel Delivery, Phase 3 Ride, Phase 4 Shopping. No timeline exists for any of them (see Q-005).

---

### FACT-003

```yaml
id: FACT-003
type: FACT
status: VERIFIED
date: 2026-08-09
source: full-repository file search, this session
confidence: HIGH
owner: PROJECT
```

No application source code exists in this repository: no package manifests, backend/frontend framework files, database schema, API code, Dockerfile, CI config, or `.env` files were found anywhere. Full detail: `docs/CURRENT_STATUS.md`.

---

### FACT-004

```yaml
id: FACT-004
type: FACT
status: VERIFIED
date: 2026-08-09
source: design/customer/
confidence: HIGH
owner: PROJECT
```

The Customer App has a complete Phase 1 UI design: 18 interactive screens in `design/customer/BANHAO Customer App.dc.html`, covering splash through account settings, including PromptPay QR checkout.

---

### FACT-005

```yaml
id: FACT-005
type: FACT
status: VERIFIED
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, section "03 — ORDER STATE MACHINE"
confidence: HIGH
owner: PROJECT
```

The documented Order State Machine has 12 states: `NEW, ACCEPTED, PREPARING, READY, DRIVER_ASSIGNED, PICKED_UP, DELIVERING, COMPLETED, NO_DRIVER, PAYMENT_FAILED, REJECTED, CANCELLED`. Full table: `docs/ARCHITECTURE.md`.

---

### FACT-006

```yaml
id: FACT-006
type: FACT
status: VERIFIED
date: 2026-08-09
source: docs/04-payment/BANHAO Payment Architecture.dc.html, section "02 — STATE MACHINE"
confidence: HIGH
owner: PROJECT
```

The documented Payment State Machine has 12 states: `CREATED, PENDING, PROCESSING, SUCCESS, FAILED, EXPIRED, CANCELLED, REFUND_PENDING, REFUND_PROCESSING, REFUNDED, CASH_PENDING, CASH_COLLECTED` — modeled separately from Order State (see CON-001). Full table: `docs/ARCHITECTURE.md`.

---

### FACT-007

```yaml
id: FACT-007
type: FACT
status: VERIFIED
date: 2026-08-09
source: git log --oneline --all
confidence: HIGH
owner: PROJECT
```

Repository git history (as of this session) has 3 commits: `7d0a7d5` "add design" (initial design drop), `f3939d6` "create structure project files" (docs/design/assets/specs/archive reorg + AI Memory System v1 groundwork), `7b2d5f7` "add ai rule" (AI Memory System v1: `docs/AI_CONTEXT.md` and siblings, `ai/README.md`, `ai/SESSION_LOG/`, `ai/PROMPTS/AI_AUDIT.md`).

---

### FACT-008

```yaml
id: FACT-008
type: FACT
status: VERIFIED
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, sitemap data
confidence: MEDIUM
owner: PROJECT
```

Driver App platform is documented as "Mobile · Flutter"; Merchant Web and Admin Web are documented as "Desktop first" with no framework named. This is a **documented design intention**, not a confirmed technical decision — no rationale or sign-off is recorded (see DEC-006). Confidence is MEDIUM because the claim ("Flutter is the intended platform") is directly evidenced, but whether it is still current or binding is not.

---

### FACT-009

```yaml
id: FACT-009
type: FACT
status: UNVERIFIED
date: 2026-08-09
source: design/.thumbnail (file present, unreferenced)
confidence: LOW
owner: PROJECT
```

`design/.thumbnail` exists but is not referenced by filename anywhere else in the repository; its purpose and owner are unverified. See Q-008 if a decision is ever needed on it, or `docs/TODO.md` P3.

---

### FACT-010

```yaml
id: FACT-010
type: FACT
status: VERIFIED
date: 2026-08-09
source: design/customer/support.js, design/design-system/support.js, docs/04-payment/support.js, docs/05-architecture/support.js
confidence: HIGH
owner: PROJECT
```

`support.js` (the `.dc.html` canvas runtime) is intentionally duplicated 4× across the repository, all checksum-identical, to keep each `.dc.html` file's relative `./support.js` reference valid without editing file content. See `docs/CHANGELOG.md` and `docs/TODO.md` (Technical Debt).
