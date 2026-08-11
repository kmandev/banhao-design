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

**One known simplification, flagged rather than hidden:** § 18 of
`docs/DATABASE_DESIGN.md` calls for "limited columns via a view" for a
rider's read of `orders`/`order_items` once assigned. This migration grants
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

**DBQ-015 — column-scoped rider view for orders/order_items.** § 18 of the
database design calls for "limited columns via a view" for a rider's order
read once assigned; this migration implements full-row access at the
correct row-level scope instead (§ 7 above). Recommend a follow-up migration
adding `rider_order_view` / `rider_order_item_view` with
`security_invoker = true` (PostgreSQL 15+) once the exact column set a rider
needs is specified. Priority D2 — the security boundary that matters
(row-level) is already enforced; this is a refinement.

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

## 11. Summary

**40 tables, 62 foreign keys, 61 check constraints, 110 indexes, 55 RLS
policies, 52 triggers, 9 new functions — 11 migrations, 60/60 executable
assertions passing against real PostgreSQL, zero changes to the live
Supabase project.**

Six tables were deliberately deferred, each with a stated reason and
dependency, none removed from the conceptual design. Four small internal
inconsistencies in the design document were found and resolved in favour of
the more specific source. One deliberate simplification (a column-scoped
rider view, deferred as DBQ-015) is flagged rather than silently
under-delivered.

The rider race condition — the single most safety-critical property in this
schema — was proven by launching genuinely concurrent client processes
against a running PostgreSQL instance, not by reading the SQL, and the
exercise reproduced the architecture review's own HIGH finding precisely
enough to reveal it is a sharper failure mode (a hard constraint-violation
error, not a silent no-op) than the original finding described.
