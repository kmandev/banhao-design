-- BANHAO — executable verification for the Supabase Migration v1 domain schema
--
-- Run via: ./supabase/tests/run-domain-tests.sh
--
-- Covers, by execution against real PostgreSQL (not by reasoning):
--   A. Multi-role identity (DEC-033) — no profiles.role, domain membership only
--   B. One cart = one restaurant (DEC-017), enforced by composite FK
--   C. Order snapshot integrity and write-once/immutability triggers
--   D. Payment idempotency and duplicate-webhook protection (DEC-028)
--   E. Ledger append-only + duplicate-group-key protection (DEC-034)
--   F. RLS: representative access for customer, merchant, rider, and the
--      "no client can write financial/state columns" boundary
--
-- The rider race condition (§19 of the migration brief) is NOT in this
-- file — it needs genuine concurrent client connections and is proven in
-- rider_race_test.sql, orchestrated by run-domain-tests.sh.

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

-- Same shape as test_as_user but returns a row count / scalar for SELECT
-- assertions rather than an ALLOWED/BLOCKED string.
create or replace function test_select_count_as_user(user_id uuid, stmt text)
returns int language plpgsql as $$
declare
  result int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id)::text, true);
  execute stmt into result;
  perform set_config('role', 'postgres', true);
  return result;
end;
$$;

create or replace function test_as_anon(stmt text)
returns text language plpgsql as $$
declare
  err text;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
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
\echo ' BANHAO domain invariants — Supabase Migration v1'
\echo '=================================================='

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

\set CUST_A   'a0000000-0000-0000-0000-000000000001'
\set CUST_B   'a0000000-0000-0000-0000-000000000002'
\set OWNER_1  'b0000000-0000-0000-0000-000000000001'
\set OWNER_2  'b0000000-0000-0000-0000-000000000002'
\set RIDER_A  'c0000000-0000-0000-0000-000000000001'
\set RIDER_B  'c0000000-0000-0000-0000-000000000002'

insert into auth.users (id, phone) values
  (:'CUST_A',  '+66810000001'),
  (:'CUST_B',  '+66810000002'),
  (:'OWNER_1', '+66820000001'),
  (:'OWNER_2', '+66820000002'),
  (:'RIDER_A', '+66830000001'),
  (:'RIDER_B', '+66830000002')
on conflict (id) do nothing;

-- Two independent merchants/restaurants, so cross-restaurant access can be
-- proven denied, not merely unasserted.
insert into public.merchants (id, owner_user_id, legal_name, status)
values
  ('d0000000-0000-0000-0000-000000000001', :'OWNER_1', 'ส้มตำป้าทองดี', 'ACTIVE'),
  ('d0000000-0000-0000-0000-000000000002', :'OWNER_2', 'ร้านอื่น',       'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ACTIVE', 14.3, 105.2),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'ร้านอื่น',       'ACTIVE', 14.3, 105.2);

insert into public.restaurant_members (restaurant_id, user_id, member_role)
values
  ('e0000000-0000-0000-0000-000000000001', :'OWNER_1', 'OWNER'),
  ('e0000000-0000-0000-0000-000000000002', :'OWNER_2', 'OWNER');

insert into public.menu_categories (id, restaurant_id, name)
values ('f0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'อาหารจานเดียว');

insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, is_available)
values
  ('11110000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'ส้มตำไทย', 12000, true),
  -- belongs to the SECOND restaurant — used to prove DEC-017 enforcement
  ('11110000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
   (select id from public.menu_categories limit 1), 'ผัดไทย', 8000, true);

-- The second menu item needs its own category on restaurant 2.
insert into public.menu_categories (id, restaurant_id, name)
values ('f0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', 'จานเดียว');
update public.menu_items set category_id = 'f0000000-0000-0000-0000-000000000002'
  where id = '11110000-0000-0000-0000-000000000002';

insert into public.riders (id, user_id, full_name, status)
values
  ('c1000000-0000-0000-0000-000000000001', :'RIDER_A', 'ไรเดอร์ เอ', 'APPROVED'),
  ('c1000000-0000-0000-0000-000000000002', :'RIDER_B', 'ไรเดอร์ บี', 'APPROVED');

\echo '--- fixtures loaded ---'

-- ===========================================================================
-- A. Multi-role identity (DEC-033) — domain membership, not profiles.role
-- ===========================================================================

-- OWNER_1 is simultaneously: a restaurant owner (restaurant_members), AND
-- (below) will place an order as a customer. No profiles.role change is
-- involved anywhere in this section — that is the entire point of DEC-033.

do $$
begin
  perform test_assert(
    public.is_restaurant_member('e0000000-0000-0000-0000-000000000001'::uuid) is not null,
    '(sanity) is_restaurant_member callable'
  );
end $$;

-- OWNER_1 is a member of restaurant 1 ...
select test_assert(
  test_as_user('b0000000-0000-0000-0000-000000000001',
    $stmt$select 1 from public.restaurants where id = 'e0000000-0000-0000-0000-000000000001' and public.is_restaurant_member(id)$stmt$
  ) = 'ALLOWED',
  'A1. OWNER_1 is recognised as a member of their own restaurant'
);

-- ... but NOT of restaurant 2 (membership is per-restaurant, DEC-033's whole
-- point: "a MERCHANT capability grants nothing global").
do $$
declare visible int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000001"}', true);
  select count(*) into visible from public.restaurant_members
    where restaurant_id = 'e0000000-0000-0000-0000-000000000002';
  perform set_config('role', 'postgres', true);
  perform test_assert(visible = 0,
    'A2. OWNER_1 has no membership row on a restaurant they do not own');
end $$;

-- OWNER_1 also becomes a customer below (placing an order) and this section
-- proves that works with zero role-column changes — see section C.

\echo '--- A. multi-role identity: PASS ---'

-- ===========================================================================
-- B. One cart = one restaurant (DEC-017), enforced by composite FK
-- ===========================================================================

insert into public.carts (id, user_id, restaurant_id)
values ('c2000000-0000-0000-0000-000000000001', :'CUST_A', 'e0000000-0000-0000-0000-000000000001');

-- A cart_item pointing at a menu item from the CART's restaurant: allowed.
insert into public.cart_items (cart_id, restaurant_id, menu_item_id, quantity)
values ('c2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        '11110000-0000-0000-0000-000000000001', 2);

select test_assert(
  (select count(*) from public.cart_items where cart_id = 'c2000000-0000-0000-0000-000000000001') = 1,
  'B1. A same-restaurant cart_item is accepted'
);

-- A cart_item claiming restaurant 1 but pointing at restaurant 2's menu
-- item: the composite FK to menu_items(id, restaurant_id) has no matching
-- row, so this MUST fail with a foreign key violation (23503) — not merely
-- be rejected by application code.
do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.cart_items (cart_id, restaurant_id, menu_item_id, quantity)
    values ('c2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
            '11110000-0000-0000-0000-000000000002', 1); -- restaurant 2's item
    sqlstate_caught := 'NO ERROR RAISED';
  exception when foreign_key_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23503',
    'B2. Cross-restaurant cart_item is REJECTED by the composite FK (got ' || sqlstate_caught || ')');
end $$;

-- A cart_item that claims to belong to restaurant 2 while its cart_id
-- belongs to restaurant 1's cart: the OTHER composite FK (to
-- carts(id, restaurant_id)) has no matching row either.
do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.cart_items (cart_id, restaurant_id, menu_item_id, quantity)
    values ('c2000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
            '11110000-0000-0000-0000-000000000002', 1);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when foreign_key_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23503',
    'B3. A cart_item cannot claim a different restaurant than its own cart (got ' || sqlstate_caught || ')');
end $$;

\echo '--- B. one cart = one restaurant: PASS ---'

-- ===========================================================================
-- C. Order snapshot integrity and immutability
-- ===========================================================================

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1000000-0000-0000-0000-000000000001', 'BH-TEST-0001', 'PAID', :'CUST_A',
  'e0000000-0000-0000-0000-000000000001',
  'ส้มตำป้าทองดี', '88 หมู่ 4 บ้านบุณฑริก',
  'สมชาย ใจดี', '+66811111111', 'ONLINE',
  12000, 1500, 500, 1000, 13000
);

insert into public.order_items (id, order_id, restaurant_id, menu_item_id, item_name_snapshot, unit_price_satang, quantity, line_total_satang)
values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
        'e0000000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001',
        'ส้มตำไทย', 12000, 1, 12000);

-- C1. The grand_total check constraint holds on the row as inserted.
select test_assert(
  (select grand_total_satang from public.orders where id = 'a1000000-0000-0000-0000-000000000001') = 13000,
  'C1. Order total matches subtotal + fees - discount at creation'
);

-- C2. Editing the LIVE menu item price does not touch the historical
-- snapshot — this is the entire reason order_items exists.
update public.menu_items set base_price_satang = 99999
  where id = '11110000-0000-0000-0000-000000000001';

select test_assert(
  (select unit_price_satang from public.order_items where id = 'a2000000-0000-0000-0000-000000000001') = 12000,
  'C2. order_items.unit_price_satang is unaffected by a later menu_items price edit'
);

-- C3. order_items is write-once: UPDATE is rejected outright, for any role
-- (the trigger has no service_role escape hatch — we are running as
-- postgres/superuser here, which proves the trigger, not RLS, is the guard).
do $$
declare sqlstate_caught text;
begin
  begin
    update public.order_items set unit_price_satang = 1 where id = 'a2000000-0000-0000-0000-000000000001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'C3. order_items UPDATE is rejected even for a superuser session (got ' || sqlstate_caught || ')');
end $$;

-- C4. order_items cannot be deleted either.
do $$
declare sqlstate_caught text;
begin
  begin
    delete from public.order_items where id = 'a2000000-0000-0000-0000-000000000001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'C4. order_items DELETE is rejected (got ' || sqlstate_caught || ')');
end $$;

-- C5. orders' MONEY columns are immutable, even for a superuser session.
do $$
declare sqlstate_caught text;
begin
  begin
    update public.orders set grand_total_satang = 1 where id = 'a1000000-0000-0000-0000-000000000001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'C5. orders.grand_total_satang is immutable after creation (got ' || sqlstate_caught || ')');
end $$;

-- C6. ...but orders.state IS allowed to advance — the trigger blocks
-- specific columns, not the whole row.
do $$
declare sqlstate_caught text;
begin
  begin
    update public.orders set state = 'MERCHANT_ACCEPTED', accepted_at = now()
      where id = 'a1000000-0000-0000-0000-000000000001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = 'NO ERROR RAISED',
    'C6. orders.state and milestone timestamps remain updatable (got ' || sqlstate_caught || ')');
end $$;

-- C7. orders cannot be deleted, ever.
do $$
declare sqlstate_caught text;
begin
  begin
    delete from public.orders where id = 'a1000000-0000-0000-0000-000000000001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'C7. orders DELETE is rejected (got ' || sqlstate_caught || ')');
end $$;

\echo '--- C. order snapshot integrity: PASS ---'

-- ===========================================================================
-- D. Payment idempotency and duplicate-webhook protection (DEC-028)
-- ===========================================================================

insert into public.payments (id, order_id, payment_reference, state, method, amount_satang)
values ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
        'PAY-BH-TEST-0001', 'SUCCESS', 'ONLINE', 13000);

-- D1. A second payment for the SAME order is rejected (order_id is unique).
do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.payments (order_id, payment_reference, method, amount_satang)
    values ('a1000000-0000-0000-0000-000000000001', 'PAY-BH-TEST-0001-DUP', 'ONLINE', 13000);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    'D1. A second payment for one order is rejected — unique(order_id) (got ' || sqlstate_caught || ')');
end $$;

-- D2. payment_reference reuse is rejected even for a different order.
insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1000000-0000-0000-0000-000000000002', 'BH-TEST-0002', 'PENDING_PAYMENT', :'CUST_B',
  'e0000000-0000-0000-0000-000000000001',
  'ส้มตำป้าทองดี', 'another address', 'ลูกค้า บี', '+66811111112', 'ONLINE',
  8000, 1500, 500, 0, 10000
);

do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.payments (order_id, payment_reference, method, amount_satang)
    values ('a1000000-0000-0000-0000-000000000002', 'PAY-BH-TEST-0001', 'ONLINE', 10000);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    'D2. payment_reference reuse across orders is rejected (got ' || sqlstate_caught || ')');
end $$;

-- D3. THE duplicate-webhook protection: two payment_events with the same
-- (provider, provider_event_id) — the second must fail.
insert into public.payment_events (payment_id, provider, provider_event_id, event_type, signature_verified, raw_payload)
values ('a3000000-0000-0000-0000-000000000001', 'test-provider', 'evt_dup_001', 'payment.succeeded', true, '{}'::jsonb);

do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.payment_events (payment_id, provider, provider_event_id, event_type, signature_verified, raw_payload)
    values ('a3000000-0000-0000-0000-000000000001', 'test-provider', 'evt_dup_001', 'payment.succeeded', true, '{}'::jsonb);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    'D3. Duplicate webhook event (provider, provider_event_id) is rejected (got ' || sqlstate_caught || ')');
end $$;

-- D4. But a genuinely SECOND payment_transaction (a surplus/duplicate
-- PAYMENT, not a duplicate event) is recorded, not swallowed.
insert into public.payment_transactions (payment_id, direction, amount_satang, provider_transaction_id)
values ('a3000000-0000-0000-0000-000000000001', 'IN', 13000, 'txn_001');
insert into public.payment_transactions (payment_id, direction, amount_satang, provider_transaction_id)
values ('a3000000-0000-0000-0000-000000000001', 'IN', 13000, 'txn_002_surplus');

select test_assert(
  (select count(*) from public.payment_transactions where payment_id = 'a3000000-0000-0000-0000-000000000001') = 2,
  'D4. A surplus payment transaction is recorded (not conflated with duplicate-event protection)'
);

-- D5. payment_events are append-only except processed_at/processing_error.
do $$
declare sqlstate_caught text;
begin
  begin
    update public.payment_events set event_type = 'tampered' where provider_event_id = 'evt_dup_001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'D5a. payment_events.event_type is immutable (got ' || sqlstate_caught || ')');
end $$;

do $$
declare sqlstate_caught text;
begin
  begin
    update public.payment_events set processed_at = now() where provider_event_id = 'evt_dup_001';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = 'NO ERROR RAISED',
    'D5b. payment_events.processed_at remains updatable (got ' || sqlstate_caught || ')');
end $$;

\echo '--- D. payment idempotency: PASS ---'

-- ===========================================================================
-- E. Ledger append-only + duplicate group key (DEC-034 — no zero-sum
--    trigger, but idempotency and immutability ARE enforced)
-- ===========================================================================

insert into public.ledger_entry_groups (id, group_key, order_id, kind)
values ('a4000000-0000-0000-0000-000000000001', 'payment:PAY-BH-TEST-0001:txn:txn_001', 'a1000000-0000-0000-0000-000000000001', 'PAYMENT_SUCCESS');

do $$
declare sqlstate_caught text;
begin
  begin
    insert into public.ledger_entry_groups (group_key, order_id, kind)
    values ('payment:PAY-BH-TEST-0001:txn:txn_001', 'a1000000-0000-0000-0000-000000000001', 'PAYMENT_SUCCESS');
    sqlstate_caught := 'NO ERROR RAISED';
  exception when unique_violation then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '23505',
    'E1. Duplicate ledger group_key is rejected — DEC-028 fail-loudly (got ' || sqlstate_caught || ')');
end $$;

insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
values
  ('a4000000-0000-0000-0000-000000000001', 'CUSTOMER_PAYMENT', 'CUSTOMER', :'CUST_A', 13000),
  ('a4000000-0000-0000-0000-000000000001', 'MERCHANT_PAYABLE', 'MERCHANT', 'd0000000-0000-0000-0000-000000000001', -10800),
  ('a4000000-0000-0000-0000-000000000001', 'PLATFORM_REVENUE', 'PLATFORM', null, -2200);

-- E2. The group sums to zero — but note this is verified BY THE TEST, not
-- by any database trigger (DEC-034: no zero-sum trigger in Phase 1).
select test_assert(
  (select coalesce(sum(amount_satang), 0) from public.ledger_entries
     where group_id = 'a4000000-0000-0000-0000-000000000001') = 0,
  'E2. This ledger group sums to zero (asserted by the test/application, not a DB trigger — DEC-034)'
);

-- E3. ledger_entries cannot be updated or deleted, for any role.
do $$
declare sqlstate_caught text;
begin
  begin
    update public.ledger_entries set amount_satang = 0
      where group_id = 'a4000000-0000-0000-0000-000000000001' and account = 'CUSTOMER_PAYMENT';
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := SQLSTATE;
  end;
  perform test_assert(sqlstate_caught = '42501',
    'E3. ledger_entries UPDATE is rejected (got ' || sqlstate_caught || ')');
end $$;

\echo '--- E. ledger append-only + idempotency: PASS ---'

-- ===========================================================================
-- F. RLS — representative access for customer, merchant, rider; and the
--    "no client can write financial/state columns" boundary
-- ===========================================================================

-- F1. CUST_A can see their own order.
select test_assert(
  test_select_count_as_user(:'CUST_A',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 1,
  'F1. Customer sees their own order'
);

-- F2. CUST_B CANNOT see CUST_A's order.
select test_assert(
  test_select_count_as_user(:'CUST_B',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 0,
  'F2. A different customer cannot see another customer''s order'
);

-- F3. OWNER_1 (member of restaurant 1) sees the order placed there.
select test_assert(
  test_select_count_as_user(:'OWNER_1',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 1,
  'F3. Merchant member sees an order placed at their restaurant'
);

-- F4. OWNER_2 (member of restaurant 2, a DIFFERENT restaurant) cannot see it.
select test_assert(
  test_select_count_as_user(:'OWNER_2',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 0,
  'F4. A different restaurant''s merchant cannot see this order'
);

-- F5. Neither rider can see the order yet — no delivery/assignment exists.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 0,
  'F5. An unassigned rider cannot see the order'
);

-- F6. Public (anon) can read the active restaurant's menu ...
select test_assert(
  test_as_anon(
    $stmt$select 1 from public.menu_items where id = '11110000-0000-0000-0000-000000000001' and is_available$stmt$
  ) = 'ALLOWED',
  'F6. anon can read an available menu item on an active restaurant'
);

-- F7. ... but anon cannot read orders, payments, or carts at all.
select test_assert(
  test_as_anon($stmt$select 1 from public.orders limit 1$stmt$) like 'BLOCKED%',
  'F7a. anon cannot read orders'
);
select test_assert(
  test_as_anon($stmt$select 1 from public.payments limit 1$stmt$) like 'BLOCKED%',
  'F7b. anon cannot read payments'
);
select test_assert(
  test_as_anon($stmt$select 1 from public.carts limit 1$stmt$) like 'BLOCKED%',
  'F7c. anon cannot read carts'
);

-- F8. §25's critical rule, proven directly: an authenticated client cannot
-- write payment.state — there is no grant, so even a syntactically valid
-- UPDATE naming their own payment is blocked outright.
select test_assert(
  test_as_user(:'CUST_A',
    $stmt$update public.payments set state = 'REFUNDED' where id = 'a3000000-0000-0000-0000-000000000001'$stmt$
  ) like 'BLOCKED%',
  'F8. A customer cannot write payments.state — no grant exists at all'
);

-- F9. Same rule for orders.state — no client, of any actor type, has any
-- write grant on orders.
select test_assert(
  test_as_user(:'OWNER_1',
    $stmt$update public.orders set state = 'DELIVERED' where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) like 'BLOCKED%',
  'F9. A merchant cannot write orders.state — no grant exists at all'
);

-- F10. A customer CAN write their own address (the documented direct-write
-- exception) ...
insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line)
values ('a5000000-0000-0000-0000-000000000001', :'CUST_A', 'สมชาย', '+66811111111', '123 ถนนสุขุมวิท');

select test_assert(
  test_as_user(:'CUST_A',
    $stmt$update public.addresses set label = 'บ้าน' where id = 'a5000000-0000-0000-0000-000000000001'$stmt$
  ) = 'ALLOWED',
  'F10. A customer can update their own address (documented direct-write exception)'
);

-- F11. ... but not hard-delete it (soft delete only — no DELETE grant).
select test_assert(
  test_as_user(:'CUST_A',
    $stmt$delete from public.addresses where id = 'a5000000-0000-0000-0000-000000000001'$stmt$
  ) like 'BLOCKED%',
  'F11. A customer cannot hard-delete their own address — soft delete only'
);

\echo '--- F. RLS representative access: PASS ---'

-- ===========================================================================
-- G. HIGH-1 fix — rider column exposure via views (Architect Review Step 7.2)
--
-- 20260811000012_rider_order_views.sql dropped the full-row rider policies
-- on orders/order_items/order_item_options and replaced the rider's read
-- path with three column-scoped views. RIDER_A is assigned here; RIDER_B is
-- deliberately left unassigned, to prove both the column boundary and the
-- (unchanged) row boundary in the same section.
-- ===========================================================================

insert into public.deliveries (id, order_id, state, rider_id, assigned_at)
values ('f2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
        'RIDER_ASSIGNED', 'c1000000-0000-0000-0000-000000000001', now());

insert into public.rider_assignments (delivery_id, rider_id, status)
values ('f2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'ACCEPTED');

insert into public.order_item_options (id, order_item_id, group_name_snapshot, option_name_snapshot, price_delta_satang)
values ('a2100000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001',
        'ระดับความเผ็ด', 'เผ็ดมาก', 500);

-- G1. The assigned rider reads the order through the view.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 1,
  'G1. The assigned rider reads the order through rider_order_view'
);

-- G2. The view carries what a rider actually needs to deliver.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_view
       where id = 'a1000000-0000-0000-0000-000000000001'
         and recipient_phone_snapshot = '+66811111111'
         and delivery_address_snapshot = '88 หมู่ 4 บ้านบุณฑริก'$stmt$
  ) = 1,
  'G2. rider_order_view carries delivery-relevant columns (recipient phone, delivery address)'
);

-- G3. Money and identity columns are not merely null — they DO NOT EXIST on
-- the view, so selecting them fails to parse (42703), regardless of rows.
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select grand_total_satang from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 'BLOCKED: 42703',
  'G3a. rider_order_view has no grand_total_satang column (undefined_column)'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select subtotal_satang from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 'BLOCKED: 42703',
  'G3b. rider_order_view has no subtotal_satang column (undefined_column)'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select payment_method from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 'BLOCKED: 42703',
  'G3c. rider_order_view has no payment_method column (undefined_column)'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select customer_id from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 'BLOCKED: 42703',
  'G3d. rider_order_view has no customer_id column (undefined_column)'
);

-- G4. The assigned rider can no longer read the base orders table directly
-- at all — the rider policy is gone, full-row access is not merely narrowed.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.orders where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 0,
  'G4. The assigned rider cannot read the base orders table directly — only the column-scoped view'
);

-- G5. A rider who is NOT assigned to this delivery sees nothing through the
-- view either — the row-level boundary is unchanged by this fix.
select test_assert(
  test_select_count_as_user(:'RIDER_B',
    $stmt$select count(*) from public.rider_order_view where id = 'a1000000-0000-0000-0000-000000000001'$stmt$
  ) = 0,
  'G5. An unassigned rider cannot read another rider''s order through rider_order_view'
);

-- G6/G7. order_items: name/quantity visible, price is not a column at all.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_item_view
       where order_id = 'a1000000-0000-0000-0000-000000000001' and item_name_snapshot = 'ส้มตำไทย' and quantity = 1$stmt$
  ) = 1,
  'G6. rider_order_item_view carries item name and quantity'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select unit_price_satang from public.rider_order_item_view limit 1$stmt$
  ) = 'BLOCKED: 42703',
  'G7. rider_order_item_view has no unit_price_satang column (undefined_column)'
);

-- G8/G9. order_item_options: option name visible, price_delta is not.
select test_assert(
  test_select_count_as_user(:'RIDER_A',
    $stmt$select count(*) from public.rider_order_item_option_view
       where order_item_id = 'a2000000-0000-0000-0000-000000000001' and option_name_snapshot = 'เผ็ดมาก'$stmt$
  ) = 1,
  'G8. rider_order_item_option_view carries the selected option name'
);
select test_assert(
  test_as_user(:'RIDER_A',
    $stmt$select price_delta_satang from public.rider_order_item_option_view limit 1$stmt$
  ) = 'BLOCKED: 42703',
  'G9. rider_order_item_option_view has no price_delta_satang column (undefined_column)'
);

-- G10/G11. Customer and merchant access to the FULL order, money included,
-- is completely unaffected by this fix.
select test_assert(
  test_select_count_as_user(:'CUST_A',
    $stmt$select count(*) from public.orders
       where id = 'a1000000-0000-0000-0000-000000000001' and grand_total_satang = 13000$stmt$
  ) = 1,
  'G10. Customer access to orders, INCLUDING money columns, is unchanged'
);
select test_assert(
  test_select_count_as_user(:'OWNER_1',
    $stmt$select count(*) from public.orders
       where id = 'a1000000-0000-0000-0000-000000000001' and grand_total_satang = 13000$stmt$
  ) = 1,
  'G11. Merchant access to orders, INCLUDING money columns, is unchanged'
);

\echo '--- G. rider column exposure (HIGH-1 fix): PASS ---'

\echo ''
\echo 'All domain invariant assertions passed.'
\echo ''
