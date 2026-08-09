# Multi-App Architecture Analysis

BANHAO needs four client surfaces: Customer, Merchant, Driver, Admin (`ai/RESEARCH/CURRENT_ARCHITECTURE_ANALYSIS.md`). This document analyzes how they could relate to each other technically — it does not choose.

## Options considered

### Separate, independent applications per surface

Each surface (Customer, Merchant, Driver, Admin) is its own codebase/project, built and deployed independently, sharing nothing but the backend API contract.

**Pros:** Each app can use the platform/framework best suited to it (e.g. Customer/Driver as native or cross-platform mobile, Merchant/Admin as web) without any shared-codebase constraints. Teams (or AI sessions) can work on one surface without touching others. Failure/bug isolation between apps.

**Cons:** Any shared logic (e.g. how order status text is derived, date/currency formatting, API client code, design tokens) gets duplicated or drifts between apps unless deliberately extracted. Four separate CI/CD pipelines and dependency-update burdens instead of one.

### Shared codebase / monorepo

All four surfaces live in one repository, sharing packages for things like API types, design tokens, and utility code, but still producing four separate deployable apps.

**Pros:** A single source of truth for shared types (e.g. the Order/Payment state enums from `docs/ARCHITECTURE.md` — defining them once and importing everywhere avoids the classic bug of one app's status list silently drifting out of sync with the backend's). Easier for a small/AI-assisted team to make a cross-cutting change (e.g. adding a new order state) in one PR that touches all affected apps. One CI/CD setup, one dependency-update cadence (see `ai/RESEARCH/REPOSITORY_STRATEGY.md` for the deeper repo-structure analysis this implies).

**Cons:** Larger single repository, potentially slower CI if not configured with proper caching/incremental builds. Requires tooling (e.g. a monorepo build system) that has its own learning curve.

### Web + Mobile combination

A framing orthogonal to the above two: regardless of one-repo-vs-many, each surface could independently be web, native mobile, or cross-platform mobile. E.g. Customer and Driver as mobile apps (they're used on the go), Merchant and Admin as responsive web apps (used at a desk/tablet, per the design docs' own notes — "ร้านเปิดค้างไว้ทั้งวันบนแท็บเล็ตหลังเคาน์เตอร์" for Merchant, "Desktop first" for Admin).

This matches what's actually documented in `docs/05-architecture`'s sitemap data (FACT-008): Driver = "Mobile · Flutter", Merchant = "Responsive · Desktop first", Admin = "Desktop first". Customer's platform isn't explicitly labeled in the sitemap data the way the other three are, but its design canvas is built mobile-first (see the phone-frame layout in `design/customer/`).

## Analysis, not a decision

- The **web-vs-mobile split by surface** (Customer+Driver mobile, Merchant+Admin web) is already a documented design-time intention (DEC-006), not something this document needs to re-derive — though it remains unconfirmed as an implementation decision.
- The **repo-structure question** (separate repos vs. monorepo) is a genuinely open technical choice with real trade-offs either way, covered in more depth in `ai/RESEARCH/REPOSITORY_STRATEGY.md`. The shared-types argument is strong specifically *because* of CON-001/REQ-002 — every client must agree on the same Order/Payment state values, and a shared-package monorepo makes "the backend added a new state and three of four apps don't know about it yet" structurally harder to ship by accident.
- If Driver App is genuinely built in Flutter (DEC-006) while Merchant/Admin are web, "shared codebase" would mean sharing non-UI concerns (API types, business logic constants) across a language boundary (Dart vs. TypeScript/JS, most likely) — which is possible (e.g. generating typed clients from an API schema) but is a real constraint to weigh, not a given. This is a genuine trade-off input for whichever repository strategy and backend/frontend stack gets chosen (Q-006).

No recommendation is stated as final here beyond what `ai/RESEARCH/REPOSITORY_STRATEGY.md` proposes for repo layout — the web/mobile split per surface already has design-level backing (DEC-006) and is treated as a strong signal, not a re-opened question, unless the Product Owner wants to revisit it.
