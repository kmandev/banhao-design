# Events

Significant, dated occurrences in the project's history. Sourced from `git log` and this repository's own record of its sessions — see `docs/PROJECT_HISTORY.md` for the narrative version of the same evidence.

---

## EVENT-001

```yaml
id: EVENT-001
type: EVENT
date: 2026-08-09
source: git commit 7d0a7d5 "add design"
confidence: HIGH
```

Initial design drop: four `.dc.html` design canvases (Customer App, Design System, Payment Architecture, Product Architecture), the `tracking-map.html` prototype, the `support.js` canvas runtime, and two annotated QA screenshots added in a single commit.

---

## EVENT-002

```yaml
id: EVENT-002
type: EVENT
date: 2026-08-09
source: git commit f3939d6 "create structure project files"
confidence: HIGH
```

Repository restructured from a flat `design/` folder into `docs/` / `design/` / `assets/` / `specs/` / `archive/`, via an AI-assisted session. All original files preserved and moved with `git mv` (100% content-identical renames). Root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and per-directory `README.md` stubs added.

---

## EVENT-003

```yaml
id: EVENT-003
type: EVENT
date: 2026-08-09
source: git commit 7b2d5f7 "add ai rule"
confidence: HIGH
```

AI Memory System v1 created: `docs/AI_CONTEXT.md`, `docs/PROJECT_HISTORY.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/CURRENT_STATUS.md`, `docs/TODO.md`, `docs/CHANGELOG.md`, `ai/README.md`, `ai/SESSION_LOG/2026-08-09.md`, `ai/PROMPTS/AI_AUDIT.md`.

---

## EVENT-004

```yaml
id: EVENT-004
type: EVENT
date: 2026-08-09
source: this session (pending commit at time of writing)
confidence: HIGH
```

AI Memory System v2 built on top of v1: knowledge classification system (`ai/KNOWLEDGE/`: FACTS, REQUIREMENTS, CONSTRAINTS, ASSUMPTIONS, QUESTIONS, PROPOSALS, EVENTS, ARCHITECTURE index), `ai/MEMORY.md` index, `ai/HANDOFF.md`, `ai/CONVERSATIONS/` scaffold, new prompt templates (`CONVERSATION_TEMPLATE.md`, `EXTRACT_CONVERSATION.md`, `UPDATE_MEMORY.md`, `CONFLICT_CHECK.md`), `docs/DECISIONS.md` migrated to the richer per-decision format, and `ai/README.md` rewritten as the official multi-level context-loading protocol. No v1 memory content was deleted or had its meaning changed.

---

## EVENT-005

```yaml
id: EVENT-005
type: EVENT
date: 2026-08-09
source: this session (pending commit at time of writing)
confidence: HIGH
```

Architecture and technology research pass completed — 27 documents in `ai/RESEARCH/`, covering current-architecture reconstruction, technology requirements, scale model, and comparisons across backend, database, payment, authentication, real-time, queue, maps, notifications, storage, infrastructure, observability, and repository strategy; plus marketplace payment model, security architecture, Thailand compliance, cost model, risk matrix, decision matrix, three end-to-end architecture candidates, an executive summary, and a Product Owner decision sheet. External research used five parallel research agents with all claims sourced and check-dated in `ai/RESEARCH/SOURCES.md`.

**No technology was selected. Q-001, Q-006, and Q-007 remain `OPEN`. No `ACCEPTED` decision was created.** Added Q-009 through Q-020 (all `OPEN`) and PROP-001 through PROP-005 (all `PROPOSED`).

Three findings that changed the project's understanding of its own design:

1. **No payment provider examined supports native PromptPay refunds** — contradicting the refund state machine documented in `docs/04-payment` (Q-020).
2. **The payment-facilitation licensing boundary is unresolved** — BANHAO's own split/transfer-round/cash-liability design may constitute regulated activity even when using a licensed PSP (Q-002).
3. **AWS and GCP both now have Bangkok regions, and both are cheaper than Singapore** — latency, PDPA data residency, and cost align rather than trade off.

---

## EVENT-006

```yaml
id: EVENT-006
type: EVENT
date: 2026-08-09
source: this session; branch feature/app-foundation
confidence: HIGH
```

**Application Foundation Started.** The repository moved from documentation-only to containing working application code for the first time.

Product Owner approved the technology stack, resolving **Q-006** (NestJS + TypeScript, DEC-011) and **Q-007** (Supabase PostgreSQL + PostGIS, DEC-010). Six decisions recorded as `ACCEPTED`: DEC-009 (modular monolith), DEC-010 (Supabase), DEC-011 (NestJS), DEC-012 (React Native/Expo + Next.js, superseding DEC-006's Flutter intention), DEC-013 (monorepo/pnpm/Turborepo), DEC-014 (PostgreSQL as financial system of record), DEC-015 (payment provider abstraction only).

Built: pnpm/Turborepo monorepo; NestJS API with global Supabase JWT auth guard and RBAC role guard, `GET /health` and `GET /api/v1/me`, OpenAPI; shared packages (`types`, `validation`, `config`, `api-client`, `ui`); Supabase migrations for PostGIS, the `user_role` enum, `profiles`, a signup trigger, and RLS; four minimal app shells; Docker for the API; GitHub Actions CI; setup/development docs; `ai/DEVELOPMENT_RULES.md`.

**Q-001 (payment provider) deliberately remains `OPEN`** — the foundation ships a `PaymentProvider` interface whose only implementation throws on every call, so no money path can silently appear functional.

Verified: 37 tests pass, lint/typecheck/build pass across 15 workspace tasks, and the API was started to confirm `/health` returns 200 and `/api/v1/me` returns 401 without a valid token.

---

## EVENT-007

```yaml
id: EVENT-007
type: EVENT
date: 2026-08-09
source: this session; branch feature/app-foundation
confidence: HIGH
```

**Pre-merge review fixes.** A foundation review returned PASS WITH MINOR FIXES, flagging possible recursion and privilege escalation in the `profiles` RLS policy and a screen-count discrepancy.

Both RLS concerns were **measured, not reasoned about**, by executing the policies against PostgreSQL 16 + PostGIS in Docker with a Supabase auth shim. Neither was an active bug: the self-referencing subquery terminated (the SELECT policy did not reference `profiles`), and role escalation, INSERT of a fabricated ADMIN row, DELETE, and id changes were all already rejected.

Testing did find a genuine gap the review had not flagged: **`profiles.phone` was client-writable**, letting a user's profile drift from the Supabase Auth identity used for OTP login.

Migration `20260809000003_harden_profiles_rls.sql` adds three defence layers — column privileges limiting clients to `display_name`, non-recursive RLS policies, and an immutability trigger for `role`/`id`/`phone` — plus a service-role-only `set_user_role()` as the trusted role-assignment path. It also removes the *latent* recursion risk: the old policy only avoided recursion because no SELECT policy referenced `profiles`, which the next policy someone writes would likely break.

13 executable assertions added (`supabase/tests/`), wired into CI. The suite was validated against a negative control with the hardening migration removed, where it correctly fails — an earlier draft passed in that control because its fixture re-applied the grants it claimed to verify.

Customer screen count settled at **18**, verified by counting screen labels in the design canvas; only root `README.md` still said 17.
