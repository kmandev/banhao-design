# TODO

Every item cites where it comes from in the repository. Items with no in-repo source are marked as such rather than invented.

> **Business decisions live elsewhere.** Since EVENT-013 (2026-08-10) the product
> decisions that block Order, Payment and Settlement are tracked in
> [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md) (`BQ-001…BQ-039`)
> and [`../ai/KNOWLEDGE/QUESTIONS.md`](../ai/KNOWLEDGE/QUESTIONS.md)
> (`Q-001…Q-020`). This file keeps engineering and documentation tasks. Do not
> duplicate a question into both places.

## P0 — Critical

- [ ] Answer the remaining **8** P0 business questions in [`OPEN_BUSINESS_QUESTIONS.md`](OPEN_BUSINESS_QUESTIONS.md)
  - Priority: P0
  - Source: EVENT-013, narrowed by EVENT-014
  - Notes: Q-001 (provider), Q-002 (legal), Q-010/BQ-028 (commission **rate**), Q-020 (PromptPay refund mechanism), BQ-015 (who bears the cost of wasted food), BQ-026 and BQ-027 (fee **numbers**), BQ-030 (promotion funding). **Every structural question is now answered** by DEC-016…DEC-032; what remains is numbers, the provider, and legal. BQ-023, BQ-033 and Q-004 are **deferred with COD** (DEC-016), not answered.

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
  - Notes: `profiles.role` is deprecated and non-authoritative, but three live objects still read it — `RolesGuard` (`apps/api/src/common/guards/roles.guard.ts`), `set_user_role()`, and the `role` clause of `enforce_profile_immutable_columns()`. **`platform_staff`, `restaurant_members` and `riders` now exist** (EVENT-018, `feature/supabase-migration-v1`, not yet applied to `banhao-dev`) — the schema half of this task is done. Remaining sequence: apply the migration → backfill `platform_staff` from `profiles.role` where `ADMIN` → change `RolesGuard` to resolve capability from `restaurant_members` / `riders` / `platform_staff` → drop the column, its trigger clause and `set_user_role()`. **The code change is the only blocker now.**

- [ ] Reconcile the Customer App with DEC-016 and DEC-019
  - Priority: P1
  - Source: EVENT-014
  - Notes: two divergences the decision lock created, deliberately left in code. (a) `apps/customer/src/mocks/types.ts` encodes the superseded 12 order states — DEC-019 replaces them. (b) Checkout still offers a cash option and a cash-prepared-amount selector — DEC-016 disables COD. Needs the exception **state names** settled first (still `PROPOSED`).

- [ ] Design the full Driver App UI (currently 4 wireframe-level screens only: D-03, D-05, D-07, D-13)
  - Priority: P1
  - Source: `docs/05-architecture/BANHAO Product Architecture.dc.html`, section "05 — WIREFRAMES"
  - Notes: Platform intention documented as Flutter mobile; not confirmed as final (see DEC-006 in `DECISIONS.md`).

- [ ] Design the full Merchant Web UI (currently 1 wireframe-level screen only: M-05)
  - Priority: P1
  - Source: same section
  - Notes: —

- [ ] Design the full Admin Web UI (currently 3 wireframe-level screens only: A-02, A-03, A-12)
  - Priority: P1
  - Source: same section
  - Notes: —

- [ ] Legal/compliance review: payment provider terms, marketplace receiving model, KYC/KYB, refund policy, payout cycles, Thai payment regulation, tax/accounting, PDPA, bank account verification
  - Priority: P1
  - Source: `docs/04-payment/BANHAO Payment Architecture.dc.html`, closing note of section "06 — EDGE CASES"
  - Notes: Explicitly flagged in-source as required before going live.

## P2 — Medium

- [ ] Write API contract documentation
  - Priority: P2
  - Source: `docs/06-api/README.md` (empty placeholder created 2026-08-09)
  - Notes: Depends on the backend stack decision (P0).

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
