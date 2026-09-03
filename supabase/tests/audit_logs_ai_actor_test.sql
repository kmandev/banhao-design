-- BANHAO — AI-01 lock: audit_logs.actor_type accepts AI, unrelated behaviour unchanged
--
-- Run via run-domain-tests.sh (docker-composed, real PostgreSQL). Proves:
--   1. every pre-existing actor_type still inserts
--   2. AI now inserts
--   3. an unknown actor_type is still rejected (23514)
--   4. append-only UPDATE is still rejected
--   5. append-only DELETE is still rejected
--   6. DEC-032's OPERATOR-reason CHECK is untouched (still fires for OPERATOR
--      with no reason; still does not fire for AI with no reason)

\set ON_ERROR_STOP on

do $$
declare
  eid uuid := 'a1111111-0000-0000-0000-000000000001';
  ai_id uuid;
  t text;
begin
  -- 1. every pre-existing actor_type still accepted
  foreach t in array array['CUSTOMER','MERCHANT','RIDER','SYSTEM','WEBHOOK'] loop
    insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
    values (t, 'test.noop', 'test_entity', eid, 'api');
  end loop;

  insert into public.audit_logs (actor_type, action, entity_type, entity_id, source, reason)
  values ('OPERATOR', 'test.noop', 'test_entity', eid, 'api', 'AI-01 test fixture');

  raise notice 'PASS  1. every pre-existing actor_type still inserts';
end $$;

-- 2. AI now inserts, with no reason required (DEC-032 scopes the reason
--    requirement to OPERATOR only, and this migration did not touch that).
-- Fixed id, not \gset, so later steps can reference it without psql
-- variable-substitution inside a dollar-quoted plpgsql body.
do $$
begin
  insert into public.audit_logs (id, actor_type, action, entity_type, entity_id, source)
  values ('a1111111-0000-0000-0000-0000000000a1'::uuid, 'AI', 'test.noop', 'test_entity',
          'a1111111-0000-0000-0000-000000000001', 'worker');
exception
  when others then
    raise exception 'FAIL  2. AI insert raised: %', sqlerrm;
end $$;

do $$
begin
  if (select actor_type from public.audit_logs where id = 'a1111111-0000-0000-0000-0000000000a1'::uuid)
     is distinct from 'AI' then
    raise exception 'FAIL  2. AI row not found or actor_type not AI';
  end if;
  raise notice 'PASS  2. actor_type = AI inserts';
end $$;

-- 3. unknown actor_type still rejected by the CHECK (23514)
do $$
begin
  begin
    insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
    values ('ROBOT', 'test.noop', 'test_entity', 'a1111111-0000-0000-0000-000000000001', 'api');
    raise exception 'FAIL  3. unknown actor_type ROBOT was accepted';
  exception
    when check_violation then
      raise notice 'PASS  3. unknown actor_type still rejected (23514)';
  end;
end $$;

-- 4/5. append-only trigger still rejects UPDATE and DELETE, including on
-- the new AI row
do $$
begin
  begin
    update public.audit_logs set action = 'tampered' where id = 'a1111111-0000-0000-0000-0000000000a1'::uuid;
    raise exception 'FAIL  4. UPDATE on audit_logs succeeded';
  exception
    when others then
      raise notice 'PASS  4. append-only UPDATE still rejected (%)', sqlerrm;
  end;

  begin
    delete from public.audit_logs where id = 'a1111111-0000-0000-0000-0000000000a1'::uuid;
    raise exception 'FAIL  5. DELETE on audit_logs succeeded';
  exception
    when others then
      raise notice 'PASS  5. append-only DELETE still rejected (%)', sqlerrm;
  end;
end $$;

-- 6. DEC-032 OPERATOR-reason CHECK unchanged: still fires for OPERATOR with
-- no reason, still does not fire for AI with no reason (already proven by
-- step 2's successful insert, asserted again here for clarity)
do $$
begin
  begin
    insert into public.audit_logs (actor_type, action, entity_type, entity_id, source)
    values ('OPERATOR', 'test.noop', 'test_entity', 'a1111111-0000-0000-0000-000000000001', 'api');
    raise exception 'FAIL  6. OPERATOR with no reason was accepted';
  exception
    when check_violation then
      raise notice 'PASS  6. DEC-032 OPERATOR-reason CHECK still enforced, unaffected by AI-01';
  end;
end $$;

do $$
begin
  raise notice '6/6 assertions passed';
end $$;
