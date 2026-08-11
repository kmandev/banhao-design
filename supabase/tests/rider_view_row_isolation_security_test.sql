-- BANHAO — rider_view_row_isolation_security_test
--
-- Regression test for Architect Review Step 7.3, finding H-1: without
-- `security_barrier`, a plain (non-invoker, owner-privilege) view lets
-- Postgres reorder a client-supplied predicate AHEAD of the view's own
-- security predicate (`is_assigned_order_rider()`), because that function
-- is not marked LEAKPROOF and the view was not marked `security_barrier`.
-- The result: a rider can smuggle an error-raising expression into a WHERE
-- clause against a column of an order that is NOT theirs, and observe
-- whether the expression's "trap" branch fired — an oracle that discloses
-- the content of `delivery_address_snapshot`, `recipient_phone_snapshot`,
-- `recipient_name_snapshot`, item names, and option names for ANY order in
-- the system, entirely without that order ever appearing as a returned row.
--
-- THIS TEST REPRODUCES THAT EXACT PROBE and asserts a clean (non-erroring)
-- result now that `20260811000012_rider_order_views.sql` sets
-- `security_barrier = true` on all three rider views. If a future change
-- ever drops `security_barrier`, or replaces `is_assigned_order_rider` with
-- something the planner is willing to push a predicate below, this test
-- fails with a division_by_zero error surfacing at the assertion site.
--
-- Run after domain_invariants_test.sql, same database — reuses RIDER_A
-- (c1000000-...-0001), RIDER_B (c1000000-...-0002), and RIDER_A's own
-- order a1000000-...-0001 (assigned via delivery f2000000-...-0001, §G of
-- domain_invariants_test.sql) as the "own row" control. test_assert /
-- test_as_user / test_select_count_as_user already exist as persisted
-- database objects from that file.

\set ON_ERROR_STOP on

-- psql client-side variables do NOT persist across separate `psql -f`
-- invocations (unlike the database objects created in earlier steps) —
-- redeclare the fixture ids from domain_invariants_test.sql here.
\set CUST_A   'a0000000-0000-0000-0000-000000000001'
\set OWNER_1  'b0000000-0000-0000-0000-000000000001'
\set RIDER_A  'c0000000-0000-0000-0000-000000000001'
\set RIDER_B  'c0000000-0000-0000-0000-000000000002'

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
\echo ' rider_view_row_isolation_security_test (H-1 fix)'
\echo '=================================================='

-- ---------------------------------------------------------------------------
-- Fixture: a VICTIM order belonging to RIDER_B, with distinguishing values
-- that only appear on this one row anywhere in the database. RIDER_A must
-- never be able to detect their presence — not even via an error signal.
-- ---------------------------------------------------------------------------

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1000000-0000-0000-0000-000000000010', 'BH-TEST-0010', 'PAID', 'a0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ORACLE VICTIM SECRET ADDRESS',
  'Victim Name', '+66899990000', 'ONLINE', 12000, 1500, 500, 0, 14000
);

insert into public.order_items (id, order_id, restaurant_id, item_name_snapshot, unit_price_satang, quantity, line_total_satang)
values ('a2000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000010',
        'e0000000-0000-0000-0000-000000000001', 'ORACLEVICTIMITEM', 12000, 1, 12000);

insert into public.order_item_options (id, order_item_id, group_name_snapshot, option_name_snapshot, price_delta_satang)
values ('a2100000-0000-0000-0000-000000000010', 'a2000000-0000-0000-0000-000000000010',
        'group', 'ORACLEVICTIMOPT', 0);

insert into public.deliveries (id, order_id, state, rider_id, assigned_at)
values ('f2000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000010',
        'RIDER_ASSIGNED', 'c1000000-0000-0000-0000-000000000002', now());

insert into public.rider_assignments (delivery_id, rider_id, status)
values ('f2000000-0000-0000-0000-000000000010', 'c1000000-0000-0000-0000-000000000002', 'ACCEPTED');

-- Sanity: RIDER_A (the attacker in this test) cannot see the victim row as
-- a returned row at all — this was already true before Step 7.3 and is not
-- what H-1 was about. The oracle attack below does NOT rely on the row
-- being returned.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000010'$stmt$
  ) = 0,
  '0. Sanity — RIDER_A cannot see the victim order as a row (unchanged, not the H-1 gap)'
);

-- ===========================================================================
-- STRUCTURAL CHECK: security_barrier is actually set on all three views.
-- Independent of planner behaviour/cost estimates — catches a regression
-- even if a future Postgres version changes when/whether the planner would
-- otherwise have pushed the predicate down.
-- ===========================================================================

do $$
declare
  missing text;
begin
  select string_agg(relname, ', ') into missing
    from pg_class
   where relname in ('rider_order_view', 'rider_order_item_view', 'rider_order_item_option_view')
     and not (coalesce(reloptions, '{}'::text[]) && array['security_barrier=true']);
  perform test_assert(missing is null,
    '1. security_barrier=true is set on all three rider views (missing on: ' || coalesce(missing, 'none') || ')');
end $$;

-- ===========================================================================
-- THE ORACLE ATTACK, reproduced exactly as found in Architect Review #2.
--
-- test_as_user returns 'ALLOWED' if the statement executed with no error,
-- or 'BLOCKED: <sqlstate>' if it raised one. An attacker-controlled
-- predicate of the shape `1 / (case when <secret column> like <guess> then
-- 0 else 1 end) = 1` raises division_by_zero (22012) IF AND ONLY IF the
-- <secret column> comparison was evaluated for at least one row where it
-- matched — regardless of whether that row is ever returned to the client.
-- ===========================================================================

-- CONTROL 1 — a pattern that matches NOTHING anywhere in the table. Must be
-- clean. (Confirms the query shape itself doesn't error unconditionally.)
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_view
       where 1 / (case when delivery_address_snapshot like 'ZZZ_NO_SUCH_ADDRESS_ANYWHERE%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '2. Control — a predicate matching no row anywhere is clean (oracle baseline)'
);

-- CONTROL 2 — a pattern that matches RIDER_A's OWN, legitimately-visible
-- row (order a1000000-...-0001, delivery_address_snapshot = '88 หมู่ 4
-- บ้านบุณฑริก' per domain_invariants_test.sql §C). This SHOULD raise —
-- proves the probe mechanism genuinely fires when applied to a row the
-- security predicate actually admits, so control 1's "clean" result above
-- isn't just a broken probe.
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_view
       where 1 / (case when delivery_address_snapshot like '88%' then 0 else 1 end) = 1$stmt$
  ) = 'BLOCKED: 22012',
  '3. Control — the SAME predicate shape against RIDER_A''s own visible row does trap (validates the probe is a real oracle when unblocked)'
);

-- THE ATTACK — a pattern that matches ONLY the victim row (RIDER_B's
-- order, never RIDER_A's). If security_barrier is doing its job, this MUST
-- behave exactly like control 1: clean, no error, no signal.
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_view
       where 1 / (case when delivery_address_snapshot like 'ORACLE VICTIM%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '4. ATTACK — a predicate matching ONLY the hidden victim order''s address does NOT trap (row isolation holds under an adversarial predicate)'
);

-- Same attack against the victim's phone number — the field an attacker
-- would most want to exfiltrate (enables a real-world binary search of the
-- full number one prefix at a time).
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_view
       where 1 / (case when recipient_phone_snapshot like '+66899%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '5. ATTACK — a predicate matching ONLY the hidden victim order''s phone prefix does NOT trap'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_view
       where 1 / (case when recipient_phone_snapshot like '+66123%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '6. Control — a non-matching phone prefix is also clean (both branches indistinguishable = no oracle signal)'
);

-- Same attack shape against rider_order_item_view (item name) and
-- rider_order_item_option_view (option name) — the other two views this
-- migration set granted security_barrier to.
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_item_view
       where 1 / (case when item_name_snapshot like 'ORACLEVICTIMITEM%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '7. ATTACK — rider_order_item_view: predicate matching only the victim''s item name does NOT trap'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select 1 from public.rider_order_item_option_view
       where 1 / (case when option_name_snapshot like 'ORACLEVICTIMOPT%' then 0 else 1 end) = 1$stmt$
  ) = 'ALLOWED',
  '8. ATTACK — rider_order_item_option_view: predicate matching only the victim''s option name does NOT trap'
);

-- ===========================================================================
-- Confirm the fix did not regress anything H-1 already proved: permitted
-- columns/rows still work, forbidden columns are still structurally absent,
-- customer/merchant access is still unaffected.
-- ===========================================================================

select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 1,
  '9. RIDER_A still reads their OWN assigned order through the view (no functional regression)'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select grand_total_satang from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 'BLOCKED: 42703',
  '10. grand_total_satang is still structurally absent from rider_order_view (undefined_column, unaffected by security_barrier)'
);
select test_assert(
  test_select_count_as_user(:'CUST_A',
    $stmt$select count(*) from public.orders
       where id = 'a1000000-0000-0000-0000-000000000001' and grand_total_satang = 13000$stmt$
  ) = 1,
  '11. Customer access to orders, including money columns, is still unchanged'
);
select test_assert(
  test_select_count_as_user(:'OWNER_1',
    $stmt$select count(*) from public.orders
       where id = 'a1000000-0000-0000-0000-000000000001' and grand_total_satang = 13000$stmt$
  ) = 1,
  '12. Merchant access to orders, including money columns, is still unchanged'
);

\echo ''
\echo 'All rider view row-isolation security assertions passed.'
\echo ''
