# Assumptions

Things believed likely true but **not verified** by direct evidence. Do not treat anything in this file as a FACT or DECISION. If evidence later confirms or denies an assumption, move/update it accordingly and record the evidence.

---

### ASM-001

```yaml
id: ASM-001
type: ASSUMPTION
status: UNVERIFIED
date: 2026-08-09
source: docs/05-architecture/BANHAO Product Architecture.dc.html, sitemap data (see FACT-008)
confidence: MEDIUM
owner: PROJECT
```

It is assumed the Driver App will eventually be built in Flutter, since that is the only platform intention documented anywhere in the repository. No confirmed technical decision exists (see DEC-006, Q-006).

---

### ASM-002

```yaml
id: ASM-002
type: ASSUMPTION
status: UNVERIFIED
date: 2026-08-09
source: every design canvas header references "เงินสด + พร้อมเพย์ QR" (cash + PromptPay QR)
confidence: MEDIUM
owner: PROJECT
```

It is assumed PromptPay QR will be the Phase 1 digital payment method, based on it being named consistently across all design documents. No payment provider has actually been selected or contracted (see Q-001).

---

### ASM-003

```yaml
id: ASM-003
type: ASSUMPTION
status: UNVERIFIED
date: 2026-08-09
source: assets/screenshots/ (two annotated PNGs)
confidence: LOW
owner: PROJECT
```

It is assumed the two screenshots in `assets/screenshots/` reflect genuine internal design-review feedback (based on their hand-drawn red-circle annotations), rather than placeholder or test uploads. Nothing in the repository confirms who made the annotations or when.
