# BANHAO — APPLICATION ARCHITECTURE V1.1

Read-only architecture review. No application code, migrations, or repository
changes were produced by this task. V1.1 is a clarification and consistency
pass over V1 — no redesign, no new services, no database change. See §21 for
what changed and the approval status.

| | |
|---|---|
| Repository | `kmandev/banhao-design` |
| Branch | `main` |
| Commit reviewed | `e471ec1d` |
| Database | Supabase `banhao-dev`, PostgreSQL 17.6.1.155, `ap-southeast-1`, 16/16 migrations applied, LOCKED |
| Review date | 2026-08-11 |
| Budget constraint | $0/month infrastructure at Stage 1 |
| Posture | Decisive. Where two options were close, one is chosen and the loser is recorded. |

---

## 0. Two corrections before anything else

**`docs/ARCHITECTURE.md` is stale and actively misleading.** It states there is
"no implemented system architecture in this repository — no backend, no
database, no API, no auth, no deployment infrastructure," verified 2026-08-09.
That was true on 2026-08-09. It is false at `e471ec1d`: a pnpm/Turborepo
monorepo exists with a running NestJS API, an implemented Expo customer app, five
shared packages, GitHub Actions CI, and a Dockerfile. Any agent that reads that
file first will design from a blank slate and duplicate work that already exists.
It should be rewritten as the first task after this review is approved.

**`docs/CURRENT_STATUS.md` is stale on the database.** It reports three
migrations applied and eleven "not merged, live project never modified." The
brief states 16/16 applied and deployed. `CURRENT_STATUS.md` is dated 2026-08-10;
the migration work landed 2026-08-11. Treat the deployed database and the
migration files at `e471ec1d` as truth, not that document.

Neither correction changes a single architectural decision below. They change
who is allowed to believe what.

---

## 1. Current Repository Architecture

Determined by inspection, not assumption.

### Workspace

| Aspect | Actual |
|---|---|
| Package manager | pnpm 9.15.0, `pnpm-workspace.yaml` = `apps/*`, `packages/*` |
| Build orchestration | Turborepo 2.3.3 (`build`, `dev`, `lint`, `typecheck`, `test`) |
| Language | TypeScript 5.7.2, `tsconfig.base.json` with full strict set plus `noUncheckedIndexedAccess`, `noImplicitReturns`, `noUnusedLocals` |
| Node | ≥20 (CI runs 22) |
| React | Pinned 18.3.1 monorepo-wide via `pnpm.overrides`, with a written rationale (Expo 52 / RN 0.76 / Next 15 all support it) |
| Lint/format | ESLint 8 + Prettier 3, `.eslintrc.json` at root |

### Applications

| App | Framework | State at `e471ec1d` |
|---|---|---|
| `apps/api` | NestJS 10 + Express, Swagger, `jose`, `zod`, `@supabase/supabase-js` | Foundation. `GET /health`, `GET /api/v1/me`. Global `SupabaseAuthGuard` + `RolesGuard` + `ResponseInterceptor`, global `HttpExceptionFilter`. `PaymentProvider` interface + `NullPaymentProvider`. Dockerfile present. |
| `apps/customer` | Expo / React Native 0.76 | **Implemented.** 31 design states, 4-tab `RootNavigator`, phone-OTP auth against live Supabase, `profiles` read/write under RLS, repository seam, 4 test suites. Everything except auth and `profiles` is mock-backed. |
| `apps/merchant` | Expo | Shell only — `App.tsx`, `app.json`, no `src/`. |
| `apps/driver` | Expo | Shell only — same. |
| `apps/admin` | Next.js 15 (App Router) | Shell only — `layout.tsx`, `page.tsx`. |

### Shared packages

| Package | Purpose | Notes |
|---|---|---|
| `@banhao/types` | Shared types (`Role`, `Money`, `ApiResponse`) | Compiled to `dist`, no runtime code |
| `@banhao/config` | `loadServerEnv()` + zod validation | Called in `main.ts` before `NestFactory.create` — misconfiguration fails at boot, not first request |
| `@banhao/validation` | Shared zod schemas | Present, jest configured |
| `@banhao/api-client` | Typed API client for all four apps | Present, depends on `@banhao/types` |
| `@banhao/ui` | RN design tokens + components, `./theme` export | Source-exported (no build step), peer-deps React/RN |

### Supabase integration boundary (as built)

- `apps/api/src/supabase/supabase.service.ts` owns **two** concerns: a
  `service_role` client (`admin`, bypasses RLS, documented as backend-only) and
  `verifyAccessToken()` using `jose` + `SUPABASE_JWT_SECRET`.
- `apps/customer/src/lib/supabase.ts` uses the **anon key only**, with
  `AsyncStorage` session persistence and an `isSupabaseConfigured` guard so the
  app still runs on mocks when unconfigured.
- The customer app talks to Supabase **directly** for auth and `profiles`. It
  does not call `apps/api` at all yet.

### CI

`.github/workflows/ci.yml`, four independent jobs: `verify` (lint → typecheck →
test → build), `rls` (applies the auth shim and every migration to a throwaway
Postgres and asserts authorization), `docker` (builds the API image, no push),
`secrets-scan` (fails if a `.env`/key/credential file is tracked).

### Not present

No hosting configuration, no deployment workflow, no worker entrypoint, no
domain endpoints, no payment provider, no notification transport, no storage
usage, no realtime usage, no maps provider.

### Verdict

**The foundation is sound and correctly shaped. Nothing in it should be
replaced.** The work ahead is filling in domain modules, replacing the customer
app's mock repositories, building three thin clients, and deploying — not
re-architecting.

---

## 2. Proposed Application Architecture

One sentence: **keep the monorepo, keep the modular-monolith NestJS API, split
reads and writes at the Supabase boundary, and deploy on free tiers with one
deployable and one scheduled tick.**

Five decisions carry the whole design:

1. **Reads go client → Supabase (PostgREST/Realtime) under RLS. Writes go
   client → API → Supabase.** This is the single most consequential decision in
   the document. It is what makes a $0 architecture viable *and* what satisfies
   ADR-001/ADR-002 without contradiction.
2. **One deployable for the API, one scheduled tick into it.** No broker, no
   second service, no queue infrastructure — the schema already has `outbox` and
   `jobs`.
3. **Merchant moves from Expo to web.** A restaurant works on a browser, and
   this removes an app-store review from the critical launch path.
4. **Role resolution moves off `profiles.role` and onto domain membership**, to
   match DEC-033 and the 55 RLS policies that contain zero `profiles.role`
   references. `RolesGuard` as written is already architecturally stale.
5. **Build the full order → delivery flow against the existing
   `NullPaymentProvider`.** Q-001 (provider) and Q-020 (PromptPay refund) are
   externally blocked; they must not block eight other domains.

---

## 3. Database → Domain Mapping

Every table, view, and function below was read from the migration files at
`e471ec1d`. "API-only" means `revoke all ... from anon, authenticated` with no
SELECT policy — the row is unreachable from any client.

### IDENTITY

| | |
|---|---|
| Tables | `profiles` (+ `user_role` enum, `handle_new_user` trigger on `auth.users`), `platform_staff`, `addresses` |
| Functions | `set_user_role(uuid, user_role)` (SECURITY DEFINER), `enforce_profile_immutable_columns()`, `reject_delete()`, `reject_mutation()` |
| RLS | `profiles`: own row select, own-row update with immutable-column trigger (id/phone/role rejected). `platform_staff`: own row only. `addresses`: full own-row CRUD except delete (delete rejected by trigger) |
| Service | `IdentityService` (extends existing `UsersService`) |
| API | `GET /api/v1/me`, `PATCH /api/v1/me`, `GET|POST|PATCH /api/v1/addresses` |
| UI | All four apps (session + profile); customer (addresses) |
| Client direct read | ✅ `profiles`, `addresses` — already in use |

### MERCHANT

| | |
|---|---|
| Tables | `merchants` (`commission_bps`), `merchant_bank_accounts`, `restaurants` (PostGIS `location`, `status`, `zone_id`), `restaurant_members` |
| RLS | `merchants`: own only. `restaurants`: `restaurants_select_active` (public, incl. anon) + `restaurants_select_member`. `restaurant_members`: member only. `merchant_bank_accounts`: **API-only** |
| Boundary | `is_restaurant_member(uuid)` is the membership predicate used across merchant policies |
| Service | `MerchantsService`, `RestaurantsService` |
| API | `GET /api/v1/restaurants` (client may read direct), `PATCH /api/v1/merchant/restaurant/:id`, `PUT /api/v1/merchant/bank-account` |
| UI | Customer (browse), Merchant web (own), Admin (onboarding) |

### CATALOG

| | |
|---|---|
| Tables | `restaurant_hours`, `menu_categories`, `menu_items`, `menu_option_groups`, `menu_options` |
| RLS | Two policies per table: `*_select_active` (public, gated on the restaurant being ACTIVE and the row being active) and `*_select_member` |
| Service | `CatalogService` |
| API | Reads: **client direct** (PostgREST). Writes: `POST|PATCH /api/v1/merchant/menu/*` |
| UI | Customer (menu), Merchant web (menu management) |
| Note | This domain is the entire replacement target for `apps/customer/src/repositories/` catalog mocks |

### CART

| | |
|---|---|
| Tables | `carts`, `cart_items` (composite FK on `(cart_id, restaurant_id)`), `cart_item_options` |
| RLS | Full own-row CRUD for the owning customer, including DELETE — the only domain with client write access to a domain table |
| Service | `CartService` (validation only; the client owns the writes) |
| API | `POST /api/v1/cart/validate` before checkout |
| UI | Customer only |
| Rationale | A cart is not financial data. Client-side cart writes under RLS remove a whole class of API round-trips at zero risk, because the order snapshot — not the cart — is what becomes the contract |

### ORDER

| | |
|---|---|
| Tables | `orders`, `order_items`, `order_item_options`, `order_status_history` |
| Views | `rider_order_view`, `rider_order_item_view`, `rider_order_item_option_view` — `security_invoker = false, security_barrier = true`, scoped by `is_assigned_order_rider()` |
| Triggers | `orders_enforce_immutable_columns()` (money + all snapshots + `placed_at` immutable **for service_role too**; DELETE refused). `order_items`/`order_item_options`/`order_status_history` → `reject_mutation()` (write-once/append-only) |
| Constraints | `orders_total_check` (grand = subtotal + delivery + service − discount), `orders_id_restaurant_id_key` composite anchor, 14-value `state` CHECK |
| RLS | Customer own; merchant via `is_restaurant_member`; **rider has no base-table policy at all** — the rider policies were dropped and replaced by the three views |
| Service | `OrdersService` — the only writer |
| API | `POST /api/v1/orders`, `POST /api/v1/orders/:id/accept|reject|preparing|ready|cancel` |
| UI | All four |

### PAYMENT

| | |
|---|---|
| Tables | `payments` (unique per `order_id`), `payment_attempts` (unique `(payment_id, attempt_no)`), `payment_events` (unique `(provider, provider_event_id)` — the duplicate-webhook protection), `payment_transactions` (unique `provider_transaction_id`), `refunds` (unique `refund_reference`, partial unique `(provider, provider_refund_id)`) |
| Triggers | Immutability on `payments` (order/reference/method/amount/currency), `payment_events` (append-only except `processed_at`/`processing_error`), `refunds` (payment/reference/amount); `payment_transactions` fully immutable |
| RLS | **Every table API-only. No client policy exists on any of them.** |
| Service | `PaymentsService`, `WebhooksController`, `RefundsService` |
| API | `POST /api/v1/orders/:id/payment`, `POST /api/v1/payments/:id/retry`, `POST /webhooks/payments/:provider` (public, signature-verified), `POST /api/v1/admin/refunds` |
| UI | Customer sees payment state through the order read model, never the payment table |

### LEDGER

| | |
|---|---|
| Tables | `ledger_entry_groups` (unique `group_key`), `ledger_entries` (9-value `account` CHECK, signed `amount_satang`) |
| Triggers | `reject_mutation()` on both — no UPDATE, no DELETE, for any role including service_role |
| Deliberate absence | **No zero-sum trigger** (DEC-034). CON-003 still binds; it is asserted in the service transaction and re-verified by reconciliation. Do not add a trigger. |
| RLS | API-only, both tables |
| Service | `LedgerService` — the **only** writer, and never called from a controller directly |
| API | `GET /api/v1/admin/ledger`, `GET /api/v1/merchant/earnings`, `GET /api/v1/rider/earnings` (all derived reads) |
| UI | Admin finance, merchant earnings, rider earnings |

### RIDER

| | |
|---|---|
| Tables | `riders`, `rider_documents`, `rider_availability` (PostGIS + partial index on online + location) |
| RLS | `riders`: own row select. `rider_documents`: own select. `rider_availability`: own select **and own update** — the second client-writable surface |
| Boundary | `is_assigned_rider(uuid)` |
| Service | `RidersService` |
| API | `PATCH /api/v1/rider/availability` (or client direct), `POST /api/v1/rider/documents` |
| UI | Driver app; Admin (approval) |

### DELIVERY

| | |
|---|---|
| Tables | `deliveries` (10-value state, unique per order, `rider_id` is authoritative), `delivery_status_history`, `rider_assignments` (**partial unique `rider_assignments_one_active` — the race backstop**), `rider_assignment_attempts` |
| Functions | `release_rider_assignment(uuid, text, text)` — SECURITY **INVOKER**, `execute` granted to `service_role` only, revoked from public/anon/authenticated |
| RLS | `deliveries`: customer, merchant, rider (full row — deliberately unchanged; `rider_earning_satang` is the rider's own). `rider_assignments`/`rider_assignment_attempts`: own only |
| Service | `DeliveryService`, `DispatchService` |
| API | `POST /api/v1/rider/offers/:id/accept|decline`, `POST /api/v1/rider/deliveries/:id/arrived|picked-up|delivered|cancel`, `POST /api/v1/admin/deliveries/:id/reassign` |
| UI | Driver app; customer tracking; admin dispatch |

### AUDIT

| | |
|---|---|
| Tables | `audit_logs` (`reject_mutation()`, indexed by entity and actor) |
| RLS | API-only |
| Service | `AuditService`, written inside the same transaction as the operation it records |
| UI | Admin only |

### NOTIFICATION

| | |
|---|---|
| Tables | `notifications` (own select + own update — read receipts), `notification_deliveries` (API-only) |
| Service | `NotificationsService` + channel adapters (ADR-011) |
| API | `GET /api/v1/notifications` (client direct read), `PATCH /api/v1/notifications/:id/read` |
| UI | All four |

### INFRASTRUCTURE

| | |
|---|---|
| Tables | `idempotency_records`, `outbox` (partial index on undispatched), `jobs` (partial index on due), `reconciliation_cases` |
| RLS | All API-only |
| Service | `OutboxDispatcher`, `JobRunner`, `ReconciliationService` — all driven by the scheduled tick |
| UI | Admin (reconciliation cases only) |

### Deferred in the database, therefore deferred in the application

`settlements`, `settlement_items`, `delivery_fee_bands`, `zones`,
`service_areas`, `delivery_attempts`. `ledger_entry_groups.settlement_id`
exists with no FK, reserved. **Do not build a settlement module in V1** — its
tables do not exist and DEC-034's reconciliation obligation is met by
`reconciliation_cases` plus the ledger assertion.

---

## 4. Application Boundaries

### DEC-APP-001 — One monorepo, five shared packages, no second repository

**Decision.** Keep `kmandev/banhao-design` as the single repository. Do not
split apps into separate repos.

**Reason.** Four clients consume one order state machine and one money type. A
`Money` change or an order-state rename must land atomically across five
consumers; separate repos turn that into a five-PR version-coordination
exercise. The tooling is already correct: pnpm workspaces, Turborepo task
graph, one React version pinned by override with a written rationale, one strict
`tsconfig.base.json`, one CI run that lints/typechecks/tests/builds everything.
`@banhao/types` + `@banhao/api-client` only pay off inside one repo.

**Alternatives considered.** Repo-per-app; repo-per-platform (mobile vs web vs
api). **Why rejected.** Both require publishing the shared packages to a
registry or vendoring them, and neither buys anything a single owner needs.
Independent release cadence is the usual argument for splitting — BANHAO has one
developer and one launch, so there is no cadence to decouple.

**Impact.** No change. This ratifies what exists.

### DEC-APP-002 — Modular monolith, single deployable; ratify ADR-009 and ADR-010

**Decision.** One NestJS deployable containing every domain module, plus a
second **entrypoint** (not a second service) for the worker, exactly as ADR-010
proposes. No microservices, no broker, no separate scheduler service.

**Reason.** The schema already carries the infrastructure a broker would
provide: `outbox` with an undispatched partial index, `jobs` with a due partial
index, `idempotency_records`. `apps/api/src/modules/README.md` already states
the module rules (no cross-module table reads; provider SDKs only inside
`payments/providers/`). At Buntharik volume a broker is pure cost and pure
operational surface.

**Alternatives considered.** Supabase Edge Functions for the whole API;
per-domain services; a hosted queue (Upstash/QStash/SQS). **Why rejected.**
Edge Functions would fork the domain layer into Deno and abandon a working
NestJS foundation, the DI graph, the guards, and the OpenAPI surface — for zero
architectural gain. Per-domain services multiply deploys and break the
single-transaction guarantee that payment + ledger + audit writes require. A
hosted queue duplicates `outbox`/`jobs` and adds a bill.

**Impact.** `apps/api` gains a `worker.ts` entrypoint sharing `AppModule`.

### DEC-APP-003 — Merchant becomes a web app; driver stays native

**Decision.** Replace `apps/merchant` (Expo shell) with a Next.js app on the
same pattern as `apps/admin`. Keep `apps/driver` on Expo.

**Reason.** A restaurant accepts orders on whatever screen is already on the
counter, needs no GPS, no camera, no background execution, and benefits from
printing. Web removes App Store/Play review from the launch critical path for
the one surface a merchant must have on day one — and CON-004 (never lengthen
the core path) argues for the shortest possible route to a merchant being able
to accept. A driver, by contrast, genuinely needs background location, push
while backgrounded, and a camera for proof-of-delivery: that is native.

**Alternatives considered.** Merchant as Expo (status quo); merchant as
Expo-web from one codebase. **Why rejected.** Expo for merchant buys nothing a
merchant needs and costs store review plus device management. Expo-web produces
a mobile-shaped layout on a counter tablet and shares almost no components with
a data-dense order queue.

**Impact.** `apps/merchant` is rewritten as Next.js. `@banhao/ui` stays
RN-only; web apps get their own presentational layer sharing only tokens.
Merchant order-arrival alerting on web needs a sound + Realtime subscription,
not push — noted as a real trade-off, and acceptable because a merchant tablet
stays open during trading hours.

### The five boundaries, as built

```
Customer (Expo)  ─┐
Driver   (Expo)  ─┤ reads  → Supabase PostgREST + Realtime (anon key, RLS)
Merchant (Next)  ─┤ writes → @banhao/api-client → NestJS API → service_role
Admin    (Next)  ─┘ (admin: all traffic through the API, no direct reads)
```

Admin is the deliberate exception: an operator's reads (ledger, reconciliation,
audit, all orders across all restaurants) target API-only tables, so admin has
no direct-read path at all. That is correct and should not be "fixed" by adding
staff RLS policies.

---

## 5. Authentication & Authorization

### The five layers, kept distinct

| Layer | Owner | Question it answers |
|---|---|---|
| **Authentication** | Supabase Auth (phone OTP) | Who is this user? → a `sub` in a signed JWT |
| **Global role / capability** | NestJS guards | What broad capability class does this user have — customer, merchant, rider, operator? |
| **Domain membership** | `restaurant_members`, `riders`, `platform_staff` | Which specific merchant, restaurant, or rider domain does this user belong to? (DEC-APP-004) |
| **Resource authorization** | NestJS guards + services | Can this user access or modify *this specific* resource — this restaurant, this delivery, this order? |
| **RLS** | PostgreSQL | May this actor's session see/modify this row? — final, non-negotiable boundary |

RLS is the last word on data access and is never duplicated as a client-side
check. The client's job is to render, not to adjudicate. **Application-layer
authorization and database RLS must never diverge** — DEC-APP-004 exists
precisely because they had.

### Required test cases (documented here; not implemented by this review)

- Merchant A cannot access Restaurant B's data.
- Rider A cannot access Rider B's protected data.
- A suspended or inactive membership cannot perform privileged operations.
- Customer A cannot access Customer B's protected data.
- An unauthorized user cannot invoke a privileged operation.

These are implementation-phase obligations (Phase B onward), listed here so
the architecture states them explicitly rather than leaving them implicit.

### Flow (as built, and correct)

1. Client calls `supabase.auth.signInWithOtp({ phone })` → `verifyOtp` →
   session persisted in `AsyncStorage`, `autoRefreshToken: true`.
2. `handle_new_user` trigger creates the `profiles` row on `auth.users` insert.
3. Client reads its own profile under `profiles_select_own`.
4. For API calls: `Authorization: Bearer <access_token>` →
   `SupabaseAuthGuard.verifyAccessToken()` (jose, `SUPABASE_JWT_SECRET`) →
   profile lookup → `request.user`.
5. No profile row → `401`, deliberately **not** auto-provisioned, so role
   assignment stays an explicit auditable server action.

### DEC-APP-004 — Role resolution moves from `profiles.role` to domain membership

**Decision.** `SupabaseAuthGuard` must resolve an actor's capabilities from
domain membership — `restaurant_members` (merchant), `riders` (rider),
`platform_staff` (operator/admin), customer implicit — not from
`profiles.role`. `RolesGuard` becomes a capability guard over that resolved
context. `profiles.role` is retained as a legacy column and read by nothing.

**Reason.** DEC-033 replaced generic roles with domain membership, and the
implementation followed through: **all 55 RLS policies contain zero
`profiles.role` references.** The guard as written therefore authorizes against
a value the database no longer consults — the two layers can disagree, and the
disagreement is silent. Worse, membership is *scoped*: a merchant user belongs
to specific restaurants. `role = 'MERCHANT'` cannot express "may accept orders
for restaurant X," which is the actual question every merchant endpoint asks.

**Alternatives considered.** Keep `profiles.role` and sync it from membership;
put roles in JWT app_metadata. **Why rejected.** Syncing creates two sources of
truth for authorization, which is the defect being fixed. JWT claims go stale
for the token's lifetime — unacceptable for revoking a suspended rider, and the
existing guard comment already correctly insists the role must come from the
database, not from a claim the client carries.

**Impact.** Touches `supabase-auth.guard.ts`, `roles.guard.ts`,
`users.service.ts`, `AuthenticatedUser`. Already tracked as a P1 in
`docs/TODO.md`. It is Phase B work and blocks every merchant and rider endpoint.

### Session handling

Refresh: Supabase SDK, client-side, already configured. Logout:
`supabase.auth.signOut()` plus clearing local caches. Unauthorized: `401`
clears the session and returns to login; `403` shows a message and does **not**
log out — a rider hitting a merchant endpoint is a bug, not a session problem.

---

## 6. API / Service Contract

### Conventions

- Base `/api/v1`. Webhooks live outside it at `/webhooks/*`.
- Success: `{ success: true, data }` (existing `ResponseInterceptor`).
- Failure: `{ success: false, error: { code, details?, correlationId, message? } }` — `code` is the canonical, client-resolved contract; `message` (if present) is a developer-facing default only. See §10.
- **Every state change is a command, never `PATCH { state }`** (ADR-009).
- Mutations that create money or dispatch effects carry `Idempotency-Key`.
- Authenticated by default; `@Public()` to opt out.

### Catalogue of operations

| Operation | Auth | Database interaction | Failure cases |
|---|---|---|---|
| `POST /orders` | customer | Validate cart + restaurant open + item availability; snapshot prices; insert `orders` (`CREATED`) + `order_items` + `order_item_options` + `order_status_history`; one transaction | `CART_EMPTY`, `RESTAURANT_CLOSED`, `ITEM_UNAVAILABLE`, `PRICE_CHANGED`, `ADDRESS_OUT_OF_ZONE` |
| `POST /orders/:id/payment` | customer, owner | Insert `payments` (unique per order → second call reads back), `payment_attempts` (attempt_no+1), call `PaymentProvider.createPayment`, return QR + `expiresAt` | `PAYMENT_ALREADY_SUCCEEDED`, `PROVIDER_UNAVAILABLE`, `ORDER_NOT_PAYABLE` |
| `POST /webhooks/payments/:provider` | **public**, signature-verified | Phase 1: verify signature, insert `payment_events`, commit, return 200. Phase 2: process → `payments.state`, `payment_transactions`, `orders.state → PAID`, ledger group, outbox | Bad signature → 401 and **nothing written**; duplicate `provider_event_id` → 23505 → read back, return 200 |
| `POST /orders/:id/accept` | merchant member | Guarded update `PAID → MERCHANT_ACCEPTED`; insert `deliveries` (`RIDER_SEARCHING`); enqueue dispatch job | `INVALID_TRANSITION`, `ACCEPT_WINDOW_EXPIRED`, `NOT_RESTAURANT_MEMBER` |
| `POST /rider/offers/:id/accept` | rider | Guarded conditional UPDATE on `deliveries` (`state IN (RIDER_SEARCHING, RIDER_REASSIGNING) AND rider_id IS NULL`); rows=1 → insert `rider_assignments`; rows=0 → lost the race | `OFFER_TAKEN` (409), `OFFER_EXPIRED`, `RIDER_NOT_APPROVED`, `RIDER_HAS_ACTIVE_DELIVERY` |
| `POST /rider/deliveries/:id/cancel` | assigned rider | `select release_rider_assignment(:id, 'RELEASED', :reason)`; re-broadcast. **Order does not move** (DEC-021) | `NOT_RELEASABLE` (P0001), `NOT_ASSIGNED_RIDER` |
| `POST /admin/deliveries/:id/reassign` | operator | `release_rider_assignment(:id, 'CANCELLED', :reason)` + `audit_logs`; reason mandatory (DEC-032) | as above |
| `POST /admin/refunds` | operator | Insert `refunds`; ledger group; provider call; state advances on webhook only | `REFUND_EXCEEDS_PAYMENT`, `PAYMENT_NOT_REFUNDABLE`, `MECHANISM_UNAVAILABLE` (Q-020) |
| `POST /cart/validate` | customer | Re-price against live catalog, no writes | `ITEM_UNAVAILABLE`, `PRICE_CHANGED`, `MIXED_RESTAURANT` |
| `GET /merchant/earnings`, `GET /rider/earnings`, `GET /admin/ledger` | scoped | Aggregate `ledger_entries` by party; read-only | `FORBIDDEN` |

### DEC-APP-005 — The webhook route bypasses the global response envelope

**Decision.** `/webhooks/*` is `@Public()`, reads the **raw body** (signature
verification requires unparsed bytes), and is excluded from
`ResponseInterceptor`.

**Reason.** A provider expects its own agreed response shape and status, not
`{ success: true, data }`. Wrapping it risks a provider treating a 200 as a
failure and retrying forever. Raw-body access must be configured at bootstrap
(`rawBody: true`) — a JSON-parsed and re-serialized body will not verify.

**Alternatives considered.** Envelope everything uniformly. **Why rejected.**
Uniformity is a convenience for our own clients; a provider contract is not
ours to shape.

**Impact.** `main.ts` bootstrap option; an interceptor exclusion; one route
convention. Small, and a silent production failure if missed.

---

## 7. Order State Machine

Taken from the deployed `orders.state` CHECK and `docs/ORDER_LIFECYCLE.md`. Not
assumed.

### Core lifecycle — ACCEPTED (DEC-019)

```
CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED → PREPARING
        → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED
```

| Transition | Actor | Validation | Side effects |
|---|---|---|---|
| → `CREATED` | System | cart valid, restaurant open, address in zone | items + options + history rows, price snapshot |
| → `PENDING_PAYMENT` | System | order is `CREATED` | payment + attempt created, QR issued, 10-min expiry job |
| → `PAID` | **Verified webhook only** (CON-002) | signature, amount, order match | `paid_at`, ledger group, merchant notification, 3-min accept timer |
| → `MERCHANT_ACCEPTED` | Merchant member | within accept window | `accepted_at`, **delivery row created, rider search starts** (DEC-020) |
| → `PREPARING` | Merchant | is `MERCHANT_ACCEPTED` | customer notification. **Runs parallel to `RIDER_SEARCHING`** |
| → `READY_FOR_PICKUP` | Merchant | is `PREPARING` | `ready_at`; notify assigned rider if any |
| → `PICKED_UP` | Rider | `READY_FOR_PICKUP` **and** delivery has assigned rider — the join point | `picked_up_at`, delivery → `PICKED_UP` |
| → `DELIVERING` | Rider | is `PICKED_UP` | delivery → `EN_ROUTE` |
| → `DELIVERED` | Rider | is `DELIVERING` | `delivered_at`, delivery → `DELIVERED`, ledger completion group, rating prompt |

### Exception states — names PROPOSED, present in the CHECK

`PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`, `CANCELLED`,
`DELIVERY_FAILED`.

### DEC-APP-006 — Implement the nine ACCEPTED states plus `CANCELLED`; nothing else

**Decision.** Phase E implements the nine core transitions and the operator/
customer `CANCELLED` path. `PAYMENT_FAILED`, `PAYMENT_EXPIRED`,
`MERCHANT_REJECTED` and `DELIVERY_FAILED` are **not** implemented until their
names and policies are approved.

**Reason.** `docs/ORDER_LIFECYCLE.md` states plainly that no exception-path code
may be written while its policy is `OPEN`, and BQ-013/BQ-015/BQ-016/BQ-017 are
open. Building against a `PROPOSED` name means a rename later touches the
transition table, the history rows already written to production, four clients'
copy, and the tests. A failed payment simply leaves the order in
`PENDING_PAYMENT`, which DEC-019 explicitly permits and which the customer app
already renders.

**Alternatives considered.** Implement all 14 now; invent interim names. **Why
rejected.** Both convert an open product question into deployed data that has to
be migrated.

**Impact.** `apps/customer/src/mocks/types.ts` still encodes the superseded
twelve states (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`, `COMPLETED`,
`NO_DRIVER`). It must be replaced with the nine + `CANCELLED` in Phase C/E — not
extended.

### Transition mechanics — ADR-003, and non-negotiable

Every transition is a **guarded conditional UPDATE** whose WHERE clause repeats
the expected current state. `rowCount === 1` succeeded; `0` means someone else
moved it → `409 INVALID_TRANSITION`. Never SELECT-then-UPDATE. Every transition
writes `order_status_history` in the same transaction (append-only, and the
customer timeline is derived from it — never stored separately).

### Delivery state — a separate machine (DEC-018)

```
UNASSIGNED → RIDER_SEARCHING → RIDER_ASSIGNED → AT_MERCHANT → PICKED_UP
           → EN_ROUTE → DELIVERED
           ↘ RIDER_REASSIGNING → RIDER_SEARCHING
           ↘ FAILED / ABANDONED
```

`deliveries.rider_id` is the authoritative "who is delivering this now."
`rider_assignments` is history and is **never** read to answer that question. A
rider cancelling moves only the delivery; the order never moves (DEC-021).
No-rider is not an order state (DEC-022) — the order waits in `PREPARING` or
`READY_FOR_PICKUP` while dispatch keeps searching, and only an operator decision
ends it.

---

## 8. Payment / Ledger Architecture

### Server-side only, without exception

Payment creation, webhook ingest, state transitions, refunds, and **every**
ledger write. Every table in both domains is API-only in RLS: there is no client
policy to remove, so this is enforced by the database, not by discipline.

### Two-phase webhook (ADR-008)

**Phase 1 — ingest.** Verify signature → insert `payment_events` → commit →
return 200. Nothing else is touched. A crash after this point cannot erase the
evidence that the event arrived.

**Phase 2 — process.** Separately (tick-driven, over the `processed_at IS NULL`
partial index), in one transaction: advance `payments.state`, insert
`payment_transactions`, advance `orders.state` via guarded update, write the
ledger group, write `audit_logs`, enqueue `outbox`, set `processed_at`.

Duplicate delivery of the same `provider_event_id` violates the unique
constraint (23505); the handler catches it, reads back the stored outcome, and
returns 200 so the provider stops retrying. A **second successful transaction**
against an already-`SUCCESS` payment is a different thing entirely: it is real
money and is recorded in `payment_transactions`, becoming a refund obligation
(DEC-030) — never swallowed as a duplicate.

### Idempotency map

| Operation | Key | Mechanism |
|---|---|---|
| Create payment | `order_id` | `payments_order_id_key` |
| Regenerate QR | `(payment_id, attempt_no)` | unique constraint |
| Webhook | `(provider, provider_event_id)` | unique constraint |
| Money movement | `provider_transaction_id` | unique constraint |
| Ledger group | `group_key`, e.g. `payment:PAY-BH000125:txn:<providerTxnId>` | unique constraint |
| Refund | `refund_reference`, `(provider, provider_refund_id)` | unique + partial unique |
| Anything without a natural key | `Idempotency-Key` header | `idempotency_records` |

Natural keys first, records only where no natural key exists (ADR-004).

### Ledger service rules

Append-only, signed entries, `bigint` satang, no floats anywhere. A correction is
a reversing entry in a new group — never an edit. **The service asserts each
group sums to zero inside the transaction and aborts if it does not** (DEC-034 —
there is no trigger, deliberately). Scheduled reconciliation re-verifies groups
and opens a `reconciliation_cases` row on any mismatch. `LedgerService` is
callable only from other services, never from a controller.

### DEC-APP-007 — Build the whole flow on `NullPaymentProvider`; gate only real money

**Decision.** Phases E through I are built and shipped against the existing
`NullPaymentProvider`, including a local webhook simulator that produces
correctly-shaped signed events. Real-provider integration is a self-contained
Phase F′ that lands when Q-001 and Q-002 close.

**Reason.** Q-001 (provider), Q-002 (legal/settlement) and Q-020 (PromptPay
refund mechanism) are externally blocked, and Q-002 has counsel lead time.
DEC-016 removed COD, so 100% of revenue depends on that unselected provider —
which means treating "payment" as a blocking phase stalls order, dispatch,
delivery, notification and admin behind an external dependency. The
`PaymentProvider` interface already isolates this precisely: `createPayment`,
`refund`, `verifyWebhookSignature`, with an `idempotencyKey` on every operation.
Everything upstream and downstream of it can be finished and tested.

**Alternatives considered.** Wait for Q-001; pick a provider now to unblock.
**Why rejected.** Waiting idles the project on someone else's calendar. Picking
early is worse: `MARKETPLACE_PAYMENT_MODEL.md` and `COST_MODEL.md` show a real
tension (the best structural fit may be the most expensive per small order,
with a ฿10 minimum fee ≈ 11% of a ฿150 order), and the choice is gated on a
legal model that does not yet exist.

**Impact.** Adds a webhook simulator behind a dev-only flag, wired so it can
never exist in production (env-gated at module registration, plus a startup
assertion). Explicit non-goal: no PromptPay QR rendering until a provider issues
real payloads — the customer app's labelled placeholder stays.

---

## 9. Rider / Delivery Architecture

Constrained by the H-1 and M-1 fixes, which are load-bearing.

### How a rider receives work

Broadcast dispatch (DEC-020), with its parameters fixed by **DEC-037**:
candidates are `APPROVED` + online + a valid recorded location and hold no
active delivery, the offer window is **60 s**, and rounds re-broadcast every
**60 s** on the existing tick. ⚠️ **No proximity, radius or zone filter is
approved for Phase 1** — the PostGIS index stays available for a later decision,
but a distance threshold must not be invented (DEC-037, and DEC-E-04 for the
same reason on the customer side). `DispatchService` selects candidates from
`rider_availability` and inserts
`rider_assignment_attempts` rows (`round_no`, `expires_at`, `outcome =
PENDING`). The rider app reads its own pending offers via
`rider_assignment_attempts_select_own` — **this is the rider's only read path to
an offer before accepting**, because an unaccepted rider is not yet a party to
the order or the delivery.

### How a rider reads an assigned order — H-1

Riders have **no policy** on `orders`, `order_items`, or `order_item_options`;
those policies were dropped. The three column-scoped views are the only path:

- `security_invoker = false` → runs with the owning role, exempt from RLS, and
  the view's own `is_assigned_order_rider()` predicate does the row scoping.
- `security_barrier = true` → **required, not cosmetic.** Without it the planner
  may evaluate a rider-supplied predicate before the row check, turning query
  errors into an oracle for rows the rider may not see. This was proven, not
  theorised.
- The column list excludes every money column, `payment_method`, `customer_id`,
  `address_id`, `cause_code`, and all per-line prices.

**Application obligations.** Never add a rider policy to the base tables. Never
`select *` from a base order table in rider context. Any new rider-facing order
field is a **view change** (a migration, therefore out of scope here and
requiring Product Owner approval), never a widened grant. `@banhao/types` should
carry a distinct `RiderOrderView` type so a rider screen cannot be typed against
the full order — the type system enforcing the boundary the views enforce.

### How assignment happens — the race

Layer 1 (application): guarded conditional UPDATE with `state IN
('RIDER_SEARCHING','RIDER_REASSIGNING') AND rider_id IS NULL`. Rows affected 1 =
won, 0 = lost → `409 OFFER_TAKEN`, which the driver app must render as a normal,
expected outcome rather than an error.

Layer 2 (database): `rider_assignments_one_active` partial unique index. If the
guard were ever broken, a second ACCEPTED row is physically impossible.

Proven by two genuinely concurrent `psql` processes racing the same row — not a
single-session simulation.

### How reassignment happens — H-2

**`release_rider_assignment(p_delivery_id, p_status, p_reason)` is the only
sanctioned release path.** Both statements of the release invariant run inside
one function invocation: either both happen or neither is ever visible. Omitting
either statement makes a delivery **permanently unassignable** — this was the
2026-08-11 review's finding, and the function exists so no caller can reproduce
it.

Application rules: `p_status` is `RELEASED` (rider-initiated) or `CANCELLED`
(operator-forced); the decision of *when* to release, and which, is a NestJS
business decision the function deliberately does not make. Callable **only** by
`service_role`, so it is reachable only through the API — never from a client.
Its raises must be mapped to error codes, not leaked: `42501` → `500` (a
misconfiguration, never a user error), `P0001 not releasable` → `409`, `P0001
release invariant violated` → `500` **plus a `reconciliation_cases` row**,
because that raise means the invariant was already broken by something else.

### Concurrency, restated

No advisory locks. No SELECT-then-UPDATE. No queue. Postgres row locks under
READ COMMITTED plus guarded WHERE clauses, with unique indexes as the backstop.
The application's only job is to issue the right statement and read `rowCount`
honestly.

---

## 10. Error Handling

One shape, everywhere. The **canonical contract is the code**, not any message
string — clients own the user-facing sentence, in whatever language and wording
fits their audience:

```json
{
  "success": false,
  "error": {
    "code": "OFFER_TAKEN",
    "details": { "deliveryId": "..." },
    "correlationId": "9f3c…"
  }
}
```

`message` may optionally be present as a developer-facing default (English,
for logs and debugging) — it is never what a client renders to a user. A
client resolves `error.code` to its own copy: e.g. `OFFER_TAKEN` becomes one
Thai sentence in the customer app, a different Thai sentence in the merchant
app, and a different one again for the rider app, all from the same code. The
backend never decides presentation language or wording — see §20.

| Class | HTTP | Codes | Client behaviour |
|---|---|---|---|
| Authentication | 401 | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `PROFILE_NOT_FOUND` | Clear session, go to login |
| Authorization | 403 | `FORBIDDEN`, `NOT_RESTAURANT_MEMBER`, `NOT_ASSIGNED_RIDER` | Message; **do not** log out |
| Validation | 400 | `VALIDATION_FAILED` (+ zod field details) | Inline field errors |
| Business rule | 409 | `INVALID_TRANSITION`, `RESTAURANT_CLOSED`, `ITEM_UNAVAILABLE`, `ACCEPT_WINDOW_EXPIRED` | Explain and offer the next action |
| Concurrency | 409 | `OFFER_TAKEN`, `NOT_RELEASABLE` | Refresh and re-render — a normal outcome, not an error state |
| Payment | 402 / 409 | `PAYMENT_ALREADY_SUCCEEDED`, `PROVIDER_UNAVAILABLE`, `MECHANISM_UNAVAILABLE` | Retry or escalate; never assume success |
| Database | 500 | `INTERNAL_ERROR` | Generic message; full detail logged only |
| Network / offline | — | client-side | Retry with backoff; **never** retry a non-idempotent write without its key |
| Unexpected | 500 | `INTERNAL_ERROR` | Generic message + correlation id the user can quote |

Rules. The existing `HttpExceptionFilter` already logs unexpected errors in full
and returns a generic message — extend it rather than replacing it, and add
`correlationId`. **Never leak a Postgres message, constraint name, or SQLSTATE
to a client.** Domain services throw typed domain errors; a single mapping layer
turns them into HTTP — controllers do not build error responses. Thai messages
are user-facing copy and belong in the clients, keyed off `code`; the API's
`message` is a developer-facing default.

---

## 11. Observability

Minimum viable, and nearly free.

| Concern | Mechanism | Cost |
|---|---|---|
| Structured logging | JSON to stdout via Nest `Logger`, one line per request | $0 (platform logs) |
| Correlation | `X-Request-Id` in, or generated; propagated into `order_status_history.correlation_id`, `delivery_status_history.correlation_id`, `ledger_entry_groups.correlation_id` — **columns that already exist** | $0 |
| Financial trace | `payment_reference`, `provider_event_id`, `group_key` on every payment log line | $0 |
| Business audit | `audit_logs`, written in the operation's transaction | $0 |
| Error tracking | Sentry free tier | $0 (**$26/mo the moment a second developer joins** — likely BANHAO's first real bill) |
| Health | existing `GET /health`, extended with a database ping | $0 |
| Reconciliation alerting | `reconciliation_cases` open-count surfaced on the admin dashboard and in the scheduled tick's log line | $0 |

Deliberately **not** in V1: metrics/dashboards (Grafana, Prometheus), tracing
(OpenTelemetry), log aggregation. One developer with platform logs plus Sentry
plus `audit_logs` can answer every V1 question. A metrics stack is real
operational cost with no reader.

The three questions the design must answer cheaply, and does: *why did this
order fail?* → `order_status_history` + `cause_code`. *Where did this baht go?* →
`group_key` → `ledger_entries`. *Who changed this?* → `audit_logs` +
`actor_type`.

---

## 12. Cost / Infrastructure

**Architectural target: $0/month.** This is a design target and a free-tier
assumption, not a guarantee. Actual cost depends on traffic, provider pricing
changes, and free-tier limits, all of which are outside this architecture's
control. V1 is designed to operate within free tiers where realistically
possible — every component below is justified, with the point it stops being
free named, and pricing that could not be verified against an authoritative
current source is flagged `COST VERIFICATION REQUIRED` rather than stated as
fact.

### DEC-APP-008 — Reads client→Supabase; writes client→API→Supabase

**Decision.** Client applications read domain data **directly** from Supabase
(PostgREST + Realtime, anon key, under RLS). They write **exclusively** through
the NestJS API. Two exceptions where clients write directly: `carts`/`cart_items`
/`cart_item_options`, and `rider_availability` — both already granted write
policies by the deployed RLS, both non-financial.

**Reason.** This is simultaneously the cost decision and the correctness
decision. Cost: PostgREST and Realtime are already-running, always-warm, free
Supabase infrastructure — routing reads through our own container would multiply
compute for no benefit and put a cold start in front of a menu browse.
Correctness: ADR-001 says NestJS is the only trusted **writer**; ADR-002 says
there are no client **write** grants on domain tables. Direct reads violate
neither, and the deployed schema was explicitly designed for it — the
`*_select_active` public catalog policies, `orders_select_customer`, and the
three rider views exist precisely to be read by clients. Meanwhile every table
that must not be client-read (`payments`, `refunds`, `ledger_*`, `outbox`,
`jobs`, `audit_logs`, `merchant_bank_accounts`) has no client policy at all, so
the boundary is enforced by the database rather than by convention.

**Alternatives considered.** All traffic through the API; all traffic direct to
Supabase. **Why rejected.** API-for-everything means a cold start on every menu
tap, re-implements filtering PostgREST already does, discards the 55 RLS
policies as dead weight, and needs paid always-on compute to feel acceptable —
it is the single most expensive choice available. Direct-for-everything cannot
create an order, confirm a payment, or write a ledger entry without exposing
`service_role`, which is categorically forbidden.

**Impact.** `@banhao/api-client` covers commands; a thin typed Supabase read
layer covers queries. The customer app's existing repository seam is exactly the
right place for this — `repositories/index.ts` swaps mock implementations for
Supabase-backed ones with no screen changes.

### DEC-APP-009 — Google Cloud Run (Bangkok), request-based billing, min-instances 0

**Decision.** Deploy the existing `apps/api` Dockerfile to Cloud Run in
`asia-southeast3` (Bangkok), CPU allocated **only during requests**,
`min-instances=0`, `max-instances` capped low. `COST VERIFICATION REQUIRED` —
the specific free-tier thresholds and the Bangkok-vs-Singapore price gap cited
below should be re-verified against current GCP pricing before launch; they are
not re-confirmed as part of this review.

**Reason.** Cost: request-based billing means the free tier (2M requests/month,
240k vCPU-s, 450k GiB-s) covers Stage 1 with room to spare, and idle costs
nothing. Latency and residency: Bangkok is Tier 1 pricing — ~17% cheaper on CPU
than Singapore *and* physically closer to Buntharik, so cost and latency do not
trade off. It takes the Dockerfile that already exists. PDPA: in-country
residency with no cross-border transfer analysis needed.

Cold start is the honest cost of `min-instances=0`, and DEC-APP-008 is what
makes it acceptable — browsing, menus, order tracking and rider offers are all
reads that never touch the container. A cold start can only land on a command
(create order, accept, pay), roughly once or twice per order. The scheduled tick
(below) fires often enough that an instance is usually already warm during
trading hours.

**Alternatives considered.** VPS (DigitalOcean $4–6, Vultr $5); Render free;
Fly.io; Railway ($5); Supabase Edge Functions; AWS Lambda Thailand; EKS/GKE.
**Why rejected.** A VPS is the strongest runner-up — genuinely cheap, low
lock-in — but it is not $0, and it hands one developer OS patching, TLS renewal,
deploys and backups. Render free spins down after 15 minutes and takes ~1 minute
to restart, which is disqualifying for order-taking. Fly.io has no true free
tier and unverifiable Singapore pricing. Railway is $5 minimum. Edge Functions
would fork the domain layer into Deno (see DEC-APP-002). Lambda's cold-start fix
(provisioned concurrency) bills while idle, destroying the reason to choose
serverless. EKS is ~$73/month before a single pod runs.

**Becomes paid when:** sustained traffic exceeds the request/CPU free tier
(roughly, thousands of commands per day), or when cold starts become
unacceptable and `min-instances=1` is bought — call it $5–10/month, and Stage 2
in `COST_MODEL.md` is where that lands anyway.

### DEC-APP-010 — One scheduled tick from a Cloudflare Worker cron; no scheduler service

**Decision.** A Cloudflare Worker cron (free) POSTs `/internal/tick` every
minute with an HMAC-signed header. The handler drains `outbox`, runs due `jobs`,
expires QR attempts, processes unprocessed `payment_events`, and periodically
reconciles the ledger. It is the same deployable, a distinct entrypoint
(ADR-010).

**Reason.** The schema already has `outbox` and `jobs` with the exact partial
indexes a poller wants; all that is missing is something to call the poller.
Cloud Scheduler would also work but ties scheduling to GCP and its free tier is
narrow; a Worker cron is free, trivially observable, and provider-independent. A
one-minute tick also keeps a Cloud Run instance warm during trading hours as a
side effect, at ~43k requests/month — well inside the free tier. Ticks must be
idempotent and safely re-entrant: overlapping ticks are claimed with a guarded
`UPDATE ... WHERE claimed_at IS NULL`, the same primitive as everything else.

**Alternatives considered.** Supabase `pg_cron` calling a database function;
GitHub Actions cron; Cloud Scheduler; a long-running worker container. **Why
rejected.** `pg_cron` would put business logic in the database, contradicting
ADR-001 and the schema's own repeated insistence that logic lives in NestJS.
GitHub Actions cron is throttled and unreliable at minute granularity. A
long-running worker container is always-on compute — the one thing a $0 target
cannot afford.

**Becomes paid when:** never, realistically, at BANHAO's scale.

### The rest of the stack

| Component | Choice | Cost | Becomes paid when |
|---|---|---|---|
| Database, Auth, PostgREST, Realtime | Supabase Free (already live) | $0 | 500 MB DB / 2 GB egress / 50k MAU / 200 concurrent realtime → Pro $25 |
| Customer + driver apps | Expo, OTA updates | $0 | Apple $99/yr + Google $25 one-off — **unavoidable, and the only certain launch cost** |
| Merchant + admin web | Cloudflare Pages | $0 | effectively never |
| Order tracking updates | Supabase Realtime on `orders`/`deliveries` (RLS-respecting) | $0 | 200 concurrent connections |
| Push notifications | Expo Push + FCM | $0 | never |
| SMS OTP | ThaiBulkSMS ~฿0.15/credit | **~$2/mo** — the one line that is not free | immediately, at any real volume |
| Images | Supabase Storage free tier (1 GB); move to Cloudflare R2 at Stage 2 | $0 | 1 GB, then R2 (zero egress) |
| Maps | MapLibre GL + OSM tiles, as the existing Leaflet prototype does | $0 | tile-usage policy at volume; self-hosted OSRM is the Stage 3 answer (Thailand's OSM extract is only ~310 MB) |
| Error tracking | Sentry free | $0 | second developer → $26/mo |
| CI | GitHub Actions free tier | $0 | 2,000 min/mo on private repos |

**Total: $0/month plus ~$2 SMS, plus store fees at launch.** The honest headline
from `COST_MODEL.md` still holds and is worth repeating: infrastructure is
essentially free at Stage 1, and the money actually goes to payment processing
fees and legal review.

### Avoid: no Redis, no message broker, no Kubernetes, no separate worker service, no log aggregation, no CDN beyond Cloudflare's free tier, no second database. Every one of these is available for free somewhere and would still cost more than it returns — in operational surface, not dollars.

---

## 13. Security

| Boundary | Position |
|---|---|
| `service_role` key | `apps/api` only, injected at runtime, never in Git, never in any client bundle. Already correct in `SupabaseService`, with the reason written down. |
| Anon key | Ships in mobile bundles — safe **only because** RLS is the protection. Already correct. |
| JWT verification | `jose` + `SUPABASE_JWT_SECRET`, signature and expiry. Already correct. |
| Role/capability source | The database, never a client header or JWT claim. Correct in intent; **wrong in source** until DEC-APP-004 lands. |
| RLS | Final data-access boundary. 55 policies, zero `profiles.role` references. Verified by execution, not reasoning. |
| `release_rider_assignment` | `execute` revoked from public/anon/authenticated, granted to `service_role`. SECURITY INVOKER — and the header explains at length why DEFINER was a false-security bug. Do not "fix" it back. |
| Rider column exposure | The three `security_barrier` views. Do not widen; do not re-add base-table policies. |
| Webhook verification | Signature is the **only** path to `SUCCESS`/`REFUNDED` (CON-002). Raw body required. Unverified requests write nothing. |
| CORS | Explicit origin allow-list from `loadServerEnv().corsOrigins` (already implemented). Mobile apps send no Origin; web apps are enumerated. |
| Rate limiting | Cloudflare in front of the API for `/webhooks/*` and auth-adjacent routes, plus per-actor throttling on order creation. Free tier suffices. |
| Secrets in CI | `secrets-scan` job already fails the build on a tracked `.env`/key. Keep it. |
| Storage | If rider proof-of-delivery photos land in Supabase Storage, the bucket must be private with signed-URL reads — never public. Not yet built; flagged so it is not built wrong. |
| Audit | Privileged operations (refund, reassign, cancel, role assignment) write `audit_logs` with a mandatory reason (DEC-032). |

Findings, not fixed here: `RolesGuard` authorizes against a column no RLS policy
consults (DEC-APP-004); the webhook route needs raw-body handling and envelope
exclusion before any provider integration (DEC-APP-005); the dev-only webhook
simulator must be structurally impossible in production (DEC-APP-007).

---

## 14. Testing Strategy

Reuse the existing philosophy — the 104-test local Postgres suite and the
"proven by execution, not by reasoning" standard — and add only what is missing.

| Layer | Tool | Scope | Runs |
|---|---|---|---|
| Unit | Jest | Money arithmetic (satang, bps, residual allocation), state-transition tables, cause-code mapping, pricing, phone normalisation (exists) | LOCAL + CI |
| Domain / service | Jest + real Postgres in Docker | Order transitions, payment two-phase ingest, **ledger sums to zero**, idempotency replay, `release_rider_assignment` error mapping | LOCAL + CI |
| API contract | supertest | Auth guards, capability guards, error envelope shape, idempotency headers, webhook signature rejection | LOCAL + CI |
| RLS | existing `run-rls-tests.sh` | 55 policies against throwaway Postgres — **already in CI** | CI (every push) |
| Concurrency | existing `rider_race_*.sql` | Two genuinely concurrent clients racing one delivery | CI |
| Rider view isolation | existing `rider_view_row_isolation_security_test.sql` | The `security_barrier` oracle probe | CI |
| Integration | Jest + Supabase local | Full order → dispatch → delivery against `NullPaymentProvider` | CI + DEV |
| Manual scripted | Device checklist | Customer + driver on real iOS **and Android** (Android is currently UNVERIFIED) | Before each release |
| Web E2E | Playwright, thin | Merchant accept flow, admin refund flow | CI |

### DEC-APP-011 — No mobile E2E automation in V1

**Decision.** No Detox, no Maestro. Mobile verification is a written scripted
checklist run on real devices, plus the existing Jest component tests.

**Reason.** Mobile E2E is the most expensive test layer to build and the most
brittle to maintain, and one developer's time is BANHAO's actual scarce
resource. The existing suites already cover what is genuinely dangerous —
concurrency, RLS, column isolation, money — and those are the failures that
cost real baht. A flaky simulator test suite would consume more time than the
class of bug it catches.

**Alternatives considered.** Detox from Phase A; Maestro cloud. **Why
rejected.** Both are a multi-day build plus ongoing repair, funded from the same
hours needed to ship the merchant surface. Revisit when a second developer
joins — the same trigger that starts the Sentry bill.

**Impact.** Android must be added to the manual checklist immediately; it is
explicitly unverified today and is the platform most likely to differ on Thai
per-weight font families.

Environments: **LOCAL** everything; **CI** everything except device checks;
**DEV** (`banhao-dev`) integration + smoke after deploy; **LIVE** health check
and a read-only reconciliation assertion, never destructive tests.

---

## 15. Implementation Roadmap

Nine phases. Each names its dependencies, deliverables, tests, and the
condition under which it is done.

**Phase A — Foundation hardening.** *Depends: nothing.* Rewrite the stale
`docs/ARCHITECTURE.md` and `docs/CURRENT_STATUS.md`; error envelope +
`correlationId`; correlation-id middleware; webhook raw-body bootstrap and
interceptor exclusion (DEC-APP-005); `worker.ts` entrypoint; `/internal/tick`
with HMAC; Cloud Run + Cloudflare Pages deploy workflows; Sentry.

**Local validation gate, before any cloud deployment step:** documentation
rewrite → auth/capability architecture validated on paper → local build
passes → local test suite passes → `apps/api` starts in Docker locally → API
integration tests pass against that local container → **only then** deploy to
Cloud Run. Do not deploy an unverified foundation to discover basic issues in
the cloud. This is a sequencing gate, not new CI/CD infrastructure — the
existing `verify`/`docker` CI jobs already cover build, test, and image build.

*Tests:* contract tests for the envelope; local Docker boot + integration
pass; a deploy that answers `/health`.
*Done when:* the local gate above is green, the API is reachable at a URL, the
tick fires, and CI deploys on merge to `main`.

**Phase B — Identity & capability resolution.** *Depends: A.* DEC-APP-004 —
membership-based capability resolution across `restaurant_members`, `riders`,
`platform_staff`; scoped capability guard; `GET/PATCH /me`; addresses CRUD.
*Tests:* guard unit tests per actor type; RLS suite unchanged and still green.
*Done when:* a merchant user is authorized for their restaurants and no others,
and `profiles.role` is read by nothing.

**Phase C — Catalog & merchant read path.** *Depends: B.* Supabase-backed
`CatalogRepository` replacing the customer app's mocks behind the existing seam;
restaurant + hours + menu + options + availability; merchant menu writes; the
`(ตัวอย่าง)` mock labels come off.
*Tests:* repository integration tests; a closed restaurant is unorderable.
*Done when:* the customer app browses real data from `banhao-dev` and no screen
imports from `src/mocks/`.

**Phase D — Cart.** *Depends: C.* Client-side cart writes under RLS; server
`POST /cart/validate`; one-cart-one-restaurant (DEC-017) enforced by the
composite FK plus service validation.
*Tests:* price-change and item-unavailable revalidation; cross-restaurant
rejection.
*Done when:* a stale cart cannot become an order.

**Phase E — Order.** *Depends: D.* `POST /orders` with full snapshotting; the
nine ACCEPTED transitions plus `CANCELLED` (DEC-APP-006) as commands, never
`PATCH state`; `order_status_history`-derived timeline; Realtime subscription
replacing polling; `apps/customer/src/mocks/types.ts` reconciled to DEC-019.
*Tests:* every transition and every rejected transition; guarded-update
concurrency; `orders_total_check` arithmetic.
*Done when:* an order runs `CREATED → DELIVERED` end to end with a null provider.

**Phase F — Payment (null provider).** *Depends: E.* Payment + attempt creation;
two-phase webhook ingest; the dev-only signed-event simulator; QR expiry job;
ledger groups on payment and completion with the in-transaction zero-sum
assertion; reconciliation opening `reconciliation_cases`.
*Tests:* duplicate webhook → 200 + read-back; surplus transaction recorded not
swallowed; **ledger sums to zero for every scenario**; expiry then late payment
resolves to a specific attempt.
*Done when:* every payment path is exercised without a real provider and the
ledger balances in all of them.

**Phase G — Rider & delivery.** *Depends: E (not F).* Driver app screens
(availability, offers, accept, arrival, pickup, delivery, proof photo);
broadcast dispatch; guarded-UPDATE claim; `release_rider_assignment` wiring with
correct error mapping; rider reads exclusively through the three views and a
distinct `RiderOrderView` type; rider earnings from the ledger.
*Tests:* the existing race suite green against the real API; H-2 release
invariant; a rider cannot read a money column through any path.
*Done when:* two riders racing one offer produce exactly one assignment and a
clean 409 for the loser.

**Phase H — Notification.** *Depends: F, G.* Outbox dispatch via the tick;
channel adapters (Expo Push, SMS, LINE) behind one interface (ADR-011);
`notifications` + `notification_deliveries`; the 5-minute no-rider notice with
its 3-minute extension.
*Tests:* outbox at-least-once with idempotent delivery; adapter failure does not
roll back the business transaction.
*Done when:* every state change the design specifies reaches its recipient once.

**Phase I — Admin operations.** *Depends: F, G, H.* Order monitor, manual
dispatch, reassignment with mandatory reason, refund initiation, ledger view,
reconciliation queue, merchant/rider onboarding, audit log viewer.
*Tests:* Playwright on refund and reassign; every privileged action writes
`audit_logs`.
*Done when:* an operator can resolve a stuck order without a database client.

**Phase F′ — Real payment provider.** *Depends: Q-001, Q-002, Q-020 — external.*
One provider adapter behind the existing interface, real signature verification,
real QR payloads, the refund mechanism Q-020 settles, provider reconciliation
against `payment_transactions`.
*Done when:* a real ฿1 payment appears in the ledger and reconciles, and a real
refund completes.

**Sequencing note.** F′ can land at any point after F. Nothing else waits on
it. That is the whole point of DEC-APP-007.

---

## 16. Architecture Decisions

| id | Title |
|---|---|
| DEC-APP-001 | One monorepo, five shared packages, no second repository |
| DEC-APP-002 | Modular monolith, single deployable; ratify ADR-009 and ADR-010 |
| DEC-APP-003 | Merchant becomes a web app; driver stays native |
| DEC-APP-004 | Role resolution moves from `profiles.role` to domain membership |
| DEC-APP-005 | The webhook route bypasses the global response envelope |
| DEC-APP-006 | Implement the nine ACCEPTED order states plus `CANCELLED`; nothing else |
| DEC-APP-007 | Build the whole flow on `NullPaymentProvider`; gate only real money |
| DEC-APP-008 | Reads client→Supabase; writes client→API→Supabase |
| DEC-APP-009 | Cloud Run (Bangkok), request-based billing, min-instances 0 |
| DEC-APP-010 | One scheduled tick from a Cloudflare Worker cron; no scheduler service |
| DEC-APP-011 | No mobile E2E automation in V1 |
| DEC-APP-012 | Thai is the default language; copy is keyed, not stored |

Full text in the sections above — each decision sits with the analysis that
produced it rather than in a separate register.

Existing ADR-001 … ADR-012 are all **ratified unchanged** by this review. None
was contradicted; DEC-APP-002, 008, 009 and 010 are the deployment-shaped
consequences of ADR-001, ADR-002, ADR-005, ADR-006 and ADR-010.

---

## 17. Final Architecture Diagram

```
   Customer (Expo/RN)   Driver (Expo/RN)   Merchant (Next.js)   Admin (Next.js)
          │                    │                   │                   │
          │  reads (anon key, RLS)                 │                   │
          ├────────────┬───────┴──────────┬────────┘         (no direct reads —
          │            │                  │                   admin data is
          │            │                  │                   API-only tables)
          │            ▼                  │                          │
          │   ┌──────────────────────────────────────┐               │
          │   │ Supabase PostgREST  ·  Realtime      │               │
          │   │ catalog · orders · deliveries ·      │               │
          │   │ notifications · rider_*_view         │               │
          │   └──────────────────────────────────────┘               │
          │                                                          │
          │  writes — @banhao/api-client, Bearer JWT                 │
          └──────────────┬───────────────────────────────────────────┘
                         ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  NestJS API — modular monolith (Cloud Run, asia-southeast3)         │
   │  SupabaseAuthGuard → CapabilityGuard → ResponseInterceptor          │
   ├─────────────────────────────────────────────────────────────────────┤
   │ identity · merchants · catalog · cart · orders · payments · refunds │
   │ ledger · riders · delivery · dispatch · notifications · admin       │
   │ audit                                                              │
   │                                                                    │
   │  entrypoint 1: HTTP (main.ts)      entrypoint 2: worker.ts         │
   │  /api/v1/*                          /internal/tick — outbox,       │
   │  /webhooks/payments/:provider        jobs, QR expiry, payment       │
   │  (public, signature-verified,        event processing,              │
   │   raw body, no envelope)             reconciliation                 │
   └───────────────────────────┬─────────────────────────────────────────┘
                               │ service_role (bypasses RLS — backend only)
                               ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  Supabase · PostgreSQL 17 + PostGIS · ap-southeast-1                │
   │  40 tables · 62 FKs · 61 CHECKs · 110 indexes · 52 triggers         │
   │  55 RLS policies (zero profiles.role references)                    │
   │  Immutability triggers bind service_role too                        │
   │  release_rider_assignment() — service_role only, SECURITY INVOKER   │
   │  rider_*_view — security_barrier = true                             │
   │  ═══ DATABASE V1 — LOCKED ═══                                       │
   └─────────────────────────────────────────────────────────────────────┘

   Cloudflare Worker cron ──HMAC──► /internal/tick   (every 60s)
   Cloudflare Pages ────────────────► merchant + admin static/SSR
   Expo Push / FCM ◄──── outbox     SMS (ThaiBulkSMS) ◄──── outbox
   PaymentProvider adapter ◄──── payments/providers/ only (Null in V1)
```

---

## 18. Risks / Open Questions

| # | Risk | Severity | Position |
|---|---|---|---|
| 1 | **Q-001 payment provider unselected; Q-002 legal model unresolved with external lead time.** DEC-016 removed COD, so 100% of revenue depends on it | **P0** | DEC-APP-007 removes it from the critical path for eight domains. It cannot be removed from launch. |
| 2 | **Q-020 — no examined provider supports native PromptPay refunds.** Every cancellation policy depends on a mechanism research says may not exist | **P0** | Unresolvable at the application layer. `refund()` exists in the interface because the domain needs the concept; do not assume a provider call satisfies it. |
| 3 | Exception state **names** are PROPOSED, and the customer app encodes twelve superseded states | P1 | DEC-APP-006. Reconcile to the nine + `CANCELLED` in Phase C/E; add nothing speculative. |
| 4 | Cold start on a command path at `min-instances=0` | P2 | Accepted, mitigated by DEC-APP-008 and the 60s tick. If it hurts, `min-instances=1` costs ~$5–10/month. Do not re-architect for it. |
| 5 | `docs/ARCHITECTURE.md` describes an empty repository | P1 | Phase A, first task. Currently a trap for any agent that reads it. |
| 6 | `RolesGuard` authorizes against a column no RLS policy consults | P1 | DEC-APP-004, Phase B. Silent divergence between two authorization layers. |
| 7 | Android completely unverified | P1 | Phase A manual checklist. Thai per-weight font families are the likely failure. |
| 8 | Supabase Free tier limits (500 MB, 2 GB egress, 200 realtime connections) | P2 | Fine at Buntharik volume. Pro is $25 and Stage 2 expects it. |
| 9 | Six deferred tables (`settlements` et al.) mean settlement cannot be built | P2 | Correct and deliberate. Reconciliation via `reconciliation_cases` satisfies DEC-034 in V1. Settlement needs a new migration set and a Product Owner decision. |
| 10 | Sentry free tier is single-user | P3 | $26/month on the second developer. Budget it as the first real bill. |
| 11 | Maps provider unselected (Q-018); tracking map is a placeholder | P2 | MapLibre + OSM at Stage 1; self-hosted OSRM is the Stage 3 answer. Never poll aggressively — it is the most volatile cost line in the model. |
| 12 | Merchant on web loses push-style order alerting | P2 | Accepted under DEC-APP-003. Realtime + audible alert on an always-open counter tablet. Revisit if merchants report missed orders. |
| 13 | Open business numbers: commission rate, delivery/service fees, rider earnings, wasted-food cost | P0 (business) | The schema stores **amounts, never rates**, so these can be set without a migration. Do not invent a default anywhere in the application. |
| 14 | Thai full-text search has no segmenter in the deployed schema | P2 | `ILIKE` is correct at Buntharik catalog size (a few dozen restaurants). Do not add `tsvector` columns — that is a migration, and the database is locked. Revisit at Stage 2. |

---

## 19. Recommended Next Task

**Phase A — Foundation hardening.** Specifically, in this order:

1. Rewrite `docs/ARCHITECTURE.md` and `docs/CURRENT_STATUS.md` to describe
   `e471ec1d` as deployed. Nothing else should be built while the primary
   architecture document tells the next reader the repository is empty.
2. Deploy `apps/api` to Cloud Run and the two web apps to Cloudflare Pages, with
   a GitHub Actions workflow on merge to `main`. A URL that answers `/health`
   converts every later phase from "written" to "shipped."
3. Add `worker.ts` + `/internal/tick` + the Cloudflare Worker cron, and the
   webhook raw-body/envelope handling (DEC-APP-005) — both are cheap now and
   invasive later.

Then **Phase B**, because DEC-APP-004 blocks every merchant and rider endpoint.

Do not start Phase F′ (real provider) or any settlement work. Do not touch the
database.

---

## 20. Language & Localisation — Thai-first

### DEC-APP-012 — Thai is the default language; copy is keyed, not stored

**Decision.** Thai is the default and only language of BANHAO V1 across all four
clients. Every user-facing string lives in **client-side copy modules keyed by a
stable English identifier** — never in the database, never in an API response.
The API returns codes and data; clients turn codes into Thai. No i18n library is
installed for V1.

**Reason.** The application-layer consequence of a Thai-first product is not
translation — it is deciding *where a string lives*. Three parts of the deployed
architecture already answer that correctly and must not be undone:

- **REQ-002** states every client reads the same order state and only the wording
  differs, and that no screen computes its own status. So a state value is an
  English identifier (`READY_FOR_PICKUP`) and its Thai label is per-client copy —
  a customer sees อาหารพร้อมแล้ว, a merchant sees รอไรเดอร์, a rider sees
  รับได้เลย, from one stored value. A Thai label column in the database would
  break that by making one wording canonical for all three actors.
- **The error model (§10)** already separates `error.code` (developer-facing,
  English, stable) from `error.message` (a developer default). Thai user copy is
  keyed off `code` in the client. This is why the API must never be the source of
  a user-facing sentence.
- **`orders` snapshot columns** are already free-text Thai-capable:
  `delivery_address_snapshot`, `delivery_landmark`, `recipient_name_snapshot`.

**Alternatives considered.** Thai labels in database lookup tables; a translation
layer in the API; `i18next`/`react-intl` from Phase A. **Why rejected.** Database
labels require a migration for a copy change and violate REQ-002's per-actor
wording. An API translation layer puts UX copy behind a deploy of the wrong
service and would need a locale header that has exactly one value. An i18n
library for a single language is runtime cost, bundle weight and indirection with
no second locale to justify it — a `copy/th.ts` module per app keyed the same way
makes a second language a new file rather than a refactor, which is all
"support future localisation" actually requires.

**Impact.** Four `copy/th.ts` modules (one per app), each exporting keyed Thai
strings for states, error codes, empty states, validation and notifications.
`@banhao/types` owns the key unions so a missing Thai string is a typecheck
failure, not a blank screen. `@banhao/ui` keeps tokens and layout only — no
embedded copy.

### Thai conventions, and what each one costs at the application layer

| Concern | Position | Cost |
|---|---|---|
| **Phone** | Store E.164 (`+66…`) because Supabase Auth requires it; display `0XX-XXX-XXXX` because that is what Thai users read and dial. `apps/customer/src/lib/phone.ts` already normalises both directions and is tested — promote it to `@banhao/validation` so all four apps share one implementation | none |
| **Money** | `bigint` satang in code and database, `฿` and บาท at the display edge only. Never store a formatted string; never round in the middle of a calculation | none |
| **Time** | Store `timestamptz` in UTC always. Display 24-hour (`19:30`, never 7:30 PM). Order timelines use relative Thai (`5 นาทีที่แล้ว`) because that is how a waiting customer reads a timeline; full dates use พ.ศ. | none |
| **Address** | The schema's `delivery_address_snapshot` + `delivery_landmark` + lat/lng is already the right shape for Thai addressing. In Buntharik a จุดสังเกต is frequently more useful than a house number, so `delivery_landmark` is a first-class field in the address form — not an optional afterthought | none |
| **Search** | Thai has no word spaces, so `ILIKE` substring matching is both simpler *and* better-behaved than tokenised search at this catalogue size. Postgres full-text search would need a Thai segmenter and a `tsvector` column — **a migration, therefore out of scope** | none in V1 |
| **Sorting** | Thai collation for restaurant and menu lists. Verify against the deployed collation before assuming the default is acceptable | none |
| **Type** | IBM Plex Sans Thai, line-height 1.55–1.75 (already in the design system), minimum 12px and only for metadata | none |
| **Copy length** | Thai runs longer than English at the same information density and does not wrap on spaces. Buttons and status chips must be tested with the longest real Thai string, not a placeholder | none |

**Risk carried forward.** Android is unverified, and Thai per-weight font
families are the single most likely rendering failure — this raises the priority
of the Phase A Android check rather than adding new work.

---

## 21. Architecture Lock — V1.1

> **BANHAO Application Architecture V1.1 — APPROVED / READY FOR IMPLEMENTATION**,
> subject to `COST VERIFICATION REQUIRED` items in §12 being re-checked against
> current provider pricing before launch.

- **Database V1 remains locked.** `e471ec1d` remains the database checkpoint.
  No database redesign is part of this task; no table, view, RLS policy, RPC,
  or migration was created or modified.
- No new technology, service, or application-stack component was introduced.
  No new Architecture Decision was added — V1.1 only clarifies DEC-APP-005
  (error contract), DEC-APP-004 (authorization layers), DEC-APP-009 (cost
  verification caveat), and Phase A (local validation gate).
- Application implementation must follow this architecture. Any future
  architectural deviation requires a new Architecture Decision.

### What changed from V1 to V1.1

1. **Cost (§12, DEC-APP-009).** Distinguished architectural target, free-tier
   assumption, and billing risk; flagged unverified Bangkok pricing as `COST
   VERIFICATION REQUIRED` rather than asserted fact.
2. **Error contract (§6, §10).** Made `error.code` the sole canonical contract;
   removed Thai user-facing text as an API-level example. Clients resolve
   `code` to their own language and wording.
3. **Authorization (§5).** Expanded three layers to five (authentication,
   global role, domain membership, resource authorization, RLS) and listed the
   five required test cases as documentation, not implementation.
4. **Phase A (§15).** Added an explicit local validation gate — build, tests,
   local Docker boot, integration tests — before any Cloud Run deployment.
5. **Language policy (§20, `CLAUDE.md`).** Confirmed: technical documentation,
   code, identifiers, and API contracts are English; end-user UI is natural
   Thai when explicitly designed.

*Read-only review. No files in `kmandev/banhao-design` were created, modified,
or committed; no migration was written; nothing was pushed. `git status
--porcelain` in that repository remains empty at commit `e471ec1d`.*
