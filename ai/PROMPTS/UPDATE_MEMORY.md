# Update BANHAO Memory Safely

Use this prompt whenever new information (from a conversation, a code change, a human instruction, or an audit finding) needs to be written into the AI Memory System. This is the safety gate that prevents memory pollution — follow it every time, even for small updates.

---

Workflow — do not skip steps:

```
INPUT
 ↓
ANALYZE
 ↓
CLASSIFY
 ↓
CHECK EXISTING MEMORY
 ↓
CHECK CONFLICT
 ↓
PROPOSE CHANGES
 ↓
HUMAN APPROVAL
 ↓
WRITE MEMORY
 ↓
UPDATE HANDOFF
 ↓
SESSION LOG
```

1. **INPUT** — What is the new information, and where did it come from? Quote it or cite it exactly.
2. **ANALYZE** — What does this information actually claim? Separate the claim from any interpretation.
3. **CLASSIFY** — Which type is it: `FACT`, `DECISION`, `REQUIREMENT`, `CONSTRAINT`, `ASSUMPTION`, `OPEN_QUESTION`, `PROPOSAL`, `TASK`, `EVENT`, or `OBSERVATION`? See `docs/AI_CONTEXT.md` and the BANHAO AI Memory System v2 spec for definitions. When unsure between two types, pick the weaker one (e.g. `ASSUMPTION` over `FACT`, `PROPOSAL` over `DECISION`) — it's safer to under-claim than over-claim.
4. **CHECK EXISTING MEMORY** — Search `ai/KNOWLEDGE/`, `docs/DECISIONS.md`, and `docs/AI_CONTEXT.md` for anything already covering this. Do not create a duplicate entry — update or cross-reference the existing one instead.
5. **CHECK CONFLICT** — Run the logic in `ai/PROMPTS/CONFLICT_CHECK.md` against the new information. If a conflict is found, stop this workflow and report the conflict instead of proceeding.
6. **PROPOSE CHANGES** — Draft the exact diff: which file(s), which entries, with proper IDs (continuing the existing numbering — check the highest existing `FACT-NNN`/`REQ-NNN`/etc. first) and full metadata (`id, type, status, date, source, confidence, owner`).
7. **HUMAN APPROVAL** — Show the proposed diff to the human. Do not write anything classified as `DECISION` with `status: ACCEPTED`, or anything into `FACTS.md`/`REQUIREMENTS.md`/`CONSTRAINTS.md` with `status: VERIFIED`/`ACCEPTED`, without explicit human approval. `PROPOSAL` and `OPEN_QUESTION` entries can be added without approval since they carry no claim of truth — but still show the human what you're adding.
8. **WRITE MEMORY** — Apply exactly the approved diff. Do not "improve" or expand it beyond what was approved.
9. **UPDATE HANDOFF** — If this changes current project state, update `ai/HANDOFF.md` (keep it short — trim something else if you're adding).
10. **SESSION LOG** — Record what you did in today's `ai/SESSION_LOG/YYYY-MM-DD.md`, using the v2 template.

## Hard rules (memory pollution prevention)

- An AI's opinion never becomes a `FACT`.
- An AI's suggestion never becomes a `DECISION` — it's a `PROPOSAL` until a human accepts it.
- A guess never becomes a `REQUIREMENT`.
- A `TASK` never becomes a `DECISION`.
- Conversation speculation never becomes permanent truth.
- `UNKNOWN` confidence never silently becomes `HIGH` without new evidence — cite the new evidence when it happens.
- If genuinely no decision/fact exists for something being asked about, write `Historical decision not verified.` or `UNKNOWN / NOT VERIFIED` — never fill the gap with a plausible guess.
