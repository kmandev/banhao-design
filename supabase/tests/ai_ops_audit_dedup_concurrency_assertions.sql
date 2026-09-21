-- BANHAO — DEC-065 §1: post-race assertions for the AI audit dedup index
--
-- Runs after run-domain-tests.sh has fired TWO genuinely concurrent psql
-- client processes, both calling
-- test_attempt_ai_audit_insert('AI_OPS_DEDUP_RACE', b5…00ff) — the helper
-- defined in ai_ops_audit_dedup_test.sql, which mirrors AiAuditService's
-- insert-first behaviour exactly.
--
-- The shell already asserts that exactly one of the two attempts returned
-- true. This file proves the database agrees: one row, not two, and the
-- losing connection left nothing behind.
--
-- This is the case the application's prior `alreadyHandled()` SELECT can
-- never win — both connections read "not handled" before either inserted —
-- and it is precisely what CLAUDE.md §12 documented as the open bound
-- ("genuinely concurrent ticks are not [suppressed]") before DEC-065.

\set ON_ERROR_STOP on

select aid_assert(
  (select count(*) from public.audit_logs
    where actor_type = 'AI'
      and action = 'AI_OPS_DEDUP_RACE'
      and entity_id = 'b5000000-0000-4000-8000-0000000000ff'::uuid) = 1,
  'R1. two genuinely concurrent AI audit inserts produced exactly ONE row'
);

select aid_assert(
  (select count(*) from public.audit_logs
    where actor_type = 'AI'
      and action = 'AI_OPS_DEDUP_RACE') = 1,
  'R2. no stray AI row for that action on any other aggregate'
);

-- The surviving row is a complete, well-formed audit record — the loser did
-- not leave a partial write, and the winner was not rolled back by the
-- conflict.
select aid_assert(
  (select actor_type = 'AI'
      and actor_id is null
      and entity_type = 'order'
      and source = 'worker'
      and reason is not null
     from public.audit_logs
    where actor_type = 'AI'
      and action = 'AI_OPS_DEDUP_RACE'
      and entity_id = 'b5000000-0000-4000-8000-0000000000ff'::uuid),
  'R3. the surviving row is complete and correctly attributed (actor_type AI, actor_id null)'
);

do $$
begin
  raise notice '3/3 concurrency assertions passed';
end $$;
