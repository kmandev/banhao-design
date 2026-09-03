-- BANHAO — LOCK AI-01: audit_logs.actor_type gains AI
--
-- AI_OPERATIONS_DESIGN_PACKAGE (docs/design/BANHAO AI OPERATIONS - Agent +
-- Human Supervisor - Design Package.dc.html, finding AI-01) found that
-- audit_logs.actor_type is CHECK-constrained to CUSTOMER, MERCHANT, RIDER,
-- OPERATOR, SYSTEM, WEBHOOK — there is no AI value, so an autonomous agent
-- action is indistinguishable from a scheduled tick or the payment
-- processor, both of which also write SYSTEM. This migration widens the
-- CHECK to add AI and nothing else. It does not implement the agent, a
-- policy engine, a command layer, or any AI table (AI-02, out of scope here)
-- — it only unblocks the audit trail from being able to name the actor.
--
-- ---------------------------------------------------------------------------
-- Constraint name — inspected, not assumed
-- ---------------------------------------------------------------------------
--
-- audit_logs.actor_type's CHECK (20260811000010, line ~45) is written as a
-- single, unnamed column-level constraint:
--
--   actor_type text not null check (actor_type in (...))
--
-- PostgreSQL's deterministic default-naming rule for exactly this shape —
-- one unnamed CHECK on one column, no prior ALTER TABLE renaming it — is
-- `<table>_<column>_check`, i.e. `audit_logs_actor_type_check`. No other
-- migration in this set names or renames it. This can be confirmed against a
-- live database before applying with:
--
--   select conname from pg_constraint
--    where conrelid = 'public.audit_logs'::regclass and contype = 'c';
--
-- Deliberately no `if exists` on the DROP below: if the name above is ever
-- wrong, the migration must fail loudly here rather than silently leave the
-- old, narrower constraint in place while appearing to have succeeded.
--
-- This is a strict superset — every existing row already satisfies it — and
-- touches only this one CHECK. It does not touch
-- audit_logs_operator_reason_check (DEC-032's OPERATOR-reason rule is
-- unchanged: AI actions are not required to carry a reason by this
-- migration), the audit_logs_reject_mutation trigger (append-only behaviour
-- is untouched), RLS (still enabled, still no policy, still no grant to
-- anon/authenticated), or any other table.

alter table public.audit_logs
  drop constraint audit_logs_actor_type_check;

alter table public.audit_logs
  add constraint audit_logs_actor_type_check
  check (actor_type in
    ('CUSTOMER', 'MERCHANT', 'RIDER', 'OPERATOR', 'SYSTEM', 'WEBHOOK', 'AI'));

comment on column public.audit_logs.actor_type is
  'AI-01 (docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html): AI is a distinct actor from SYSTEM — SYSTEM is a scheduled tick or the payment processor, AI is an autonomous agent decision. No writer uses AI yet; this column change only makes the value legal.';
