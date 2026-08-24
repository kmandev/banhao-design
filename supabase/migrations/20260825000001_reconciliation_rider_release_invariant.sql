-- BANHAO — Phase G-3.1: reconciliation_cases gains RIDER_RELEASE_INVARIANT
--
-- G3.1_RECON_RESULT (2026-08-25) found that reconciliation_cases is,
-- architecturally, a generic operational reconciliation queue —
-- docs/DATABASE_DESIGN.md § 16/21 files it under module 12 "infra" (a peer
-- of "payment", not a member of it), and docs/BANHAO-APP-ARCHITECTURE-V1.md
-- § 3 groups it under "INFRASTRUCTURE" behind one generically-named
-- `ReconciliationService`. V1.1 § 9 ("How reassignment happens — H-2")
-- explicitly names a `reconciliation_cases` row as the required outcome of
-- `release_rider_assignment()`'s own backstop raise ("release invariant
-- violated") — the architecture already intended this table to be reused
-- here. Only the table's `kind` CHECK (20260811000010) had not yet caught
-- up: it was written before the rider domain existed and only lists the
-- four payment kinds `PaymentEventProcessingService.openCase()` writes.
--
-- This migration is purely additive: it widens that CHECK to a strict
-- superset (every existing row already satisfies it) and adds one nullable
-- FK column. It does not touch any payment table, any payment code, any
-- payment behaviour, RLS, or grants — `reconciliation_cases` has no RLS
-- policy for any role (API-only, service_role bypasses RLS by platform
-- default, per 20260811000011_rls_policies.sql's own "intentionally no
-- grant and no policy" note), so neither change requires one.
--
-- ---------------------------------------------------------------------------
-- Constraint name — inspected, not assumed
-- ---------------------------------------------------------------------------
--
-- reconciliation_cases.kind's CHECK (20260811000010, line ~143) is written
-- as a single, unnamed column-level constraint:
--
--   kind text not null check (kind in (...))
--
-- PostgreSQL's deterministic default-naming rule for exactly this shape —
-- one unnamed CHECK on one column, no prior ALTER TABLE renaming it — is
-- `<table>_<column>_check`, i.e. `reconciliation_cases_kind_check`. No other
-- migration in this set names or renames it. This can be confirmed against a
-- live database before applying with:
--
--   select conname from pg_constraint
--    where conrelid = 'public.reconciliation_cases'::regclass and contype = 'c';
--
-- Deliberately no `if exists` on the DROP below: if the name above is ever
-- wrong, the migration must fail loudly here rather than silently leave the
-- old, payment-only constraint in place while appearing to have succeeded.

alter table public.reconciliation_cases
  drop constraint reconciliation_cases_kind_check;

alter table public.reconciliation_cases
  add constraint reconciliation_cases_kind_check
  check (kind in (
    'LATE_PAYMENT', 'SURPLUS_PAYMENT', 'AMOUNT_MISMATCH', 'UNMATCHED_EVENT',
    'RIDER_RELEASE_INVARIANT'
  ));

-- delivery_id — nullable, no default. release_rider_assignment() raises its
-- backstop exception BEFORE either of its own statements commits (its own
-- comment: "Raising here ... rolls back statement 1 too"), so at the moment
-- DeliveryReleaseService observes the error, deliveries.rider_id still holds
-- the rider that was assigned going in — delivery_id alone already resolves
-- the rider via that column, with no separate, driftable rider_id copy
-- needed here (G3.1_RECON_RESULT § 11).
alter table public.reconciliation_cases
  add column delivery_id uuid references public.deliveries (id) on delete set null;

-- No index on delivery_id in this slice (G3.1 scope) — reconciliation_cases
-- has no reader anywhere in the codebase yet (no admin surface exists,
-- Phase I), so there is no query to serve. reconciliation_cases_open_idx
-- (on state alone) is unaffected and continues to serve every kind equally.

comment on table public.reconciliation_cases is
  'Generic operational reconciliation queue (infra domain, docs/DATABASE_DESIGN.md § 16/21) — not payment-exclusive. Payment kinds: a late payment (DEC-029), a surplus payment, or a webhook mismatch (DEC-032). Rider kind: RIDER_RELEASE_INVARIANT, opened when release_rider_assignment()''s own backstop fires (V1.1 § 9), via delivery_id rather than payment_id/payment_event_id. Reconciliation is mandatory rather than optional under DEC-034, since no database trigger enforces the ledger''s zero-sum invariant.';

comment on column public.reconciliation_cases.delivery_id is
  'Set only for RIDER_RELEASE_INVARIANT cases (Phase G-3.1) — the delivery release_rider_assignment() refused to release consistently. NULL for every payment-domain kind.';
