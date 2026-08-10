# Current Status

## Last Updated

2026-08-10

> **Historical note.** Until 2026-08-09 this file correctly read *"No application
> exists."* That is no longer true — the foundation is merged and the Customer
> App is implemented. The earlier state is preserved in
> [`PROJECT_HISTORY.md`](PROJECT_HISTORY.md) and in Git history; nothing has been
> erased, only superseded.

## Overall Status

**Application code exists and runs.** The foundation is merged to `main`; the
Customer App is implemented and its authentication is verified against a live
Supabase project. **No business logic exists** — no order creation, payment
integration, dispatch, or settlement. That is deliberate, not an omission.

Two branches are awaiting Product Owner review and are **not merged**:
`feature/customer-app` and `feature/supabase-customer-auth`.

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

Five defects were found during the 2026-08-10 QA pass and **all five are fixed**
on `feature/supabase-customer-auth` — see
[`CUSTOMER_APP_VISUAL_QA.md`](CUSTOMER_APP_VISUAL_QA.md) for DEF-01…DEF-05 and
the evidence for each.

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

## Current Blockers

Product-level, not technical. `docs/TODO.md` P0: payment provider (Q-001),
legal/settlement model (Q-002), platform fee (Q-010), PromptPay refund mechanism
(Q-020). The Thai legal/compliance review has external lead time and gates all
payment work.

## Immediate Next Step

Product Owner review of `feature/customer-app` and
`feature/supabase-customer-auth`. Then answer DQ-01…DQ-05 in
[`CUSTOMER_APP_IMPLEMENTATION_MAP.md`](CUSTOMER_APP_IMPLEMENTATION_MAP.md) and
verify the app on Android.
