# Architecture — Knowledge Cross-Reference

This file is an **index only**. The canonical, full architecture document is [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — read that for actual content (state tables, diagrams, entity model). **⚠️ Exception since 2026-08-10:** its Order State Machine is **superseded** by DEC-019; the business-domain source of truth is now the seven documents listed in `ai/MEMORY.md` § Business Rules, starting with [`docs/ORDER_LIFECYCLE.md`](../../docs/ORDER_LIFECYCLE.md). This file exists purely to link architecture sections to the structured knowledge entries (requirements, constraints, decisions) that govern them, so an agent can trace `Requirement → Decision → Architecture → Event` without re-reading everything.

| `docs/ARCHITECTURE.md` section | Related knowledge |
|---|---|
| Core Entities | REQ-004, DEC-005 |
| Order State Machine ⚠️ **superseded** | REQ-002 · **DEC-019** replaces the 12-state machine — build from `docs/ORDER_LIFECYCLE.md` |
| Payment State Machine | CON-001, CON-002, DEC-002, DEC-003 · **DEC-016** (cash pair dormant), **DEC-027…DEC-030** |
| Delivery State Machine *(new domain)* | **DEC-018, DEC-020, DEC-021, DEC-022** — `docs/RIDER_LIFECYCLE.md` |
| Settlement *(new domain)* | **DEC-026** — `docs/SETTLEMENT_MODEL.md` |
| Payment Confirmation Flow | CON-002, REQ-003, DEC-003 |
| Client / State Relationship | REQ-002 |
| Ledger Model | REQ-001, CON-003, DEC-004 |
| Frontend / Backend / API / Database / Auth / Storage / External Services / Deployment | All `UNKNOWN / NOT VERIFIED` — see Q-006, Q-007, Q-001, Q-002 for the open decisions blocking each |

For the full trace chain on any topic, follow: `docs/ARCHITECTURE.md` (what) → `ai/KNOWLEDGE/CONSTRAINTS.md` / `REQUIREMENTS.md` (what must/must-not) → `docs/DECISIONS.md` (why, when accepted) → `ai/KNOWLEDGE/EVENTS.md` (when it entered the repository) → `ai/SESSION_LOG/` (which session touched it).
