# BANHAO | บ้านเฮา

Local Super App for บุณฑริก, อุบลราชธานี

## Vision

Build the first major local multi-service platform for the area.

## Phase 1

Food Delivery

## Future Phases

1. Food Delivery
2. Parcel Delivery
3. Ride
4. Shopping

## Repository Structure

- **`docs/`** — Written documentation, numbered by lifecycle stage:
  - `00-overview/` — project brief, vision, roadmap
  - `01-product/` — product requirements and scope
  - `02-ux/` — UX research and flows
  - `03-design/` — design-system documentation (written companion to `design/design-system/`)
  - `04-payment/` — payment architecture: state machine, ledger, flows, edge cases
  - `05-architecture/` — product/technical architecture: sitemap, order state machine, scaling
  - `06-api/` — backend API contracts
  - `07-operations/` — runbooks and operational process
- **`design/`** — Visual/interactive design work, one folder per surface:
  - `design-system/` — the shared design system (colors, type, components, tokens)
  - `customer/` — Customer App (Phase 1, done — 17-screen flow)
  - `driver/`, `merchant/`, `admin/` — not yet designed (sitemap-only today, see `docs/05-architecture`)
  - `payment/` — payment-specific UI (currently inline inside `customer/`)
  - `tracking/` — delivery tracking / map prototype
  - `prototype/` — reserved for combined end-to-end prototypes
- **`assets/`** — Static files: `brand/`, `icons/`, `illustrations/` (all currently empty — brand/icons are inline in the design canvases today), `screenshots/` (QA feedback captures)
- **`specs/`** — Functional/behavioral specs per surface (`customer/`, `driver/`, `merchant/`, `admin/`, `payment/`) — prose acceptance criteria, distinct from visual design and architecture docs
- **`archive/`** — Deprecated/superseded content, kept instead of deleted

## Current Product Status

| Area | Status | Notes |
|---|---|---|
| Product Design — Customer App | DONE | 17-screen Phase 1 flow, `design/customer/` |
| Product Design — Driver App | TODO | Sitemap only, `docs/05-architecture/` |
| Product Design — Merchant Web | TODO | Sitemap only, `docs/05-architecture/` |
| Product Design — Admin Web | TODO | Sitemap only, `docs/05-architecture/` |
| Design System | DONE (v1.0, Phase 1 scope) | `design/design-system/` |
| UX | IN PROGRESS | User flow exists inside the architecture canvas; not yet a standalone doc |
| Payment | IN PROGRESS | Architecture, state machine, and ledger model documented (`docs/04-payment/`); no implementation yet |
| Architecture | IN PROGRESS | Strategy, sitemap, order state machine, wireframes, scaling notes exist (`docs/05-architecture/`) |
| Development | TODO | No application code in this repository yet |

## Design & Documentation Files

The `.dc.html` files are self-contained interactive design canvases — open them directly in a browser. Each one loads a local `support.js` runtime from the same folder; keep the pair together if you copy a file elsewhere.

- [`design/customer/BANHAO Customer App.dc.html`](design/customer/BANHAO%20Customer%20App.dc.html)
- [`design/design-system/BANHAO Design System.dc.html`](design/design-system/BANHAO%20Design%20System.dc.html)
- [`docs/04-payment/BANHAO Payment Architecture.dc.html`](docs/04-payment/BANHAO%20Payment%20Architecture.dc.html)
- [`docs/05-architecture/BANHAO Product Architecture.dc.html`](docs/05-architecture/BANHAO%20Product%20Architecture.dc.html)
- [`design/tracking/tracking-map.html`](design/tracking/tracking-map.html)

See [AGENTS.md](AGENTS.md) for rules AI coding agents must follow in this repo, and [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose changes.

## AI Collaboration

This repository contains a shared AI memory system so multiple AI tools (Claude Code, ChatGPT, Gemini, Codex, Cursor, or others) can work on BANHAO in the same context without losing history.

Before working:

1. Read [`ai/HANDOFF.md`](ai/HANDOFF.md)
2. Read [`ai/MEMORY.md`](ai/MEMORY.md)
3. Read [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md)
4. Follow [`ai/README.md`](ai/README.md)
