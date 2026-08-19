-- BANHAO — Phase E-1 fixtures: atomic order creation (create_order())
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test — independent UUID prefix block (a9/b9/d9/e9/f9/99000000-...), so
-- nothing here collides with domain_invariants_test.sql, catalog_availability
-- fixtures, or the rider race fixtures.
--
-- Two customers (CUST_X, CUST_Y) get their own cart/address/order for the
-- sequential assertions in order_creation_test.sql. Two more (CUST_C1,
-- CUST_C2) exist solely so run-domain-tests.sh can fire two REAL concurrent
-- create_order() calls against them — proving DEC-E-03's order_number
-- counter is race-safe by execution, the same standard TQ-012 already holds
-- the rider claim path to.

\set CUST_X   'a9000000-0000-0000-0000-000000000001'
\set CUST_Y   'a9000000-0000-0000-0000-000000000002'
\set CUST_C1  'a9000000-0000-0000-0000-000000000010'
\set CUST_C2  'a9000000-0000-0000-0000-000000000011'
\set OWNER_X  'b9000000-0000-0000-0000-000000000001'

insert into auth.users (id, phone) values
  (:'CUST_X',  '+66890000001'),
  (:'CUST_Y',  '+66890000002'),
  (:'CUST_C1', '+66890000010'),
  (:'CUST_C2', '+66890000011'),
  (:'OWNER_X', '+66890000099')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values ('d9000000-0000-0000-0000-000000000001', :'OWNER_X', 'ร้านทดสอบคำสั่งซื้อ', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values ('e9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001',
        'ร้านทดสอบคำสั่งซื้อ', 'ACTIVE', 14.3, 105.2);

insert into public.menu_categories (id, restaurant_id, name)
values ('f9000000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001', 'จานหลัก');

-- Available item, with an option group (one available option, one
-- unavailable option — proves the PC-Q-001-parity skip behaviour).
insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, is_available)
values ('19990000-0000-0000-0000-000000000001', 'e9000000-0000-0000-0000-000000000001',
        'f9000000-0000-0000-0000-000000000001', 'ข้าวผัดทดสอบ', 5000, true);

insert into public.menu_option_groups (id, menu_item_id, title, min_select, max_select)
values ('19990000-0000-0000-0000-000000000002', '19990000-0000-0000-0000-000000000001', 'ตัวเลือกไข่', 0, 1);

insert into public.menu_options (id, group_id, label, price_delta_satang, is_available)
values
  ('19990000-0000-0000-0000-000000000003', '19990000-0000-0000-0000-000000000002', 'ไข่ดาว', 1000, true),
  ('19990000-0000-0000-0000-000000000004', '19990000-0000-0000-0000-000000000002', 'ไข่เจียว (หมดวันนี้)', 1500, false);

-- A SECOND item, created available and then flipped unavailable below —
-- used only by the ITEM_UNAVAILABLE rejection test.
insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, is_available)
values ('19990000-0000-0000-0000-000000000005', 'e9000000-0000-0000-0000-000000000001',
        'f9000000-0000-0000-0000-000000000001', 'ของหมด', 3000, true);
update public.menu_items set is_available = false
  where id = '19990000-0000-0000-0000-000000000005';

-- Addresses — one per customer, all real rows a real Phase B API write
-- would produce.
insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line, landmark)
values
  ('a9500000-0000-0000-0000-000000000001', :'CUST_X',  'ลูกค้า เอ็กซ์', '+66811110001', 'ที่อยู่ทดสอบ X', 'ใกล้ตลาด'),
  ('a9500000-0000-0000-0000-000000000002', :'CUST_Y',  'ลูกค้า วาย',    '+66811110002', 'ที่อยู่ทดสอบ Y', null),
  ('a9500000-0000-0000-0000-000000000010', :'CUST_C1', 'ลูกค้า ซี1',    '+66811110010', 'ที่อยู่ทดสอบ C1', null),
  ('a9500000-0000-0000-0000-000000000011', :'CUST_C2', 'ลูกค้า ซี2',    '+66811110011', 'ที่อยู่ทดสอบ C2', null);

-- Carts — CUST_X gets a line WITH an available option (for the snapshot
-- test); CUST_Y is used for cross-customer isolation and gets its own,
-- separate cart+line. CUST_C1/CUST_C2 get simple one-line carts for the
-- concurrency proof.

insert into public.carts (id, user_id, restaurant_id)
values
  ('c9000000-0000-0000-0000-000000000001', :'CUST_X',  'e9000000-0000-0000-0000-000000000001'),
  ('c9000000-0000-0000-0000-000000000002', :'CUST_Y',  'e9000000-0000-0000-0000-000000000001'),
  ('c9000000-0000-0000-0000-000000000010', :'CUST_C1', 'e9000000-0000-0000-0000-000000000001'),
  ('c9000000-0000-0000-0000-000000000011', :'CUST_C2', 'e9000000-0000-0000-0000-000000000001');

insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity, note)
values
  ('c9100000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001',
   'e9000000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000001', 2, 'ไม่เผ็ด'),
  ('c9100000-0000-0000-0000-000000000002', 'c9000000-0000-0000-0000-000000000002',
   'e9000000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000001', 1, null),
  ('c9100000-0000-0000-0000-000000000010', 'c9000000-0000-0000-0000-000000000010',
   'e9000000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000001', 1, null),
  ('c9100000-0000-0000-0000-000000000011', 'c9000000-0000-0000-0000-000000000011',
   'e9000000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000001', 1, null);

-- CUST_X's line selects BOTH the available and the unavailable option — the
-- unavailable one must be priced at 0 and excluded from order_item_options.
insert into public.cart_item_options (id, cart_item_id, menu_option_id)
values
  ('c9200000-0000-0000-0000-000000000001', 'c9100000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000003'),
  ('c9200000-0000-0000-0000-000000000002', 'c9100000-0000-0000-0000-000000000001', '19990000-0000-0000-0000-000000000004');

\echo '--- order_creation_setup: fixtures loaded ---'
