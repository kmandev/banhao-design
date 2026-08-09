# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-09

## Current Project State

Design-and-documentation-only repository. No application code exists. Phase 1 (Food Delivery) product/UX design is essentially complete for the Customer App and Design System; Driver/Merchant/Admin apps are wireframe-level only. Architecture and technology research is now complete but **no technology has been selected**. Full detail: [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md).

## Last Completed Work

Architecture & technology research pass — 27 documents in [`ai/RESEARCH/`](RESEARCH/) comparing backend, database, payment, auth, real-time, queue, maps, notifications, storage, infrastructure, observability, and repository options, plus compliance, cost, risk, three architecture candidates, and a Product Owner decision sheet. See EVENT-005 in [`ai/KNOWLEDGE/EVENTS.md`](KNOWLEDGE/EVENTS.md).

## Current Work

None active. Awaiting Product Owner decisions via [`ai/RESEARCH/HUMAN_DECISION_SHEET.md`](RESEARCH/HUMAN_DECISION_SHEET.md).

## Immediate Next Step

**Commission the Thai legal/compliance review (Q-002, Q-015, Q-012, Q-017) before selecting a payment provider or writing code.** It has external lead time and is the one open question that can invalidate work already done rather than merely delay work not yet started. Rationale: [`ai/RESEARCH/EXECUTIVE_SUMMARY.md`](RESEARCH/EXECUTIVE_SUMMARY.md) §10.

## Important Decisions

- Order State and Payment State are separate, never merged (DEC-002 / CON-001).
- Payment success/refund can only be set by a verified webhook (DEC-003 / CON-002).
- Cash collected by drivers is a liability, not income, shown separately (DEC-004 / REQ-001).
- Domain model uses generic entities (Merchant, Product, Order, Delivery, Driver) (DEC-005 / REQ-004).
- Memory system is filesystem-based (Markdown + Git only) (DEC-008).

Full list: [`docs/DECISIONS.md`](../docs/DECISIONS.md).

## Pending Decisions

**Blocking implementation:** Q-002 (legal/settlement model), Q-020 (PromptPay refund mechanism), Q-001 (payment provider), Q-006 (backend stack), Q-007 (database), Q-010 (platform fee).
**Needed soon:** Q-015 (ETDA notification), Q-016 (team capability), Q-009 (hosting budget), Q-018 (map field test), Q-019 (SMS sender ID), Q-012 (PDPA review).

All `OPEN` — see [`ai/KNOWLEDGE/QUESTIONS.md`](KNOWLEDGE/QUESTIONS.md).

## Blocking Issues

🚨 **PromptPay refunds are not natively supported by any provider examined** — this contradicts the refund design in `docs/04-payment`. An off-rail mechanism (likely wallet credit) must be designed before payment work begins. Q-020.

🚨 **The payment-facilitation licensing boundary is unresolved** — BANHAO's split/transfer-round/cash-liability design may itself be regulated activity even when using a licensed PSP. Q-002.

## Important Files

- [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md) — read first
- [`AGENTS.md`](../AGENTS.md) — binding rules, especially payments and secrets
- [`ai/RESEARCH/EXECUTIVE_SUMMARY.md`](RESEARCH/EXECUTIVE_SUMMARY.md) — research conclusions in one place
- [`ai/RESEARCH/HUMAN_DECISION_SHEET.md`](RESEARCH/HUMAN_DECISION_SHEET.md) — where decisions get recorded
- [`ai/KNOWLEDGE/`](KNOWLEDGE/) — typed facts/requirements/constraints/questions/proposals

## Recent Session

2026-08-09, three sessions (Claude Code): (1) AI Memory System v1, (2) v2, (3) architecture & technology research. None touched application code or made any technology decision. Full record: [`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md).

## Warnings

- This repository has **zero application code**. Do not assume a backend, database, or API exists just because architecture and technology are thoroughly documented.
- `ai/RESEARCH/` contains **recommendations, not decisions**. Every price and capability was checked 2026-08-09 and will age — re-verify before relying on it.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up".

## Do Not Do

- **Do not select a technology stack, database, or payment provider.** Those are open product decisions (Q-001, Q-006, Q-007) — research recommendations exist but only the Product Owner can accept them.
- **Do not fill in "My Decision" fields** in `ai/RESEARCH/HUMAN_DECISION_SHEET.md`.
- Do not mark any open question `RESOLVED` or any decision `ACCEPTED` without explicit human approval.
- Do not write a `PROPOSAL` or `ASSUMPTION` into `FACTS.md` without following `ai/PROMPTS/UPDATE_MEMORY.md`.
- Do not delete or rewrite existing `ai/SESSION_LOG/` entries — append.
- Do not implement the BANHAO application as a side effect of a documentation or research task.

## Recommended First Action

Read [`ai/RESEARCH/EXECUTIVE_SUMMARY.md`](RESEARCH/EXECUTIVE_SUMMARY.md) for where the project actually stands, then [`ai/README.md`](README.md) for the working protocol.
