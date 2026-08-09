# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-10

## Current Project State

Foundation is merged to `main`. **The Customer App UI is now implemented** on `feature/customer-app` (not merged): all 31 states from the design artifact — 18 numbered screens, 7 payment sub-states, 6 state variants — with design tokens, shared React Native components, 4-tab navigation, and Supabase auth + profile.

Still no business logic: no order creation, payment integration, dispatch, or settlement. Everything except authentication and `profiles` is mock-backed via `apps/customer/src/repositories/`.

## Last Completed Work

Customer App final QA (EVENT-009). **IBM Plex Sans Thai is now bundled** (all four weights, no runtime fetch) — the review's one MUST-FIX. 84 tests pass. Visual QA reached **4 of 31 states**; the rest are gated behind a Supabase session that does not exist.

## Current Work

None active. Awaiting review of `feature/customer-app`. **Not ready for merge** — 22 screens are UNVERIFIED and authentication was never tested against a real backend.

## Immediate Next Step

Review `feature/customer-app`, and answer the five `DESIGN_QUESTION` items (DQ-01…DQ-05) in `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md` — they were recorded rather than guessed. In parallel, **commissioning the Thai legal/compliance review** (Q-002, Q-015, Q-012, Q-017) still gates all payment work and has external lead time.

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

2026-08-09, five sessions (Claude Code): Memory v1 → Memory v2 → architecture research → application foundation → pre-merge review fixes. Full record: [`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md).

## Warnings

- **`NullPaymentProvider` throws on every call by design.** Don't "fix" it by returning fake success — that would let money paths appear to work untested.
- The API needs real Supabase credentials in `.env` to start. `/health` has no auth dependency; `/api/v1/me` needs a valid Supabase JWT *and* a `profiles` row.
- API auth tests use mocks. **RLS is verified by real execution** (`./supabase/tests/run-rls-tests.sh`), but against a plain Postgres container with a Supabase auth shim — GoTrue, real JWT issuance, and PostgREST are NOT exercised. End-to-end auth against a live Supabase project remains unverified.
- `profiles.phone` is deliberately not client-writable: it mirrors the Auth identity. Self-service phone change must go through Supabase Auth's OTP-verified flow, not a direct table update.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up".
- **22 Customer App screens are UNVERIFIED** against the design — no Supabase project means the authenticated tree can't be reached. They pass smoke tests only, which proves they don't crash, not that they look right. See `docs/CUSTOMER_APP_VISUAL_QA.md`.
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
- Do not build Merchant, Driver, or Admin apps without an explicit instruction.
- Do not commit `.env` or any credential — CI fails the build on this.
- Do not mark an open question `RESOLVED` or a decision `ACCEPTED` without human approval.

## Recommended First Action

Read [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md), then run `pnpm install && pnpm test` to confirm the foundation is healthy before changing anything.
