# TODO

Every item cites where it comes from in the repository. Items with no in-repo source are marked as such rather than invented.

> **Business decisions live elsewhere.** Since EVENT-013 (2026-08-10) the product
> decisions that block Order, Payment and Settlement are tracked in
> [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md) (`BQ-001…BQ-039`)
> and [`../ai/KNOWLEDGE/QUESTIONS.md`](../ai/KNOWLEDGE/QUESTIONS.md)
> (`Q-001…Q-020`). This file keeps engineering and documentation tasks. Do not
> duplicate a question into both places.

## P0 — Critical

- [ ] Answer the remaining **7** P0 business questions in [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md)
  - Priority: P0
  - Source: EVENT-013, narrowed by EVENT-014
  - Notes: Q-001 (provider), Q-002 (legal), Q-010/BQ-028 (commission **rate**), Q-020 (PromptPay refund mechanism), BQ-015 (who bears the cost of wasted food), BQ-027 (**refundability only** — Phase F), BQ-030 (promotion funding). **The fee numbers are now answered**: DEC-035 sets a flat ฿10 (1000 satang) delivery fee and DEC-036 a fixed ฿5 (500 satang) service fee, both approved 2026-08-24 — so BQ-026 is closed and BQ-027 retains only its refundability half. **Every structural question is answered** by DEC-016…DEC-032; what remains is the provider, legal, the commission rate and two funding questions. BQ-023, BQ-033 and Q-004 are **deferred with COD** (DEC-016), not answered.

- [ ] Decide payment provider(s) and the marketplace/settlement model for Phase 1 PromptPay QR payments
  - Priority: P0
  - Source: `docs/04-payment/BANHAO Payment Architecture.dc.html`, closing note of section "06 — EDGE CASES"
  - Notes: The document explicitly states it is not yet bound to any provider and flags this as required before production. Blocks all payment implementation. Tracked as Q-001 / Q-002.

- [x] ~~Decide backend technology stack (language, framework, hosting)~~
  - **RESOLVED 2026-08-09 by DEC-011** — NestJS + TypeScript, REST with OpenAPI (Q-006). Hosting remains open as Q-009 (P1). *Entry was stale until EVENT-013 reconciled it.*

- [x] ~~Decide database technology and design the schema~~
  - **RESOLVED 2026-08-09 by DEC-010** — Supabase (PostgreSQL + PostGIS), Q-007. Three migrations are applied live. The **domain schema** is still unwritten and is deliberately blocked on the P0 business questions above; the proposed model is `docs/DOMAIN_MODEL.md`, status `PROPOSED`. *Entry was stale until EVENT-013 reconciled it.*

## P1 — High

- [ ] Retire `profiles.role` in favour of domain membership (DEC-033)
  - Priority: P1
  - Source: DEC-033, EVENT-017
  - Notes: `profiles.role` is deprecated and non-authoritative, but three live objects still read it — `RolesGuard` (`apps/api/src/common/guards/roles.guard.ts`), `set_user_role()`, and the `role` clause of `enforce_profile_immutable_columns()`. **`platform_staff`, `restaurant_members` and `riders` now exist** — schema merged to `main` at `e471ec1`, and independently verified read-only against the live `banhao-dev` project: **16/16 migrations applied, 0 pending, 0 drift** (see `docs/CURRENT_STATUS.md`'s provenance note). The schema half of this task is done and confirmed live. **This does not close this TODO** — the application side is unfinished. Remaining sequence: backfill `platform_staff` from `profiles.role` where `ADMIN` → change `RolesGuard` to resolve capability from `restaurant_members` / `riders` / `platform_staff` → drop the column, its trigger clause and `set_user_role()`. **The `RolesGuard` code change is now DONE** (verified 2026-09-01): `apps/api/src/common/guards/roles.guard.ts` resolves capability purely from `request.user.capabilities`, which `CapabilitiesService` reads from `restaurant_members` / `riders` / `platform_staff` on every request — zero `profiles.role` references remain in any guard or policy. What is left is **data and schema**, not application code: backfill `platform_staff` from `profiles.role = 'ADMIN'`, then drop the column, its clause in `enforce_profile_immutable_columns()`, and `set_user_role()`. `profiles.role` is still *read* in two non-authorization places — `UsersService` and the `/api/v1/me` response — which the column drop will also have to address. The schema is LOCKED at `e471ec1d` — the column drop is itself a schema modification and requires a new, explicitly approved migration; it is not authorized by this TODO entry alone.

- [ ] Reconcile the Customer App with DEC-016 and DEC-019
  - Priority: P1
  - Source: EVENT-014
  - Notes: two divergences the decision lock created. **(b) is now done** — the checkout cash option, its CTA variant, the order-less `OrderConfirmed` branch and the `เปลี่ยนเป็นเงินสด` payment-failure fallback are removed; checkout is online-only per DEC-016, while CASH stays in the database, in `create_order()` and in historical order rendering as DEC-016 separately requires. The cash-prepared-amount selector no longer existed. **(a) is now done too** (2026-09-01): the superseded 12-state `OrderState`, together with `PaymentState`, `PaymentMethod`, the `OrderSummary` interface and the `orders` fixture, are **deleted** from `apps/customer/src/mocks/`. They had no reader left — `apps/customer/src/domain/order.ts` is the production contract and its `OrderState` is exactly the CHECK constraint on `orders.state`. Deleting rather than migrating means the exception **state names** never had to be settled for this: `domain/order.ts` already carries the five the schema defines, and `docs/ORDER_LIFECYCLE.md` §3 still marks them `PROPOSED` for *product* purposes, which is a separate question from what the column accepts.

- [ ] Design the full Driver App UI (currently 4 wireframe-level screens only: D-03, D-05, D-07, D-13)
  - Priority: P1
  - Source: `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "05 — WIREFRAMES"
  - Notes: Platform intention documented as Flutter mobile; not confirmed as final (see DEC-006 in `DECISIONS.md`).

- [ ] Design the remaining Merchant Web UI screens — **no longer blocks launch-critical work**
  - Priority: P2 (was P1)
  - Source: `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "05 — WIREFRAMES"; screen inventory in `docs/design/BANHAO-UX-SPEC-V1.md` §6
  - Notes: Updated 2026-09-01 (EVENT-029). **The merchant `MUST` scope is complete.** M-01, M-03, M-04, M-05, M-07, M-08, **M-11 and M-12** are all designed AND built (see `CLAUDE.md` §11), each with a committed `docs/design/BANHAO M-NN ….dc.html` artifact first — the established convention held throughout. **Updated 2026-09-04: M-10 restaurant profile (`20044391`) and M-AV availability (`7ea20a65`, DEC-041 — the work formerly labelled M-13) are now designed and built too.** Still undesigned and unbuilt: M-06 reject dialog and M-09 history (`SHOULD`), and UX-SPEC M-13 earnings / M-14 settings (`LATER`) — M-13 earnings is additionally money-blocked (BQ-029, Q-032). Dropped from P1 because none of those is launch-critical. Do not design them inside an implementation task.

- [ ] Design the full Admin Web UI (currently 3 wireframe-level screens only: A-02, A-03, A-12) — **now the top design blocker**
  - Priority: P1
  - Source: same section
  - Notes: Updated 2026-09-01. **This blocks the whole of Phase I.** `apps/admin`
    is still the default Next.js scaffold, and A-01, A-04, A-05/A-06, A-08/A-09
    and A-13 are all `MUST`. `docs/design/BANHAO-UX-SPEC-V1.md` §8 specifies
    admin *behaviour* — nine sections, the four A-04 regions, the A-13 queue's
    four sources, mandatory reasons on every intervention — but specifies no
    screens, and every merchant screen built so far had a committed
    `.dc.html` artifact first. Do not design these inside an implementation
    task.

- [ ] Legal/compliance review: payment provider terms, marketplace receiving model, KYC/KYB, refund policy, payout cycles, Thai payment regulation, tax/accounting, PDPA, bank account verification
  - Priority: P1
  - Source: `docs/04-payment/BANHAO Payment Architecture.dc.html`, closing note of section "06 — EDGE CASES"
  - Notes: Explicitly flagged in-source as required before going live.

## P2 — Medium

- [ ] Sentry — the one Phase A deliverable that does not exist
  - Priority: P2
  - Source: `docs/BANHAO-APP-ARCHITECTURE-V1.md` §11 and §15 (Phase A)
  - Notes: Added 2026-09-01. Structured JSON logging, the per-request log line,
    correlation and the `/health` database ping are all now implemented
    (`docs/CURRENT_STATUS.md` §7); error tracking is not. **Blocked on an
    external account and a DSN**, which is a credential-provisioning decision,
    not an implementation one. V1.1 §18 risk 10 already budgets it: free tier is
    single-user, $26/month on the second developer.

- [x] ~~Write API contract documentation~~
  - **RESOLVED 2026-09-01.** `docs/06-api/README.md` now documents the response
    envelope, the `ErrorCode`-to-status catalogue, the three-guard authorization
    order, the operation surface by actor, and the two internal endpoints
    deliberately excluded. `docs/06-api/openapi.json` is generated from the real
    `AppModule` (`pnpm --filter @banhao/api openapi`) and guarded against drift
    by `apps/api/test/openapi.contract.spec.ts`. **One known limitation remains
    and is recorded in both files:** `components.schemas` is empty, because
    controllers annotate operations but not payload shapes. Filling it in is
    additive work, not a redesign.

- [ ] Write functional specs for each surface
  - Priority: P2
  - Source: `specs/customer/`, `specs/driver/`, `specs/merchant/`, `specs/admin/`, `specs/payment/` (all empty placeholders created 2026-08-09)
  - Notes: —

- [ ] Replace mock coordinates in the tracking prototype with a real geocoding/location source before any real use
  - Priority: P2
  - Source: inline comment `// ตัวอย่าง: อ.บุณฑริก จ.อุบลราชธานี (พิกัดโดยประมาณ, ข้อมูลจำลอง)` in `design/tracking/tracking-map.html`
  - Notes: The file itself labels its data as simulated.

## P3 — Low

- [ ] Determine the purpose/owner of `design/.thumbnail`
  - Priority: P3
  - Source: file present at `design/.thumbnail`, unreferenced by any other file in the repo
  - Notes: Left in place during the 2026-08-09 reorg rather than guessed at.

- [ ] Decide whether to keep 4 duplicate copies of `support.js` or consolidate to one shared copy with updated relative paths
  - Priority: P3
  - Source: `CHANGELOG.md`, 2026-08-09 entry
  - Notes: Documented trade-off, not urgent; see Technical Debt below.

## Follow-through, no new decision needed

- [ ] Apply `20260904000001` (M-AV availability) and `20260904000002` (AC-04 customer-quoted prep estimate) to `banhao-dev`, then live-verify M-AV and the C-14 quoted-estimate caption
  - Priority: P1
  - Source: DEC-041, DEC-042, `CLAUDE.md` §10
  - Notes: Both migrations are merged and proven against real PostgreSQL by the Docker domain suite — 22 assertions for M-AV, 16 for AC-04. **Neither has been applied to the dev project, and applying either is a deliberate act under explicit instruction, never a side effect of other work.** Until then the availability modes and the quoted-estimate caption exist only in the repository. `20260901000002` was applied and verified live 2026-09-03; that older entry is closed.

- [ ] Remove the two stray unused imports left by M-10 (`20044391`)
  - Priority: P1
  - Source: `pnpm turbo run lint typecheck test build --force`
  - Notes: `waitFor` in `apps/merchant/src/components/RestaurantProfileForm.test.tsx` and `DomainError` in `apps/api/src/modules/merchant/restaurant-profile.controller.spec.ts`. They fail `@banhao/merchant` lint/typecheck/build and `@banhao/api` lint, which makes the whole workspace gate red; the merchant test suite itself passes (613 tests). Two deletions, belonging to M-10's follow-up.

- [ ] Wire the edit-mode image upload in the M-11 item drawer
  - Priority: P2
  - Source: EVENT-029, M11-D09
  - Notes: The drawer renders the stored object key in edit mode but does not yet drive the existing two-step `upload-url` → `complete` flow. Create mode is correctly disabled with its reason stated — both endpoints are keyed by `menuItemId`, so no key exists before the dish is saved. No new endpoint, no second image system, and no design decision is required: the routes and their validation schemas already exist.

## Technical Debt

- [ ] `support.js` is duplicated 4× (`design/customer/`, `design/design-system/`, `docs/04-payment/`, `docs/05-architecture/`) instead of shared from one location, to avoid editing `.dc.html` script paths during the 2026-08-09 reorg
  - Source: `CHANGELOG.md`
  - Notes: All 4 copies are currently byte-identical (checksum-verified). If the runtime changes, all 4 need updating together.

## Documentation Debt

- [ ] `docs/00-overview/`, `01-product/`, `02-ux/`, `06-api/`, `07-operations/` are empty TODO-status placeholders
  - Source: each folder's own `README.md`
  - Notes: —

- [ ] `design/driver/`, `design/merchant/`, `design/admin/`, `design/payment/`, `design/prototype/` are empty TODO-status placeholders
  - Source: each folder's own `README.md`
  - Notes: —

- [ ] All of `specs/` is empty TODO-status placeholders
  - Source: each folder's own `README.md`
  - Notes: —

## Questions Requiring Product Decision

> Kept for history. These five were given structured IDs (Q-001…Q-005) in
> `ai/KNOWLEDGE/QUESTIONS.md`, which is canonical for them. Q-003 is now extended
> by BQ-016 and Q-004 by BQ-034 — see
> [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md). **All five remain
> genuinely open**; DEC-016…DEC-032 answered none of them.

- [ ] Which payment provider(s) will BANHAO integrate with for PromptPay QR in Phase 1?
  - Source: `docs/04-payment`, closing note

- [ ] What is the legal/marketplace settlement model (who is the merchant of record for payment purposes)?
  - Source: `docs/04-payment`, closing note

- [ ] What is the full refund policy, beyond the three rules already documented (auto-refund before `PREPARING`, shop-confirmed refund during `PREPARING`, support-center-only after `PICKED_UP`)?
  - Source: `docs/05-architecture`, section "03 — ORDER STATE MACHINE"

- [ ] What exact cash-remittance limit triggers "stop assigning new jobs" for a driver? — **DEFERRED with COD (DEC-016), not answered.** Not a Phase 1 blocker; returns when COD does.
  - Source: `docs/04-payment`, section "05 — DRIVER" (states a limit exists — "ถ้ายังมีเงินสดค้างนำส่งเกินวงเงินที่กำหนด" — but does not give the number)

- [ ] What is the target timeline / launch date for Phase 1?
  - Source: UNKNOWN / NOT VERIFIED — not mentioned anywhere in the repository
