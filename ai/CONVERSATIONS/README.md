# Conversations

> **This directory may contain conversation-derived information. Do not store secrets or sensitive personal information here.**

Structure:

```
ai/CONVERSATIONS/
└── YYYY-MM-DD/
    └── SESSION-ID.md
```

Each file uses the format in [`ai/PROMPTS/CONVERSATION_TEMPLATE.md`](../PROMPTS/CONVERSATION_TEMPLATE.md).

## What goes here

By default, store **extracted knowledge** (facts, requirements, decisions, proposals, questions, tasks discovered) from a conversation with an AI tool outside this repository (ChatGPT, Gemini, another Claude session, etc.) — not the raw transcript. Use [`ai/PROMPTS/EXTRACT_CONVERSATION.md`](../PROMPTS/EXTRACT_CONVERSATION.md) to do the extraction.

Only store a full transcript here if there's a specific reason to keep it verbatim, and even then: run a secrets check first, and strip anything personal that isn't necessary to understand the project decision being recorded.

## What this is not

This is not the primary record of AI work done *inside* this repository — that's [`ai/SESSION_LOG/`](../SESSION_LOG/). Use `CONVERSATIONS/` for knowledge imported from *outside* this repo's own AI sessions.

No conversations have been imported here yet as of 2026-08-09.
