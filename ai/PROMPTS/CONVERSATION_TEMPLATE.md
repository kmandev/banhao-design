# BANHAO Conversation Record

Template for a file under `ai/CONVERSATIONS/YYYY-MM-DD/SESSION-ID.md`. Fill in what applies; leave a section as "None" rather than deleting it.

> Reminder: do not store secrets, credentials, or sensitive personal information in this file. Prefer extracted knowledge over raw transcript — see `ai/PROMPTS/EXTRACT_CONVERSATION.md`.

## Metadata

- Date:
- AI: (e.g. ChatGPT, Gemini, Claude, Codex, Cursor, Windsurf)
- Session ID:
- Participants:
- Topic:

## Context

What prompted this conversation — what was the human trying to figure out or get done?

## User Intent

The human's actual goal, in their own words if possible.

## Discussion Summary

A short summary of what was discussed — not a full transcript.

## Important Facts Discovered

List any `FACT`-classified findings. Do not write them directly into `ai/KNOWLEDGE/FACTS.md` yet — see the pipeline in `ai/PROMPTS/UPDATE_MEMORY.md`.

## Requirements Identified

Anything shaped like a `REQUIREMENT`. Mark status `PROPOSED` until reviewed.

## Decisions

Anything the human explicitly decided during this conversation. Only mark `ACCEPTED` if a human (not the AI) actually made the call.

## Constraints

Anything shaped like a `CONSTRAINT`.

## Proposals

Anything the AI suggested that the human has not yet approved. Status: `PROPOSED`.

## Open Questions

Anything left unresolved. Status: `OPEN`.

## Tasks

Concrete follow-up actions identified.

## AI Recommendations

What the AI (in that conversation) suggested doing next.

## Human Decisions

What the human actually decided, as distinct from what the AI recommended (see BANHAO AI Memory System v2, § 12 — Human Decision vs AI Proposal).

## Files Affected

Repository files this conversation is relevant to, if any.

## Evidence

Links, quotes, or references backing the above — or `Evidence: NONE` if this is speculative.

## Next Step

What should happen next as a result of this conversation.
