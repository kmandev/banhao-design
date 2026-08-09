# Extract Conversation Into BANHAO Project Memory

Use this prompt when a human pastes a conversation (from ChatGPT, Gemini, another AI tool, or a chat transcript) and says something like "Extract this conversation into BANHAO Project Memory."

---

You are extracting knowledge from a conversation into the BANHAO AI Memory System. Before doing anything, read `ai/README.md` and `docs/AI_CONTEXT.md` so you understand the existing project state.

Given the pasted conversation, do the following, in order:

1. **Secret check first.** Scan the conversation for passwords, API keys, tokens, private keys, or other secrets. If found, strip them and tell the human — do not write them into any file, even temporarily.
2. **Identify facts** — claims that are verifiable against the repository or clearly stated evidence.
3. **Identify requirements** — things someone said the system must do.
4. **Identify decisions** — things a human explicitly decided (not just discussed) during the conversation.
5. **Identify proposals** — things an AI suggested that were not explicitly approved.
6. **Identify constraints** — things someone said the system must never do.
7. **Identify questions** — things left unresolved.
8. **Identify tasks** — concrete follow-up actions mentioned.
9. **Identify contradictions** — anything that conflicts with existing entries in `ai/KNOWLEDGE/` or `docs/DECISIONS.md`. Run these through the logic in `ai/PROMPTS/CONFLICT_CHECK.md`.
10. **Identify unsupported assumptions** — things stated as if true but with no evidence given anywhere.

Then:

- Fill out `ai/PROMPTS/CONVERSATION_TEMPLATE.md` with what you found and save it to `ai/CONVERSATIONS/YYYY-MM-DD/SESSION-ID.md` (pick a short descriptive `SESSION-ID`, e.g. `payment-provider-discussion`). Store the extracted knowledge, not the full raw transcript, unless the human specifically asks you to keep the verbatim transcript.
- **Propose** repository updates — draft the exact `ai/KNOWLEDGE/*.md` entries or `docs/DECISIONS.md` entries you'd add, each with proper `status` (`PROPOSED`, not `ACCEPTED`, unless the human already explicitly approved it in the conversation itself).
- **Do not automatically write PROPOSED items into FACTS.md, REQUIREMENTS.md, CONSTRAINTS.md, or DECISIONS.md as if they were settled.** Anything that isn't already a human-approved decision goes into `ai/KNOWLEDGE/PROPOSALS.md` (proposals) or `ai/KNOWLEDGE/QUESTIONS.md` (open questions) — never straight into FACTS or an ACCEPTED decision.
- Show the human your proposed changes and wait for approval before writing them anywhere outside `ai/CONVERSATIONS/`.

## Output format

Report back:

```
CONVERSATION EXTRACTED

Facts found: N
Requirements found: N
Decisions (human-approved in this conversation): N
Proposals (not yet approved): N
Constraints found: N
Questions found: N
Tasks found: N
Contradictions found: N (see below if > 0)
Unsupported assumptions found: N

Proposed memory updates (awaiting your approval):
[list, each tagged with target file and status]
```

Then stop and wait for the human to approve, reject, or edit before writing anything to `ai/KNOWLEDGE/` or `docs/DECISIONS.md`.
