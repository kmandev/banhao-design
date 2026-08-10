# BANHAO AI Memory

Index into the project's knowledge. This file stays short on purpose — it points to the source document for everything instead of repeating it. If you're new to this repository, read this after `ai/HANDOFF.md` (see `ai/README.md` for the full context-loading protocol).

## Project Identity

BANHAO | บ้านเฮา — a Local Super App launching in อำเภอบุณฑริก จังหวัดอุบลราชธานี ประเทศไทย, starting with Phase 1 Food Delivery. Full detail: [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md).

## Current Reality

**Foundation, the Customer App, and its Supabase authentication are all merged to `main`** (reviewed and approved by the Product Owner, 2026-08-10, merge commit `c4927b25`). All 31 design states (18 numbered screens + 7 payment sub-states + 6 state variants) are implemented and verified by screenshot, with design tokens, shared RN components, 4-tab navigation, and Supabase auth + profile. Everything except auth and `profiles` is mock-backed — no order, payment, dispatch, or settlement logic exists. Full detail: [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md) and [`docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md`](../docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md).

The live dev Supabase project (`banhao-dev`) is what the merged app authenticates against — real OTP sign-in and resend, session persistence, profile read/write under RLS, logout — with **31 / 31 states verified by screenshot** and **14 / 14 live RLS checks passing**. The five defects found in QA (DEF-01…DEF-05) are **all fixed and re-verified**. Setup and the Simulator HTTP/3 caveat: [`docs/SUPABASE_DEVELOPMENT.md`](../docs/SUPABASE_DEVELOPMENT.md); QA record: [`docs/CUSTOMER_APP_VISUAL_QA.md`](../docs/CUSTOMER_APP_VISUAL_QA.md). **Android remains UNVERIFIED.** New work should branch from `main`.

## Permanent Facts

10 verified facts, indexed FACT-001 through FACT-010. Full list with evidence: [`ai/KNOWLEDGE/FACTS.md`](KNOWLEDGE/FACTS.md).

## Critical Decisions

**32 decisions logged, DEC-001 through DEC-032, all `ACCEPTED`** — DEC-016…DEC-032 were approved by the Product Owner on 2026-08-10 (EVENT-014): online-payment-only with COD disabled but extensible (DEC-016), one cart = one restaurant (DEC-017), four separate state domains (DEC-018), the approved Order lifecycle with `PREPARING` ∥ `RIDER_SEARCHING` (DEC-019), broadcast dispatch from `MERCHANT_ACCEPTED` (DEC-020), rider cancellation never cancels the order (DEC-021), no-rider escalates to an operator (DEC-022), the three fee **models** with numbers still open (DEC-023/024/025), settlement as its own domain (DEC-026), refund in the payment domain (DEC-027), idempotency (DEC-028), late payment (DEC-029), duplicate payment (DEC-030), manual operations as an intentional capability (DEC-031), operator fallback (DEC-032). Product rules: Order and Payment State separate (DEC-002), webhook-only confirmation (DEC-003), driver cash is a liability (DEC-004). Stack (2026-08-09): modular monolith (DEC-009), Supabase (DEC-010), NestJS (DEC-011), Expo + Next.js (DEC-012, supersedes DEC-006), monorepo (DEC-013), PostgreSQL as financial system of record (DEC-014), payment abstraction only (DEC-015). Full list: [`docs/DECISIONS.md`](../docs/DECISIONS.md).

## Critical Constraints

5 constraints logged, CON-001 through CON-005 — none may be violated without a human decision. Full list: [`ai/KNOWLEDGE/CONSTRAINTS.md`](KNOWLEDGE/CONSTRAINTS.md). Binding agent rules (secrets, credentials, etc.): [`AGENTS.md`](../AGENTS.md).

## Active Requirements

4 requirements logged, REQ-001 through REQ-004. Full list: [`ai/KNOWLEDGE/REQUIREMENTS.md`](KNOWLEDGE/REQUIREMENTS.md).

## Open Questions

18 open of 20 logged. **Q-006 and Q-007 are RESOLVED** (DEC-011 NestJS, DEC-010 Supabase). Still blocking payment work: **Q-002** (legal/settlement model), **Q-020** (🚨 PromptPay refund mechanism — no provider supports native refunds), **Q-001** (payment provider — `OPEN` by design, see DEC-015), **Q-010** (platform fee). Full list: [`ai/KNOWLEDGE/QUESTIONS.md`](KNOWLEDGE/QUESTIONS.md).

Plus **39 business questions BQ-001…BQ-039** in [`docs/OPEN_BUSINESS_QUESTIONS.md`](../docs/OPEN_BUSINESS_QUESTIONS.md) — a separate namespace that cross-references the `Q-NNN` list rather than duplicating it. **The 2026-08-10 lock (EVENT-014) cut the P0 set from 15 to 8**: BQ-010, BQ-012, BQ-014, BQ-019 and BQ-025 are answered, BQ-026/027/028 are answered in **model but not in numbers**, and BQ-023 is **deferred with COD, not answered**. Still P0: Q-001, Q-002, Q-010/BQ-028 (rate), Q-020, BQ-015, BQ-026, BQ-027, BQ-030. **No `Q-NNN` was resolved.**

## Active Tasks

P0/P1 items only (full list in [`docs/TODO.md`](../docs/TODO.md)):

- **Answer the remaining 8 P0 business questions in `docs/OPEN_BUSINESS_QUESTIONS.md` (P0)** — every one is a number, a provider, or a legal question; they still block Order, Payment and Settlement implementation
- Close DQ-01…DQ-05 (P1) — all five are addressed. **DQ-01 is now moot** (DEC-016 disables COD; the cash checkout UI must be *disabled*, not designed); DQ-02 is formalised by DEC-030; DQ-03 is blocked on Q-020 and BQ-031; DQ-04/DQ-05 are superseded by BQ items
- Verify the app on Android — per-weight font families are untested there (P1)
- **Commission Thai legal/compliance review (P0)** — has external lead time; gates all payment work
- Decide PromptPay refund mechanism (P0) — contradicts documented design
- Decide payment provider/settlement model (P0)
- Decide platform fee percentage/formula (P0) — ledger cannot balance without it
- Design Driver/Merchant/Admin apps past wireframe stage (P1)
- Field-test map coverage in Buntharik (P1) — cannot be done remotely

## Technology Research

Complete as of 2026-08-09 — 27 documents in [`ai/RESEARCH/`](RESEARCH/). Start with [`EXECUTIVE_SUMMARY.md`](RESEARCH/EXECUTIVE_SUMMARY.md); decisions get recorded in [`HUMAN_DECISION_SHEET.md`](RESEARCH/HUMAN_DECISION_SHEET.md). **All contents are recommendations, not decisions** — every price/capability was checked 2026-08-09 and will age.

## Recent Events

15 events logged, EVENT-001 through EVENT-015 (design drop → repo reorg → Memory v1 → Memory v2 → architecture research → application foundation → pre-merge review fixes → Customer App implementation → final QA / typography → Supabase dev environment and live auth verification → DEF-01…DEF-05 fixed → merge to `main` → Business Rules & Domain Modelling → P0 Business Decisions v1 approved → **Technical Architecture v1**). Full list: [`ai/KNOWLEDGE/EVENTS.md`](KNOWLEDGE/EVENTS.md).

## Business Rules

The business layer is documented, and **its P0 decisions are now approved** (EVENT-014, DEC-016…DEC-032): [`docs/BUSINESS_RULES.md`](../docs/BUSINESS_RULES.md), [`docs/DOMAIN_MODEL.md`](../docs/DOMAIN_MODEL.md), [`docs/ORDER_LIFECYCLE.md`](../docs/ORDER_LIFECYCLE.md), [`docs/RIDER_LIFECYCLE.md`](../docs/RIDER_LIFECYCLE.md), [`docs/PAYMENT_LIFECYCLE.md`](../docs/PAYMENT_LIFECYCLE.md), [`docs/SETTLEMENT_MODEL.md`](../docs/SETTLEMENT_MODEL.md). Every rule is tagged `ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`, with `ACCEPTED — MODEL · OPEN — NUMBERS` used deliberately in the money sections. **Only `ACCEPTED` may be built on.** The two worst contradictions found in EVENT-013 are now resolved by DEC-019 and DEC-022. **Every price, rate and fee remains `OPEN`**, and no payment provider is selected.

## Technical Architecture

**Designed, not built** (EVENT-015, 2026-08-11): [`docs/TECHNICAL_ARCHITECTURE.md`](../docs/TECHNICAL_ARCHITECTURE.md) · [`docs/ARCHITECTURE_DECISIONS.md`](../docs/ARCHITECTURE_DECISIONS.md) (**ADR-001…ADR-012, all `PROPOSED`**) · [`docs/OPEN_TECHNICAL_QUESTIONS.md`](../docs/OPEN_TECHNICAL_QUESTIONS.md) (**TQ-001…TQ-016**).

The spine: **NestJS writes, clients read, Postgres decides.** Domain tables grant no `INSERT`/`UPDATE`/`DELETE` to `authenticated`; every mutation goes through NestJS on the service-role client inside a transaction, guarded by the owning module's state machine. RLS is defence in depth, not the authorization system.

Concurrency is a **guarded conditional UPDATE** — the state check lives in the `WHERE` clause, branch on rows-affected. **Never `SELECT`-then-check-then-`UPDATE`**; that is check-then-act and two riders both pass the check. Money is `bigint` satang with the rounding residual allocated by subtraction, so CON-003 holds by construction.

**A `DEC-` beats an `ADR-`.** ADRs are technical and subordinate; if they appear to conflict, the business decision wins and the ADR is a bug.

## Important Architecture Rules

- **Order, Payment, Delivery and Settlement are four separate state domains — never one enum (DEC-018, extending CON-001).** The canonical Order lifecycle is DEC-019's, not the design canvas's 12 states (see `docs/ORDER_LIFECYCLE.md` § 1 for the mapping).
- Payment success/refund can only be set by a verified provider webhook, never client state (CON-002).
- Every order's ledger must balance to exactly zero (CON-003).
- All client surfaces read order status from one shared backend state — no local computation (REQ-002).
- Domain model uses generic entities (Merchant, Product, Order, Delivery, Driver) to support future phases (REQ-004).

Full architecture (state tables, diagrams): [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — **note its Order State Machine is superseded by DEC-019**; build from [`docs/ORDER_LIFECYCLE.md`](../docs/ORDER_LIFECYCLE.md) and [`docs/TECHNICAL_ARCHITECTURE.md`](../docs/TECHNICAL_ARCHITECTURE.md). Cross-reference index: [`ai/KNOWLEDGE/ARCHITECTURE.md`](KNOWLEDGE/ARCHITECTURE.md).

## Memory Sources

| Layer | Location | Purpose |
|---|---|---|
| Fast context | `ai/HANDOFF.md`, `ai/MEMORY.md` (this file), `docs/AI_CONTEXT.md` | Read first, every session |
| Task context | `docs/CURRENT_STATUS.md`, `docs/DECISIONS.md`, `docs/TODO.md`, `docs/ROADMAP.md` | Read before working on something specific |
| Business truth | `docs/BUSINESS_RULES.md` + the six companion docs | **Before any domain work.** Only `ACCEPTED` may be built on |
| Technical truth | `docs/TECHNICAL_ARCHITECTURE.md`, `docs/ARCHITECTURE_DECISIONS.md`, `docs/OPEN_TECHNICAL_QUESTIONS.md` | **Before writing backend code** |
| Structured knowledge | `ai/KNOWLEDGE/*.md` | Typed, ID'd, cross-referenceable facts/requirements/constraints/etc. |
| Historical context | `docs/PROJECT_HISTORY.md`, `ai/SESSION_LOG/`, `ai/CONVERSATIONS/` | Read when you need "why" or "when" |
| Canonical design | `design/`, `specs/` | The actual product design, not a summary of it |
| Application code | `apps/`, `packages/`, `supabase/` | See `docs/DEVELOPMENT.md`; AI rules in `ai/DEVELOPMENT_RULES.md` |

Full protocol: [`ai/README.md`](README.md).

## How To Update Memory

Never write directly to `FACTS.md`, `REQUIREMENTS.md`, `CONSTRAINTS.md`, or `docs/DECISIONS.md` with a `VERIFIED`/`ACCEPTED` status without following the safety workflow in [`ai/PROMPTS/UPDATE_MEMORY.md`](PROMPTS/UPDATE_MEMORY.md) (analyze → classify → check existing → check conflict → propose → **human approval** → write → update handoff → session log). Importing an external conversation: use [`ai/PROMPTS/EXTRACT_CONVERSATION.md`](PROMPTS/EXTRACT_CONVERSATION.md) first. Suspect a contradiction: use [`ai/PROMPTS/CONFLICT_CHECK.md`](PROMPTS/CONFLICT_CHECK.md) and report it — do not resolve product decisions yourself.
