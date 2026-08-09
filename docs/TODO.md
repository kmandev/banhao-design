# TODO

Every item cites where it comes from in the repository. Items with no in-repo source are marked as such rather than invented.

## P0 — Critical

- [ ] Decide payment provider(s) and the marketplace/settlement model for Phase 1 PromptPay QR payments
  - Priority: P0
  - Source: `docs/04-payment/BANHAO Payment Architecture.dc.html`, closing note of section "06 — EDGE CASES"
  - Notes: The document explicitly states it is not yet bound to any provider and flags this as required before production. Blocks all payment implementation.

- [ ] Decide backend technology stack (language, framework, hosting)
  - Priority: P0
  - Source: UNKNOWN / NOT VERIFIED — no decision found anywhere in the repository
  - Notes: Nothing can be implemented until this exists.

- [ ] Decide database technology and design the schema
  - Priority: P0
  - Source: UNKNOWN / NOT VERIFIED
  - Notes: The Order and Payment state machines are already fully specified at the product level (`docs/05-architecture`, `docs/04-payment`) and ready to translate into a schema once a database is chosen.

## P1 — High

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

- [ ] Which payment provider(s) will BANHAO integrate with for PromptPay QR in Phase 1?
  - Source: `docs/04-payment`, closing note

- [ ] What is the legal/marketplace settlement model (who is the merchant of record for payment purposes)?
  - Source: `docs/04-payment`, closing note

- [ ] What is the full refund policy, beyond the three rules already documented (auto-refund before `PREPARING`, shop-confirmed refund during `PREPARING`, support-center-only after `PICKED_UP`)?
  - Source: `docs/05-architecture`, section "03 — ORDER STATE MACHINE"

- [ ] What exact cash-remittance limit triggers "stop assigning new jobs" for a driver?
  - Source: `docs/04-payment`, section "05 — DRIVER" (states a limit exists — "ถ้ายังมีเงินสดค้างนำส่งเกินวงเงินที่กำหนด" — but does not give the number)

- [ ] What is the target timeline / launch date for Phase 1?
  - Source: UNKNOWN / NOT VERIFIED — not mentioned anywhere in the repository
