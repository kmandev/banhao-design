-- BANHAO — DEC-068 C3 / C3-A: set_restaurant_availability()
-- (20261107000001_set_restaurant_availability_atomic_audit.sql)
--
-- Run by run-domain-tests.sh in the same database as every other domain test.
-- Fixture ids use the 3a/3b/3c/3d prefix block, unique to this file.
--
-- What this proves, by execution:
--   A. EXECUTE is service_role-only; anon and authenticated cannot call it.
--   B. A real change updates the row AND writes exactly one audit row carrying
--      actor, actor role, merchant, old mode, new mode, correlation id and
--      source (member = MERCHANT, staff = OPERATOR).
--   C. A change to the identical mode is a NOOP: no UPDATE, no audit row.
--   D. The transition rule is unchanged: PAUSED -> BUSY is refused, and a
--      refused call writes nothing.
--   E. FAIL-CLOSED (C3-A): when the audit INSERT cannot be written, the mode
--      change is rolled back — the row keeps its old mode.
--   F. Staff changes require a non-blank reason; a member change does not.
--   G. Unknown mode and unknown actor type are refused; an unknown restaurant
--      returns NOT_FOUND.
--   H. A mode change touches neither restaurants.status nor
--      temporarily_closed_until.

\set ON_ERROR_STOP on

create or replace function sra_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

/* Runs `stmt` as `role`, returning 'ALLOWED' or 'BLOCKED: <sqlstate>'. */
create or replace function sra_call_as(role_name text, stmt text)
returns text language plpgsql as $$
declare
  err text;
begin
  perform set_config('role', role_name, true);
  begin
    execute stmt;
    err := 'ALLOWED';
  exception when others then
    err := 'BLOCKED: ' || sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  return err;
end;
$$;

/* Runs `stmt`, returning the sqlstate it raised, or 'OK'. */
create or replace function sra_sqlstate(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

\set OWNER_M  '3a000000-0000-0000-0000-000000000001'
\set STAFF_M  '3a000000-0000-0000-0000-000000000002'
\set MERCH_M  '3b000000-0000-0000-0000-000000000001'
\set REST_A   '3c000000-0000-0000-0000-000000000001'
\set REST_NONE '3c000000-0000-0000-0000-0000000000ff'
\set CORR     '3d000000-0000-0000-0000-000000000001'

insert into auth.users (id, phone) values (:'OWNER_M', '+66892290061') on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'STAFF_M', '+66892290062') on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_M', :'OWNER_M', 'ร้านทดสอบโหมด', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_A', :'MERCH_M', 'ร้านโหมด A', 'ACTIVE', 14.3, 105.2);

-- ===========================================================================
-- A. Grants
-- ===========================================================================

select sra_assert(
  has_function_privilege('service_role',
    'public.set_restaurant_availability(uuid, text, integer, uuid, text, text, text, text, uuid)', 'EXECUTE'),
  'A. service_role may execute set_restaurant_availability');

select sra_assert(
  sra_call_as('authenticated',
    format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'MERCHANT', 'OWNER', null, 'api', null)$s$,
           :'REST_A', :'OWNER_M')) = 'BLOCKED: 42501',
  'A. authenticated cannot execute it (42501)');

select sra_assert(
  sra_call_as('anon',
    format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'MERCHANT', 'OWNER', null, 'api', null)$s$,
           :'REST_A', :'OWNER_M')) = 'BLOCKED: 42501',
  'A. anon cannot execute it (42501)');

-- ===========================================================================
-- B. A real change: row + audit in one go
-- ===========================================================================

select sra_assert(
  (select public.set_restaurant_availability(:'REST_A', 'BUSY', 20, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', :'CORR')) ->> 'result' = 'CHANGED',
  'B. NORMAL -> BUSY(20) by a member returns CHANGED');

select sra_assert(
  (select availability_mode = 'BUSY' and busy_prep_minutes = 20 from public.restaurants where id = :'REST_A'),
  'B. the restaurant row now reads BUSY / 20');

select sra_assert(
  (select count(*) from public.audit_logs
    where entity_id = :'REST_A' and action = 'MerchantAvailabilityChanged') = 1,
  'B. exactly one audit row was written');

select sra_assert(
  (select actor_type = 'MERCHANT'
      and actor_id = :'OWNER_M'
      and entity_type = 'restaurant'
      and source = 'api'
      and correlation_id = :'CORR'
      and reason is null
      and before = '{"availabilityMode":"NORMAL","busyPrepMinutes":null}'::jsonb
      and (after ->> 'availabilityMode') = 'BUSY'
      and (after ->> 'busyPrepMinutes') = '20'
      and (after ->> 'actorRole') = 'OWNER'
      and (after ->> 'merchantId') = :'MERCH_M'
      and created_at is not null
     from public.audit_logs
    where entity_id = :'REST_A' and action = 'MerchantAvailabilityChanged'),
  'B. the audit row carries actor, role, merchant, old and new mode, correlation id, source and a timestamp');

-- Staff change: OPERATOR actor type, with a reason.
select sra_assert(
  (select public.set_restaurant_availability(:'REST_A', 'PAUSED', null, :'STAFF_M', 'OPERATOR', 'ADMIN',
                                             'ร้านแจ้งว่าไฟดับ', 'api', null)) ->> 'result' = 'CHANGED',
  'B. BUSY -> PAUSED by staff returns CHANGED');

select sra_assert(
  (select actor_type = 'OPERATOR' and reason = 'ร้านแจ้งว่าไฟดับ' and (after ->> 'actorRole') = 'ADMIN'
     from public.audit_logs
    where entity_id = :'REST_A' and actor_id = :'STAFF_M' and action = 'MerchantAvailabilityChanged'),
  'B. the staff audit row is OPERATOR, carries the reason and the staff role');

-- ===========================================================================
-- C. NOOP writes nothing
-- ===========================================================================

select sra_assert(
  (select public.set_restaurant_availability(:'REST_A', 'PAUSED', null, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', null)) ->> 'result' = 'NOOP',
  'C. PAUSED -> PAUSED returns NOOP');

select sra_assert(
  (select count(*) from public.audit_logs where entity_id = :'REST_A' and action = 'MerchantAvailabilityChanged') = 2,
  'C. a NOOP wrote no audit row');

-- ===========================================================================
-- D. Transition rule unchanged, and a refusal writes nothing
-- ===========================================================================

select sra_assert(
  (select public.set_restaurant_availability(:'REST_A', 'BUSY', 30, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', null)) ->> 'result' = 'INVALID_TRANSITION',
  'D. PAUSED -> BUSY is refused (two calls, not one)');

select sra_assert(
  (select availability_mode = 'PAUSED' and busy_prep_minutes is null from public.restaurants where id = :'REST_A')
  and (select count(*) from public.audit_logs where entity_id = :'REST_A' and action = 'MerchantAvailabilityChanged') = 2,
  'D. the refused call changed nothing and wrote no audit row');

select sra_assert(
  (select public.set_restaurant_availability(:'REST_A', 'NORMAL', null, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', null)) ->> 'result' = 'CHANGED',
  'D. PAUSED -> NORMAL (resume) is allowed');

-- ===========================================================================
-- E. Fail-closed: no audit row, no change
-- ===========================================================================

-- source 'bogus' violates audit_logs.source's CHECK, so the audit INSERT fails.
select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'MERCHANT', 'OWNER', null, 'bogus', null)$s$,
                      :'REST_A', :'OWNER_M')) = '23514',
  'E. an unwritable audit row makes the call raise (23514)');

select sra_assert(
  (select availability_mode = 'NORMAL' from public.restaurants where id = :'REST_A'),
  'E. and the mode change was rolled back — the restaurant is still NORMAL');

select sra_assert(
  (select count(*) from public.audit_logs where entity_id = :'REST_A' and action = 'MerchantAvailabilityChanged') = 3,
  'E. and no extra audit row exists');

-- ===========================================================================
-- F. Reason rules
-- ===========================================================================

select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'OPERATOR', 'OPERATOR', null, 'api', null)$s$,
                      :'REST_A', :'STAFF_M')) <> 'OK',
  'F. a staff change with no reason is refused');

select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'OPERATOR', 'OPERATOR', '   ', 'api', null)$s$,
                      :'REST_A', :'STAFF_M')) <> 'OK',
  'F. a staff change with a blank reason is refused');

select sra_assert(
  (select availability_mode = 'NORMAL' from public.restaurants where id = :'REST_A'),
  'F. neither refused staff call changed the mode');

-- ===========================================================================
-- G. Bad inputs
-- ===========================================================================

select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'CLOSED', null, %L, 'MERCHANT', 'OWNER', null, 'api', null)$s$,
                      :'REST_A', :'OWNER_M')) <> 'OK',
  'G. an unknown mode is refused');

select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'PAUSED', null, %L, 'SYSTEM', 'OWNER', null, 'api', null)$s$,
                      :'REST_A', :'OWNER_M')) <> 'OK',
  'G. an actor type other than MERCHANT/OPERATOR is refused');

select sra_assert(
  (select public.set_restaurant_availability(:'REST_NONE', 'PAUSED', null, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', null)) ->> 'result' = 'NOT_FOUND',
  'G. an unknown restaurant returns NOT_FOUND');

select sra_assert(
  sra_sqlstate(format($s$select public.set_restaurant_availability(%L, 'BUSY', 25, %L, 'MERCHANT', 'OWNER', null, 'api', null)$s$,
                      :'REST_A', :'OWNER_M')) = '23514',
  'G. busy minutes outside 10/20/30/45/60 are refused by the table CHECK (23514)');

-- ===========================================================================
-- H. Mode is not status and not a temporary close
-- ===========================================================================

select public.set_restaurant_availability(:'REST_A', 'PAUSED', null, :'OWNER_M', 'MERCHANT', 'OWNER', null, 'api', null);

select sra_assert(
  (select status = 'ACTIVE' and temporarily_closed_until is null from public.restaurants where id = :'REST_A'),
  'H. a mode change left restaurants.status and temporarily_closed_until untouched');

\echo 'DEC-068 C3 set_restaurant_availability assertions complete'
