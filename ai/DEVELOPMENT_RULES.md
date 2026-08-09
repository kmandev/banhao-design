# AI Development Rules

Binding rules for any AI agent writing code in this repository. These sit
alongside [`AGENTS.md`](../AGENTS.md) (which governs the whole repo) and
[`ai/README.md`](README.md) (the memory protocol).

## The ten rules

**1. Read memory before working.**
[`ai/HANDOFF.md`](HANDOFF.md) → [`ai/MEMORY.md`](MEMORY.md) →
[`docs/AI_CONTEXT.md`](../docs/AI_CONTEXT.md). Skipping this is how work gets
duplicated or contradicts a decision already made.

**2. Read the architecture.**
[`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) and
[`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) before touching `apps/` or
`packages/`.

**3. Read the relevant decisions.**
Check [`docs/DECISIONS.md`](../docs/DECISIONS.md) for anything covering the area
you're changing.

**4. Never change an ACCEPTED decision on your own initiative.**
If a decision looks wrong, say so and explain why — then wait. Reversing an
accepted decision is a Product Owner action, not an AI one.

**5. Never add a dependency without a reason.**
State what it does and why the existing stack can't. Every dependency is
maintenance a solo founder carries. Prefer the standard library and what's
already installed.

**6. Never edit unrelated files.**
A change should touch what the task needs and nothing else. No opportunistic
reformatting, renaming, or "while I was in here" cleanups — they make review
harder and bury the real change.

**7. Test before committing.**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four must pass. Don't report work as done if any of them fails — say what
failed.

**8. Update memory when architecture changes.**
New module, changed data flow, new integration: update
[`ai/MEMORY.md`](MEMORY.md), [`ai/HANDOFF.md`](HANDOFF.md), and add a session
log entry. Add a `DEC-NNN` if a real decision was made — but only with human
approval (rule 4).

**9. Write commit messages that explain the work.**
Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
The subject says what changed; the body says why, when it isn't obvious.

**10. State which files you changed.**
Every response that modifies the repository lists the files created and
modified. The founder reviews via Git — make that easy.

## Hard prohibitions

These are not preferences.

| Never | Why |
|---|---|
| Commit a secret, key, token, or `.env` | `AGENTS.md`; CI fails the build on this |
| Expose `SUPABASE_SERVICE_ROLE_KEY` to any client | It bypasses Row Level Security entirely |
| Import a payment provider SDK outside `payments/providers/` | Defeats the abstraction; Q-001 is still OPEN |
| Confirm a payment from client-reported state | CON-002 — only a verified webhook may |
| Merge Order state and Payment state | CON-001 — a cancelled order still holds money until refunded |
| Use floating point for money | CON-003 — integer satang only |
| Mutate or delete a ledger entry | Correct by writing a reversing entry |
| Use Realtime, cache, or client state as financial truth | DEC-014 — PostgreSQL is the system of record |
| Mark an open question RESOLVED without human approval | `ai/README.md` |
| Invent a business rule that isn't documented | `AGENTS.md` — ask instead |

## When you're unsure

Stop and ask. A question costs a minute; a wrong assumption baked into a
payments system costs far more. If something is genuinely undecided, say
`UNKNOWN / NOT VERIFIED` rather than picking a plausible answer.

## Scope discipline

Build what was asked. If you notice something else worth doing, mention it —
don't silently do it. This matters more than usual here: the founder is solo and
reviews everything, so a large diff containing three unrelated changes is
expensive to review and easy to get wrong.
