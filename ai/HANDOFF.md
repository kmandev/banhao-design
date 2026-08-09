# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-09

## Current Project State

Design-and-documentation-only repository. No application code exists. Phase 1 (Food Delivery) product/UX design is essentially complete for the Customer App and Design System; Driver/Merchant/Admin apps are wireframe-level only. Full detail: [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md).

## Last Completed Work

AI Memory System v2 built on top of v1: knowledge classification (`ai/KNOWLEDGE/`), memory index (`ai/MEMORY.md`, this file), conversation import scaffold, and safety-workflow prompts. See EVENT-004 in [`ai/KNOWLEDGE/EVENTS.md`](KNOWLEDGE/EVENTS.md) and today's second session block in [`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md).

## Current Work

None active. This was a documentation/memory-system task; it is complete and awaiting human review.

## Immediate Next Step

Resolve the three blocking open questions: **Q-001** (payment provider), **Q-006** (backend stack), **Q-007** (database technology) — see [`ai/KNOWLEDGE/QUESTIONS.md`](KNOWLEDGE/QUESTIONS.md). Nothing can be implemented until at least the stack/database questions are answered.

## Important Decisions

- Order State and Payment State are separate, never merged (DEC-002 / CON-001).
- Payment success/refund can only be set by a verified webhook (DEC-003 / CON-002).
- Cash collected by drivers is a liability, not income, shown separately (DEC-004 / REQ-001).
- Domain model uses generic entities (Merchant, Product, Order, Delivery, Driver) (DEC-005 / REQ-004).
- Memory system is filesystem-based (Markdown + Git only) — no database, vector store, or external service (DEC-008).

Full list with evidence: [`docs/DECISIONS.md`](../docs/DECISIONS.md).

## Pending Decisions

Q-001 (payment provider), Q-002 (settlement/legal model), Q-006 (backend stack), Q-007 (database). All `OPEN`, all block real implementation. See [`ai/KNOWLEDGE/QUESTIONS.md`](KNOWLEDGE/QUESTIONS.md) for the full set including lower-priority ones.

## Blocking Issues

None technical (nothing has started). Product-level: the four pending decisions above are what's actually blocking any implementation from beginning.

## Important Files

- [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md) — read first
- [`AGENTS.md`](../AGENTS.md) — binding rules, especially on payments and secrets
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — state machines, ledger model
- [`ai/KNOWLEDGE/`](KNOWLEDGE/) — structured facts/requirements/constraints/questions
- [`docs/TODO.md`](../docs/TODO.md) — prioritized task list with sources

## Recent Session

2026-08-09, two sessions (Claude Code): (1) built AI Memory System v1, (2) built AI Memory System v2 on top of it. Neither touched application code, business logic, or made any technology-stack/payment-provider choice. Full record: [`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md).

## Warnings

- This repository has **zero application code**. Do not assume a backend, database, or API exists just because the architecture is thoroughly documented — `docs/CURRENT_STATUS.md` keeps design and implementation status explicitly separate.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up" by deleting copies without updating the `.dc.html` files that reference them.

## Do Not Do

- Do not choose a backend stack, database, or payment provider — those are open product decisions (Q-001, Q-006, Q-007), not yours to make.
- Do not write a `PROPOSAL` or `ASSUMPTION` into `ai/KNOWLEDGE/FACTS.md` or mark a `docs/DECISIONS.md` entry `ACCEPTED` without following `ai/PROMPTS/UPDATE_MEMORY.md`.
- Do not delete or rewrite existing `ai/SESSION_LOG/` entries — append new ones.
- Do not implement the BANHAO application (backend, frontend, database, payment, auth, deployment) as a side effect of a documentation task — confirm scope with the human first if asked to do both.

## Recommended First Action

Read [`ai/README.md`](README.md) for the full context-loading protocol, then check [`docs/TODO.md`](../docs/TODO.md) P0 list before doing anything else.
