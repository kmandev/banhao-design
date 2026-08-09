# AI Development Workflow Analysis

BANHAO intends to use AI tools as a significant part of development (explicit in the task history that produced `ai/README.md` and the AI Memory System). This document analyzes how that can work across multiple AI tools without committing to exactly one.

## Tools considered (informational, not a selection)

- **Claude Code** — CLI/IDE agent, used to build this repository's design reorganization and AI Memory System so far (see `ai/KNOWLEDGE/EVENTS.md`).
- **Codex** — OpenAI's coding agent tooling.
- **Gemini** — Google's coding-capable assistant/agent tooling.
- **ChatGPT** — general-purpose assistant, usable for planning/research/code generation depending on interface.
- **Cursor** — AI-native IDE built around in-editor agentic coding.
- **GitHub Copilot** — inline code-completion/chat assistant integrated into editors and GitHub itself.

This document deliberately does not rank or select among these — the AI Memory System (`ai/`) was built specifically so any of them (or others) can contribute without the project depending on one vendor. Per DEC-008, the memory system itself has no tool-specific dependency (filesystem + Git only).

## Proposed workflow shape

```
Human
 ↓
Architecture (human-approved design/decisions — docs/DECISIONS.md, ai/RESEARCH/)
 ↓
AI Research (this kind of task — gathers options, does not decide)
 ↓
Decision (human/Product Owner — docs/DECISIONS.md, status: ACCEPTED)
 ↓
AI Implementation (an AI agent — any of the above tools — builds against the accepted decision)
 ↓
Review (human review of the AI's output before merge)
 ↓
Tests (automated verification — see `ai/RESEARCH/DECISION_MATRIX.md` for testing-ecosystem factors per backend option)
 ↓
Git (commit/PR, following `CONTRIBUTING.md`)
 ↓
Memory Update (`ai/PROMPTS/UPDATE_MEMORY.md` workflow — session log, decision log, knowledge base kept current)
```

This is consistent with, and formalizes, the workflow this repository's own AI Memory System already assumes (`ai/README.md` § After Work, § Memory Update).

## Why tool-agnosticism matters here specifically

- **Continuity requirement**: `ai/MEMORY.md` and `ai/HANDOFF.md` exist specifically so that "AI ตัวใหม่เข้ามาแล้วสามารถทำงานต่อได้ทันที" (a new AI can pick up work immediately) regardless of which tool it is — this was an explicit design goal of the AI Memory System v2 task, not something this research document is introducing.
- **No vendor lock-in on the human side**: Different tools have different strengths (e.g. some are stronger at broad codebase research, others at fast in-editor completion) — a workflow that assumes only one tool would need to be redesigned every time the team's tool preference changes. A workflow anchored on the *artifacts* (Git commits, `docs/DECISIONS.md`, `ai/SESSION_LOG/`) rather than on a specific tool's proprietary memory/context feature stays valid regardless of tool choice — which is also why DEC-008 rules out any tool-specific or vendor-specific memory backend.
- **Review remains human-owned**: Regardless of which AI tool writes code, the workflow above keeps "Review" and "Decision" as explicit human steps — consistent with every constraint already in `AGENTS.md` and `ai/README.md` about AI agents not making product/architecture decisions unilaterally.

## What this document does not do

It does not evaluate or compare the listed tools against each other (pricing, capability benchmarks, etc.) — that would be a separate research effort with its own currency-of-information concerns (AI tool capabilities change quickly), and the task instructions for this research phase explicitly said not to select one AI tool. If the Product Owner wants a tool-by-tool comparison later, it should be scoped as its own research task with an explicit "as of" date, since this kind of comparison ages fast.
