# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-10

## Current Project State

**Foundation, the Customer App, and its Supabase authentication are all merged to `main`.** `feature/customer-app` and `feature/supabase-customer-auth` were reviewed by the Product Owner and merged on 2026-08-10 (merge commit `c4927b25`, `git merge --no-ff`). All 31 states from the design artifact are implemented and verified by screenshot — 18 numbered screens, 7 payment sub-states, 6 state variants — with design tokens, shared React Native components, 4-tab navigation, and Supabase auth + profile.

**The live dev Supabase project (`banhao-dev`) is what the merged app authenticates against**, and that authentication is verified end-to-end against it.

Still no business logic: no order creation, payment integration, dispatch, or settlement. Everything except authentication and `profiles` is mock-backed via `apps/customer/src/repositories/`.

## Last Completed Work

**Business Rules & Domain Modelling (EVENT-013), on `feature/business-rules`** — this update. Seven documents written, **zero production code**: `docs/BUSINESS_RULES.md`, `DOMAIN_MODEL.md`, `ORDER_LIFECYCLE.md`, `RIDER_LIFECYCLE.md`, `PAYMENT_LIFECYCLE.md`, `SETTLEMENT_MODEL.md`, `OPEN_BUSINESS_QUESTIONS.md`. Every rule is tagged `DOCUMENTED` / `PROPOSED` / `OPEN`; nothing was promoted to `ACCEPTED` and no `Q-NNN` was resolved. 39 business questions added (BQ-001…BQ-039), 15 of them P0. Six contradictions **inside accepted documents** were found — see EVENT-013 for all six; the two that matter most are a `PENDING_PAYMENT` order state that the payment machine references but the order machine does not contain (BQ-012), and a `NO_DRIVER` rule that the Customer App's own copy contradicts (BQ-014).

Before that: **merge to `main`**. The full quality gate (lint, typecheck, test, build) was re-run on `main` after the merge and passed. Before that: Customer App defect fixes (EVENT-011) — **DEF-01…DEF-05 are all fixed, tested and re-verified by screenshot.** Visual QA is **31 / 31 states**. 12e was reached by letting the **real** 600-second QR TTL elapse — no test hook and no shortened timer were added. OTP resend now genuinely calls the auth layer, verified by a second `200 POST /auth/v1/otp` against the live project.

Before that: Supabase dev environment + live Customer authentication (EVENT-010). Project `banhao-dev` created in `ap-southeast-1` with Phone auth on **Supabase Test OTP**. Verified live: request OTP, wrong OTP rejected by the server, correct OTP, profile read under RLS, `display_name` write (`204 PATCH`), session persistence across a full app restart, logout, and logout persisting across another restart. **Live RLS: 14/14 passed.** No fake session was ever created.

## Current Work

`feature/business-rules` is written and **awaiting Product Owner review**. It is documentation only — no code, no migration, no provider.

## Immediate Next Step

**Product Owner review of `docs/OPEN_BUSINESS_QUESTIONS.md`, starting with the 15 P0 items.** Until those are answered, Order, Payment and Settlement cannot be implemented — only guessed at. The P0 set is Q-001, Q-002, Q-010, Q-020, plus BQ-010, BQ-012, BQ-014, BQ-015, BQ-019, BQ-023, BQ-025, BQ-026, BQ-027, BQ-028, BQ-030.

In parallel and unchanged: **commissioning the Thai legal/compliance review** (Q-002, Q-015, Q-012, Q-017, and now BQ-022 rider classification) still gates all payment work and has external lead time; DQ-01…DQ-05 need closing (all five are now addressed — see `OPEN_BUSINESS_QUESTIONS.md` § DQ table); Android is still unverified. Merchant, Driver, Admin, and any payment/order/dispatch code remain out of scope until the P0 decisions land — that is a new instruction to wait for, not something to infer from "the business rules are written."

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

**Blocking payment work:** Q-002 (legal/settlement model), Q-020 (PromptPay refund mechanism), Q-001 (payment provider), Q-010 (platform fee — anchored but not decided; see BQ-028).
**Blocking order/dispatch work (new, EVENT-013):** BQ-010 (one merchant per cart), BQ-012 (`PENDING_PAYMENT`), BQ-014 (`NO_DRIVER` semantics), BQ-015 (who pays for wasted food), BQ-019 (dispatch model), BQ-023 (rider cash float), BQ-025 (no-rider ladder), BQ-026/BQ-027 (delivery and service fees), BQ-030 (promotion funding).
**Needed soon:** Q-015 (ETDA notification), Q-009 (hosting budget), Q-018 (map field test), Q-019 (SMS sender ID — ~2 week lead time), Q-012 (PDPA review), BQ-022 (rider contractor status).

## Blocking Issues

🚨 **No payment provider supports native PromptPay refunds** — contradicts the refund design in `docs/04-payment`. An off-rail mechanism (likely wallet credit) must be designed. Q-020.

🚨 **Payment-facilitation licensing boundary unresolved** — BANHAO's split/transfer-round/cash-liability design may itself be regulated activity. Q-002.

🚨 **Two accepted documents contradict each other** (EVENT-013). The Payment State Machine pairs five states with an Order state `PENDING_PAYMENT` that the Order State Machine does not contain (BQ-012). The Order State Machine puts `NO_DRIVER` after `READY` — food cooked — while the Customer App tells the customer their food has *not* been cooked (BQ-014). Neither can be resolved by an agent; both change who pays for wasted food.

🚨 **The cash design makes riders front their own money** — the rider pays the merchant ฿108 at pickup to earn ฿12, before collecting anything. Documented twice, never called out. With 8–12 riders total this is a recruitment barrier. BQ-023.

## Important Files

- [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md) — **read before writing code**
- [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) — how to work in the monorepo
- [`docs/SETUP.md`](../docs/SETUP.md) — first-time setup
- [`AGENTS.md`](../AGENTS.md) — binding rules on payments and secrets
- [`apps/api/src/modules/README.md`](../apps/api/src/modules/README.md) — module conventions

## Recent Session

2026-08-10 (Claude Code): Supabase dev environment, live auth verification, authenticated visual QA, defect fixes, and merge to `main`. Full record: [`ai/SESSION_LOG/2026-08-10.md`](SESSION_LOG/2026-08-10.md). Earlier: 2026-08-09, five sessions — Memory v1 → Memory v2 → architecture research → application foundation → pre-merge review fixes ([`ai/SESSION_LOG/2026-08-09.md`](SESSION_LOG/2026-08-09.md)).

## Warnings

- **`NullPaymentProvider` throws on every call by design.** Don't "fix" it by returning fake success — that would let money paths appear to work untested.
- The API needs real Supabase credentials in `.env` to start. `/health` has no auth dependency; `/api/v1/me` needs a valid Supabase JWT *and* a `profiles` row.
- API auth tests and the customer navigation tests use **mocks** — they prove routing, not authentication. Two RLS suites exist and must not be conflated: `supabase/tests/live-rls-check.mjs` is **LIVE** (real GoTrue, real JWTs, PostgREST — 14/14 passed), `./supabase/tests/run-rls-tests.sh` is a plain-Postgres shim. See `supabase/tests/README.md`.
- **The iOS Simulator cannot hold an HTTP/3 connection to Supabase.** The first HTTPS request succeeds, then every one after it fails with `Network request failed`. Diagnosed from the Simulator's own log (QUIC → `-1005`). Use `scripts/sim-supabase-proxy.mjs` for Simulator QA; it forwards verbatim to the real project and mocks nothing. Full write-up in `docs/SUPABASE_DEVELOPMENT.md`. Untested on hardware and on Android.
- `EXPO_PUBLIC_*` is inlined at transform time — after editing `apps/customer/.env` you must restart Metro with `--clear` **and** terminate/relaunch Expo Go. Reloading is not enough.
- `profiles.phone` is deliberately not client-writable: it mirrors the Auth identity. Self-service phone change must go through Supabase Auth's OTP-verified flow, not a direct table update.
- `support.js` is intentionally duplicated 4× (FACT-010) — don't "clean it up".
- **31 of 31 Customer App states are verified by screenshot** against the design. Still not covered: the search **results** list (the simulator cannot type Thai) and four state variants — empty cart, loading, network error, no driver — which have no reachable trigger yet. See `docs/CUSTOMER_APP_VISUAL_QA.md`.
- The selected-state check in `ListRow` is **drawn, not typed**. Do not "simplify" it back to `✓` — U+2713 is absent from IBM Plex Sans Thai and substitutes to a glyph that reads as `√`.
- `formatThaiPhone` is **presentation only**. Never let it touch the stored E.164 identity.
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
- Do not implement anything tagged `PROPOSED` in `docs/BUSINESS_RULES.md`, `DOMAIN_MODEL.md`, `ORDER_LIFECYCLE.md`, `RIDER_LIFECYCLE.md`, `PAYMENT_LIFECYCLE.md` or `SETTLEMENT_MODEL.md`. Only `DOCUMENTED` rules are product truth.
- Do not treat the design's sample figures as business rules — 10% commission, ฿15 delivery, ฿5 service, ฿10 coupon are all illustrative, and the payment canvas says so about itself.

## Recommended First Action

Read [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md), then run `pnpm install && pnpm test` to confirm the foundation is healthy before changing anything.
