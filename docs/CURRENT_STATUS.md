# Current Status

## Last Updated

2026-08-12 — Phase A / A-1 (documentation reconciliation).

> **Historical note.** Until 2026-08-09 this file correctly read *"No application
> exists."* Until 2026-08-12 it reported **three** migrations applied and eleven
> unmerged, with the live project never modified — accurate on 2026-08-10, stale
> after the migration work landed on 2026-08-11. Both earlier states are preserved
> in [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) and in Git history; nothing has
> been erased, only superseded.

## Overall Status

**Application code exists and runs. The database is deployed and locked. The
application architecture is approved.** What does not exist is business logic —
no order creation, payment integration, dispatch, or settlement. That is
deliberate, not an omission.

Phase A (foundation hardening) is **in progress**; A-1 is this documentation
reconciliation.

## Authoritative Baseline

| | |
|---|---|
| Branch | `main` |
| Current commit | `14289652` |
| Database checkpoint | `e471ec1d` — **LOCKED** |
| Application architecture | [`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md) — V1.1, **APPROVED / READY FOR IMPLEMENTATION** |

V1.1 is the authoritative source for application implementation: 12 `DEC-APP`
decisions, 9 phases plus F′, no database redesign. Where any other repository
document conflicts with it, **V1.1 wins**. A `DEC-NNN` business decision still
outranks both.

## Current Phase

Phase 1 — Food Delivery. **Phase A of the application roadmap: foundation
hardening.**

The nine phases: **A** foundation → **B** identity & capability → **C** catalog →
**D** cart → **E** order → **F** payment (null provider) → **G** rider &
delivery → **H** notification → **I** admin operations. **F′** (real payment
provider) is externally blocked and can land any time after F.

## Working Features

- **Customer App (React Native + Expo)** — all 31 design states; 4-tab
  navigation; design tokens and shared components in `packages/ui`.
- **Phone OTP authentication** against the live `banhao-dev` Supabase project —
  request OTP, verify, resend, session persistence across app restart, logout.
- **`profiles` read/write under RLS** — a customer can read only its own row and
  write only `display_name`. Verified by execution.
- **NestJS API foundation** — `GET /health`, `GET /api/v1/me`, global Supabase
  JWT auth guard, role guard, response envelope, OpenAPI.
- **Deployed database** — 16 migrations, 40 application tables, RLS on every one.
- **Monorepo tooling** — pnpm + Turborepo; lint, typecheck, test and build all
  pass; GitHub Actions CI with four jobs.

## Partially Working

- **Payment screens (12, 12b–12h)** render every payment **state**, but no
  provider is integrated (Q-001 `OPEN`, DEC-015). The QR is a labelled
  placeholder and the transitions on 12b are marked `จำลอง:`. CON-002 means only
  a signature-verified provider webhook may ever confirm a payment.
- **Order tracking (14)** renders the status timeline, but the map is a labelled
  placeholder pending a maps provider (Q-018).
- **API error contract** — the success envelope is correct; the error envelope is
  not yet contract-compliant. See "Code Diverging From Approved Decisions".

## Mock / Placeholder

- Everything except authentication and `profiles` is **mock-backed** through
  `apps/customer/src/repositories/` — shops, menu, cart pricing, orders,
  notifications, addresses. Mock data lives in `apps/customer/src/mocks/` and is
  labelled `(ตัวอย่าง)` on screen. That repository seam is the designated swap
  point for Supabase-backed reads in Phase C.
- `design/tracking/tracking-map.html` — Leaflet prototype with mock coordinates.

## Not Implemented

- Order backend, dispatch, settlement, ledger writes
- Payment provider integration and webhooks
- Merchant, Driver and Admin apps (shells only)
- `worker.ts`, `/internal/tick`, outbox dispatch
- Storage, Realtime, notifications
- Production deployment (Docker + CI exist; nothing is hosted)

## Known Bugs

None open. Five defects found in the 2026-08-10 QA pass (DEF-01…DEF-05) are all
fixed and merged — see [`CUSTOMER_APP_VISUAL_QA.md`](CUSTOMER_APP_VISUAL_QA.md).

## Code Diverging From Approved Decisions

Not bugs — the code was correct when written and later decisions moved the
target. Each has an assigned phase; none is to be fixed opportunistically.

| Divergence | Conflicts with | Assigned |
|---|---|---|
| `RolesGuard` authorizes on `profiles.role`, a column **no RLS policy consults** | DEC-033, **DEC-APP-004** | **Phase B** |
| `HttpExceptionFilter` derives `error.code` from HTTP status; no `correlationId`; `message` required | V1.1 §6/§10 error contract | **Phase A / A-2–A-4** |
| No raw-body handling or envelope exclusion for `/webhooks/*` | **DEC-APP-005** | **Phase A / A-5** |
| `apps/customer/src/mocks/types.ts` encodes the superseded 12 order states | **DEC-019** | Phase C/E |
| Checkout (screen 10) still offers a cash option and prepared-amount selector | **DEC-016** — COD disabled | Phase C/E |

`RolesGuard` is inert today — no route uses `@Roles()` — but the divergence
between application authorization and database RLS is silent, which is why
DEC-APP-004 exists.

## Technical Debt

- **Database test harness pins PostgreSQL 16; production runs 17.**
  `supabase/tests/run-domain-tests.sh` and `run-rls-tests.sh` default to
  `postgis/postgis:16-3.4`, so the CI `rls` job validates against a different
  major version than the deployed database. Overridable via the existing `IMAGE`
  environment variable.
- `support.js` (the design-canvas runtime) is intentionally duplicated 4× — see
  `CHANGELOG.md`. All copies must change together.
- The iOS Simulator cannot hold an HTTP/3 connection to Supabase, so Simulator QA
  runs through `scripts/sim-supabase-proxy.mjs`. An environment limitation, not
  app code — see [`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

## Security Concerns

- **RLS is verified by execution**, not by reasoning. Role escalation, phone/id
  rewriting, fabricated inserts and deletes are all rejected.
- Two structural fixes are in the deployed schema and must not be weakened: the
  rider's column-scoped views (`security_barrier = true` is load-bearing, not
  cosmetic) and `release_rider_assignment()` (`SECURITY INVOKER`,
  `service_role`-only EXECUTE, atomic release invariant).
- No secret is in Git. `apps/customer/.env` is gitignored, the mobile app holds
  only the anon key, and `SUPABASE_SERVICE_ROLE_KEY` appears in no app, no
  client-read `.env`, and no document.
- Payment security is **not yet assessable** — no provider, no webhook.

## Deployment Status

**Not deployed.** The API Dockerfile and GitHub Actions CI exist and pass; no
hosting is configured yet.

Approved targets (V1.1 §12): Cloud Run `asia-southeast3` (Bangkok), request-based
billing, `min-instances=0` (DEC-APP-009); Cloudflare Pages for the web apps;
Cloudflare Worker cron for the tick (DEC-APP-010). Architectural target $0/month
— a free-tier assumption, not a guarantee; the Cloud Run / Bangkok pricing
figures carry `COST VERIFICATION REQUIRED`.

Deployment happens only after the Phase A local validation gate passes:
build → tests → local Docker boot → API integration tests → **then** Cloud Run.

## Database Status

**Live and LOCKED at checkpoint `e471ec1d`.** Supabase project `banhao-dev`,
`ap-southeast-1`, PostgreSQL 17.6 + PostGIS.

**16 migrations, 0 pending, no migration divergence.** 40 application tables, 62
foreign keys, 61 check constraints, 110 indexes, 52 triggers, across ten domains.
Phone auth enabled with Supabase Test OTP (no SMS provider). Setup:
[`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

> **Provenance of the deployment claim.** That the 16 migrations are *applied to
> the live project* is recorded per the approved V1.1 §0 and the Product Owner's
> Phase A brief (16/16 applied, 0 pending, live security verification 38/38
> executable checks passed). It was **not** re-verified against the live project
> by the A-1 task, which is read-only with respect to the database.
>
> This **supersedes, on that point only**, the preamble of
> [`DATABASE_MIGRATION_V1_REPORT.md`](DATABASE_MIGRATION_V1_REPORT.md), which
> states the live project was never touched. That statement was accurate for the
> migration-authoring task it documents; the application step happened
> afterwards. The report's verification content remains valid and unchanged.

DEC-033 replaced the proposed generic `user_roles` table with **domain
membership** — Customer implicit, Merchant via `restaurant_members`, Rider via
`riders`, Operator/Admin via `platform_staff` — implemented with **zero
`profiles.role` references in any deployed RLS policy**. DEC-034 removed the
proposed zero-sum trigger; CON-003 stands, enforced by transaction-level
assertion plus mandatory reconciliation.

Six tables deferred, each justified, none removed from the design: `settlements`,
`settlement_items`, `delivery_fee_bands`, `zones`, `service_areas`,
`delivery_attempts`. Settlement is therefore **not buildable in V1** —
reconciliation via `reconciliation_cases` satisfies DEC-034 instead.

**Do not run `supabase db push` or `supabase link`, and do not add a migration,
table, view, policy or RPC, without an explicit instruction.**

## API Status

Foundation only — `/health` and `/api/v1/me`, with auth and role guards, response
envelope and OpenAPI. No domain endpoints.

The Customer App does not call it yet; it talks to Supabase directly for auth and
`profiles`, and to mock repositories for everything else. Under DEC-APP-008 that
direct-read path is **correct and stays** — reads go client → Supabase under RLS,
writes go client → API → Supabase.

## Frontend Status

**Customer App implemented** — 31/31 design states in code, 31/31 verified by
screenshot on iPhone 16 Pro. Merchant, Driver and Admin are shells with no
screens. Merchant's approved target is Next.js web (DEC-APP-003), not Expo.

## Admin / Merchant / Rider Status

Shells only. Design has not advanced beyond the wireframe-level screens in the
Product Architecture canvas (3 admin, 1 merchant, 4 driver). Admin operations are
Phase I; rider and delivery are Phase G.

## Customer Status

**Implemented and QA'd.** 31/31 states verified by screenshot; authentication
verified end-to-end against the live project; money arithmetic checked. Five
defects found and fixed. Android remains **UNVERIFIED**.

## Explicitly UNVERIFIED

Do not read the above as full verification. These have not been tested:

- **Android** — no SDK or emulator on this machine, and it is the platform most
  likely to differ on per-weight Thai font families. Raised in priority by V1.1
  §20; a Phase A manual checklist item.
- **A physical iOS device**
- **Real SMS delivery** — no provider configured (Q-019, ~2 week lead time)
- **Keyboard avoidance**
- State variants: empty cart, loading, network error, no driver
- The search **results** list — the simulator cannot type Thai

## Business Rules Status

**Documented, and the P0 decisions are approved** — DEC-016…DEC-032, merged.
Seven documents describe how BANHAO works as a business:
[`BUSINESS_RULES.md`](BUSINESS_RULES.md), [`DOMAIN_MODEL.md`](DOMAIN_MODEL.md),
[`ORDER_LIFECYCLE.md`](ORDER_LIFECYCLE.md),
[`RIDER_LIFECYCLE.md`](RIDER_LIFECYCLE.md),
[`PAYMENT_LIFECYCLE.md`](PAYMENT_LIFECYCLE.md),
[`SETTLEMENT_MODEL.md`](SETTLEMENT_MODEL.md),
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md).

Every rule is tagged `ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`,
with `ACCEPTED — MODEL · OPEN — NUMBERS` in the money sections. **Only `ACCEPTED`
may be implemented.**

Two decisions change Phase 1 materially: **DEC-016** disables Cash on Delivery
(online payment only, cash model retained and extensible), and **DEC-019**
replaces the 2026-08-09 Order state machine.

## Technical Architecture Status

**Approved and ratified.** [`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md)
and [`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md) — **ADR-001…ADR-012
are `ACCEPTED`**, ratified unchanged by V1.1 §16. The application-level decisions
that build on them are the 12 `DEC-APP` entries in V1.1.

Open technical questions: [`OPEN_TECHNICAL_QUESTIONS.md`](OPEN_TECHNICAL_QUESTIONS.md).
TQ-005 (hosting) and TQ-009 (secrets) are answered by DEC-APP-009/010 and the
Cloud Run secret store. TQ-008 remains gated on Q-001/Q-020.

## Current Blockers

Product-level, not technical. **8 P0 business decisions remain** — see
`docs/TODO.md` P0 and [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md):
payment provider (Q-001), legal/settlement model (Q-002), commission **rate**
(Q-010/BQ-028), PromptPay refund mechanism (Q-020), cost of wasted food (BQ-015),
delivery and service fee **numbers** (BQ-026, BQ-027), promotion funding (BQ-030).
The Thai legal/compliance review has external lead time and gates payment work.

⚠️ **DEC-016 made Q-001 and Q-020 more blocking, not less.** With cash removed,
100% of Phase 1 revenue and 100% of refunds depend on an unselected provider and
a PromptPay refund mechanism research says does not exist natively.

**None of these block Phases A through E, G, H or I.** DEC-APP-007 is explicit:
build the whole order → delivery flow against `NullPaymentProvider`, and gate only
real money on F′. The open numbers are safe to defer because the schema stores
**amounts, never rates** — they can be set without a migration. Do not invent a
default anywhere in the application.

## Immediate Next Step

**Phase A, in V1.1 §19's order:** (1) this documentation reconciliation — done;
(2) the error envelope, correlation id, and webhook raw-body handling;
(3) `worker.ts` + `/internal/tick` + the Cloudflare Worker cron; (4) deploy
workflows, after the local validation gate passes.

Then **Phase B**, because DEC-APP-004 blocks every merchant and rider endpoint.

Do not start Phase F′ or any settlement work. Do not touch the database.
