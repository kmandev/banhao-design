# Events

Significant, dated occurrences in the project's history. Sourced from `git log` and this repository's own record of its sessions — see `docs/PROJECT_HISTORY.md` for the narrative version of the same evidence.

---

## EVENT-001

```yaml
id: EVENT-001
type: EVENT
date: 2026-08-09
source: git commit 7d0a7d5 "add design"
confidence: HIGH
```

Initial design drop: four `.dc.html` design canvases (Customer App, Design System, Payment Architecture, Product Architecture), the `tracking-map.html` prototype, the `support.js` canvas runtime, and two annotated QA screenshots added in a single commit.

---

## EVENT-002

```yaml
id: EVENT-002
type: EVENT
date: 2026-08-09
source: git commit f3939d6 "create structure project files"
confidence: HIGH
```

Repository restructured from a flat `design/` folder into `docs/` / `design/` / `assets/` / `specs/` / `archive/`, via an AI-assisted session. All original files preserved and moved with `git mv` (100% content-identical renames). Root `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, and per-directory `README.md` stubs added.

---

## EVENT-003

```yaml
id: EVENT-003
type: EVENT
date: 2026-08-09
source: git commit 7b2d5f7 "add ai rule"
confidence: HIGH
```

AI Memory System v1 created: `docs/AI_CONTEXT.md`, `docs/PROJECT_HISTORY.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/CURRENT_STATUS.md`, `docs/TODO.md`, `docs/CHANGELOG.md`, `ai/README.md`, `ai/SESSION_LOG/2026-08-09.md`, `ai/PROMPTS/AI_AUDIT.md`.

---

## EVENT-004

```yaml
id: EVENT-004
type: EVENT
date: 2026-08-09
source: this session (pending commit at time of writing)
confidence: HIGH
```

AI Memory System v2 built on top of v1: knowledge classification system (`ai/KNOWLEDGE/`: FACTS, REQUIREMENTS, CONSTRAINTS, ASSUMPTIONS, QUESTIONS, PROPOSALS, EVENTS, ARCHITECTURE index), `ai/MEMORY.md` index, `ai/HANDOFF.md`, `ai/CONVERSATIONS/` scaffold, new prompt templates (`CONVERSATION_TEMPLATE.md`, `EXTRACT_CONVERSATION.md`, `UPDATE_MEMORY.md`, `CONFLICT_CHECK.md`), `docs/DECISIONS.md` migrated to the richer per-decision format, and `ai/README.md` rewritten as the official multi-level context-loading protocol. No v1 memory content was deleted or had its meaning changed.

---

## EVENT-005

```yaml
id: EVENT-005
type: EVENT
date: 2026-08-09
source: this session (pending commit at time of writing)
confidence: HIGH
```

Architecture and technology research pass completed — 27 documents in `ai/RESEARCH/`, covering current-architecture reconstruction, technology requirements, scale model, and comparisons across backend, database, payment, authentication, real-time, queue, maps, notifications, storage, infrastructure, observability, and repository strategy; plus marketplace payment model, security architecture, Thailand compliance, cost model, risk matrix, decision matrix, three end-to-end architecture candidates, an executive summary, and a Product Owner decision sheet. External research used five parallel research agents with all claims sourced and check-dated in `ai/RESEARCH/SOURCES.md`.

**No technology was selected. Q-001, Q-006, and Q-007 remain `OPEN`. No `ACCEPTED` decision was created.** Added Q-009 through Q-020 (all `OPEN`) and PROP-001 through PROP-005 (all `PROPOSED`).

Three findings that changed the project's understanding of its own design:

1. **No payment provider examined supports native PromptPay refunds** — contradicting the refund state machine documented in `docs/04-payment` (Q-020).
2. **The payment-facilitation licensing boundary is unresolved** — BANHAO's own split/transfer-round/cash-liability design may constitute regulated activity even when using a licensed PSP (Q-002).
3. **AWS and GCP both now have Bangkok regions, and both are cheaper than Singapore** — latency, PDPA data residency, and cost align rather than trade off.

---

## EVENT-006

```yaml
id: EVENT-006
type: EVENT
date: 2026-08-09
source: this session; branch feature/app-foundation
confidence: HIGH
```

**Application Foundation Started.** The repository moved from documentation-only to containing working application code for the first time.

Product Owner approved the technology stack, resolving **Q-006** (NestJS + TypeScript, DEC-011) and **Q-007** (Supabase PostgreSQL + PostGIS, DEC-010). Six decisions recorded as `ACCEPTED`: DEC-009 (modular monolith), DEC-010 (Supabase), DEC-011 (NestJS), DEC-012 (React Native/Expo + Next.js, superseding DEC-006's Flutter intention), DEC-013 (monorepo/pnpm/Turborepo), DEC-014 (PostgreSQL as financial system of record), DEC-015 (payment provider abstraction only).

Built: pnpm/Turborepo monorepo; NestJS API with global Supabase JWT auth guard and RBAC role guard, `GET /health` and `GET /api/v1/me`, OpenAPI; shared packages (`types`, `validation`, `config`, `api-client`, `ui`); Supabase migrations for PostGIS, the `user_role` enum, `profiles`, a signup trigger, and RLS; four minimal app shells; Docker for the API; GitHub Actions CI; setup/development docs; `ai/DEVELOPMENT_RULES.md`.

**Q-001 (payment provider) deliberately remains `OPEN`** — the foundation ships a `PaymentProvider` interface whose only implementation throws on every call, so no money path can silently appear functional.

Verified: 37 tests pass, lint/typecheck/build pass across 15 workspace tasks, and the API was started to confirm `/health` returns 200 and `/api/v1/me` returns 401 without a valid token.

---

## EVENT-007

```yaml
id: EVENT-007
type: EVENT
date: 2026-08-09
source: this session; branch feature/app-foundation
confidence: HIGH
```

**Pre-merge review fixes.** A foundation review returned PASS WITH MINOR FIXES, flagging possible recursion and privilege escalation in the `profiles` RLS policy and a screen-count discrepancy.

Both RLS concerns were **measured, not reasoned about**, by executing the policies against PostgreSQL 16 + PostGIS in Docker with a Supabase auth shim. Neither was an active bug: the self-referencing subquery terminated (the SELECT policy did not reference `profiles`), and role escalation, INSERT of a fabricated ADMIN row, DELETE, and id changes were all already rejected.

Testing did find a genuine gap the review had not flagged: **`profiles.phone` was client-writable**, letting a user's profile drift from the Supabase Auth identity used for OTP login.

Migration `20260809000003_harden_profiles_rls.sql` adds three defence layers — column privileges limiting clients to `display_name`, non-recursive RLS policies, and an immutability trigger for `role`/`id`/`phone` — plus a service-role-only `set_user_role()` as the trusted role-assignment path. It also removes the *latent* recursion risk: the old policy only avoided recursion because no SELECT policy referenced `profiles`, which the next policy someone writes would likely break.

13 executable assertions added (`supabase/tests/`), wired into CI. The suite was validated against a negative control with the hardening migration removed, where it correctly fails — an earlier draft passed in that control because its fixture re-applied the grants it claimed to verify.

Customer screen count settled at **18**, verified by counting screen labels in the design canvas; only root `README.md` still said 17.

---

## EVENT-008

```yaml
id: EVENT-008
type: EVENT
date: 2026-08-09
source: this session; branch feature/customer-app
confidence: HIGH
```

**Customer App Implementation Started.** The Customer App UI was implemented in React Native + Expo from the design artifact, which was treated as the source of truth throughout.

**Design audit finding:** the design registry contains **31 addressable states**, not 18 — 18 numbered screens (01–18), plus 7 payment sub-states (12b–12h, mapping onto the Payment State Machine), plus 6 state variants (loading, network error, shop closed, empty cart, no driver, cancelled). All 31 are implemented; the 18 numbered screens are the primary routes and the other 13 are states of them. Documented in `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md`.

Built: design tokens extracted by frequency analysis of the artifact (`packages/ui/src/theme/tokens.ts`); shared RN components (Button, Card, Input, Badge, Avatar, Stepper, PriceRow, BottomBar, ShopCard, MenuRow, CategoryChip, ListRow, StateView, StatusTimeline); 4-tab navigation matching the design's own tab bar; Supabase auth with session persistence and a profile screen wired to the real `profiles` table under RLS; a repository layer with typed mock data behind swappable interfaces.

**No business logic was implemented** — no order creation, payment integration, dispatch, or settlement. Everything outside authentication and `profiles` is mock-backed.

Five `DESIGN_QUESTION` items (DQ-01…DQ-05) were recorded rather than guessed, covering the cash payment path, the duplicate-payment trigger, the refund entry point, address editing, and search ranking.

Verified: 84 tests pass (33 customer, 14 UI component, 37 pre-existing); lint, typecheck, and build pass. The app was built and driven on an iPhone 16 Pro simulator — screens 01–03 confirmed visually; **04–18 were NOT visually verified** because no Supabase project is configured, recorded honestly in `docs/CUSTOMER_APP_VISUAL_QA.md`.

Also fixed during this work: the monorepo now pins one React version (`pnpm.overrides`) after two `@types/react` majors collided, and `@banhao/ui` exposes framework-agnostic tokens on a `./theme` subpath so the Next.js admin does not bundle React Native.

---

## EVENT-009

```yaml
id: EVENT-009
type: EVENT
date: 2026-08-10
source: this session; branch feature/customer-app
confidence: HIGH
```

**Customer App final QA before merge.** The one MUST-FIX from review — IBM Plex Sans Thai not applied — is resolved.

All four design weights (400/500/600/700) are now **bundled with the app** via `@expo-google-fonts/ibm-plex-sans-thai` + `expo-font`; Metro packages the TTF files at build time and nothing is fetched from Google at runtime. `App.tsx` holds the splash until fonts resolve, and falls through to the platform face if loading fails rather than hanging.

Weights are selected by **family name**, not `fontWeight` — React Native registers each weight as a separate family and Android ignores `fontWeight` alongside a custom `fontFamily`. All 19 component and screen files were converted.

**A false alarm was investigated and dismissed rather than reported.** At moderate zoom the heading "สั่งอาหารในบุณฑริก" appeared to be missing its ไม้เอก. Verified three ways — maximum-magnification crop of the running app, the bundled TTFs rendered in a browser at all four weights, and the same character combination at weight 400 in the app — all correct. The marks merge visually when downscaled. No defect exists; recorded so the next agent does not re-raise it.

Visual QA: **4 / 31 states verified by screenshot** (01 Splash, 02 Onboarding, 03 Login, 04 OTP) on iPhone 16 Pro, with 03 also verified on iPhone SE. The remaining 22 screens and 6 state variants are **UNVERIFIED** — `RootNavigator` gates them behind a session and no Supabase project is configured. No fake session was created.

Authentication: **NOT VERIFIED — Supabase environment not configured.**
Android: **UNVERIFIED** — no Android SDK on this machine.

84 tests pass; lint, typecheck and build pass. No MAJOR or BLOCKER differences among inspected screens.
