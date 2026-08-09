# Proposals

Ideas from an AI agent or developer that have **not** been approved. A proposal is never a decision — it only becomes one when a human/product-owner accepts it and it gets logged in `docs/DECISIONS.md` with `Status: ACCEPTED`.

No proposals have been recorded yet. This session (2026-08-09, AI Memory System v2 build) deliberately made none — choosing a technology stack, payment provider, or any implementation approach was explicitly out of scope for this task.

When a proposal is added, use this format:

```markdown
## PROP-NNN

\`\`\`yaml
id: PROP-NNN
type: PROPOSAL
status: PROPOSED
date: YYYY-MM-DD
source: <session or person proposing>
confidence: <HIGH | MEDIUM | LOW | UNKNOWN>
owner: <who must approve — usually PRODUCT_OWNER>
\`\`\`

### Proposal

### Why

### Pros

### Cons

### Risks

### Awaiting Decision
```

On approval, move the content into `docs/DECISIONS.md` as a new `DEC-NNN` with `Status: ACCEPTED`, and update this entry's `status` to `ACCEPTED` (or `REJECTED` if declined) rather than deleting it.
