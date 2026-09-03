# BANHAO Roadmap

**Last updated 2026-08-19.** This file previously described the project's
pre-implementation, design-only state (as of 2026-08-09) and predates
Application Architecture V1.1. It has been rewritten to reflect the actual
current repository state. Where this file and
[`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md) disagree, the
architecture document wins — this is a summary, not a second source of truth.
See [`CURRENT_STATUS.md`](CURRENT_STATUS.md) for the detailed, evidence-based
status this roadmap is derived from.

## Phase 1 — Food Delivery

Nine lettered phases (A–I) plus F′, per V1.1 §19, and **Phase J** added
2026-09-03 by **DEC-040** (AI Operations + Human Supervisor — authorized,
after Phase I, **not started**). Each depends on the one before it unless
noted.

> **Phase-status staleness:** the ✅/⏳ sections below were last reconciled
> 2026-08-19 and still show Phase E as next. They are not current — Phases E–H
> have since been substantially built and Phase G is the work in flight. Use
> `CLAUDE.md` §9 and `CURRENT_STATUS.md` for live phase status; this file's
> Phase J row and the blocked list below are current.

### ✅ COMPLETED

| Phase | What | Landed |
|---|---|---|
| Design | Design System v1.0, Customer App UI (18 screens → 31 states), Product/Payment Architecture docs, tracking-map prototype | Pre-2026-08-09 |
| Database | Supabase (PostgreSQL + PostGIS) selected (DEC-010); Database Design V1 approved; migration V1 merged and **LOCKED** at `e471ec1d` (16 migrations, 40 tables) | 2026-08-11 |
| **A — Foundation hardening** | Error envelope + `correlationId`, webhook raw-body handling, `apps/tick-worker` + `POST /internal/tick`, four deploy workflows (CI, API, web, worker) | before Phase B |
| **B — Identity & capability resolution** | Membership-based `RolesGuard`/`RestaurantScopeGuard` (DEC-033/DEC-APP-004), addresses API | `91f77489`, `9c250b77` |
| **C — Catalog & merchant read path** | Customer app reads shops/menu live from Supabase, replacing mocks; PC-Q-001 availability-visibility fix (additive migration `20260817000001`) | `8be44f05` |
| **D — Cart** | Persisted Supabase cart under RLS (DEC-D-02), one-cart-one-restaurant enforced structurally (DEC-017), `POST /cart/validate`, fail-closed checkout revalidation (DEC-D-01/03) | `b0b9ad88` |
| Infrastructure — R2 Storage foundation | `StorageService`, presigned uploads, `object-key.ts` (not phase-lettered — implemented ahead of V1.1's "Supabase Storage → R2 at Stage 2" plan; see `CURRENT_STATUS.md` §9 for the undocumented-decision gap this left) | `03dc5bd6` |
| Infrastructure — M-11 Restaurant Cover Upload | Presigned upload + complete flow, `@RestaurantScope()`-authorized | `ce5a5912` |
| Infrastructure — M-12 Menu Item Primary Image Upload | Same pattern, resource-level authorization (no `restaurantId` in the route) | `70fbc4f5` |
| Documentation sync | This file and `CURRENT_STATUS.md` brought current against actual repository state | 2026-08-19 |

### ⏳ NEXT

**Phase E — Order.** *Depends: D (done).*

- `POST /orders` with full price/item snapshotting from a validated cart
- The nine `ACCEPTED` order-lifecycle transitions plus `CANCELLED`
  (DEC-APP-006), each a guarded conditional `UPDATE` — never
  `SELECT`-then-`UPDATE`, never `PATCH state`
- `order_status_history` as the append-only audit trail (schema already
  exists, locked) — the customer timeline is derived from it, never stored
  separately
- Realtime subscription replacing polling
- `apps/customer/src/mocks/types.ts` reconciled to the nine-state machine,
  removing the superseded `NEW`/`ACCEPTED`/`READY`/`DRIVER_ASSIGNED`/
  `COMPLETED`/`NO_DRIVER` states
- **Explicitly out of scope for Phase E:** `PAYMENT_FAILED`,
  `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`, `DELIVERY_FAILED` — their policies
  are `OPEN` (BQ-013/BQ-015/BQ-016/BQ-017); a failed payment simply leaves the
  order in `PENDING_PAYMENT`, which DEC-019 permits
- *Done when:* an order runs `CREATED → DELIVERED` end to end against a null
  payment provider.

### 🔮 FUTURE

| Phase | Depends on | Scope |
|---|---|---|
| **F — Payment (null provider)** | E | Payment + attempt creation, two-phase webhook ingest, QR expiry job, ledger groups with in-transaction zero-sum assertion |
| **G — Rider & delivery** | E (not F) | Driver app screens, broadcast dispatch, guarded-claim, `release_rider_assignment` wiring, rider earnings from the ledger |
| **H — Notification** | F, G | Outbox dispatch via the tick, channel adapters (Expo Push, SMS, LINE) |
| **I — Admin operations** | — | Admin app, operator fallback tooling |
| **F′ — Real payment provider** | F | Externally blocked (§ Blocked below); may land any time after F |
| **J — AI Operations + Human Supervisor** | After I (orchestrates E, G, H) | **AUTHORIZED 2026-09-03 by DEC-040 · IMPLEMENTATION STARTED 2026-09-03.** `outbox event → normalize → deterministic router → policy evaluation → agent → command → guarded domain service → verify → audit → resolve/escalate`, plus a supervisor surface for escalations and L4 approvals. Authorization is of an architecture direction only: AI never holds domain, database or financial authority, adds no business state, invents no policy value (missing policy escalates), and audits as `actor_type = 'AI'`. Prerequisite AI-01 is merged (`95cc0dc4`) and **applied and verified live 2026-09-03**. Two playbooks are built (`apps/api/src/modules/ai-ops`): merchant acceptance timeout, which fails closed on BQ-013, and no-rider triage, which resolves DEC-022 and can only escalate. The supervisor console is **not built** and depends on Phase I. Read DEC-040 before any Phase J work |

### 🔴 BLOCKED / ⚠️ DECISION REQUIRED

- **F′ specifically** — gated on 4 of the 8 open P0 business questions:
  payment provider (Q-001), legal/settlement model (Q-002), PromptPay refund
  mechanism (Q-020), and the commission rate feeding into settlement
  (Q-010/BQ-028 numeric value). **Does not block E, F, G, H, or I** —
  DEC-APP-007 requires the whole order → delivery flow to be built against
  `NullPaymentProvider` first.
- **Settlement** (its own future scope, not a lettered phase) — needs 6
  deferred database tables (`settlements`, `settlement_items`,
  `delivery_fee_bands`, `zones`, `service_areas`, `delivery_attempts`) and a
  Product Owner decision to un-defer them. Not started, not scheduled.
- **8 P0 business questions remain overall** (down from the original 15) —
  see [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md). All are
  numbers, a provider choice, or a legal question — no open structural
  question remains. **Do not invent a default for any of them** anywhere in
  the application; the schema stores amounts, never rates, so these can be
  set later without a migration.
- **R2/M-11/M-12 architecture-decision gap** (see `CURRENT_STATUS.md` §9) —
  not a blocker to further work, but an unrecorded deviation from V1.1's
  stated storage-provider timeline that the Product Owner should either
  ratify with a decision entry or explicitly waive.
- **Android verification** — no SDK on this machine; the platform most
  likely to differ on per-weight Thai font families.
- **Deployment** — workflows exist and validate but have never executed
  against real infrastructure; see
  [`INFRASTRUCTURE-READINESS-V1.md`](INFRASTRUCTURE-READINESS-V1.md) for the
  pre-provisioning checklist.

## Phase 2 — Parcel Delivery

**TBD.** Referenced only at the concept level in
`docs/05-architecture/BANHAO Product Architecture.dc.html` § "06 — SCALING."
No dedicated design, timeline, or scope document exists. Not started.

## Phase 3 — Ride

**TBD.** Same concept-level reference only, in the same scaling table. No
dedicated design, timeline, or scope document exists. Not started.

## Phase 4 — Shopping

**TBD.** Named in `CLAUDE.md` as a later phase; no design or scope document
exists yet at any level.
