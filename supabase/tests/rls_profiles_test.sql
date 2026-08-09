-- BANHAO — executable RLS verification for public.profiles
--
-- Run with: ./supabase/tests/run-rls-tests.sh
--
-- Each test asserts and raises on failure, so the script exits non-zero if any
-- expectation is violated. This is real execution against PostgreSQL, not a
-- reading of the SQL.
--
-- Grants below mirror Supabase's defaults (ALL on public tables to
-- anon/authenticated) so the test exercises the same starting position the
-- hardening migration has to defend against.

\set ON_ERROR_STOP on

\set U1 '11111111-1111-1111-1111-111111111111'
\set U2 '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
--
-- Deliberately NO grant/revoke statements here. The permissive Supabase default
-- is applied by the shim before the migrations run, so whatever protection the
-- assertions below observe comes from the migrations themselves.
--
-- An earlier version of this file re-applied the migration's own grants as
-- "setup", which made the phone-immutability test pass even with the hardening
-- migration removed — the suite was verifying its own fixture. Caught by
-- running the suite against migrations 0001+0002 only. Keep this section free
-- of privilege changes.

insert into auth.users (id, phone) values
  (:'U1', '+66811111111'),
  (:'U2', '+66822222222')
on conflict (id) do nothing;

create or replace function test_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- Helper: run a statement as an authenticated user and report whether it was
-- rejected. Any error is caught so one blocked statement doesn't abort the run.
create or replace function test_as_user(user_id uuid, stmt text)
returns text language plpgsql as $$
declare
  err text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id)::text, true);
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

\echo ''
\echo '=========================================='
\echo ' BANHAO RLS verification — public.profiles'
\echo '=========================================='

-- ---------------------------------------------------------------------------
-- 1. SELECT own profile — must be ALLOWED
-- ---------------------------------------------------------------------------
do $$
declare visible int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  select count(*) into visible from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  perform set_config('role', 'postgres', true);
  perform test_assert(visible = 1, '1. SELECT own profile is allowed');
end $$;

-- ---------------------------------------------------------------------------
-- 2. SELECT another user's profile — must be INVISIBLE
-- ---------------------------------------------------------------------------
do $$
declare visible int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  select count(*) into visible from public.profiles
    where id = '22222222-2222-2222-2222-222222222222';
  perform set_config('role', 'postgres', true);
  perform test_assert(visible = 0, '2. SELECT other user profile returns no rows');
end $$;

-- ---------------------------------------------------------------------------
-- 3. UPDATE own display_name — must be ALLOWED
-- ---------------------------------------------------------------------------
do $$
declare result text; stored text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set display_name = 'Somchai'
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  select display_name into stored from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  perform test_assert(result = 'ALLOWED' and stored = 'Somchai',
    '3. UPDATE own display_name is allowed (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 4. UPDATE own role — ESCALATION, must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text; stored public.user_role;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set role = 'ADMIN'
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  select role into stored from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  perform test_assert(result like 'BLOCKED%' and stored = 'CUSTOMER',
    '4. UPDATE own role (escalation) is blocked (got ' || result ||
    ', role still ' || stored || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 5. UPDATE own phone — identity drift, must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text; stored text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set phone = '+66899999999'
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  select phone into stored from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  perform test_assert(result like 'BLOCKED%' and stored = '+66811111111',
    '5. UPDATE own phone is blocked (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 6. UPDATE own id — must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set id = '44444444-4444-4444-4444-444444444444'
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  perform test_assert(result like 'BLOCKED%',
    '6. UPDATE own id is blocked (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 7. UPDATE another user's profile — must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text; stored text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set display_name = 'hijacked'
          where id = '22222222-2222-2222-2222-222222222222'$stmt$);
  select display_name into stored from public.profiles
    where id = '22222222-2222-2222-2222-222222222222';
  perform test_assert(stored is distinct from 'hijacked',
    '7. UPDATE another user profile has no effect');
end $$;

-- ---------------------------------------------------------------------------
-- 8. INSERT a fabricated ADMIN profile — must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text; created int;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$insert into public.profiles (id, role)
          values ('33333333-3333-3333-3333-333333333333','ADMIN')$stmt$);
  select count(*) into created from public.profiles
    where id = '33333333-3333-3333-3333-333333333333';
  perform test_assert(result like 'BLOCKED%' and created = 0,
    '8. INSERT own profile is blocked (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 9. DELETE own profile — must be BLOCKED
-- ---------------------------------------------------------------------------
do $$
declare result text; still_there int;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$delete from public.profiles
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  select count(*) into still_there from public.profiles
    where id = '11111111-1111-1111-1111-111111111111';
  perform test_assert(still_there = 1,
    '9. DELETE own profile does not remove the row');
end $$;

-- ---------------------------------------------------------------------------
-- 10. anon (signed out) cannot read profiles at all
-- ---------------------------------------------------------------------------
do $$
declare result text;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  begin
    perform count(*) from public.profiles;
    result := 'ALLOWED';
  exception when others then
    result := 'BLOCKED: ' || sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  perform test_assert(result like 'BLOCKED%',
    '10. anon cannot read profiles (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 11. No infinite recursion — an update must not raise 42P17.
--     Regression guard: this is what a self-referencing policy would cause.
-- ---------------------------------------------------------------------------
do $$
declare result text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$update public.profiles set display_name = 'recursion probe'
          where id = '11111111-1111-1111-1111-111111111111'$stmt$);
  perform test_assert(result not like '%42P17%',
    '11. No infinite recursion in policy evaluation (got ' || result || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 12. Trusted server path: service_role can assign a role
-- ---------------------------------------------------------------------------
do $$
declare stored public.user_role;
begin
  perform public.set_user_role('22222222-2222-2222-2222-222222222222', 'MERCHANT');
  select role into stored from public.profiles
    where id = '22222222-2222-2222-2222-222222222222';
  perform test_assert(stored = 'MERCHANT',
    '12. service_role can assign a role via set_user_role');
end $$;

-- ---------------------------------------------------------------------------
-- 13. set_user_role is not callable by a client
-- ---------------------------------------------------------------------------
do $$
declare result text;
begin
  result := test_as_user('11111111-1111-1111-1111-111111111111',
    $stmt$select public.set_user_role('11111111-1111-1111-1111-111111111111','ADMIN')$stmt$);
  perform test_assert(result like 'BLOCKED%',
    '13. set_user_role is not callable by authenticated (got ' || result || ')');
end $$;

\echo ''
\echo 'All assertions passed.'
\echo ''
