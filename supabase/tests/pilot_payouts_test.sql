-- BANHAO — DEC-073 pilot payouts (20261108000003). Fixture ids use the 4c block.
--   A. No grant to anon/authenticated; functions service_role-only.
--   B. record_payout derives amounts from facts: merchant food − commission,
--      rider snapshotted earning; total is their sum; an audit row is written.
--   C. Refused: an item of another party, an undelivered order, an empty list.
--   D. Nothing is paid twice: a second payout of the same item is refused.
--   E. Voiding needs a reason, frees the items, and can be paid again.
--   F. A payout cannot be edited or deleted; an item cannot be un-voided.

\set ON_ERROR_STOP on

create or replace function pp_assert(condition boolean, label text)
returns void language plpgsql as $$
begin if condition then raise notice 'PASS  %', label; else raise exception 'FAIL  %', label; end if; end;
$$;
create or replace function pp_sqlstate(stmt text)
returns text language plpgsql as $$
begin execute stmt; return 'OK'; exception when others then return sqlstate; end;
$$;
create or replace function pp_call_as(role_name text, stmt text)
returns text language plpgsql as $$
declare err text;
begin
  perform set_config('role', role_name, true);
  begin execute stmt; err := 'ALLOWED'; exception when others then err := 'BLOCKED'; end;
  perform set_config('role', 'postgres', true);
  return err;
end;
$$;

begin;

insert into auth.users (id, phone) values
  ('4c000000-0000-4000-8000-000000000001', '+66892290081'),  -- merchant owner
  ('4c000000-0000-4000-8000-000000000002', '+66892290082'),  -- customer
  ('4c000000-0000-4000-8000-000000000003', '+66892290083'),  -- rider user
  ('4c000000-0000-4000-8000-000000000004', '+66892290084'),  -- admin
  ('4c000000-0000-4000-8000-000000000005', '+66892290085')   -- other merchant owner
on conflict (id) do nothing;
insert into public.merchants (id, owner_user_id, legal_name, status) values
  ('4c000000-0000-4000-8000-0000000000a1', '4c000000-0000-4000-8000-000000000001', 'ร้าน P', 'ACTIVE'),
  ('4c000000-0000-4000-8000-0000000000a2', '4c000000-0000-4000-8000-000000000005', 'ร้าน Q', 'ACTIVE');
insert into public.restaurants (id, merchant_id, name, status, lat, lng) values
  ('4c000000-0000-4000-8000-0000000000b1', '4c000000-0000-4000-8000-0000000000a1', 'ร้าน P', 'ACTIVE', 14.6, 105.5);
insert into public.riders (id, user_id, full_name, status) values
  ('4c000000-0000-4000-8000-0000000000c1', '4c000000-0000-4000-8000-000000000003', 'ไรเดอร์ พี', 'APPROVED');

insert into public.orders (id, order_number, state, customer_id, restaurant_id, restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang) values
  ('4c000000-0000-4000-8000-0000000000d1', 'BH-PAY-0001', 'DELIVERED', '4c000000-0000-4000-8000-000000000002', '4c000000-0000-4000-8000-0000000000b1',
   'ร้าน P', 'ที่อยู่', 'ลูกค้า', '+66892290082', 'ONLINE', 18000, 1500, 900, 0, 20400),
  ('4c000000-0000-4000-8000-0000000000d2', 'BH-PAY-0002', 'PREPARING', '4c000000-0000-4000-8000-000000000002', '4c000000-0000-4000-8000-0000000000b1',
   'ร้าน P', 'ที่อยู่', 'ลูกค้า', '+66892290082', 'ONLINE', 5000, 1500, 500, 0, 7000);
insert into public.order_commission_snapshots (order_id, commission_satang) values
  ('4c000000-0000-4000-8000-0000000000d1', 1800),
  ('4c000000-0000-4000-8000-0000000000d2', 500);
insert into public.deliveries (id, order_id, state, rider_id, rider_earning_satang) values
  ('4c000000-0000-4000-8000-0000000000e1', '4c000000-0000-4000-8000-0000000000d1', 'DELIVERED', '4c000000-0000-4000-8000-0000000000c1', 1200);

-- A
select pp_assert(pp_call_as('authenticated', 'select * from public.payouts') = 'BLOCKED', 'A1 authenticated cannot read payouts');
select pp_assert(pp_call_as('anon', 'select * from public.payout_items') = 'BLOCKED', 'A2 anon cannot read payout_items');
select pp_assert(pp_call_as('authenticated',
  $$select public.record_payout('RIDER', '4c000000-0000-4000-8000-0000000000c1', '2026-11-02', '2026-11-08', '2026-11-09', 'x', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000e1']::uuid[])$$) = 'BLOCKED',
  'A3 authenticated cannot call record_payout');

-- B
create temporary table ids (k text, v uuid);
insert into ids select 'merchant', public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-08', '2026-11-09',
  'SLIP-001', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000d1']::uuid[]);
select pp_assert((select total_satang = 16200 from public.payouts where id = (select v from ids where k = 'merchant')),
  'B1 merchant payout = food 18000 − commission 1800 = 16200');
insert into ids select 'rider', public.record_payout('RIDER', '4c000000-0000-4000-8000-0000000000c1', '2026-11-02', '2026-11-08', '2026-11-09',
  'SLIP-002', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000e1']::uuid[]);
select pp_assert((select total_satang = 1200 from public.payouts where id = (select v from ids where k = 'rider')),
  'B2 rider payout = the snapshotted earning 1200');
select pp_assert((select count(*) = 2 from public.audit_logs where action = 'PayoutRecorded'
  and entity_id in (select v from ids)), 'B3 each record writes an audit row');

-- C
select pp_assert(pp_sqlstate($$select public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a2', '2026-11-02', '2026-11-08', '2026-11-09', 'S', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000d2']::uuid[])$$) = '22023',
  'C1 another merchant''s order is refused');
select pp_assert(pp_sqlstate($$select public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-08', '2026-11-09', 'S', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000d2']::uuid[])$$) = '22023',
  'C2 an order not yet DELIVERED is refused');
select pp_assert(pp_sqlstate($$select public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-08', '2026-11-09', 'S', '4c000000-0000-4000-8000-000000000004', array[]::uuid[])$$) = '22023',
  'C3 an empty list is refused');

-- D
select pp_assert(pp_sqlstate($$select public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-08', '2026-11-10', 'SLIP-DUP', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000d1']::uuid[])$$) = '23505',
  'D1 the same order cannot be paid twice');
select pp_assert((select count(*) = 1 from public.payouts where party_id = '4c000000-0000-4000-8000-0000000000a1'),
  'D2 the refused attempt left no payout behind');

-- E
select pp_assert(pp_sqlstate(format('select public.void_payout(%L, %L, %L)', (select v from ids where k = 'merchant'), '4c000000-0000-4000-8000-000000000004', '  ')) = '22023',
  'E1 voiding needs a reason');
select public.void_payout((select v from ids where k = 'merchant'), '4c000000-0000-4000-8000-000000000004', 'ใส่เลขสลิปผิด');
select pp_assert((select bool_and(voided) from public.payout_items where payout_id = (select v from ids where k = 'merchant')),
  'E2 voiding frees the payout''s items');
select pp_assert(pp_sqlstate($$select public.record_payout('MERCHANT', '4c000000-0000-4000-8000-0000000000a1', '2026-11-02', '2026-11-08', '2026-11-10', 'SLIP-003', '4c000000-0000-4000-8000-000000000004', array['4c000000-0000-4000-8000-0000000000d1']::uuid[])$$) = 'OK',
  'E3 a voided item can be paid again');
select pp_assert(pp_sqlstate(format('select public.void_payout(%L, %L, %L)', (select v from ids where k = 'merchant'), '4c000000-0000-4000-8000-000000000004', 'again')) = 'P0002',
  'E4 a payout cannot be voided twice');

-- F
select pp_assert(pp_sqlstate(format('update public.payouts set total_satang = 1 where id = %L', (select v from ids where k = 'rider'))) = '42501',
  'F1 a payout cannot be edited');
select pp_assert(pp_sqlstate(format('delete from public.payouts where id = %L', (select v from ids where k = 'rider'))) = '42501',
  'F2 a payout cannot be deleted');
select pp_assert(pp_sqlstate(format('update public.payout_items set voided = false where payout_id = %L', (select v from ids where k = 'merchant'))) = '42501',
  'F3 a voided item cannot be un-voided');

rollback;

select 'pilot payouts assertions complete' as assertions;
