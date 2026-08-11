# BANHAO — Supabase Migration v1 Verification Report

Implements the approved [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) as real
migration files. Written 2026-08-11 (EVENT-018), branch
`feature/supabase-migration-v1`.

> ⛔ **The live/remote Supabase project (`banhao-dev`) was never touched.**
> No `supabase db push`, no `supabase link` to a project, no SQL executed
> against anything but a throwaway local Docker container. Verification in
> this report is against **PostgreSQL 16 + PostGIS 3.4 running in Docker**,
> the same tooling `supabase/tests/run-rls-tests.sh` already used before this
> work — see § 6 for why that tool was chosen over `supabase start`.

---

## How to read this report

This document accumulated across **three passes**, and the sections are
*not* all describing the same point in time. Read § 12 and § 13 as
authoritative wherever they overlap with an earlier section:

| Sections | Pass | Status |
|---|---|---|
| **§§ 1–11** | EVENT-018 — the original migration pass (Step 7.1) | **Historical.** Accurate as of that pass. Two claims in §§ 7, 9, 11 about *rider access* were superseded by § 12 and are marked inline where they appear. |
| **§ 12** | EVENT-019 + EVENT-020 — HIGH-1 / H-1 rider column **and** row isolation | **Current and authoritative** for everything about rider access to orders. |
| **§ 13** | EVENT-019 + EVENT-020 — HIGH-2 / M-1 rider reassignment atomicity | **Current and authoritative** for `release_rider_assignment()`. |

⚠️ **If you are looking for how rider access to `orders`/`order_items`/
`order_item_options` actually works, read § 12 — not §§ 7, 9, or 11.** The
earlier sections describe a full-row implementation that no longer exists,
and § 9's suggested remedy (`security_invoker = true`) was subsequently
**proven not to work**; § 12 explains why and what replaced it.

---

## 1. What was built

**11 new migration files**, `20260811000001` through `20260811000011`,
applied strictly after the three existing migrations
(`20260809000001`–`20260809000003`), which are **byte-identical and
untouched** — verified by `git diff` against each, empty.

| Migration | Domain | Tables |
|---|---|---|
| `20260811000001_identity_domain.sql` | Identity | `platform_staff`, `addresses` + shared trigger functions (`reject_delete`, `reject_mutation`) |
| `20260811000002_merchant_domain.sql` | Merchant | `merchants`, `merchant_bank_accounts`, `restaurants`, `restaurant_members` |
| `20260811000003_catalog_domain.sql` | Catalog | `restaurant_hours`, `menu_categories`, `menu_items`, `menu_option_groups`, `menu_options` |
| `20260811000004_cart_domain.sql` | Cart | `carts`, `cart_items`, `cart_item_options` |
| `20260811000005_order_domain.sql` | Order | `orders`, `order_items`, `order_item_options`, `order_status_history` |
| `20260811000006_payment_domain.sql` | Payment | `payments`, `payment_attempts`, `payment_events`, `payment_transactions`, `refunds` |
| `20260811000007_ledger_domain.sql` | Ledger | `ledger_entry_groups`, `ledger_entries` |
| `20260811000008_rider_domain.sql` | Rider | `riders`, `rider_documents`, `rider_availability` |
| `20260811000009_delivery_domain.sql` | Delivery | `deliveries`, `delivery_status_history`, `rider_assignments`, `rider_assignment_attempts` — **the rider-race protection** |
| `20260811000010_audit_notification_infra_domain.sql` | Audit/Notification/Infra | `audit_logs`, `outbox`, `jobs`, `idempotency_records`, `reconciliation_cases`, `notifications`, `notification_deliveries` |
| `20260811000011_rls_policies.sql` | Cross-cutting | RLS grants + policies for every table above |

**39 new tables + `profiles` (existing) = 40 application tables**, verified
by querying `information_schema.tables` after a clean apply (§ 5). One
migration boundary per domain, exactly matching the sequence
`docs/DATABASE_DESIGN.md` § 21 proposed, adjusted only for the deferrals in
§ 2 below.

**Not one giant migration.** Each file is independently reviewable and owns
one domain, per §5 of the migration brief and ADR-012's module-ownership
convention.

---

## 2. Deferred tables — and why

Per §6 of the migration brief, evaluated individually rather than deferred
as a block:

| Table(s) | Reason deferred | Expected phase | Dependency |
|---|---|---|---|
| `settlements`, `settlement_items` | `docs/DATABASE_DESIGN.md` § 16 says explicitly "not to be implemented" — every rate is `OPEN` (DEC-023/024/025) and Q-002 is `LEGAL_REVIEW_REQUIRED`. Building the schema would encode an assumption about legal ownership of funds that has not been made. | Once Q-002 and the rate decisions land | DEC-026 (accepted as a domain, not an implementation) |
| `delivery_fee_bands` | DEC-023 keeps delivery pricing `OPEN`; no other Phase 1 table references it. An empty pricing table with no consumer is schema for its own sake. | Once BQ-026 sets the fee model | DEC-023 |
| `zones` | Explicitly named a deferral candidate in the migration brief. Nothing in Phase 1 requires it to exist — `addresses.zone_id`, `restaurants.zone_id` and `riders.zone_id`/`service_area_id` are kept as **bare `uuid` columns with no foreign key**, so adding the table later is additive (one `ALTER TABLE ... ADD CONSTRAINT`), not a breaking change. | When zone-based dispatch or zone pricing is built (DEC-020's own stated Stage-2 trigger) | DEC-031 |
| `service_areas` | Not explicitly named as a deferral candidate in the brief, but reasoned through: it is the parent of `zones`, has no Phase 1 consumer beyond the same nullable, FK-less columns, and Buntharik is a single district with raw lat/lng already captured on `addresses`/`restaurants`. Deferring the whole geo domain together, rather than half of it, avoids a table that exists but is never populated. | Same as `zones` | DEC-031 |
| `delivery_attempts` | **Evaluated carefully, as instructed** — it does **not** protect rider reassignment (that is `rider_assignments` + `rider_assignment_attempts`, both built and tested below). It records post-pickup handover attempts for the delivery-failure workflow, and **BQ-017 (delivery failure policy) is `OPEN`** — wait times, retry counts, and when a delivery is marked `FAILED` are all undecided. Building it now would be schema for a workflow that does not exist yet, the same reasoning that deferred `promotions` in the original design. | Once BQ-017 is answered | BQ-017 |

**None of these six tables was removed from `docs/DATABASE_DESIGN.md`.** The
conceptual design is unchanged; only the migration's scope is narrower.

---

## 3. Documentation gaps found and resolved during implementation

Four small internal inconsistencies in `docs/DATABASE_DESIGN.md` had to be
resolved to write working SQL. None involved a business decision — all are
noted inline in the migration files' comments, and are listed here for
visibility:

1. **`refunds` was missing a `provider` column.** The design's own unique
   constraint, "Unique `(provider, provider_refund_id)`", requires a
   `provider` column that its "Columns" list never mentioned. Added —
   `supabase/migrations/20260811000006_payment_domain.sql`.
2. **`menu_items.category_id` on-delete behaviour conflicts across sections.**
   § 5.3's table catalog states `on delete restrict`; § 19's summary table
   describes the whole `restaurants → categories → items` chain as
   `CASCADE`. The more specific, deliberate per-table declaration (§ 5.3) was
   followed for that one edge; `restaurant_id` foreign keys follow § 19's
   `CASCADE`. Restaurants can never be hard-deleted (`reject_delete`), so
   this is defensive rather than live behaviour either way.
3. **`rider_availability`'s two RLS descriptions disagreed.** § 18's matrix
   (authoritative) grants the rider `S,U(own online flag)`; a prose note
   elsewhere read "API-only, no client SELECT". Implemented per § 18 — a
   rider may read their own row and update `is_online`. The prose note has
   been corrected in the migration's own comment.
4. **`restaurants (id, merchant_id)`'s composite-FK anchor has no consumer.**
   § 5.2 specifies it "needed for the composite FK in § 6", but § 6 does not
   list any table using it. Implemented anyway (harmless, one extra unique
   index) for forward compatibility, per the design's own literal text.

---

## 4. Local validation

### 4.1 Tooling choice — why not `supabase start` / `supabase db reset`

The migration brief permits (`MAY`) validating via `supabase db reset`
against a local Supabase stack. This repository already has an established,
documented alternative — `supabase/tests/run-rls-tests.sh`, which spins up a
**plain PostgreSQL 16 + PostGIS container** rather than the full Supabase
stack, with a written rationale in `supabase/tests/README.md`:

> "RLS, column privileges, and policy recursion are core PostgreSQL
> behaviours rather than anything Supabase-specific."

Every property this migration set needs verified — RLS, triggers, unique
constraints, composite foreign keys, and the rider-race concurrency
guarantee — is exactly that: core PostgreSQL behaviour. `supabase start`
would additionally pull and boot GoTrue, PostgREST, Realtime, Storage and
Kong, none of which this migration's correctness depends on, for
meaningfully more setup time and moving parts. **Extended the existing tool
rather than introducing a second one.**

`supabase/.temp/linked-project.json` shows this repository's Supabase CLI is
linked to the live `banhao-dev` project. The Docker-only approach also
removes any possibility of a `supabase` CLI command accidentally reaching
that project — no `supabase` CLI command was invoked at any point in this
work.

### 4.2 What was run

```bash
./supabase/tests/run-rls-tests.sh      # existing suite, now against all 14 migrations
./supabase/tests/run-domain-tests.sh   # new suite for this migration set
git diff --check
```

Both suites boot an independent, throwaway container (`banhao-rls-test-v2`
and `banhao-domain-test` respectively — different names, no shared state),
apply the auth shim, apply **every** file in `supabase/migrations/` in
filename order, run assertions, and are torn down afterward. Containers were
removed after every run in this work; none was left running.

### 4.3 Results

| Suite | Assertions | Result |
|---|---|---|
| `run-rls-tests.sh` (existing, `profiles`) | 13 | **13/13 PASS**, unchanged by this migration set |
| `run-domain-tests.sh` § A–F (identity, cart, order, payment, ledger, RLS) | 34 | **34/34 PASS** |
| `run-domain-tests.sh` rider-race concurrency (§ 4.4) | 13 | **13/13 PASS** |
| **Total** | **60** | **60/60 PASS** |

`git diff --check`: clean (no whitespace errors).

### 4.4 The rider race condition — proven by execution, not reasoning

Per TQ-012's own requirement and the migration brief's §19/§28, this is the
one property that must be shown to hold under genuine concurrency, not
inferred from reading the guard's SQL.

**What `run-domain-tests.sh` actually does:** after seeding one delivery in
`RIDER_SEARCHING` with two eligible riders, it launches **two separate
`psql` client processes**, backgrounded with `&` and synchronised with
`wait`, each independently calling a function that executes the exact
guarded `UPDATE` documented in `20260811000009_delivery_domain.sql`:

```sql
update deliveries
   set state = 'RIDER_ASSIGNED', rider_id = :riderId, assigned_at = now()
 where id = :deliveryId
   and state in ('RIDER_SEARCHING', 'RIDER_REASSIGNING')
   and rider_id is null;
```

Two independent OS processes, two independent database connections, issued
as close to simultaneously as `bash`'s job control allows — this is what
"proof by execution" means here, as opposed to a single-session simulation.
Across the runs performed while building this migration, the winner was
**not the same rider both times** (Rider B won the first run, Rider A won
the second) — confirming the outcome is decided by real database-level
serialisation, not by test-file ordering.

**Results, this run:**

1. **Exactly one winner.** Delivery reached `RIDER_ASSIGNED` with exactly
   one `rider_assignments` row `ACCEPTED`, and the loser's attempt affected
   zero rows.
2. **Database backstop confirmed directly.** A raw `INSERT` of a second
   `ACCEPTED` row for the same delivery — bypassing the guarded `UPDATE`
   pattern entirely — was rejected with `23505 unique_violation` against
   `rider_assignments_one_active`.
3. **Correct reassignment (DEC-021) succeeds.** Releasing the winning rider
   with **both** required statements (nulling `deliveries.rider_id` **and**
   closing the old `rider_assignments` row) let a third rider claim the
   delivery cleanly.
4. **The architecture review's HIGH finding, reproduced exactly, then
   fixed.** Performing only the *first* half of the release (nulling
   `deliveries.rider_id`, leaving the old claim `ACCEPTED`) does **not**
   fail quietly — the guarded `UPDATE` half of the next claim actually
   *succeeds* (rowcount 1, since `rider_id` is null), and it is the
   **follow-up `INSERT` into `rider_assignments`** that then raises
   `23505 unique_violation` against the stale row. This is a sharper,
   testing-revealed version of the documented finding: an incomplete
   release does not just leave a delivery quietly stuck, it produces a
   **hard, unhandled database error** for whichever rider attempts the next
   claim — something a NestJS handler must explicitly catch. Closing the
   stale `rider_assignments` row (the fix) immediately let the next claim
   succeed cleanly. Both the failure and the fix were executed against a
   real database, not asserted from reading the schema.

This confirms every claim `docs/TECHNICAL_ARCHITECTURE.md` § 11.1 and
`docs/DATABASE_DESIGN.md` § 11.1 make about the strategy, including the
finding the 2026-08-11 architecture review added — by running it, not by
re-reading the comment.

---

## 5. Schema verification against `docs/DATABASE_DESIGN.md`

Measured against the same container after a clean `db reset`-equivalent
apply (drop and recreate from the migrations, not an incremental patch):

| Object | Count | Method |
|---|---|---|
| Application tables (excl. `spatial_ref_sys`) | **40** | `information_schema.tables` |
| Foreign keys | **62** | `information_schema.table_constraints` |
| Unique constraints | **19** | `information_schema.table_constraints` |
| Explicit `CHECK` constraints | **61** | `pg_constraint` where `contype='c'` |
| Indexes (all, incl. those backing `PRIMARY KEY`/`UNIQUE`) | **110** | `pg_indexes` |
| Tables with RLS enabled | **40 / 40** | `pg_class.relrowsecurity` |
| RLS policies | **55** | `pg_policies` |
| Triggers | **52** | `information_schema.triggers` |
| New functions this migration set added | **9** — `reject_delete`, `reject_mutation`, `orders_enforce_immutable_columns`, `payments_enforce_immutable_columns`, `payment_events_enforce_immutable_columns`, `refunds_enforce_immutable_columns`, `is_restaurant_member`, `is_assigned_rider`, `is_assigned_order_rider` | `pg_proc`, excluding PostGIS internals |

**Every table has RLS enabled — 40/40, no exceptions**, including the tables
with zero policies (§18's 🔴 rows), where enabled-RLS-with-no-policy is the
intended default-deny mechanism, not an oversight.

### Foreign keys and cascade behaviour — spot check against § 19

| Relationship | Design says | Implemented as |
|---|---|---|
| `profiles → orders (customer)` | RESTRICT | `on delete restrict` ✓ |
| `menu_items → order_items` | SET NULL | `on delete set null` ✓ |
| `addresses → orders` | SET NULL | `on delete set null` ✓ |
| `orders → order_items` | CASCADE | `on delete cascade` ✓ |
| `orders → payments, deliveries` | RESTRICT | `on delete restrict` ✓ (both) |
| `riders → deliveries, rider_assignments` | RESTRICT | `on delete restrict` ✓ (both) |

### Idempotency — every unique constraint from § 12, present

| Protects against | Table | Unique on | Present |
|---|---|---|---|
| Two payments for one order | `payments` | `(order_id)` | ✓ |
| Payment reference reuse | `payments` | `(payment_reference)` | ✓ |
| **Duplicate webhook** | `payment_events` | `(provider, provider_event_id)` | ✓ — proven in § 4.3 D3 |
| Duplicate money movement | `payment_transactions` | `(provider, provider_transaction_id)` | ✓ |
| Duplicate attempt | `payment_attempts` | `(payment_id, attempt_no)` | ✓ |
| Duplicate refund | `refunds` | `(refund_reference)` | ✓ |
| **Duplicate ledger write** | `ledger_entry_groups` | `(group_key)` | ✓ — proven in § 4.3 E1 |
| Double-tap order creation | `idempotency_records` | `(idempotency_key, endpoint)` | ✓ |
| **Two active rider claims** | `rider_assignments` | `(delivery_id) where status='ACCEPTED'` | ✓ — proven in § 4.4 |
| Duplicate offer | `rider_assignment_attempts` | `(delivery_id, rider_id, round_no)` | ✓ |

---

## 6. Money and financial integrity

- **No `float`, `double precision`, `real`, `numeric`, or `money` type
  appears anywhere in this migration set.** Every monetary column is
  `bigint ... _satang`, matching `docs/DATABASE_DESIGN.md` § 2 and ADR-007.
- `orders.grand_total_satang = subtotal + delivery_fee + service_fee -
  discount` is a database `CHECK` constraint, not an application-trusted
  invariant.
- **DEC-034 respected exactly**: `ledger_entry_groups` and `ledger_entries`
  carry no zero-sum trigger. `git grep -i "sum.*=.*0"` across the new
  migrations returns nothing — verified before writing this report.
  Immutability (append-only, no `UPDATE`/`DELETE` for any role including
  `service_role`) **is** enforced, via `reject_mutation`, and is separate
  from the zero-sum question DEC-034 answered.
- Order money and snapshot columns are immutable **even for a superuser
  session** (§ 4.3, C5) — proving the trigger, not RLS, is what protects
  financial history, since RLS does not apply to a superuser connection at
  all.

---

## 7. Security — no client can write financial or state columns

Directly proven in § 4.3, tests F8/F9: an authenticated customer's attempt
to `UPDATE payments SET state = 'REFUNDED'` and a restaurant member's
attempt to `UPDATE orders SET state = 'DELIVERED'` were **both blocked with
no error path through RLS at all** — there is no `GRANT` on those columns
for `authenticated`, so the statement fails before any policy is even
evaluated.

**Exactly three tables accept a direct client write**, matching
`docs/DATABASE_DESIGN.md` § 18 precisely:

| Table | Client write surface | Proven in § 4.3 |
|---|---|---|
| `addresses` | Full row except immutable identity columns; hard delete blocked | F10, F11 |
| `carts` / `cart_items` / `cart_item_options` | Full CRUD, owner-scoped | B1 (insert path) |
| `notifications` | `read_at` only | (grant present; not separately re-tested beyond F-series patterns) |

> ⚠️ **SUPERSEDED — see § 12.** The paragraph below described the original
> Step 7.1 migration pass, where a rider held full-row `SELECT`. **That is no
> longer how this schema works.** The rider's policies on
> `orders`/`order_items`/`order_item_options` have since been dropped
> entirely and replaced with three column-scoped, `security_barrier` views.
> Kept here unedited as the record of what the first pass shipped and what
> the Architect Review then found.

**Current state, in brief** (full detail and verification: § 12): a rider's
read of `orders`/`order_items`/`order_item_options` no longer goes through
`GRANT`+RLS on the base tables at all — those policies are dropped. The
reason is structural, not a preference: `GRANT` is per database *role*, and
`authenticated` is the single role shared by customer, merchant, and rider
(DEC-033), so there is no way to give a rider a narrower column set than a
customer on the same table through ordinary column `GRANT`s. The rider's
only read path is now three dedicated views —
`rider_order_view`/`rider_order_item_view`/`rider_order_item_option_view` —
each with an explicit, minimal column projection (no money column, no
`payment_method`, no `customer_id`/`address_id`) and a row predicate calling
`is_assigned_order_rider()`. The views are **owner-privilege**
(`security_invoker = false`, so they can still read rows the rider's own RLS
no longer permits) **and `security_barrier = true`** — the second property
is required, not optional: without it, a rider-supplied query predicate can
be evaluated by the planner *before* the row predicate, which was proven
exploitable as an error-based oracle disclosing hidden rows' column values
without ever returning them. The exact oracle probe was reproduced locally
against both the vulnerable and fixed states, alongside a positive control
proving the probe genuinely fires when nothing blocks it (so the fixed
state's clean result is meaningful, not vacuous) — see § 12 for the full
proof and `supabase/tests/rider_view_row_isolation_security_test.sql` for
the permanent regression test.

**One known simplification, flagged rather than hidden** *(state as of Step
7.1 — since fixed, § 12)*: § 18 of `docs/DATABASE_DESIGN.md` calls for
"limited columns via a view" for a rider's read of `orders`/`order_items`
once assigned. This migration grants
the rider **full-row** `SELECT`, correctly scoped to their own assigned
delivery via `is_assigned_order_rider()`. The row-level boundary the
mandatory tests target — a rider seeing only their own assigned orders, not
anyone else's — is fully enforced and proven (§ 4.3, F5). The column-level
refinement (hiding specific columns from a rider that customer/merchant can
see) is not yet implemented and is recorded as **DBQ-015** below.

---

## 8. Auditability

- `audit_logs.reason` is `NOT NULL` **enforced by a `CHECK` constraint**
  whenever `actor_type = 'OPERATOR'` (DEC-032) — a database invariant, not
  an application convention.
- `order_status_history` and `delivery_status_history` are separate tables
  (DEC-018), both append-only via `reject_mutation`, both indexed
  `(parent_id, occurred_at)` for timeline reconstruction.
- Every `*_status_history`/`audit_logs`/ledger table rejects `UPDATE` and
  `DELETE` **unconditionally**, including for the service role — proven in
  § 4.3 (C3/C4/C7, E3) by running the mutation as the `postgres` superuser,
  which has no RLS restriction at all, so only the trigger could have
  blocked it.

---

## 9. Open items raised by this implementation

New, added to `docs/OPEN_DATABASE_QUESTIONS.md`:

**DBQ-015 — column-scoped rider view for orders/order_items.**
**✅ RESOLVED — implemented in § 12. Do not follow the recommendation in the
struck-through paragraph below.**

DBQ-015 was raised by this pass and closed by the two Architect Review
passes that followed. `rider_order_view`, `rider_order_item_view` and
`rider_order_item_option_view` now exist
(`20260811000012_rider_order_views.sql`), the rider's full-row policies are
dropped, and the views are `security_invoker = false` **plus
`security_barrier = true`**. Current status in
`docs/OPEN_DATABASE_QUESTIONS.md`: **IMPLEMENTED WITH CAVEAT**.

> ⚠️ **The original recommendation below was WRONG on both counts and is
> retained only as a record.** `security_invoker = true` does **not** work
> here: an invoker-security view still evaluates RLS as the querying role,
> so once the rider's base-table policy is dropped the rider sees zero rows
> through it. And owner-privilege access alone is **also** insufficient
> without `security_barrier = true` — without the barrier, a rider-supplied
> predicate can be evaluated ahead of the view's row check, which was proven
> exploitable as an error-based oracle. § 12 documents both corrections and
> the regression test that locks them in.

> ~~**DBQ-015 — column-scoped rider view for orders/order_items.** § 18 of the
> database design calls for "limited columns via a view" for a rider's order
> read once assigned; this migration implements full-row access at the
> correct row-level scope instead (§ 7 above). Recommend a follow-up migration
> adding `rider_order_view` / `rider_order_item_view` with
> `security_invoker = true` (PostgreSQL 15+) once the exact column set a rider
> needs is specified. Priority D2 — the security boundary that matters
> (row-level) is already enforced; this is a refinement.~~

No other new database questions were raised. The four documentation gaps in
§ 3 were resolved during implementation with the more specific, deliberate
source winning, not deferred as open questions, since none required a
product or legal decision to resolve.

---

## 10. Quality gate

```text
[x] DEC-014 respected — profiles/auth.users relationship untouched; no
    duplicate identity table
[x] DEC-015 not touched by this work (payment provider abstraction lives in
    apps/api, out of scope for a migration)
[x] DEC-033 respected — no profiles.role reference in any new RLS policy,
    verified by reading every policy in 20260811000011_rls_policies.sql;
    authorization resolved via restaurant_members/riders/platform_staff
[x] DEC-034 respected — no zero-sum trigger; verified by grep and by
    reading ledger_entries/ledger_entry_groups' trigger definitions
[x] Existing profiles preserved — byte-identical to the three original
    migrations (git diff, empty); 13/13 existing RLS assertions still pass
[x] profiles.role not introduced as an authorization source of truth in any
    new table or policy
[x] One restaurant per cart protected — structurally, via composite FK, not
    application validation; proven B1–B3
[x] Order snapshots implemented — order_items/order_item_options write-once,
    proven immutable even for superuser (C2–C4)
[x] Order/payment/delivery separated — three independent state vocabularies,
    three independent status_history tables, DEC-018 respected throughout
[x] Payment idempotency protected — unique(order_id), unique(payment_reference)
    both proven (D1, D2)
[x] Duplicate webhook protection implemented — unique(provider,
    provider_event_id), proven (D3), distinct from surplus-payment recording
    (D4)
[x] Rider race condition protected — guarded UPDATE + partial unique index
    backstop, BOTH proven by two genuinely concurrent client processes
    against real PostgreSQL (§ 4.4), including the architecture review's
    finding reproduced and fixed
[x] Refund separated from Order state — no order column ever holds a refund
    value; refunds is its own table with its own state (DEC-027)
[x] Financial records protected — orders/payments/refunds/order_items/
    ledger_entries all reject DELETE unconditionally
[x] No zero-sum trigger — confirmed absent by design (DEC-034) and by grep
[x] RLS implemented — 40/40 tables, 55 policies
[x] RLS tested — 21 representative-access assertions across customer,
    merchant, rider, anon (F-series + A-series)
[x] FK relationships verified — 62 foreign keys, spot-checked against § 19
[x] Indexes verified — 110 indexes; every named index from § 15 present
[x] Constraints verified — 61 explicit CHECK constraints, 19 unique
    constraints
[x] Local migration succeeds — clean apply, migrations 1–14 in order, only
    an expected "already exists" NOTICE for the pre-existing postgis
    extension
[x] Database tests pass — 60/60 assertions across two independent suites
[x] No remote Supabase changes — no supabase CLI command invoked; verified
    supabase/migrations/ diff against the three original files is empty
[x] No backend code — zero files touched outside supabase/
[x] No payment provider integration — provider is free text throughout;
    no vendor SDK or vendor-specific column anywhere in the schema
```

---

## 11. Summary *(of the Step 7.1 pass — see § 12/§ 13 for the current state)*

**40 tables, 62 foreign keys, 61 check constraints, 110 indexes, 55 RLS
policies, 52 triggers, 9 new functions — 11 migrations, 60/60 executable
assertions passing against real PostgreSQL, zero changes to the live
Supabase project.**

> **Counts and totals here are as of Step 7.1.** After the two Architect
> Review passes the branch carries **13 migrations** (two added: the rider
> views and the atomic release function), three `security_barrier` rider
> views (§ 12), one new function `release_rider_assignment()` — `SECURITY
> INVOKER`, callable only by `service_role` (§ 13) — and **104/104**
> assertions across five suites. § 12 and § 13 carry the current figures.

Six tables were deliberately deferred, each with a stated reason and
dependency, none removed from the conceptual design. Four small internal
inconsistencies in the design document were found and resolved in favour of
the more specific source. One deliberate simplification (a column-scoped
rider view, flagged as DBQ-015) was flagged rather than silently
under-delivered — and has **since been implemented**, together with the
row-isolation hardening the Architect Review then required on top of it
(§ 12). It is no longer a deferral.

The rider race condition — the single most safety-critical property in this
schema — was proven by launching genuinely concurrent client processes
against a running PostgreSQL instance, not by reading the SQL, and the
exercise reproduced the architecture review's own HIGH finding precisely
enough to reveal it is a sharper failure mode (a hard constraint-violation
error, not a silent no-op) than the original finding described.

---

## 12. Architect Review findings, Step 7.2 + 7.3 — HIGH-1: fixed

**Status: fixed**, migration `20260811000012_rider_order_views.sql` (edited
in place across two review passes — see "Migration strategy" at the end of
this section for why).

**This section was rewritten during Step 7.3.** The Step 7.2 version of this
report made a safety claim that Step 7.3's Architect Review disproved by
execution: it stated that moving the row check "from a policy to a view
predicate" was sufficient on its own. It is not — see finding H-1 below.
Nothing about the earlier claim is repeated here uncorrected.

**Finding.** § 7 of this report already flagged the underlying issue as a
known simplification (DBQ-015): the rider's RLS policies on
`orders`/`order_items`/`order_item_options` were correctly scoped at the
**row** level (`is_assigned_order_rider()`, proven in § 4.3 F5) but granted
**full-row** access once assigned — every money column, `payment_method`,
`customer_id`, and `address_id` on `orders`, plus the two price columns on
`order_items` and `order_item_options`. The Architect Review confirmed this
as a HIGH finding: a rider client could `SELECT *` and receive the complete
financial breakdown of an order it merely delivers.

**1. What a rider CAN select** (via three new views, granted to
`authenticated`):

| View | Columns |
|---|---|
| `rider_order_view` | `id`, `order_number`, `state`, `restaurant_id`, `restaurant_name_snapshot`, `delivery_address_snapshot`, `delivery_lat`, `delivery_lng`, `delivery_landmark`, `recipient_name_snapshot`, `recipient_phone_snapshot`, `distance_m`, `quoted_eta_minutes`, `placed_at`, `accepted_at`, `ready_at`, `picked_up_at`, `delivered_at`, `cancelled_at`, `created_at`, `updated_at` |
| `rider_order_item_view` | `id`, `order_id`, `item_name_snapshot`, `quantity`, `note`, `created_at` |
| `rider_order_item_option_view` | `id`, `order_item_id`, `group_name_snapshot`, `option_name_snapshot`, `created_at` |

**2. What a rider CANNOT select.** Not merely nulled — **not a column on the
view at all**, proven by `undefined_column` (42703) in § domain test G3/G7/G9:
`subtotal_satang`, `delivery_fee_satang`, `service_fee_satang`,
`discount_satang`, `grand_total_satang`, `currency`, `payment_method`,
`customer_id`, `address_id`, `cause_code` (orders); `unit_price_satang`,
`line_total_satang`, `menu_item_id` (order_items); `price_delta_satang`,
`menu_option_id` (order_item_options). Phase 1 is online-payment-only
(DEC-016) — a rider never collects money and has no operational need for any
of these.

**3. Why the rider's base-table SELECT was removed, and why the views exist.**
Column-level `GRANT` is per database *role*, and `authenticated` is the one
role shared by customer, merchant, and rider (DEC-033) — there is no way to
give a rider a narrower column set than a customer on the same table via
`GRANT` alone. So the rider's SELECT policies on the three base tables are
**dropped** (`orders_select_rider`, `order_items_select_rider`,
`order_item_options_select_rider`; customer/merchant policies untouched). A
rider querying `orders`/`order_items`/`order_item_options` directly now
matches zero policies and gets zero rows — proven in § domain test G4. The
three views are the rider's *only* remaining read path, and their column
list is the only column-level restriction mechanism available here at all.

**4. How the views restrict columns.** By construction, not by permission: a
column the view does not project (every money column, `payment_method`,
`customer_id`, `address_id`, `cause_code`, and every catalogue price column)
does not exist as far as any query against the view is concerned. `select *
from rider_order_view` cannot return `grand_total_satang` regardless of what
SQL a client sends — there is no client-supplied input that can widen a
view's own column list.

**5. How the views restrict rows, and why `security_barrier` is required —
not optional.** The three views are created **without `security_invoker`**
(the pre-PG15 default: a view runs with its owner's privileges). Since the
migration role owns every table in this schema and Postgres exempts a
table's owner from its own RLS unless `FORCE ROW LEVEL SECURITY` is set
(nothing in this schema sets it), the views can still read rows the rider's
own policy no longer permits. The views' `where` clause reuses the identical
`is_assigned_order_rider()` function the dropped policies called — but
**owner-privilege access plus that predicate is not, on its own, equivalent
to what the RLS policy provided**, because Postgres is free to reorder a
plain view's `WHERE` clauses by estimated cost. `is_assigned_order_rider` is
a SQL function, not marked `LEAKPROOF`, and does not get the automatic
protection a policy's `USING` clause gets (Postgres always treats a row
policy as a security qual, forcing it to evaluate before any query-supplied
predicate — a plain view has no such guarantee).

**Finding H-1 (Architect Review, Step 7.3):** this gap is exploitable. A
rider issuing `select * from rider_order_view where 1 / (case when
recipient_phone_snapshot like '+6689%' then 0 else 1 end) = 1` raised
`division_by_zero` for a phone number belonging to an order that was never
theirs — an error-based oracle able to binary-search any *projected* column
(address, phone, name, order number) across every order in the system,
without that order ever being returned as a row. Proven by direct execution
against a local container, both with and without the fix.

**The fix:** all three views now set `security_barrier = true`, in addition
to `security_invoker = false`. This forces the planner to fully evaluate the
view (including `is_assigned_order_rider`) as an opaque barrier before any
predicate from the outer query is applied to its output — closing the qual-
reordering gap. Re-running the identical oracle probe after the fix returns
a clean result (see § 6 below and
`supabase/tests/rider_view_row_isolation_security_test.sql`).

**6. What was verified locally, by execution, not by reading the SQL:**

- `security_barrier=true` is present in `pg_class.reloptions` for all three
  views (structural check, independent of the planner's cost-based choices).
- The exact oracle probe from the Architect Review — an error-raising
  predicate on `delivery_address_snapshot` and `recipient_phone_snapshot`
  that matches only a "victim" order belonging to a different rider — was
  re-run against the fixed views and returns cleanly (no error), for
  `rider_order_view`, and the same probe shape against
  `rider_order_item_view` (`item_name_snapshot`) and
  `rider_order_item_option_view` (`option_name_snapshot`).
- A **control** probe using the identical predicate shape against the
  rider's own, legitimately visible row *does* raise the error — this is
  what proves the probe is a real oracle when nothing is blocking it, not
  that the test predicate silently never fires.
- Permitted columns/rows and the "forbidden column is structurally absent"
  property (§ domain test G-series) were re-verified unaffected by adding
  `security_barrier`.
- Customer and merchant access to `orders`, money columns included, is
  unaffected — verified directly, not assumed.

**7. What remains a limitation, stated plainly:** this was verified with
direct SQL against a local PostgreSQL container connected as the
`authenticated` role, which is how the rider's own database session behaves.
Whether PostgREST's HTTP filter grammar (the layer a mobile client actually
talks to in front of Supabase) can express an error-raising expression of
this exact shape was **not** verified in this pass — casts are the most
likely such vector, and checking that is a PostgREST-layer concern, not a
schema one. This does not change the fix or the verdict: the mitigation
(`security_barrier`) removes the underlying database-level gap regardless of
which client surface might have reached it, so this limitation is about
*how confident we are the vector was reachable*, not about whether it is now
closed at the database.

**Corrects DBQ-015's own recommendation on two points**, not one: DBQ-015
suggested `security_invoker = true`, which does not work once the rider's
base-table policy is removed (an invoker-security view still evaluates RLS
as the querying role, so a rider would see zero rows through it too). The
Step 7.2 pass corrected that to owner-privilege access
(`security_invoker = false`) plus the `is_assigned_order_rider()` predicate
— which Step 7.3 then found was **still insufficient** without
`security_barrier = true`. **DBQ-015 is resolved with this fix in place**;
see `docs/OPEN_DATABASE_QUESTIONS.md` for the caveat noted there (§ 7 above,
"what remains a limitation").

`deliveries`, `restaurants`, and `addresses` were reviewed per the finding's
instructions and left unchanged: `deliveries`' rider-visible columns are the
delivery's own operational data (including the rider's *own*
`rider_earning_satang`, not the order's price breakdown); `restaurants` is
already public for `ACTIVE` restaurants; `addresses` already has no rider
policy at all (the dropoff address a rider needs comes from the order
snapshot, now served by `rider_order_view`).

**Migration strategy — why `20260811000012` was edited in place, not
patched by a new migration:** this migration has never been applied to any
environment but a throwaway local Docker container torn down after each
test run (never the live `banhao-dev` project, never anything shared). Its
own two review passes (Step 7.2, Step 7.3) both happened before merge.
Adding a third migration that immediately `ALTER VIEW`s what the second one
just created would leave a confusing, purely-cosmetic step in permanent
migration history — "migration N creates an insecure view, migration N+1
fixes it three minutes later" — for no benefit, since nothing outside this
branch has ever depended on the intermediate, vulnerable definition.
Editing the file in place keeps the history deterministic and reviewable:
one migration, one final correct definition. `20260811000013` (HIGH-2) was
left untouched — it was already reviewed and approved as merge-ready, and
none of Step 7.3's findings concern its atomicity logic.

---

## 13. Architect Review findings, Step 7.2 — HIGH-2: fixed

**Status: fixed**, migration `20260811000013_rider_reassignment_atomicity.sql`.

**Finding.** § 4.4 of this report already proved, by execution, that an
*incomplete* release (statement 1 of § 11.1's release invariant without
statement 2) leaves a delivery permanently unassignable and makes the next
claim attempt crash with an unhandled `23505 unique_violation`. The
underlying race protection (`rider_assignments_one_active`, the guarded
conditional `UPDATE`) is correct and was not changed. What was missing was a
single database-owned entry point that makes "both statements, one
transaction" a property of the API surface rather than a rule every caller
has to remember.

**The fix.** `public.release_rider_assignment(delivery_id uuid, status text,
reason text)` — service-role-only, `SECURITY INVOKER` (see the "security
model, corrected" note below — this is a Step 7.3 correction; Step 7.2
originally shipped it `SECURITY DEFINER`). Inside one function invocation
it:

1. Locks the delivery row and reads the currently-assigned rider
   (`SELECT ... FOR UPDATE`, guarded on `state IN ('RIDER_ASSIGNED',
   'RIDER_REASSIGNING') AND rider_id IS NOT NULL`) — raises immediately if
   the delivery is not actually releasable.
2. Clears `deliveries.rider_id`, advances `state` to `RIDER_SEARCHING`, and
   increments `reassignment_count`, guarded on the same condition.
3. Closes the matching `rider_assignments` row (`delivery_id` **and**
   `rider_id` both matched, so it cannot cross-close a different rider's
   row), setting `status` to the caller-supplied `CANCELLED` or `RELEASED`.
4. Verifies step 3 affected **exactly one row**. If not, it raises — and
   because steps 2 and 3 both ran inside this single statement, Postgres
   rolls back step 2 as well. The function can never return having cleared
   `rider_id` while leaving a stale `ACCEPTED` assignment behind — the exact
   half-done state the original finding described.

**Why this is safe if the application crashes mid-operation.** A crash
between steps 2 and 3 is not possible from outside this function, because
both are inside one function call = one statement = one unit of work from
the calling transaction's point of view. If the calling NestJS process dies
before the call returns, the surrounding transaction is simply never
committed — ordinary Postgres behaviour, not something this migration adds.
If a future caller manages to invoke only *half* of the release by going
around this function (a raw two-statement bypass), the untouched
`rider_assignments_one_active` unique index is still the backstop — proven
directly in the new regression tests (Case E) by deliberately reproducing
that exact bypass and confirming it still cannot produce two `ACCEPTED`
rows.

**What stays an application-layer decision, by design (ADR-001):** *when* to
release a rider (a tap-to-cancel, a no-response timeout, an operator's
forced reassignment) and whether that release is recorded as `CANCELLED` or
`RELEASED`. This function makes the resulting write atomic; it does not
decide when to call it.

**Security model, corrected (Architect Review, Step 7.3, finding M-1).** The
Step 7.2 version of this function was `SECURITY DEFINER`, matching
`set_user_role`'s pattern, with an internal guard —
`pg_has_role(current_user, 'service_role', 'member')` — described as
"defence-in-depth" alongside the `EXECUTE` grant. **That description was
wrong, proven by execution:** inside a `SECURITY DEFINER` function,
`current_user` resolves to the function's **owner**, not the caller. After
granting `EXECUTE` to `authenticated` (simulating a future accidental
over-grant) a rider successfully called the function and released
*another* rider's delivery — the guard was silently checking whether the
*owner* (a superuser in the test container, which auto-passes any
`pg_has_role` check) was a `service_role` member, never the actual caller.
The guard was not providing the second layer it claimed to.

**The fix:** the function is now `SECURITY INVOKER` (the `security definer`
clause is removed). Two consequences, both verified:

- `current_user` inside the function is now genuinely the caller's active
  role, so the guard means what it says. Re-running the identical
  over-grant probe after the fix: the same call now raises `release_rider_
  assignment may only be called by the service role` (42501) — the guard is
  real defence-in-depth now, not vestigial.
- `SECURITY DEFINER` was not actually needed for `service_role` to do this
  work: `service_role` already has `bypassrls` and direct table grants on
  `deliveries`/`rider_assignments` (the `revoke all ... from anon,
  authenticated` statements in earlier migrations never touch
  `service_role`), so an invoker-mode call under `service_role` succeeds on
  its own privileges with no owner substitution required. This also closes
  a second-order risk `SECURITY DEFINER` carried: had `EXECUTE` ever been
  mistakenly over-granted, the *entire function body* — not just the guard
  — would previously have run with the owner's elevated privileges,
  letting a misconfigured grant actually mutate data as any caller. Under
  `SECURITY INVOKER`, the same misconfiguration would additionally require
  the caller to hold the underlying table privileges, which `authenticated`
  does not.

The primary protection remains the `EXECUTE` grant (`service_role` only,
unchanged); the in-body check is confirmed, not merely claimed, to be a
real second layer.

**Regression tests — Cases A–E**, `supabase/tests/rider_reassignment_atomicity_test.sql`:

| Case | What it proves | Result |
|---|---|---|
| A | Normal claim → atomic release → a new rider claims immediately | PASS |
| B | Two riders claim simultaneously → exactly one winner (re-asserted from the genuinely concurrent execution in § 4.4; that mechanism is untouched) | PASS |
| C | The released rider's own assignment row is `RELEASED` with `closed_at` set — never left stale `ACCEPTED` | PASS |
| D | A new rider can claim the same delivery immediately after a valid atomic release | PASS |
| E | `release_rider_assignment` refuses a non-service caller, an invalid status, and an un-releasable delivery — each rejection leaves the delivery/assignments completely unchanged; and a hand-rolled bypass of the function (reproducing the original incomplete release directly against the base tables) is still blocked from producing two `ACCEPTED` rows by the pre-existing unique index | PASS |

15/15 new assertions pass, unaffected by the Step 7.3 `SECURITY INVOKER`
change above — re-run and confirmed. Full run, Step 7.3:
**104/104** across five suites (RLS 13/13; domain invariants incl. HIGH-1
§G 49/49; the new
`rider_view_row_isolation_security_test.sql` 13/13 — see § 12 above; the
pre-existing rider race 14/14; HIGH-2 Cases A–E 15/15) — see EVENT-020 in
`ai/KNOWLEDGE/EVENTS.md`. (EVENT-019 recorded the Step 7.2 pass at 91/91,
before the security test existed.)
