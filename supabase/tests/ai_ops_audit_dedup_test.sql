-- BANHAO — DEC-065 §1: AI-operations audit dedup index
-- (20260921000001_ai_ops_audit_dedup_index.sql)
--
-- Run via run-domain-tests.sh (docker-composed, real PostgreSQL), after
-- audit_logs_ai_actor_test.sql (AI-01) in the same database. Proves:
--
--   A. the index exists with the expected partial predicate
--   B. the first AI row for an (action, entity_id) inserts
--   C. a duplicate AI row for the SAME pair is rejected (23505)
--   D. scope is per-aggregate: same action, different entity_id inserts
--   E. scope is per-playbook: different action, same entity_id inserts
--   F. NON-AI rows are untouched — several rows sharing one (action,
--      entity_id), including the same pair an AI row already holds
--   G. insert-first, exactly as AiAuditService now behaves: a caught
--      unique_violation, never a raise (this helper is also what
--      run-domain-tests.sh fires from two concurrent connections)
--   H. append-only is preserved — UPDATE and DELETE still rejected, and
--      the dedupe path never issues either
--   I. grants/RLS on audit_logs are unchanged by this migration
--
-- Fixture ids are unique to this file (b5…) so nothing here collides with
-- AI-01's own 'test.noop' / a1111111-… fixtures already in this database.

\set ON_ERROR_STOP on

create or replace function aid_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- Insert-first attempt, mirroring AiAuditService.insert(): true when the row
-- was written, false when audit_logs_ai_action_entity_key refused it. Never
-- raises, so both concurrent callers return cleanly and the shell can read
-- each result.
create or replace function test_attempt_ai_audit_insert(p_action text, p_entity_id uuid)
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, source, reason)
    values ('AI', null, p_action, 'order', p_entity_id, 'worker', 'DEC-065 dedup fixture');
    return true;
  exception
    when unique_violation then
      return false;
  end;
end;
$$;

-- ===========================================================================
-- A. The index exists, and is partial
-- ===========================================================================

select aid_assert(
  (select count(*) from pg_indexes
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and indexname = 'audit_logs_ai_action_entity_key') = 1,
  'A1. audit_logs_ai_action_entity_key exists'
);

select aid_assert(
  (select indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%(action, entity_id)%'
      and indexdef like '%WHERE (actor_type = ''AI''::text)%'
     from pg_indexes
    where schemaname = 'public' and indexname = 'audit_logs_ai_action_entity_key'),
  'A2. it is UNIQUE, on (action, entity_id), scoped WHERE actor_type = AI'
);

-- ===========================================================================
-- B/C. First insert wins, duplicate is refused
-- ===========================================================================

select aid_assert(
  test_attempt_ai_audit_insert('AI_OPS_DEDUP_FIXTURE', 'b5000000-0000-4000-8000-000000000001'::uuid),
  'B1. the first AI row for (AI_OPS_DEDUP_FIXTURE, b5…0001) inserts'
);

select aid_assert(
  not test_attempt_ai_audit_insert('AI_OPS_DEDUP_FIXTURE', 'b5000000-0000-4000-8000-000000000001'::uuid),
  'C1. a second AI row for the SAME (action, entity_id) is refused'
);

select aid_assert(
  (select count(*) from public.audit_logs
    where actor_type = 'AI'
      and action = 'AI_OPS_DEDUP_FIXTURE'
      and entity_id = 'b5000000-0000-4000-8000-000000000001'::uuid) = 1,
  'C2. exactly one row survives for that pair'
);

-- The raw error code, asserted rather than inferred from the helper's boolean.
do $$
begin
  begin
    insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
    values ('AI', 'AI_OPS_DEDUP_FIXTURE', 'order', 'b5000000-0000-4000-8000-000000000001', 'worker');
    raise exception 'FAIL  C3. duplicate AI insert was accepted';
  exception
    when unique_violation then
      raise notice 'PASS  C3. duplicate AI insert raises unique_violation (23505), the code AiAuditService catches';
  end;
end $$;

-- ===========================================================================
-- D/E. The scope is (action, entity_id) — one AI operation per playbook per
--      aggregate, and nothing wider
-- ===========================================================================

select aid_assert(
  test_attempt_ai_audit_insert('AI_OPS_DEDUP_FIXTURE', 'b5000000-0000-4000-8000-000000000002'::uuid),
  'D1. same action, a DIFFERENT aggregate, inserts cleanly'
);

select aid_assert(
  test_attempt_ai_audit_insert('AI_OPS_DEDUP_FIXTURE_OTHER', 'b5000000-0000-4000-8000-000000000001'::uuid),
  'E1. a DIFFERENT action on the same aggregate inserts cleanly (playbooks do not block each other)'
);

-- ===========================================================================
-- F. Non-AI actors are untouched — the reason this index is partial
-- ===========================================================================

do $$
declare
  t text;
begin
  -- The exact pair an AI row already occupies, inserted five times by five
  -- other actor types. All must succeed: their long-standing, never-
  -- deduplicated behaviour is not changed by DEC-065.
  foreach t in array array['CUSTOMER','MERCHANT','RIDER','SYSTEM','WEBHOOK'] loop
    insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
    values (t, 'AI_OPS_DEDUP_FIXTURE', 'order', 'b5000000-0000-4000-8000-000000000001', 'api');
  end loop;

  -- And twice more for one of them, to prove duplicates among non-AI rows
  -- are still permitted.
  insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
  values ('SYSTEM', 'AI_OPS_DEDUP_FIXTURE', 'order', 'b5000000-0000-4000-8000-000000000001', 'api');

  raise notice 'PASS  F1. non-AI rows still share one (action, entity_id) freely, including one an AI row holds';
end $$;

select aid_assert(
  (select count(*) from public.audit_logs
    where actor_type <> 'AI'
      and action = 'AI_OPS_DEDUP_FIXTURE'
      and entity_id = 'b5000000-0000-4000-8000-000000000001'::uuid) = 6,
  'F2. all six non-AI rows persisted (5 actor types + 1 deliberate duplicate)'
);

select aid_assert(
  (select count(*) from public.audit_logs
    where actor_type = 'AI'
      and action = 'AI_OPS_DEDUP_FIXTURE'
      and entity_id = 'b5000000-0000-4000-8000-000000000001'::uuid) = 1,
  'F3. the AI row for that same pair is still exactly one'
);

-- ===========================================================================
-- H. Append-only preserved. The dedupe path is INSERT-only, so the
--    mutation-rejecting trigger is never involved — and still fires.
-- ===========================================================================

do $$
declare
  ai_row uuid;
begin
  select id into ai_row from public.audit_logs
   where actor_type = 'AI'
     and action = 'AI_OPS_DEDUP_FIXTURE'
     and entity_id = 'b5000000-0000-4000-8000-000000000001'::uuid;

  begin
    update public.audit_logs set reason = 'tampered' where id = ai_row;
    raise exception 'FAIL  H1. UPDATE on a deduped AI audit row succeeded';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS  H1. append-only UPDATE still rejected on an AI row';
  end;

  begin
    delete from public.audit_logs where id = ai_row;
    raise exception 'FAIL  H2. DELETE on a deduped AI audit row succeeded';
  exception
    when others then
      if sqlerrm like 'FAIL%' then raise; end if;
      raise notice 'PASS  H2. append-only DELETE still rejected on an AI row';
  end;
end $$;

-- ===========================================================================
-- I. Grants and RLS on audit_logs are exactly as they were
-- ===========================================================================

select aid_assert(
  (select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  'I1. audit_logs still has RLS enabled'
);

select aid_assert(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'audit_logs') = 0,
  'I2. audit_logs still has zero policies (service_role only)'
);

select aid_assert(
  not has_table_privilege('anon', 'public.audit_logs', 'select')
  and not has_table_privilege('authenticated', 'public.audit_logs', 'select')
  and not has_table_privilege('authenticated', 'public.audit_logs', 'insert'),
  'I3. anon/authenticated still hold no SELECT/INSERT privilege on audit_logs'
);

select aid_assert(
  (select count(*) from pg_trigger
    where tgrelid = 'public.audit_logs'::regclass
      and tgname = 'audit_logs_reject_mutation') = 1,
  'I4. audit_logs_reject_mutation trigger is still attached'
);

-- AI-01 and DEC-032 constraints untouched by this migration.
select aid_assert(
  (select pg_get_constraintdef(oid) like '%''AI''%'
     from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and conname = 'audit_logs_actor_type_check'),
  'I5. audit_logs_actor_type_check still accepts AI (AI-01 unchanged)'
);

select aid_assert(
  (select count(*) from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and conname = 'audit_logs_operator_reason_check') = 1,
  'I6. DEC-032 operator-reason CHECK still present'
);

do $$
begin
  raise notice '17/17 assertions passed';
end $$;
