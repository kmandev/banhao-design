-- BANHAO — M-11 / M-12: the four transactional merchant catalog write
-- functions added by 20260901000002_merchant_catalog_write_functions.sql.
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (2a/2b/2c/2d/2e/2f000000-...), so
-- nothing here collides with domain_invariants, catalog_availability, the
-- rider race, or the order-creation fixtures.
--
-- What this proves, by execution:
--   A. The EXECUTE grant — anon and authenticated cannot call any of the four.
--   B. replace_restaurant_hours: replacement, the empty week, split shifts,
--      day_of_week 0 = Sunday, and that a CHECK violation rolls the whole
--      week back rather than leaving a restaurant with no hours.
--   C. reorder_menu_categories / reorder_menu_items: renumbering, tenant
--      isolation, and rejection of partial or duplicated orders.
--   D. replace_menu_item_option_groups: replacement at both levels, ordering,
--      the empty case, and that order history is untouched by it — including
--      the case that broke live (a dish whose options are referenced by a real
--      order line), the survival of the provenance id after the catalogue row
--      it pointed at is gone, and proof that dropping that FK in
--      20260902000001 left the append-only trigger fully strict.

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

/* Runs `stmt` as `role`, returning 'ALLOWED' or 'BLOCKED: <sqlstate>'. */
create or replace function test_call_as(role_name text, stmt text)
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

\set OWNER_M  '2a000000-0000-0000-0000-000000000001'
\set MERCH_M  '2b000000-0000-0000-0000-000000000001'
\set REST_A   '2c000000-0000-0000-0000-000000000001'
\set REST_B   '2c000000-0000-0000-0000-000000000002'
\set CAT_A1   '2d000000-0000-0000-0000-000000000001'
\set CAT_A2   '2d000000-0000-0000-0000-000000000002'
\set CAT_A3   '2d000000-0000-0000-0000-000000000003'
\set CAT_B1   '2d000000-0000-0000-0000-000000000009'
\set ITEM_1   '2e000000-0000-0000-0000-000000000001'
\set ITEM_2   '2e000000-0000-0000-0000-000000000002'
\set ITEM_3   '2e000000-0000-0000-0000-000000000003'

insert into auth.users (id, phone) values (:'OWNER_M', '+66892220001')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_M', :'OWNER_M', 'ร้านทดสอบเมนู', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng) values
  (:'REST_A', :'MERCH_M', 'ร้าน A', 'ACTIVE', 14.3, 105.2),
  (:'REST_B', :'MERCH_M', 'ร้าน B', 'ACTIVE', 14.4, 105.3);

insert into public.menu_categories (id, restaurant_id, name, sort_order) values
  (:'CAT_A1', :'REST_A', 'แนะนำ', 0),
  (:'CAT_A2', :'REST_A', 'อาหารจานเดียว', 1),
  (:'CAT_A3', :'REST_A', 'เครื่องดื่ม', 2),
  (:'CAT_B1', :'REST_B', 'ของร้านอื่น', 0);

insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, sort_order) values
  (:'ITEM_1', :'REST_A', :'CAT_A1', 'ข้าวผัดกุ้ง', 6500, 0),
  (:'ITEM_2', :'REST_A', :'CAT_A1', 'ผัดกะเพราหมูสับ', 6000, 1),
  (:'ITEM_3', :'REST_A', :'CAT_A1', 'ยำวุ้นเส้น', 7000, 2);

\echo ''
\echo '==> A. EXECUTE grant — the four functions are service_role only'

select test_assert(
  test_call_as('anon',
    $stmt$select public.replace_restaurant_hours('2c000000-0000-0000-0000-000000000001'::uuid, '[]'::jsonb)$stmt$
  ) like 'BLOCKED%',
  'A1. anon cannot execute replace_restaurant_hours'
);
select test_assert(
  test_call_as('authenticated',
    $stmt$select public.replace_restaurant_hours('2c000000-0000-0000-0000-000000000001'::uuid, '[]'::jsonb)$stmt$
  ) like 'BLOCKED%',
  'A2. authenticated cannot execute replace_restaurant_hours — DEC-APP-008 keeps writes in the API'
);
select test_assert(
  test_call_as('authenticated',
    $stmt$select public.reorder_menu_categories('2c000000-0000-0000-0000-000000000001'::uuid, array[]::uuid[])$stmt$
  ) like 'BLOCKED%',
  'A3. authenticated cannot execute reorder_menu_categories'
);
select test_assert(
  test_call_as('authenticated',
    $stmt$select public.reorder_menu_items('2c000000-0000-0000-0000-000000000001'::uuid, '2d000000-0000-0000-0000-000000000001'::uuid, array[]::uuid[])$stmt$
  ) like 'BLOCKED%',
  'A4. authenticated cannot execute reorder_menu_items'
);
select test_assert(
  test_call_as('authenticated',
    $stmt$select public.replace_menu_item_option_groups('2e000000-0000-0000-0000-000000000001'::uuid, '[]'::jsonb)$stmt$
  ) like 'BLOCKED%',
  'A5. authenticated cannot execute replace_menu_item_option_groups'
);

-- The client's own privileges are unchanged by this migration: still select
-- only, still no insert/update on any catalog table.
select test_assert(
  test_call_as('authenticated',
    $stmt$update public.menu_items set is_available = false where id = '2e000000-0000-0000-0000-000000000001'$stmt$
  ) like 'BLOCKED%',
  'A6. authenticated still cannot write menu_items directly — no grant was added'
);
select test_assert(
  test_call_as('authenticated',
    $stmt$insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
       values ('2c000000-0000-0000-0000-000000000001', 1, '08:00', '20:00')$stmt$
  ) like 'BLOCKED%',
  'A7. authenticated still cannot write restaurant_hours directly — no grant was added'
);

\echo '--- A. EXECUTE grant: PASS ---'

\echo ''
\echo '==> B. replace_restaurant_hours (M-12)'

-- B1. A full week, including a split-shift Saturday and a closed Sunday.
select public.replace_restaurant_hours(:'REST_A', $json$[
  { "dayOfWeek": 1, "opensAt": "08:00", "closesAt": "20:00" },
  { "dayOfWeek": 2, "opensAt": "08:00", "closesAt": "20:00" },
  { "dayOfWeek": 3, "opensAt": "08:00", "closesAt": "20:00" },
  { "dayOfWeek": 4, "opensAt": "08:00", "closesAt": "20:00" },
  { "dayOfWeek": 5, "opensAt": "08:00", "closesAt": "21:00" },
  { "dayOfWeek": 6, "opensAt": "07:00", "closesAt": "13:00" },
  { "dayOfWeek": 6, "opensAt": "16:00", "closesAt": "20:00" }
]$json$::jsonb);

select test_assert(
  (select count(*) from public.restaurant_hours where restaurant_id = :'REST_A') = 7,
  'B1. A seven-row week (six days, Saturday split) is stored'
);

-- B2. Sunday is 0, and a closed day is the ABSENCE of rows. Nothing was
-- written for day 0, so the shop is closed on Sunday.
select test_assert(
  (select count(*) from public.restaurant_hours
    where restaurant_id = :'REST_A' and day_of_week = 0) = 0,
  'B2. A closed day is stored as no rows — day_of_week 0 (Sunday) is absent'
);

-- B3. Split shift: two rows on one day, both retained, ordered by opens_at.
select test_assert(
  (select count(*) from public.restaurant_hours
    where restaurant_id = :'REST_A' and day_of_week = 6) = 2,
  'B3. Saturday keeps both intervals — multiple rows per day are preserved'
);
select test_assert(
  (select array_agg(opens_at order by opens_at)
     from public.restaurant_hours
    where restaurant_id = :'REST_A' and day_of_week = 6)
  = array['07:00'::time, '16:00'::time],
  'B3b. ... and both intervals hold the times they were given'
);

-- B4. day_of_week 0 = Sunday, 6 = Saturday. Written as an explicit round trip
-- so a future off-by-one shift of the whole week fails here rather than
-- silently opening every shop on the wrong day.
select public.replace_restaurant_hours(:'REST_A', $json$[
  { "dayOfWeek": 0, "opensAt": "09:00", "closesAt": "12:00" },
  { "dayOfWeek": 6, "opensAt": "18:00", "closesAt": "23:00" }
]$json$::jsonb);

select test_assert(
  (select opens_at from public.restaurant_hours
    where restaurant_id = :'REST_A' and day_of_week = 0) = '09:00'::time,
  'B4. day_of_week 0 round-trips as itself — 0 = Sunday, matching every existing reader'
);
select test_assert(
  (select opens_at from public.restaurant_hours
    where restaurant_id = :'REST_A' and day_of_week = 6) = '18:00'::time,
  'B4b. day_of_week 6 round-trips as itself — 6 = Saturday'
);

-- B5. Replacement, not merge: the previous week is gone.
select test_assert(
  (select count(*) from public.restaurant_hours where restaurant_id = :'REST_A') = 2,
  'B5. The write replaces the whole week rather than merging into it'
);

-- B6. The empty array is legal and means "no hours at all".
select public.replace_restaurant_hours(:'REST_A', '[]'::jsonb);
select test_assert(
  (select count(*) from public.restaurant_hours where restaurant_id = :'REST_A') = 0,
  'B6. An empty array clears the week — zero rows is a real, storable state'
);

-- B7. Atomicity, the reason this function exists. A week containing one
-- invalid interval must leave the STORED week untouched, never zero rows.
select public.replace_restaurant_hours(:'REST_A', $json$[
  { "dayOfWeek": 1, "opensAt": "08:00", "closesAt": "20:00" }
]$json$::jsonb);

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.replace_restaurant_hours('2c000000-0000-0000-0000-000000000001'::uuid, $json$[
      { "dayOfWeek": 2, "opensAt": "08:00", "closesAt": "20:00" },
      { "dayOfWeek": 3, "opensAt": "20:00", "closesAt": "08:00" }
    ]$json$::jsonb);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := sqlstate;
  end;

  perform test_assert(sqlstate_caught = '23514',
    format('B7. An interval closing before it opens trips restaurant_hours_span_check (got %s)', sqlstate_caught));
end;
$$;

select test_assert(
  (select count(*) from public.restaurant_hours where restaurant_id = :'REST_A') = 1
  and (select day_of_week from public.restaurant_hours where restaurant_id = :'REST_A') = 1,
  'B7b. ... and the previously stored week survived intact — the delete rolled back with the insert'
);

-- B8. Overnight spans are rejected by the same CHECK. DBQ-006 is OPEN; the
-- design names the limitation rather than working around it.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.replace_restaurant_hours('2c000000-0000-0000-0000-000000000001'::uuid, $json$[
      { "dayOfWeek": 5, "opensAt": "18:00", "closesAt": "02:00" }
    ]$json$::jsonb);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := sqlstate;
  end;

  perform test_assert(sqlstate_caught = '23514',
    format('B8. An overnight span 18:00-02:00 is rejected — DBQ-006 stays OPEN (got %s)', sqlstate_caught));
end;
$$;

-- B9. day_of_week outside 0..6 is refused by the table's own CHECK.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.replace_restaurant_hours('2c000000-0000-0000-0000-000000000001'::uuid, $json$[
      { "dayOfWeek": 7, "opensAt": "08:00", "closesAt": "20:00" }
    ]$json$::jsonb);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := sqlstate;
  end;

  perform test_assert(sqlstate_caught = '23514',
    format('B9. day_of_week 7 is rejected by the table CHECK (got %s)', sqlstate_caught));
end;
$$;

-- B10. One restaurant's week is not another's.
select public.replace_restaurant_hours(:'REST_B', $json$[
  { "dayOfWeek": 0, "opensAt": "10:00", "closesAt": "18:00" }
]$json$::jsonb);
select test_assert(
  (select count(*) from public.restaurant_hours where restaurant_id = :'REST_A') = 1
  and (select count(*) from public.restaurant_hours where restaurant_id = :'REST_B') = 1,
  'B10. Replacing one restaurant''s week leaves another restaurant''s untouched'
);

\echo '--- B. replace_restaurant_hours: PASS ---'

\echo ''
\echo '==> C. reorder_menu_categories / reorder_menu_items (M-11 §07)'

-- C1. Position in the array becomes sort_order, densely from 0.
select public.reorder_menu_categories(:'REST_A', array[:'CAT_A3', :'CAT_A1', :'CAT_A2']::uuid[]);

select test_assert(
  (select sort_order from public.menu_categories where id = :'CAT_A3') = 0
  and (select sort_order from public.menu_categories where id = :'CAT_A1') = 1
  and (select sort_order from public.menu_categories where id = :'CAT_A2') = 2,
  'C1. Array position becomes sort_order, renumbered densely from 0'
);

-- C2. A partial list is refused. Renumbering half a menu has no well-defined
-- result, and applying it anyway is how a menu ends up visibly scrambled.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.reorder_menu_categories('2c000000-0000-0000-0000-000000000001'::uuid,
      array['2d000000-0000-0000-0000-000000000001']::uuid[]);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := 'RAISED';
  end;
  perform test_assert(sqlstate_caught = 'RAISED',
    'C2. A partial category order is rejected — the list must name every active category');
end;
$$;

-- C3. A duplicated id is refused.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.reorder_menu_categories('2c000000-0000-0000-0000-000000000001'::uuid,
      array['2d000000-0000-0000-0000-000000000001',
            '2d000000-0000-0000-0000-000000000001',
            '2d000000-0000-0000-0000-000000000002']::uuid[]);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := 'RAISED';
  end;
  perform test_assert(sqlstate_caught = 'RAISED',
    'C3. A duplicated category id is rejected');
end;
$$;

-- C4. Tenant isolation: another restaurant's category cannot be smuggled in.
do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.reorder_menu_categories('2c000000-0000-0000-0000-000000000001'::uuid,
      array['2d000000-0000-0000-0000-000000000001',
            '2d000000-0000-0000-0000-000000000002',
            '2d000000-0000-0000-0000-000000000009']::uuid[]);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := 'RAISED';
  end;
  perform test_assert(sqlstate_caught = 'RAISED',
    'C4. A category belonging to another restaurant is rejected');
end;
$$;

select test_assert(
  (select sort_order from public.menu_categories where id = :'CAT_B1') = 0,
  'C4b. ... and that other restaurant''s category was not renumbered'
);

-- C5. Items reorder within their category.
select public.reorder_menu_items(:'REST_A', :'CAT_A1', array[:'ITEM_3', :'ITEM_1', :'ITEM_2']::uuid[]);

select test_assert(
  (select sort_order from public.menu_items where id = :'ITEM_3') = 0
  and (select sort_order from public.menu_items where id = :'ITEM_1') = 1
  and (select sort_order from public.menu_items where id = :'ITEM_2') = 2,
  'C5. Item order is renumbered densely from 0 within its category'
);

-- C6. An archived item leaves the ordering set, so a reorder that still names
-- it is rejected and a reorder of the remaining items succeeds.
update public.menu_items set archived_at = now() where id = :'ITEM_2';

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.reorder_menu_items('2c000000-0000-0000-0000-000000000001'::uuid,
      '2d000000-0000-0000-0000-000000000001'::uuid,
      array['2e000000-0000-0000-0000-000000000003',
            '2e000000-0000-0000-0000-000000000001',
            '2e000000-0000-0000-0000-000000000002']::uuid[]);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := 'RAISED';
  end;
  perform test_assert(sqlstate_caught = 'RAISED',
    'C6. An archived item may not appear in a reorder');
end;
$$;

select public.reorder_menu_items(:'REST_A', :'CAT_A1', array[:'ITEM_1', :'ITEM_3']::uuid[]);
select test_assert(
  (select sort_order from public.menu_items where id = :'ITEM_1') = 0
  and (select sort_order from public.menu_items where id = :'ITEM_3') = 1,
  'C6b. ... and the remaining active items reorder normally'
);

update public.menu_items set archived_at = null where id = :'ITEM_2';

\echo '--- C. reorder functions: PASS ---'

\echo ''
\echo '==> D. replace_menu_item_option_groups (M-11 §06)'

select public.replace_menu_item_option_groups(:'ITEM_1', $json$[
  { "title": "ระดับความเผ็ด", "minSelect": 1, "maxSelect": 1,
    "options": [
      { "label": "ไม่เผ็ด", "priceDeltaSatang": 0, "isAvailable": true },
      { "label": "เผ็ดกลาง", "priceDeltaSatang": 0, "isAvailable": true },
      { "label": "เผ็ดมาก", "priceDeltaSatang": 0, "isAvailable": true }
    ] },
  { "title": "เพิ่มเติม", "minSelect": 0, "maxSelect": 3,
    "options": [
      { "label": "ไข่ดาว", "priceDeltaSatang": 1000, "isAvailable": true },
      { "label": "กุ้งเพิ่ม", "priceDeltaSatang": 3000, "isAvailable": false }
    ] }
]$json$::jsonb);

select test_assert(
  (select count(*) from public.menu_option_groups where menu_item_id = :'ITEM_1') = 2,
  'D1. Two option groups are created'
);

select test_assert(
  (select array_agg(title order by sort_order)
     from public.menu_option_groups where menu_item_id = :'ITEM_1')
  = array['ระดับความเผ็ด', 'เพิ่มเติม'],
  'D2. Array position becomes the group sort_order'
);

select test_assert(
  (select min_select from public.menu_option_groups
    where menu_item_id = :'ITEM_1' and title = 'ระดับความเผ็ด') = 1
  and (select max_select from public.menu_option_groups
    where menu_item_id = :'ITEM_1' and title = 'ระดับความเผ็ด') = 1,
  'D3. The เลือก 1 อย่าง · จำเป็น preset stores min 1 / max 1'
);

select test_assert(
  (select array_agg(o.label order by o.sort_order)
     from public.menu_options o
     join public.menu_option_groups g on g.id = o.group_id
    where g.menu_item_id = :'ITEM_1' and g.title = 'เพิ่มเติม')
  = array['ไข่ดาว', 'กุ้งเพิ่ม'],
  'D4. Options keep their array order within a group'
);

select test_assert(
  (select price_delta_satang from public.menu_options o
     join public.menu_option_groups g on g.id = o.group_id
    where g.menu_item_id = :'ITEM_1' and o.label = 'ไข่ดาว') = 1000
  and (select is_available from public.menu_options o
     join public.menu_option_groups g on g.id = o.group_id
    where g.menu_item_id = :'ITEM_1' and o.label = 'กุ้งเพิ่ม') = false,
  'D5. Price delta and per-option availability round-trip'
);

-- D6. Replacement, at both levels.
select public.replace_menu_item_option_groups(:'ITEM_1', $json$[
  { "title": "ขนาด", "minSelect": 1, "maxSelect": 1,
    "options": [ { "label": "ธรรมดา", "priceDeltaSatang": 0, "isAvailable": true } ] }
]$json$::jsonb);

select test_assert(
  (select count(*) from public.menu_option_groups where menu_item_id = :'ITEM_1') = 1
  and (select count(*) from public.menu_options o
         join public.menu_option_groups g on g.id = o.group_id
        where g.menu_item_id = :'ITEM_1') = 1,
  'D6. The write replaces every group and option rather than merging'
);

-- D7. The empty array removes every group — a legitimate edit.
select public.replace_menu_item_option_groups(:'ITEM_1', '[]'::jsonb);
select test_assert(
  (select count(*) from public.menu_option_groups where menu_item_id = :'ITEM_1') = 0,
  'D7. An empty array removes every option group'
);

-- D8. max_select < min_select trips the table's own CHECK, and the previous
-- groups survive.
select public.replace_menu_item_option_groups(:'ITEM_1', $json$[
  { "title": "ขนาด", "minSelect": 1, "maxSelect": 1,
    "options": [ { "label": "ธรรมดา", "priceDeltaSatang": 0, "isAvailable": true } ] }
]$json$::jsonb);

do $$
declare
  sqlstate_caught text;
begin
  begin
    perform public.replace_menu_item_option_groups('2e000000-0000-0000-0000-000000000001'::uuid, $json$[
      { "title": "ผิด", "minSelect": 3, "maxSelect": 1, "options": [] }
    ]$json$::jsonb);
    sqlstate_caught := 'NO ERROR RAISED';
  exception when others then
    sqlstate_caught := sqlstate;
  end;
  perform test_assert(sqlstate_caught = '23514',
    format('D8. max_select below min_select trips menu_option_groups_select_range_check (got %s)', sqlstate_caught));
end;
$$;

select test_assert(
  (select count(*) from public.menu_option_groups where menu_item_id = :'ITEM_1') = 1,
  'D8b. ... and the previously stored groups survived — the delete rolled back with the insert'
);

-- D9. Order history is untouched by an option rewrite. This is the reason
-- recreating rows is safe at all: order_item_options snapshots names as text.
--
-- IMPORTANT — why this fixture sets `menu_option_id` explicitly.
--
-- Until 20260902000001 this block inserted the historical row WITHOUT
-- `menu_option_id`, leaving it NULL. That made the whole assertion vacuous:
-- with no live option referenced, the FK
-- `order_item_options_menu_option_id_fkey` (ON DELETE SET NULL) had nothing
-- to null, so it never fired, so `order_item_options_reject_mutation` never
-- saw an UPDATE, so the rewrite below trivially succeeded. Meanwhile
-- `create_order()` (20260819000001) populates that column on EVERY real
-- order line — so the one shape this test existed to cover was the one shape
-- it could not reach, and the failure escaped to live `banhao-dev`, where
-- `replace_menu_item_option_groups` raised 42501 for any dish that had ever
-- been ordered.
--
-- The fixture now points at a REAL `menu_options` row, exactly as a real
-- order does. Before 20260902000001 dropped the FK, D9 fails here.
insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line)
values ('2f000000-0000-0000-0000-00000000000a', :'OWNER_M', 'ผู้รับ', '+66892220001', '1 หมู่ 1');

insert into public.orders (
  id, order_number, customer_id, restaurant_id, restaurant_name_snapshot,
  delivery_address_snapshot, recipient_name_snapshot, recipient_phone_snapshot,
  state, payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
  discount_satang, grand_total_satang
) values (
  '2f000000-0000-0000-0000-000000000001', 'BH-20260901-9001', :'OWNER_M', :'REST_A', 'ร้าน A',
  '1 หมู่ 1', 'ผู้รับ', '+66892220001',
  'DELIVERED', 'ONLINE', 6500, 1000, 500, 0, 8000
);

insert into public.order_items (
  id, order_id, restaurant_id, menu_item_id, item_name_snapshot,
  unit_price_satang, quantity, line_total_satang
) values (
  '2f000000-0000-0000-0000-000000000002', '2f000000-0000-0000-0000-000000000001',
  :'REST_A', :'ITEM_1', 'ข้าวผัดกุ้ง', 6500, 1, 6500
);

-- The live option this historical line was ordered from. D8b established
-- that ITEM_1 currently holds exactly one group; take its option.
select o.id as hist_option_id
  from public.menu_options o
  join public.menu_option_groups g on g.id = o.group_id
 where g.menu_item_id = :'ITEM_1'
 order by g.sort_order, o.sort_order
 limit 1
\gset

select test_assert(
  :'hist_option_id' is not null,
  'D9a. Fixture precondition: a live menu_options row exists to reference'
);

insert into public.order_item_options (
  id, order_item_id, menu_option_id, group_name_snapshot, option_name_snapshot, price_delta_satang
) values (
  '2f000000-0000-0000-0000-000000000003', '2f000000-0000-0000-0000-000000000002',
  :'hist_option_id', 'ระดับความเผ็ด', 'เผ็ดมาก', 0
);

select test_assert(
  (select menu_option_id from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = :'hist_option_id'::uuid,
  'D9b. The historical line references a real, live menu_options row — the shape create_order() always writes'
);

-- The regression itself: this call deletes the referenced option. Before
-- 20260902000001 the FK turned that into an UPDATE on an append-only row and
-- the whole transaction aborted with 42501.
select public.replace_menu_item_option_groups(:'ITEM_1', '[]'::jsonb);

select test_assert(
  (select count(*) from public.menu_option_groups where menu_item_id = :'ITEM_1') = 0,
  'D9c. Replacing the options of a dish that HAS order history now succeeds (the live M-11 blocker)'
);

select test_assert(
  not exists (select 1 from public.menu_options where id = :'hist_option_id'::uuid),
  'D9d. The referenced catalogue option really was deleted — the FK path was genuinely exercised'
);

-- Test B — historical snapshot preservation.
select test_assert(
  (select group_name_snapshot from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = 'ระดับความเผ็ด'
  and (select option_name_snapshot from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = 'เผ็ดมาก'
  and (select price_delta_satang from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = 0,
  'D9. Rewriting a dish''s options leaves a historical order''s snapshots untouched'
);

-- Test C — provenance preservation. The point of dropping the FK rather than
-- letting it SET NULL: the id survives the catalogue row it pointed at.
select test_assert(
  (select menu_option_id from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = :'hist_option_id'::uuid,
  'D10. Provenance survives: menu_option_id still holds its original value after the catalogue option was deleted'
);

-- Test D — the append-only guarantee is NOT what was relaxed. Every mutation
-- of order_item_options is still refused, for every role, including
-- service_role (which is `bypassrls` — so this proves the TRIGGER refuses it,
-- not RLS).
select test_assert(
  test_call_as('service_role',
    $stmt$update public.order_item_options set price_delta_satang = 999
       where id = '2f000000-0000-0000-0000-000000000003'$stmt$
  ) like 'BLOCKED%',
  'D11. service_role still cannot UPDATE order_item_options — DEC-014/034 unweakened'
);
select test_assert(
  test_call_as('service_role',
    $stmt$update public.order_item_options set menu_option_id = null
       where id = '2f000000-0000-0000-0000-000000000003'$stmt$
  ) like 'BLOCKED%',
  'D12. Not even menu_option_id may be updated — the fix removed the cascade, it did not carve out a writable column'
);
select test_assert(
  test_call_as('service_role',
    $stmt$delete from public.order_item_options
       where id = '2f000000-0000-0000-0000-000000000003'$stmt$
  ) like 'BLOCKED%',
  'D13. service_role still cannot DELETE order_item_options'
);
select test_assert(
  (select count(*) from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = 1
  and (select price_delta_satang from public.order_item_options
    where id = '2f000000-0000-0000-0000-000000000003') = 0,
  'D14. ... and the row is provably still there, unchanged, after all three attempts'
);

-- The constraint really is gone, and only that one. cart_item_options keeps
-- its own ON DELETE CASCADE, which is correct and wanted.
select test_assert(
  not exists (
    select 1 from pg_constraint
     where conrelid = 'public.order_item_options'::regclass
       and contype = 'f'
       and conname = 'order_item_options_menu_option_id_fkey'
  ),
  'D15. order_item_options_menu_option_id_fkey no longer exists'
);
select test_assert(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.cart_item_options'::regclass
       and contype = 'f'
       and conname = 'cart_item_options_menu_option_id_fkey'
  ),
  'D16. cart_item_options keeps its FK — an open cart SHOULD lose a deleted option'
);
select test_assert(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.order_item_options'::regclass
       and tgname = 'order_item_options_reject_mutation'
       and not tgisinternal
  ),
  'D17. The append-only trigger is still attached to order_item_options'
);

\echo '--- D. replace_menu_item_option_groups: PASS ---'

\echo ''
\echo 'All merchant catalog write assertions passed.'
\echo ''
