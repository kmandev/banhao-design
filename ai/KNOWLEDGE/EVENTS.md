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

---

## EVENT-010

```yaml
id: EVENT-010
type: EVENT
date: 2026-08-10
source: this session; branch feature/supabase-customer-auth
confidence: HIGH
```

**Supabase dev environment created and Customer authentication verified end-to-end for the first time.**

A Free-tier project `banhao-dev` was created in `ap-southeast-1` (Singapore), migrations pushed, and **Phone auth enabled with Supabase Test OTP** — the official no-SMS development path. No custom OTP backend was built and no OTP is stored in our database. Anon-key-only credentials live in the gitignored `apps/customer/.env`; the service role key appears nowhere in the app, the repository, or any document.

**Authentication is no longer `NOT VERIFIED`.** Against the live project: request OTP, reject a wrong OTP with the server's own error, verify a correct OTP, read the `profiles` row under RLS, update `display_name` (`204 PATCH`), survive a full app restart with the session intact, log out, and stay logged out across another restart — all confirmed by screenshot and request log. **No fake session was created at any point.**

**Live RLS verification: 14 / 14 passed** (`supabase/tests/live-rls-check.mjs`), signing in through real GoTrue with the anon key and then attempting what a hostile client would. This is distinct from the plain-PostgreSQL shim suite, and `supabase/tests/README.md` now states which is which.

**Visual QA moved from 4/31 to 29/31 states verified by screenshot.** Money arithmetic was checked rather than assumed — ฿170 + ฿15 + ฿5 − ฿10 = ฿180, carried through checkout, QR and payment detail without drift.

Five defects were recorded rather than quietly fixed (DEF-01…DEF-05 in `docs/CUSTOMER_APP_VISUAL_QA.md`). One is MAJOR: **`PayExpired` (12e) is unreachable** — the QR screen counts down to zero and navigates nowhere, and nothing else routes to it. No BLOCKER.

**An environment defect was diagnosed by measurement, not guesswork.** Every request to Supabase after the first failed with `Network request failed`. The Simulator's own log showed the requests had switched to QUIC after the first response advertised `alt-svc: h3`, then died with `NSURLErrorNetworkConnectionLost (-1005)`. `curl` inside the same Simulator runtime reached the host fine, and clearing Expo Go's `HTTPStorages` database bought exactly one more successful request. `scripts/sim-supabase-proxy.mjs` works around it by serving the Simulator plain HTTP and forwarding verbatim to the real project over HTTPS — a transport shim, not a mock. Documented in `docs/SUPABASE_DEVELOPMENT.md`.

Still unverified: Android, a physical iOS device, real SMS delivery (Q-019), and the empty-cart / loading / network-error / no-driver state variants.

---

## EVENT-011

```yaml
id: EVENT-011
type: EVENT
date: 2026-08-10
source: this session; branch feature/supabase-customer-auth
confidence: HIGH
```

**Customer App defect fixes — DEF-01…DEF-05 closed.** The review of EVENT-010 returned PASS WITH FIXES. All five defects are fixed, tested, and re-verified by screenshot on device.

**DEF-01 (MAJOR) — `PayExpired` (12e) was unreachable.** `PromptPayQrScreen` now `replace()`s to `PayExpired` when its TTL reaches zero; `replace` rather than `navigate` so Back cannot return to a dead QR. **No test hook and no shortened timer were added** — 12e was screenshotted by letting the real 600-second countdown run out. The transition decides nothing about money: CON-002 still means only a signature-verified provider webhook may confirm a payment, and the QR remains a labelled placeholder.

**DEF-02 — `ขอรหัสใหม่` now resends.** It calls `requestOtp` on the existing auth layer rather than only resetting the countdown, and the countdown restarts **only on success**, so the UI never claims a code is coming when none was sent. Verified live: a second `200 POST /auth/v1/otp` reached Supabase. No custom OTP backend, no OTP stored, no OTP or token logged.

**DEF-03** — explicit `headerBackTitle: 'กลับ'`; "Tabs" and "Back" no longer appear. **DEF-04** — the selected-state check is now drawn from two rotated borders instead of U+2713, which IBM Plex Sans Thai does not contain; no font dependency remains. **DEF-05** — `formatThaiPhone` presents `081 234 5678` per the design; the E.164 Auth identity and `profiles.phone` are untouched, and a client cannot write that column in any case.

**Visual QA is now 31 / 31 states verified by screenshot.** 22 new tests (49 in the customer app, 16 in `packages/ui`); lint, typecheck, test and build all pass.

Deliberately unchanged: no payment provider, no webhook, no order backend, no dispatch, no settlement. Q-001 stays `OPEN`.

Still **UNVERIFIED**: Android, a physical iOS device, real SMS, keyboard avoidance, the search results list (the simulator cannot type Thai), and the empty-cart / loading / network-error / no-driver variants.

Also corrected: `docs/CURRENT_STATUS.md` still said *"No application exists"* and *"implementation has not started"*, which had been false since 2026-08-09. It now describes the real state, with a historical note pointing at `PROJECT_HISTORY.md` rather than erasing the record.

---

## EVENT-012

```yaml
id: EVENT-012
type: EVENT
date: 2026-08-10
source: this session; branch main
confidence: HIGH
```

**`feature/supabase-customer-auth` reviewed, approved, and merged to `main`.** The Product Owner reviewed the branch (which already contained all of `feature/customer-app`'s history) and explicitly authorized the merge.

`main` was fast-forward-clean relative to the merge base, so the merge (`git merge --no-ff`) applied without conflicts — 104 files changed. The full quality gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) was re-run on `main` **after** the merge, not assumed from the feature branch, and passed: 102 tests across 6 workspaces, 10/10 lint tasks, 15/15 typecheck tasks, 10/10 build tasks. No `.env` or secret is present in the merged tree — verified by `git ls-files` before pushing.

`main` now carries: the application foundation, the Customer App (31/31 states implemented and verified by screenshot), Phone OTP authentication against the live `banhao-dev` Supabase project, `profiles` with RLS (14/14 live checks passing), and the five QA defects (DEF-01…DEF-05) fixed and re-verified. `git push origin main` succeeded (`01d6cf75..c4927b25`).

**No new code was written for this event** — it is the merge itself, plus the documentation update it requires. `CLAUDE.md`, `ai/HANDOFF.md`, `ai/MEMORY.md`, and `docs/CURRENT_STATUS.md` were updated to stop describing the two feature branches as unmerged and pending review.

`feature/customer-app` and `feature/supabase-customer-auth` remain on the remote (not deleted) but are now fully contained in `main`; any future work should branch from `main`.

**Scope did not change.** No payment provider, no order backend, no dispatch, no settlement, and no Merchant/Driver/Admin app work was started as part of this merge — those all remain gated on the P0 product decisions in `docs/TODO.md`.

---

## EVENT-013

```yaml
id: EVENT-013
type: EVENT
date: 2026-08-10
source: this session; branch feature/business-rules
confidence: HIGH
```

**Business Rules & Domain Modelling.** The business layer of BANHAO was
analysed, structured and written down before any Order, Payment, Merchant,
Rider or Settlement code exists. **No production code, no migration, no API and
no payment provider integration was created** — the diff is documentation and AI
knowledge only.

Seven documents produced: `docs/BUSINESS_RULES.md`, `docs/DOMAIN_MODEL.md`,
`docs/ORDER_LIFECYCLE.md`, `docs/RIDER_LIFECYCLE.md`,
`docs/PAYMENT_LIFECYCLE.md`, `docs/SETTLEMENT_MODEL.md`, and
`docs/OPEN_BUSINESS_QUESTIONS.md`. Every rule in them carries a status —
`DOCUMENTED` (traceable to an accepted source), `PROPOSED` (this pass's
suggestion, unapproved) or `OPEN` — so a later agent can tell product truth from
analysis. **No `PROPOSED` item was promoted to `ACCEPTED`, and no `Q-NNN` was
resolved.**

**39 new business questions (BQ-001…BQ-039)** were recorded, cross-referencing
the twenty pre-existing `Q-NNN` items rather than duplicating them. Fifteen are
P0 — they block Order, Payment or Settlement implementation outright.

Six findings changed the project's understanding of its own design. Each is a
contradiction or omission **inside accepted documents**, not an opinion:

1. **`PENDING_PAYMENT` is referenced but does not exist.** The Payment State
   Machine pairs five payment states with an Order state named
   `PENDING_PAYMENT`; the Order State Machine's twelve states do not include it.
   An order awaiting a PromptPay transfer is therefore in no nameable state,
   which REQ-002 does not allow (BQ-012).
2. **`NO_DRIVER` contradicts the Customer App.** The state machine documents
   `READY → NO_DRIVER` — the food is cooked — while the app's no-rider screen
   tells the customer *"อาหารของคุณยังไม่ถูกปรุง"*, their food has not been
   cooked. Both cannot be true, and the answer decides who absorbs the cost of
   wasted food (BQ-014, BQ-015).
3. **The cash design requires riders to front their own money.** Two independent
   statements — the cash ledger line `ร้านได้รับเงินสดหน้าร้านแล้ว −฿108` and the
   merchant-finance note that cash orders skip transfer rounds "because the shop
   already received the money from the rider at the counter" — mean the rider
   pays the merchant at pickup, before collecting from the customer. On a ฿130
   order the rider fronts ฿108 to earn ฿12. With a pool of 8–12 riders this is a
   recruitment barrier, and it was never called out (BQ-023).
4. **The commission rate the design implies is 10% of the food subtotal.**
   Q-010 records that no rate is documented; in fact the samples are internally
   consistent at 10% (120→12, 180→18, 260→26) and the merchant screen states
   `10% ของยอดอาหาร` outright. Still a sample, not a decision — but a coherent
   anchor Q-010 did not have.
5. **The platform funds discounts, and delivery runs at a loss.** Working the
   design's own ledger: the merchant is paid commission on the full undiscounted
   menu price, so the platform absorbs the ฿10 coupon; and ฿10 of net delivery
   revenue pays a ฿12 rider earning, with commission covering the gap. Neither
   is stated anywhere (BQ-030, BQ-026, BQ-029).
6. **The rider accept window is contradictory.** Wireframe `D-05` is titled
   `นับถอยหลัง 20 วิ` while its button reads `รับงาน · 12 วิ`.
   `ai/RESEARCH/THAILAND_COMPLIANCE.md` §5 cites "the documented 12-second accept
   window" — it read the button state. 12 s should not be treated as established
   (BQ-020).

Also recorded: **riders pay a platform fee** (`ค่าธรรมเนียมแพลตฟอร์ม −฿38` in
`D-13`), which appears nowhere else in the repository; and the Customer App's
refund copy promises money back *"เข้าบัญชีเดิม … ภายใน 1–3 วันทำการ"*, which
Q-020 found is not natively possible on the PromptPay rail — a promise without a
mechanism.

**Three dispatch models were compared** (first-available, zone-based, broadcast)
plus manual dispatch, against complexity, cost, fairness, speed, Buntharik fit
and scalability. The recommendation is **broadcast / first-accept with admin
manual dispatch as an always-available override**, on the grounds that 8–12
riders is one pool and speed is the only lever that moves the documented ≤5%
no-rider cancellation ceiling. **The Product Owner decides — BQ-019 is `OPEN`.**
The no-rider scenario was analysed across seven options and answered with a
time-based ladder rather than a single choice (BQ-025).

**DQ-01…DQ-05 were all addressed.** DQ-01 (cash path) and DQ-02 (duplicate-payment
trigger) turned out to be **answerable from documents that already exist** — the
payment canvas specifies both — and are recommended for closure rather than
decision. DQ-03 is blocked on Q-020 and BQ-031; DQ-04 is superseded by BQ-001
and BQ-002; DQ-05 by BQ-039.

`docs/TODO.md` was reconciled: its P0 entries for "decide backend stack" and
"decide database technology" had been stale since 2026-08-09, when DEC-011 and
DEC-010 resolved them.

**Nothing was implemented and nothing was decided.** The next step is Product
Owner review of `docs/OPEN_BUSINESS_QUESTIONS.md`, starting with the fifteen P0
items.
