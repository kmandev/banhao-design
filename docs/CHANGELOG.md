# Changelog (AI Memory / Documentation Log)

> This is a detailed, dated development log for AI-memory purposes. For a shorter, release-facing summary see the root [`CHANGELOG.md`](../CHANGELOG.md) — the two are complementary, not duplicates: this file tracks documentation/process work in date-entry form as agents touch the repo; the root file tracks user-facing repository milestones.

## 2026-08-10 (2) — P0 Decision Lock v1

### Added

- `docs/DECISIONS.md` — an **Index** table, plus **DEC-016 … DEC-032**: the seventeen business decisions the Product Owner approved in the Business Decision Workshop (EVENT-014). Existing DEC-001…DEC-015 untouched.
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-014, recording what was approved, what was superseded, what was deferred, and what stays open.

### Changed

- The seven business documents were rewritten against the approved decisions. Status taxonomy is now `ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`, with `ACCEPTED — MODEL · OPEN — NUMBERS` used deliberately in the money sections.
- `docs/ORDER_LIFECYCLE.md` — rewritten for DEC-019's lifecycle, with a full mapping from the superseded 2026-08-09 state machine so nothing is lost.
- `docs/RIDER_LIFECYCLE.md` — `RIDER_SEARCHING` / `RIDER_ASSIGNED` / `RIDER_REASSIGNING` accepted; broadcast → first accept accepted; cash section marked dormant.
- `docs/PAYMENT_LIFECYCLE.md`, `docs/SETTLEMENT_MODEL.md` — online-only Phase 1, idempotency/duplicate/late payment, settlement as its own domain. Cash paths retained and marked dormant.
- `docs/DOMAIN_MODEL.md` — new § 2 "The four state domains"; sections renumbered.
- `docs/OPEN_BUSINESS_QUESTIONS.md` — answered questions marked `ACCEPTED` with their `DEC-NNN`; COD-dependent questions marked `DEFERRED`; P0 count 15 → 8.
- `ai/KNOWLEDGE/FACTS.md` — provenance notes on FACT-005 and FACT-006 (still VERIFIED as statements about the 2026-08-09 design artifact, no longer canonical).
- `ai/KNOWLEDGE/CONSTRAINTS.md` — CON-001 cross-referenced to DEC-018's four-domain extension. `ai/KNOWLEDGE/REQUIREMENTS.md` — REQ-001 marked dormant under DEC-016, **not deleted**.
- `ai/MEMORY.md`, `ai/HANDOFF.md`, `CLAUDE.md`, `docs/CURRENT_STATUS.md`, `docs/TODO.md` — updated for the lock.

### Not done, deliberately

No production code, no migration, no API, no payment provider, no Merchant/Rider/Admin app. No `Q-NNN` resolved. No pricing set. Two known code divergences (Customer App order states and the cash checkout option) were left in place and recorded as follow-up work.

## 2026-08-10

### Added

- `docs/BUSINESS_RULES.md`, `docs/DOMAIN_MODEL.md`, `docs/ORDER_LIFECYCLE.md`, `docs/RIDER_LIFECYCLE.md`, `docs/PAYMENT_LIFECYCLE.md`, `docs/SETTLEMENT_MODEL.md`, `docs/OPEN_BUSINESS_QUESTIONS.md` — the Step 4 business-rules and domain-modelling pass (EVENT-013). Every rule tagged `DOCUMENTED` / `PROPOSED` / `OPEN`; 39 new business questions (BQ-001…BQ-039), 15 of them P0. **No production code, no migration, no payment provider.**
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-013, including the six contradictions found inside accepted documents.

### Changed

- `docs/TODO.md` — the P0 entries "decide backend technology stack" and "decide database technology" were stale since 2026-08-09 (resolved by DEC-011 and DEC-010); marked resolved with their decision references rather than deleted. Added a pointer separating business questions (`Q-NNN` / `BQ-NNN`) from engineering tasks.
- `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md` — DQ-01…DQ-05 now cross-reference `OPEN_BUSINESS_QUESTIONS.md`. None was closed; that is a Product Owner action.
- `ai/KNOWLEDGE/QUESTIONS.md`, `ai/MEMORY.md`, `ai/HANDOFF.md`, `CLAUDE.md`, `docs/CURRENT_STATUS.md` — updated for EVENT-013.

## 2026-08-09

### Added

- `docs/AI_CONTEXT.md` — master AI-memory file (project identity, vision, phase, tech stack status, architecture summary, business/technical rules, agent instructions).
- `docs/PROJECT_HISTORY.md` — Known / Reconstructed / Unknown history timeline sourced from `git log`.
- `docs/ARCHITECTURE.md` — documented order state machine (12 states), payment state machine (12 states), webhook confirmation flow, ledger model, core entities; all other layers (backend, DB, API, auth, hosting) marked UNKNOWN / NOT VERIFIED.
- `docs/DECISIONS.md` — DEC-001 through DEC-007, each with a file/section citation back to the source design canvas or git commit.
- `docs/ROADMAP.md` — Phase 1 completed/in-progress/remaining; Phases 2–4 marked TBD.
- `docs/CURRENT_STATUS.md` — per-surface (customer/driver/merchant/admin/payment/API/DB/deployment) implementation status, explicitly distinct from design status.
- `docs/TODO.md` — P0–P3 items, technical debt, documentation debt, and product-decision questions, each with a source citation.
- `docs/CHANGELOG.md` — this file.
- `ai/README.md` — AI operating protocol (before/during/after work checklist).
- `ai/SESSION_LOG/2026-08-09.md` — this session's record.
- `ai/PROMPTS/AI_AUDIT.md` — reusable audit prompt for a future AI to review the whole system.

### Changed

- `design/customer/README.md` — corrected screen count from 17 to 18 (verified against the actual screen list in `BANHAO Customer App.dc.html`; the account settings screen, "18 บัญชีของฉัน", had been missed in the original count written during the 2026-08-09 reorg).

### Fixed

- Screen-count discrepancy noted above.

### Documentation

- This entire changelog entry — the AI project memory system itself.

### Notes

- No source code, business logic, architecture, database schema, features, or dependencies were changed in this session, per the task scope (documentation/project-memory only).
- No secrets, credentials, or tokens were added anywhere in this session's files.
