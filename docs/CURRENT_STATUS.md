# Current Status

## Last Updated

2026-08-09

## Overall Status

**No application exists.** This repository contains product/UX design (interactive `.dc.html` canvases), architecture and payment documentation, and process scaffolding. Nothing described below as "designed" should be read as "built" — the two are tracked separately on purpose.

## Current Phase

Phase 1 — Food Delivery. Design stage; implementation has not started.

## Working Features

None. There is no running application, so nothing can be verified as "working" in the software sense.

## Partially Working

None.

## Mock / Placeholder

- `design/customer/BANHAO Customer App.dc.html` — an interactive, click-through **design mockup** of 18 screens. It demonstrates UI states and copy, but has no real backend, no real orders, and no real payment processing behind it.
- `design/tracking/tracking-map.html` — a Leaflet map prototype using hard-coded, explicitly-labeled mock coordinates (`ตัวอย่าง: อ.บุณฑริก … ข้อมูลจำลอง` — "example … simulated data" in the file's own comment). Not connected to any real location data.
- Numeric examples throughout `docs/04-payment/BANHAO Payment Architecture.dc.html` (order totals, ledger splits) are explicitly labeled as design examples ("ข้อมูลตัวเลขทั้งหมดในเอกสารเป็นข้อมูลตัวอย่างเพื่อการออกแบบ").

## Not Implemented

- Backend service / API of any kind
- Database (no schema, no migrations, no ORM config anywhere in the repo)
- Authentication / authorization
- Payment provider integration
- Driver App, Merchant Web, Admin Web (see per-surface status below)
- Deployment, hosting, CI/CD (none configured)
- Automated tests (none exist)

## Known Bugs

None tracked. No code exists to have runtime bugs. Open **design-level** questions are tracked in [`TODO.md`](TODO.md), not here.

## Technical Debt

- `support.js` (the design-canvas runtime) is intentionally duplicated 4× across `design/customer/`, `design/design-system/`, `docs/04-payment/`, `docs/05-architecture/` rather than shared from one location, to avoid rewriting `<script src>` paths inside the `.dc.html` files during the 2026-08-09 reorg. All 4 copies are currently identical (verified by checksum); if the runtime ever needs to change, all 4 must be updated together. See `CHANGELOG.md`.

## Security Concerns

UNKNOWN / NOT VERIFIED — no backend or auth exists yet to assess. Forward-looking requirement already documented: `docs/04-payment` specifies that payment webhooks must be signature-verified and processed idempotently once a backend exists (see `docs/ARCHITECTURE.md`).

## Deployment Status

Not deployed. No hosting configuration, Dockerfile, or CI/CD pipeline exists in this repository.

## Database Status

Not started. No schema, no migration files, no database technology chosen.

## API Status

Not started. `docs/06-api/README.md` is a TODO placeholder with no content.

## Frontend Status

Not started as an application. Only static, standalone design-canvas HTML files exist (see `design/`) — these are not a frontend app scaffold and share no code with a future real frontend.

## Admin Status

Not designed beyond 3 wireframe-level screens inside the Product Architecture canvas: `A-02 Dashboard`, `A-03 Live Map`, `A-12 คิวอนุมัติ` (Approval Queue). See `docs/05-architecture/BANHAO Product Architecture.dc.html` section "05 — WIREFRAMES". No dedicated Admin design folder content exists yet (`design/admin/` is an empty placeholder).

## Merchant Status

Not designed beyond 1 wireframe-level screen: `M-05 จัดการออเดอร์ · Kanban` (Order Management Kanban), same source section. The design system additionally defines a reusable "Merchant Card" component. `design/merchant/` is an empty placeholder.

## Customer Status

**Design complete for Phase 1** — 18-screen interactive canvas at `design/customer/BANHAO Customer App.dc.html`, covering splash through account settings, including PromptPay QR checkout. Not implemented in code.

## Rider (Driver) Status

Not designed beyond 4 wireframe-level screens: `D-03 หน้าแรกไรเดอร์` (Home), `D-05 งานใหม่เข้า` (New Job), `D-07 นำทาง` (Navigation/status changes), `D-13 รายได้` (Earnings). Same source section. Platform intention documented as "Mobile · Flutter" — not a confirmed implementation decision. `design/driver/` is an empty placeholder.

## Current Blockers

No technical blockers exist because no development has started. Product-level items block the *start* of development — see `docs/TODO.md` P0 list (payment provider/settlement model, backend stack, database technology all undecided).

## Immediate Next Step

Resolve the P0 decisions in `docs/TODO.md` (payment provider, backend stack, database) — every other piece of Phase 1 design is complete enough to build from once those land.
