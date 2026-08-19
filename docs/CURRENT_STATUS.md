# Current Status

## Last Updated

2026-08-19 — after Phase D / Cart closure (`b0b9ad88`).

> **Historical note.** This file has been rewritten in full each time it fell
> too far behind the repository to patch incrementally — 2026-08-09 ("No
> application exists"), 2026-08-12 (Phase A / A-1), and now. Earlier states are
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
| Branch | `main`, 4 commits ahead of `origin/main` (not pushed) |
| Current commit | `b0b9ad88` — `feat(cart): complete phase d cart and checkout validation` |
| Database checkpoint | `e471ec1d` — schema **LOCKED**; one additive policy migration since (§9) |
| Application architecture | [`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md) — V1.1, **APPROVED / READY FOR IMPLEMENTATION** |

V1.1 is authoritative for application implementation: 12 `DEC-APP` decisions,
9 phases (A–I) plus F′. Where any other document conflicts with it, **V1.1
wins**. A `DEC-NNN` business decision outranks both.

## 3. Completed Phases — ✅ COMPLETE

| Phase | What | Evidence |
|---|---|---|
| **A** — Foundation hardening | Error envelope with `correlationId`, webhook raw-body handling, `apps/tick-worker` + `POST /internal/tick` (HMAC-guarded), four GitHub Actions workflows (`ci`, `deploy-api`, `deploy-web`, `deploy-worker`) | `apps/api/src/common/filters/http-exception.filter.ts`, `apps/api/src/modules/webhooks/`, `apps/tick-worker/src/index.ts`, `.github/workflows/` |
| **B** — Identity & capability resolution | Membership-based `RolesGuard`/`RestaurantScopeGuard` (DEC-033/DEC-APP-004, capability-based — no `profiles.role` reference remains), addresses API | `apps/api/src/common/guards/roles.guard.ts`, `apps/api/src/modules/users/` — commits `9c250b77`, `91f77489` |
| **C** — Catalog & merchant read path | Customer app reads shops/menu live from Supabase; `apps/customer/src/mocks/` no longer the catalog source | `apps/customer/src/data/catalogQueries.ts`, `apps/customer/src/domain/catalog.ts` — commit `8be44f05` |
| **D** — Cart | Persisted Supabase cart under RLS, `POST /api/v1/cart/validate`, fail-closed checkout revalidation | §8 below — commit `b0b9ad88` |

**Not yet started as lettered phases:** E (Order), F (Payment/null provider),
F′ (real provider), G (Rider & delivery), H (Notification), I (Admin
operations).

## 4. Infrastructure — Storage (R2) — ✅ COMPLETE, not phase-lettered

Cloudflare R2 object storage was implemented ahead of the phase sequence, as a
prerequisite for merchant catalog images rather than as one of the nine
lettered phases. **Terminology note:** the storage code's own doc comments
label this work "Phase D," which collides with the roadmap's actual Phase D
(Cart, §8). That label is a misnomer in the source comments, not a real phase;
this document does not use it. See §9 for the one open architecture-decision
gap this created.

| | Status |
|---|---|
| `StorageService` (S3-compatible client over R2, `apps/api/src/modules/storage/storage.service.ts`) | ✅ presigned `PUT`, `HeadObject`-based `exists()`, `getPublicUrl()`, safe-key assertion |
| Object-key shaping (`object-key.ts`) | ✅ server-templated keys only; MIME allow-list; UUID validation; structural parser for client-submitted keys |
| Environment configuration | ✅ `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` — `StorageConfigError` fails loudly if any is missing |
| Tests | ✅ `storage.service.spec.ts`, `object-key.spec.ts` |

## 5. Merchant Image Upload — ✅ COMPLETE

| | M-11 Restaurant Cover | M-12 Menu Item Primary Image |
|---|---|---|
| `upload-url` endpoint | ✅ `POST /api/v1/merchant/restaurants/:restaurantId/cover/upload-url` | ✅ `POST /api/v1/merchant/menu-items/:menuItemId/image/upload-url` |
| `complete` endpoint | ✅ | ✅ |
| Authorization | ✅ `@Roles('MERCHANT')` + `@RestaurantScope()` (route carries `restaurantId`) | ✅ `@Roles('MERCHANT')` + manual `hasMerchantAccess` check (route has no `restaurantId`; resolved from `menu_items.restaurant_id`) |
| Object-key validation | ✅ deterministic `restaurants/{id}/cover.{ext}`, recompute-and-compare | ✅ `menu-items/{id}/{uuid}.{ext}`, structural parse + `StorageService.exists()` (recompute-and-compare not possible — key contains a random UUID) |
| DB `image_url` update | ✅ `restaurants.image_url` | ✅ `menu_items.image_url` |
| Idempotency | ✅ same key re-completed → same UPDATE, no error | ✅ same, documented shared "orphan on format change" behavior |
| Tests | ✅ `restaurant-cover.controller.spec.ts`, `restaurant-cover.service.spec.ts` | ✅ `menu-item-image.controller.spec.ts`, `menu-item-image.service.spec.ts` |

## 6. Authentication — ✅ COMPLETE (dev-verified)

- **ES256 / JWKS** (`apps/api/src/supabase/supabase.service.ts`): tokens
  verified via `jose`'s `createRemoteJWKSet` against the project's published
  JWKS, algorithm pinned to `['ES256']` only (no HS256 fallback — the
  algorithm-confusion defence), issuer and audience checked against
  server-side configuration only, never client input. `verifyAccessToken`
  returns `null` on any failure with no detail leaked to the caller.
- Phone OTP authentication against the live `banhao-dev` Supabase project —
  request, verify, resend, session persistence, logout — verified end to end
  in EVENT-011 (2026-08-10) and unchanged since.
- **⚠️ One pre-existing flaky test discovered during this audit** — see §14.

## 7. Customer App State — Frontend: ✅ COMPLETE (31/31 states); backing data: mixed

- 31/31 design states implemented and screenshot-verified on iPhone 16 Pro
  (2026-08-10, unchanged since).
- Catalog (shops, menu, options): **live**, Supabase-backed (Phase C).
- Cart: **live**, Supabase-backed under RLS (Phase D, §8).
- Cart validation: **live**, calls `POST /api/v1/cart/validate` (Phase D).
- Orders, notifications, addresses screens: still **mock-backed** — Phase E
  is what replaces the order path; an addresses API exists from Phase B but
  wiring the customer screens to it was not in Phase C or D's scope.
- Android: **UNVERIFIED** (no SDK on this machine).

## 8. Cart / Phase D — ✅ COMPLETE

- **Persistence.** `carts` / `cart_items` / `cart_item_options` are the
  source of truth (DEC-D-02); the client holds a cached copy only.
  `apps/customer/src/repositories/supabaseCart.ts` writes directly to
  Supabase under RLS — cart CRUD is one of DEC-APP-008's two documented
  client-write exceptions.
- **Ownership / RLS.** Every cart policy keys on `auth.uid()`
  (`carts_select_own`/`insert_own`/`update_own`/`delete_own` and the joined
  equivalents on `cart_items`/`cart_item_options`); no client-supplied cart
  id appears anywhere in a read or write path.
- **One-cart-one-restaurant (DEC-017).** Enforced structurally by
  `carts_user_id_key UNIQUE(user_id)` plus the composite foreign keys
  `cart_items(cart_id, restaurant_id)` → `carts(id, restaurant_id)` and
  `cart_items(menu_item_id, restaurant_id)` → `menu_items(id, restaurant_id)`
  — a cross-restaurant line cannot be stored, not merely rejected in code.
- **`POST /api/v1/cart/validate`** (`apps/api/src/modules/cart/`): JWT-derived
  identity only, zero writes, checks restaurant `ACTIVE` status, menu item
  `archived_at`/`is_available`, both upward and downward price drift, returns
  `PRICE_CHANGED` / `ITEM_UNAVAILABLE` / `MIXED_RESTAURANT` as named 409s.
- **Checkout revalidation.** Runs on "place order" press, not on mount; fails
  closed (navigation only follows a successful validation); conflicts render
  the UX-SPEC diffs; acknowledging a price change re-runs validation rather
  than bypassing it.
- **No invented money (DEC-D-01).** The cart computes a subtotal only —
  delivery fee, service fee and discount stay `OPEN` numbers and are not
  guessed anywhere in this path.
- Tests: cart-specific 7 suites / 104 tests (customer 5/76, API 2/28); see §10
  for full-suite figures.

## 9. Known Documentation / Decision Gap — ⚠️ DECISION REQUIRED

The R2 storage foundation (§4) and M-11/M-12 (§5) were implemented ahead of
V1.1's own stated plan — the architecture doc's cost table (§17) says images
start on "Supabase Storage free tier... move to Cloudflare R2 at Stage 2," not
immediately. No `DEC-APP` or `DEC-D` entry in `docs/DECISIONS.md` records this
as a deliberate deviation, even though CLAUDE.md's own working rule is
explicit: *"Any deviation from V1.1 requires a new Architecture Decision, not
an improvisation."* The implementation itself is sound (§4–§5); what is
missing is the paper trail. **Not fixed by this documentation pass** — flagged
for the Product Owner to either backfill a decision record or confirm the
deviation was intentional and low-risk enough not to need one.

## 10. Test / Quality Status

As last run in full during this Phase D closure audit (2026-08-19, non-cached):

| Check | Result |
|---|---|
| `pnpm lint` | ✅ PASS — 11/11 packages |
| `pnpm typecheck` | ✅ PASS — 16/16 tasks |
| `pnpm build` | ✅ PASS — 11/11 packages |
| `pnpm test` (API) | ✅ 480/480 passed, 29 suites |
| `pnpm test` (Customer) | ✅ 260/260 passed, 16 suites |
| `pnpm test` (`packages/validation`) | ✅ 29/29 passed, 4 suites |
| `git diff --check` | ✅ PASS |

"Passing tests" here means **passing against fixtures and, for RLS, a
Docker-based Postgres shim** — not the same claim as "verified against live
production infrastructure." The Phone OTP / `profiles` RLS path (§6) is the
one piece independently verified against the live `banhao-dev` project by
execution; R2/M-11/M-12 and cart RLS are unit/integration-tested but not
separately re-verified against the live project by this audit.

## 11. Deployment Status

**Not deployed.** Workflows exist and validate (`ci.yml`, `deploy-api.yml`,
`deploy-web.yml`, `deploy-worker.yml`) but have never executed against real
infrastructure. See [`INFRASTRUCTURE-READINESS-V1.md`](INFRASTRUCTURE-READINESS-V1.md)
for the pre-provisioning checklist (written 2026-08-16, still nothing
executed). Approved targets (V1.1 §12): Cloud Run `asia-southeast3`
(Bangkok), Cloudflare Pages, Cloudflare Worker cron for the tick.

## 12. Database Status

**Live and LOCKED at checkpoint `e471ec1d`** (16 migrations), **plus one
additive policy-only migration since** —
`20260817000001_catalog_availability_visibility.sql` (Product Owner decision,
PC-Q-001 Option A: unavailable menu items/options stay visible to customers
so the app can render `วันนี้หมด`, per UX-SPEC § 5.3). It replaces two RLS
policies without editing the locked migration that created them, changes no
grant, table, column or index, and reproduces every other security predicate
verbatim. **17 migration files on disk as of this audit** — `docs/CURRENT_STATUS.md`
previously said 16; that count is now stale and corrected here.

Six tables remain deferred (`settlements`, `settlement_items`,
`delivery_fee_bands`, `zones`, `service_areas`, `delivery_attempts`), each
justified in `docs/DATABASE_DESIGN.md`, none removed from the design.
Settlement is not buildable in V1.

**Do not run `supabase db push` or `supabase link`, and do not add a
migration, table, view, policy or RPC, without an explicit instruction.**

## 13. Known Remaining Work

- **Order (Phase E)** — not started. Schema already supports it: `orders`,
  `order_items`, `order_item_options`, `order_status_history` all exist in
  the locked schema. Architecture (V1.1 §19) specifies `POST /orders` with
  full snapshotting, the nine `ACCEPTED` transitions plus `CANCELLED`
  (DEC-APP-006) as commands — never `PATCH state` — done when an order runs
  `CREATED → DELIVERED` end to end against a null payment provider.
- **`apps/customer/src/mocks/types.ts` still encodes the superseded 12-state
  order machine** (`NEW`, `ACCEPTED`, `READY`, `DRIVER_ASSIGNED`,
  `COMPLETED`, `NO_DRIVER`) alongside the new nine-state constant. V1.1 §19
  assigns reconciling this to Phase E, not before.
- **CheckoutScreen (screen 10) still offers a cash payment option** — DEC-016
  disables Cash on Delivery for Phase 1. This is explicitly Phase E/F scope
  per the prior audit, not a Phase D regression; still present, still
  correctly deferred.
- Merchant, Driver and Admin apps remain shells (Phases G/I and DEC-APP-003
  respectively).
- Android verification, a physical iOS device, real SMS delivery, and the
  search results list remain **UNVERIFIED** (unchanged from prior status).

## 14. Newly Discovered — Not Fixed By This Pass

- **Flaky test**: `apps/api/src/supabase/supabase.service.spec.ts`, the case
  `"rejects a token whose signature has been tampered with"`, fails
  intermittently (observed ~40–60% failure rate across 5 reruns). Root cause:
  the test corrupts the signature by flipping one base64url character in the
  final position, which occasionally lands on a "don't-care" bit that decodes
  to the same underlying signature bytes — the tamper sometimes doesn't
  change what actually gets verified. This is a **test-construction issue**,
  not a defect in `SupabaseService.verifyAccessToken` (which does correct
  byte-level ES256 verification) and not caused by Phase D or storage work —
  it pre-dates this audit and was not previously caught because the passing
  outcome is also common. Reported here per instruction; not modified.

## 15. Current Blockers

Product-level, not technical — unchanged from the prior status. **8 P0
business decisions remain**: payment provider (Q-001), legal/settlement model
(Q-002), commission rate (Q-010/BQ-028), PromptPay refund mechanism (Q-020),
cost of wasted food (BQ-015), delivery and service fee numbers (BQ-026,
BQ-027), promotion funding (BQ-030). See
[`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md).

**None of these block Phase E.** DEC-APP-007 is explicit: build the whole
order → delivery flow against `NullPaymentProvider`; gate only real money on
F′. Do not invent a default for any of the above anywhere in the application.

## 16. Immediate Next Milestone

**Phase E — Order**, per V1.1 §19: `POST /orders` with full snapshotting from
a validated cart, the nine `ACCEPTED` transitions plus `CANCELLED` as guarded
conditional `UPDATE`s (never `SELECT`-then-`UPDATE`), `order_status_history`
as the append-only audit trail the customer timeline derives from,
`apps/customer/src/mocks/types.ts` reconciled to the nine-state machine. Done
when an order runs `CREATED → DELIVERED` end to end with a null payment
provider.

Exception-path states (`PAYMENT_FAILED`, `PAYMENT_EXPIRED`,
`MERCHANT_REJECTED`, `DELIVERY_FAILED`) stay unimplemented until their
policies are approved (BQ-013/015/016/017 are `OPEN`) — see `docs/DECISIONS.md`
on this exact point.

Do not start Phase F′ or any settlement work. Do not touch the database
beyond an explicitly-instructed, additive, PC-Q-001-style migration.
