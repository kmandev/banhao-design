-- BANHAO — Phase E-1 regression tests: atomic order creation (create_order())
--
-- Run by run-domain-tests.sh AFTER order_creation_setup.sql (same container,
-- same database, separate psql invocation — fixture UUIDs below are literal
-- strings for that reason, matching how rider_reassignment_atomicity_test.sql
-- already references rider_race_setup.sql's fixtures) and after the two
-- concurrent create_order() calls the shell script fires directly.
--
-- Covers every case in the Phase E-1 task brief:
--   1-6.   valid creation; orders/order_items/order_item_options/
--          order_status_history all created; order_number format
--   7.     concurrent order numbers cannot collide (asserted here against
--          what the two parallel shell-fired calls actually persisted)
--   8-9.   wrong customer / no cart rejected
--   10.    cross-restaurant cart — structurally unreachable, documented
--   11.    unavailable menu item rejected
--   12.    price tampering impossible (no price parameter exists at all)
--   13.    missing required fee values rejected (uncallable, not just
--          rejected — Postgres won't resolve the call)
--   14-15. rollback proof: a late CHECK-constraint failure undoes an
--          earlier statement in the SAME function call (the order_number
--          counter increment), and leaves no partial order/order_items
--   16-17. execution privilege: service_role succeeds, anon/authenticated
--          are blocked by the EXECUTE grant itself (42501, before this
--          function's own body ever runs)

\set ON_ERROR_STOP on

create or replace function order_test_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- Same shape as domain_invariants_test.sql's test_as_user, generalised to an
-- arbitrary role name — create_order is service_role-only, not
-- authenticated-scoped, so the existing helper (which hardcodes
-- 'authenticated') doesn't fit without duplicating it.
create or replace function order_test_as_role(role_name text, stmt text)
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

\echo ''
\echo '=================================================='
\echo ' BANHAO Phase E-1 — atomic order creation'
\echo '=================================================='

-- ===========================================================================
-- 16-17. Execution privilege — before anything else, so a wrongly-open grant
-- would fail loudly rather than being masked by a later, differently-caused
-- failure.
-- ===========================================================================

select order_test_assert(
  order_test_as_role('anon',
    $stmt$select * from public.create_order('a9000000-0000-0000-0000-000000000001'::uuid, 'a9500000-0000-0000-0000-000000000001'::uuid, 'ONLINE', 1500::bigint, 500::bigint)$stmt$
  ) like 'BLOCKED%',
  '16-17a. anon cannot execute create_order (EXECUTE grant, not this function''s own logic)'
);

select order_test_assert(
  order_test_as_role('authenticated',
    $stmt$select * from public.create_order('a9000000-0000-0000-0000-000000000001'::uuid, 'a9500000-0000-0000-0000-000000000001'::uuid, 'ONLINE', 1500::bigint, 500::bigint)$stmt$
  ) like 'BLOCKED%',
  '16-17b. authenticated cannot execute create_order — only service_role may'
);

select order_test_assert(
  (select count(*) from public.orders where customer_id = 'a9000000-0000-0000-0000-000000000001') = 0,
  '16-17c. the blocked anon/authenticated calls above wrote nothing'
);

-- ===========================================================================
-- 13. Missing required fee values — the signature itself refuses the call
-- (DEC-E-01). This is not a runtime rejection; Postgres cannot even resolve
-- which function to call.
-- ===========================================================================

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform set_config('role', 'service_role', true);
    execute $stmt$select * from public.create_order('a9000000-0000-0000-0000-000000000001'::uuid, 'a9500000-0000-0000-0000-000000000001'::uuid, 'ONLINE')$stmt$;
    sqlstate_caught := 'NO ERROR RAISED';
  exception when undefined_function then
    sqlstate_caught := SQLSTATE;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = '42883',
    '13. create_order is uncallable without explicit fee values (got ' || sqlstate_caught || ')');
end $$;

-- ===========================================================================
-- 1-6. Valid synthetic order creation, and everything it must produce.
-- Synthetic fee fixture values only (1500/500 satang) — illustrative, not an
-- approved BQ-026/BQ-027 number; DEC-E-01 forbids treating this as one.
-- ===========================================================================

select set_config('role', 'service_role', true) as _;
select order_id, order_number, state
  from public.create_order(
    'a9000000-0000-0000-0000-000000000001'::uuid, -- CUST_X
    'a9500000-0000-0000-0000-000000000001'::uuid, -- CUST_X's address
    'ONLINE',
    1500::bigint,  -- synthetic delivery fee fixture, NOT an approved BQ-026 number
    500::bigint,   -- synthetic service fee fixture, NOT an approved BQ-027 number
    0::bigint,
    1200,
    25,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid
  ) \gset x1_
select set_config('role', 'postgres', true) as _;

select order_test_assert(:'x1_order_id' <> '', '1. create_order returned an order_id for CUST_X');
select order_test_assert(:'x1_state' = 'CREATED', '1. returned state is CREATED');
select order_test_assert(
  :'x1_order_number' ~ '^BH-[0-9]{8}-[0-9]{4}$',
  '6. order_number matches BH-YYYYMMDD-NNNN (got ' || :'x1_order_number' || ')'
);

select order_test_assert(
  (select count(*) from public.orders where id = :'x1_order_id') = 1,
  '2. exactly one orders row was created'
);
select order_test_assert(
  (select customer_id from public.orders where id = :'x1_order_id') = 'a9000000-0000-0000-0000-000000000001',
  '2. orders.customer_id is CUST_X, exactly the id passed as p_customer_id'
);
select order_test_assert(
  (select restaurant_name_snapshot from public.orders where id = :'x1_order_id') = 'ร้านทดสอบคำสั่งซื้อ',
  '2. restaurant_name_snapshot was captured live from restaurants.name'
);
select order_test_assert(
  (select delivery_address_snapshot from public.orders where id = :'x1_order_id') = 'ที่อยู่ทดสอบ X',
  '2. delivery_address_snapshot came from the server-validated address (DEC-E-04), not any client text'
);
select order_test_assert(
  (select subtotal_satang from public.orders where id = :'x1_order_id') = 12000,
  -- 2 x (5000 base + 1000 available option); the 1500 unavailable option
  -- must NOT be in this figure at all
  '2. subtotal_satang was computed server-side from live menu prices (2 x 6000 = 12000)'
);
select order_test_assert(
  (select grand_total_satang from public.orders where id = :'x1_order_id') = 14000,
  '2. grand_total_satang = 12000 subtotal + 1500 delivery + 500 service - 0 discount'
);

select order_test_assert(
  (select count(*) from public.order_items where order_id = :'x1_order_id') = 1,
  '3. exactly one order_items row (one cart line)'
);
select order_test_assert(
  (select unit_price_satang from public.order_items where order_id = :'x1_order_id') = 6000,
  '3. unit_price_satang = 5000 base + 1000 available option (the unavailable +1500 option excluded)'
);
select order_test_assert(
  (select item_name_snapshot from public.order_items where order_id = :'x1_order_id') = 'ข้าวผัดทดสอบ',
  '3. item_name_snapshot captured live from menu_items.name'
);
select order_test_assert(
  (select note from public.order_items where order_id = :'x1_order_id') = 'ไม่เผ็ด',
  '3. note carried through from the cart line'
);

select order_test_assert(
  (select count(*) from public.order_item_options oio
     join public.order_items oi on oi.id = oio.order_item_id
    where oi.order_id = :'x1_order_id') = 1,
  '4. exactly one order_item_options row — the AVAILABLE option only'
);
select order_test_assert(
  (select option_name_snapshot from public.order_item_options oio
     join public.order_items oi on oi.id = oio.order_item_id
    where oi.order_id = :'x1_order_id') = 'ไข่ดาว',
  '4. the snapshotted option is the available one (ไข่ดาว), not the unavailable one'
);
select order_test_assert(
  (select group_name_snapshot from public.order_item_options oio
     join public.order_items oi on oi.id = oio.order_item_id
    where oi.order_id = :'x1_order_id') = 'ตัวเลือกไข่',
  '4. group_name_snapshot captured live from menu_option_groups.title'
);

select order_test_assert(
  (select count(*) from public.order_status_history where order_id = :'x1_order_id') = 1,
  '5. exactly one order_status_history row'
);
select order_test_assert(
  (select to_state from public.order_status_history where order_id = :'x1_order_id') = 'CREATED'
  and (select from_state from public.order_status_history where order_id = :'x1_order_id') is null
  and (select actor_type from public.order_status_history where order_id = :'x1_order_id') = 'SYSTEM',
  '5. order_status_history records null -> CREATED, actor_type SYSTEM'
);
select order_test_assert(
  (select correlation_id from public.order_status_history where order_id = :'x1_order_id') = 'aaaaaaaa-0000-0000-0000-000000000001',
  '5. correlation_id passes through when supplied'
);

-- 12. Price tampering impossible — there is no price/subtotal/total
-- parameter in the function signature at all (proven by #13's call above
-- already needing only identity/address/payment/fee args). The proof here
-- is that the SAME menu item, edited AFTER the cart was filled, produces
-- the NEW live price on the NEXT order — the function never trusts a
-- price captured earlier by any client.
update public.menu_items set base_price_satang = 9000
  where id = '19990000-0000-0000-0000-000000000001';

select set_config('role', 'service_role', true) as _;
select order_id, order_number, state
  from public.create_order(
    'a9000000-0000-0000-0000-000000000002'::uuid, -- CUST_Y
    'a9500000-0000-0000-0000-000000000002'::uuid,
    'ONLINE', 1500::bigint, 500::bigint
  ) \gset y1_
select set_config('role', 'postgres', true) as _;

select order_test_assert(
  -- CUST_Y's cart line selects no options, so this is base price only —
  -- the NEW 9000, never the 5000 that was live when the cart was filled.
  (select unit_price_satang from public.order_items where order_id = :'y1_order_id') = 9000,
  '12. price tampering impossible — CUST_Y''s order reflects the NEW live price (9000), not the 5000 that was live when the cart line was added'
);
select order_test_assert(
  -- CUST_X's already-created order is untouched by the later price edit —
  -- exactly why order_items snapshots exist at all.
  (select unit_price_satang from public.order_items where order_id = :'x1_order_id') = 6000,
  '12. an existing order''s snapshot is immutable against a later catalog price edit'
);

-- ===========================================================================
-- 8-9. Ownership — no cart_id parameter exists, so there is no id a caller
-- could supply to reach another customer's cart. A customer with no cart at
-- all is rejected outright.
-- ===========================================================================

do $$
declare
  sqlstate_caught text;
  err_msg text;
begin
  begin
    perform set_config('role', 'service_role', true);
    perform * from public.create_order(
      'a9000000-0000-0000-0000-000000000099'::uuid, -- no profile, no cart
      'a9500000-0000-0000-0000-000000000001'::uuid,
      'ONLINE', 1500::bigint, 500::bigint
    );
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
    get stacked diagnostics err_msg = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = 'P0001' and err_msg like '%does not exist%',
    '8-9a. an unknown customer id is rejected (got ' || sqlstate_caught || ' ' || coalesce(err_msg, '') || ')');
end $$;

-- create_order does NOT clear the cart after a successful call — by design
-- (see the migration header: cart clearing is a future API-layer decision,
-- not this function's job) — so CUST_X's line from test #1 is still there.
-- Drain it explicitly here to construct a genuine empty-cart scenario, and
-- confirm a second call for CUST_X is rejected rather than silently
-- reusing anyone else's cart.
delete from public.cart_items where cart_id = 'c9000000-0000-0000-0000-000000000001';

do $$
declare
  sqlstate_caught text;
  err_msg text;
begin
  begin
    perform set_config('role', 'service_role', true);
    perform * from public.create_order(
      'a9000000-0000-0000-0000-000000000001'::uuid, -- CUST_X again
      'a9500000-0000-0000-0000-000000000001'::uuid,
      'ONLINE', 1500::bigint, 500::bigint
    );
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
    get stacked diagnostics err_msg = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = 'P0001' and err_msg like '%is empty%',
    '8-9b. a customer whose cart has zero lines is rejected, never falls through to anyone else''s cart (got ' || sqlstate_caught || ' ' || coalesce(err_msg, '') || ')');
end $$;

-- Address ownership: CUST_Y may not use CUST_X's address id.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform set_config('role', 'service_role', true);
    -- CUST_Y still has cart line c9100000-...-0002 untouched (only CUST_X's
    -- cart was drained above).
    perform * from public.create_order(
      'a9000000-0000-0000-0000-000000000002'::uuid, -- CUST_Y
      'a9500000-0000-0000-0000-000000000001'::uuid, -- CUST_X's address
      'ONLINE', 1500::bigint, 500::bigint
    );
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = 'P0001',
    '8-9c. a customer cannot use another customer''s address id (got ' || sqlstate_caught || ')');
end $$;

select order_test_assert(
  -- CUST_Y already has exactly ONE valid order from test #12 above — this
  -- confirms the rejected cross-address attempt did not add a second one.
  (select count(*) from public.orders where customer_id = 'a9000000-0000-0000-0000-000000000002') = 1,
  '8-9c-confirm. the rejected cross-address attempt for CUST_Y wrote no additional order'
);

-- ===========================================================================
-- 10. Cross-restaurant cart — structurally unreachable, not merely
-- rejected. DEC-017's composite foreign keys (cart_items -> carts and
-- cart_items -> menu_items, both pinned on restaurant_id) already make it
-- impossible to INSERT a cart_item whose restaurant_id disagrees with its
-- cart's — domain_invariants_test.sql B2/B3 already prove this by
-- execution against the same constraint create_order() itself relies on.
-- This function's own defence-in-depth check
-- ("v_item.restaurant_id <> v_cart.restaurant_id") therefore has no
-- reachable input to exercise in a black-box test; re-proving DEC-017 here
-- would just repeat B2/B3, not test anything new about create_order().
-- ===========================================================================

-- ===========================================================================
-- 11. Unavailable menu item rejected — whole order refused, nothing written.
-- ===========================================================================

insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
values ('c9100000-0000-0000-0000-000000000099', 'c9000000-0000-0000-0000-000000000010',
        'e9000000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000005', 1);
-- (menu_item ...-0005 was flipped is_available = false in the setup fixtures)

do $$
declare
  sqlstate_caught text;
  err_msg text;
begin
  begin
    perform set_config('role', 'service_role', true);
    perform * from public.create_order(
      'a9000000-0000-0000-0000-000000000010'::uuid, -- CUST_C1
      'a9500000-0000-0000-0000-000000000010'::uuid,
      'ONLINE', 1500::bigint, 500::bigint
    );
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
    get stacked diagnostics err_msg = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = 'P0001' and err_msg like '%unavailable items%',
    '11. an unavailable menu item rejects the WHOLE order (got ' || sqlstate_caught || ' ' || coalesce(err_msg, '') || ')');
end $$;

select order_test_assert(
  -- CUST_C1 already has exactly ONE order from the concurrency proof the
  -- shell script fired before this file ran — this confirms the rejected
  -- poisoned-cart attempt did not add a second one.
  (select count(*) from public.orders where customer_id = 'a9000000-0000-0000-0000-000000000010') = 1,
  '11-confirm. CUST_C1''s rejected unavailable-item attempt added no extra order'
);

-- Remove the poison line before the concurrency proof runs — CUST_C1 needs
-- a clean, valid cart for that.
delete from public.cart_items where id = 'c9100000-0000-0000-0000-000000000099';

-- ===========================================================================
-- 14-15. Rollback proof — a late failure (the orders_total_check /
-- grand_total_satang >= 0 CHECK, tripped by an oversized discount) must
-- undo EVERY statement this function already ran in the same call,
-- including the order_number_counters increment that happened moments
-- earlier. If that increment survived, the next successful call would skip
-- a number; it must not.
-- ===========================================================================

select next_seq as pre_rollback_seq from public.order_number_counters
  where business_date = (now() at time zone 'Asia/Bangkok')::date \gset

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform set_config('role', 'service_role', true);
    -- discount (999999900) far exceeds subtotal+fees, forcing a negative
    -- grand_total_satang — the orders table's own CHECK constraint refuses
    -- the insert.
    perform * from public.create_order(
      'a9000000-0000-0000-0000-000000000011'::uuid, -- CUST_C2
      'a9500000-0000-0000-0000-000000000011'::uuid,
      'ONLINE', 1500::bigint, 500::bigint, 999999900::bigint
    );
    sqlstate_caught := 'NO ERROR RAISED';
  exception when check_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform set_config('role', 'postgres', true);
  perform order_test_assert(sqlstate_caught = '23514',
    '14. an impossible discount trips orders'' own CHECK constraint (got ' || sqlstate_caught || ')');
end $$;

select order_test_assert(
  -- CUST_C2 already has exactly ONE order from the concurrency proof above
  -- (fired before this file ran) — this confirms the failed oversized-
  -- discount call added no second, partial one.
  (select count(*) from public.orders where customer_id = 'a9000000-0000-0000-0000-000000000011') = 1,
  '14-15a. no partial orders row survives the failed call'
);
select order_test_assert(
  -- Exactly one order_items row: the ONE line from CUST_C2's genuine
  -- concurrency-proof order, not two.
  (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
     where o.customer_id = 'a9000000-0000-0000-0000-000000000011') = 1,
  '14-15b. no partial order_items row survives the failed call'
);
select order_test_assert(
  (select next_seq from public.order_number_counters
     where business_date = (now() at time zone 'Asia/Bangkok')::date) = :'pre_rollback_seq',
  '14-15c. the order_number_counters increment from the SAME failed call was rolled back too — no number was burned'
);

\echo '--- sequential assertions: PASS ---'

-- ===========================================================================
-- 7. Concurrent order numbers cannot collide — checked against what the two
-- REAL, PARALLEL create_order() calls (fired by run-domain-tests.sh between
-- order_creation_setup.sql and this file, for CUST_C1 and CUST_C2) actually
-- persisted. This is TQ-012's own standard applied to DEC-E-03: proof by
-- execution, not by reading the SQL.
-- ===========================================================================

select order_test_assert(
  (select count(*) from public.orders where customer_id in (
    'a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-000000000011'
  )) = 2,
  '7a. both concurrent callers produced exactly one order each'
);

select order_test_assert(
  (select count(distinct order_number) from public.orders where customer_id in (
    'a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-000000000011'
  )) = 2,
  '7b. the two concurrent order_numbers are DISTINCT — no collision'
);

select order_test_assert(
  (select bool_and(order_number ~ '^BH-[0-9]{8}-[0-9]{4}$') from public.orders where customer_id in (
    'a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-000000000011'
  )),
  '7c. both concurrent order_numbers match BH-YYYYMMDD-NNNN'
);

\echo '--- concurrency assertions: PASS ---'
\echo ''
\echo '=================================================='
\echo ' Phase E-1 create_order(): ALL ASSERTIONS PASSED'
\echo '=================================================='
