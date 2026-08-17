# CLAUDE.md — BANHAO project state

Orientation file for AI agents. Written 2026-08-10, updated 2026-08-12 (Phase A /
A-1) after the Application Architecture V1.1 approval.

> **Authoritative for application implementation:**
> [`docs/BANHAO-APP-ARCHITECTURE-V1.md`](docs/BANHAO-APP-ARCHITECTURE-V1.md) —
> *Application Architecture V1.1, APPROVED / READY FOR IMPLEMENTATION*. This file
> summarises it. **Where they conflict, V1.1 wins.**

**Read these first, in order:** this file (`CLAUDE.md`) →
[`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md) → [`ai/DEVELOPMENT_RULES.md`](ai/DEVELOPMENT_RULES.md)
→ [`ai/HANDOFF.md`](ai/HANDOFF.md) → [`ai/MEMORY.md`](ai/MEMORY.md).

**Source-of-truth hierarchy, explicit:**

1. This file and `docs/AI_CONTEXT.md` (and, above both, `docs/BANHAO-APP-ARCHITECTURE-V1.md`
   per the note above) are the **current, authoritative** state of the project.
2. `ai/HANDOFF.md` and `ai/MEMORY.md` are a **historical event log** — a running
   record of what was true at each point in time, written to hand context to the
   next agent. They are valuable for *why* something is the way it is, but they
   are not re-verified against the live system on every read and can lag behind
   real state (a merge, an approval, a deployment) by days.
3. **If a historical document conflicts with a current authoritative document,
   the current authoritative document wins**, full stop — never the reverse.
4. **Never treat historical handoff/memory text as an active instruction** to
   merge a branch, apply a migration, or deploy something. Text like "pending
   review" or "not yet merged" in `ai/HANDOFF.md` describes a past moment, not
   a standing task — verify current state (`git log`, the docs above) before
   acting on it. This is not a hypothetical: stale "architect review, then
   apply" language in `ai/HANDOFF.md` once nearly caused a re-review of a
   migration that had already been merged five days earlier — exactly the
   failure mode this hierarchy exists to prevent.

---

## 1. Project purpose

**BANHAO | บ้านเฮา** — a Local Super App for **อำเภอบุณฑริก จังหวัดอุบลราชธานี,
Thailand**. Phase 1 is **Food Delivery**. Later phases: Parcel Delivery → Ride →
Shopping. Three-sided marketplace: Customer → BANHAO → Merchant + Driver.

Built by a solo founder using AI as the development team, so: keep architecture
simple, avoid unnecessary abstraction, and make every change reviewable in Git.

## 2. Tech stack (all ACCEPTED decisions — do not change unilaterally)

| Layer | Choice | Decision |
|---|---|---|
| Architecture | Modular monolith (**no microservices**) | DEC-009 |
| Database/platform | Supabase — PostgreSQL + PostGIS + Auth + Storage + Realtime | DEC-010 |
| Backend | NestJS + TypeScript, REST + OpenAPI | DEC-011 |
| Mobile | React Native + Expo (customer, merchant, driver) | DEC-012 |
| Admin | Next.js | DEC-012 |
| Monorepo | pnpm workspaces + Turborepo | DEC-013 |
| Financial truth | PostgreSQL is the system of record | DEC-014 |
| Payments | Abstraction only — **no provider selected** | DEC-015 |

Fonts: **IBM Plex Sans Thai** 400/500/600/700, bundled via
`@expo-google-fonts/ibm-plex-sans-thai` (no runtime fetch).

## 3. Current branch

```
main @ 14289652                   ← YOU ARE HERE — everything below is merged
  e471ec1d                           supabase-migration-v1 merged (DB checkpoint)
  14289652                           Application Architecture V1.1 added
```

**All feature branches are merged into `main`.** `feature/supabase-migration-v1`,
`feature/database-design-v1`, `feature/technical-architecture-v1`,
`feature/p0-decisions-v1`, `feature/business-rules`, `feature/customer-app` and
`feature/supabase-customer-auth` still exist remotely but are now fully contained
in `main`. **Branch new work from `main`.**

`e471ec1d` is the **database checkpoint** — the commit V1.1 was reviewed against
and the point at which the schema is LOCKED.

## 4. Completed work

| Event | What |
|---|---|
| EVENT-001…003 | Design drop, repo reorganisation, AI Memory v1 |
| EVENT-004 | AI Memory v2 — typed knowledge base (`ai/KNOWLEDGE/`) |
| EVENT-005 | Architecture research — 28 docs in `ai/RESEARCH/`, all sourced |
| EVENT-006 | Application foundation — monorepo, NestJS API, migrations, CI |
| EVENT-007 | Pre-merge RLS hardening, verified by execution |
| EVENT-008 | Customer App — all 31 design states implemented |
| EVENT-009 | Typography fix (IBM Plex Sans Thai bundled) + visual QA |
| EVENT-010 | Supabase dev project + live customer auth verification |
| EVENT-011 | DEF-01…DEF-05 fixed, re-verified; visual QA 31/31 |
| EVENT-012 | Reviewed and merged to `main` |
| EVENT-013 | Business Rules & Domain Model — 7 documents, 39 open business questions, no code |
| EVENT-014 | P0 Business Decisions v1 approved — DEC-016…DEC-032 locked, no code |
| EVENT-015 | Technical Architecture v1 — ADR-001…012, TQ-001…016, no code |
| EVENT-016 | Supabase Database Design v1 — 46 tables, DBQ-001…014, no migration |
| EVENT-017 | Database architecture decisions locked — DEC-033 (multi-role identity), DEC-034 (no zero-sum trigger) |
| EVENT-018 | Supabase Migration v1 — 11 new migrations (16 total), 40 tables, 60/60 assertions pass |
| EVENT-019 | Migration set merged to `main` at `e471ec1d`; applied to `banhao-dev`. **Database V1 LOCKED** |
| EVENT-020 | Application Architecture V1.1 — 12 `DEC-APP` decisions, 9 phases + F′, **APPROVED** |
| **EVENT-021** | **Phase A / A-1 — stale documentation reconciled to V1.1; ADR-001…012 recorded `ACCEPTED`** (this update) |

## 5. Current implementation status

| Area | Status |
|---|---|
| Customer App UI | **DONE** — 31/31 states (18 numbered + 7 payment sub-states + 6 variants) |
| Customer navigation | DONE — 4 tabs per design + auth stack |
| Design tokens & components | DONE — `packages/ui` |
| Supabase Auth (Phone OTP) | **Configured live**; app-side flow written |
| `profiles` + RLS | **DONE and live-verified** |
| Mock repositories | DONE — everything except auth/profiles is mock-backed |
| NestJS API | Foundation only — `/health`, `/api/v1/me` |
| Merchant / Driver / Admin apps | **Not started** (shells only) |
| Orders, payments, dispatch, settlement | **Not started — deliberately** |

**No business logic exists.** No order creation, payment integration, dispatch,
or settlement. That is intentional, not an omission.

**The business rules are written down, and their P0 decisions are approved**
(EVENT-014, **DEC-016…DEC-032**). The seven business documents tag every rule
`ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`, with
`ACCEPTED — MODEL · OPEN — NUMBERS` used deliberately in the money sections.
**Build only on `ACCEPTED`.** 8 P0 business questions remain, down from 15 —
and every one of them is a number, a provider, or a legal question.

Decisions that change how anything gets built:

| | |
|---|---|
| **DEC-016** | **Phase 1 is online payment only. COD is disabled** — but `payment_method` must stay extensible, and DEC-004 / REQ-001 stay accepted for when COD returns |
| **DEC-017** | One cart = one restaurant |
| **DEC-018** | **Order, Payment, Delivery, Settlement are four separate state domains.** No mega-enum |
| **DEC-019** | New Order lifecycle: `CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED → PREPARING → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED`, with `PREPARING` ∥ `RIDER_SEARCHING`. **Supersedes the design canvas's 12 states** |
| **DEC-020/021/022** | Broadcast → first accept from `MERCHANT_ACCEPTED`; rider cancellation reassigns and never cancels the order; no-rider escalates to an operator and never auto-cancels |
| **DEC-023/024/025** | Delivery fee, service fee and commission — **models accepted, every number still OPEN** |
| **DEC-026…030** | Settlement is its own domain; refund lives in payment; idempotency, late payment and duplicate-payment protection required |
| **DEC-031/032** | Manual operations and operator fallback are intentional Phase 1 capabilities. **No Admin App yet** |

**The technical architecture is designed but not approved** (EVENT-015,
**ADR-001…ADR-012, every one `PROPOSED`**). Spine: **NestJS writes, clients
read, Postgres decides** — domain tables grant no write access to
`authenticated`, and RLS is defence in depth, not authorization. Concurrency is
a guarded conditional `UPDATE` with the state check in the `WHERE` clause.
Three `T0` technical questions block backend work: TQ-008, TQ-011, TQ-012.

**The database is designed AND implemented as migrations** (EVENT-016 design →
EVENT-017 DEC-033/034 lock → EVENT-018 migration). **16 migration files, 40
tables, merged to `main` at `e471ec1d` and applied to `banhao-dev` — the schema
is LOCKED.** Verified by two Docker-based test
suites: **60/60 assertions pass**, including the rider race condition proven
with two genuinely concurrent `psql` processes (see
`docs/DATABASE_MIGRATION_V1_REPORT.md`). The live `profiles` RLS pattern
(**revoke-first**, column grants, policies `to authenticated`, trigger
backstop) is the template every table follows. DEC-017 is enforced by
composite foreign keys (proven: a cross-restaurant cart_item is rejected).
DEC-033 is implemented with zero `profiles.role` references in any policy.
DEC-034 is implemented with no zero-sum trigger — immutability yes, zero-sum
no. Six tables deferred (settlements, settlement_items, delivery_fee_bands,
zones, service_areas, delivery_attempts), each justified, none removed from
the design.

**All 31 Customer states are verified by screenshot** and all five defects
found in review (DEF-01…DEF-05) are fixed and re-verified on device — see
§8 and `docs/CUSTOMER_APP_VISUAL_QA.md`.

## 6. Key files

```
apps/customer/
  App.tsx                     font loading gate + providers
  src/navigation/             RootNavigator (session-driven tree), types
  src/screens/                31 states; payment.tsx holds 12–12h
  src/hooks/                  useAuth (Supabase), useCart, useAsyncData
  src/lib/supabase.ts         anon-key client — NEVER add the service role key
  src/repositories/index.ts   swap point: mock → real API
  src/mocks/                  design-derived data + pricing (SAMPLE values)
  .env                        LOCAL ONLY, gitignored, never commit

packages/
  ui/src/theme/tokens.ts      design tokens; fontFamily per weight
  ui/src/components/          Button, primitives, domain components
  types/ validation/ config/ api-client/

apps/api/src/                 NestJS: guards, modules, PaymentProvider abstraction
supabase/migrations/          3 migrations (extensions, profiles+roles, RLS hardening)
supabase/tests/               rls_profiles_test.sql (pg shim) + live-rls-check.mjs (LIVE)

docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md   design audit, DQ-01…05
docs/CUSTOMER_APP_VISUAL_QA.md            what is and is not verified
docs/CUSTOMER_APP_ASSETS.md               fonts, placeholders

docs/BUSINESS_RULES.md            master business rules, status-tagged
docs/DOMAIN_MODEL.md              PROPOSED entities, aggregates, ER diagrams
docs/ORDER_LIFECYCLE.md           order states, timeouts, cancellation matrix
docs/RIDER_LIFECYCLE.md           dispatch models, no-rider ladder, cash
docs/PAYMENT_LIFECYCLE.md         payment/refund states, idempotency, PromptPay
docs/SETTLEMENT_MODEL.md          ledger accounts, worked examples, payouts
docs/OPEN_BUSINESS_QUESTIONS.md   BQ-001…BQ-039 — read before any domain work

docs/BANHAO-APP-ARCHITECTURE-V1.md  ★ AUTHORITATIVE — V1.1, APPROVED.
                                    DEC-APP-001…012, 9 phases + F′. Read first.
docs/ARCHITECTURE.md              the system as built — orientation summary
docs/CURRENT_STATUS.md            what works, what does not, what is unverified
docs/TECHNICAL_ARCHITECTURE.md    how the decisions get built
docs/ARCHITECTURE_DECISIONS.md    ADR-001…ADR-012, all ACCEPTED (V1.1 §16)
docs/OPEN_TECHNICAL_QUESTIONS.md  TQ-001…TQ-016 — read before backend work

docs/DATABASE_DESIGN.md           46 tables, ERD, RLS matrix — APPROVED (DEC-033/034)
docs/OPEN_DATABASE_QUESTIONS.md   DBQ-001…DBQ-015 — 2 answered, 1 new
docs/DATABASE_MIGRATION_V1_REPORT.md  16 migrations, 40 tables, 60/60 tests pass

supabase/migrations/*.sql          16 migrations — LOCKED, do not edit or add
```

## 7. Database / Supabase status

**Development project — created 2026-08-09, this session.**

| Item | Value |
|---|---|
| Name | `banhao-dev` |
| Ref | `yssnwnboiwldogmlvvlw` |
| Region | `ap-southeast-1` (Singapore) — closest available to Thailand |
| Org | `kmandev's Org` (also holds an unrelated `videoup` project) |
| Postgres | 17.6 + PostGIS |
| Migrations | **All 16 applied live · 0 pending · schema LOCKED at `e471ec1d`** |
| Auth | Phone provider **enabled**; **Test OTP** configured (no SMS provider) |
| Test numbers | `+66812345678` → `123456`, `+66899999999` → `654321` |

Credentials live in `apps/customer/.env` (gitignored). **No secret is in Git.**
The DB password is not stored in the repo at all.

**LIVE RLS verification — 14/14 PASSED** (`supabase/tests/live-rls-check.mjs`,
run against the real project via real Auth sessions, not the pg shim):

- Profile row auto-created by trigger; `profiles.id` = `auth.users.id`
- Role defaults to `CUSTOMER`
- Customer cannot read another customer's profile (unfiltered select → 1 row)
- Role escalation, phone change, id change, insert, delete → all rejected (42501)
- `display_name` update → allowed
- Signed-out client reads nothing

## 8. Last completed task (EVENT-011, done) — merged to main

Connect the Customer App to the real Supabase dev project, QA it honestly, fix
everything review found, and merge. **All complete.**

Verified live against `banhao-dev`: request OTP → wrong OTP rejected by the
server → correct OTP → profile read under RLS → `display_name` write
(`204 PATCH`) → session survives a full app restart → logout → logout persists
across another restart. **No fake session was created.**

Visual QA: **31/31 states verified by screenshot** (artifacts in
`docs/qa/customer-app/`). Money arithmetic checked, not assumed.

**Five defects found in review — all fixed and re-verified on device**
(`docs/CUSTOMER_APP_VISUAL_QA.md`):

| ID | Severity | Finding | Fix |
|---|---|---|---|
| DEF-01 | **MAJOR** | `PayExpired` (12e) unreachable — QR counted to zero and navigated nowhere | `replace()`s to `PayExpired` at TTL 0; verified by letting the real 600s countdown elapse, not a shortened timer |
| DEF-02 | MINOR | `ขอรหัสใหม่` reset the countdown but never resent the OTP | now calls `requestOtp`; countdown only resets on success |
| DEF-03 | MINOR | Back labels read "Tabs" / "Back" in English | explicit `headerBackTitle: 'กลับ'` |
| DEF-04 | MINOR | `✓` (U+2713) substituted to a glyph reading as `√` | check mark is now drawn, not typed — no font dependency |
| DEF-05 | MINOR | Profile phone shown unformatted, without `+` | `formatThaiPhone` — presentation only, stored E.164 identity untouched |

22 tests added for the fixes. Full quality gate (lint/typecheck/test/build) was
re-run and passed both before and after the merge to `main`.

### ⚠️ iOS Simulator cannot hold HTTP/3 to Supabase

First HTTPS request succeeds, then every one after it fails with
`Network request failed`. The response advertises `alt-svc: h3`, CFNetwork
switches to QUIC and the connection dies (`-1005`). Survives app restart and
Simulator reboot. Use `scripts/sim-supabase-proxy.mjs` for Simulator QA — it
forwards verbatim to the real project and mocks nothing. Full evidence in
`docs/SUPABASE_DEVELOPMENT.md`. Untested on hardware and on Android.

Also note: `EXPO_PUBLIC_*` is inlined at transform time. After editing
`apps/customer/.env` you must restart Metro with `--clear` **and**
terminate/relaunch Expo Go — reloading is not enough.

## 9. Next steps

**Build the approved application architecture**, phase by phase, from
[`docs/BANHAO-APP-ARCHITECTURE-V1.md`](docs/BANHAO-APP-ARCHITECTURE-V1.md)
(V1.1 — APPROVED / READY FOR IMPLEMENTATION). That document is authoritative;
this file summarises it.

**Nine phases, in order.** Each depends on the one before unless stated:

| Phase | What | State |
|---|---|---|
| **A** | Foundation hardening — docs, error envelope + `correlationId`, webhook raw body, `worker.ts`, `/internal/tick`, deploy workflows, Sentry | **IN PROGRESS** |
| **B** | Identity & capability resolution — DEC-APP-004, membership-based guards | Next |
| **C** | Catalog & merchant read path — replaces the customer app's mocks | |
| **D** | Cart | |
| **E** | Order — nine ACCEPTED states plus `CANCELLED`, as commands | |
| **F** | Payment on `NullPaymentProvider` — ledger must balance to zero | |
| **G** | Rider & delivery — depends on E, **not** F | |
| **H** | Notification — outbox via the tick | |
| **I** | Admin operations | |
| **F′** | Real payment provider — externally blocked; may land any time after F | |

**Phase A local validation gate — do not skip, do not reorder:**
implementation → local build → local tests → API starts in Docker locally →
API integration tests → **only then** Cloud Run.

Running alongside, not blocking:

1. **Answer the remaining 8 P0 items in `docs/OPEN_BUSINESS_QUESTIONS.md`** —
   Q-001, Q-002, Q-010/BQ-028, Q-020, BQ-015, BQ-026, BQ-027, BQ-030. Every
   structural question is answered; what is left is numbers, the provider, and
   legal. **These block F′ only** — DEC-APP-007 keeps them off the critical path
   for the other eight phases.
2. Commission the Thai legal/compliance review (Q-002, Q-012, Q-015, Q-017) —
   external lead time, gates real-money work.
3. Verify on an Android emulator — per-weight Thai font families are untested and
   are the single most likely rendering failure.
4. Verify the search **results** list and keyboard avoidance on a device that
   can type Thai (the Simulator cannot).

**Do not start Phase F′ or any settlement work** (settlement needs six deferred
tables and a Product Owner decision). **Do not touch the database.**

## 10. Decisions and constraints

**Non-negotiable (from `AGENTS.md` / `ai/KNOWLEDGE/CONSTRAINTS.md`):**

- **CON-001** Order State and Payment State are separate machines — never merged.
- **CON-002** Only a signature-verified provider webhook may confirm a payment.
  A client screen must never decide a payment succeeded.
- **CON-003** Every order's ledger balances to exactly zero. Money is **integer
  satang** — never floating point.
- **CON-005** No secrets in Git. `SUPABASE_SERVICE_ROLE_KEY` must never appear
  in any mobile or browser bundle.
- Payment provider SDKs may only be imported under `payments/providers/`.

**Working rules:**

- The **design artifact is the source of truth** for Customer App UI:
  `design/customer/BANHAO Customer App.dc.html`. Do not re-design; record a
  `DESIGN_QUESTION` instead of guessing.
- **Never fabricate a session** to make authenticated screens reachable.
- Never mark a screen `MATCH` without a screenshot. `UNVERIFIED` is an
  acceptable answer; a false `MATCH` is not.
- Mock data belongs in `src/mocks/` behind a repository — never inside a UI
  component.
- Every text style needs an explicit `fontFamily` — `fontSize` alone silently
  falls back to the system face.
- Do not add a text style, dependency, or migration without a stated reason.
- **Implement only rules tagged `ACCEPTED`.** `PROPOSED` is analysis awaiting
  approval; `OPEN` means it is undecided and guessing is forbidden.
- Sample figures are not rules: 10% commission, ฿15 delivery, ฿5 service and the
  ฿10 `BANHAO7` coupon are all illustrative. **DEC-025 says so explicitly of the
  10%.**
- Do not enable cash payment (DEC-016) — and do not delete the cash model either.
- Do not use the superseded order state names (`NEW`, `ACCEPTED`, `READY`,
  `DRIVER_ASSIGNED`, `COMPLETED`, `NO_DRIVER`) in new work.
- **ADR-001…012 are `ACCEPTED`**, ratified unchanged by V1.1 §16, and the 12
  `DEC-APP` decisions in V1.1 build on them. Implement them. **Precedence is
  `DEC-` > `DEC-APP-` > `ADR-`** — a business decision always wins, and if an
  `ADR` appears to contradict a `DEC`, the `ADR` is the bug.
- **Any deviation from V1.1 requires a new Architecture Decision**, not an
  improvisation. If something looks like it needs an architectural change, stop
  and report it.
- Never `SELECT`-then-check-then-`UPDATE` a guarded table — the state check goes
  in the `WHERE` clause (ADR-003).
- **16 migrations are merged and the schema is LOCKED at `e471ec1d`.** Read
  `docs/DATABASE_MIGRATION_V1_REPORT.md` before going near them. Do not add a
  table, view, RLS policy, RPC, or migration, and never run `supabase db push`
  or `supabase link`, without an explicit instruction.
- **Do not weaken the two structural safeguards** in the deployed schema: the
  rider views' `security_barrier = true` (load-bearing, not cosmetic) and
  `release_rider_assignment()`'s `SECURITY INVOKER` + `service_role`-only
  EXECUTE.
- Every new table needs `revoke ... from anon, authenticated` **first** —
  Supabase grants `ALL` on public tables by default.

**Open questions blocking real money — and only real money:** Q-001 payment
provider, Q-002 legal settlement model, Q-010 platform fee, Q-020 PromptPay
refund mechanism (no provider supports native PromptPay refunds — see
`ai/RESEARCH/PAYMENT_RESEARCH.md`). Under **DEC-APP-007** these gate **Phase F′
only**; build the whole order → delivery flow against `NullPaymentProvider`. The
schema stores **amounts, never rates**, so the open numbers can be set later
without a migration — **do not invent a default anywhere in the application.**

**Known gaps:** Android is **UNVERIFIED** (no SDK on this machine, and it is the
platform most likely to differ on per-weight fonts). A physical iOS device, real
SMS delivery, keyboard avoidance, the search **results** list, and four state
variants (empty cart, loading, network error, no driver) are also unverified —
see `docs/CUSTOMER_APP_VISUAL_QA.md`. All 31 states themselves are verified.

**Scope discipline (replaces the pre-V1.1 scope lock).** The Merchant, Driver and
Admin apps, the order backend, dispatch and payment are **no longer out of
scope** — they are Phases C through I of an approved roadmap. What is required is
that they are built **in phase order, one phase at a time**, not opportunistically:

- Build only the current phase. Do not start the next one early.
- **Still hard-locked:** Phase F′ (real payment provider) and settlement.
- **Still hard-locked:** the database. No migration, no schema change.
- Merchant's approved target is **Next.js web**, not Expo (DEC-APP-003).
