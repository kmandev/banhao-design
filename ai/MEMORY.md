# BANHAO AI Memory

Index into the project's knowledge. This file stays short on purpose — it points to the source document for everything instead of repeating it. If you're new to this repository, read this after `ai/HANDOFF.md` (see `ai/README.md` for the full context-loading protocol).

## Project Identity

BANHAO | บ้านเฮา — a Local Super App launching in อำเภอบุณฑริก จังหวัดอุบลราชธานี ประเทศไทย, starting with Phase 1 Food Delivery. Full detail: [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md).

## Current Reality

No application code exists yet — this is a design-and-documentation-only repository (verified by full-repo search, 2026-08-09). Full detail: [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md).

## Permanent Facts

10 verified facts, indexed FACT-001 through FACT-010. Full list with evidence: [`ai/KNOWLEDGE/FACTS.md`](KNOWLEDGE/FACTS.md).

## Critical Decisions

8 decisions logged, DEC-001 through DEC-008, all `ACCEPTED`. The two most load-bearing: Order State and Payment State are separate (DEC-002), and payment confirmation is webhook-only (DEC-003). Full list: [`docs/DECISIONS.md`](../docs/DECISIONS.md).

## Critical Constraints

5 constraints logged, CON-001 through CON-005 — none may be violated without a human decision. Full list: [`ai/KNOWLEDGE/CONSTRAINTS.md`](KNOWLEDGE/CONSTRAINTS.md). Binding agent rules (secrets, credentials, etc.): [`AGENTS.md`](../AGENTS.md).

## Active Requirements

4 requirements logged, REQ-001 through REQ-004. Full list: [`ai/KNOWLEDGE/REQUIREMENTS.md`](KNOWLEDGE/REQUIREMENTS.md).

## Open Questions

8 open questions, Q-001 through Q-008. The three blocking everything else: **Q-001** (payment provider), **Q-006** (backend stack), **Q-007** (database). Full list: [`ai/KNOWLEDGE/QUESTIONS.md`](KNOWLEDGE/QUESTIONS.md).

## Active Tasks

P0/P1 items only (full list in [`docs/TODO.md`](../docs/TODO.md)):

- Decide payment provider/settlement model (P0)
- Decide backend technology stack (P0)
- Decide database technology (P0)
- Design Driver/Merchant/Admin apps past wireframe stage (P1)
- Legal/compliance review for payments (P1)

## Recent Events

4 events logged, EVENT-001 through EVENT-004 (design drop → repo reorg → Memory v1 → Memory v2). Full list: [`ai/KNOWLEDGE/EVENTS.md`](KNOWLEDGE/EVENTS.md).

## Important Architecture Rules

- Order State (12 states) and Payment State (12 states) are separate state machines — never merge them (CON-001).
- Payment success/refund can only be set by a verified provider webhook, never client state (CON-002).
- Every order's ledger must balance to exactly zero (CON-003).
- All client surfaces read order status from one shared backend state — no local computation (REQ-002).
- Domain model uses generic entities (Merchant, Product, Order, Delivery, Driver) to support future phases (REQ-004).

Full architecture (state tables, diagrams): [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Cross-reference index: [`ai/KNOWLEDGE/ARCHITECTURE.md`](KNOWLEDGE/ARCHITECTURE.md).

## Memory Sources

| Layer | Location | Purpose |
|---|---|---|
| Fast context | `ai/HANDOFF.md`, `ai/MEMORY.md` (this file), `docs/AI_CONTEXT.md` | Read first, every session |
| Task context | `docs/CURRENT_STATUS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/TODO.md`, `docs/ROADMAP.md` | Read before working on something specific |
| Structured knowledge | `ai/KNOWLEDGE/*.md` | Typed, ID'd, cross-referenceable facts/requirements/constraints/etc. |
| Historical context | `docs/PROJECT_HISTORY.md`, `ai/SESSION_LOG/`, `ai/CONVERSATIONS/` | Read when you need "why" or "when" |
| Canonical design | `design/`, `specs/` | The actual product design, not a summary of it |

Full protocol: [`ai/README.md`](README.md).

## How To Update Memory

Never write directly to `FACTS.md`, `REQUIREMENTS.md`, `CONSTRAINTS.md`, or `docs/DECISIONS.md` with a `VERIFIED`/`ACCEPTED` status without following the safety workflow in [`ai/PROMPTS/UPDATE_MEMORY.md`](PROMPTS/UPDATE_MEMORY.md) (analyze → classify → check existing → check conflict → propose → **human approval** → write → update handoff → session log). Importing an external conversation: use [`ai/PROMPTS/EXTRACT_CONVERSATION.md`](PROMPTS/EXTRACT_CONVERSATION.md) first. Suspect a contradiction: use [`ai/PROMPTS/CONFLICT_CHECK.md`](PROMPTS/CONFLICT_CHECK.md) and report it — do not resolve product decisions yourself.
