-- BANHAO — assertions for the rider race condition test
--
-- Run after run-domain-tests.sh has launched two REAL, CONCURRENT psql
-- processes both calling test_attempt_claim('...0001', <rider>) for
-- delivery f1000000-0000-0000-0000-000000000001 — proof by execution
-- against real PostgreSQL (TQ-012), not by reasoning about the SQL.

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
\echo ' BANHAO rider race condition — proof by execution'
\echo '=================================================='

-- ---------------------------------------------------------------------------
-- 1. THE mandatory test: concurrent claim → exactly one winner
-- ---------------------------------------------------------------------------

do $$
declare
  d_state text;
  d_rider uuid;
  accepted_count int;
begin
  select state, rider_id into d_state, d_rider
    from public.deliveries where id = 'f1000000-0000-0000-0000-000000000001';

  select count(*) into accepted_count
    from public.rider_assignments
   where delivery_id = 'f1000000-0000-0000-0000-000000000001' and status = 'ACCEPTED';

  perform test_assert(d_state = 'RIDER_ASSIGNED',
    '1a. After two concurrent claims, delivery state is RIDER_ASSIGNED (got ' || d_state || ')');
  perform test_assert(d_rider is not null,
    '1b. A rider_id is set after the concurrent race');
  perform test_assert(d_rider in ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002'),
    '1c. The winner is one of the two riders who actually raced');
  perform test_assert(accepted_count = 1,
    '1d. Exactly ONE rider_assignments row is ACCEPTED for this delivery (got ' || accepted_count || ') — NOT both riders won');
end $$;

-- ---------------------------------------------------------------------------
-- 2. The database backstop, tested directly: bypass test_attempt_claim
--    entirely and try to INSERT a second ACCEPTED row by hand. Even a raw
--    INSERT that skips the guarded UPDATE must be rejected.
-- ---------------------------------------------------------------------------

do $$
declare
  loser_rider uuid;
  winner_rider uuid;
  sqlstate_caught text;
begin
  select rider_id into winner_rider from public.deliveries
    where id = 'f1000000-0000-0000-0000-000000000001';
  loser_rider := case when winner_rider = 'c1000000-0000-0000-0000-000000000001'
                       then 'c1000000-0000-0000-0000-000000000002'::uuid
                       else 'c1000000-0000-0000-0000-000000000001'::uuid end;

  begin
    insert into public.rider_assignments (delivery_id, rider_id, status)
    values ('f1000000-0000-0000-0000-000000000001', loser_rider, 'ACCEPTED');
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;

  perform test_assert(sqlstate_caught = '23505',
    '2. A raw INSERT of a second ACCEPTED rider_assignments row is rejected by rider_assignments_one_active (got ' || sqlstate_caught || ')');
end $$;

-- ---------------------------------------------------------------------------
-- 3. Correct release (both statements) → reassignment SUCCEEDS (DEC-021)
-- ---------------------------------------------------------------------------

select test_release_correctly('f1000000-0000-0000-0000-000000000001', 'rider cancelled — test');

do $$
declare
  d_state text;
  d_rider uuid;
begin
  select state, rider_id into d_state, d_rider
    from public.deliveries where id = 'f1000000-0000-0000-0000-000000000001';
  perform test_assert(d_state = 'RIDER_SEARCHING' and d_rider is null,
    '3a. After a correct release, delivery returns to RIDER_SEARCHING with rider_id NULL');
end $$;

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003'),
  '3b. A THIRD rider can claim the released delivery — DEC-021 reassignment works when the release is done correctly'
);

do $$
declare
  active_count int;
  released_count int;
begin
  select count(*) into active_count from public.rider_assignments
    where delivery_id = 'f1000000-0000-0000-0000-000000000001' and status = 'ACCEPTED';
  select count(*) into released_count from public.rider_assignments
    where delivery_id = 'f1000000-0000-0000-0000-000000000001' and status = 'RELEASED';
  perform test_assert(active_count = 1,
    '3c. Exactly one ACCEPTED assignment after reassignment (got ' || active_count || ')');
  perform test_assert(released_count >= 1,
    '3d. The original winner''s assignment is RELEASED, not deleted (found ' || released_count || ' released row(s))');
end $$;

-- ---------------------------------------------------------------------------
-- 4. THE ARCHITECTURE REVIEW'S FINDING, reproduced and then fixed:
--    an INCOMPLETE release (nulling deliveries.rider_id without closing the
--    old rider_assignments row) makes the delivery PERMANENTLY
--    UNASSIGNABLE — proving why both statements in the release invariant
--    are mandatory, not merely documented as a preference.
-- ---------------------------------------------------------------------------

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001'),
  '4a. Rider A claims delivery 2 successfully'
);

select test_release_incompletely('f1000000-0000-0000-0000-000000000002');

do $$
declare
  d_state text;
  d_rider uuid;
begin
  select state, rider_id into d_state, d_rider
    from public.deliveries where id = 'f1000000-0000-0000-0000-000000000002';
  perform test_assert(d_state = 'RIDER_SEARCHING' and d_rider is null,
    '4b. deliveries.rider_id was nulled by the incomplete release (as far as it went)');
end $$;

-- THE BUG, proven by execution — and it is WORSE than "the claim quietly
-- fails". Because the incomplete release nulled deliveries.rider_id, the
-- guarded UPDATE half of the next claim actually SUCCEEDS (rowcount 1) —
-- it is the follow-up INSERT into rider_assignments that then hits
-- rider_assignments_one_active, because the old row is still ACCEPTED.
-- A real NestJS handler that does not catch this specific unique_violation
-- would crash mid-transaction rather than return a clean "unavailable"
-- response. This is a sharper version of the finding than "the claim is
-- quietly rejected" — it is a hard error a caller must explicitly handle.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform test_attempt_claim('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002');
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    '4c. THE FOUND BUG, reproduced precisely: with the old rider_assignments row still ACCEPTED, deliveries.rider_id being NULL lets the guarded UPDATE succeed, but the rider_assignments INSERT then raises unique_violation — a hard error, not a quiet failure (got ' || sqlstate_caught || ')');
end $$;

do $$
declare
  d_state text;
  d_rider uuid;
begin
  select state, rider_id into d_state, d_rider from public.deliveries
    where id = 'f1000000-0000-0000-0000-000000000002';
  -- The failed transaction's UPDATE did not roll back the delivery row
  -- (each statement in test_attempt_claim ran and the exception surfaced
  -- only at INSERT time — but the PL/pgSQL function body is one implicit
  -- transaction block from the caller's perspective, so the whole call
  -- rolled back). Confirm the delivery is back to a consistent, but still
  -- stuck, state: searching, unassigned, with the stale ACCEPTED row still
  -- blocking every future attempt until it is closed.
  perform test_assert(d_state = 'RIDER_SEARCHING' and d_rider is null,
    '4d. The failed claim attempt rolled back cleanly — delivery is RIDER_SEARCHING/unassigned, but still stuck (state=' || d_state || ')');
end $$;

-- THE FIX: close the stale assignment (the second half of the release
-- invariant that was skipped above).
select test_close_stale_assignment('f1000000-0000-0000-0000-000000000002');

select test_assert(
  test_attempt_claim('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002'),
  '4e. THE FIX, proven: once the stale assignment is closed, a new rider claims successfully — this is exactly why docs/DATABASE_DESIGN.md § 11.1 requires BOTH release statements in the same transaction'
);

\echo ''
\echo 'All rider race condition assertions passed.'
\echo ''
