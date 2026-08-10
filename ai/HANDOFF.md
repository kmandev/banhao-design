# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-10

## Current Project State

Foundation is merged to `main`. **The Customer App UI is implemented** on `feature/customer-app` (not merged): all 31 states from the design artifact — 18 numbered screens, 7 payment sub-states, 6 state variants — with design tokens, shared React Native components, 4-tab navigation, and Supabase auth + profile.

**A live dev Supabase project (`banhao-dev`) now exists**, and on `feature/supabase-customer-auth` (not merged) **authentication is verified end-to-end against it**. Neither branch is merged.

Still no business logic: no order creation, payment integration, dispatch, or settlement. Everything except authentication and `profiles` is mock-backed via `apps/customer/src/repositories/`.

## Last Completed Work

Supabase dev environment + live Customer authentication (EVENT-010). Project `banhao-dev` created in `ap-southeast-1` with Phone auth on **Supabase Test OTP**. Verified live: request OTP, wrong OTP rejected by the server, correct OTP, profile read under RLS, `display_name` write (`204 PATCH`), session persistence across a full app restart, logout, and logout persisting across another restart. **Live RLS: 14/14 passed.** Visual QA went from 4/31 to **29/31 states verified by screenshot**. No fake session was ever created.

Five defects recorded rather than quietly fixed — DEF-01…DEF-05 in `docs/CUSTOMER_APP_VISUAL_QA.md`. One is MAJOR.

## Current Work

None active. Awaiting review of `feature/customer-app` and `feature/supabase-customer-auth`. **Neither is merged.**

## Immediate Next Step

Review both branches. Then fix **DEF-01** (payment state 12e `PayExpired` is unreachable) and answer the five `DESIGN_QUESTION` items (DQ-01…DQ-05) in `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md` — they were recorded rather than guessed. In parallel, **commissioning the Thai legal/compliance review** (Q-002, Q-015, Q-012, Q-017) still gates all payment work and has external lead time.

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

2026-08-10 (Claude Code): Supabase dev environment, live auth verification, and authenticated visual QA. Full record: [`ai/SESSION_LOG/2026-08-10.md`](SESSION_LOG/2026-08-10.md). Earlier: 2026-08-09, five sessions — Memory v1 → Memory v2 → architecture research → application foundation → pre-merge review fixes ([`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md)).

## Warnings

- **`NullPaymentProvider` throws on every call by design.** Don't "fix" it by returning fake success — that would let money paths appear to work untested.
- The API needs real Supabase credentials in `.env` to start. `/health` has no auth dependency; `/api/v1/me` needs a valid Supabase JWT *and* a `profiles` row.
- API auth tests and the customer navigation tests use **mocks** — they prove routing, not authentication. Two RLS suites exist and must not be conflated: `supabase/tests/live-rls-check.mjs` is **LIVE** (real GoTrue, real JWTs, PostgREST — 14/14 passed), `./supabase/tests/run-rls-tests.sh` is a plain-Postgres shim. See `supabase/tests/README.md`.
- **The iOS Simulator cannot hold an HTTP/3 connection to Supabase.** The first HTTPS request succeeds, then every one after it fails with `Network request failed`. Diagnosed from the Simulator's own log (QUIC → `-1005`). Use `scripts/sim-supabase-proxy.mjs` for Simulator QA; it forwards verbatim to the real project and mocks nothing. Full write-up in `docs/SUPABASE_DEVELOPMENT.md`. Untested on hardware and on Android.
- `EXPO_PUBLIC_*` is inlined at transform time — after editing `apps/customer/.env` you must restart Metro with `--clear` **and** terminate/relaunch Expo Go. Reloading is not enough.
- `profiles.phone` is deliberately not client-writable: it mirrors the Auth identity. Self-service phone change must go through Supabase Auth's OTP-verified flow, not a direct table update.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up".
- **29 of 31 Customer App states are now verified by screenshot** against the design. Not verified: 12e (unreachable — DEF-01) and the search **results** list (simulator cannot type Thai). Four state variants — empty cart, loading, network error, no driver — have no reachable trigger yet. See `docs/CUSTOMER_APP_VISUAL_QA.md`.
- **DEF-01 is MAJOR:** `PayExpired` (12e) is registered in the navigator but nothing routes to it; the QR screen counts down to zero and goes nowhere.
- **Android is untested.** Font weights are selected by family name specifically because Android ignores `fontWeight` with a custom `fontFamily` — that mapping has never run on Android.
- Thai tone-mark stacking was investigated and is **correct**; do not re-raise it. The marks merge visually at low zoom. Evidence: `docs/qa/customer-app/typography-thai-marks-zoom.png`.
- The monorepo pins one React version via `pnpm.overrides`. Bumping React in one app without the others will reintroduce a `@types/react` collision.
- `@banhao/ui` imports React Native. Web consumers must import tokens from `@banhao/ui/theme`, never the barrel, or Next will try to bundle RN.

## Do Not Do

- Do not select a payment provider — Q-001 is `OPEN` on purpose (DEC-015).
- Do not import a provider SDK outside `apps/api/src/modules/payments/providers/`.
- Do not merge Order state and Payment state, use floats for money, or let Realtime/cache be financial truth.
- Do not re-design the Customer App. The design artifact is the source of truth; record a `DESIGN_QUESTION` instead of guessing.
- Do not put mock data inside a UI component — it goes in `src/mocks/` behind a repository.
- Do not add a text style with `fontSize` but no `fontFamily` — it silently falls back to the system face.
- Do not create a fake Supabase session to make visual QA look complete.
- Do not put the service role key in any app, `.env` a client reads, or document.
- Do not describe plain-Postgres shim results as live Supabase verification.
- Do not leave `EXPO_PUBLIC_SUPABASE_URL` pointing at the Simulator proxy in anything that leaves this machine.
- Do not build Merchant, Driver, or Admin apps without an explicit instruction.
- Do not commit `.env` or any credential — CI fails the build on this.
- Do not mark an open question `RESOLVED` or a decision `ACCEPTED` without human approval.

## Recommended First Action

Read [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md), then run `pnpm install && pnpm test` to confirm the foundation is healthy before changing anything.
