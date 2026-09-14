# Q-012 / TQ-016 / BQ-022 — Owner Decision Pack: Rider GPS Ground Truth

```
DECISION PREPARATION MATERIAL
NO DECISION IS LOCKED BY THIS DOCUMENT · NO DECISION NUMBER IS ASSIGNED
STAGE 2 (RIDER GPS + FEEDBACK COLLECTION) IS NOT AUTHORIZED
```

Written 2026-09-14 against HEAD `4d386316` on `feature/g7-driver-availability`.
Companion to [`Q-012-RIDER-GPS-COUNSEL-BRIEF.md`](Q-012-RIDER-GPS-COUNSEL-BRIEF.md),
whose section and question numbers are cited below.

**Nothing here modifies DEC-037, DEC-054, DEC-061, DEC-062 or DEC-063. Each
remains locked and authoritative.** Q-012, TQ-016, BQ-022, D-16, D-17 and
TQ-007 keep their current statuses.

---

## 0. How to read this pack

`RG-*` identifiers are **preparation labels, not decisions**. Status values:

| Status | Meaning |
|---|---|
| `OPEN — OWNER ACTION` | The owner can act now |
| `OWNER INTENT — NOT LOCKED` | Stated intention; to be confirmed or adjusted after counsel |
| `WAITING FOR COUNSEL` | Cannot be decided until counsel answers |
| `OWNER DECISION + LEGAL REVIEW REQUIRED` | Owner design choice that counsel must review |
| `OPEN — OWNER DECISION` | Undecided; not dependent only on counsel |

Per repository convention, the answered set would later be locked by a separate
owner decision entry — as DEC-062 locked OD-1…OD-8. **This pack creates no
decision number.**

**BANHAO is pre-launch.** No real rider data has been collected, no rider GPS
trace exists, and `banhao-dev` holds development/test data only.

---

## 1. Decision table

| ID | Decision | Target / intent | Status | Owner | Depends on | Blocks Stage 2? |
|---|---|---|---|---|---|---|
| **RG-1** | Commission Thai counsel for a scoped PDPA + worker-classification review | Hand over the Counsel Brief | `OPEN — OWNER ACTION` | PRODUCT_OWNER | — | **Yes** |
| **RG-2** | Tracking window, including the trace-stop rule | Start at `picked_up_at`; intended end `arrived_at`. **Stop rule not locked** — arrival confirmation is currently optional (Brief §3.2) | `OWNER INTENT — NOT LOCKED` (window) · `OPEN — OWNER DECISION` + technical decision (stop rule) | PRODUCT_OWNER + engineering | Counsel Q1, Q2, Q11, Q12; DEC-054 anchor exists | **Yes** |
| **RG-3** | Purpose limitation | Routing ground truth, routing-provider evaluation and routing intelligence only. Prohibit **all nine uses in Brief §6**: performance scoring; productivity scoring; discipline; route-deviation penalties; dispatch ranking; automated suspension; worker surveillance / behavioural analytics; continuous monitoring; individual rider pay. "Address and pin quality" = aggregate analysis only; individual customer address/pin changes excluded unless separately decided | `OWNER INTENT — NOT LOCKED` | PRODUCT_OWNER | Counsel Q5 | **Yes** |
| **RG-4** | Rider participation / refusal model | — | `WAITING FOR COUNSEL` | PRODUCT_OWNER + LEGAL | Q13, Q14, Q16 | **Yes** |
| **RG-5** | Raw trace retention, including backups | Minimum; no period chosen | `WAITING FOR COUNSEL` | PRODUCT_OWNER + LEGAL | Q17, Q19; TQ-007 (`OPEN`) | **Yes** |
| **RG-6** | Access control — rider, operations/admin, engineering, analytics | Minimum | `WAITING FOR COUNSEL` | PRODUCT_OWNER + LEGAL | Deliverable 6; D-3 | **Yes** |
| **RG-7** | Rider operational feedback design | Closed codes, minimal data, no free text by default, prompted only after arrival; optional vs mandatory undecided | `OWNER DECISION + LEGAL REVIEW REQUIRED` | PRODUCT_OWNER + LEGAL | D-1, Q15, Q21 | **Yes**, if feedback ships with Stage 2 |
| **RG-8** | Rider and customer notice | — | `WAITING FOR COUNSEL` | PRODUCT_OWNER + LEGAL | Q6, Q7, Q24, D-1 | **Yes** |
| **RG-9** | Derived benchmark-data retention and pseudonymisation | Prefer scalar and aggregated data; technique not selected (Brief §11–§12). Pseudonymisation is not treated as anonymisation | `WAITING FOR COUNSEL` | PRODUCT_OWNER + LEGAL | Q18, Q20, Q21, D-2, D-3 | **No** for collection · **Yes** for Stage 3 |
| **RG-10A** | Per-delivery / per-rider pay input | Ground-truth GPS must not directly determine an individual rider's pay for a delivery or any rider-specific compensation | `OWNER INTENT — NOT LOCKED` | PRODUCT_OWNER | D-17 (`OPEN`) | **Yes** — the prohibition must be recorded before Stage 2 |
| **RG-10B** | Aggregate economic calibration | May aggregated, non-rider-specific ground-truth evidence be used to calibrate or validate DEC-061 rider compensation parameters such as D-07/D-08? | `OPEN — OWNER DECISION` | PRODUCT_OWNER | Counsel Q5(a); D-17 (`OPEN`) | **No** for collection · **Yes** before any economic use |

**D-17 remains `OPEN`.** Neither RG-10A nor RG-10B resolves it.

---

## 2. Implementation gate

Stage 2 requires every step, in order:

```text
LEGAL REVIEW                         ← RG-1; counsel answers Q1–Q24, D-1–D-3
  → OWNER DECISION LOCK              ← RG-2…RG-10A locked in a new decision entry
  → IMPLEMENTATION AUTHORIZATION     ← separate, per DEC-063
  → EXPLICIT MIGRATION AUTHORIZATION ← separate, per CLAUDE.md §10
  → IMPLEMENTATION
```

No step is satisfied today. Stage 3 additionally needs RG-9 and the
quality-control thresholds (`OPEN — FUTURE DECISION`, DEC-063). Stage 4
additionally needs the data-sufficiency threshold (`OPEN — FUTURE DECISION`)
and, for any economic use, RG-10B.

---

## 3. What can be done now, and what must wait

| Can act now | Record as intent now, lock after counsel | Must wait for counsel |
|---|---|---|
| RG-1 | RG-2 (window), RG-3, RG-10A | RG-4, RG-5, RG-6, RG-8, RG-9 · legal half of RG-7 |

The trace-stop rule (RG-2) and RG-10B are owner/technical decisions that
counsel's answers will inform but not settle.

---

## 4. Related gate status (unchanged by this pack)

| Gate | Status |
|---|---|
| Q-012 — PDPA lawful basis and retention | `OPEN` · `LEGAL_REVIEW_REQUIRED` (proof-photo retention duration only closed by DEC-039) |
| TQ-016 — rider location retention and access | `OPEN` |
| BQ-022 — onboarding, approval, contractor status | Working area resolved (DEC-037); remainder `OPEN` · `LEGAL_REVIEW_REQUIRED` |
| TQ-007 — backup/restore retention | `OPEN` |
| DEC-063 | `ACCEPTED — METHODOLOGY · NOT AN IMPLEMENTATION AUTHORIZATION`; supersedes DEC-062 OD-3 only |
| DEC-062 OD-6 — real delivery GPS | `NOT AUTHORIZED` |
| D-16 — distance provider/source | `OPEN` |
| D-17 — distance accuracy policy | `OPEN` |
| DEC-037 — one active delivery per rider (resolves BQ-021) | `ACCEPTED` — one trace maps to one order; batching would need a superseding decision |
| DEC-054 — `arrived_at` | `ACCEPTED` — arrival confirmation currently optional at completion |
| DEC-061 — rider compensation D-05…D-08 | `LOCKED — ECONOMIC POLICY` · runtime not implemented |

---

## 5. Recommendation

BANHAO should not implement Rider GPS tracking until the scoped legal review is
completed and the Owner has explicitly approved the resulting lawful-basis,
retention, access, notice and participation decisions.
