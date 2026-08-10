# CLAUDE.md — BANHAO project state

Orientation file for AI agents. Written 2026-08-10, updated 2026-08-10 after merge.

**Read these first, in order:** [`ai/HANDOFF.md`](ai/HANDOFF.md) →
[`ai/MEMORY.md`](ai/MEMORY.md) → [`docs/AI_CONTEXT.md`](docs/AI_CONTEXT.md) →
[`ai/DEVELOPMENT_RULES.md`](ai/DEVELOPMENT_RULES.md). This file summarises; those
are authoritative.

---

## 1. Project purpose

**BANHAO | บ้านเฮา** — a Local Super App for **อำเภอบุณฑริก จังหวัดอุบลราชธานี,
Thailand**. Phase 1 is **Food Delivery**. Later phases: Parcel Delivery → Ride →
Shopping. Three-sided marketplace: Customer → BANHAO → Merchant + Driver.

Built by a solo founder using AI as the development team, so: keep architecture
simple, avoid unnecessary abstraction, and make every change reviewable in Git.

## 2. Tech stack (all ACCEPTED decisions — do not change unilaterally)

| Layer | Choice | Decision |
|---|---|---|
| Architecture | Modular monolith (**no microservices**) | DEC-009 |
| Database/platform | Supabase — PostgreSQL + PostGIS + Auth + Storage + Realtime | DEC-010 |
| Backend | NestJS + TypeScript, REST + OpenAPI | DEC-011 |
| Mobile | React Native + Expo (customer, merchant, driver) | DEC-012 |
| Admin | Next.js | DEC-012 |
| Monorepo | pnpm workspaces + Turborepo | DEC-013 |
| Financial truth | PostgreSQL is the system of record | DEC-014 |
| Payments | Abstraction only — **no provider selected** | DEC-015 |

Fonts: **IBM Plex Sans Thai** 400/500/600/700, bundled via
`@expo-google-fonts/ibm-plex-sans-thai` (no runtime fetch).

## 3. Current branch

```
feature/business-rules   ← YOU ARE HERE — branched from main @ 9a60277e
                            documentation only, awaiting Product Owner review
main @ 9a60277e             feature/supabase-customer-auth merged, PUSHED
```

`feature/supabase-customer-auth` (which already contained everything from
`feature/customer-app`) was reviewed by the Product Owner and merged into `main`
on 2026-08-10 via `git merge --no-ff`. The full quality gate (lint, typecheck,
test, build) was re-run on `main` after the merge and passed. **Both feature
branches still exist remotely but are now fully contained in `main` — new work
should branch from `main`, not from either of them.**

## 4. Completed work

| Event | What |
|---|---|
| EVENT-001…003 | Design drop, repo reorganisation, AI Memory v1 |
| EVENT-004 | AI Memory v2 — typed knowledge base (`ai/KNOWLEDGE/`) |
| EVENT-005 | Architecture research — 28 docs in `ai/RESEARCH/`, all sourced |
| EVENT-006 | Application foundation — monorepo, NestJS API, migrations, CI |
| EVENT-007 | Pre-merge RLS hardening, verified by execution |
| EVENT-008 | Customer App — all 31 design states implemented |
| EVENT-009 | Typography fix (IBM Plex Sans Thai bundled) + visual QA |
| EVENT-010 | Supabase dev project + live customer auth verification |
| EVENT-011 | DEF-01…DEF-05 fixed, re-verified; visual QA 31/31 |
| EVENT-012 | Reviewed and merged to `main` |
| **EVENT-013** | **Business Rules & Domain Model — 7 documents, 39 open business questions, no code** (this update) |

## 5. Current implementation status

| Area | Status |
|---|---|
| Customer App UI | **DONE** — 31/31 states (18 numbered + 7 payment sub-states + 6 variants) |
| Customer navigation | DONE — 4 tabs per design + auth stack |
| Design tokens & components | DONE — `packages/ui` |
| Supabase Auth (Phone OTP) | **Configured live**; app-side flow written |
| `profiles` + RLS | **DONE and live-verified** |
| Mock repositories | DONE — everything except auth/profiles is mock-backed |
| NestJS API | Foundation only — `/health`, `/api/v1/me` |
| Merchant / Driver / Admin apps | **Not started** (shells only) |
| Orders, payments, dispatch, settlement | **Not started — deliberately** |

**No business logic exists.** No order creation, payment integration, dispatch,
or settlement. That is intentional, not an omission.

**The business rules are now written down but not approved** (EVENT-013).
`docs/BUSINESS_RULES.md`, `DOMAIN_MODEL.md`, `ORDER_LIFECYCLE.md`,
`RIDER_LIFECYCLE.md`, `PAYMENT_LIFECYCLE.md`, `SETTLEMENT_MODEL.md` and
`OPEN_BUSINESS_QUESTIONS.md` tag every rule `DOCUMENTED` (accepted product
truth), `PROPOSED` (unapproved analysis) or `OPEN`. **Build only on
`DOCUMENTED`.** 39 business questions (BQ-001…BQ-039) are open, 15 of them P0.

**All 31 Customer states are verified by screenshot** and all five defects
found in review (DEF-01…DEF-05) are fixed and re-verified on device — see
§8 and `docs/CUSTOMER_APP_VISUAL_QA.md`.

## 6. Key files

```
apps/customer/
  App.tsx                     font loading gate + providers
  src/navigation/             RootNavigator (session-driven tree), types
  src/screens/                31 states; payment.tsx holds 12–12h
  src/hooks/                  useAuth (Supabase), useCart, useAsyncData
  src/lib/supabase.ts         anon-key client — NEVER add the service role key
  src/repositories/index.ts   swap point: mock → real API
  src/mocks/                  design-derived data + pricing (SAMPLE values)
  .env                        LOCAL ONLY, gitignored, never commit

packages/
  ui/src/theme/tokens.ts      design tokens; fontFamily per weight
  ui/src/components/          Button, primitives, domain components
  types/ validation/ config/ api-client/

apps/api/src/                 NestJS: guards, modules, PaymentProvider abstraction
supabase/migrations/          3 migrations (extensions, profiles+roles, RLS hardening)
supabase/tests/               rls_profiles_test.sql (pg shim) + live-rls-check.mjs (LIVE)

docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md   design audit, DQ-01…05
docs/CUSTOMER_APP_VISUAL_QA.md            what is and is not verified
docs/CUSTOMER_APP_ASSETS.md               fonts, placeholders

docs/BUSINESS_RULES.md            master business rules, status-tagged
docs/DOMAIN_MODEL.md              PROPOSED entities, aggregates, ER diagrams
docs/ORDER_LIFECYCLE.md           order states, timeouts, cancellation matrix
docs/RIDER_LIFECYCLE.md           dispatch models, no-rider ladder, cash
docs/PAYMENT_LIFECYCLE.md         payment/refund states, idempotency, PromptPay
docs/SETTLEMENT_MODEL.md          ledger accounts, worked examples, payouts
docs/OPEN_BUSINESS_QUESTIONS.md   BQ-001…BQ-039 — read before any domain work
```

## 7. Database / Supabase status

**Development project — created 2026-08-09, this session.**

| Item | Value |
|---|---|
| Name | `banhao-dev` |
| Ref | `yssnwnboiwldogmlvvlw` |
| Region | `ap-southeast-1` (Singapore) — closest available to Thailand |
| Org | `kmandev's Org` (also holds an unrelated `videoup` project) |
| Migrations | All 3 applied live |
| Auth | Phone provider **enabled**; **Test OTP** configured (no SMS provider) |
| Test numbers | `+66812345678` → `123456`, `+66899999999` → `654321` |

Credentials live in `apps/customer/.env` (gitignored). **No secret is in Git.**
The DB password is not stored in the repo at all.

**LIVE RLS verification — 14/14 PASSED** (`supabase/tests/live-rls-check.mjs`,
run against the real project via real Auth sessions, not the pg shim):

- Profile row auto-created by trigger; `profiles.id` = `auth.users.id`
- Role defaults to `CUSTOMER`
- Customer cannot read another customer's profile (unfiltered select → 1 row)
- Role escalation, phone change, id change, insert, delete → all rejected (42501)
- `display_name` update → allowed
- Signed-out client reads nothing

## 8. Last completed task (EVENT-011, done) — merged to main

Connect the Customer App to the real Supabase dev project, QA it honestly, fix
everything review found, and merge. **All complete.**

Verified live against `banhao-dev`: request OTP → wrong OTP rejected by the
server → correct OTP → profile read under RLS → `display_name` write
(`204 PATCH`) → session survives a full app restart → logout → logout persists
across another restart. **No fake session was created.**

Visual QA: **31/31 states verified by screenshot** (artifacts in
`docs/qa/customer-app/`). Money arithmetic checked, not assumed.

**Five defects found in review — all fixed and re-verified on device**
(`docs/CUSTOMER_APP_VISUAL_QA.md`):

| ID | Severity | Finding | Fix |
|---|---|---|---|
| DEF-01 | **MAJOR** | `PayExpired` (12e) unreachable — QR counted to zero and navigated nowhere | `replace()`s to `PayExpired` at TTL 0; verified by letting the real 600s countdown elapse, not a shortened timer |
| DEF-02 | MINOR | `ขอรหัสใหม่` reset the countdown but never resent the OTP | now calls `requestOtp`; countdown only resets on success |
| DEF-03 | MINOR | Back labels read "Tabs" / "Back" in English | explicit `headerBackTitle: 'กลับ'` |
| DEF-04 | MINOR | `✓` (U+2713) substituted to a glyph reading as `√` | check mark is now drawn, not typed — no font dependency |
| DEF-05 | MINOR | Profile phone shown unformatted, without `+` | `formatThaiPhone` — presentation only, stored E.164 identity untouched |

22 tests added for the fixes. Full quality gate (lint/typecheck/test/build) was
re-run and passed both before and after the merge to `main`.

### ⚠️ iOS Simulator cannot hold HTTP/3 to Supabase

First HTTPS request succeeds, then every one after it fails with
`Network request failed`. The response advertises `alt-svc: h3`, CFNetwork
switches to QUIC and the connection dies (`-1005`). Survives app restart and
Simulator reboot. Use `scripts/sim-supabase-proxy.mjs` for Simulator QA — it
forwards verbatim to the real project and mocks nothing. Full evidence in
`docs/SUPABASE_DEVELOPMENT.md`. Untested on hardware and on Android.

Also note: `EXPO_PUBLIC_*` is inlined at transform time. After editing
`apps/customer/.env` you must restart Metro with `--clear` **and**
terminate/relaunch Expo Go — reloading is not enough.

## 9. Next steps

0. **Review the 15 P0 items in `docs/OPEN_BUSINESS_QUESTIONS.md`.** They block
   Order, Payment and Settlement outright. Two of them are contradictions
   between accepted documents (BQ-012, BQ-014) and cannot be resolved by an
   agent.
1. Close DQ-01…DQ-05 — all five are addressed by EVENT-013; see the DQ table in
   `docs/OPEN_BUSINESS_QUESTIONS.md`.
2. Verify on an Android emulator — per-weight font families are untested there.
3. Verify the search **results** list and keyboard avoidance on a device that
   can type Thai (the Simulator cannot).
4. Commission the Thai legal/compliance review (Q-002, Q-012, Q-015, Q-017) —
   external lead time, gates all payment work.
5. Decide the P0 product questions blocking payment work (§10): Q-001, Q-002,
   Q-010, Q-020.

Merchant, Driver, and Admin apps, payment integration, order backend, dispatch,
and settlement remain **out of scope** until those product decisions land — see
the scope lock below. **Any of that work is a new decision, not a continuation
of this merge — check in before starting it.**

## 10. Decisions and constraints

**Non-negotiable (from `AGENTS.md` / `ai/KNOWLEDGE/CONSTRAINTS.md`):**

- **CON-001** Order State and Payment State are separate machines — never merged.
- **CON-002** Only a signature-verified provider webhook may confirm a payment.
  A client screen must never decide a payment succeeded.
- **CON-003** Every order's ledger balances to exactly zero. Money is **integer
  satang** — never floating point.
- **CON-005** No secrets in Git. `SUPABASE_SERVICE_ROLE_KEY` must never appear
  in any mobile or browser bundle.
- Payment provider SDKs may only be imported under `payments/providers/`.

**Working rules:**

- The **design artifact is the source of truth** for Customer App UI:
  `design/customer/BANHAO Customer App.dc.html`. Do not re-design; record a
  `DESIGN_QUESTION` instead of guessing.
- **Never fabricate a session** to make authenticated screens reachable.
- Never mark a screen `MATCH` without a screenshot. `UNVERIFIED` is an
  acceptable answer; a false `MATCH` is not.
- Mock data belongs in `src/mocks/` behind a repository — never inside a UI
  component.
- Every text style needs an explicit `fontFamily` — `fontSize` alone silently
  falls back to the system face.
- Do not add a text style, dependency, or migration without a stated reason.
- **Implement only rules tagged `DOCUMENTED`.** `PROPOSED` is analysis awaiting
  approval; `OPEN` means it is undecided and guessing is forbidden.
- Sample figures are not rules: 10% commission, ฿15 delivery, ฿5 service and the
  ฿10 `BANHAO7` coupon are all illustrative.

**Open questions blocking real work:** Q-001 payment provider, Q-002 legal
settlement model, Q-010 platform fee, Q-020 PromptPay refund mechanism (no
provider supports native PromptPay refunds — see `ai/RESEARCH/PAYMENT_RESEARCH.md`).

**Known gaps:** Android is **UNVERIFIED** (no SDK on this machine, and it is the
platform most likely to differ on per-weight fonts). A physical iOS device, real
SMS delivery, keyboard avoidance, the search **results** list, and four state
variants (empty cart, loading, network error, no driver) are also unverified —
see `docs/CUSTOMER_APP_VISUAL_QA.md`. All 31 states themselves are verified.

**Scope lock:** do not start Merchant, Driver, or Admin apps, payment
integration, order backend, dispatch, or settlement.
