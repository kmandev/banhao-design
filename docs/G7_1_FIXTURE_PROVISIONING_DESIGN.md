# BANHAO — G-7.1 Live Fixture Provisioning Design

Written 2026-08-26. **DESIGN ONLY — nothing in this document has been executed.**
No code, migration, or live row was created, modified, or deleted in producing it.

Scope: define the exact fixture set, provisioning mechanism, verification queries,
cleanup policy and readiness gates required before G-7.1 (Driver Offer Inbox) live
acceptance may begin. It is not authorisation to provision anything.

---

## 1. Repository facts this design is built on (verified, not assumed)

Every claim below was read out of the repository during this pass.

| # | Fact | Source |
|---|---|---|
| F1 | `riders.status` ∈ `REGISTERED, DOCUMENTS_SUBMITTED, PENDING_APPROVAL, APPROVED, DOCUMENTS_REJECTED, SUSPENDED, DEACTIVATED` | `supabase/migrations/20260811000008_rider_domain.sql` |
| F2 | **`riders` rows can never be deleted by anyone** — `riders_reject_delete` is a `BEFORE DELETE` trigger, which fires for the table owner and `service_role` alike | same file |
| F3 | `riders.user_id` is `NOT NULL`, FK → `profiles(id)` `ON DELETE RESTRICT`, and `UNIQUE` — one rider row per profile, and the profile cannot be removed while it exists | same file |
| F4 | `rider_availability.rider_id` is the PK and FK → `riders(id)` `ON DELETE CASCADE`; `location` is a **generated** column from `last_lat`/`last_lng` (never inserted); `active_delivery_count >= 0`; **no delete protection** | same file |
| F5 | `deliveries` has `deliveries_reject_delete` — **never hard-deleted**; `deliveries.order_id` is `UNIQUE`; `rider_id` FK `ON DELETE RESTRICT` | `20260811000009_delivery_domain.sql` |
| F6 | `rider_assignments` has `rider_assignments_reject_delete` (**never deleted**) plus the partial unique index `rider_assignments_one_active` (one `ACCEPTED` row per delivery) | same file |
| F7 | `rider_assignment_attempts` has **no delete trigger** and cascades from `deliveries`/`riders` — it is the *only* G-7.1 row type that may be deleted, and only with privileged access (`revoke all … from anon, authenticated`) | same file |
| F8 | `rider_assignment_attempts` unique key: `(delivery_id, rider_id, round_no)`; `outcome` ∈ `PENDING, ACCEPTED, DECLINED, EXPIRED, SUPERSEDED`; `round_no > 0`; `expires_at` nullable | same file |
| F9 | `orders` cannot be deleted and its money/snapshot columns are immutable **even for `service_role`** (`orders_enforce_immutable_columns`); `grand_total = subtotal + delivery_fee + service_fee − discount` is a CHECK; `order_number` is UNIQUE; `payment_method` ∈ `ONLINE, CASH` | `20260811000005_order_domain.sql` |
| F10 | `delivery_status_history` and `order_status_history` are append-only (`reject_mutation`) | `20260811000009`, `20260811000005` |
| F11 | The rider's inbox read is a **direct Supabase select under RLS** on `rider_assignment_attempts`, policy `rider_assignment_attempts_select_own` → `is_assigned_rider(rider_id)` → `riders.user_id = auth.uid()`. **The policy does not check `riders.status`** | `20260811000011_rls_policies.sql`, `apps/driver/src/data/riderOfferQueries.ts` |
| F12 | The client query filters `outcome = 'PENDING'` **only** — it does **not** filter `expires_at`. A past-`expires_at` row with `outcome = 'PENDING'` still renders in the inbox | `riderOfferQueries.ts` |
| F13 | Approval gating for the inbox **entry point** is client-side in `HomeScreen`: a non-`APPROVED` rider gets `StatusScreen`, which has no "งานที่เสนอ" button and no availability toggle | `apps/driver/src/screens/HomeScreen.tsx` |
| F14 | Approval gating for the **write** path is server-side: `CapabilitiesService.resolveRider` matches `status = 'APPROVED'` only, `RolesGuard` throws `ForbiddenException`, and the filter maps 403 → code `FORBIDDEN` | `capabilities.service.ts`, `roles.guard.ts`, `http-exception.filter.ts` |
| F15 | Accept is two guarded CAS writes: `rider_availability.active_delivery_count 0→1`, then `deliveries state ∈ (RIDER_SEARCHING, RIDER_REASSIGNING) AND rider_id IS NULL → RIDER_ASSIGNED`. Loser gets `OFFER_TAKEN`, busy rider gets `RIDER_HAS_ACTIVE_DELIVERY` | `offer-acceptance.service.ts` |
| F16 | `assertOfferIsAcceptable`: `outcome = EXPIRED` → `OFFER_EXPIRED`; `DECLINED`/`SUPERSEDED` → `OFFER_TAKEN`; `expires_at IS NULL` **or** in the past → `OFFER_EXPIRED`. Foreign or missing offer id → `NOT_FOUND` (indistinguishable, deliberately) | same file |
| F17 | Dispatch eligibility (DEC-037): `riders.status = 'APPROVED'` **and** `rider_availability.is_online = true` **and** `location IS NOT NULL`. No radius, no distance | `broadcast-dispatch.strategy.ts`, `dispatch-policy.ts` |
| F18 | `offerExpiryFor` = `offered_at + 60 s`; `roundNumberFor` is derived from `deliveries.created_at` and the clock | `dispatch-policy.ts` |
| F19 | The repository's **existing convention for privileged live data creation** is a reviewed, idempotent, id-namespaced, non-destructive SQL file under `supabase/seed-dev/`, executed by a human, never wired into CI | `supabase/seed-dev/catalog_dev_seed.sql` |
| F20 | The repository's convention for **live verification** is a read-only Node script using the **anon key and real Auth sessions** (`supabase/tests/live-rls-check.mjs`) — no service role, no fabricated session | that file |
| F21 | Test OTP numbers already configured on `banhao-dev`: `+66812345678 → 123456`, `+66899999999 → 654321` (customer-app fixtures) | `CLAUDE.md` §7, `live-rls-check.mjs` |
| F22 | Dev catalog seed already provides a merchant, three restaurants and menus under the reserved `dede0000-…` id prefix; restaurant `…c001` is `ACTIVE` with full-week hours | `catalog_dev_seed.sql` |
| F23 | `create_order()` and `release_rider_assignment()` are `service_role`-EXECUTE-only; `order_number` produced by `create_order` is `BH-YYYYMMDD-NNNN` from `order_number_counters` | `20260819000001`, `20260811000013` |
| F24 | At time of this design's original inspection, there was no G-7 fixture recorded anywhere in the repository (`grep -ril "fixture"` over `docs/`, `ai/`, `scripts/` returned only unrelated prose). **Resolved 2026-08-26 — the identity is now recorded at §7.0.** | repository-wide search; §7.0 |

### Consequences that drive the whole design

1. **Nothing rider-shaped is disposable.** F2/F5/F6/F9 mean riders, deliveries,
   orders and assignments are permanent once written. Only
   `rider_assignment_attempts` (F7) and *column values* on
   `rider_availability`/`deliveries` are reversible.
2. **Test B is a client-gating test, not an RLS test** (F11 vs F13). RLS does not
   hide offers from a non-approved rider; the app never shows them the entry, and
   the API refuses their writes (F14). The fixture must therefore support
   *both* halves — the missing entry point (B) and the 403 (L).
3. **`OFFER_EXPIRED` is provisionable without waiting** (F12/F16): a `PENDING`
   row with a past `expires_at` renders in the inbox and fails accept/decline
   with `OFFER_EXPIRED`.

---

## 2. Test B resolution — DESIGN DECISION

**Recommendation: Approach A — a third *permanent* fixture rider with a
non-approved status (`PENDING_APPROVAL`).**

### Why the alternatives fail on this schema

| Option | Verdict | Reason (evidence) |
|---|---|---|
| **B — flip Rider B to a non-approved status and restore it** | **Rejected** | Directly violates "avoid modifying reusable APPROVED rider state". Worse, it is *not* cleanly reversible in practice: an interrupted run leaves the shared Rider B non-`APPROVED`, silently breaking tests A/C/E/F/H/R which depend on it, and `riders.updated_at`/audit shows an approval flip that never happened operationally. It also cannot run concurrently with any other test using Rider B. |
| **C — a "disposable" third rider** | **Rejected as impossible** | There is no such thing as a disposable rider on this schema. `riders_reject_delete` (F2) refuses `DELETE` for every role including the owner, and the profile behind it is `ON DELETE RESTRICT` (F3). "Disposing" of it would require deleting the Auth user — a destructive Auth operation this design explicitly forbids. Option C therefore *degenerates into Option A* with worse naming and no cleanup story. |
| **A — third permanent rider, `PENDING_APPROVAL`** | **CHOSEN** | It is the only option that is honest about F2. |

### Why A is safe despite being permanent

- **Zero operational pollution.** A non-`APPROVED` rider is invisible to dispatch
  by construction (F17: `BroadcastDispatchStrategy` matches `status = 'APPROVED'`
  and intersects with online riders). It will never be offered work, never enter
  a candidate pool, never appear in any round.
- **Zero authorisation surface.** `CapabilitiesService` grants it no rider
  capability at all (F14), so every rider API route refuses it with `FORBIDDEN`.
- **No `rider_availability` row is created for it**, so it cannot even satisfy the
  online half of eligibility, and there is nothing to reset.
- **Auditability is preserved**: a rider that was *never* approved has a coherent
  history (`approved_at IS NULL`, `approved_by IS NULL`), unlike a rider whose
  status was flipped twice for a test.
- **Status choice `PENDING_APPROVAL`**, not `SUSPENDED`/`DEACTIVATED`: it is a
  natural pre-approval state, it is one of the three `StatusScreen` maps to the
  "waiting" variant (DQ-G7-01 Option A), and it carries no punitive history
  implication. It is also *never* promoted to `APPROVED` — see §6 cleanup policy.

**Consequence to accept explicitly:** the permanent fixture set grows from two
riders to three, and the third can never be removed. That is a property of the
schema (F2), not of this choice.

---

## 3. G-7.1 fixture specification

### 3.0 Naming and id namespace

All G-7.1 fixture rows use the reserved id prefix **`67100000-…`** ("G7.1"),
distinct from `dede0000-…` (dev catalog seed), `a9/b9/d9/e9/f9/99000000-…`
(order-creation tests) and every other block in use. Human-readable fields carry
the literal marker **`(g71 fixture)`**. Order numbers use the prefix
**`G71-`**, which cannot collide with `create_order`'s `BH-YYYYMMDD-NNNN` (F23).

Auth accounts use three **new** Supabase Test OTP phone numbers, distinct from
the two customer-app numbers in F21.

| Fixture | Id / key | Kind |
|---|---|---|
| RIDER_A | `67100000-0000-4000-8000-0000000000a1` | reusable |
| RIDER_B | `67100000-0000-4000-8000-0000000000a2` | reusable |
| NON_APPROVED_RIDER | `67100000-0000-4000-8000-0000000000a3` | reusable, permanent |
| CUSTOMER | `67100000-0000-4000-8000-0000000000c1` | reusable |
| RESTAURANT | `dede0000-0000-4000-8000-00000000c001` (existing) | reused, not created |
| DISPOSABLE_ORDER | `67100000-0000-4000-8000-0000000001xx` | permanent-once-written |
| DISPOSABLE_DELIVERY | `67100000-0000-4000-8000-0000000002xx` | permanent-once-written, resettable by column |
| DISPOSABLE_OFFER | `67100000-0000-4000-8000-0000000003xx` | truly disposable |

### 3.1 RIDER_A — the primary approved rider

| | |
|---|---|
| **Reusable / disposable** | **Reusable.** Permanent (F2). |
| **Required state** | Auth account (real, Test OTP phone `+66811110001`); `profiles` row (auto-created by `on_auth_user_created`); `riders`: `status = 'APPROVED'`, `approved_at = now()`, `full_name = 'ไรเดอร์ทดสอบ A (g71 fixture)'`; `rider_availability`: `is_online = true`, `last_lat = 14.780000`, `last_lng = 105.230000` (Buntharik district), `location_updated_at = now()`, `active_delivery_count = 0`, `blocked_reason IS NULL` |
| **Dependencies** | An Auth user must exist **before** the SQL runs — created by signing in once through the Driver App, never by a raw `auth.users` insert (see §5.1). |
| **How consumed** | Signs in on Driver device 1. Subject of tests A, C, D, E, F, I, J, K, M, N, P, Q; the *winner* in H; the *observer* in R. |
| **Can it be reset?** | **Yes, by UPDATE only.** `rider_availability.active_delivery_count → 0`, `is_online → true` are the reset. The `riders` row itself is never reset — it stays `APPROVED` forever. |
| **Immutable history?** | The `riders` row is permanent (undeletable); its `status` is intentionally never changed after provisioning. |

### 3.2 RIDER_B — the second approved rider

| | |
|---|---|
| **Reusable / disposable** | **Reusable.** Permanent (F2). |
| **Required state** | Identical shape to RIDER_A, distinct Auth account (`+66811110002`), `full_name = 'ไรเดอร์ทดสอบ B (g71 fixture)'`, own `rider_availability` row, `active_delivery_count = 0`. |
| **Dependencies** | Own Auth account and its own device/session — **must be a genuinely separate session**, not a re-login on the same device, or tests H and R prove nothing. |
| **How consumed** | The competing rider in H (`OFFER_TAKEN`) and the foreign rider in R (RLS isolation). Also the second party in L if L is run against a *foreign* offer id. |
| **Can it be reset?** | Yes, by UPDATE, same as RIDER_A. |
| **Immutable history?** | Same as RIDER_A. |

### 3.3 NON_APPROVED_RIDER — Test B / Test L

| | |
|---|---|
| **Reusable / disposable** | **Reusable, permanent, and non-removable by design** (Approach A, §2). |
| **Required state** | Auth account (`+66811110003`); `profiles` row; `riders`: `status = 'PENDING_APPROVAL'`, `approved_at IS NULL`, `approved_by IS NULL`, `full_name = 'ไรเดอร์รออนุมัติ C (g71 fixture)'`. **No `rider_availability` row at all.** |
| **Dependencies** | Own Auth account. Nothing else — no order, delivery or offer is needed for Test B. |
| **How consumed** | Test B (Driver App shows `StatusScreen`, no offer entry point, no toggle). Test L (a direct `POST /api/v1/rider/offers/:id/accept` with this session must return **403 `FORBIDDEN`**, refused by `RolesGuard` before any offer lookup — F14). |
| **Can it be reset?** | Nothing to reset: it has no mutable operational state. |
| **Immutable history?** | Permanent row. **Its status must never be promoted to `APPROVED`** — doing so silently converts it into a dispatch-eligible rider and destroys the fixture. |

### 3.4 CUSTOMER — the order-bearing customer

| | |
|---|---|
| **Reusable / disposable** | **Reusable.** The `profiles` row is permanent. |
| **Required state** | Auth account (`+66811110009`, Test OTP, or a raw `auth.users` insert if it never needs to sign in); `profiles.display_name = 'ลูกค้าทดสอบ G7.1 (g71 fixture)'`. |
| **Dependencies** | None. Never signs in during G-7.1 acceptance — it exists only as the FK anchor for `orders.customer_id` (`NOT NULL`, F9). |
| **How consumed** | Referenced by every DISPOSABLE_ORDER. Its name and phone are what land in the order's `recipient_*` snapshots and therefore in `rider_order_view` after an accept. |
| **Can it be reset?** | No reset needed. |
| **Immutable history?** | Profile is permanent; the snapshots taken from it are immutable (F9). |

Because this account never signs in, it **may** be created by a raw
`auth.users` insert in the same style as `catalog_dev_seed.sql`'s synthetic
merchant owner. Preferred: give it a Test OTP number anyway, so it is uniform
with the riders and can be used later without re-provisioning.

### 3.5 RESTAURANT — reused, never invented

| | |
|---|---|
| **Reusable / disposable** | **Reusable, and NOT created by G-7.1 provisioning.** |
| **Required state** | The existing dev catalog restaurant `dede0000-…c001` (`ACTIVE`, full-week `09:00–20:00` hours, lat/lng set) — F22. |
| **Dependencies** | `catalog_dev_seed.sql` already applied to the target project. Verify, do not re-run blindly (it is idempotent, but re-running is still an unnecessary write). |
| **How consumed** | `orders.restaurant_id` and `restaurant_name_snapshot`; supplies the pickup point for `deliveries.pickup_lat/lng`. |
| **Can it be reset?** | Not touched at all, so nothing to reset. |
| **Immutable history?** | Out of scope — G-7.1 provisioning must contain **no** write to `merchants`, `restaurants`, `menu_*`. |

### 3.6 DISPOSABLE_ORDER

| | |
|---|---|
| **Reusable / disposable** | **"Disposable" by intent, permanent in fact.** `orders` can never be deleted (F9). One fresh order per scenario; consumed orders are abandoned, never reused. |
| **Required state** | `state = 'MERCHANT_ACCEPTED'` (the state at which a delivery legitimately exists and is dispatchable); `customer_id = CUSTOMER`; `restaurant_id = dede…c001`; `payment_method = 'ONLINE'` (DEC-016 — `CASH` must never appear); money columns satisfying `grand_total = subtotal + delivery + service − discount` with **DEC-035/036 approved amounts**: `delivery_fee_satang = 1000`, `service_fee_satang = 500`; snapshots non-null; `order_number = 'G71-<scenario>-<nn>'`. |
| **Dependencies** | CUSTOMER, RESTAURANT. |
| **How consumed** | One per accept/decline/OFFER_TAKEN/OFFER_EXPIRED/NOT_FOUND/busy scenario. |
| **Can it be reset?** | **No.** Money and snapshots are immutable even for `service_role`; only `state`, milestone timestamps and `cause_code` may change, and G-7.1 changes **no** order state (DEC-018 — accepting an offer moves no order). |
| **Immutable history?** | **Yes. Treat as append-only domain history.** |

⚠️ Do **not** copy `apps/customer/src/mocks/pricing.ts`'s `SAMPLE_DELIVERY_FEE_SATANG = 1500`
into a fixture — it is not the approved amount (CLAUDE.md §10).

### 3.7 DISPOSABLE_DELIVERY

| | |
|---|---|
| **Reusable / disposable** | **Disposable by intent, permanent in fact** (`deliveries_reject_delete`, F5), but **resettable by column**. |
| **Required state (pre-test)** | `order_id` = its own DISPOSABLE_ORDER (UNIQUE, so one delivery per order); `state = 'RIDER_SEARCHING'`; `rider_id IS NULL`; `assigned_at IS NULL`; `reassignment_count = 0`; `rider_earning_satang IS NULL` (**BQ-029 is OPEN — never invent a value**); pickup lat/lng from the restaurant, dropoff lat/lng from the order. |
| **Dependencies** | DISPOSABLE_ORDER. |
| **How consumed** | The object of the guarded claim in F/H; left untouched in G (decline writes no delivery row); the accept target in I/K. |
| **Can it be reset?** | **Yes — deliberately and narrowly**, by `UPDATE … SET state = 'RIDER_SEARCHING', rider_id = NULL, assigned_at = NULL` **only when paired** with closing any `rider_assignments` row (`status = 'ACCEPTED' → 'RELEASED'`) in the **same transaction**. Omitting either half makes the delivery permanently unassignable (Layer 3, `20260811000009` header). ✅ Preferred alternative: **do not reset — provision a fresh delivery instead.** |
| **Immutable history?** | The row is undeletable; its state column is mutable. `delivery_status_history` rows, if any, are append-only and must never be written by provisioning. |

### 3.8 DISPOSABLE_OFFER

| | |
|---|---|
| **Reusable / disposable** | **Genuinely disposable — the only fixture that is.** `rider_assignment_attempts` has no delete trigger (F7). |
| **Required state** | `delivery_id` = its DISPOSABLE_DELIVERY; `rider_id` = RIDER_A (and, for H, a second row for RIDER_B on the same delivery); `round_no = 1` (unique per `(delivery, rider, round)`, F8); `offered_at = now()`; `expires_at = now() + interval '60 minutes'` — **future-relative, computed at execution time, never a hard-coded literal**; `outcome = 'PENDING'`. |
| **Expiry variant (Test I)** | Identical, except `expires_at = now() - interval '1 minute'`, `outcome` still `'PENDING'` — which is exactly what makes it visible in the inbox (F12) and refused with `OFFER_EXPIRED` on accept (F16). |
| **Dependencies** | DISPOSABLE_DELIVERY, RIDER_A / RIDER_B. |
| **How consumed** | Read by the inbox (C/E/M/N/O/Q), acted on by F/G/H/I, superseded by an accept. |
| **Can it be reset?** | **Yes — deletable** with privileged access, and re-creatable. This is the reset lever for the whole scenario set. Never reset by rewriting `outcome` back to `PENDING`: that falsifies the dispatch audit trail. Delete the row and insert a new one with a new id. |
| **Immutable history?** | No — but it *is* the dispatch audit trail in production, so deletion is permitted **only** for `67100000-…` fixture ids. |

⚠️ **60-minute window, not 60 seconds.** DEC-037's real window is 60 s (F18), which
is unusable for manual acceptance. The fixture's `expires_at` is set an hour out
**for the fixture rows only** — it changes no constant, no code and no decision;
`ACCEPT_WINDOW_SECONDS` stays 60. Test I supplies the genuinely-expired case.
This is a deliberate, stated deviation of *fixture data*, not of behaviour.

---

## 4. TEST → FIXTURE mapping

`RA` = RIDER_A, `RB` = RIDER_B, `NA` = NON_APPROVED_RIDER, `O/D/F` = a fresh
DISPOSABLE_ORDER / DELIVERY / OFFER triple.

| # | Test | Fixtures consumed | Pre-state | Expected observable | Fresh triple needed? |
|---|---|---|---|---|---|
| **A** | Approved rider enters inbox | RA | `riders.status = APPROVED` | Home shows toggle + "งานที่เสนอ"; inbox opens | No |
| **B** | Non-approved rider cannot see entry | **NA only** | `PENDING_APPROVAL`, no availability row | `StatusScreen` renders; **no** offer button, **no** toggle; inbox route unreachable from UI (F13) | No |
| **C** | Pending offer appears | RA + O/D/F #1 | offer `PENDING`, `expires_at` +60 min | Offer card visible with delivery id / round / countdown | **Yes** |
| **D** | Empty inbox | RA | RA has **zero** `PENDING` rows | Empty state, not an error | No — but requires all RA offers resolved first |
| **E** | Polling | RA + O/D/F #2 inserted **while the inbox is open** | inbox open with 0 offers | Offer appears within ≤15 s with no interaction (`POLL_INTERVAL_MS`) | **Yes** |
| **F** | Accept succeeds | RA + O/D/F #3 | delivery `RIDER_SEARCHING`, `rider_id NULL`, RA `active_delivery_count = 0` | 200; delivery → `RIDER_ASSIGNED` + `rider_id = RA`; offer → `ACCEPTED`; `rider_assignments` row `ACCEPTED`; RA count → 1 | **Yes** |
| **G** | Decline succeeds | RA + O/D/F #4 | offer `PENDING` | 200; offer → `DECLINED`; **delivery unchanged** (`RIDER_SEARCHING`, `rider_id NULL`); no `rider_assignments` row | **Yes** |
| **H** | `OFFER_TAKEN` | RA + RB + O/D + **two** offers (one each) on the same delivery | both `PENDING`; **RA's count reset to 0 after F** | First accept wins; second returns 409 `OFFER_TAKEN`; loser's slot released back to 0; loser's offer becomes `SUPERSEDED` | **Yes** |
| **I** | `OFFER_EXPIRED` | RA + O/D + expiry-variant offer | `PENDING`, `expires_at` in the past | Offer *is listed* (F12); accept → 409 `OFFER_EXPIRED`; decline → `OFFER_EXPIRED` | **Yes** |
| **J** | `NOT_FOUND` | RA session only | — | `POST /rider/offers/<random uuid>/accept` → 404 `NOT_FOUND`; identically for an offer belonging to RB (indistinguishable by design, F16) | No |
| **K** | `RIDER_HAS_ACTIVE_DELIVERY` | RA holding F's delivery + O/D/F #5 | RA `active_delivery_count = 1`, an `RIDER_ASSIGNED` delivery exists for RA | 409 `RIDER_HAS_ACTIVE_DELIVERY` (not the orphan-repair path — the active delivery must genuinely exist) | **Yes** |
| **L** | `FORBIDDEN` | **NA** session + any offer id | NA is `PENDING_APPROVAL` | 403 `FORBIDDEN` from `RolesGuard`, **before** any offer lookup (F14) | No |
| **M** | Post-action refresh | RA + O/D/F #6 | offer `PENDING` | After accept/decline the list re-reads and the acted-on offer disappears — verifies `refreshPending` coalescing | **Yes** |
| **N** | Poll timer after accept | RA + O/D/F #7 | as F | Poll continues on the 15 s cadence after a successful accept; no duplicate/stacked timers | **Yes** |
| **O** | Poll timer after decline | RA + O/D/F #8 | as G | Same, after decline | **Yes** |
| **P** | Blur stops polling | RA | inbox open | Navigating back stops network reads (observed via API/PostgREST logs or a proxy) | No |
| **Q** | Refocus restarts polling | RA + O/D/F #9 inserted while blurred | — | Returning to the inbox fetches immediately and shows the new offer | **Yes** |
| **R** | Foreign rider RLS isolation | RA + RB + an offer addressed to **RB only** | RB's offer `PENDING` | RA's inbox does **not** list it; a direct PostgREST select by RA returns 0 rows (`rider_assignment_attempts_select_own`, F11) | **Yes** |
| **S** | Locked G7 fixture untouched | The pre-existing G-7 fixture identity | recorded **before** provisioning | Its `riders`, `rider_availability` and `auth.users` rows are byte-identical before/after; no `rider_assignment_attempts` row references it | No |

**Ordering constraint:** F → K → H, in that order, because K depends on the
active delivery F creates and H depends on that slot being released back to 0.
D should be run either first (before any offer exists) or last (after all are
resolved).

**Test S is the reason §7 exists.** Its identity is now recorded at §7.0
(`riders.id = a0d763a3-16ca-4b6c-adf0-59ece258587f`,
`user_id = fd073d3e-0bca-4a22-8e3d-0a01eea18870`, no phone), which resolves
the F24 gap noted at inspection time. S is now **definable**; it still cannot
be **executed** until `g71_verify.sql` exists and the remaining readiness
blockers in §9 are cleared.

---

## 5. Provisioning mechanism

### 5.1 Two-part mechanism, and why it cannot be one part

**Auth accounts cannot be provisioned by SQL.** A rider must be able to *sign in*,
and a usable phone-OTP account requires Supabase Auth to create the user and its
identity record. A raw `insert into auth.users` (as `catalog_dev_seed.sql` does
for its never-signing-in merchant owner) produces a row that cannot sign in.

Therefore:

| Part | What | Who | Privilege |
|---|---|---|---|
| **P1 — Auth enrolment** | Add 3 (or 4) Test OTP phone/code pairs in the Supabase Dashboard → Auth → Phone → Test OTP, then sign in **once** per rider through the Driver App so `auth.users` + `profiles` (trigger) exist | Operator, by hand | Dashboard owner |
| **P2 — Domain provisioning** | A reviewed, idempotent SQL file that attaches `riders`, `rider_availability`, `orders`, `deliveries` and `rider_assignment_attempts` rows, resolving each rider's `user_id` **by phone lookup** from `auth.users` | Operator, by hand | `service_role` / SQL Editor |

### 5.2 Chosen mechanism for P2: **a reviewed SQL script under `supabase/seed-dev/`**

Chosen over a TypeScript admin script and over ad-hoc Studio SQL because it is
**the convention that already exists in this repository** (F19), and it satisfies
every constraint the brief imposes:

| Requirement | How the SQL-file mechanism meets it |
|---|---|
| Explicit human execution | It is a file. Nothing runs it. Not referenced by `turbo.json`, any npm script, any workflow, or `supabase/config.toml` |
| Requires service-role/operator privileges | `revoke all … from anon, authenticated` on every table it writes; executable only via SQL Editor / `psql` as the project owner |
| Never callable by the Driver App | It is not code and ships in no bundle; `apps/driver` has no service-role credential (`.env.example` says so explicitly) |
| Never in the mobile bundle | `supabase/` is outside every Expo app root |
| Never prints secrets | It contains none — no key, no password, no token. Phone numbers and OTP codes are **not** in the file; they live in the Dashboard and are referenced by phone number only |
| Never modifies schema | No `create table`, `alter`, `drop`, `create policy`, `create function`, no migration file added. **It is not placed in `supabase/migrations/`** — the schema lock stands |
| Never touches the locked G7 fixture | Every write is keyed to `67100000-…` ids or to a phone number from the new `+6681111000x` block; add a guard that aborts if a resolved `user_id` collides with the recorded G-7 fixture ids (§7) |
| Identifiable naming | `67100000-…` id prefix, `(g71 fixture)` name marker, `G71-` order numbers |
| Future-relative `expires_at` | `now() + interval '60 minutes'` evaluated at execution — never a literal timestamp |
| Safe to inspect before execution | Plain SQL, reviewed in a PR, `begin; … commit;` wrapped, `on conflict do nothing` throughout, **no `TRUNCATE`, no `DROP`, no `DELETE`, no `UPDATE` of any row it did not create** |

**Proposed path:** `supabase/seed-dev/g71_offer_fixture.sql`, plus a scenario-only
companion `supabase/seed-dev/g71_offer_scenario.sql` that creates *one* fresh
order/delivery/offer triple per run (parameterised by a `\set SCENARIO` psql
variable), so the permanent identities are provisioned once and the disposable
rows are provisioned per test.

**Rejected alternatives:**
- *TypeScript admin script* — would require a service-role key in a workspace that
  currently has none outside `apps/api`, adding a credential-handling surface for
  no benefit. `live-rls-check.mjs` (F20) is the only Node convention here and it
  is deliberately **anon-key, read-only**; a service-role sibling would blur that.
- *Studio/manual SQL only* — unreviewable, unrepeatable, and leaves no artifact
  in Git, which is exactly what "no G-7.1 fixture is defined in repository"
  (blocker 1) already costs us.

### 5.3 Structural rules the script must follow

1. `begin; … commit;` — one transaction.
2. Resolve rider `user_id` by `select id from auth.users where phone = '+6681111000x'`;
   **abort with `raise exception` if not found** (P1 not done) rather than
   inserting a fake user.
3. `on conflict (…) do nothing` on every insert; **never** `do update`.
4. Never insert `rider_availability.location` (generated, F4).
5. Never write `deliveries.rider_earning_satang` (BQ-029 OPEN).
6. Never write `order_status_history` / `delivery_status_history` (append-only,
   and provisioning is not a domain transition).
7. Never call `create_order()` or `release_rider_assignment()` — the fixture needs
   an order in `MERCHANT_ACCEPTED`, not a cart-driven creation, and release is a
   runtime concern.
8. Never `insert into order_number_counters` — `G71-` numbers bypass it entirely.
9. End with a `select` summarising what now exists (ids and states), so the
   operator sees the result without writing a second query.

---

## 6. Read-only verification design

**Mechanism:** a second file, `supabase/seed-dev/g71_verify.sql`, containing
**only `select` statements** — no DML of any kind — runnable before and after
provisioning and between tests. Optionally mirrored later by an anon-key Node
check in the `live-rls-check.mjs` style for the *RLS* assertions (R), which
genuinely require real rider sessions and cannot be proven from a privileged SQL
console at all.

| # | Verifies | Query shape |
|---|---|---|
| V1 | Rider A is `APPROVED` | `select id, status, approved_at from riders where id = :RA` — expect `APPROVED` |
| V2 | Rider B is `APPROVED` | same for `:RB` |
| V3 | Non-approved rider status | `select id, status, approved_at, approved_by from riders where id = :NA` — expect `PENDING_APPROVAL`, both null |
| V4 | Availability / location state | `select rider_id, is_online, last_lat, last_lng, location is not null as has_location, location_updated_at from rider_availability where rider_id in (:RA, :RB)` — expect `is_online = true`, `has_location = true` |
| V5 | No availability row for NA | `select count(*) from rider_availability where rider_id = :NA` — expect `0` |
| V6 | `active_delivery_count` | `select rider_id, active_delivery_count from rider_availability where rider_id in (:RA, :RB)` — expect `0` before F/K, `1` for the holder after F |
| V7 | Offer ownership | `select id, rider_id, delivery_id, round_no from rider_assignment_attempts where id like '67100000%'` — every row's `rider_id` must be one of `:RA`/`:RB`, never `:NA`, never the G-7 rider |
| V8 | Offer outcome | `select id, outcome, offered_at, expires_at from rider_assignment_attempts where delivery_id = :D` |
| V9 | `expires_at` is future (and, for the I-variant, past) | `select id, expires_at, expires_at > now() as is_live from rider_assignment_attempts where id like '67100000%'` |
| V10 | Delivery state | `select id, state, rider_id, assigned_at, reassignment_count, rider_earning_satang from deliveries where id like '67100000%'` — `rider_earning_satang` must stay `NULL` |
| V11 | One-active-assignment invariant intact | `select delivery_id, count(*) from rider_assignments where status = 'ACCEPTED' group by 1 having count(*) > 1` — expect **0 rows** |
| V12 | Order integrity | `select id, order_number, state, payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang from orders where order_number like 'G71-%'` — fees must be `1000`/`500`, `payment_method = 'ONLINE'` |
| V13 | **G7 fixture untouched** | See §7 — a checksum-style select over the recorded G-7 rider's `riders` + `rider_availability` rows, plus `select count(*) from rider_assignment_attempts where rider_id = :G7_RIDER` |
| V14 | No fixture leakage into dispatch | `select r.id, r.status, a.is_online from riders r join rider_availability a on a.rider_id = r.id where a.is_online and r.status = 'APPROVED'` — the online-and-approved pool must contain **exactly** the riders the operator intends, and never `:NA` |

**Test R cannot be verified by any of the above.** RLS isolation must be observed
through two real rider sessions (anon key), the way `live-rls-check.mjs` already
does it — a privileged SQL console bypasses RLS entirely and would produce a
false PASS.

---

## 7. Locked G-7 fixture protection (Test S)

### 7.0 Recorded identity — CONFIRMED 2026-08-26

The locked G-7 fixture's identity, as confirmed by the operator. This is the
**protected G-7 fixture**: G-7.1 provisioning must never create, modify, or
reuse it, and any future G-7.1 fixture SQL must **abort** if any identity it
resolves matches either id below.

| Field | Value |
|---|---|
| `riders.id` | `a0d763a3-16ca-4b6c-adf0-59ece258587f` |
| `riders.user_id` | `fd073d3e-0bca-4a22-8e3d-0a01eea18870` |
| Phone | **Not available** — no phone number is recorded for this fixture. The §5.3 / §7.1 abort-guard must therefore key on `riders.id` and `user_id` only, never on a phone comparison, and no phone value may be invented to fill this gap. |

No other identifier (order id, delivery id, offer id, or any additional UUID)
is recorded for the G-7 fixture. None is invented here — §7.1 below still
governs how the **before** snapshot is captured for the rows this identity
does anchor (`riders`, `rider_availability`), and the guard in §7.1 item 3 is
scoped to exactly the two ids above.

This satisfies blocker 1 from the G-7.1 provisioning readiness check: the
identity is now recorded in the repository, so the abort-guard in §5.3/§7.1
can be written, and Test S can be defined against it. It does **not** by
itself authorise writing `g71_offer_fixture.sql` or `g71_verify.sql` — the
remaining readiness blockers (Product Owner approval, Auth/Test OTP
provisioning, environment selection, two independent rider sessions) still
stand.

### 7.1 Repository state before this section

The repository recorded **nothing** about the existing G-7 fixture (F24)
prior to §7.0 above. Before any provisioning:

1. ~~The operator must record, in a reviewed file, the locked G-7 fixture's
   `riders.id`, `riders.user_id`, and phone number~~ — **done, §7.0.** Phone
   is confirmed not available rather than recorded.
2. `g71_verify.sql` must capture a **before** snapshot, using the ids recorded
   in §7.0 (`:G7_RIDER = 'a0d763a3-16ca-4b6c-adf0-59ece258587f'`,
   `:G7_USER_ID = 'fd073d3e-0bca-4a22-8e3d-0a01eea18870'`):
   `select id, user_id, status, approved_at, updated_at from riders where id = :G7_RIDER`
   and `select rider_id, is_online, last_lat, last_lng, location_updated_at, active_delivery_count, updated_at from rider_availability where rider_id = :G7_RIDER`.
3. `g71_offer_fixture.sql` must contain a hard guard near the top, comparing
   against the exact ids recorded in §7.0:

   > if any resolved G-7.1 `user_id` equals `fd073d3e-0bca-4a22-8e3d-0a01eea18870`,
   > or any resolved G-7.1 `rider_id` equals `a0d763a3-16ca-4b6c-adf0-59ece258587f`
   > → `raise exception` and abort the transaction.

4. The **after** snapshot must be identical, `updated_at` included. `updated_at`
   is the tell: `riders_set_updated_at`/`rider_availability_set_updated_at` fire
   on any update, so an unchanged `updated_at` is positive evidence that nothing
   touched the row.

Step 1 is now satisfied (§7.0). Test S is **definable** as of this identity
record, but remains **unexecuted** until `g71_verify.sql` exists and the
remaining readiness blockers are cleared — see §9.

---

## 8. Cleanup / reset policy

### 8.1 May be deleted (privileged access only, fixture ids only)

| Row type | Basis | Constraint |
|---|---|---|
| `rider_assignment_attempts` with id prefix `67100000-…` | No delete trigger (F7) | Delete only rows whose `delivery_id` is also a `67100000-…` fixture delivery. **Never** delete by `rider_id` alone, and never touch a row belonging to the G-7 fixture or any real rider |

### 8.2 Must remain as historical records — never deleted, ever

| Row type | Why |
|---|---|
| `orders` | `orders_enforce_immutable_columns` refuses DELETE for every role (F9); append-only domain history |
| `deliveries` | `deliveries_reject_delete` (F5) |
| `rider_assignments` | `rider_assignments_reject_delete` (F6) |
| `riders` (all three) | `riders_reject_delete` (F2) — this is why Test B's Option C is impossible |
| `profiles` / `auth.users` | `riders.user_id` and `orders.customer_id` are `ON DELETE RESTRICT` (F3/F9); deleting an Auth user is a destructive Auth operation this design forbids outright |
| `order_status_history`, `delivery_status_history` | `reject_mutation` — append-only (F10) |

### 8.3 May be reset with `UPDATE` (narrowly, and only on fixture rows)

| Column | Reset | Caution |
|---|---|---|
| `rider_availability.active_delivery_count` | `→ 0` for RA/RB between scenarios | This is the *only* routine reset. Do it **only** when no `RIDER_ASSIGNED`/`AT_MERCHANT`/`PICKED_UP`/`EN_ROUTE` delivery for that rider is still open — otherwise you have hand-created the exact double-assignment the CAS guard exists to prevent |
| `rider_availability.is_online` | `→ true`/`false` | Prefer toggling from the Driver App itself — that is a G-7 behaviour under test |
| `deliveries.state` / `rider_id` / `assigned_at` | Back to `RIDER_SEARCHING` / `NULL` / `NULL` | **Only in the same transaction as closing the matching `rider_assignments` row to `RELEASED`.** Omitting either half strands the delivery permanently (Layer 3). **Preferred: don't. Provision a new triple.** |

### 8.4 Must never be modified after provisioning

- `riders.status` for all three fixture riders — in particular
  **`NON_APPROVED_RIDER` must never be promoted to `APPROVED`**.
- Every `orders` money column and snapshot (immutable by trigger anyway).
- `deliveries.rider_earning_satang` — stays `NULL` while BQ-029 is `OPEN`.
- Any row belonging to the locked G-7 fixture, the `dede0000-…` catalog seed, or
  any non-fixture id.
- `rider_assignment_attempts.outcome` must never be rewritten backwards to
  `PENDING` — delete the row and insert a new one instead.

### 8.5 Between-scenario reset recipe (the intended normal path)

1. Delete the scenario's `67100000-…` offer rows.
2. `UPDATE rider_availability SET active_delivery_count = 0` for RA/RB **only if**
   no active delivery remains for them.
3. Provision a **new** order/delivery/offer triple with the next scenario suffix.
4. Leave the consumed order/delivery/assignment rows in place, permanently.

---

## 9. Readiness checklist

| | Gate | Current state |
|---|---|---|
| [ ] | Fixture specification approved | **Awaiting Product Owner** — §3 |
| [ ] | Test B strategy approved | **Awaiting Product Owner** — §2 recommends Approach A |
| [ ] | Provisioning mechanism approved | **Awaiting Product Owner** — §5 recommends a reviewed SQL file under `supabase/seed-dev/` |
| [ ] | Live environment selected | Presumed `banhao-dev` (`yssnwnboiwldogmlvvlw`) per Infrastructure Readiness §2 Option A — **not confirmed for G-7.1** |
| [ ] | Rider A Auth account available | **Not created.** Needs a Test OTP number + one sign-in |
| [ ] | Rider B Auth account available | **Not created.** Must be a genuinely separate session/device |
| [ ] | Non-approved rider Auth account available | **Not created** |
| [ ] | Customer account available | **Not created** |
| [ ] | Shared restaurant verified | `dede0000-…c001` exists in the seed file; **not verified as applied live** |
| [ ] | Provisioning script reviewed | **Not written** — §5 is its specification |
| [ ] | Read-only verification passed | **Not written** — §6 is its specification |
| [ ] | Driver sessions available | Two physical/simulator devices or two Expo Go instances required for H and R. ⚠️ iOS Simulator HTTP/3 issue — `scripts/sim-supabase-proxy.mjs` |
| [x] | G7 fixture identity recorded | **Done, 2026-08-26** — §7.0. Not the same gate as "integrity verified": that still requires `g71_verify.sql` to exist and run against the live target, which is still blocked below |
| [ ] | Live acceptance may begin | — |

---

## 10. FINAL DECISION

**BLOCKED**

Genuine blockers, all of which are decisions or artifacts that do not yet exist —
none is a defect in G-7.1's implementation:

1. ~~The locked G-7 fixture's identity is not recorded anywhere in the
   repository.~~ **Resolved 2026-08-26 — see §7.0.** `riders.id =
   a0d763a3-16ca-4b6c-adf0-59ece258587f`, `user_id =
   fd073d3e-0bca-4a22-8e3d-0a01eea18870`, no phone available. The §5.3
   abort-guard can now be written against these exact ids, and Test S is
   definable. This blocker no longer applies; §5.3 and §7.1 still describe
   guard *behaviour* to implement when the fixture SQL is actually authored —
   not yet authorised by this task.
2. **No Auth accounts exist for RIDER_A, RIDER_B, NON_APPROVED_RIDER or
   CUSTOMER**, and Test OTP numbers for them are not configured. This is a
   Dashboard action requiring credentials that are not available in this
   environment, and it must precede any SQL.
3. **The target live environment for G-7.1 has not been explicitly selected.**
   Option A named `banhao-dev` as the *deployment* target; nobody has stated that
   G-7.1 acceptance runs there.
4. **Three approvals are outstanding** and are prerequisites for writing the
   scripts at all: the fixture specification (§3), the Test B strategy (§2), and
   the provisioning mechanism (§5).
5. **Two independent rider sessions are required** (tests H and R) and no
   second device/session has been confirmed available.

Not a blocker, recorded for the reviewer: the fixture's 60-minute `expires_at`
(§3.8) is a deliberate property of *fixture data only*. `ACCEPT_WINDOW_SECONDS`
remains 60 and no code, constant or decision changes.
