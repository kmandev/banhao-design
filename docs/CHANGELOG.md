# Changelog (AI Memory / Documentation Log)

> This is a detailed, dated development log for AI-memory purposes. For a shorter, release-facing summary see the root [`CHANGELOG.md`](../CHANGELOG.md) — the two are complementary, not duplicates: this file tracks documentation/process work in date-entry form as agents touch the repo; the root file tracks user-facing repository milestones.

## 2026-08-11 (4) — Supabase Migration v1

### Added

- `supabase/migrations/20260811000001`–`20260811000011` — 11 new migrations implementing `docs/DATABASE_DESIGN.md` under DEC-033/DEC-034. 40 application tables, 62 foreign keys, 61 check constraints, 110 indexes, 55 RLS policies, 52 triggers. The three original migrations (`20260809*`) are untouched, byte-identical.
- `supabase/tests/domain_invariants_test.sql`, `rider_race_setup.sql`, `rider_race_assertions.sql`, `run-domain-tests.sh` — a second Docker-based test suite (plain PostgreSQL 16 + PostGIS, extending the existing `run-rls-tests.sh` pattern) covering identity, cart enforcement, order snapshots, payment/webhook idempotency, ledger append-only behaviour, representative RLS access, and — critically — the rider race condition, proven with two genuinely concurrent `psql` client processes.
- `docs/DATABASE_MIGRATION_V1_REPORT.md` — full verification report: schema counts, deferred-table justifications, documentation gaps found and resolved, and the 60/60 test results.
- `docs/OPEN_DATABASE_QUESTIONS.md` — **DBQ-015** added (column-scoped rider view for orders, deferred as a refinement — the row-level security boundary is already enforced and proven).
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-018.

### Changed

- `docs/OPEN_DATABASE_QUESTIONS.md` — DBQ-015 cross-referenced from the migration report.
- `ai/MEMORY.md`, `ai/HANDOFF.md`, `docs/CURRENT_STATUS.md`, `CLAUDE.md` — updated for EVENT-018. `CLAUDE.md` was also brought up to date for EVENT-017 (DEC-033/034), which an earlier pass had missed.

### Not done, deliberately

**The live/remote Supabase project (`banhao-dev`) was never touched** — no `supabase db push`, no `supabase link` to a project, no SQL executed against anything but a throwaway local Docker container. Six tables deferred (`settlements`, `settlement_items`, `delivery_fee_bands`, `zones`, `service_areas`, `delivery_attempts`), each individually justified, none removed from `docs/DATABASE_DESIGN.md`. No backend code, no payment provider integration. No business decision created, changed or reversed; no `Q`, `BQ`, `TQ` or `DEC` closed by this work.

## 2026-08-11 (3) — Database decision lock

### Added

- `docs/DECISIONS.md` — **DEC-033** (multi-role identity via domain membership) and **DEC-034** (Phase 1 financial integrity without a zero-sum trigger), both `ACCEPTED`, plus a **numbering note**: the approval labelled them "DEC-014"/"DEC-015", but those IDs were already taken by two decisions cited in 17 and 21 files including live code comments, so the next free IDs were used.
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-017.
- `docs/TODO.md` — retire `profiles.role` in favour of domain membership (P1; the blocker is the `RolesGuard` code change, not the schema).

### Changed

- `docs/DATABASE_DESIGN.md` — § 4.2 rewritten for DEC-033 (`user_roles` removed, `platform_staff` added, `profiles.role` deprecated); § 10 rewritten for DEC-034 (no trigger; transaction assertion + mandatory reconciliation); RLS matrix now resolves every actor through a membership lookup; migration order and FK table updated. Header carries the approved/not-started guardrail.
- `docs/TECHNICAL_ARCHITECTURE.md` — new § 13.1a (authorization is a domain relationship); § 10.2 rule 4 cites DEC-034.
- `docs/OPEN_DATABASE_QUESTIONS.md` — **DBQ-002 and DBQ-010 closed** as `ANSWERED`, original analysis preserved. 12 of 14 remain open.
- `ai/MEMORY.md`, `ai/HANDOFF.md`, `docs/CURRENT_STATUS.md` — updated, with two new "do not" rules: no RLS policy referencing `profiles.role`, and no zero-sum database trigger.

### Not done, deliberately

No migration, no SQL, no Supabase change, no backend code. **No business decision created, changed or reversed.** Only the two questions genuinely answered by DEC-033/DEC-034 were closed; no `Q`, `BQ` or `TQ` was touched.

## 2026-08-11 (2) — Supabase Database Design v1

### Added

- `docs/DATABASE_DESIGN.md` — 46 tables across 13 domains, Mermaid ERD, per-table catalog (purpose / PK / columns / FKs / indexes / RLS / mutability), RLS matrix, state-owner matrix, FK cascade rules, justified indexes, delete and immutability strategy, and a dependency-safe migration order.
- `docs/OPEN_DATABASE_QUESTIONS.md` — **DBQ-001…DBQ-014**, priorities D0/D1/D2, several gated on a `Q` or `BQ`.
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-016.

### Changed

- `ai/MEMORY.md`, `ai/HANDOFF.md`, `CLAUDE.md`, `docs/CURRENT_STATUS.md` — updated for EVENT-016, with two new "do not" rules: no migration before DBQ-002/DBQ-010/TQ-011/TQ-012, and every new table needs `revoke ... from anon, authenticated` first.

### Not done, deliberately

**No migration, no SQL executed, no live Supabase change.** No table, index, RLS policy, trigger or function was created. No business decision created, changed or reversed; no `Q`, `BQ`, `TQ` or `DEC` closed. Promotions, cash tables, rider location history and support tickets were deliberately not designed because the business or legal question behind each is still `OPEN`.

## 2026-08-11 — Technical Architecture v1

### Added

- `docs/TECHNICAL_ARCHITECTURE.md` — 22 sections covering component architecture, domain boundaries, data ownership, API boundaries, payment/delivery architecture, concurrency, idempotency, security, auditability, notifications, background jobs, operator operations, layer responsibilities, AI maintainability, scaling and open decisions.
- `docs/ARCHITECTURE_DECISIONS.md` — **ADR-001…ADR-012, all `PROPOSED`**. A separate namespace from `DEC-NNN`, with an explicit precedence rule: a `DEC` beats an `ADR`. Product/stack decisions already recorded (DEC-009/010/011/013/014/015/018/020/028/030) are listed as inherited constraints rather than duplicated as ADRs.
- `docs/OPEN_TECHNICAL_QUESTIONS.md` — **TQ-001…TQ-016**, priorities T0/T1/T2, several gated on a `Q-NNN`.
- `ai/KNOWLEDGE/EVENTS.md` — EVENT-015.

### Changed

- `ai/MEMORY.md`, `ai/HANDOFF.md`, `CLAUDE.md`, `docs/CURRENT_STATUS.md` — updated for EVENT-015, including new "do not" rules: never `SELECT`-then-check-then-`UPDATE` a guarded table, and never add a client write grant on a domain table.

### Not done, deliberately

No backend implementation, no SQL or Supabase migration, no table/index/RLS policy/trigger/function, no payment provider integration, no Merchant/Rider/Admin app. **No business decision created, changed or reversed; no `Q-NNN`, `BQ-NNN` or `DEC-NNN` closed.** No price, rate, provider or legal structure decided.

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
