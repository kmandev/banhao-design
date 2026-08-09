# BANHAO AI Development Protocol

Official operating manual for any AI agent (Claude Code, ChatGPT, Gemini, Codex, Cursor, Windsurf, or other) working in this repository. This is v2 of the protocol — it extends v1 (context-loading checklist, before/during/after rules) with a typed knowledge base, a handoff file, conversation import, and conflict handling. Nothing from v1 was removed.

## AI Context Loading Protocol

You don't need to read everything every time. Load by level, based on what you're doing:

### Level 1 — Fast Context (read every session, no exceptions)

1. [`ai/HANDOFF.md`](HANDOFF.md) — current state, what's next, what not to do
2. [`ai/MEMORY.md`](MEMORY.md) — indexed knowledge, links to everything else
3. [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md) — project identity and concise context

### Level 2 — Task Context (read before working on something specific)

- [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md)
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
- [`docs/DECISIONS.md`](../docs/DECISIONS.md)
- [`docs/TODO.md`](../docs/TODO.md)
- [`docs/ROADMAP.md`](../docs/ROADMAP.md)
- Relevant `ai/KNOWLEDGE/*.md` files for the topic at hand

### Level 3 — Historical Context (read when you need "why" or "when")

- [`docs/PROJECT_HISTORY.md`](../docs/PROJECT_HISTORY.md)
- [`ai/SESSION_LOG/`](SESSION_LOG/)
- [`ai/CONVERSATIONS/`](CONVERSATIONS/)

### Level 4 — Implementation (read when actually building something)

- Source code (none exists yet — see `docs/CURRENT_STATUS.md`)
- `design/`
- `specs/`
- Tests (none exist yet)

## During Work

- Do not guess. If something is unverifiable from the repository, say `UNKNOWN / NOT VERIFIED` — do not fill the gap with a plausible-sounding assumption.
- Do not invent architecture that isn't documented or approved.
- Do not overwrite decisions recorded in `docs/DECISIONS.md` without flagging the change explicitly — see Conflict Handling below.
- Do not duplicate a feature, requirement, or document that already exists — check `ai/MEMORY.md` and `docs/CURRENT_STATUS.md` first.
- Verify before changing anything load-bearing (payment logic, order/payment state modeling, ledger rules — see [`AGENTS.md`](../AGENTS.md) and `ai/KNOWLEDGE/CONSTRAINTS.md`).
- Classify anything new you learn using the types in [Knowledge Classification](#knowledge-classification) below, and write it using the safe workflow in [Memory Update](#memory-update).

## Knowledge Classification

Every piece of knowledge written to permanent memory must have one of these types:

| Type | Meaning |
|---|---|
| `FACT` | Verifiable from the repository or clear evidence |
| `DECISION` | Something the team/product owner has actually decided |
| `REQUIREMENT` | Something the system must do |
| `CONSTRAINT` | Something the system must never violate |
| `ASSUMPTION` | Believed true, not yet verified |
| `OPEN_QUESTION` | Unanswered, blocks something |
| `PROPOSAL` | An AI's or developer's idea, not yet approved |
| `TASK` | Something that needs doing |
| `EVENT` | A significant, dated occurrence |
| `OBSERVATION` | Something an AI noticed while checking the repository |

Status values: `PROPOSED → REVIEW → ACCEPTED → ACTIVE → SUPERSEDED → ARCHIVED` (or `REJECTED`, `OPEN`, `RESOLVED`, `VERIFIED`, `UNVERIFIED` depending on type — see entries in `ai/KNOWLEDGE/` for examples). Confidence values: `HIGH` (direct evidence), `MEDIUM` (partial evidence), `LOW` (inference), `UNKNOWN` (insufficient information). **Never silently upgrade `UNKNOWN` to a higher confidence, or a `PROPOSAL`/`ASSUMPTION` to `FACT`/`DECISION`, without new evidence.**

## Source of Truth

```
Human / Product Owner Decision
        ↓
Approved Decision (docs/DECISIONS.md, status: ACCEPTED)
        ↓
Repository Documentation (docs/, ai/KNOWLEDGE/)
        ↓
Implementation (source code, once it exists)
        ↓
AI Observation
        ↓
AI Proposal (ai/KNOWLEDGE/PROPOSALS.md)
```

Exception, once code exists: **running/existing source code = Implementation Truth.** If documentation and code disagree, that is a `DOCUMENTATION / IMPLEMENTATION CONFLICT` — report it, do not resolve it yourself.

## Memory Update

Never write a `FACT`, `ACCEPTED DECISION`, `REQUIREMENT`, or `CONSTRAINT` directly. Follow [`ai/PROMPTS/UPDATE_MEMORY.md`](PROMPTS/UPDATE_MEMORY.md): analyze → classify → check existing memory → check conflict → propose changes → **human approval** → write → update handoff → session log.

## Conversation Import

When a human brings in a conversation from another AI tool ("Extract this conversation into BANHAO Project Memory"), follow [`ai/PROMPTS/EXTRACT_CONVERSATION.md`](PROMPTS/EXTRACT_CONVERSATION.md). Store extracted knowledge (not raw transcripts by default) under `ai/CONVERSATIONS/YYYY-MM-DD/`, using [`ai/PROMPTS/CONVERSATION_TEMPLATE.md`](PROMPTS/CONVERSATION_TEMPLATE.md). Never write extracted items straight into `FACTS.md` or `DECISIONS.md` as settled — they go through `PROPOSALS.md` / `QUESTIONS.md` and human approval first, per the Memory Update workflow above.

## Conflict Handling

If documentation, decisions, requirements, or code disagree with each other, run [`ai/PROMPTS/CONFLICT_CHECK.md`](PROMPTS/CONFLICT_CHECK.md) and report the conflict with severity, sources, description, and recommended (not applied) resolution. **Never resolve a product decision yourself.**

## After Work

Update:

- `docs/CURRENT_STATUS.md`
- `docs/TODO.md`
- `docs/CHANGELOG.md` (and the root `CHANGELOG.md` if the change is user-facing)
- `ai/HANDOFF.md` if current state or next step changed
- Relevant `ai/KNOWLEDGE/*.md` files, following the Memory Update workflow

Create:

- `ai/SESSION_LOG/YYYY-MM-DD.md` for the session (append a new dated/titled block if a log for that date already exists from an earlier session — never overwrite an existing session's content)

If a major architectural or product decision was made:

- Add an entry to `docs/DECISIONS.md`, following the existing `DEC-NNN` format with a real citation (file path + section, git commit, or "human decision during session YYYY-MM-DD").

## Handoff

Every session ends by making sure the *next* agent — which might be a different AI entirely — can pick up immediately. Update `ai/HANDOFF.md` and make sure your `ai/SESSION_LOG/` entry's "Next AI Handoff" section answers: What was I doing? What did I discover? What is complete? What is incomplete? What should the next AI read? What should the next AI do? What must the next AI **not** do? What decisions are pending?

## Source of Truth Hierarchy (Implementation)

For **product/business intent**:

```
Product Decisions
      ↓
docs/DECISIONS.md
      ↓
docs/AI_CONTEXT.md
      ↓
docs/CURRENT_STATUS.md
      ↓
Source Code
      ↓
ai/SESSION_LOG/
```

For **implementation fact**, once code exists: **Source Code = Implementation Truth.**

## Conversation History

This repository does not contain full ChatGPT/Claude conversation transcripts by default — only what the design canvases, git history, session logs, and (if imported) `ai/CONVERSATIONS/` capture. If asked about something outside that, say: "Conversation history unavailable in repository."

## Security & Privacy

- Never write secrets, API keys, tokens, passwords, private keys, or personal sensitive information into any memory file — see `AGENTS.md`.
- Any imported conversation must pass a secrets check before being written to `ai/CONVERSATIONS/` (see `ai/PROMPTS/EXTRACT_CONVERSATION.md`, step 1).
- `ai/CONVERSATIONS/` may contain conversation-derived information — treat it with the same care as the warning posted in that directory's `README.md`.

## No Database

This is a filesystem-based knowledge system on purpose: Markdown + Git + directory structure only. Do not add a database, vector database, embedding service, external SaaS, or API server to implement "memory" — see DEC-008 in `docs/DECISIONS.md`.
