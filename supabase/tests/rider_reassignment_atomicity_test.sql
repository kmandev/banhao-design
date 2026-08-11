-- BANHAO — HIGH-2 fix regression tests: rider reassignment atomicity
-- (Architect Review, Step 7.2)
--
-- Run by run-domain-tests.sh AFTER rider_race_assertions.sql, in the same
-- database — reuses riders c1000000-...-0001/0002/0003 (Rider A/B/C) and
-- the test_attempt_claim() / test_release_incompletely() /
-- test_close_stale_assignment() helpers from rider_race_setup.sql, plus
-- test_assert/test_as_user/test_select_count_as_user from
-- domain_invariants_test.sql — all persist as real database objects across
-- separate psql invocations against the same container.
--
-- Proves the five cases the Architect Review asked for against
-- public.release_rider_assignment(), added in
-- 20260811000013_rider_reassignment_atomicity.sql:
--   A. normal claim -> release -> new claim
--   B. two riders claim simultaneously -> exactly one winner
--   C. the old rider's assignment cannot be left stale ACCEPTED
--   D. a new rider can claim immediately after a valid release
--   E. a malicious/incomplete release still cannot create two active
--      assignments, and the new atomic function itself refuses to run for
--      anyone but the service role or on an unreleasable delivery

\set ON_ERROR_STOP on

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

\echo ''
\echo '=================================================='
\echo ' BANHAO rider reassignment atomicity — HIGH-2 fix'
\echo '=================================================='

-- ---------------------------------------------------------------------------
-- Fixtures — two fresh deliveries, independent of anything domain_invariants
-- or rider_race already mutated.
-- ---------------------------------------------------------------------------

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values
  ('a1000000-0000-0000-0000-000000000005', 'BH-TEST-0005', 'MERCHANT_ACCEPTED', 'a0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ 5',
   'ลูกค้า ทดสอบ', '+66811111115', 'ONLINE', 9000, 1500, 500, 0, 11000),
  ('a1000000-0000-0000-0000-000000000006', 'BH-TEST-0006', 'MERCHANT_ACCEPTED', 'a0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ 6',
   'ลูกค้า ทดสอบ', '+66811111116', 'ONLINE', 9000, 1500, 500, 0, 11000);

insert into public.deliveries (id, order_id, state)
values
  ('f1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000005', 'RIDER_SEARCHING'),
  ('f1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000006', 'RIDER_SEARCHING');

-- ===========================================================================
-- CASE A + D: normal claim -> atomic release -> new rider claims immediately
-- ===========================================================================

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001'),
  'A1. Rider A claims delivery 3'
);

select public.release_rider_assignment(
  'f1000000-0000-0000-0000-000000000003'::uuid, 'RELEASED', 'rider went offline — test'
);

do $$
declare
  d_state text;
  d_rider uuid;
begin
  select state, rider_id into d_state, d_rider
    from public.deliveries where id = 'f1000000-0000-0000-0000-000000000003';
  perform test_assert(d_state = 'RIDER_SEARCHING' and d_rider is null,
    'A2. After release_rider_assignment, delivery 3 is RIDER_SEARCHING with rider_id NULL');
end $$;

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002'),
  'A3/D1. Rider B claims delivery 3 immediately after the atomic release — succeeds'
);

do $$
declare
  active_count int;
begin
  select count(*) into active_count from public.rider_assignments
    where delivery_id = 'f1000000-0000-0000-0000-000000000003' and status = 'ACCEPTED';
  perform test_assert(active_count = 1,
    'A4/D2. Exactly one ACCEPTED rider_assignments row after the new claim (got ' || active_count || ')');
end $$;

\echo '--- A + D: normal claim / atomic release / immediate re-claim: PASS ---'

-- ===========================================================================
-- CASE C: the OLD rider's assignment cannot be left stale ACCEPTED
-- ===========================================================================

do $$
declare
  old_status text;
  old_closed_at timestamptz;
begin
  select status, closed_at into old_status, old_closed_at
    from public.rider_assignments
   where delivery_id = 'f1000000-0000-0000-0000-000000000003'
     and rider_id = 'c1000000-0000-0000-0000-000000000001';
  perform test_assert(old_status = 'RELEASED' and old_closed_at is not null,
    'C1. Rider A''s original assignment is RELEASED with closed_at set — not left ACCEPTED (got status=' || old_status || ')');
end $$;

\echo '--- C: old rider assignment closed, not stale: PASS ---'

-- ===========================================================================
-- CASE B: two riders claim simultaneously = exactly one winner
--
-- Already proven by execution against TWO GENUINELY CONCURRENT OS
-- processes in run-domain-tests.sh (delivery f1000000-...-0001) — see
-- rider_race_assertions.sql §1. That mechanism (guarded UPDATE + partial
-- unique index) is untouched by this migration set. Re-asserted here under
-- the HIGH-2 case label so it is visible in this suite's own output.
-- ===========================================================================

do $$
declare
  accepted_count int;
begin
  select count(*) into accepted_count from public.rider_assignments
    where delivery_id = 'f1000000-0000-0000-0000-000000000001' and status = 'ACCEPTED';
  perform test_assert(accepted_count = 1,
    'B1. (re-asserted from the genuine concurrent-process race above) Exactly one winner for delivery 1 (got ' || accepted_count || ')');
end $$;

\echo '--- B: concurrent claim -> exactly one winner (re-asserted): PASS ---'

-- ===========================================================================
-- CASE E: malicious/incomplete release cannot create two active assignments
-- ===========================================================================

-- E1. The function itself refuses to run for anyone but the service role —
-- a rider cannot call it directly to manufacture a release, correct or not.
-- (c0000000-...-0002 is Rider B's auth/profile id, the RIDER_B fixture from
-- domain_invariants_test.sql.)
select test_assert(
  test_as_user('c0000000-0000-0000-0000-000000000002',
    $stmt$select public.release_rider_assignment('f1000000-0000-0000-0000-000000000003'::uuid, 'RELEASED', 'malicious')$stmt$
  ) like 'BLOCKED%',
  'E1. release_rider_assignment is not callable by an authenticated rider — service role only'
);

-- E2. An invalid status is rejected outright, before either UPDATE runs —
-- the delivery's state is completely untouched by the rejected call.
do $$
declare
  sqlstate_caught text;
  d_state_before text;
  d_state_after text;
begin
  select state into d_state_before from public.deliveries where id = 'f1000000-0000-0000-0000-000000000003';
  begin
    perform public.release_rider_assignment('f1000000-0000-0000-0000-000000000003'::uuid, 'BOGUS_STATUS', null);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  select state into d_state_after from public.deliveries where id = 'f1000000-0000-0000-0000-000000000003';
  perform test_assert(sqlstate_caught <> 'NO ERROR RAISED',
    'E2a. release_rider_assignment rejects an invalid status (got ' || sqlstate_caught || ')');
  perform test_assert(d_state_before = d_state_after,
    'E2b. The rejected call left delivery 3''s state completely unchanged');
end $$;

-- E3. A delivery that is NOT currently assigned (still RIDER_SEARCHING)
-- cannot be "released" — the function cannot manufacture a release out of
-- nothing, and the rejected call creates no rider_assignments row.
do $$
declare
  sqlstate_caught text;
  assignment_count_before int;
  assignment_count_after int;
begin
  select count(*) into assignment_count_before from public.rider_assignments;
  begin
    perform public.release_rider_assignment('f1000000-0000-0000-0000-000000000004'::uuid, 'RELEASED', null);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  select count(*) into assignment_count_after from public.rider_assignments;
  perform test_assert(sqlstate_caught = 'P0001',
    'E3a. release_rider_assignment on an unassigned delivery is rejected (got ' || sqlstate_caught || ')');
  perform test_assert(assignment_count_before = assignment_count_after,
    'E3b. The rejected call created no rider_assignments row at all');
end $$;

-- E4-E6. The PRE-EXISTING backstop (rider_assignments_one_active, untouched
-- by this migration set) still holds even against a hand-rolled,
-- deliberately incomplete two-statement release that bypasses
-- release_rider_assignment entirely — proving Layer 2 alone still prevents
-- two simultaneously ACCEPTED rows even when the new atomic entry point is
-- skipped altogether, i.e. a "malicious" caller going straight to the base
-- tables cannot manufacture a double-active state either.
select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001'),
  'E4. Rider A claims delivery 4 (setup for the bypass attempt)'
);

select test_release_incompletely('f1000000-0000-0000-0000-000000000004');

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform test_attempt_claim('f1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002');
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    'E5. A hand-rolled incomplete release (bypassing release_rider_assignment) still cannot leave two ACCEPTED assignments (got ' || sqlstate_caught || ')');
end $$;

do $$
declare
  accepted_count int;
begin
  select count(*) into accepted_count from public.rider_assignments
    where delivery_id = 'f1000000-0000-0000-0000-000000000004' and status = 'ACCEPTED';
  perform test_assert(accepted_count = 1,
    'E6. Never more than one ACCEPTED rider_assignments row for delivery 4, even mid-bypass (got ' || accepted_count || ')');
end $$;

-- Clean up delivery 4 the same way the fix is meant to be used, so the
-- suite ends in a consistent state — proves the atomic function correctly
-- recovers a delivery a raw bypass left stuck.
select test_close_stale_assignment('f1000000-0000-0000-0000-000000000004');

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000003'),
  'E7. Once the stale assignment is closed, a new rider claims delivery 4 cleanly'
);

\echo '--- E: malicious/incomplete release cannot create two active assignments: PASS ---'

\echo ''
\echo 'All rider reassignment atomicity (HIGH-2 fix) assertions passed.'
\echo ''
