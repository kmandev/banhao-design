# Open Database Questions

Unresolved **technical** questions from the database design pass (EVENT-016,
2026-08-11), alongside [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md).

**Nothing here is an assumption.** An agent may not close any of these — only a
Product Owner decision can. **Two were closed on 2026-08-11**: DBQ-002 by
DEC-033 and DBQ-010 by DEC-034. **DBQ-015 was implemented on 2026-08-11**,
directed by the Architect Review's HIGH-1 finding (EVENT-019) rather than a
Product Owner decision — it was a security implementation gap, not a
business question, so no `DEC` was needed to act on it. **Marked IMPLEMENTED
WITH CAVEAT, not fully resolved**, after a second Architect Review pass
(Step 7.3, EVENT-020) found the first implementation's row-isolation
mechanism was incomplete and required a further fix
(`security_barrier = true`); the caveat that remains after the fix is a
verification-scope note, not a known gap — see the DBQ-015 entry below.
**11 of 14 business/legal-gated questions remain open.**

## Namespaces

Five registers, no overlap. Cross-reference; never duplicate.

| Series | Subject | Home | Owner |
|---|---|---|---|
| `Q-NNN` | Original open questions | `ai/KNOWLEDGE/QUESTIONS.md` | Product Owner |
| `BQ-NNN` | Business questions | `docs/OPEN_BUSINESS_QUESTIONS.md` | Product Owner |
| `TQ-NNN` | Architecture questions | `docs/OPEN_TECHNICAL_QUESTIONS.md` | Architecture review |
| **`DBQ-NNN`** | **Database questions** | **this file** | Database review |
| `DQ-NN` | Customer App design questions | `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md` | Product Owner |

**Business questions are not database decisions.** Where the schema is shaped by
an undecided business rule, the entry points at the `BQ`/`Q` and stops — it does
not propose a business answer.

## Priority

| | Meaning |
|---|---|
| **D0** | Blocks writing the first migration |
| **D1** | Blocks production readiness |
| **D2** | Refine later; no migration cost to defer |

## Summary

| ID | Question | Priority | Gated on |
|---|---|---|---|
| DBQ-001 | Is PostGIS needed in Phase 1? | D2 | — |
| ~~DBQ-002~~ | ~~Role model~~ — **ANSWERED by DEC-033** | — | closed 2026-08-11 |
| DBQ-003 | Ledger depth — is one entry group per event enough? | D1 | — |
| DBQ-004 | Bank account number storage and encryption | D1 | Q-002 |
| DBQ-005 | Rider location: latest-only vs history | D1 | **Q-012** |
| DBQ-006 | Overnight opening hours | D2 | BQ-007 |
| DBQ-007 | Enforce one active delivery per rider in the DB? | D2 | **BQ-021** |
| DBQ-008 | Retention windows and purge jobs | D1 | **Q-012** |
| DBQ-009 | Audit `before`/`after` PII redaction | D1 | Q-012 |
| ~~DBQ-010~~ | ~~Zero-sum enforcement~~ — **ANSWERED by DEC-034** | — | closed 2026-08-11 |
| ~~DBQ-011~~ | ~~Order number generation~~ — **ANSWERED by DEC-E-03** | — | closed 2026-08-19 |
| DBQ-012 | Connection pooling and the service-role connection | D1 | TQ-005 |
| DBQ-013 | Naming: `DRIVER` role vs `rider_*` tables | D2 | — |
| DBQ-014 | Where do notification preferences live? | D2 | BQ-035 |
| ~~DBQ-015~~ | ~~Column-scoped rider view for orders/order_items~~ — **IMPLEMENTED WITH CAVEAT** | — | 2026-08-11, 2 passes |

---

## DBQ-001 — Is PostGIS needed in Phase 1?

**Priority:** D2 · **Status:** OPEN

**Question:** Keep PostGIS, or use plain `numeric` lat/lng with distance
computed in the application?

**Context:** PostGIS is **already enabled** (migration 1) and costs nothing
unused. The design uses it for a generated `geography` column plus GiST indexes
on `restaurants.location` and `rider_availability.location`.

**For keeping it:** `ST_DWithin` is the natural expression of the dispatch
eligibility filter ("online riders within N km"), and it is indexable. Doing
that in the application means loading every online rider and filtering in
TypeScript — fine at 12 riders, silly at 200.

**Against:** with 8–12 riders and ~50 restaurants, a full scan plus a Haversine
calculation is genuinely negligible, and PostGIS is a large extension to carry
for two queries.

**Recommendation:** keep it — it is already installed, so the question is only
whether to *use* it, and the generated-column approach means removing it later
would touch two columns and two indexes, not the data. Low stakes either way.

---

## DBQ-002 — Role model: `user_roles` vs `profiles.role` deprecation

**Priority:** ~~D0~~ · **Status: ✅ ANSWERED — DEC-033, 2026-08-11**

> **Answer: neither option offered.** The Product Owner chose **domain
> membership**: `restaurant_members` for merchants, `riders` for riders,
> `platform_staff` for operators/admins, and **Customer implicit** for every
> authenticated profile. **No generic `user_roles` table is built** — where a
> domain table exists, membership *is* the grant. `profiles.role` is deprecated
> and non-authoritative.
>
> The residual work is not a question but an implementation task: `RolesGuard`,
> `set_user_role()` and the immutability trigger still read `profiles.role`, so
> the column cannot be dropped until code changes. Tracked in `docs/TODO.md`.
>
> The original question is preserved below for context.

**Question:** Adopt `user_roles` as authoritative and deprecate
`profiles.role`, or keep the single column?

**Context:** `DATABASE_DESIGN.md` § 4.2 recommends `user_roles`, because a
single column breaks a realistic case: **a rider or a restaurant owner cannot
also be a customer.** In a district this small, they are the same people.

**Why it is D0:** every RLS policy and every guard downstream depends on which
one is authoritative. Choosing after the first migration means rewriting
policies.

**What the change costs, precisely** — this is not a pure schema change:

1. `user_roles` added and backfilled from `profiles.role`.
2. **`RolesGuard` must read `user_roles`** — a code change in `apps/api`,
   outside the scope of the design step.
3. `set_user_role()` and the `role` clause inside
   `enforce_profile_immutable_columns()` are replaced by
   `grant_user_role()` / `revoke_user_role()`.
4. `profiles.role` dropped only after (2) ships.

**Recommendation:** adopt `user_roles`; make `CUSTOMER` implicit rather than a
stored row. **Until `profiles.role` is dropped, exactly one of the two is
authoritative and it must be `user_roles`** — a period where both are readable
is the actual risk, not the migration itself.

---

## DBQ-003 — Ledger depth: is one entry group per event enough?

**Priority:** D1 · **Status:** OPEN

**Question:** Is the proposed group + signed-entries model sufficient, or does
Phase 1 need per-party running balances?

**Context:** § 10 proposes `ledger_entry_groups` + signed `ledger_entries`
summing to zero per group, deliberately short of double-entry bookkeeping with a
chart of accounts.

**Considerations:** "what does BANHAO owe this merchant right now?" becomes a
`SUM` over `ledger_entries` filtered by party. At Phase 1 volume that is
trivially fast, and a materialised balance is a cache that can disagree with the
ledger — the classic source of financial bugs. It only becomes attractive at a
volume BANHAO does not have.

**Recommendation:** no running balances in Phase 1. Revisit only if a settlement
query becomes measurably slow — and then as a materialised view derived from the
ledger, never a hand-maintained column.

---

## DBQ-004 — Bank account number storage and encryption

**Priority:** D1 · **Status:** OPEN · **Gated on:** Q-002

**Question:** Is a full bank account number stored at all, and if so, encrypted
how?

**Context:** `merchant_bank_accounts` proposes `account_number_last4` plus
`account_number_encrypted`. Only `last4` is ever returned by an API.

**Must be answered:** whether BANHAO stores the full number or the payout
provider holds it (which depends on Q-002's settlement model) · `pgcrypto` vs
application-level encryption vs Supabase Vault · where the key lives (TQ-009) ·
who may decrypt, and whether that is audited.

**Recommendation:** **do not store the full number** if the eventual payout
provider can hold it — the cheapest way to secure a secret is not to have it.
Blocked on Q-002.

---

## DBQ-005 — Rider location: latest-only vs history

**Priority:** D1 · **Status:** OPEN · **Gated on:** **Q-012**

**Question:** Store only the rider's latest position, or a track?

**Context:** The design stores **latest position only**, on
`rider_availability`. No history table exists. 🔴 Q-012 (PDPA) is
`LEGAL_REVIEW_REQUIRED`, and BQ-022 notes granular tracking is a factor in
worker-classification arguments.

**Considerations:** customer live-tracking during a delivery needs only the
latest point. A track would be needed for delivery-dispute evidence or distance
verification — neither is a Phase 1 requirement. Write volume also matters: a
ping every few seconds per rider is the highest-frequency write in the system,
and a history table turns that into unbounded growth.

**Recommendation:** latest-only, as designed. **No location history table should
be created before Q-012 is answered** — this is the one place where the cheapest
engineering choice and the lowest legal risk point the same way.

---

## DBQ-006 — Overnight opening hours

**Priority:** D2 · **Status:** OPEN · **Gated on:** BQ-007

**Question:** How is a restaurant open past midnight represented?

**Context:** `restaurant_hours` has `check (closes_at > opens_at)`, which
forbids `18:00 → 02:00`.

**Options:** two rows (`18:00–23:59`, `00:00–02:00`) · a `crosses_midnight`
boolean · drop the check and handle it in the derivation.

**Recommendation:** two rows — no schema change, and the "is it open now?"
derivation stays a simple range test. Confirm with BQ-007 whether any Buntharik
merchant actually trades past midnight before adding complexity for it.

---

## DBQ-007 — Enforce one active delivery per rider in the database?

**Priority:** D2 · **Status:** OPEN · **Gated on:** **BQ-021**

**Question:** Add a partial unique index on `deliveries (rider_id) where state
in (<active>)`?

**Context:** BQ-021 (rider batching) is `OPEN`; the recommendation there is one
job at a time for launch, but **it is not decided**. The design therefore leaves
the limit as a service-layer check against configuration.

**Considerations:** a unique index would make a second concurrent assignment
impossible — attractive, given how carefully the rider race is guarded. But it
hard-codes a business rule that is explicitly undecided, and reversing it if
batching is approved means a migration.

**Recommendation:** **do not add the index** until BQ-021 is answered. A
configurable service-layer check is reversible; a unique index is not. This is
the correct instance of "do not turn a business question into a database
decision".

---

## DBQ-008 — Retention windows and purge jobs

**Priority:** D1 · **Status:** OPEN · **Gated on:** **Q-012**

**Question:** How long is each purgeable table kept?

**Context:** § 13 sets the *principle* — records that answer "what happened and
who owed whom" are retained; scaffolding is purged — but no window.

**Needs a number:** `outbox` (dispatched), `jobs` (completed),
`idempotency_records` (~30 days proposed), `notification_deliveries`,
`payment_events` raw payloads, `audit_logs`.

**The tension:** CON-003 needs financial history indefinitely; PDPA (Q-012,
BQ-004) grants erasure. § 13 resolves it as **anonymise the person, keep the
record** — but the windows themselves are `LEGAL_REVIEW_REQUIRED`.

**Recommendation:** none. Set with Q-012 and TQ-007 (backup/restore), since a
retention window is meaningless if backups hold the data for longer.

---

## DBQ-009 — Audit `before`/`after` PII redaction

**Priority:** D1 · **Status:** OPEN · **Gated on:** Q-012

**Question:** Which columns are redacted from `audit_logs.before` / `.after`?

**Context:** § 16 proposes capturing changed columns only, with phone, address
and bank fields redacted at write time.

**Why it matters:** an unredacted audit log quietly becomes a **second, older,
un-erasable copy of every customer's personal data** — and one that a PDPA
erasure request cannot easily reach, because it is deliberately immutable. That
turns the audit trail from an asset into a liability.

**Recommendation:** allow-list the columns worth auditing per table rather than
deny-listing PII. An allow-list fails safe when someone adds a column.

---

## DBQ-010 — Zero-sum enforcement: constraint trigger vs application check

**Priority:** ~~D0~~ · **Status: ✅ ANSWERED — DEC-034, 2026-08-11**

> **Answer: application check, not a trigger — for Phase 1.** The recommendation
> below (deferred constraint trigger) was **rejected**. Integrity comes from
> immutable records, database constraints, NestJS transactions, idempotency,
> auditability and **reconciliation**.
>
> **CON-003 is not repealed** — the invariant stands, its enforcement point
> moves. The consequence to carry forward: **the reconciliation process is now
> mandatory and needs an alert (TQ-006)**, because without the trigger it is the
> only thing that would notice drift. A stronger ledger invariant is explicitly
> available in a later phase.
>
> The original analysis is preserved below for context.

**Question:** Enforce CON-003 with a `DEFERRABLE INITIALLY DEFERRED` constraint
trigger at commit, or assert it in the ledger service?

**Context:** § 10 proposes the deferred constraint trigger. It must be deferred:
entries are inserted individually and the group only balances once all are
present.

**For the trigger:** CON-003 becomes physically impossible to violate, including
from a migration, a manual fix, or a future module that writes the ledger
wrongly. It is the strongest possible expression of the project's most important
financial invariant.

**Against:** it is business logic in the database, which ADR-001 otherwise
avoids; deferred triggers are unfamiliar and can surprise at commit time; and it
runs on every ledger write.

**Recommendation:** **use the trigger.** § 1 already carves out integrity
constraints as the legitimate exception, and "the ledger balances" is an
integrity constraint, not a business rule — the *amounts* are business rules,
the *invariant* is arithmetic. Belt and braces: assert in the service too, so
the error surfaces with domain context rather than as a commit-time exception.

---

## DBQ-011 — Order number generation

**Priority:** ~~D1~~ · **Status: ✅ ANSWERED — DEC-E-03, 2026-08-19**

> **Answer: the recommendation below, ratified.** The format is
> **`BH-YYYYMMDD-NNNN`** — `BH-` prefix, the Asia/Bangkok business date, and a
> sequence that resets each business day, zero-padded to at least four digits.
> Generated **server-side only**; a client may never supply or influence it;
> uniqueness is owned by the database (`orders_order_number_key`), not by
> application checks.
>
> Settled before the first order exists, exactly as the recommendation
> required — `order_number` is `not null unique` and is listed in
> `orders_enforce_immutable_columns()`, so it can never be rewritten.
>
> The *generation mechanism* (Postgres sequence, counter table, or derivation
> inside the `create_order` function of DEC-E-02) is an implementation choice
> left to Phase E; the database owns the uniqueness guarantee in every case.

**Question:** How is the customer-visible `order_number` (e.g. `BH000125`)
generated?

**Context:** Unique, human-readable, read aloud on the phone to support.

**Options:** Postgres sequence + prefix (simple, but leaks order volume to
anyone who orders twice) · random base32 (no leak, harder to read aloud) ·
date-prefixed sequence `BH-20260811-0042` (readable, leaks only daily volume).

**Considerations:** at ~50 restaurants a competitor could trivially measure
BANHAO's total volume from two orders a week apart. Support usability argues for
short and speakable; Thai phone support argues against ambiguous characters.

**Recommendation:** date-prefixed daily sequence. Decide before the first order
exists — changing the format later means two formats in support forever.

---

## DBQ-012 — Connection pooling and the service-role connection

**Priority:** D1 · **Status:** OPEN · **Gated on:** TQ-005

**Question:** Does the API connect through Supabase's pooler or directly, and
how many connections do API + worker need?

**Context:** ADR-010 runs two processes, both on the service-role connection.
Supabase's free tier has a low direct-connection limit; the transaction-mode
pooler does not support session-level features.

**Must be answered:** session vs transaction pooling · whether `FOR UPDATE SKIP
LOCKED` job polling behaves correctly through the pooler · pool sizing for two
processes · whether `LISTEN/NOTIFY` is wanted (it does **not** work through
transaction-mode pooling — relevant if outbox polling is ever replaced).

**Recommendation:** decide with TQ-005. Note that the design's row-level
guarded updates and `SKIP LOCKED` polling are all transaction-scoped, so
transaction-mode pooling should be viable — but that needs verifying, not
assuming.

---

## DBQ-013 — Naming: `DRIVER` role vs `rider_*` tables

**Priority:** D2 · **Status:** OPEN

**Question:** Should the live `user_role` value `DRIVER` be renamed `RIDER`, or
the tables renamed `driver_*`?

**Context:** A genuine inconsistency across accepted documents.
`REQ-004`/`DEC-005` require **generic** entity names for cross-phase reuse, and
`DOMAIN_MODEL.md` names the core entity `Driver` with `Rider` as the Phase-1
alias — so the enum's `DRIVER` is *correct* by that rule. But **DEC-020/021/022
approved state names `RIDER_SEARCHING`, `RIDER_ASSIGNED`, `RIDER_REASSIGNING`**,
and the technical architecture uses `rider_*` throughout.

**Options:** keep both (generic role, Phase-1 table names) · rename tables to
`driver_*` · rename the enum value to `RIDER` (a breaking change to a live enum
referenced by a function and a trigger).

**Recommendation:** **keep both, and say so in one place.** The role is generic
because it must survive Phase 3 (Ride), where the person is a chauffeur, not a
rider; the tables match the approved `RIDER_*` state vocabulary that the Product
Owner signed off. Renaming a live enum value for tidiness is churn with a real
migration cost and no functional gain.

---

## DBQ-014 — Where do notification preferences live?

**Priority:** D2 · **Status:** OPEN · **Gated on:** BQ-035

**Question:** Is there a per-user channel preference table, or is the channel
decided by event type alone?

**Context:** § 16 designs `notifications` + `notification_deliveries` but no
preference table, because **BQ-035 (the event × channel matrix) is a business
question and unanswered**.

**Considerations:** transactional order notifications are usually not opt-out;
marketing is. Phase 1 has no marketing. A preference table with nothing to
prefer is dead weight.

**Recommendation:** none in Phase 1. Add only when BQ-035 lands and there is a
choice worth storing. Device push tokens **will** be needed (a separate small
table) once a push provider is chosen — TQ-003.

---

## DBQ-015 — Column-scoped rider view for orders/order_items

**Priority:** ~~D2~~ · **Status: ⚠️ IMPLEMENTED WITH CAVEAT — 2026-08-11, Architect Review HIGH-1, two passes (EVENT-019, EVENT-020)**

> **Answer: implemented, in the end, differently from either this entry's own
> recommendation or the first fix attempt** — both were corrected in turn.
> `20260811000012_rider_order_views.sql` adds `rider_order_view`,
> `rider_order_item_view`, and `rider_order_item_option_view`; the rider's
> full-row policies on `orders`/`order_items`/`order_item_options` are
> dropped.
>
> **First correction (Step 7.2, EVENT-019):** this entry recommended
> `security_invoker = true`. That does not work once the rider's base-table
> policy is dropped — an invoker-security view still evaluates the querying
> role's own RLS, so a rider would see zero rows through it too. Fixed by
> using `security_invoker = false` (owner-privilege) instead, so the view can
> still read rows the rider's own RLS no longer permits directly.
>
> **Second correction (Step 7.3, EVENT-020):** owner-privilege access plus
> the `is_assigned_order_rider()` predicate was **still not sufficient on its
> own**. A second Architect Review pass proved, by execution, that a
> rider-supplied predicate could be evaluated by the planner BEFORE the
> view's own security predicate — an error-based oracle that could
> disclose any projected column of any order in the system without that
> order ever being returned as a row. Fixed by adding
> `security_barrier = true` to all three views, which forces the security
> predicate to evaluate first. Re-verified by execution: the exact oracle
> probe that found the gap now returns cleanly. See
> `supabase/tests/rider_view_row_isolation_security_test.sql`.
>
> **The caveat this status reflects:** the fix was verified with direct SQL
> against the `authenticated` database role, which is how a rider's session
> genuinely behaves. Whether PostgREST's HTTP filter grammar (the layer a
> mobile client actually talks to) can express an error-raising expression of
> the shape used in the proof was not separately verified — that is a
> PostgREST-layer reachability question, not a schema one, and does not
> change what was fixed at the database level. This is why the status here
> is IMPLEMENTED WITH CAVEAT rather than a plain closed/resolved.
>
> Full detail: `docs/DATABASE_MIGRATION_V1_REPORT.md` § 12.
>
> The original question is preserved below for context.

**Question:** Should a rider's read access to `orders`/`order_items` be
narrowed to specific columns via a view, as `docs/DATABASE_DESIGN.md` § 18
originally called for ("limited columns via a view"), rather than the
full-row access `20260811000011_rls_policies.sql` actually grants?

**Context:** Raised during Supabase Migration v1
(`docs/DATABASE_MIGRATION_V1_REPORT.md` § 7). Postgres RLS is row-level, not
column-level, and column-level `GRANT` is per database role — `authenticated`
is shared by every client actor — so giving a rider a genuinely different
column set than a customer/merchant on the *same table* cannot be done with
grants alone. The migration implements the row-level boundary correctly
(`is_assigned_order_rider()` — a rider sees only their own assigned order,
proven by execution) but grants the **full row** once assigned, rather than a
narrower column set.

**Considerations:** the row-level boundary is what the mandatory security
tests target and is fully enforced. The column-level refinement is about
*which* fields of an order a rider can see once legitimately assigned to
it — e.g. whether they need the customer's full phone number or only a
masked form. No field has been identified as actually sensitive enough to
justify the added complexity; this is a hardening item, not a known leak.

**Recommendation:** add `rider_order_view` / `rider_order_item_view` with
`security_invoker = true` (PostgreSQL 15+, so the view still evaluates the
querying user's own RLS/`auth.uid()`) once the exact column set a rider needs
for delivery is specified. Low priority — the security boundary that matters
today is already enforced.
