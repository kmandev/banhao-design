# CLAUDE.md — BANHAO project state

Orientation file for AI agents. Written 2026-08-10, updated 2026-08-12 (Phase A /
A-1) after the Application Architecture V1.1 approval; reconciled 2026-08-30
(D-7) to the actual repository state after Phases B–D, E (foundation), and G
(rider/delivery, incl. G7 proof-of-delivery) work landed.

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

`e471ec1d` is the **database checkpoint** — the commit V1.1 was reviewed against.
Six further migrations have since been merged on top of that checkpoint as
part of Phase C/E/G, merchant M-05 and merchant M-11/M-12 work (catalog
availability visibility, the order creation function, the rider
release/reconciliation invariant, the `orders` Realtime publication,
`orders.prep_minutes`, and the four merchant catalog-write functions — see §7),
bringing the total to 22. The **table/RLS design itself is still the one V1.1 reviewed**
— see §10 for the still-current "do not add a table/RLS policy/RPC without an
explicit instruction" rule.

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
| EVENT-021 | Phase A / A-1 — stale documentation reconciled to V1.1; ADR-001…012 recorded `ACCEPTED` |
| EVENT-022 | Phases B–D and Phase E order foundation built: identity/address APIs, catalog read path, cart/checkout, order creation |
| EVENT-023 | Phase G rider/delivery work: dispatch broadcast, pickup/en-route/arrival/completion transitions, delivery release + reconciliation, proof-of-delivery (driver capture, storage, customer read) |
| EVENT-024 | 3 further migrations merged after the `e471ec1d` checkpoint (catalog availability visibility, order creation function, rider release/reconciliation invariant) — see §3 and §7 |
| EVENT-025 | D-7 — `CLAUDE.md` reconciled to actual repository state (migration count, app/API implementation status, G7 status) |
| EVENT-026 | Merchant app built to its MUST scope: M-01 login, M-2/M-2.6 order board, M-2.7 order actions, M-03 arrival alerting, M-04 order detail panel, M-05 accept confirmation with prep time. **M-05 live-verified end-to-end against `banhao-dev`** — see §5 and §11 |
| EVENT-027 | 2 further migrations merged (`orders` Realtime publication, `orders.prep_minutes`), bringing the total to **21**, all applied live; API `tick`/`webhook` e2e suites repaired — full suite green |
| EVENT-028 | API contract published and guarded (`docs/06-api/openapi.json` + drift test); rider controller HTTP-boundary suite; three test/build flakes removed (cross-worker port collision, a tampered-signature test passing by luck, Next typed-routes racing its own build); CI now runs the database domain suite; Phase A observability completed bar Sentry — structured JSON logging, one log line per request, `/health` database ping. `docs/CURRENT_STATUS.md` rewritten to reality |
| EVENT-029 | **M-11 menu management and M-12 opening hours built**, from the two committed design artifacts. One additive migration (**22 total**) adding four transactional catalog-write functions; 11 new merchant API endpoints; the real five-item merchant nav; both screens with their dialogs, drawers and the option editor. `day_of_week` confirmed as **0 = Sunday**, matching every existing reader — no reinterpretation, no migration (this update) |

## 5. Current implementation status

| Area | Status |
|---|---|
| Customer App UI | **DONE** — 31/31 states (18 numbered + 7 payment sub-states + 6 variants) |
| Customer navigation | DONE — 4 tabs per design + auth stack |
| Design tokens & components | DONE — `packages/ui` |
| Supabase Auth (Phone OTP) | **Configured live**; app-side flow written |
| `profiles` + RLS | **DONE and live-verified** |
| Mock repositories | **None left in the Customer app.** All nine bindings in `apps/customer/src/repositories/index.ts` are live: catalog, cart, cart validation, order creation, order history, order detail, delivery proof, notifications, addresses. The `mockRepositories` object survives only as test fixtures |
| NestJS API | 44 operations across 41 paths — identity, merchant/catalog, cart, orders (incl. pricing, delivery-proof), payments (`NullPaymentProvider`), rider/delivery (dispatch, pickup/en-route/arrival/completion, release, proof retention), storage. **The contract is `docs/06-api/openapi.json`**, generated from the real `AppModule` and guarded against drift by `apps/api/test/openapi.contract.spec.ts`; `docs/06-api/README.md` documents the envelope, the error catalogue and the guard order |
| Merchant app | **MUST scope complete** (Next.js, DEC-APP-003) — phone-OTP login, restaurant scope, the live order board with Realtime + audible arrival alerting, order detail panel, accept-with-prep-time, **M-11 menu management and M-12 opening hours**, and the real five-item nav. The documented build order M-01 → M-03 → M-04/M-05 → M-07/M-08 → M-11/M-12 is **complete**. **Not built: M-06 reject dialog (SHOULD), M-09, M-10, M-13, M-14 — all still blocked on a design artifact, none exists** |
| Driver app | **Substantial implementation** — screens and repositories for status/availability, offer inbox, active delivery, proof camera/review/upload, and navigation, backed by tests |
| Admin app | **Still a shell** — default Next.js scaffold (`layout.tsx` / `page.tsx`), no admin UI |
| Orders | Implemented in the API (creation, pricing, controller/service) and consumed by the Customer app — not the full nine-state lifecycle claimed complete, see Phase table in §9 |
| Payments | `NullPaymentProvider` implemented (service, controller, webhook simulator, attempt-expiry, event processing) — no real provider (still blocked, see §10) |
| Dispatch / delivery | Implemented in the API's rider module (broadcast dispatch, pickup/en-route/arrival/completion transitions, release + reconciliation) and the Driver app's delivery flow |
| Proof of delivery (G7) | Implemented end-to-end: driver camera capture → client-side compression + EXIF strip → presigned upload to a private R2 bucket → server-side 2 MB size enforcement → signed download URL → Customer app proof read API and viewer. Retention/purge mechanism exists, **default OFF**. See §9/§10 for phase status |
| Settlement | **Not started** — still hard-locked, see §9/§10 |

**This is implemented functionality, not a verified-complete business flow.**
The presence of these modules and screens means the corresponding code exists
and has unit/integration test coverage where noted (§4, §9) — it does not by
itself mean the full order → payment → dispatch → delivery lifecycle has been
walked end-to-end against the live system the way the Customer App's auth flow
was (§8). Treat "implemented" and "verified live" as separate claims.

**The business rules are written down, and their P0 decisions are approved**
(EVENT-014, **DEC-016…DEC-032**). The seven business documents tag every rule
`ACCEPTED` / `PROPOSED` / `OPEN` / `LEGAL_REVIEW_REQUIRED`, with
`ACCEPTED — MODEL · OPEN — NUMBERS` used deliberately in the money sections.
**Build only on `ACCEPTED`.** 7 P0 business questions remain, down from 15 —
and every one of them is a number, a provider, or a legal question. The delivery
and service fee amounts left that list on 2026-08-24 (DEC-035, DEC-036).

Decisions that change how anything gets built:

| | |
|---|---|
| **DEC-016** | **Phase 1 is online payment only. COD is disabled** — but `payment_method` must stay extensible, and DEC-004 / REQ-001 stay accepted for when COD returns |
| **DEC-017** | One cart = one restaurant |
| **DEC-018** | **Order, Payment, Delivery, Settlement are four separate state domains.** No mega-enum |
| **DEC-019** | New Order lifecycle: `CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED → PREPARING → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED`, with `PREPARING` ∥ `RIDER_SEARCHING`. **Supersedes the design canvas's 12 states** |
| **DEC-020/021/022** | Broadcast → first accept from `MERCHANT_ACCEPTED`; rider cancellation reassigns and never cancels the order; no-rider escalates to an operator and never auto-cancels |
| **DEC-023/024/025** | Delivery fee, service fee and commission — models accepted. **Delivery and service fee amounts are now approved (DEC-035, DEC-036); the commission rate is still OPEN** |
| **DEC-035/036** | **Phase 1 fees: delivery flat ฿10 (1000 satang), service fixed ฿5 (500 satang).** No distance, bands or zones in Phase 1 |
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
tables, merged to `main` at `e471ec1d` and applied to `banhao-dev`** — this was
the schema V1.1 was reviewed against. **6 further migrations have since been
merged** (EVENT-023/024/027/029) for Phase C/E/G, M-05 and M-11/M-12 needs,
bringing the current total to **22 migration files**. Verified by two Docker-based test
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

apps/api/src/                 NestJS: guards, identity, merchant/catalog, cart, orders
                               (incl. delivery-proof), payments (NullPaymentProvider),
                               rider/delivery, storage
apps/driver/                  Status/availability, offer inbox, active delivery,
                               proof camera/review/upload; screens + repositories, tested
apps/merchant/                Next.js: order board, menu management (M-11),
                               opening hours (M-12); see §11
apps/admin/                   Still a shell — see §5
supabase/migrations/          22 migration files (16 at the `e471ec1d` checkpoint + 6 since)
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
docs/CURRENT_STATUS.md            what works, what does not, what is unverified —
                                    rewritten 2026-09-01; §13 is the classified blocker list
docs/06-api/README.md             API contract: envelope, error catalogue, guard order
docs/06-api/openapi.json          generated contract, drift-guarded by a test
docs/TECHNICAL_ARCHITECTURE.md    how the decisions get built
docs/ARCHITECTURE_DECISIONS.md    ADR-001…ADR-012, all ACCEPTED (V1.1 §16)
docs/OPEN_TECHNICAL_QUESTIONS.md  TQ-001…TQ-016 — read before backend work

docs/DATABASE_DESIGN.md           46 tables, ERD, RLS matrix — APPROVED (DEC-033/034)
docs/OPEN_DATABASE_QUESTIONS.md   DBQ-001…DBQ-015 — 2 answered, 1 new
docs/DATABASE_MIGRATION_V1_REPORT.md  16 migrations at the e471ec1d checkpoint, 40 tables, 60/60 tests pass

supabase/migrations/*.sql          22 migrations (16 at checkpoint + 6 since) — do not
                                    edit an existing file; do not add a new one without
                                    an explicit instruction (see §10)
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
| Migrations | **22 in the repository · 21 applied live · 1 pending** (16 at the `e471ec1d` V1.1 checkpoint + 6 merged since for Phase C/E/G, M-05 and M-11/M-12). The pending one is `20260901000002_merchant_catalog_write_functions.sql` — additive, verified against a throwaway Postgres by 38 assertions, **not yet applied to `banhao-dev`** (applying it is an explicit instruction, not a side effect of this work) |
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
| **A** | Foundation hardening — docs, error envelope + `correlationId`, webhook raw body, `worker.ts`, `/internal/tick`, deploy workflows, Sentry | Implemented **except Sentry**. Observability completed 2026-09-01 (EVENT-028): structured JSON logging with Cloud Logging severities, one log line per request (route pattern, never an id), `/health` extended with a bounded database ping that reports `degraded` at 200 rather than making Cloud Run crash-loop. **Sentry is absent and blocked on an external account/DSN** |
| **B** | Identity & capability resolution — DEC-APP-004, membership-based guards | Implemented — identity/address APIs built (EVENT-022) |
| **C** | Catalog & merchant read path — replaces the customer app's mocks | Implemented — Customer app catalog integration built (EVENT-022) |
| **D** | Cart | Implemented — cart/checkout validation built (EVENT-022) |
| **E** | Order — nine ACCEPTED states plus `CANCELLED`, as commands | Order foundation + API built (EVENT-022); full lifecycle coverage not independently re-verified in this update |
| **F** | Payment on `NullPaymentProvider` — ledger must balance to zero | `NullPaymentProvider` module implemented (service, controller, webhook simulator, attempt-expiry, event processing) in the API; ledger-balances-to-zero property not independently re-verified in this update |
| **G** | Rider & delivery — depends on E, **not** F | Substantial implementation: dispatch broadcast, pickup/en-route/arrival/completion transitions, delivery release + reconciliation, and the G7 proof-of-delivery flow (driver capture → compressed/EXIF-stripped upload → private R2 storage → signed download → customer read UI), all with test coverage (EVENT-023). Full-phase completion not independently re-verified in this update |
| **H** | Notification — outbox via the tick | Substantially built: `outbox` table + `OutboxDispatchService` running as a tick phase (H-2), a `NotificationChannel` interface with an in-app channel, and the customer-facing `GET/PATCH /api/v1/me/notifications` wired to the Customer app (H-5A). **No push channel** — web has none by DEC-APP-003, and FCM is configured in `.env.example` but unimplemented. Full-phase completion not independently verified |
| **I** | Admin operations | Not started — Admin app is still a shell (§5), and no admin design artifact exists |
| **F′** | Real payment provider — externally blocked; may land any time after F | Still blocked, see §10 |

**Current branch context:** this branch (`feature/g7-driver-availability`) is
mid-Phase-G work (driver availability, delivery, and proof-of-delivery). The
table above reflects what commit history and the file tree evidence as
implemented, not a fresh end-to-end verification of every phase — see the
caveat in §5.

**Phase A local validation gate — do not skip, do not reorder:**
implementation → local build → local tests → API starts in Docker locally →
API integration tests → **only then** Cloud Run.

Running alongside, not blocking:

1. **Answer the remaining 7 P0 items in `docs/OPEN_BUSINESS_QUESTIONS.md`** —
   Q-001, Q-002, Q-010/BQ-028, Q-020, BQ-015, BQ-027 (**refundability only** —
   the amount is decided), BQ-030. Every structural question is answered; what
   is left is numbers, the provider, and legal. **These block F′ only** —
   DEC-APP-007 keeps them off the critical path for the other eight phases.
2. Commission the Thai legal/compliance review (Q-002, Q-012, Q-015, Q-017) —
   external lead time, gates real-money work.
3. Verify on an Android emulator — per-weight Thai font families are untested and
   are the single most likely rendering failure.
4. Verify the search **results** list and keyboard avoidance on a device that
   can type Thai (the Simulator cannot).

**Do not start Phase F′ or any settlement work** (settlement needs six deferred
tables and a Product Owner decision). **Do not touch the database** beyond a
migration explicitly instructed for the current phase — see §10.

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

- **Run the quality gate with `--force`.** `pnpm turbo run lint typecheck test
  build --force`. A cached-green task hides a real failure: on 2026-09-01 the
  customer app's QR-expiry suite was failing on every uncached run while
  `pnpm turbo run test` reported success from cache. Run it more than once —
  three of the failures fixed that day only appeared under parallel load.

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
- Sample figures are not rules: the 10% commission and the ฿10 `BANHAO7` coupon
  are illustrative. **DEC-025 says so explicitly of the 10%.** The **fee**
  figures are no longer samples — delivery is a flat **฿10 / 1000 satang**
  (DEC-035) and service a fixed **฿5 / 500 satang** (DEC-036). Note the
  divergence: `apps/customer/src/mocks/pricing.ts` still holds
  `SAMPLE_DELIVERY_FEE_SATANG = 1500`, which is **not** the approved amount and
  must never be copied into backend code.
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
- **22 migrations are merged** (16 reviewed at the `e471ec1d` V1.1 checkpoint,
  plus 6 since for Phase C/E/G, M-05 and M-11/M-12 — see §3/§7). Read
  `docs/DATABASE_MIGRATION_V1_REPORT.md` before going near any of them. Do not
  edit an existing migration, and do not add a table, view, RLS policy, RPC, or
  new migration, and never run `supabase db push` or `supabase link`, without
  an explicit instruction.
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
- **Still hard-locked:** the database, except where phase work has needed a
  new migration under explicit instruction (5 have been merged since the
  `e471ec1d` checkpoint — see §3/§7/§10 above). No opportunistic migration or
  schema change outside that.
- Merchant's approved target is **Next.js web**, not Expo (DEC-APP-003).

---

## 11. Merchant app — built scope, live verification, and open blockers

Added 2026-09-01 (EVENT-026/027), extended by EVENT-029. The Merchant app is
no longer a shell and its **MUST scope is complete**; §5's table is the
summary, this section is the detail.

### What is built

`apps/merchant` is a **Next.js** app (DEC-APP-003 — never Expo), scoped to one
restaurant at a time. The documented merchant build order in
`docs/design/BANHAO-UX-SPEC-V1.md` §6 is `M-01 → M-03 → M-04/M-05 →
M-07/M-08 → M-11/M-12`, and everything up to and including M-07/M-08 exists:

| Screen | State |
|---|---|
| M-01 login (phone OTP) | Built |
| M-02 restaurant selection | Membership resolved; the switcher itself is only needed for multi-restaurant membership, which no live account has |
| M-03 live order board | Built — three columns, Supabase Realtime, audible arrival alert, tab-title count, connection pill |
| M-04 order detail panel | Built |
| M-05 accept + prep time | Built and **live-verified** (below) |
| M-07 preparing / M-08 ready | Built as the board's per-card actions (`เริ่มทำอาหาร`, `อาหารพร้อม`) |
| M-11 menu management | **Built** (EVENT-029) — overview by category section, create/edit drawer, inline availability, archive-not-delete, category rename/reorder/archive, option-group editor |
| M-12 opening hours | **Built** (EVENT-029) — seven days, split shifts, all seven validation rules, one atomic save of the whole week |
| M-06 reject (SHOULD), M-09, M-10, M-13, M-14 | **Not built — no design artifact exists.** See the blocker below |

### M-05 live verification — PARTIAL PASS (2026-09-01)

Verified end-to-end against `banhao-dev` through the real browser UI, using
fixture order `M05-VERIFY-0005`. **Directly observed:** the accept dialog opens
with nothing preselected; `20 นาที` selects and enables confirm; exactly one
`POST /api/v1/orders/:id/accept` → **200**; `orders.state` becomes
`MERCHANT_ACCEPTED` with `prep_minutes = 20` and `accepted_at` set; exactly one
`deliveries` row (`RIDER_SEARCHING`); exactly one `order_status_history` row
(`PAID → MERCHANT_ACCEPTED`, actor the signed-in merchant); exactly one
undispatched `MerchantAcceptedOrder` outbox row; the board moved the card
reactively via Realtime with no reload, and the M-03 counts followed.

**Not verified: the customer-side C-14 prep-time caption.** See the blocker
below. Treat C-14 as `UNVERIFIED`, not as passing.

### Open blockers — read before planning merchant work

1. **No design artifact for M-06, M-09, M-10, M-13 or M-14.** Every merchant
   screen built so far had a committed `docs/design/BANHAO M-NN ….dc.html`
   first. Do not design these yourself — that is a product decision, not an
   implementation one. **None of them is `MUST` scope**: M-06/M-09/M-10 are
   `SHOULD` and M-13/M-14 are `LATER`, so with M-11 and M-12 built this no
   longer blocks launch-critical merchant work. The next `MUST` gap in the
   product is the **Admin app (Phase I)**, which has no design artifact at all.
2. **C-14 cannot be live-verified with the current test credentials.** The
   fixture orders belong to customer `d25a51f9-…` (phone `+66811110009`), and
   **no Test OTP code for that number is documented anywhere in this repo** —
   `docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md` §9 explicitly records that Auth
   accounts for the G-7.1 identities were never provisioned. The two documented
   pairs (§7) belong to other identities. Do not guess an OTP and do not
   fabricate a session. Unblocking this is a Supabase Dashboard action:
   configure a Test OTP pair for `+66811110009`, or point future fixtures at an
   already-onboarded customer identity.

### M-11 / M-12 — what is built, and what is not verified

Both screens are implemented end to end and covered by tests; **neither has
been walked against the live `banhao-dev` project.** The distinction §5 draws
between "implemented" and "verified live" applies here in full.

| | |
|---|---|
| Database | `20260901000002_merchant_catalog_write_functions.sql` — four `SECURITY INVOKER`, `service_role`-only functions: `replace_restaurant_hours`, `reorder_menu_categories`, `reorder_menu_items`, `replace_menu_item_option_groups`. **Merged but NOT applied to `banhao-dev`** (§7) |
| Grants | **Unchanged.** No write grant was added to `authenticated` — DEC-APP-008 keeps writes in the API, and two assertions pin that the client still cannot write `menu_items` or `restaurant_hours` directly |
| API | 11 endpoints under `/api/v1/merchant/`, in the OpenAPI contract |
| Reads | Client → Supabase under the existing `_select_member` policies. No read endpoint was added, deliberately |
| Tests | 38 SQL assertions (real Postgres, in CI), 161 API tests, 99 merchant-app tests |

**`day_of_week` is 0 = Sunday … 6 = Saturday.** M-12's own artifact recorded
this as `M12-Q-01`, marked BLOCKING, because the migration carries no comment.
The repository already answered it: `apps/customer/src/lib/openingHours.ts`,
`ShopScreen.tsx`'s weekday labels and `supabase/seed-dev/catalog_dev_seed.sql`
all state it explicitly, and the customer app's "open now" derivation has
shipped against it. Nothing was reinterpreted and no stored row changed
meaning. The convention is now asserted in three places — the shared validator's
spec, the merchant form's spec, and a round trip through real Postgres — so a
future off-by-one fails loudly instead of opening every shop on the wrong day.

**Product questions the implementation deliberately did not answer:**

- **M11-Q-01** — archiving a category that still holds dishes is **refused**
  (`CONFLICT`). `menu_items_select_active` checks only the item and the
  restaurant, so archiving a populated category would leave its dishes publicly
  readable with no section. Blocking is the design's own stated safe
  placeholder; choosing either outcome is a product call.
- **M11-Q-03** — `ปิดขายวันนี้` says "today" but `is_available` is a plain
  boolean with no timestamp. **No automatic daily reset exists and none was
  invented.** Either the wording overstates the system or a reset is needed.
- **M11-Q-04** — two staff editing one dish is last-write-wins. No version
  column, no conflict check.
- **M11-Q-05** — a ฿0 dish is permitted, because the CHECK permits it.
- **M12-Q-02** — overlap and exact-duplicate intervals are refused by the
  shared validator, which the API also runs. There is still **no database
  constraint**, so this is a guard over what this API writes, not a guarantee
  about the data.
- **M12-Q-03 / M12-Q-04** — no temporary-close UI, and no warning when a saved
  schedule closes the shop mid-service. Both are BQ-007 territory.

### Local development notes (not committed — `.env` is gitignored)

- The Merchant app dev server runs on **port 3002**; the API on 3000. The API's
  `CORS_ORIGINS` must therefore include `http://localhost:3002` or every
  browser call from the merchant app fails preflight with no
  `Access-Control-Allow-Origin`. This is a local `.env` value only.
- **`dotenv` never overwrites an already-exported variable** (`main.ts` says so).
  An API process started from a shell that exports a stale `SUPABASE_URL` will
  silently ignore the correct value in `.env` and reject every valid token with
  `401 Invalid or expired token` — the JWT issuer check fails against the wrong
  project. If authentication fails inexplicably, check the *process* env
  (`ps eww -p <pid>`), not just the file.

### Live M-05 fixtures in `banhao-dev`

`M05-VERIFY-0001` … `M05-VERIFY-0005` exist permanently (orders are
delete-protected for every role, including `service_role`). `0001`–`0004` are
`PAID` with expired accept windows; `0005` is the accepted one. They are
**UI-state fixtures only** — `PAID` with no `payments`, `payment_events` or
ledger row behind them, exactly like the `G71-…` orders. Never treat them as
financial or settlement input. Their provisioning SQL is
`supabase/seed-dev/m05_paid_order_fixture.sql`, tracked in Git alongside
`catalog_dev_seed.sql` and `g71_offer_fixture.sql` — the same reviewed,
idempotent, hand-run convention (`docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md`
§5.2). Nothing runs it automatically and it is in no workflow.
