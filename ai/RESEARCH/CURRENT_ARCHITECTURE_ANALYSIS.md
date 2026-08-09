# Current Architecture Analysis

Reconstructed directly from the repository as it exists on 2026-08-09. This is a factual inventory, not a proposal — see `ai/RESEARCH/ARCHITECTURE_PATTERN.md` and siblings for forward-looking analysis. Nothing in this file should be read as implemented unless explicitly marked so.

## Customer App

**Design: DONE.** 18-screen interactive design canvas at `design/customer/BANHAO Customer App.dc.html`, covering splash → onboarding → login → OTP → home → search → shop → item options → cart → checkout confirm → delivery address → PromptPay QR → order success → order tracking → rating → order history → notifications → account.

**Implementation: NOT IMPLEMENTED.** No frontend application code, no mobile app project, no web app scaffold exists anywhere in the repository.

## Merchant App

**Design:** 1 wireframe-level screen only (`M-05 จัดการออเดอร์ · Kanban` — order management kanban) plus a reusable "Merchant Card" component in the design system. Documented sitemap intention: "Merchant Web, Responsive · Desktop first" (`docs/05-architecture`, section "02 — SITEMAP").

**Implementation: NOT IMPLEMENTED.**

## Driver App

**Design:** 4 wireframe-level screens (`D-03` home, `D-05` new job, `D-07` navigation/status change, `D-13` earnings). Documented sitemap intention: "Driver App, Mobile · Flutter" — a design-time intention (DEC-006), not a confirmed technical decision.

**Implementation: NOT IMPLEMENTED.**

## Admin

**Design:** 3 wireframe-level screens (`A-02` dashboard, `A-03` live map, `A-12` approval queue). Documented sitemap intention: "Admin Web, Desktop first" (no framework named).

**Implementation: NOT IMPLEMENTED.**

## Backend

**NOT IMPLEMENTED.** No backend service, language, or framework exists anywhere in the repository. No decision has been made (Q-006 is `OPEN`).

What *is* documented as a requirement for whatever backend eventually gets built: it must own the Order State Machine and Payment State Machine as the single source of truth for all four client surfaces (REQ-002), and must be the only thing capable of confirming payment success via webhook (CON-002).

## API

**NOT IMPLEMENTED.** No endpoint, contract, or API framework exists. `docs/06-api/` is an empty placeholder.

## Database

**NOT IMPLEMENTED.** No schema, migration, or database technology choice exists anywhere. No decision has been made (Q-007 is `OPEN`).

What *is* documented as a requirement for whatever database eventually gets chosen: it must be able to represent Order State and Payment State as two independently-persisted, related structures (CON-001), support a ledger that balances to zero per order (CON-003), and model five generic entities — Merchant, Product, Order, Delivery, Driver — that shift meaning across phases without a schema rewrite (REQ-004).

## Payment

**NOT IMPLEMENTED.** No payment provider integration exists. Extensively *designed* though: `docs/04-payment/BANHAO Payment Architecture.dc.html` fully specifies a 12-state payment state machine, a webhook-only confirmation flow, idempotency requirements, and a zero-balance ledger model (see `docs/ARCHITECTURE.md` for the full extraction). No provider has been selected (Q-001 `OPEN`).

## Storage

**NOT IMPLEMENTED.** No object storage, file upload handling, or CDN configuration exists. The design canvases reference product/shop imagery only as inline emoji placeholders (e.g. 🏠, 🥗) — no real image pipeline is designed yet, let alone implemented.

## Notification

**NOT IMPLEMENTED.** No push, SMS, LINE, or email integration exists. The Customer App design includes a "17 แจ้งเตือน" (notifications) screen showing what notifications should look like to the user, but nothing about how they'd be sent.

## Maps

**Prototype only, not production-ready.** `design/tracking/tracking-map.html` is a standalone Leaflet.js prototype using OpenStreetMap tiles and explicitly mock/hardcoded coordinates (`// ข้อมูลจำลอง` in the file). It demonstrates a UI concept (shop/customer/driver pins) but is not connected to any geocoding, routing, or live-tracking backend — there is none.

## Real-time

**NOT IMPLEMENTED.** No WebSocket, SSE, polling, or push infrastructure exists. The requirement is documented (REQ-002 — all clients must read a shared, live order status) but no mechanism has been chosen (see `ai/RESEARCH/REALTIME.md`).

## Analytics

**NOT IMPLEMENTED.** No analytics/reporting code exists. The Admin Web wireframe (`A-02 Dashboard`) sketches what a dashboard should show (orders/day, GMV, new customers, online drivers) but this is a UI mockup, not a data pipeline.

## Summary Table

| Layer | Design status | Implementation status |
|---|---|---|
| Customer App | DONE (18 screens) | NOT IMPLEMENTED |
| Merchant App | Wireframe only (1 screen) | NOT IMPLEMENTED |
| Driver App | Wireframe only (4 screens) | NOT IMPLEMENTED |
| Admin | Wireframe only (3 screens) | NOT IMPLEMENTED |
| Backend | Fully specified state machines/rules | NOT IMPLEMENTED |
| API | Not designed | NOT IMPLEMENTED |
| Database | Domain model specified, no schema | NOT IMPLEMENTED |
| Payment | Fully specified architecture | NOT IMPLEMENTED |
| Storage | Not designed | NOT IMPLEMENTED |
| Notification | UI concept only | NOT IMPLEMENTED |
| Maps | Prototype (mock data) | NOT IMPLEMENTED (production) |
| Real-time | Requirement documented, no mechanism | NOT IMPLEMENTED |
| Analytics | UI concept only (Admin wireframe) | NOT IMPLEMENTED |

This table is the baseline every research document in `ai/RESEARCH/` works from — everything below the "Design status" column is genuinely greenfield.
