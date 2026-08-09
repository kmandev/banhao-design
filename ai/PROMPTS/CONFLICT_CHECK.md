# Conflict Check

Use this prompt to check the BANHAO Memory System for internal conflicts, or to check new information against it before writing (see `ai/PROMPTS/UPDATE_MEMORY.md`, step 5).

---

Check for conflicts across all of these pairings:

```
Fact vs Fact
Decision vs Decision
Documentation vs Code
Requirement vs Architecture
Old Decision vs New Decision
Session vs Permanent Memory
```

Concretely:

1. **Fact vs Fact** — Do any two entries in `ai/KNOWLEDGE/FACTS.md` (or a fact and something stated in `docs/AI_CONTEXT.md`/`docs/CURRENT_STATUS.md`) contradict each other?
2. **Decision vs Decision** — Do any two entries in `docs/DECISIONS.md` contradict each other without one explicitly superseding the other via the `Supersedes` / `Superseded By` fields?
3. **Documentation vs Code** — Does anything in `docs/` or `ai/KNOWLEDGE/` claim a behavior that the actual source code (if any exists at check time) does not implement, or implements differently? As of 2026-08-09 this repository has no source code, so this check currently has nothing to compare against — re-run it once implementation begins.
4. **Requirement vs Architecture** — Does any entry in `ai/KNOWLEDGE/REQUIREMENTS.md` or `CONSTRAINTS.md` conflict with what `docs/ARCHITECTURE.md` describes?
5. **Old Decision vs New Decision** — Is a new decision being proposed that contradicts an existing `ACCEPTED` decision in `docs/DECISIONS.md` without formally superseding it?
6. **Session vs Permanent Memory** — Does anything recorded in a specific `ai/SESSION_LOG/` entry disagree with the current state of `ai/MEMORY.md`, `ai/KNOWLEDGE/`, or `docs/DECISIONS.md`? (Session logs are historical/point-in-time; permanent memory should reflect the current, reconciled state — if they disagree, permanent memory should usually win, but confirm why the session log says something different before assuming that.)

## Reporting format

For each conflict found:

```
CONFLICT
Severity: P0 | P1 | P2 | P3
Sources: <file:section> vs <file:section>
Description: <what disagrees, in one or two sentences>
Recommended resolution: <options, not a unilateral fix>
```

Severity guide:

- **P0** — touches a `CONSTRAINT` (especially payment/order-state separation or webhook-only confirmation — see `AGENTS.md`)
- **P1** — touches an `ACCEPTED` `DECISION` or `REQUIREMENT`
- **P2** — touches a `FACT` or `ASSUMPTION`
- **P3** — cosmetic/documentation-only disagreement

## Hard rule

**Do not resolve a product decision yourself.** Report the conflict and recommended options; a human (product owner) makes the call. You may fix a conflict that is purely editorial (e.g. two docs stating the same already-agreed fact slightly differently) — but if resolving it would mean choosing between two substantively different claims, that's a report, not a fix.
