# Current Status

## Last Updated

2026-11-02 at `36d99edd`. **The project is not launch-ready.** Staging was down
that morning because `banhao-dev` had paused, and is back up after the owner
restored it. Previously 2026-09-03, after Phase J's first two AI
Operations vertical slices and Phase I's Human Supervisor console. Before that 2026-09-01, after
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
| Branch | `main`, level with `origin/main` |
| Current commit | `36d99edd` — `fix(ai-ops): harden audit deduplication` (2026-09-21) |
| Database checkpoint | `e471ec1d` — the schema V1.1 was reviewed against; **16 additive migrations merged since**, not all confirmed applied (§10) |
| Application architecture | [`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md) — V1.1, **APPROVED / READY FOR IMPLEMENTATION** |
| API contract | [`06-api/openapi.json`](06-api/openapi.json), generated from the code and guarded against drift by a test |

V1.1 is authoritative for application implementation: 12 `DEC-APP` decisions,
9 phases (A–I) plus F′. Where any other document conflicts with it, **V1.1
wins**. A `DEC-NNN` business decision outranks both.

## 3. Phase status

**Read the distinction in §4 before using this table.** "Implemented" and
"verified end to end" are separate claims, and only one phase has the second.
**Payment runtime is now Stripe, and the commission rate is 10% (D-01):** the F
row below is corrected only where it names the provider, and the 8% in it is the
rate at the time those groups were built.

| Phase | What | State |
|---|---|---|
| **A** — Foundation hardening | Error envelope + `correlationId`, correlation middleware, webhook raw body, `worker.ts`, `/internal/tick` with HMAC, deploy workflows, structured JSON logging, one log line per request, `/health` database ping | **Implemented except Sentry** — see §13 |
| **B** — Identity & capability resolution | Membership-based `RolesGuard` / `RestaurantScopeGuard` (DEC-033, DEC-APP-004), `GET/PATCH /me`, addresses CRUD | Implemented |
| **C** — Catalog & merchant read path | Customer app reads restaurants, hours, menu, options and availability live from Supabase | Implemented |
| **D** — Cart | Supabase-persisted cart under RLS, `POST /cart/validate`, fail-closed checkout revalidation | Implemented |
| **E** — Order | `create_order()`, `POST /orders`, pricing, the merchant and rider transitions as commands, `order_status_history` | Implemented; the full nine-state lifecycle has **not** been walked end to end against the live project |
| **F** — Payment foundation | Provider interface, null provider (tests/dev), payment attempts and expiry, webhook simulator, event processing, `reconciliation_cases` | Implemented. **Four ledger groups are now written**: `MERCHANT_COMMISSION` (DEC-043, 8% of the food subtotal, round to whole baht), `CUSTOMER_PAYMENT` (`+grand_total`, 2026-09-05) and `SERVICE_FEE_REVENUE` (`+orders.service_fee_satang` to `PLATFORM_REVENUE`, DEC-047, 2026-09-06) at payment success, and `RIDER_EARNING` (`RIDER_PAYABLE −1200` / `PLATFORM_WRITE_OFF +200`, DEC-044/045) at delivery completion; a **read-only** payment ↔ `CUSTOMER_PAYMENT` reconciliation followed 2026-09-06. **"The ledger balances to zero" is still not a testable claim** — gross merchant food payable is unposted and delivery-fee revenue is unrecognized. Refund reversal posting now exists (Q-020 Slices 1–4B). No settlement or payout exists |
| **F′** — Real payment provider | Stripe, DEC-055, PromptPay/THB, no Connect in Phase 1 | **Bound in code since `593c65e9`, test mode only on staging.** No live-money use. Still outstanding: the Q-020 End-to-End Acceptance Audit, including Stripe webhook registration, and **Q-002**, which stays `OPEN` and gates settlement |
| **G** — Rider & delivery | Broadcast dispatch, offer accept/decline, arrival, pickup, en-route, completion, release + reconciliation, proof of delivery end to end | Implemented; POD has never run against a real R2 bucket or on hardware |
| **H** — Notification | `outbox` table, `OutboxDispatchService` as a tick phase, `NotificationChannel` with an in-app channel, `GET/PATCH /me/notifications` wired to the customer app | Implemented **without a push channel** — web has none by DEC-APP-003, and FCM is unimplemented (TQ-002 `OPEN`) |
| **I** — Admin operations | The Human Supervisor console: three guarded endpoints under `/api/v1/admin/supervisor` plus the console screens, projecting AI Operations escalations out of `audit_logs` | **Started — the exception half only.** Inbox, case detail and case closure work end to end, with the HTTP boundary proven at 401/403/200 per route. The financial half is partial: refunds and reconciliation exist at the API layer (Q-020), while the A-16…A-22 screens, settlement and payout are unbuilt behind Q-002 and Q-032. See `docs/HUMAN_SUPERVISOR_CONTRACT.md` |
| **J** — AI Operations + Human Supervisor | Authorized by DEC-040, positioned after Phase I. Two vertical slices built in `apps/api/src/modules/ai-ops`: **merchant acceptance timeout** (`44abab39`) and **no-rider triage** (`0726b269`), both running as tick phases | **Started, deliberately partial.** The pipeline shape is complete end to end — normalize, deterministic router, policy gate, agent port, command catalog, dispatcher with domain revalidation, verification, `actor_type = 'AI'` audit. The merchant playbook **escalates rather than acting** in production because BQ-013 supplies no deadline; the no-rider playbook resolves DEC-022 and escalates by design, because it has no command at all. **No model vendor is selected** — the agent adapter is deterministic. Every remaining playbook in the design package is blocked on an open business decision (§13) |

## 4. Implemented is not verified

The table above reflects what the code and its tests evidence. It does **not**
claim that each flow has been walked against the live `banhao-dev` project.
These have been, by execution:

| Verified live | When | Evidence |
|---|---|---|
| Phone OTP → profile read under RLS → `display_name` write → session survives restart → logout persists | 2026-08-10 (EVENT-011) | `supabase/tests/live-rls-check.mjs`, 14/14 |
| Merchant M-05 accept: one `POST /orders/:id/accept` → 200, `MERCHANT_ACCEPTED` with `prep_minutes`, exactly one `deliveries` / `order_status_history` / outbox row, board updated by Realtime | 2026-09-01 (EVENT-026) | `CLAUDE.md` §11; fixture `M05-VERIFY-0005` |
| D-01 commission snapshot rows and the First Manual Tick (accepted) | 2026-09-20 | `CLAUDE.md` EVENT-035 |
| **Full order happy path**: cart → order → Stripe test payment → webhook → `PAID` → accept → dispatch → pickup → proof photo → `DELIVERED`, with the expected ledger. Local API against `banhao-dev`, API-level, manual ticks | 2026-11-02 | [`E2E_RUN_2026-11-02.md`](E2E_RUN_2026-11-02.md) |
| M-AV PAUSED customer path on iOS Simulator (G-3 Test A); the rest of G-3 is `BLOCKED` | 2026-09, after `ab3efec3` | `CLAUDE.md` §11 |

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
| **tick-worker** (Cloudflare Worker) | **Deployed**, cron `* * * * *`, `API_URL` set to staging. **Fail-closed by owner decision**: Worker-side `INTERNAL_TICK_SECRET` unset, so recurring ticks do not run |

## 6. API

58 operations across 55 paths (counted from `openapi.json`, 2026-11-02), all under `/api/v1` except `GET /health`. The contract
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

Staging boots with R2 config wired (`71c05907`). `R2_PRIVATE_BUCKET` is
deliberately unprovisioned (DEC-038, pending Q-012), so **proof-of-delivery has
never run against a real bucket**.

## 9. Test and quality status

Run in full, **uncached** (`pnpm turbo run lint typecheck test build --force`),
2026-11-02 at `36d99edd`, once. The Docker SQL suites below were not run in this
pass.

| Package | Tests |
|---|---|
| `@banhao/api` | 2,029 |
| `@banhao/merchant` | 636 |
| `@banhao/customer` | 514 |
| `@banhao/driver` | 334 |
| `@banhao/validation` | 220 |
| `@banhao/ui` | 22 |
| `@banhao/admin` | 18 |
| `@banhao/api-client` | 16 |
| `@banhao/config` | 13 |
| **Total** | **3,802 — all passing** |

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

33 migration files. 16 are the `e471ec1d` checkpoint V1.1 was reviewed against;
17 have been merged since, each additive and each under an explicit
instruction. **All 33 are applied to `banhao-dev`**: `supabase migration list
--linked`, run 2026-11-02 after the project was restored from a pause, shows a
matching Remote entry for every local version. The 33rd,
`20261102000001` (DEC-068 A1, `payment_events.payment_id` write-once), was
applied the same day with `supabase db push --linked` under the owner's A1
choice.

- `20260921000001` (AI Ops dedup) is applied even though its own commit says it
  was not. Nothing in Git records who applied it. A direct read confirms
  `audit_logs_ai_action_entity_key` exists as designed.
- `20260907000001`, `20260907000002`, `20260908000001`, `20260909000001` are
  confirmed by the migration list only, not by direct schema read.
- `20260915000001` (D-01) is also exercised by the First Manual Tick.

`banhao-dev` is a free-tier project and was found paused on 2026-11-02; it will
pause again after long idle periods. The table below covers the first ten after
the checkpoint.

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

The table above is the 2026-09-01 gate; Cloud Run has since been provisioned for
staging.

**Staging exists; production does not.** Checked 2026-11-02:

| Component | State |
|---|---|
| API | `banhao-api-staging`, revision `00012-sn6` (2026-11-02): image built from `4599bccb` by `deploy-api.yml` (includes `36d99edd`), plus `STRIPE_WEBHOOK_SECRET` and `R2_PRIVATE_BUCKET` (DEC-066). `/health` `ok` |
| Database | `banhao-dev`, `ACTIVE_HEALTHY` after a restore from pause on 2026-11-02 |
| Tick Worker | Deployed, **running every minute against staging since 2026-11-02 08:51 UTC** (DEC-066) |
| Admin | `deploy-web.yml` last succeeded 2026-09-21; the live site was not checked |
| Merchant | **No deploy target.** `deploy-web.yml` builds `apps/admin` only, and its comment calling merchant an Expo shell is stale |
| Customer, Driver | No store or EAS release recorded |
| Production database | Does not exist. It must be a separate project, never `banhao-dev` |

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
| 0a | ~~Staging cannot take an order end to end~~ | **Resolved 2026-11-02** | Stripe test webhook `we_1UXG7eARZ0Fu9Rq0GSa6HM96` (DEC-055 clause 7 events only), `STRIPE_WEBHOOK_SECRET`, `R2_PRIVATE_BUCKET` with the R2 token's scope extended, recurring tick. Order `BH-20261102-0002` went cart → `DELIVERED` on staging with Stripe's own webhook. See [`E2E_RUN_2026-11-02.md`](E2E_RUN_2026-11-02.md) |
| 0c | ~~No operator exists~~ | **Resolved on staging** | `+66899999999` granted `ADMIN` in `platform_staff` on `banhao-dev` (DEC-066); `/admin/supervisor/me` answers 200 `ADMIN` |
| 0d | Customer notifications show raw event names (`OrderDelivered`), no body | Product decision | A per-event title/body convention |
| 0e | ~~Refunds fail at Stripe on staging~~ **Resolved 2026-11-03: full refund verified end to end on staging** | — | Order `BH-20261103-0001`: paid, cancelled by the customer, refunded by staff; Stripe emailed the customer for bank details, the refund went `REFUND_PENDING` → `REFUND_REQUESTED` → `REFUNDED`, and the three DEC-059 reversal groups posted (−7500 / −500 / commission ±600). Two causes found and fixed: (1) PromptPay refund emails can only go to the Stripe account's own verified address until the account application is submitted, so the test customer's email was set to that address (production needs the application submitted); (2) the payment event loop consumed `refund.*` events before the refund loop saw them (`f47d030f`, revision `00014-fft`). Order `BH-20261102-0003` stays `REFUND_FAILED` (its Stripe idempotency key replays the old error). See [`E2E_RUN_2026-11-02.md`](E2E_RUN_2026-11-02.md) |
| 0g | ~~`payment_events.payment_id` is never filled in~~ **Resolved 2026-11-02** (DEC-068 A1) | — | Migration `20261102000001` makes `payment_id` write-once (null → value once, never changed after); 18 SQL assertions in `run-domain-tests.sh`; **applied to `banhao-dev`** and its function body confirmed by schema dump. The refund event processor now links an event only after its provider payment identity matches. Events received before the fix (orders `BH-20261102-0001…0003`) stay unlinked; nothing back-fills them |
| 0f | **Money flow (Q-002 / DEC-067 S1)** | **Owner action** + Stripe sales | Research done: Stripe Connect direct charges are the only path found that keeps BANHAO from holding restaurants' money. The owner chose to ask Stripe, Opn and 2C2P (DEC-068 B1); drafts are in [`Q-002-PROVIDER-EMAIL-DRAFTS.md`](Q-002-PROVIDER-EMAIL-DRAFTS.md), to be sent by the owner. If Connect is confirmed, the restaurant pays the Stripe fee (B2) and riders are paid weekly by bank transfer (B3). See [`Q-002-MARKETPLACE-PAYMENT-PROVIDER-RESEARCH.md`](Q-002-MARKETPLACE-PAYMENT-PROVIDER-RESEARCH.md) |
| 0b | ~~Recurring Tick~~ | **Running on staging since 2026-11-02 08:51 UTC** (DEC-066) | Production stays DO NOT ENABLE |
| 1 | The Admin app's financial half — A-16 through A-22 (payments, refunds, reconciliation, ledger, settlement) | **Business decision** | Q-002 and Q-032. Q-001 (DEC-055) and Q-020 (DEC-057…060) are resolved. The screens are fully designed in `BANHAO ADMIN - Operations - Phase I.dc.html`. **The exception half — the Human Supervisor console — is built**, since the AI Operations package § 09 designs it and it needs none of those decisions |
| 1b | Phase I's operational commands from a case (cancel, release, redispatch, pause) | **Business decision** | BQ-013, UX-Q-006, OD-04, BQ-015, Q-032. Each case detail names the specific decision blocking it rather than rendering a control the platform cannot back |
| 2 | Merchant M-06, M-09 (`SHOULD`), UX-SPEC M-13 earnings, M-14 settings (`LATER`) | Missing design artifact | Same. None is launch-critical, and M-13 earnings is additionally money-blocked (Q-032 — settlement-cycle parameters a payout screen would need; BQ-029 itself is resolved, **DEC-044**). **M-10 and M-AV are no longer on this list — both are built**, each from its own committed artifact |
| 3 | Customer C-14 prep-time caption | **Missing credential** | The fixture orders belong to `+66811110009`, for which no Test OTP pair is documented. A Supabase Dashboard action, or a fixture pointed at an onboarded identity. Do not guess an OTP |
| 4 | Sentry (the last Phase A item) | **External account** | An account and a DSN. Free tier is single-user; $26/month on the second developer |
| 5 | Production deployment, and a merchant deployment at all | **External infrastructure** | A separate production Supabase project and production services; a Pages target for `apps/merchant` |
| 6 | R2 private bucket; POD on hardware | External infrastructure / devices | `R2_PRIVATE_BUCKET`, held back by DEC-038 pending Q-012; a physical iOS and Android device |
| 7 | Live money, and everything settlement-shaped | **Business decision and audit** | Q-002 (legal model) gates settlement. Live payments also need the Q-020 End-to-End Acceptance Audit and Stripe webhook registration. Ledger-posting code for settlement is still unwritten |
| 7b | M-AV G-3 Tests B (rest), C, D | Device / environment | A working Simulator pipeline. `simctl` currently stops on an unaccepted Xcode license: run `sudo xcodebuild -license` |
| 7c | AI Ops dedup code on staging, and T7 | Explicit instruction | The migration is applied; the API revision carrying `36d99edd` is not deployed. T7 also needs DEC-065's formal confirmation recorded |
| 8 | Driver R-13 earnings, and any money on a rider surface | **Engineering task** (business decisions resolved) | **BQ-029 resolved 2026-09-05 — DEC-044** (flat ฿12/1200 satang per completed delivery). **Implemented** `6432e3b3`: `deliveries.rider_earning_satang` is snapshotted at delivery completion and a `RIDER_PAYABLE −1200` ledger entry is posted. That implementation surfaced a real accounting boundary — the entry has no offsetting funding entry, since no `CUSTOMER_PAYMENT` line exists anywhere in the current ledger — which **BQ-040 / DEC-045 (2026-09-05) resolved**: BANHAO absorbs the ฿2 (200 satang) gap between the ฿10 delivery fee and the ฿12 rider earning as a `PLATFORM_WRITE_OFF`. **The offsetting `PLATFORM_WRITE_OFF +200` entry is now implemented** (`b813b5c6`), posted in the same rider-earning completion ledger group as `RIDER_PAYABLE`. This narrows the group's residual from `-1200` to `-1000` — it does **not** mean full settlement/payout, or the broader `CUSTOMER_PAYMENT`/full-order-ledger flow, is implemented; those remain outside DEC-045's scope, and no rider earnings surface exists in any app yet |
| 9 | Dropping `profiles.role` | **Approved migration** | A migration explicitly approved for it. The application half is already done |
| 10 | Push notifications (Phase H's missing channel) | Technical decision | TQ-002 |
| 11 | Android, physical iOS, real SMS, the search results list | Device / environment | Hardware and an Android SDK on the build machine |
| 12 | ~~Applying `20260904000001` (M-AV) and `20260904000002` (AC-04) to `banhao-dev`~~ | **Resolved** | Both applied and verified on `banhao-dev` 2026-09-04, under an explicit operational instruction — `supabase migration list --linked` shows 26/26, and direct schema reads confirm the columns, constraints, and the deployed `create_order()` body match the migration text with no pre-existing row rewritten. (`20260901000002` was applied and verified live 2026-09-03; that older entry was already closed.) ~~A UI walkthrough of the M-AV board control... is still outstanding~~ **The merchant M-AV board control was live-verified through the real browser UI** (Normal→Busy→Paused→Normal, pause-safety, resume — all observed, not inferred). **The customer C-14 caption remains PARTIAL**: a real order (`BH-20260905-0001`) was created live through the customer API while the restaurant was genuinely `BUSY`, `customer_quoted_prep_minutes` correctly captured the busy value and stayed unchanged after the restaurant returned to `NORMAL`, and the customer's own RLS-scoped session (not service-role) reads the correct value through C-14's exact query. **What remains blocked is rendering the actual React Native screen**: this machine's installed Expo Go is SDK 53, the customer app is pinned to SDK 52 — an Expo-Go/project version mismatch, not a missing Test OTP (a real, working customer session was obtained for this test) |
| 13 | ~~`apps/merchant` lint/typecheck/build and `apps/api` lint were red on this branch~~ | **Resolved** | Two stray unused imports introduced by `20044391` (M-10) — `waitFor` in `apps/merchant/src/components/RestaurantProfileForm.test.tsx` and `DomainError` in `apps/api/src/modules/merchant/restaurant-profile.controller.spec.ts` — were removed in the separate hygiene commit `1654e4ef` (`chore: remove pre-existing unused imports`). `apps/merchant` lint/typecheck/build and `apps/api` lint are now green; merchant's own test suite had passed throughout (613 tests) — it was only the lint rule that failed the build. Not part of the M-AV or AC-04 implementation itself |
| 14 | ~~The `CUSTOMER_PAYMENT` ledger entry — no offsetting funding entry existed for either the commission or rider-earning groups~~ | **Resolved** | **Posted 2026-09-05** (`docs/SETTLEMENT_MODEL.md` § 3.1, design locked then implemented same day) — `postCustomerPaymentLedger` in `payment-event-processing.service.ts`, `CUSTOMER_PAYMENT +payment.amount_satang`, anchored on `payment:<paymentId>:<providerTransactionId>`, independent of the commission and rider-earning groups exactly as they are independent of each other. No migration — every schema piece already existed. 1513/1513 API tests pass |
| 15 | ~~Whether `payment_transactions` and `CUSTOMER_PAYMENT` are ever verified to agree~~ | **Resolved (read-only)** | **`PaymentReconciliationService` implemented 2026-09-06** (`apps/api/src/modules/payments/payment-reconciliation.service.ts`, per the design locked in `docs/SETTLEMENT_MODEL.md` § 11.1) — payment-transaction-centric matching by the reconstructed `group_key`, restricted to the earliest `payment_transactions` row per `SUCCESS` payment, additionally excluding any payment with an existing `LATE_PAYMENT`/`SURPLUS_PAYMENT` `reconciliation_cases` row (a refinement the design note under-specified — see the service's own doc comment). Bounded scans (payments and orphan `CUSTOMER_PAYMENT` groups), strictly read-only — no INSERT/UPDATE/DELETE anywhere in the file, proven by test. **No controller, no persistence** — findings are returned in-process only; `reconciliation_cases` still cannot hold these categories without a migration this work does not make. 20 new tests, full API suite 1533/1533, no schema/migration/dependency change |
| 16 | ~~Service fee revenue recognition — the ฿5 (500 satang) service fee has never been recognized as `PLATFORM_REVENUE`~~ | **Resolved** | **Implemented 2026-09-06** per DEC-047 (`docs/SETTLEMENT_MODEL.md` § 3.2) — `postServiceFeeLedger` in `payment-event-processing.service.ts`, `SERVICE_FEE_REVENUE +orders.service_fee_satang` to `PLATFORM_REVENUE`, anchored on `servicefee:<paymentId>:<providerTransactionId>`, called from both the fresh-transition and already-PAID self-heal branches alongside `postCommissionLedger`/`postCustomerPaymentLedger`. Amount is read fresh from the order's immutable snapshot, never hardcoded, never derived from `grand_total_satang` or the subtotal. No migration, no new account. 7 new tests, full API suite 1540/1540. **Does not close** BQ-027 (refundability), delivery-fee revenue recognition, gross merchant payable, or order-level zero-sum |
| 17 | ~~Service fee refundability — whether the ฿5 survives a refund~~ | **Resolved (decision only)** | **DEC-048** (2026-09-06) — Option A: the service fee is included in an eligible full order refund; `SERVICE_FEE_REVENUE` must eventually be reversed through a new group, never a mutation. **Not implemented** — no refund code, reversal ledger group, or migration exists. Does not decide which causes qualify for a full refund (BQ-016, BQ-015, BQ-017 remain `OPEN`), partial-refund composition (BQ-031 remains `OPEN`), or the refund execution mechanism (Q-020 remains `OPEN`). BQ-027 carries no further open half |
| 18 | Refund ledger architecture — how a refund reversal is represented in the ledger | **Resolved (architecture only)** | **DEC-049** (2026-09-07) — independent reversal groups, one per reversed component (negative `CUSTOMER_PAYMENT`; negative `PLATFORM_REVENUE` from `orders.service_fee_satang`); **no `REFUND_PAYABLE` bridge** (that account stays reserved and undecided); **no zero-sum requirement**; identity anchored on `refunds.id`/`refund_reference`, never a provider identifier; posted **only at verified refund finality** (`REFUNDED`), never at request/approval/processing; existing insert-first self-heal reused; **no migration, no schema change**. **Not implemented** — no refund code, reversal posting, webhook branch, or reconciliation change exists. Decides representation only: BQ-016, BQ-015, BQ-017, BQ-031 and Q-020 all remain `OPEN`, as does whether `CUSTOMER_PAYMENT` is reversed in any given case |
| 19 | Cancellation window, cancellation fee, and refund eligibility | **Resolved (policy only)** | **DEC-050** (2026-09-07, resolving **BQ-016**) — free customer cancellation through **`MERCHANT_ACCEPTED`**; **no Phase 1 cancellation fee** of any kind; cancellation during `PREPARING` requires merchant confirmation and, where confirmed, is a **full** refund (never partial); a repeat cancellation is an error / invalid transition. DEC-048 (service fee) and DEC-049 (ledger representation) are unchanged. ⚠️ **Runtime not implemented and narrower than policy** — `CUSTOMER_CANCELLABLE_STATES` in `orders.service.ts` stops at `PAID`, there is no merchant-confirmation flow, no customer cancellation UI, no refund initiation, and neither cancel path emits a notification. Deliberately still `OPEN`: BQ-015 (cooked-food cost), BQ-017 (post-pickup refusal / delivery failure), BQ-031 (partial refunds), Q-020 (mechanism) |
| 20 | Cooked-food loss — who bears it when a prepared order fails | **Resolved (policy only)** | **DEC-051** (2026-09-07, resolving **BQ-015**) — allocated **by cause**: platform-caused loss (no rider; operator cancellation from the platform's own inability to deliver) to **BANHAO** as `PLATFORM_WRITE_OFF`; merchant-caused loss to the **merchant**. Food is prepared from **`PREPARING`**; valuation basis is `orders.subtotal_satang` — **not** net of the 8% commission and **not** a merchant payable. No merchant penalty, no customer charge, no partial refund. Post-`PICKED_UP` cases belong to BQ-017. ⚠️ **Runtime not implemented**: the cancel API rejects `causeCode` (tests pin it), nothing writes `orders.cause_code`, no gross merchant payable exists, and there is no `PLATFORM_WRITE_OFF` posting for food loss. Its one recorded residual — the **customer-caused pre-pickup** branch — was closed the same day by **DEC-052**: BANHAO absorbs that loss too, as `PLATFORM_WRITE_OFF` (an allocation rule, not a fault finding; no customer fee, no merchant penalty). BQ-017, BQ-031, Q-020, BQ-024 and BQ-013 stay `OPEN` |
| 21 | Post-pickup delivery failure — customer unreachable, refusal, or a delivery that cannot be completed after pickup | **Resolved (policy only)** | **DEC-053** (2026-09-07, resolving **BQ-017**) — delivery **`FAILED`** / order **`DELIVERY_FAILED`**, declared by an **operator** after **2 contact attempts** and a **5-minute** wait from `ARRIVED`. Economics are **cause-dependent**: customer-caused → **no refund** of any component and the merchant absorbs the cooked-food loss (**not** a cancellation fee — DEC-050 unchanged); rider-, platform-caused and `INDETERMINATE` → full eligible refund with BANHAO absorbing the food loss (`PLATFORM_WRITE_OFF`, valued at `orders.subtotal_satang`); merchant-caused → full eligible refund with the merchant absorbing it. Rider compensation **eligible** in every case, amount owned by **BQ-024**. Safe drop-off **not** authorized (UX-Q-006/OD-04). **DEC-054** (2026-09-07) locks the anchor (`EN_ROUTE → ARRIVED`, distinct from merchant arrival `AT_MERCHANT`) and grants a **narrow DEC-APP-006 carve-out** letting this path use `DELIVERY_FAILED` while **BQ-013 stays `OPEN`**. ✅ **Operational runtime BUILT** in three slices (2026-09-07/08, branch `feature/g7-driver-availability`): customer-arrival transition + `arrived_at` anchor + `ARRIVED` state (`a50e7b17`); append-only `delivery_contact_attempts` capped at 2 by database constraints, the operator failure command `POST /admin/supervisor/deliveries/:id/fail` with all four preconditions and no override, rider-assignment close + slot release, and the removal of `PICKED_UP`/`DELIVERING` from generic operator cancellation (`7e6b2dbb`); the five-minute tick escalation, the read-only operator working list `GET /admin/supervisor/deliveries/awaiting-failure`, and the `OrderDeliveryFailed` customer/merchant notification. **The timer escalates only — it issues no `UPDATE` and cannot fail a delivery; the operator remains the sole authority.** ⚠️ **Economic runtime still not implemented**: no refund initiation or mechanism (**Q-020**), no ledger reversal, no `PLATFORM_WRITE_OFF` food-loss posting, no rider compensation (**BQ-024**), no merchant payout exclusion (settlement unbuilt). The three migrations are **merged but not applied to `banhao-dev`**. BQ-024, BQ-031, Q-020, BQ-013 and UX-Q-006 stay `OPEN` |

**2 P0 business decisions remain**: Q-002 (the legal/settlement model) and
BQ-030 (**stacking only**). Q-001 left this list 2026-09-08 (DEC-055) and Q-020
left it 2026-09-08/09 (DEC-057…060). Rows 19–21 above are as written at their
dates: refund initiation has since landed, and `CUSTOMER_CANCELLABLE_STATES`
still stops at `PAID` as of 2026-11-02, so row 19's gap stands. BQ-015 left this list 2026-09-07 — **DEC-051** allocates the
cooked-food loss by cause (policy only, not implemented). BQ-027 left this list 2026-09-06 — **DEC-048** resolved
refundability (Option A, service fee included in an eligible full order
refund; not implemented), the last open half after DEC-047 resolved
recognition timing. The delivery and service fee **amounts** were approved 2026-08-24
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
