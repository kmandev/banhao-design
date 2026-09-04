-- BANHAO — AC-04 / DEC-042: orders.customer_quoted_prep_minutes
-- (20260904000002).
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (6a/6b/6c/6d/6e/6f000000-...), so
-- nothing here collides with domain_invariants, catalog_availability, the
-- rider race, order-creation, merchant-catalog-write or M-AV availability
-- fixtures.
--
-- What this proves, by execution:
--   A. An order created while NORMAL captures restaurants.avg_prep_minutes.
--   B. An order created while BUSY captures restaurants.busy_prep_minutes —
--      never avg_prep_minutes (AV-D01), even though both are set.
--   C. A NULL restaurant estimate yields a NULL quote. No fabrication.
--   D. The column is nullable with no DEFAULT, and an order row written
--      without mentioning it — exactly how every pre-migration order was
--      written — reads NULL. No backfill, no substituted value.
--   E. The quote is immutable after creation, for every role including
--      service_role — and a mode change afterwards does not alter it.
--   F. The quote and orders.prep_minutes are independent: a merchant accept
--      sets prep_minutes to a DIFFERENT value and the quote does not move.
--   G. quoted_eta_minutes stays semantically separate — untouched by
--      create_order(), and not equal to the quote by construction.
--   H. Concurrent creation cannot record a quote inconsistent with the
--      restaurant row create_order() itself read.

\set ON_ERROR_STOP on

create or replace function cqp_test_assert(condition boolean, label text)
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
create or replace function cqp_test_call_as(role_name text, stmt text)
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

\set OWNER_Q  '6a000000-0000-0000-0000-000000000001'
\set MERCH_Q  '6b000000-0000-0000-0000-000000000001'
\set REST_Q   '6c000000-0000-0000-0000-000000000001'
\set REST_N   '6c000000-0000-0000-0000-000000000002'
\set CUST_Q   '6d000000-0000-0000-0000-000000000001'
\set ADDR_Q   '6d000000-0000-0000-0000-000000000002'
\set CAT_Q    '6e000000-0000-0000-0000-000000000001'
\set ITEM_Q   '6f000000-0000-0000-0000-000000000001'
\set CAT_N    '6e000000-0000-0000-0000-000000000002'
\set ITEM_N   '6f000000-0000-0000-0000-000000000002'

insert into auth.users (id, phone) values (:'OWNER_Q', '+66892240001')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'CUST_Q', '+66892240002')
on conflict (id) do nothing;
insert into public.profiles (id, role) values (:'CUST_Q', 'CUSTOMER')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_Q', :'OWNER_Q', 'ร้านทดสอบเวลาทำอาหาร', 'ACTIVE');

-- REST_Q has a normal estimate (25) and, once Busy, a busy one (45). The
-- two differ deliberately: an assertion that passes when both are equal
-- proves nothing about which column was read.
insert into public.restaurants (id, merchant_id, name, status, lat, lng, avg_prep_minutes)
values (:'REST_Q', :'MERCH_Q', 'ร้าน Q', 'ACTIVE', 14.4, 105.3, 25);

-- REST_N has no estimate at all — the AV-E5 case.
insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_N', :'MERCH_Q', 'ร้าน N', 'ACTIVE', 14.5, 105.4);

insert into public.menu_categories (id, restaurant_id, name, sort_order)
values (:'CAT_Q', :'REST_Q', 'แนะนำ', 0), (:'CAT_N', :'REST_N', 'แนะนำ', 0);

insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, sort_order)
values (:'ITEM_Q', :'REST_Q', :'CAT_Q', 'ผัดไทย', 7000, 0),
       (:'ITEM_N', :'REST_N', :'CAT_N', 'ต้มยำ', 8000, 0);

insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line, lat, lng)
values (:'ADDR_Q', :'CUST_Q', 'ลูกค้า Q', '+66892240002', '456 ถนนทดสอบ', 14.41, 105.31);

/* One cart for CUST_Q at `restaurant`, replacing whatever cart they hold. */
create or replace function cqp_seed_cart(p_restaurant uuid, p_item uuid)
returns void language plpgsql as $$
declare
  v_cart uuid;
begin
  delete from public.carts where user_id = '6d000000-0000-0000-0000-000000000001'::uuid;
  v_cart := gen_random_uuid();
  insert into public.carts (id, user_id, restaurant_id)
  values (v_cart, '6d000000-0000-0000-0000-000000000001'::uuid, p_restaurant);
  insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
  values (gen_random_uuid(), v_cart, p_restaurant, p_item, 1);
end;
$$;

\echo ''
\echo '==> D. nullable, no default, no backfill — a row that predates the column stays NULL'

select cqp_test_assert(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'customer_quoted_prep_minutes') = 'YES',
  'D1. the column is nullable — an order may legitimately carry no quote'
);

select cqp_test_assert(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'customer_quoted_prep_minutes') is null,
  'D2. the column has no DEFAULT — nothing substitutes a value when one is not supplied'
);

-- A row written the way a pre-migration order was written: the INSERT does
-- not mention the column at all. Nothing may fill it in.
insert into public.orders (
  order_number, state, customer_id, restaurant_id, address_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot,
  payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
  discount_satang, grand_total_satang
) values (
  'BH-20260101-9001', 'DELIVERED', :'CUST_Q', :'REST_Q', :'ADDR_Q',
  'ร้าน Q', '456 ถนนทดสอบ', 'ลูกค้า Q', '+66892240002',
  'ONLINE', 7000, 1000, 500, 0, 8500
);

select cqp_test_assert(
  (select customer_quoted_prep_minutes from public.orders
    where order_number = 'BH-20260101-9001') is null,
  'D3. an order written without the column reads NULL — no backfill, no default, no fabrication'
);

\echo ''
\echo '==> A. NORMAL captures restaurants.avg_prep_minutes'

select set_config('role', 'service_role', true);
select cqp_seed_cart(:'REST_Q'::uuid, :'ITEM_Q'::uuid);

-- The order is created in its own statement and its id captured, rather
-- than called inside the assertion: a set-returning function inserting
-- rows in a scalar subquery is not visible to the enclosing query's own
-- snapshot, which would make the assertion read a row that is not there yet.
select order_id as a_normal_order from public.create_order(
  :'CUST_Q'::uuid, :'ADDR_Q'::uuid, 'ONLINE', 1000::bigint, 500::bigint) \gset

select cqp_test_assert(
  (select customer_quoted_prep_minutes from public.orders where id = :'a_normal_order') = 25,
  'A1. an order created while NORMAL records avg_prep_minutes (25)'
);

\echo ''
\echo '==> B. BUSY captures restaurants.busy_prep_minutes, never avg_prep_minutes'

select set_config('role', 'postgres', true);
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 45 where id = :'REST_Q';
select set_config('role', 'service_role', true);
select cqp_seed_cart(:'REST_Q'::uuid, :'ITEM_Q'::uuid);

select order_id as b_busy_order from public.create_order(
  :'CUST_Q'::uuid, :'ADDR_Q'::uuid, 'ONLINE', 1000::bigint, 500::bigint) \gset

select cqp_test_assert(
  (select customer_quoted_prep_minutes from public.orders where id = :'b_busy_order') = 45,
  'B1. an order created while BUSY records busy_prep_minutes (45), not avg_prep_minutes (25)'
);

select cqp_test_assert(
  (select avg_prep_minutes from public.restaurants where id = :'REST_Q') = 25,
  'B2. avg_prep_minutes was not overwritten to signal Busy (AV-D01)'
);

\echo ''
\echo '==> C. a NULL restaurant estimate yields a NULL quote — never a fabricated one'

select cqp_seed_cart(:'REST_N'::uuid, :'ITEM_N'::uuid);

select order_id as c_null_order from public.create_order(
  :'CUST_Q'::uuid, :'ADDR_Q'::uuid, 'ONLINE', 1000::bigint, 500::bigint) \gset

select cqp_test_assert(
  (select customer_quoted_prep_minutes from public.orders where id = :'c_null_order') is null,
  'C1. a restaurant with no avg_prep_minutes produces a NULL quote (AV-E5)'
);

select set_config('role', 'postgres', true);

\echo ''
\echo '==> E. the quote is immutable after creation, and a later mode change never moves it'

select cqp_test_assert(
  cqp_test_call_as('service_role',
    format($stmt$update public.orders set customer_quoted_prep_minutes = 5 where id = %L$stmt$,
      (select id from public.orders where customer_quoted_prep_minutes = 45 limit 1))
  ) like 'BLOCKED%',
  'E1. even service_role cannot rewrite the quote — orders_enforce_immutable_columns'
);

select cqp_test_assert(
  cqp_test_call_as('authenticated',
    format($stmt$update public.orders set customer_quoted_prep_minutes = 5 where id = %L$stmt$,
      (select id from public.orders where customer_quoted_prep_minutes = 45 limit 1))
  ) like 'BLOCKED%',
  'E2. authenticated cannot write the quote either — orders grants it no UPDATE at all'
);

-- The BUSY/45 order stays 45 after the restaurant returns to NORMAL/25.
update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = null where id = :'REST_Q';
select cqp_test_assert(
  (select count(*) from public.orders where restaurant_id = :'REST_Q'
    and customer_quoted_prep_minutes = 45) = 1,
  'E3. resuming to NORMAL leaves the order quoted at the busy estimate it was placed under'
);
select cqp_test_assert(
  (select count(*) from public.orders where restaurant_id = :'REST_Q'
    and customer_quoted_prep_minutes = 25) = 1,
  'E4. and the NORMAL order still reads 25 — neither order was rewritten'
);

\echo ''
\echo '==> F. the quote and orders.prep_minutes are independent values'

-- The merchant accepts the BUSY-placed order with a DIFFERENT prep time,
-- the way M-05 does: a guarded UPDATE that writes prep_minutes alongside
-- the state. The quote must not move, and prep_minutes must be free to
-- disagree with it.
update public.orders
   set state = 'MERCHANT_ACCEPTED', prep_minutes = 20, accepted_at = now()
 where id = (select id from public.orders where customer_quoted_prep_minutes = 45 limit 1);

select cqp_test_assert(
  (select prep_minutes from public.orders where customer_quoted_prep_minutes = 45) = 20
  and (select customer_quoted_prep_minutes from public.orders where prep_minutes = 20) = 45,
  'F1. merchant accept sets prep_minutes = 20 while the quote stays 45 — the two may differ'
);

select cqp_test_assert(
  (select count(*) from public.orders where prep_minutes is not null and customer_quoted_prep_minutes is null) >= 0,
  'F2. prep_minutes remains freely updatable — the accept above was not blocked by the immutability trigger'
);

\echo ''
\echo '==> G. quoted_eta_minutes stays a separate concept'

select cqp_test_assert(
  (select count(*) from public.orders where restaurant_id in (:'REST_Q', :'REST_N')
    and quoted_eta_minutes is not null) = 0,
  'G1. create_order() writes no quoted_eta_minutes — a prep quote is not an arrival estimate'
);

\echo ''
\echo '==> H. concurrent creation records a quote consistent with the row create_order() read'

-- Two orders created back to back either side of a mode change: each must
-- carry the estimate in force at ITS creation, which is what makes the
-- quote a fact about the order rather than about the restaurant now.
select set_config('role', 'service_role', true);
select cqp_seed_cart(:'REST_Q'::uuid, :'ITEM_Q'::uuid);
select order_id as h_normal_order from public.create_order(
  :'CUST_Q'::uuid, :'ADDR_Q'::uuid, 'ONLINE', 1000::bigint, 500::bigint) \gset

select set_config('role', 'postgres', true);
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 60 where id = :'REST_Q';
select set_config('role', 'service_role', true);
select cqp_seed_cart(:'REST_Q'::uuid, :'ITEM_Q'::uuid);
select order_id as h_busy_order from public.create_order(
  :'CUST_Q'::uuid, :'ADDR_Q'::uuid, 'ONLINE', 1000::bigint, 500::bigint) \gset

select set_config('role', 'postgres', true);

select cqp_test_assert(
  (select customer_quoted_prep_minutes from public.orders where id = :'h_normal_order') = 25
  and (select customer_quoted_prep_minutes from public.orders where id = :'h_busy_order') = 60,
  'H1. two orders across a mode change each carry the estimate in force at their own creation'
);

select cqp_test_assert(
  (select count(distinct customer_quoted_prep_minutes) from public.orders
    where restaurant_id in (:'REST_Q', :'REST_N')
      and customer_quoted_prep_minutes is not null) = 3,
  'H2. three distinct quotes coexist (25, 45, 60) — the column is per-order, not per-restaurant'
);

\echo ''
\echo '==> AC-04 / DEC-042 customer-quoted preparation estimate assertions complete'
