# BANHAO AI Development Protocol

Operating manual for any AI agent (Claude Code, ChatGPT, Gemini, Codex, Cursor, or other) working in this repository.

## Before Starting Work

1. Read [`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md)
2. Read [`docs/CURRENT_STATUS.md`](../docs/CURRENT_STATUS.md)
3. Read [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)
4. Read [`docs/DECISIONS.md`](../docs/DECISIONS.md)
5. Read [`docs/ROADMAP.md`](../docs/ROADMAP.md)
6. Read the most recent file in [`ai/SESSION_LOG/`](SESSION_LOG/)

## During Work

- Do not guess. If something is unverifiable from the repository, say `UNKNOWN / NOT VERIFIED` — do not fill the gap with a plausible-sounding assumption.
- Do not invent architecture that isn't documented or approved.
- Do not overwrite decisions recorded in `docs/DECISIONS.md` without flagging the change explicitly.
- Do not duplicate a feature or document that already exists — check `docs/CURRENT_STATUS.md` and the relevant `design/`/`specs/` folder first.
- Verify before changing anything load-bearing (payment logic, order/payment state modeling, ledger rules — see [`AGENTS.md`](../AGENTS.md) at the repo root for the binding rules).
- If you find documentation and source code disagreeing, report it as a `DOCUMENTATION / IMPLEMENTATION CONFLICT` — do not silently pick one side.

## After Work

Update:

- `docs/CURRENT_STATUS.md`
- `docs/TODO.md`
- `docs/CHANGELOG.md` (and the root `CHANGELOG.md` if the change is user-facing)

Create:

- `ai/SESSION_LOG/YYYY-MM-DD.md` for the session (use today's date; if a log for that date already exists from an earlier session the same day, append to it rather than overwriting)

If a major architectural or product decision was made:

- Add an entry to `docs/DECISIONS.md`, following the existing `DEC-NNN` format with a real citation (file path + section, or git commit).

## Source of Truth Hierarchy

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

For **implementation fact**, once code exists: **Source Code = Implementation Truth.** If documentation claims something the code doesn't do (or vice versa), that's a conflict to report, not to resolve unilaterally.

## Conversation History

This repository does not contain full ChatGPT/Claude conversation transcripts — only what the design canvases, git history, and session logs capture. If asked about something outside that, say: "Conversation history unavailable in repository."
