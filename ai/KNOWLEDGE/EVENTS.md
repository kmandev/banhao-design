# Events

Significant, dated occurrences in the project's history. Sourced from `git log` and this repository's own record of its sessions — see `docs/PROJECT_HISTORY.md` for the narrative version of the same evidence.

---

## EVENT-001

```yaml
id: EVENT-001
type: EVENT
date: 2026-08-09
source: git commit 7d0a7d5 "add design"
confidence: HIGH
```

Initial design drop: four `.dc.html` design canvases (Customer App, Design System, Payment Architecture, Product Architecture), the `tracking-map.html` prototype, the `support.js` canvas runtime, and two annotated QA screenshots added in a single commit.

---

## EVENT-002

```yaml
id: EVENT-002
type: EVENT
date: 2026-08-09
source: git commit f3939d6 "create structure project files"
confidence: HIGH
```

Repository restructured from a flat `design/` folder into `docs/` / `design/` / `assets/` / `specs/` / `archive/`, via an AI-assisted session. All original files preserved and moved with `git mv` (100% content-identical renames). Root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and per-directory `README.md` stubs added.

---

## EVENT-003

```yaml
id: EVENT-003
type: EVENT
date: 2026-08-09
source: git commit 7b2d5f7 "add ai rule"
confidence: HIGH
```

AI Memory System v1 created: `docs/AI_CONTEXT.md`, `docs/PROJECT_HISTORY.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/CURRENT_STATUS.md`, `docs/TODO.md`, `docs/CHANGELOG.md`, `ai/README.md`, `ai/SESSION_LOG/2026-08-09.md`, `ai/PROMPTS/AI_AUDIT.md`.

---

## EVENT-004

```yaml
id: EVENT-004
type: EVENT
date: 2026-08-09
source: this session (pending commit at time of writing)
confidence: HIGH
```

AI Memory System v2 built on top of v1: knowledge classification system (`ai/KNOWLEDGE/`: FACTS, REQUIREMENTS, CONSTRAINTS, ASSUMPTIONS, QUESTIONS, PROPOSALS, EVENTS, ARCHITECTURE index), `ai/MEMORY.md` index, `ai/HANDOFF.md`, `ai/CONVERSATIONS/` scaffold, new prompt templates (`CONVERSATION_TEMPLATE.md`, `EXTRACT_CONVERSATION.md`, `UPDATE_MEMORY.md`, `CONFLICT_CHECK.md`), `docs/DECISIONS.md` migrated to the richer per-decision format, and `ai/README.md` rewritten as the official multi-level context-loading protocol. No v1 memory content was deleted or had its meaning changed.
