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

**Candidates:** None documented in repository.

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
status: OPEN
priority: P0
date: 2026-08-09
source: docs/TODO.md P0; docs/AI_CONTEXT.md § Technology Stack
```

**Question:** What backend technology stack (language, framework, hosting) will BANHAO use?

**Why it matters:** No implementation of any kind can begin until this is decided. This task's scope explicitly excludes making this choice (see `docs/DECISIONS.md` — no such decision has been recorded).

**Blocking:** All implementation work.

**Candidates:** None documented in repository.

**Decision:** TBD

---

## Q-007

```yaml
id: Q-007
type: OPEN_QUESTION
status: OPEN
priority: P0
date: 2026-08-09
source: docs/TODO.md P0; docs/AI_CONTEXT.md § Technology Stack
```

**Question:** What database technology will BANHAO use?

**Why it matters:** The Order and Payment state machines are fully specified at the product level and ready to become a schema once this is decided.

**Blocking:** All implementation work.

**Candidates:** None documented in repository.

**Decision:** TBD

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
