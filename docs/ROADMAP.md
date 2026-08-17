# BANHAO Roadmap

## Phase 1 — Food Delivery

### Completed

- Design System v1.0, Phase 1 scope (`design/design-system/`)
- Customer App UI design, 18 screens, full Phase 1 flow (`design/customer/`)
- Product Architecture documentation: strategy, sitemap, order state machine, user flow, wireframes, scaling model (`docs/05-architecture/`)
- Payment Architecture documentation: architecture, state machine, flows, ledger, driver cash handling, edge cases (`docs/04-payment/`)
- Tracking-map prototype with mock coordinates (`design/tracking/`)
- Repository documentation/process scaffold: `docs/`, `specs/`, `assets/`, `archive/`, root `README.md` / `AGENTS.md` / `CONTRIBUTING.md` / `CHANGELOG.md`
- AI project-memory system (`docs/AI_CONTEXT.md` and siblings, `ai/`)

### In Progress

Nothing at the design or code level. (Documentation work is the only active track as of 2026-08-09.)

### Remaining

- Driver App UI design past wireframe stage (currently 4 sketch screens only)
- Merchant Web UI design past wireframe stage (currently 1 sketch screen only)
- Admin Web UI design past wireframe stage (currently 3 sketch screens only)
- Backend technology stack decision (language, framework, hosting) — **TBD**
- Database technology decision and schema design — **RESOLVED.** Supabase (PostgreSQL + PostGIS) selected (DEC-010). Database Design V1 approved and implemented; migration V1 merged into `main` at `e471ec1d` (2026-08-11); schema is **LOCKED** at that checkpoint. Independently verified read-only against the live `banhao-dev` project: **16/16 migrations applied, 0 pending, 0 drift** (see `docs/CURRENT_STATUS.md`'s provenance note). Database design and schema approval are no longer remaining work — what remains here is application/product implementation on top of the locked schema (e.g. the DEC-033 `RolesGuard` task in `docs/TODO.md`), not further database design or approval.
- Payment provider selection and legal/compliance review (provider terms, marketplace settlement model, KYC/KYB, refund policy, payout cycles, Thai payment regulation, tax/accounting, PDPA, bank account verification — all explicitly flagged as required in `docs/04-payment`'s own closing note) — **TBD**
- API design (`docs/06-api/`) — not started
- Functional specs for every surface (`specs/`) — not started
- Application implementation for all four surfaces — not started
- Testing strategy — not started
- Deployment/hosting setup — not started

## Phase 2 — Parcel Delivery

**TBD.** Referenced only at the concept level in `docs/05-architecture/BANHAO Product Architecture.dc.html` section "06 — SCALING" (entity table: Merchant → drop-off point, Product → parcel + size, Order → delivery job). No dedicated design, timeline, or scope document exists.

## Phase 3 — Ride

**TBD.** Referenced only at the concept level in the same scaling table (Product → vehicle type, Driver → chauffeur; no Merchant equivalent). No dedicated design, timeline, or scope document exists.

## Phase 4 — Shopping

**TBD.** Referenced only at the concept level in the same scaling table (Merchant → shop/market, Product → item + stock). No dedicated design, timeline, or scope document exists.

## Future Expansion

The scaling model's stated goal (`docs/05-architecture`, section "06 — SCALING") is that each new phase should require adding only three things — a home-screen service icon, a service-specific detail screen, and a pricing formula — while Cart, Checkout, Tracking, Rating, Order History, and the Driver App carry over unchanged, because every surface is meant to read from one shared Order state machine. No timeline for Phases 2–4 exists anywhere in the repository.
