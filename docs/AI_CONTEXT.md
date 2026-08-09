# BANHAO | บ้านเฮา — AI Context

> Read this file first, before doing anything else in this repository. See "Instructions for AI Agents" at the bottom.

## Project Identity

- **Name:** BANHAO | บ้านเฮา
- **Type:** Local Super App
- **Repository:** `banhao-design` (GitHub: `kmandev/banhao-design`)
- **Current repository contents:** Product/UX design artifacts and process documentation only. **No application source code exists in this repository yet** (verified — see [Technology Stack](#technology-stack)).

## Project Vision

Build the first major local multi-service platform for อำเภอบุณฑริก, จังหวัดอุบลราชธานี. (Given project brief — treated as a verified product fact, not something the repository itself needs to prove.)

## Current Phase

**Phase 1 — Food Delivery.** Product and UX design for this phase are substantially complete (design system + full customer flow). No implementation has started.

## Target Market

UNKNOWN / NOT VERIFIED beyond the initial service area below. No user research, persona, or market-sizing documents exist in this repository.

## Initial Service Area

อำเภอบุณฑริก จังหวัดอุบลราชธานี ประเทศไทย (Amphoe Buntharik, Ubon Ratchathani Province, Thailand). Confirmed in every design canvas's header and in [`docs/05-architecture/BANHAO Product Architecture.dc.html`](05-architecture/BANHAO%20Product%20Architecture.dc.html) ("Phase 1 อ.บุณฑริก จ.อุบลราชธานี").

## Core Business Model

Marketplace connecting customers, merchants (restaurants/shops), and drivers ("ไรเดอร์"), with the platform taking a fee per order (`platform fee` appears as a line item in the ledger examples in `docs/04-payment`). Exact commission structure, take-rate, and legal/contractual model: **UNKNOWN / NOT VERIFIED** — the payment doc explicitly states it is a product design, not yet bound to any specific provider or legal structure.

## Current Product

Only the **Customer App** has a complete UI design (18 screens, Phase 1 food-ordering flow — see [`design/customer/`](../design/customer/)). Driver App, Merchant Web, and Admin Web exist only as a handful of wireframe-level sketches inside the Product Architecture canvas (see [Current Architecture](#current-architecture)) — not full designs, not implementations.

## Technology Stack

**No application technology stack has been chosen or implemented.** This is a design-only repository: no `package.json`, no backend/frontend framework files, no database schema, no API code, no Dockerfile, no CI config, and no `.env` example exist anywhere in the repo (verified by full-repository file search on 2026-08-09).

What *is* evidenced in the repository:

| Item | Evidence | Status |
|---|---|---|
| Design canvases use a proprietary `.dc.html` format (`<meta name="design_doc_mode" content="canvas">`) rendered by a local `support.js` runtime | Present in all 4 `.dc.html` files | Design tooling only, not app tech |
| `support.js` is generated output from an external tool: comment reads `GENERATED from dc-runtime/src/*.ts — do not edit. Rebuild with 'cd dc-runtime && bun run build'` | `design/customer/support.js:1` (and its 3 duplicates) | The `dc-runtime` source itself is **not** in this repository — external tool |
| UI fonts: IBM Plex Sans Thai, IBM Plex Mono | Google Fonts `<link>` in every `.dc.html` `<head>` | Design choice, not implemented in any app build |
| Tracking prototype uses Leaflet.js 1.9.4 via CDN | `design/tracking/tracking-map.html` | Prototype only, explicitly uses mock/simulated coordinates (`// ข้อมูลจำลอง` in the file) — not a confirmed production choice |
| Driver App platform intention: "Mobile · Flutter" | `docs/05-architecture/BANHAO Product Architecture.dc.html`, sitemap data (`platform:'Mobile · Flutter'`) | Documented **intention** in a design doc, not an implementation decision with sign-off recorded anywhere |
| Merchant Web platform intention: "Responsive · Desktop first" (no framework named) | Same sitemap data | Intention only |
| Admin Web platform intention: "Desktop first" (no framework named) | Same sitemap data | Intention only |

Backend language, framework, hosting provider, and database: **UNKNOWN / NOT VERIFIED**.

## Repository Structure

```
docs/               Documentation, numbered by lifecycle stage (00-overview … 07-operations),
                     plus this AI-memory file set at the docs/ root (AI_CONTEXT.md, CURRENT_STATUS.md,
                     ARCHITECTURE.md, DECISIONS.md, ROADMAP.md, TODO.md, PROJECT_HISTORY.md, CHANGELOG.md)
design/              Visual/interactive design canvases, one folder per surface
  design-system/     Shared design system (colors, type, components, tokens) — DONE v1.0
  customer/          Customer App — DONE, 18 screens, Phase 1
  driver/ merchant/ admin/   Not yet designed beyond wireframe sketches in docs/05-architecture
  payment/           Payment-specific UI (currently inline inside customer/) — placeholder
  tracking/          Delivery tracking / map prototype
  prototype/         Reserved for future combined end-to-end prototypes — empty
assets/              brand/ icons/ illustrations/ (all empty — inline in canvases today) + screenshots/ (QA captures)
specs/               Functional/behavioral specs per surface — all empty placeholders (TODO)
archive/             Deprecated/superseded content — empty, nothing archived yet
ai/                  AI operating protocol, session logs, audit prompts (this system)
README.md, AGENTS.md, CONTRIBUTING.md, CHANGELOG.md   Root-level project docs
```

Full explanation of every top-level directory: root [`README.md`](../README.md).

## Current Architecture

There is no implemented system architecture — see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the full breakdown of what is *documented as intended design* (order state machine, payment state machine, webhook-driven payment confirmation, ledger model) versus what is genuinely unimplemented (backend, database, API, auth, hosting — all UNKNOWN/NOT VERIFIED).

## Core Entities

Documented in [`docs/05-architecture/BANHAO Product Architecture.dc.html`](05-architecture/BANHAO%20Product%20Architecture.dc.html) section "06 — SCALING" and echoed in the design system's component-naming rationale: **Merchant, Product, Order, Delivery, Driver**. These are named generically (not "restaurant", not "food") specifically so Phases 2–4 (Parcel, Ride, Shopping) can reuse the same data model.

## Current Features

See [`docs/CURRENT_STATUS.md`](CURRENT_STATUS.md) for the full, honest breakdown. Summary: all "features" that exist today are **design artifacts** (click-through UI in `.dc.html` canvases), not running software.

## Completed Features

- Design System v1.0 (Phase 1 scope)
- Customer App UI design — 18 screens, full Phase 1 food-ordering flow
- Product Architecture documentation — strategy, sitemap, order state machine, user flow, wireframes, scaling model
- Payment Architecture documentation — architecture, state machine, flows, ledger, driver cash handling, edge cases
- Tracking-map prototype (mock data)
- Repository documentation/process scaffold + AI memory system

## In Progress

Nothing is actively "in progress" in code. At the documentation level: this AI memory system (this session).

## Not Yet Implemented

- Any backend service, API, or database
- Any authentication/authorization system
- Driver App, Merchant Web, Admin Web (beyond a handful of wireframe screens)
- Payment provider integration
- Deployment/hosting of any kind
- Automated tests of any kind

## Known Issues

No runtime issues exist (no running system to have bugs in). Open **design-level** questions are tracked in [`docs/TODO.md`](TODO.md) under "Questions Requiring Product Decision" — they are sourced from caveats the design documents state about themselves (e.g. payment provider not yet chosen, legal/compliance review not yet done).

## Important Constraints

See [AGENTS.md](../AGENTS.md) at the repository root for the full, binding rule set. The two most load-bearing constraints, both sourced verbatim from `docs/04-payment/BANHAO Payment Architecture.dc.html`:

1. **Order State and Payment State are separate state machines that must never be collapsed into one.** ("ออเดอร์หนึ่งใบมีสองสถานะเดินคู่กันเสมอ ห้ามยุบเป็นสถานะเดียว")
2. **The app is never the arbiter of payment success — only a backend that has verified a provider webhook is.** ("แอปไม่ใช่ผู้ตัดสินว่าจ่ายสำเร็จหรือยัง มีแต่ backend ที่ได้รับการยืนยันจากผู้ให้บริการชำระเงินเท่านั้นที่ตัดสินได้")

## Business Rules

Extracted from the design canvases (see [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for full state tables):

- Order states (12): `NEW → ACCEPTED → PREPARING → READY → DRIVER_ASSIGNED → PICKED_UP → DELIVERING → COMPLETED`, plus terminal/error states `NO_DRIVER`, `PAYMENT_FAILED`, `REJECTED`, `CANCELLED`.
- Payment states (12): `CREATED → PENDING → PROCESSING → SUCCESS`, plus `FAILED`, `EXPIRED`, `CANCELLED`, `REFUND_PENDING`, `REFUND_PROCESSING`, `REFUNDED`, and the cash-specific pair `CASH_PENDING` / `CASH_COLLECTED`.
- Refunds: cancel before `PREPARING` → full automatic refund. Cancel during `PREPARING` → requires shop confirmation. After `PICKED_UP` → cannot cancel; must go through the support center.
- Cash collected by a driver is a **liability owed to the platform** ("Cash Collection"), never counted as driver income, and must be shown separately in any driver-facing UI.
- Every order's ledger must balance to exactly zero — money in (customer payment) must equal money out (merchant + driver + platform fee + refunds) with no unaccounted remainder.

## Technical Rules

None exist yet at the code level (no code exists). The rules above are product/business rules that any future implementation must honor. See [AGENTS.md](../AGENTS.md) for agent-facing technical rules (no secrets in Git, no hardcoded credentials, webhook-only payment confirmation, ledger auditability, etc.).

## Development Principles

From [`docs/05-architecture/BANHAO Product Architecture.dc.html`](05-architecture/BANHAO%20Product%20Architecture.dc.html) section "01 — STRATEGY": any feature that lengthens the Phase 1 core path (open app → choose shop → choose food → order → wait → receive) — even by one step — gets deferred to a later phase. Not-yet-available services are shown as dimmed, unclickable "coming soon" cards with no destination screen, rather than being half-built.

## Current Priorities

1. Resolve the P0 items in [`docs/TODO.md`](TODO.md): payment provider/settlement model, backend stack, and database technology — nothing can be implemented until these are decided.
2. Design the remaining surfaces (Driver App, Merchant Web, Admin Web) past wireframe stage.

## Next Recommended Step

Make the payment-provider and backend-technology decisions blocking all further implementation (see `docs/TODO.md` P0 list) — everything else in this repository is design-complete enough to start from once those decisions land.

---

# Instructions for AI Agents

1. Read `docs/AI_CONTEXT.md` (this file) before doing any work.
2. Read `docs/CURRENT_STATUS.md`.
3. Read `docs/ARCHITECTURE.md`.
4. Read `docs/DECISIONS.md`.
5. Read `docs/ROADMAP.md`.
6. Read the most recent file in `ai/SESSION_LOG/`.
7. Do not assume or invent information that has no evidence in the repository — mark it `UNKNOWN / NOT VERIFIED` instead.
8. Do not change architecture without approval.
9. Do not change business rules without approval.
10. Do not build a feature that already exists.
11. If you find a conflict between documentation and source code, report it — do not silently resolve it in either direction.
12. Source code is implementation truth.
13. Business/product decisions are product truth.
14. If you are not sure, stop and ask before changing anything important.

See also [`ai/README.md`](../ai/README.md) for the full before/during/after protocol, and [`ai/PROMPTS/AI_AUDIT.md`](../ai/PROMPTS/AI_AUDIT.md) for a ready-made audit prompt.
