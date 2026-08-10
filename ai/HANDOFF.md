# BANHAO AI Handoff

Read this right after `docs/AI_CONTEXT.md`. Kept short and actionable on purpose — for depth, follow the links, don't expect it here.

## Current Date

2026-08-10

## Current Project State

**Foundation, the Customer App, and its Supabase authentication are all merged to `main`.** `feature/customer-app` and `feature/supabase-customer-auth` were reviewed by the Product Owner and merged on 2026-08-10 (merge commit `c4927b25`, `git merge --no-ff`). All 31 states from the design artifact are implemented and verified by screenshot — 18 numbered screens, 7 payment sub-states, 6 state variants — with design tokens, shared React Native components, 4-tab navigation, and Supabase auth + profile.

**The live dev Supabase project (`banhao-dev`) is what the merged app authenticates against**, and that authentication is verified end-to-end against it.

Still no business logic: no order creation, payment integration, dispatch, or settlement. Everything except authentication and `profiles` is mock-backed via `apps/customer/src/repositories/`.

## Last Completed Work

**Supabase Database Design v1 (EVENT-016), on `feature/database-design-v1`** — this update. The PostgreSQL blueprint for DEC-016…DEC-032. **Design only — no migration created, no SQL executed, live Supabase untouched.**

Two documents: `docs/DATABASE_DESIGN.md` (46 tables, ERD, table catalog, RLS matrix, state matrix, FK/cascade rules, justified indexes, migration order) and `docs/OPEN_DATABASE_QUESTIONS.md` (**DBQ-001…DBQ-014**).

Highlights: the live `profiles` RLS pattern is generalised as the template for every table (**revoke-first** matters — Supabase grants `ALL` by default); **DEC-017 is enforced by composite foreign keys** so a cross-restaurant cart cannot be stored; state columns are `text` + `CHECK` rather than enums because the order vocabulary already changed once; a small ledger is recommended with `ledger_entry_groups.group_key` doing double duty as duplicate protection and zero-sum unit. **A single `profiles.role` column was found insufficient** — a rider and a restaurant owner both also order food (DBQ-002).

Before that: **Technical Architecture v1 (EVENT-015), on `feature/technical-architecture-v1`**. The architecture implementing DEC-016…DEC-032 is designed and written down. **Architecture only — no backend, no migration, no Supabase table, no provider integration, no Merchant/Rider/Admin app.**

Three documents: `docs/TECHNICAL_ARCHITECTURE.md` (22 sections), `docs/ARCHITECTURE_DECISIONS.md` (**ADR-001…ADR-012, all `PROPOSED`**), `docs/OPEN_TECHNICAL_QUESTIONS.md` (**TQ-001…TQ-016**). **No business decision changed; no question closed.**

The spine is **"NestJS writes, clients read, Postgres decides"** — domain tables grant no write access to `authenticated` at all, and RLS is defence in depth rather than the authorization system. Concurrency everywhere is a **guarded conditional UPDATE** with the state check in the `WHERE` clause; the rider race additionally gets a partial unique index as a database backstop. Existing code (`PaymentProvider`, the two-client `SupabaseService`, the module rules) was reviewed and **kept**, not redesigned.

Before that: **P0 Business Decisions v1 approved and locked (EVENT-014), on `feature/p0-decisions-v1`**. The Product Owner approved a first tranche of business decisions in a workshop; they are now permanent decision records **DEC-016…DEC-032** in `docs/DECISIONS.md` (which also gained an index). **Documentation only — no code, no migration, no provider.**

The seven business documents were rewritten against those decisions, and the status taxonomy is now `ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`, with `ACCEPTED — MODEL · OPEN — NUMBERS` used deliberately in the money sections. **Only `ACCEPTED` may be built on.**

Headline decisions: **online payment only, COD disabled but extensible** (DEC-016) · **one cart = one restaurant** (DEC-017) · **four separate state domains** (DEC-018) · a new Order lifecycle with **`PREPARING` and `RIDER_SEARCHING` in parallel** (DEC-019) · **broadcast → first accept** dispatch starting at `MERCHANT_ACCEPTED` (DEC-020) · **rider cancellation never cancels the order** (DEC-021) · **no-rider escalates to an operator, never auto-cancels** (DEC-022) · fee/commission **models only, every number still open** (DEC-023/024/025) · settlement as its own domain (DEC-026) · refund in the payment domain (DEC-027) · idempotency, late payment and duplicate payment (DEC-028/029/030) · manual operations and operator fallback as intentional Phase 1 capabilities (DEC-031/032).

Before that: **Business Rules & Domain Modelling (EVENT-013), on `feature/business-rules`**. Seven documents written, **zero production code**: `docs/BUSINESS_RULES.md`, `DOMAIN_MODEL.md`, `ORDER_LIFECYCLE.md`, `RIDER_LIFECYCLE.md`, `PAYMENT_LIFECYCLE.md`, `SETTLEMENT_MODEL.md`, `OPEN_BUSINESS_QUESTIONS.md`. At the time, every rule was tagged `DOCUMENTED` / `PROPOSED` / `OPEN`, nothing was promoted to `ACCEPTED`, and no `Q-NNN` was resolved. *(The `DOCUMENTED` token was renamed to `ACCEPTED` by EVENT-014 — see the taxonomy above.)* 39 business questions added (BQ-001…BQ-039), 15 of them P0. Six contradictions **inside accepted documents** were found — see EVENT-013 for all six; the two that matter most are a `PENDING_PAYMENT` order state that the payment machine references but the order machine does not contain (BQ-012), and a `NO_DRIVER` rule that the Customer App's own copy contradicts (BQ-014).

Before that: **merge to `main`**. The full quality gate (lint, typecheck, test, build) was re-run on `main` after the merge and passed. Before that: Customer App defect fixes (EVENT-011) — **DEF-01…DEF-05 are all fixed, tested and re-verified by screenshot.** Visual QA is **31 / 31 states**. 12e was reached by letting the **real** 600-second QR TTL elapse — no test hook and no shortened timer were added. OTP resend now genuinely calls the auth layer, verified by a second `200 POST /auth/v1/otp` against the live project.

Before that: Supabase dev environment + live Customer authentication (EVENT-010). Project `banhao-dev` created in `ap-southeast-1` with Phone auth on **Supabase Test OTP**. Verified live: request OTP, wrong OTP rejected by the server, correct OTP, profile read under RLS, `display_name` write (`204 PATCH`), session persistence across a full app restart, logout, and logout persisting across another restart. **Live RLS: 14/14 passed.** No fake session was ever created.

## Current Work

`feature/database-design-v1` is pushed and **ready for database review**. Documentation only. **Not merged to `main`.** Four branches are stacked and unmerged: `feature/business-rules` → `feature/p0-decisions-v1` → `feature/technical-architecture-v1` → `feature/database-design-v1`.

## Immediate Next Step

**Database review of `docs/DATABASE_DESIGN.md`**, then the first migrations. Four questions block the first migration: **DBQ-002** (role model — `user_roles` vs `profiles.role`, and it needs a `RolesGuard` code change), **DBQ-010** (zero-sum via a deferred constraint trigger), **TQ-011** (migration workflow), **TQ-012** (concurrency test strategy).

Also still open: **architecture review of `docs/TECHNICAL_ARCHITECTURE.md` and ADR-001…ADR-012** (all `PROPOSED` — nothing may be built until they are accepted). Three technical questions are **T0 and block backend work**: **TQ-011** (migration workflow — agree it before the first domain migration, not after), **TQ-012** (how concurrency correctness is *proved* — the EVENT-007 precedent of verifying by execution against real PostgreSQL applies), and **TQ-008** (provider adapter, gated on Q-001/Q-020).

Then the remaining **8 P0 business questions** in `docs/OPEN_BUSINESS_QUESTIONS.md`: Q-001 (provider), Q-002 (legal), Q-010 / BQ-028 (commission **rate**), Q-020 (PromptPay refund mechanism), BQ-015 (who bears the cost of wasted food), BQ-026 and BQ-027 (fee **numbers**), BQ-030 (promotion funding). Every one is a number, a provider, or a legal question — **all the structural questions are now answered.**

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

**Blocking payment work:** Q-002 (legal/settlement model), Q-020 (PromptPay refund mechanism), Q-001 (payment provider) — **all three got more urgent with DEC-016**, since online is now the only way to be paid or to refund.
**Blocking money work:** every number. Q-010 / BQ-028 (commission rate), BQ-026 (delivery fee), BQ-027 (service fee), BQ-029 (rider earnings), BQ-030 (promotion funding), BQ-015 (who pays for wasted food).
**Answered 2026-08-10 (EVENT-014):** BQ-010, BQ-012, BQ-014, BQ-019, BQ-025 and the model halves of BQ-026/027/028. **Deferred with COD:** BQ-023, BQ-033, Q-004.
**Needed soon:** Q-015 (ETDA notification), Q-009 (hosting budget), Q-018 (map field test), Q-019 (SMS sender ID — ~2 week lead time), Q-012 (PDPA review), BQ-022 (rider contractor status).

## Blocking Issues

🚨 **No payment provider supports native PromptPay refunds** — contradicts the refund design in `docs/04-payment`. An off-rail mechanism (likely wallet credit) must be designed. Q-020.

🚨 **Payment-facilitation licensing boundary unresolved** — BANHAO's split/transfer-round/cash-liability design may itself be regulated activity. Q-002.

✅ **Resolved 2026-08-10.** The two contradictions found in EVENT-013 are settled: `PENDING_PAYMENT` is now a real Order state (DEC-019), and rider search starts at `MERCHANT_ACCEPTED` so the `NO_DRIVER` conflict disappears (DEC-019, DEC-022). **The cost question they exposed — who pays for cooked-but-undelivered food — is still `OPEN` (BQ-015) and still P0.**

🚨 **Two code divergences created by the lock, deliberately not fixed** (no code was touched). `apps/customer/src/mocks/types.ts` still encodes the superseded 12 order states (DEC-019), and the Customer App checkout still offers cash (DEC-016). Both are follow-up work for an implementation phase.

⏸️ **The rider cash-float problem is deferred, not solved** — DEC-016 disables COD, so no rider fronts money in Phase 1. The underlying question (the rider pays the merchant ฿108 at pickup to earn ฿12) returns unchanged the day COD is switched back on. BQ-023.

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
- Do not implement anything tagged `PROPOSED` or `OPEN` in the business documents. **Only `ACCEPTED` is product truth**, and `ACCEPTED — MODEL · OPEN — NUMBERS` means you may not pick the number.
- Do not enable cash payment anywhere — DEC-016 disables COD in Phase 1. Equally, **do not delete the cash model**: `payment_method` must stay extensible, and DEC-004 / REQ-001 remain accepted.
- Do not write a migration before DBQ-002, DBQ-010, TQ-011 and TQ-012 are answered — and never `supabase db push` against the live project without explicit instruction.
- Do not add a table without the five-step security pattern (`revoke` first — Supabase grants `ALL` by default), and do not put business rules in triggers; integrity constraints only.
- Do not implement anything tagged `PROPOSED` in the technical documents either — **every ADR is `PROPOSED`**, and `TQ-NNN` items must not be turned into assumptions.
- Do not write `SELECT`-then-check-then-`UPDATE` on any guarded table. The state check goes in the `WHERE` clause (ADR-003) — check-then-act lets two riders both win.
- Do not add a client write grant on a domain table. Mutations go through NestJS (ADR-001/ADR-002).
- Do not use the old order state names (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`, `COMPLETED`, `NO_DRIVER`) in new work — DEC-019 supersedes them.
- Do not treat the design's sample figures as business rules — 10% commission, ฿15 delivery, ฿5 service, ฿10 coupon are all illustrative, and the payment canvas says so about itself.

## Recommended First Action

Read [`ai/DEVELOPMENT_RULES.md`](DEVELOPMENT_RULES.md), then run `pnpm install && pnpm test` to confirm the foundation is healthy before changing anything.
