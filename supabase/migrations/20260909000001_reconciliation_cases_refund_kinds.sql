-- BANHAO — LOCK DEC-060: reconciliation_cases gains the six Q-020 refund
-- anomaly kinds, plus a dedup index scoped to them
--
-- DEC-060 (docs/DECISIONS.md) locked the schema Q-020 Slice 4's reconciliation
-- detector needs. This migration implements exactly that: an additive CHECK
-- widen and one new partial unique index. It does not implement the detector,
-- any recovery action, any new controller route, or any refund business
-- rule — those remain future work this migration only unblocks.
--
-- ---------------------------------------------------------------------------
-- RECON CORRECTION — the live CHECK already has FIVE values, not four
-- ---------------------------------------------------------------------------
--
-- DEC-060's own text (and the Slice 4A mission that authored this file)
-- describe the "existing" kinds as the four
-- `20260811000010_audit_notification_infra_domain.sql` originally shipped:
-- LATE_PAYMENT, SURPLUS_PAYMENT, AMOUNT_MISMATCH, UNMATCHED_EVENT. That is
-- stale. `20260825000001_reconciliation_rider_release_invariant.sql` already
-- widened this exact constraint once, additively, to a fifth value —
-- RIDER_RELEASE_INVARIANT — and added a nullable `delivery_id` column this
-- migration does not touch. Recon for this migration re-read every migration
-- that has ever touched `reconciliation_cases`
-- (20260811000010, 20260811000011, 20260825000001) and found this before
-- writing a single line of SQL.
--
-- Following this file's own strict-superset, never-remove-a-value rule to
-- the ACTUAL live constraint (not the stale four-value summary) is not a new
-- decision — it is the same DEC-060 principle ("do not remove or rename any
-- existing value") applied correctly. Building the new CHECK from only the
-- four originally-documented values would have dropped RIDER_RELEASE_INVARIANT
-- outright: `ALTER TABLE ... ADD CONSTRAINT` revalidates every existing row,
-- so this migration would either fail outright against a database already
-- holding a RIDER_RELEASE_INVARIANT row, or — if none exists yet — silently
-- break the very next one `release_rider_assignment()`'s own backstop tries
-- to write (`docs/DATABASE_MIGRATION_V1_REPORT.md`'s own "reject rather than
-- silently regress" discipline). Neither outcome is acceptable, so the
-- constraint below is a superset of the five LIVE values plus the six new
-- ones — eleven total, not ten.
--
-- ---------------------------------------------------------------------------
-- Constraint name — inspected, not assumed
-- ---------------------------------------------------------------------------
--
-- Both `20260811000010` (creation) and `20260825000001` (the prior widen)
-- document the same deterministic default name for this single unnamed
-- column-level CHECK: `reconciliation_cases_kind_check`. Confirm against a
-- live database before applying:
--
--   select conname from pg_constraint
--    where conrelid = 'public.reconciliation_cases'::regclass and contype = 'c';
--
-- Deliberately no `if exists` on the DROP below — if the name is ever wrong,
-- this must fail loudly rather than silently leave the narrower constraint
-- in place while appearing to have succeeded, exactly as both prior
-- CHECK-widening migrations on this table already document for themselves.

alter table public.reconciliation_cases
  drop constraint reconciliation_cases_kind_check;

alter table public.reconciliation_cases
  add constraint reconciliation_cases_kind_check
  check (kind in (
    -- The five live values (20260811000010, then 20260825000001) — every
    -- existing row already satisfies this branch, unchanged, unrenamed.
    'LATE_PAYMENT', 'SURPLUS_PAYMENT', 'AMOUNT_MISMATCH', 'UNMATCHED_EVENT',
    'RIDER_RELEASE_INVARIANT',
    -- DEC-060's six new Q-020 refund reconciliation kinds. Deliberately NOT
    -- included: PROVIDER_LOCAL_STATE_DIVERGENCE (case G) — DEC-060 §2 found
    -- it already has a schema-safe path via `payment_events.processing_error`
    -- and needs no durable row; no partial-refund kind — BQ-031 remains open
    -- and Q-020 stays full-refund-only (DEC-057 §1).
    'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
    'REFUND_AMOUNT_MISMATCH', 'MISSING_PROVIDER_REFUND_ID',
    'MISSING_PROVIDER_EVENT', 'REFUNDED_LEDGER_INCOMPLETE'
  ));

comment on column public.reconciliation_cases.kind is
  'Payment kinds (DEC-029/DEC-032): LATE_PAYMENT, SURPLUS_PAYMENT, AMOUNT_MISMATCH, UNMATCHED_EVENT — via payment_id/payment_event_id. Rider kind (Phase G-3.1): RIDER_RELEASE_INVARIANT — via delivery_id. Q-020 refund kinds (DEC-060): PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED, LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED, REFUND_AMOUNT_MISMATCH, MISSING_PROVIDER_REFUND_ID, MISSING_PROVIDER_EVENT, REFUNDED_LEDGER_INCOMPLETE — via payment_id, deduplicated while OPEN/IN_PROGRESS by reconciliation_cases_refund_open_key. Case G (PROVIDER_LOCAL_STATE_DIVERGENCE) is deliberately absent — see DEC-060 §2.';

-- ---------------------------------------------------------------------------
-- Dedup — a partial unique index, scoped to the six new kinds only
-- ---------------------------------------------------------------------------
--
-- DEC-060 §4 locks this scoped, not the naive `(kind, payment_id)` covering
-- all eleven kinds: `PaymentEventProcessingService.openCase()` has inserted
-- LATE_PAYMENT/SURPLUS_PAYMENT/AMOUNT_MISMATCH/UNMATCHED_EVENT with no dedup
-- since 20260811000010, and RIDER_RELEASE_INVARIANT carries no payment_id at
-- all (it is opened via delivery_id — comment above, and
-- `20260825000001`'s own column comment). An unscoped index could fail to
-- create outright against any pre-existing duplicate `OPEN`/`IN_PROGRESS`
-- pair among those five, and would silently change their long-standing
-- (never-deduplicated) behaviour as a side effect of a decision scoped to
-- refund reconciliation only. Scoping the predicate to only the six new
-- kinds is provably safe: no row of any of those six kinds can exist before
-- this migration runs — they were not legal `kind` values until the ALTER
-- TABLE immediately above committed — so this index validates against zero
-- rows at creation time, by construction, regardless of what
-- `reconciliation_cases` already holds for any other kind.
--
-- `payment_id` is not made NOT NULL here, and none of the six kinds' future
-- writers are required to populate it by this migration — PostgreSQL's own
-- NULL semantics for unique indexes apply unchanged (multiple NULLs never
-- conflict with each other), matching every other nullable column this
-- table already has. DEC-060 §3 establishes that every one of these six
-- kinds is raised only once a specific `refunds` row has been resolved
-- (`refunds.payment_id` is itself `not null`), so a NULL `payment_id` on a
-- new-kind row is not an expected shape — this migration does not need to,
-- and does not, forbid it at the schema level.
create unique index reconciliation_cases_refund_open_key
  on public.reconciliation_cases (kind, payment_id)
  where state in ('OPEN', 'IN_PROGRESS')
    and kind in (
      'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
      'REFUND_AMOUNT_MISMATCH', 'MISSING_PROVIDER_REFUND_ID',
      'MISSING_PROVIDER_EVENT', 'REFUNDED_LEDGER_INCOMPLETE'
    );

comment on index public.reconciliation_cases_refund_open_key is
  'DEC-060 §4 — at most one OPEN/IN_PROGRESS case per (kind, payment_id), scoped to the six Q-020 refund kinds only. A RESOLVED/CLOSED row is never counted, so a genuinely new future occurrence of the same (kind, payment_id) always inserts cleanly. Never applies to LATE_PAYMENT/SURPLUS_PAYMENT/AMOUNT_MISMATCH/UNMATCHED_EVENT/RIDER_RELEASE_INVARIANT — their existing, undeduplicated behaviour is unchanged.';
