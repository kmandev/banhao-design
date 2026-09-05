# Current Status

## Last Updated

2026-09-03 — after Phase J's first two AI Operations vertical slices
(merchant acceptance timeout, no-rider triage) and Phase I's Human Supervisor
console, the human-on-exception counterpart to them. Previously 2026-09-01, after
M-11 menu management and M-12 opening hours (`8da83eaf`), which complete the
merchant app's MUST scope.

> **Historical note.** This file has been rewritten in full each time it fell
> too far behind the repository to patch incrementally — 2026-08-09 ("No
> application exists"), 2026-08-12 (Phase A / A-1), 2026-08-19 (Phase D), and
> now. The 2026-08-19 revision described a repository where Phases E through I
> had "not started"; six of them have since been built. Earlier states are
> preserved in [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) and in Git history;
> nothing is erased, only superseded.

## 1. Project Overview

**BANHAO | บ้านเฮา** — a Local Super App for อำเภอบุณฑริก จังหวัดอุบลราชธานี,
Thailand. Phase 1 is Food Delivery; later phases (Parcel, Ride, Shopping) are
concept-only. Three-sided marketplace: Customer → BANHAO → Merchant + Driver.
Built by a solo founder using AI as the development team.

## 2. Current Architecture State

| | |
|---|---|
| Branch | `feature/g7-driver-availability`, pushed to `origin` |
| Current commit | `feat(orders): snapshot customer prep estimate` — AC-04 / DEC-042, on top of `7ea20a65` (M-AV availability) |
| Database checkpoint | `e471ec1d` — the schema V1.1 was reviewed against; **10 additive migrations merged since, all 10 applied live** (§10) |
| Application architecture | [`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md) — V1.1, **APPROVED / READY FOR IMPLEMENTATION** |
| API contract | [`06-api/openapi.json`](06-api/openapi.json), generated from the code and guarded against drift by a test |

V1.1 is authoritative for application implementation: 12 `DEC-APP` decisions,
9 phases (A–I) plus F′. Where any other document conflicts with it, **V1.1
wins**. A `DEC-NNN` business decision outranks both.

## 3. Phase status

**Read the distinction in §4 before using this table.** "Implemented" and
"verified end to end" are separate claims, and only one phase has the second.

| Phase | What | State |
|---|---|---|
| **A** — Foundation hardening | Error envelope + `correlationId`, correlation middleware, webhook raw body, `worker.ts`, `/internal/tick` with HMAC, deploy workflows, structured JSON logging, one log line per request, `/health` database ping | **Implemented except Sentry** — see §13 |
| **B** — Identity & capability resolution | Membership-based `RolesGuard` / `RestaurantScopeGuard` (DEC-033, DEC-APP-004), `GET/PATCH /me`, addresses CRUD | Implemented |
| **C** — Catalog & merchant read path | Customer app reads restaurants, hours, menu, options and availability live from Supabase | Implemented |
| **D** — Cart | Supabase-persisted cart under RLS, `POST /cart/validate`, fail-closed checkout revalidation | Implemented |
| **E** — Order | `create_order()`, `POST /orders`, pricing, the merchant and rider transitions as commands, `order_status_history` | Implemented; the full nine-state lifecycle has **not** been walked end to end against the live project |
| **F** — Payment on `NullPaymentProvider` | Provider interface, null provider, payment attempts and expiry, webhook simulator, event processing, `reconciliation_cases` | Implemented. **No ledger is written at all.** The commission rate (Q-010/BQ-028) that DEC-025 gated this on is now resolved — **DEC-043**, 8% of the food subtotal, round to whole baht — but no ledger-posting code has been written; that remains a separate, not-yet-authorized engineering task, so "the ledger balances to zero" is still not a testable claim |
| **F′** — Real payment provider | — | **Hard-locked.** Q-001 and Q-002 are `OPEN` |
| **G** — Rider & delivery | Broadcast dispatch, offer accept/decline, arrival, pickup, en-route, completion, release + reconciliation, proof of delivery end to end | Implemented; POD has never run against a real R2 bucket or on hardware |
| **H** — Notification | `outbox` table, `OutboxDispatchService` as a tick phase, `NotificationChannel` with an in-app channel, `GET/PATCH /me/notifications` wired to the customer app | Implemented **without a push channel** — web has none by DEC-APP-003, and FCM is unimplemented (TQ-002 `OPEN`) |
| **I** — Admin operations | The Human Supervisor console: three guarded endpoints under `/api/v1/admin/supervisor` plus the console screens, projecting AI Operations escalations out of `audit_logs` | **Started — the exception half only.** Inbox, case detail and case closure work end to end, with the HTTP boundary proven at 401/403/200 per route. The financial half (payments, refunds, reconciliation, ledger, settlement) is designed and unbuilt behind Q-001, Q-002, Q-020, Q-032 (Q-010/BQ-028's commission rate is resolved — DEC-043 — but the other three remain). See `docs/HUMAN_SUPERVISOR_CONTRACT.md` |
| **J** — AI Operations + Human Supervisor | Authorized by DEC-040, positioned after Phase I. Two vertical slices built in `apps/api/src/modules/ai-ops`: **merchant acceptance timeout** (`44abab39`) and **no-rider triage** (`0726b269`), both running as tick phases | **Started, deliberately partial.** The pipeline shape is complete end to end — normalize, deterministic router, policy gate, agent port, command catalog, dispatcher with domain revalidation, verification, `actor_type = 'AI'` audit. The merchant playbook **escalates rather than acting** in production because BQ-013 supplies no deadline; the no-rider playbook resolves DEC-022 and escalates by design, because it has no command at all. **No model vendor is selected** — the agent adapter is deterministic. Every remaining playbook in the design package is blocked on an open business decision (§13) |

## 4. Implemented is not verified

The table above reflects what the code and its tests evidence. It does **not**
claim that each flow has been walked against the live `banhao-dev` project.
Two things have been, by execution:

| Verified live | When | Evidence |
|---|---|---|
| Phone OTP → profile read under RLS → `display_name` write → session survives restart → logout persists | 2026-08-10 (EVENT-011) | `supabase/tests/live-rls-check.mjs`, 14/14 |
| Merchant M-05 accept: one `POST /orders/:id/accept` → 200, `MERCHANT_ACCEPTED` with `prep_minutes`, exactly one `deliveries` / `order_status_history` / outbox row, board updated by Realtime | 2026-09-01 (EVENT-026) | `CLAUDE.md` §11; fixture `M05-VERIFY-0005` |

Everything else is unit- and integration-tested against fixtures, or against a
Docker Postgres for the SQL suites. That is a real assurance level, and it is
not the same claim.

## 5. Applications

| App | State |
|---|---|
| **Customer** (Expo) | 31/31 design states, screenshot-verified. Every one of the nine repository bindings is live — catalog, cart, cart validation, order creation, order history, order detail, delivery proof, notifications, addresses. `mockRepositories` survives only as test fixtures |
| **Merchant** (Next.js, DEC-APP-003) | **MUST scope complete.** M-01 login, M-02 scope resolution, M-03 live board with Realtime and audible arrival alerting, M-04 detail panel, M-05 accept with prep time, M-07/M-08 board actions, **M-11 menu management, M-12 opening hours**, and the five-item nav the UX specification fixes. **M-10 restaurant profile**, and **M-AV availability (NORMAL / BUSY / PAUSED — DEC-041, formerly labelled M-13)**. Unbuilt: M-06/M-09 (`SHOULD`) and UX-SPEC M-13 earnings / M-14 settings (`LATER`), all still without a design artifact |
| **Driver** (Expo) | Status/availability, offer inbox with the 15 s foreground poll, active delivery, proof camera/review/upload, navigation. The gap list in `BANHAO_POD_DRIVER_IMPLEMENTATION_PLAN.md` §4 is closed except the items that need a product decision (D-13 money, D-14 push, D-17 icons) |
| **Admin** (Next.js) | **Human Supervisor console.** Phone-OTP login, `platform_staff` gate, operations inbox (S-02), case detail with live domain state and append-only timeline (S-03), close-case-with-reason (S-06). No Supabase data read at all — every screen goes through `/api/v1/admin/supervisor` (DEC-APP-008). The Admin package's financial screens (A-16…A-22) are **not built**: the money decisions gate them |
| **tick-worker** (Cloudflare Worker) | Present, typechecks, bundles via dry-run, **never deployed** |

## 6. API

49 operations across 46 paths, all under `/api/v1` except `GET /health`. The contract
is [`06-api/openapi.json`](06-api/openapi.json), generated from the real
`AppModule` by `pnpm --filter @banhao/api openapi` and compared against the
code by `apps/api/test/openapi.contract.spec.ts` on every test run — a route
added or renamed without regenerating fails the suite.

`docs/06-api/README.md` documents the envelope, the `ErrorCode`-to-status
catalogue, the three-guard authorization order, and the two endpoints
deliberately excluded from the contract (`/internal/tick` and the payment
webhook, both HMAC-guarded).

**`components.schemas` is empty — by design under the current Zod-first
payload architecture, not an unfinished piece of this section.** `@nestjs/swagger`
remains responsible for everything it does today — operation metadata (`@ApiTags`,
`@ApiOkResponse`, `@ApiBearerAuth`), paths, methods, auth, status codes. What it
cannot do is derive a reusable schema from a TypeScript `type`/`interface`:
every request and response shape in this codebase is `@banhao/types` /
`z.infer<typeof …>`, and there is no class-based DTO anywhere for
`@ApiProperty()` or the Swagger CLI plugin to introspect — both need a class,
because decorator metadata attaches to a runtime prototype and a TS type is
erased at compile time. The payload contract itself is unaffected: `@banhao/types`
is still enforced at compile time across the monorepo, exactly as before.
Populating `components.schemas` would need a class-based DTO strategy or a
Zod/OpenAPI bridge (e.g. `zod-to-openapi`, `nestjs-zod`) — a new dependency and,
for a bridge, a cross-controller touch of all ~49 operations — which is a future
Architecture Decision (`CLAUDE.md` §10: "any deviation from V1.1 requires a new
Architecture Decision, not an improvisation"), **explicitly out of scope for the
current V1.1 architecture** and not undertaken here.

## 7. Observability

| Concern | State |
|---|---|
| Structured logging | ✅ `JsonLogger` — one JSON object per line, Cloud Logging `severity`, `correlationId` from the async store. Production only; development keeps Nest's console output |
| One line per request | ✅ `RequestLoggingMiddleware` — method, route **pattern** (never an id), status, duration; 4xx is a warning, 5xx an error |
| Correlation | ✅ `X-Request-Id` in or generated, echoed on the response, in the async store, and on every error envelope |
| Health | ✅ `GET /health` pings the database. A failed ping reports `status: "degraded"` and still answers **200**, so a database outage cannot make Cloud Run crash-loop the instance |
| Error tracking | ❌ **Sentry is absent.** It needs an external account and a DSN — see §13 |
| Business audit | Schema exists (`audit_logs`); written where operations write it |

## 8. Storage (R2)

Two buckets. `R2_BUCKET` is public (`*.r2.dev`) and holds merchant catalog
images; `R2_PRIVATE_BUCKET` holds proof-of-delivery photos and is read only
through short-lived signed URLs, per the POD-Q-01 decision in
`docs/DECISIONS.md`. `StorageService` refuses to start if the two name the same
bucket. Server-templated object keys only, a MIME allow-list, and a 2 MB
server-side size check on proof uploads.

**Never exercised against a real bucket.** Every R2 test is against a fake
client.

## 9. Test and quality status

Run in full, **uncached** (`pnpm turbo run lint typecheck test build --force`),
2026-09-01. Repeated five times to catch load-dependent failures.

| Package | Tests |
|---|---|
| `@banhao/api` | 1,335 |
| `@banhao/merchant` | 520 |
| `@banhao/customer` | 480 |
| `@banhao/driver` | 316 |
| `@banhao/validation` | 127 |
| `@banhao/ui` | 22 |
| `@banhao/api-client` | 16 |
| `@banhao/config` | 13 |
| **Total** | **2,829 — all passing** |

`lint`, `typecheck` and `build` pass for all 44 Turborepo tasks.

**Use `--force`.** A cached-green task hides a real failure: the customer
app's QR-expiry suite was failing on every uncached run while
`pnpm turbo run test` reported success from cache.

SQL suites, both Docker-based and both now run by CI:

| Suite | What |
|---|---|
| `supabase/tests/run-rls-tests.sh` | The `profiles` RLS pattern |
| `supabase/tests/run-domain-tests.sh` | Domain invariants, rider view row isolation, catalog availability, the rider race with two genuinely concurrent `psql` processes, reassignment atomicity, `create_order()`, and the four merchant catalog-write functions (38 assertions, incl. `day_of_week` 0 = Sunday round trips and both atomicity rollbacks) |

## 10. Database

**Live and LOCKED.** 26 migration files. 16 are the `e471ec1d` checkpoint V1.1
was reviewed against; ten have been merged since, each additive and each under
an explicit instruction. **All 26 are applied to `banhao-dev`** — the last
two (M-AV, AC-04) were applied and verified 2026-09-04, see the last two rows.
Every one of the ten is exercised by the Docker domain suite
(`supabase/tests/run-domain-tests.sh`) as well as being confirmed live; "verified"
below distinguishes the two where it matters.

| Migration | Why |
|---|---|
| `20260817000001_catalog_availability_visibility.sql` | PC-Q-001 Option A — unavailable items stay visible so the app can render `วันนี้หมด` |
| `20260819000001_order_creation_function.sql` | `create_order()`, Phase E-1 |
| `20260825000001_reconciliation_rider_release_invariant.sql` | The rider release / reconciliation invariant |
| `20260831000001_orders_realtime_publication.sql` | `orders` in the Realtime publication, for the merchant board |
| `20260901000001_orders_prep_minutes.sql` | `orders.prep_minutes`, for M-05 |
| `20260901000002_merchant_catalog_write_functions.sql` | Four transactional catalog-write functions for M-11/M-12. Applied and verified live 2026-09-03 |
| `20260902000001_order_item_options_drop_menu_option_fk.sql` | Drops the `order_item_options` menu-option FK so M-11 option edits work |
| `20260903000001_audit_logs_ai_actor_type.sql` | AI-01 — widens `audit_logs.actor_type` to accept `'AI'` |
| `20260904000001_restaurant_availability_mode.sql` | **M-AV** (DEC-041) — `restaurants.availability_mode` / `busy_prep_minutes`, and `create_order()`'s PAUSED refusal. 22 assertions pass against real PostgreSQL. **Applied and verified on `banhao-dev` 2026-09-04** |
| `20260904000002_orders_customer_quoted_prep_minutes.sql` | **AC-04** (DEC-042) — `orders.customer_quoted_prep_minutes`, captured by `create_order()` and added to the immutability denylist. 16 assertions pass against real PostgreSQL. **Applied and verified on `banhao-dev` 2026-09-04** |

Six tables remain deferred (`settlements`, `settlement_items`,
`delivery_fee_bands`, `zones`, `service_areas`, `delivery_attempts`), each
justified in `docs/DATABASE_DESIGN.md`, none removed from the design.
Settlement is not buildable in V1.

**Do not run `supabase db push` or `supabase link`, and do not add a
migration, table, view, policy or RPC, without an explicit instruction.**

`profiles.role` is still on the table and still read in two non-authorization
places (`UsersService` and the `/api/v1/me` response). **No guard and no RLS
policy reads it** — DEC-033's application half is done. Dropping the column is
a schema change and needs its own approved migration; see `docs/TODO.md`.

## 11. Deployment

### The Phase A local validation gate

V1.1 §15 requires this sequence before any cloud step: local build → local
tests → **API starts in Docker locally** → API integration tests → only then
Cloud Run. Every step but the last has now been executed (2026-09-01):

| Step | Result |
|---|---|
| Local build | ✅ 44/44 Turborepo tasks |
| Local tests | ✅ 2,829, uncached |
| `docker build -f apps/api/Dockerfile` | ✅ image builds |
| Container boots and answers | ✅ `GET /health` → 200 in a container started with placeholder credentials |
| Logs are structured in the container | ✅ one JSON object per line, Cloud Logging severities, `correlationId` on both the error and the request line |
| Degraded reporting works for real | ✅ with an unreachable database the body reported `"status":"degraded"`, `"database":{"status":"unreachable"}` — at 200, as designed |
| Cloud Run | ❌ blocked on infrastructure that does not exist |

`deploy-api.yml`'s smoke test now checks the database line explicitly: a
deployed API that cannot reach its database fails the deploy, even though the
same body is deliberately a 200 for the platform's liveness probe.

**Nothing is deployed.** All four workflows exist and validate; none has ever
executed against real infrastructure, and no external infrastructure exists.
[`INFRASTRUCTURE-READINESS-V1.md`](INFRASTRUCTURE-READINESS-V1.md) is the
pre-provisioning checklist, and every item on it is a user action requiring a
GCP project, billing, and credentials.

Approved targets (V1.1 §12, `DEPLOYMENT-ARCHITECTURE-V1.md`): Cloud Run in
`asia-southeast3`, Cloudflare Pages, Cloudflare Worker cron for the tick. The
first deployment is **staging on `banhao-dev`** (Option A, decided
2026-08-16), with the Cloud Run service named `banhao-api-staging`.

## 12. Undocumented deviation, still open

The R2 storage foundation and the merchant image upload endpoints were built
ahead of V1.1's own cost table (§17), which says images start on the Supabase
Storage free tier and move to R2 at Stage 2. `docs/DECISIONS.md` now records
R2 decisions for **proof of delivery** (POD-Q-01 and the retention entries),
but nothing records the earlier catalog-image deviation as a deliberate
architecture decision. The implementation is sound; the paper trail is
missing. CLAUDE.md's own rule — *any deviation from V1.1 requires a new
Architecture Decision, not an improvisation* — makes this a Product Owner
item, not an implementation one.

## 13. Blockers

Each is classified by what would unblock it. None is waiting on engineering
effort alone.

| # | Blocked | Class | What would unblock it |
|---|---|---|---|
| 1 | The Admin app's financial half — A-16 through A-22 (payments, refunds, reconciliation, ledger, settlement) | **Business decision** | Q-001, Q-002, Q-020 and Q-032 (Q-010/BQ-028 commission rate resolved 2026-09-05, **DEC-043**). The screens are fully designed in `BANHAO ADMIN - Operations - Phase I.dc.html`; what is missing is the remaining numbers, the provider, the legal model and the refund mechanism. The design package's own § 19 says the same. **The exception half — the Human Supervisor console — is built**, since the AI Operations package § 09 designs it and it needs none of those decisions |
| 1b | Phase I's operational commands from a case (cancel, release, redispatch, pause) | **Business decision** | BQ-013, UX-Q-006, OD-04, BQ-015, Q-032. Each case detail names the specific decision blocking it rather than rendering a control the platform cannot back |
| 2 | Merchant M-06, M-09 (`SHOULD`), UX-SPEC M-13 earnings, M-14 settings (`LATER`) | Missing design artifact | Same. None is launch-critical, and M-13 earnings is additionally money-blocked (Q-032 — settlement-cycle parameters a payout screen would need; BQ-029 itself is resolved, **DEC-044**). **M-10 and M-AV are no longer on this list — both are built**, each from its own committed artifact |
| 3 | Customer C-14 prep-time caption | **Missing credential** | The fixture orders belong to `+66811110009`, for which no Test OTP pair is documented. A Supabase Dashboard action, or a fixture pointed at an onboarded identity. Do not guess an OTP |
| 4 | Sentry (the last Phase A item) | **External account** | An account and a DSN. Free tier is single-user; $26/month on the second developer |
| 5 | Any deployment | **External infrastructure** | The whole of `INFRASTRUCTURE-READINESS-V1.md`: GCP project, billing, WIF, Artifact Registry, Cloudflare token |
| 6 | R2 verified against a real bucket; POD on hardware | External infrastructure / devices | A provisioned private bucket; a physical iOS and Android device |
| 7 | Phase F′ and everything ledger- or settlement-shaped | **Business decision** | Q-001 provider, Q-002 legal model, Q-020 refund mechanism (Q-010/BQ-028 commission rate resolved 2026-09-05, **DEC-043** — 8% of food subtotal, round to whole baht; ledger-posting code itself is still unwritten) |
| 8 | Driver R-13 earnings, and any money on a rider surface | **Engineering task** (business decisions resolved) | **BQ-029 resolved 2026-09-05 — DEC-044** (flat ฿12/1200 satang per completed delivery). **Implemented** `6432e3b3`: `deliveries.rider_earning_satang` is snapshotted at delivery completion and a `RIDER_PAYABLE −1200` ledger entry is posted. That implementation surfaced a real accounting boundary — the entry has no offsetting funding entry, since no `CUSTOMER_PAYMENT` line exists anywhere in the current ledger — which **BQ-040 / DEC-045 (2026-09-05) resolved**: BANHAO absorbs the ฿2 (200 satang) gap between the ฿10 delivery fee and the ฿12 rider earning as a `PLATFORM_WRITE_OFF`. **The offsetting `PLATFORM_WRITE_OFF +200` entry is now implemented** (`b813b5c6`), posted in the same rider-earning completion ledger group as `RIDER_PAYABLE`. This narrows the group's residual from `-1200` to `-1000` — it does **not** mean full settlement/payout, or the broader `CUSTOMER_PAYMENT`/full-order-ledger flow, is implemented; those remain outside DEC-045's scope, and no rider earnings surface exists in any app yet |
| 9 | Dropping `profiles.role` | **Approved migration** | A migration explicitly approved for it. The application half is already done |
| 10 | Push notifications (Phase H's missing channel) | Technical decision | TQ-002 |
| 11 | Android, physical iOS, real SMS, the search results list | Device / environment | Hardware and an Android SDK on the build machine |
| 12 | ~~Applying `20260904000001` (M-AV) and `20260904000002` (AC-04) to `banhao-dev`~~ | **Resolved** | Both applied and verified on `banhao-dev` 2026-09-04, under an explicit operational instruction — `supabase migration list --linked` shows 26/26, and direct schema reads confirm the columns, constraints, and the deployed `create_order()` body match the migration text with no pre-existing row rewritten. (`20260901000002` was applied and verified live 2026-09-03; that older entry was already closed.) ~~A UI walkthrough of the M-AV board control... is still outstanding~~ **The merchant M-AV board control was live-verified through the real browser UI** (Normal→Busy→Paused→Normal, pause-safety, resume — all observed, not inferred). **The customer C-14 caption remains PARTIAL**: a real order (`BH-20260905-0001`) was created live through the customer API while the restaurant was genuinely `BUSY`, `customer_quoted_prep_minutes` correctly captured the busy value and stayed unchanged after the restaurant returned to `NORMAL`, and the customer's own RLS-scoped session (not service-role) reads the correct value through C-14's exact query. **What remains blocked is rendering the actual React Native screen**: this machine's installed Expo Go is SDK 53, the customer app is pinned to SDK 52 — an Expo-Go/project version mismatch, not a missing Test OTP (a real, working customer session was obtained for this test) |
| 13 | ~~`apps/merchant` lint/typecheck/build and `apps/api` lint were red on this branch~~ | **Resolved** | Two stray unused imports introduced by `20044391` (M-10) — `waitFor` in `apps/merchant/src/components/RestaurantProfileForm.test.tsx` and `DomainError` in `apps/api/src/modules/merchant/restaurant-profile.controller.spec.ts` — were removed in the separate hygiene commit `1654e4ef` (`chore: remove pre-existing unused imports`). `apps/merchant` lint/typecheck/build and `apps/api` lint are now green; merchant's own test suite had passed throughout (613 tests) — it was only the lint rule that failed the build. Not part of the M-AV or AC-04 implementation itself |
| 14 | The `CUSTOMER_PAYMENT` ledger entry — no offsetting funding entry exists for either the commission or rider-earning groups | **Engineering task** (design locked, not yet built) | **Posting design locked 2026-09-05** (`docs/SETTLEMENT_MODEL.md` § 3.1) — a hybrid payment-funding group, `CUSTOMER_PAYMENT +payment.amount_satang`, anchored on `payment:<paymentId>:<providerTransactionId>`, independent of the commission and rider-earning groups exactly as they are independent of each other. No new DEC number: every fact it relies on is already `ACCEPTED`. **No code, schema, or migration has been written** — `payment-event-processing.service.ts` still posts only the commission group |

**6 P0 business decisions remain**, all of them a number, a provider or a
legal question: Q-001, Q-002, Q-020, BQ-015, BQ-027
(refundability only), BQ-030 (**stacking only** — the funder model is now
resolved). The delivery and service fee **amounts** were approved 2026-08-24
(**DEC-035** flat ฿10, **DEC-036** fixed ฿5), the merchant commission **rate**
was approved 2026-09-05 (**DEC-043** — 8% of the food subtotal, round to
whole baht), and the promotion/discount **funder model** was approved the
same day (**DEC-046** — per-promotion funder, `PLATFORM` or `MERCHANT`, no
split; no promotion engine exists yet, so this is a decision lock only, not
an implementation). Under DEC-APP-007 these gate **F′ only**. Do not invent a
default for any of them anywhere in the application.

## 14. What is executable right now

Everything in §13 is blocked on something outside engineering. What is not:

- Further test and contract hardening, on the pattern of the rider
  controller's HTTP-boundary suite.
- Documentation reconciliation, of which this file is one instance.
- **M-11/M-12 follow-through that needs no new design**: the edit-mode image
  upload in the item drawer, which currently shows the stored key rather than
  driving the existing two-step upload.
