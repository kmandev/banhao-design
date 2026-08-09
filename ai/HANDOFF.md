# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-09

## Current Project State

**Application foundation exists and works.** The repository now contains real code, not just documentation. A pnpm/Turborepo monorepo with a NestJS API (auth + RBAC + `/health` + `/api/v1/me`), five shared packages, Supabase migrations with RLS, four minimal app shells, Docker, and CI.

No product features are implemented — no ordering, cart, checkout, dispatch, payment integration, or map UI. That is deliberate; this was foundation-only scope.

Branch: `feature/app-foundation` (not merged to `main`).

## Last Completed Work

Application Foundation — see EVENT-006 in [`ai/KNOWLEDGE/EVENTS.md`](KNOWLEDGE/EVENTS.md) and the session log.

## Current Work

None active. Awaiting Product Owner review of the `feature/app-foundation` branch.

## Immediate Next Step

Product Owner reviews and merges the branch. In parallel, the highest-value unblocking action is still **commissioning the Thai legal/compliance review** (Q-002, Q-015, Q-012, Q-017) — it has external lead time and gates all payment work.

## Important Decisions

Stack (all `ACCEPTED` 2026-08-09):

- **DEC-009** Modular monolith — no microservices
- **DEC-010** Supabase (PostgreSQL + PostGIS + Auth + Storage + Realtime) — resolves Q-007
- **DEC-011** NestJS + TypeScript, REST + OpenAPI — resolves Q-006
- **DEC-012** React Native/Expo (customer, merchant, driver) + Next.js (admin) — **supersedes DEC-006's Flutter intention**
- **DEC-013** Monorepo, pnpm + Turborepo
- **DEC-014** PostgreSQL is the system of record for all financial data
- **DEC-015** Payment providers only via abstraction — no provider selected

Product rules that constrain all code:

- Order State and Payment State stay separate (DEC-002 / CON-001)
- Payment confirmed only by verified webhook (DEC-003 / CON-002)
- Driver cash is a liability, not income (DEC-004 / REQ-001)
- Ledger balances to exactly zero (CON-003)

Full list: [`docs/DECISIONS.md`](../docs/DECISIONS.md).

## Pending Decisions

**Blocking payment work:** Q-002 (legal/settlement model), Q-020 (PromptPay refund mechanism), Q-001 (payment provider), Q-010 (platform fee).
**Needed soon:** Q-015 (ETDA notification), Q-009 (hosting budget), Q-018 (map field test), Q-019 (SMS sender ID — ~2 week lead time), Q-012 (PDPA review).

## Blocking Issues

🚨 **No payment provider supports native PromptPay refunds** — contradicts the refund design in `docs/04-payment`. An off-rail mechanism (likely wallet credit) must be designed. Q-020.

🚨 **Payment-facilitation licensing boundary unresolved** — BANHAO's split/transfer-round/cash-liability design may itself be regulated activity. Q-002.

## Important Files

- [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md) — **read before writing code**
- [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) — how to work in the monorepo
- [`docs/SETUP.md`](../docs/SETUP.md) — first-time setup
- [`AGENTS.md`](../AGENTS.md) — binding rules on payments and secrets
- [`apps/api/src/modules/README.md`](../apps/api/src/modules/README.md) — module conventions

## Recent Session

2026-08-09, four sessions (Claude Code): Memory v1 → Memory v2 → architecture research → application foundation. Full record: [`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md).

## Warnings

- **`NullPaymentProvider` throws on every call by design.** Don't "fix" it by returning fake success — that would let money paths appear to work untested.
- The API needs real Supabase credentials in `.env` to start. `/health` has no auth dependency; `/api/v1/me` needs a valid Supabase JWT *and* a `profiles` row.
- Tests do not cover a real Supabase connection — auth is tested with mocks. End-to-end auth against a live Supabase project has not been exercised.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up".

## Do Not Do

- Do not select a payment provider — Q-001 is `OPEN` on purpose (DEC-015).
- Do not import a provider SDK outside `apps/api/src/modules/payments/providers/`.
- Do not merge Order state and Payment state, use floats for money, or let Realtime/cache be financial truth.
- Do not build feature UI (ordering, cart, checkout, dispatch, maps) without an explicit instruction — foundation scope ended deliberately short of it.
- Do not commit `.env` or any credential — CI fails the build on this.
- Do not mark an open question `RESOLVED` or a decision `ACCEPTED` without human approval.

## Recommended First Action

Read [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md), then run `pnpm install && pnpm test` to confirm the foundation is healthy before changing anything.
