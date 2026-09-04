-- BANHAO — M-13: restaurant availability mode (20260904000001).
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (5a/5b/5c/5d000000-...), so nothing
-- here collides with domain_invariants, catalog_availability, the rider
-- race, order-creation, or merchant-catalog-write fixtures.
--
-- What this proves, by execution:
--   A. availability_mode defaults to NORMAL, with no backfill needed.
--   B. The value CHECK: NORMAL/BUSY/PAUSED accepted, anything else rejected.
--   C. The pairing CHECK: BUSY requires one of 10/20/30/45/60;
--      NORMAL/PAUSED require NULL. Every combination the migration's own
--      comment names as valid or invalid is proven here.
--   D. Neither column can move restaurants.status — the CHECK constraint on
--      status is untouched and a mode change is a separate column entirely.
--   E. create_order(): NORMAL and BUSY both allow order creation; PAUSED
--      refuses it through the same authority that already refuses a
--      non-ACTIVE restaurant. A later mode change never mutates an order
--      already created.
--   F. No direct client write: anon/authenticated cannot UPDATE
--      restaurants.availability_mode — the table grant is SELECT-only,
--      unchanged by this migration; every write stays behind the API's
--      service-role client.

\set ON_ERROR_STOP on

create or replace function avail_test_assert(condition boolean, label text)
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
create or replace function avail_test_call_as(role_name text, stmt text)
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

\set OWNER_M   '5a000000-0000-0000-0000-000000000001'
\set MERCH_M   '5b000000-0000-0000-0000-000000000001'
\set REST_A    '5c000000-0000-0000-0000-000000000001'
\set CUST_A    '5d000000-0000-0000-0000-000000000001'
\set ADDR_A    '5d000000-0000-0000-0000-000000000002'
\set CAT_A     '5e000000-0000-0000-0000-000000000001'
\set ITEM_A    '5f000000-0000-0000-0000-000000000001'

insert into auth.users (id, phone) values (:'OWNER_M', '+66892230001')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'CUST_A', '+66892230002')
on conflict (id) do nothing;
insert into public.profiles (id, role) values (:'CUST_A', 'CUSTOMER')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_M', :'OWNER_M', 'ร้านทดสอบสถานะ', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_A', :'MERCH_M', 'ร้าน A', 'ACTIVE', 14.3, 105.2);

insert into public.menu_categories (id, restaurant_id, name, sort_order)
values (:'CAT_A', :'REST_A', 'แนะนำ', 0);

insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, sort_order)
values (:'ITEM_A', :'REST_A', :'CAT_A', 'ข้าวผัดกุ้ง', 6500, 0);

insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line, lat, lng)
values (:'ADDR_A', :'CUST_A', 'ลูกค้า A', '+66892230002', '123 ถนนทดสอบ', 14.31, 105.21);

\echo ''
\echo '==> A. availability_mode defaults to NORMAL'

select avail_test_assert(
  (select availability_mode from public.restaurants where id = :'REST_A') = 'NORMAL',
  'A1. a newly-inserted restaurant defaults to NORMAL with no backfill statement'
);
select avail_test_assert(
  (select busy_prep_minutes from public.restaurants where id = :'REST_A') is null,
  'A2. busy_prep_minutes defaults to NULL'
);

\echo ''
\echo '==> B. availability_mode value CHECK'

select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'BOGUS' where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'B1. an availability_mode outside NORMAL/BUSY/PAUSED is rejected by the CHECK'
);

\echo ''
\echo '==> C. the BUSY <-> busy_prep_minutes pairing CHECK'

select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 20 where id = %L$stmt$, :'REST_A')
  ) = 'ALLOWED',
  'C1. BUSY + 20 is valid'
);
update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = null where id = :'REST_A';

select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = null where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'C2. BUSY + NULL is rejected (busy minutes are required while Busy)'
);
select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 25 where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'C3. BUSY + 25 is rejected — only 10/20/30/45/60 are valid'
);
select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = 20 where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'C4. NORMAL + a non-null busy_prep_minutes is rejected'
);
select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'PAUSED', busy_prep_minutes = null where id = %L$stmt$, :'REST_A')
  ) = 'ALLOWED',
  'C5. PAUSED + NULL is valid — indefinite, no sentinel, no timer'
);
select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'PAUSED', busy_prep_minutes = 10 where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'C6. PAUSED + a non-null busy_prep_minutes is rejected'
);
update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = null where id = :'REST_A';

update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 10 where id = :'REST_A';
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 20 where id = :'REST_A';
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 30 where id = :'REST_A';
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 45 where id = :'REST_A';
update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 60 where id = :'REST_A';
update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = null where id = :'REST_A';
select avail_test_assert(true, 'C7. every one of 10/20/30/45/60 is accepted as busy_prep_minutes');

\echo ''
\echo '==> D. availability_mode never touches restaurants.status'

select avail_test_assert(
  avail_test_call_as('postgres',
    format($stmt$update public.restaurants set availability_mode = 'PAUSED' where id = %L$stmt$, :'REST_A')
  ) = 'ALLOWED',
  'D1. setting PAUSED succeeds'
);
select avail_test_assert(
  (select status from public.restaurants where id = :'REST_A') = 'ACTIVE',
  'D2. status is still ACTIVE after PAUSED is set — mode and lifecycle status are independent columns'
);
select avail_test_assert(
  (select temporarily_closed_until from public.restaurants where id = :'REST_A') is null,
  'D3. temporarily_closed_until was never written by the PAUSED mode change'
);
update public.restaurants set availability_mode = 'NORMAL' where id = :'REST_A';

\echo ''
\echo '==> E. create_order() respects availability_mode'

-- One open cart, reused across the three creation attempts below — each
-- attempt either consumes it (order created) or leaves it in place
-- (rejected), and the cart is re-seeded between attempts.
insert into public.carts (id, user_id, restaurant_id)
values ('5d900000-0000-0000-0000-000000000001', :'CUST_A', :'REST_A');
insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
values ('5d900000-0000-0000-0000-000000000002', '5d900000-0000-0000-0000-000000000001', :'REST_A', :'ITEM_A', 1);

select set_config('role', 'service_role', true);

select avail_test_assert(
  (select order_id from public.create_order(:'CUST_A'::uuid, :'ADDR_A'::uuid, 'ONLINE', 1000::bigint, 500::bigint)) is not null,
  'E1. NORMAL allows order creation'
);

update public.restaurants set availability_mode = 'BUSY', busy_prep_minutes = 30 where id = :'REST_A';
insert into public.carts (id, user_id, restaurant_id)
values ('5d900000-0000-0000-0000-000000000003', :'CUST_A', :'REST_A')
on conflict (user_id) do update set restaurant_id = excluded.restaurant_id;
insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
select gen_random_uuid(), c.id, :'REST_A', :'ITEM_A', 1
  from public.carts c where c.user_id = :'CUST_A';

select avail_test_assert(
  (select order_id from public.create_order(:'CUST_A'::uuid, :'ADDR_A'::uuid, 'ONLINE', 1000::bigint, 500::bigint)) is not null,
  'E2. BUSY still allows order creation — a busy restaurant is fully open'
);

update public.restaurants set availability_mode = 'PAUSED', busy_prep_minutes = null where id = :'REST_A';
insert into public.carts (id, user_id, restaurant_id)
values ('5d900000-0000-0000-0000-000000000004', :'CUST_A', :'REST_A')
on conflict (user_id) do update set restaurant_id = excluded.restaurant_id;
insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
select gen_random_uuid(), c.id, :'REST_A', :'ITEM_A', 1
  from public.carts c where c.user_id = :'CUST_A';

select avail_test_assert(
  avail_test_call_as('service_role',
    format(
      $stmt$select public.create_order(%L::uuid, %L::uuid, 'ONLINE', 1000::bigint, 500::bigint)$stmt$,
      :'CUST_A', :'ADDR_A'
    )
  ) like 'BLOCKED%',
  'E3. PAUSED refuses new order creation'
);

select avail_test_assert(
  (select count(*) from public.orders where restaurant_id = :'REST_A') = 2,
  'E4. exactly the two orders from E1/E2 exist — the PAUSED attempt created nothing'
);

-- E5. a mode change after order creation never mutates the existing order.
select avail_test_assert(
  (select state from public.orders where restaurant_id = :'REST_A' order by placed_at limit 1) = 'CREATED',
  'E5a. the order created while NORMAL is untouched by the later BUSY/PAUSED changes'
);
update public.restaurants set availability_mode = 'NORMAL', busy_prep_minutes = null where id = :'REST_A';
select avail_test_assert(
  (select count(*) from public.orders where restaurant_id = :'REST_A') = 2,
  'E5b. resuming to NORMAL created no new order and removed none'
);

select set_config('role', 'postgres', true);

\echo ''
\echo '==> F. no direct client write — restaurants stays SELECT-only for authenticated/anon'

select avail_test_assert(
  avail_test_call_as('anon',
    format($stmt$update public.restaurants set availability_mode = 'PAUSED' where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'F1. anon cannot write availability_mode directly'
);
select avail_test_assert(
  avail_test_call_as('authenticated',
    format($stmt$update public.restaurants set availability_mode = 'PAUSED' where id = %L$stmt$, :'REST_A')
  ) like 'BLOCKED%',
  'F2. authenticated cannot write availability_mode directly — every write stays behind the API''s service-role client'
);

\echo ''
\echo '==> M-13 restaurant availability assertions complete'
