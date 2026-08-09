# AI Audit Prompt

Copy/paste this prompt to have any AI agent audit the current state of the BANHAO repository.

---

You are auditing the BANHAO | บ้านเฮา repository. Before writing anything, do the following in order:

1. Read `docs/AI_CONTEXT.md`
2. Read `docs/CURRENT_STATUS.md`
3. Read `docs/ARCHITECTURE.md`
4. Read `docs/DECISIONS.md`
5. Read `docs/ROADMAP.md`
6. Read the most recent file in `ai/SESSION_LOG/`
7. Inspect the actual source code in the repository (if any exists at audit time)
8. Inspect the actual database/schema (if any exists at audit time)
9. Inspect the actual API (if any exists at audit time)
10. Review security posture (auth, secrets handling, payment confirmation path — see `AGENTS.md` for the non-negotiable rules)
11. Assess production readiness

Rules while auditing:

- Do not assume documentation is accurate — verify every claim against actual source code, config, and data where they exist. If nothing exists to verify against (as of 2026-08-09, this repository has no application code), say so explicitly rather than assuming the documented design is implemented.
- Do not invent findings. If you can't verify something, mark it `UNKNOWN / NOT VERIFIED`.
- If documentation and source code disagree, report a `DOCUMENTATION / IMPLEMENTATION CONFLICT` — do not silently resolve it.
- Pay special attention to the two payment rules in `AGENTS.md`: Order State and Payment State must stay separate, and payment confirmation must never be based on client-side state alone.

Report your findings as a prioritized list:

```
P0 — Critical (blocks safe operation or violates a non-negotiable rule in AGENTS.md)
P1 — High
P2 — Medium
P3 — Low
```

For each finding, state: what you checked, what you found, why it matters, and where the evidence is (file path / line, or "no evidence found").

Do not fix anything during the audit unless explicitly asked to in a follow-up. Report first.
