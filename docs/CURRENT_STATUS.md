# Current Status

## Last Updated

2026-08-10

> **Historical note.** Until 2026-08-09 this file correctly read *"No application
> exists."* That is no longer true — the foundation is merged and the Customer
> App is implemented. The earlier state is preserved in
> [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) and in Git history; nothing has been
> erased, only superseded.

## Overall Status

**Application code exists and runs.** The foundation, the Customer App, and its
Supabase authentication are all **merged to `main`**, reviewed and approved by
the Product Owner on 2026-08-10. **No business logic exists** — no order
creation, payment integration, dispatch, or settlement. That is deliberate, not
an omission.

`feature/customer-app` and `feature/supabase-customer-auth` are fully merged;
new work should branch from `main`.

## Current Phase

Phase 1 — Food Delivery. Customer App UI complete; backend is foundation-only.

## Working Features

- **Customer App (React Native + Expo)** — all 31 design states; 4-tab
  navigation; design tokens and shared components in `packages/ui`.
- **Phone OTP authentication** against the live `banhao-dev` Supabase project —
  request OTP, verify, resend, session persistence across app restart, logout.
- **`profiles` read/write under RLS** — a customer can read only its own row and
  write only `display_name`. Verified by execution, 14/14 checks.
- **NestJS API foundation** — `GET /health`, `GET /api/v1/me`, global Supabase
  JWT auth guard and RBAC role guard, OpenAPI.
- **Monorepo tooling** — pnpm + Turborepo; lint, typecheck, test and build all
  pass; GitHub Actions CI.

## Partially Working

- **Payment screens (12, 12b–12h)** render every payment **state**, but no
  provider is integrated (Q-001 `OPEN`, DEC-015). The QR is a labelled
  placeholder and the state transitions on 12b are explicitly marked `จำลอง:`.
  CON-002 means only a signature-verified provider webhook may ever confirm a
  payment — a client screen must never decide it.
- **Order tracking (14)** renders the status timeline, but the map is a labelled
  placeholder pending a maps provider (Q-018).

## Mock / Placeholder

- Everything except authentication and `profiles` is **mock-backed** through
  `apps/customer/src/repositories/` — shops, menu, cart pricing, orders,
  notifications, addresses. Mock data lives in `apps/customer/src/mocks/` and is
  labelled `(ตัวอย่าง)` on screen.
- `design/tracking/tracking-map.html` — Leaflet prototype with hard-coded mock
  coordinates.
- Numeric examples in `docs/04-payment/` are design examples, as that document
  states itself.

## Not Implemented

- Order backend, dispatch, settlement, ledger
- Payment provider integration and webhooks
- Merchant, Driver and Admin apps (shells only)
- Storage, Realtime, notifications
- Production deployment (Docker + CI exist; nothing is hosted)

## Known Bugs

Five defects were found during the 2026-08-10 QA pass and **all five are fixed
and merged to `main`** — see [`CUSTOMER_APP_VISUAL_QA.md`](CUSTOMER_APP_VISUAL_QA.md)
for DEF-01…DEF-05 and the evidence for each.

## Code Diverging From Approved Decisions

Not bugs — the code was correct when written, and the 2026-08-10 decision lock
(EVENT-014) moved the target. **No code was changed in that step, deliberately.**
Both are tracked as P1 in [`TODO.md`](TODO.md):

| Divergence | Conflicts with |
|---|---|
| `apps/customer/src/mocks/types.ts` encodes the superseded 12 order states (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`, `COMPLETED`, `NO_DRIVER`) | **DEC-019** |
| Checkout (screen 10) still offers a cash option and a cash-prepared-amount selector | **DEC-016** — COD is disabled in Phase 1 |

Reconciling the first needs the exception **state names** settled — they are
still `PROPOSED`.

## Technical Debt

- `support.js` (the design-canvas runtime) is intentionally duplicated 4× — see
  `CHANGELOG.md`. All copies must change together.
- The iOS Simulator cannot hold an HTTP/3 connection to Supabase, so Simulator QA
  runs through `scripts/sim-supabase-proxy.mjs`. This is an environment
  limitation, not app code — see [`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

## Security Concerns

- **RLS is verified by execution**, not by reasoning: 14/14 live checks pass
  (`supabase/tests/live-rls-check.mjs`). Role escalation, phone/id rewriting,
  fabricated inserts and deletes are all rejected.
- No secret is in Git. `apps/customer/.env` is gitignored, the mobile app holds
  only the anon key, and `SUPABASE_SERVICE_ROLE_KEY` appears in no app, no
  client-read `.env`, and no document.
- Payment security is **not yet assessable** — no provider, no webhook.

## Deployment Status

Not deployed. Dockerfile for the API and GitHub Actions CI exist; no hosting is
configured (Q-009 open).

## Database Status

**Live.** Supabase project `banhao-dev` in `ap-southeast-1`, PostgreSQL + PostGIS,
three migrations applied: extensions, `profiles` + roles, RLS hardening. Phone
auth enabled with Supabase Test OTP (no SMS provider). Setup:
[`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

## API Status

Foundation only — `/health` and `/api/v1/me`, with auth and role guards. No
domain endpoints. The Customer App does not call it yet; it talks to Supabase
directly for auth and `profiles`, and to mock repositories for everything else.

## Frontend Status

**Customer App implemented** — 31/31 design states in code, 31/31 verified by
screenshot on iPhone 16 Pro. Merchant, Driver and Admin are Expo/Next.js shells
with no screens.

## Admin Status

Shell only. Design not advanced beyond 3 wireframe-level screens in the Product
Architecture canvas.

## Merchant Status

Shell only. Design not advanced beyond 1 wireframe-level screen.

## Customer Status

**Implemented and QA'd.** 31/31 states verified by screenshot; authentication
verified end-to-end against the live project; money arithmetic checked. Five
defects found and fixed. Android remains **UNVERIFIED**.

## Rider (Driver) Status

Shell only. Design not advanced beyond 4 wireframe-level screens.

## Explicitly UNVERIFIED

Do not read the above as full verification. These have not been tested:

- **Android** — no SDK or emulator on this machine, and it is the platform most
  likely to differ on per-weight font families
- **A physical iOS device**
- **Real SMS delivery** — no provider configured (Q-019, ~2 week lead time)
- **Keyboard avoidance**
- State variants: empty cart, loading, network error, no driver
- The search **results** list — the simulator cannot type Thai, and the mock
  catalogue is Thai-only

## Business Rules Status

**Documented, and the P0 decisions are approved** (EVENT-014, 2026-08-10,
branch `feature/p0-decisions-v1` — **DEC-016…DEC-032**, not merged to `main`).
Seven documents describe how BANHAO works as a business:
[`BUSINESS_RULES.md`](BUSINESS_RULES.md),
[`DOMAIN_MODEL.md`](DOMAIN_MODEL.md), [`ORDER_LIFECYCLE.md`](ORDER_LIFECYCLE.md),
[`RIDER_LIFECYCLE.md`](RIDER_LIFECYCLE.md),
[`PAYMENT_LIFECYCLE.md`](PAYMENT_LIFECYCLE.md),
[`SETTLEMENT_MODEL.md`](SETTLEMENT_MODEL.md),
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md).

Every rule is tagged `ACCEPTED` / `PROPOSED` / `OPEN` /
`LEGAL_REVIEW_REQUIRED`, with `ACCEPTED — MODEL · OPEN — NUMBERS` in the money
sections. **Only `ACCEPTED` may be implemented.** Seventeen decisions were
recorded; **no `Q-NNN` was resolved, no pricing was set, no provider was
selected, and no code was written.**

Two decisions change Phase 1 materially: **DEC-016** disables Cash on Delivery
(online payment only, but the cash model stays extensible), and **DEC-019**
replaces the Order state machine documented in 2026-08-09.

## Technical Architecture Status

**Designed, not approved, not built** (EVENT-015, 2026-08-11, branch
`feature/technical-architecture-v1`):
[`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md),
[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) (ADR-001…ADR-012),
[`OPEN_TECHNICAL_QUESTIONS.md`](OPEN_TECHNICAL_QUESTIONS.md) (TQ-001…TQ-016).

**Every ADR is `PROPOSED`.** No backend, migration, Supabase table, or provider
integration was created. Existing code (`PaymentProvider`, the two-client
`SupabaseService`, module rules) was reviewed and kept, not redesigned.

Three `T0` technical questions block backend work: **TQ-011** (migration
workflow), **TQ-012** (proving concurrency correctness), **TQ-008** (provider
adapter, gated on Q-001/Q-020).

## Database Design and Migration Status

**Designed (EVENT-016) → decisions locked (EVENT-017) → implemented as
migrations (EVENT-018)**, all 2026-08-11. Design:
[`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) — 46 tables conceptually, ERD,
table catalog, RLS matrix, state matrix, FK/cascade rules, justified indexes.
Questions: [`OPEN_DATABASE_QUESTIONS.md`](OPEN_DATABASE_QUESTIONS.md)
(DBQ-001…DBQ-015 — 2 answered by DEC-033/034, 1 raised by implementation).
Migration verification: [`DATABASE_MIGRATION_V1_REPORT.md`](DATABASE_MIGRATION_V1_REPORT.md).

**11 new migration files exist**, on `feature/supabase-migration-v1`,
**tested and passing (60/60 assertions), not merged, and the live
`banhao-dev` project was never modified** — no `supabase db push`, no
`supabase link`. The three original migrations remain byte-identical.

DEC-033 replaced the proposed generic `user_roles` table with **domain
membership** — Customer implicit, Merchant via `restaurant_members`, Rider via
`riders`, Operator/Admin via `platform_staff`. **Implemented with zero
`profiles.role` references in any of the 55 RLS policies.** DEC-034 removed
the proposed zero-sum constraint trigger; CON-003 stands but is enforced by
transaction-level assertion plus a **mandatory reconciliation process** —
**implemented: no zero-sum trigger exists anywhere in the schema**, verified
by grep and by reading the ledger tables' trigger definitions.

**40 application tables, 62 foreign keys, 61 check constraints, 110 indexes,
52 triggers.** The rider race condition was proven with two genuinely
concurrent `psql` client processes racing the same delivery row — not a
single-session simulation — and the architecture review's HIGH finding about
incomplete rider release was reproduced exactly (and found sharper: a hard
`unique_violation`, not a silent failure) and then fixed, both by execution.

Six tables deferred, each justified, none removed from the design:
`settlements`, `settlement_items`, `delivery_fee_bands`, `zones`,
`service_areas`, `delivery_attempts`.

**Immediate next step: architect review of the migration set**, then applying
it to `banhao-dev` (requires an explicit instruction). Alongside it: retire
`profiles.role` in `RolesGuard`/`set_user_role()`/the immutability trigger,
tracked in `docs/TODO.md`.

## Current Blockers

Product-level, not technical. **8 P0 business decisions remain, down from 15** —
`docs/TODO.md` P0 and [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md):
payment provider (Q-001), legal/settlement model (Q-002), commission **rate**
(Q-010/BQ-028), PromptPay refund mechanism (Q-020), cost of wasted food
(BQ-015), delivery and service fee **numbers** (BQ-026, BQ-027), and promotion
funding (BQ-030). The Thai legal/compliance review has external lead time and
gates all payment work.

⚠️ **DEC-016 made Q-001 and Q-020 more blocking, not less.** With cash removed,
100% of Phase 1 revenue and 100% of refunds depend on an unselected provider and
a PromptPay refund mechanism research says does not exist natively — and
disabling COD removed one of the four candidate refund mechanisms.

The two document contradictions found in EVENT-013 are **resolved** by DEC-019
and DEC-022.

## Immediate Next Step

**Architecture review of DEC-016…DEC-032, then the remaining 8 P0 business
questions.** Then close DQ-01…DQ-05
(all five are addressed — see the DQ table in
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md)) and verify the app on
Android.
