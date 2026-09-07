-- BANHAO — BQ-017 Slice #2: customer contact attempts (20260907000002).
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (8a/8b/8c/8d/8e/8f000000-...), so
-- nothing here collides with any other test's fixtures.
--
-- What this proves, by execution:
--   A. The table exists with the intended shape, and both foreign keys hold.
--   B. THE CAP. At most two attempts per delivery, enforced by the database
--      and not by counting: attempt_no 3 is refused by the CHECK, and a
--      repeated ordinal is refused by the unique constraint. This is the
--      invariant the concurrency requirement asks for — proven at the
--      constraint level, where two racing sessions must both go through it.
--   C. Append-only. An attempt can never be edited or deleted, by any role.
--   D. Two genuine attempts coexist — the cap bounds the total, it does not
--      deduplicate real evidence.
--   E. Security. anon and authenticated cannot read or write the table at
--      all; RLS is on and no policy exists. Every write is the API's
--      service-role client.
--   F. The failure path's own fields stay unwritten by anything in this
--      table's vicinity: recording an attempt is not a declaration.

\set ON_ERROR_STOP on

create or replace function contact_test_assert(condition boolean, label text)
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
create or replace function contact_test_call_as(role_name text, stmt text)
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

\set OWNER_C  '8a000000-0000-0000-0000-000000000001'
\set MERCH_C  '8b000000-0000-0000-0000-000000000001'
\set REST_C   '8c000000-0000-0000-0000-000000000001'
\set CUST_C   '8d000000-0000-0000-0000-000000000001'
\set RIDER_U  '8d000000-0000-0000-0000-000000000002'
\set RIDER_C  '8e000000-0000-0000-0000-000000000001'
\set ORDER_C  '8f000000-0000-0000-0000-000000000001'
\set DELIV_C  '8f000000-0000-0000-0000-000000000002'
\set ORDER_D  '8f000000-0000-0000-0000-000000000003'
\set DELIV_D  '8f000000-0000-0000-0000-000000000004'

insert into auth.users (id, phone) values (:'OWNER_C', '+66892260001')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'CUST_C', '+66892260002')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'RIDER_U', '+66892260003')
on conflict (id) do nothing;
insert into public.profiles (id, role) values (:'CUST_C', 'CUSTOMER')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_C', :'OWNER_C', 'ร้านทดสอบการติดต่อ', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_C', :'MERCH_C', 'ร้าน C', 'ACTIVE', 14.5, 105.4);

insert into public.riders (id, user_id, full_name, status)
values (:'RIDER_C', :'RIDER_U', 'ไรเดอร์ ซี', 'APPROVED');

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  :'ORDER_C', 'BH-CONTACT-0001', 'DELIVERING', :'CUST_C', :'REST_C',
  'ร้าน C', 'ที่อยู่ทดสอบการติดต่อ', 'ลูกค้า ซี', '+66892260002', 'ONLINE',
  9000, 1000, 500, 0, 10500
);

insert into public.deliveries (id, order_id, state, rider_id, arrived_at)
values (:'DELIV_C', :'ORDER_C', 'ARRIVED', :'RIDER_C', now() - interval '10 minutes');

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  :'ORDER_D', 'BH-CONTACT-0002', 'DELIVERING', :'CUST_C', :'REST_C',
  'ร้าน C', 'ที่อยู่ทดสอบที่สอง', 'ลูกค้า ซี', '+66892260002', 'ONLINE',
  9000, 1000, 500, 0, 10500
);

insert into public.deliveries (id, order_id, state, rider_id, arrived_at)
values (:'DELIV_D', :'ORDER_D', 'ARRIVED', :'RIDER_C', now() - interval '10 minutes');

\echo ''
\echo '==> A. shape and referential integrity'

select contact_test_assert(
  (select count(*) = 1
     from information_schema.tables
    where table_schema = 'public' and table_name = 'delivery_contact_attempts'),
  'A1. delivery_contact_attempts exists'
);

select contact_test_assert(
  (select count(*) = 2
     from pg_constraint
    where conrelid = 'public.delivery_contact_attempts'::regclass
      and contype = 'f'),
  'A2. two foreign keys — the delivery and the rider'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 1)$stmt$, '8f000000-0000-0000-0000-0000000000ff', :'RIDER_C')
  ) like 'BLOCKED%',
  'A3. an attempt for a delivery that does not exist is rejected by the FK'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 1)$stmt$, :'DELIV_C', '8e000000-0000-0000-0000-0000000000ff')
  ) like 'BLOCKED%',
  'A4. an attempt by a rider that does not exist is rejected by the FK'
);

\echo ''
\echo '==> B. the cap of two — enforced by the database, not by counting'

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 1)$stmt$, :'DELIV_C', :'RIDER_C')
  ) = 'ALLOWED',
  'B1. attempt 1 is recorded'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 2)$stmt$, :'DELIV_C', :'RIDER_C')
  ) = 'ALLOWED',
  'B2. attempt 2 is recorded'
);

-- THE CONCURRENCY INVARIANT. Two racing sessions both derive the same next
-- ordinal; the unique constraint is what makes exactly one of them win. A
-- naive count-then-insert with no constraint behind it would leave three.
select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 2)$stmt$, :'DELIV_C', :'RIDER_C')
  ) like 'BLOCKED%',
  'B3. a SECOND row with attempt_no 2 is refused (23505) — this is what settles a concurrent tie'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 3)$stmt$, :'DELIV_C', :'RIDER_C')
  ) like 'BLOCKED%',
  'B4. attempt_no 3 is refused by the CHECK — no third ordinal can exist at all'
);

select contact_test_assert(
  bool_and(
    contact_test_call_as('postgres',
      format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                   values (%L, %L, %s)$stmt$, :'DELIV_C', :'RIDER_C', n)
    ) like 'BLOCKED%'
  ),
  'B5. 0, negative and large ordinals are all refused'
)
from unnest(array[0, -1, 4, 99]) as n;

select contact_test_assert(
  (select count(*) = 2 from public.delivery_contact_attempts where delivery_id = :'DELIV_C'),
  'B6. THE INVARIANT: count(attempts) <= 2 held through every attempt above'
);

\echo ''
\echo '==> C. append-only'

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$update public.delivery_contact_attempts set attempt_no = 1 where delivery_id = %L$stmt$, :'DELIV_C')
  ) like 'BLOCKED%',
  'C1. an attempt cannot be updated, even by postgres — the evidence is immutable'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$delete from public.delivery_contact_attempts where delivery_id = %L$stmt$, :'DELIV_C')
  ) like 'BLOCKED%',
  'C2. an attempt cannot be deleted — no replaying the cap by clearing rows'
);

select contact_test_assert(
  (select count(*) = 2 from public.delivery_contact_attempts where delivery_id = :'DELIV_C'),
  'C3. both rows survived the update and delete attempts'
);

\echo ''
\echo '==> D. two genuine attempts are two rows, and the cap is per delivery'

select contact_test_assert(
  (select count(distinct attempt_no) = 2 from public.delivery_contact_attempts where delivery_id = :'DELIV_C'),
  'D1. the two attempts are distinct rows, not one deduplicated one'
);

select contact_test_assert(
  contact_test_call_as('postgres',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 1)$stmt$, :'DELIV_D', :'RIDER_C')
  ) = 'ALLOWED',
  'D2. a different delivery starts again at attempt 1 — the cap is per delivery'
);

select contact_test_assert(
  (select attempted_at is not null and created_at is not null
     from public.delivery_contact_attempts where delivery_id = :'DELIV_D'),
  'D3. attempted_at and created_at default to the server clock'
);

\echo ''
\echo '==> E. security — no client reaches this table at all'

select contact_test_assert(
  (select relrowsecurity from pg_class where oid = 'public.delivery_contact_attempts'::regclass),
  'E1. RLS is enabled'
);

select contact_test_assert(
  (select count(*) = 0 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_contact_attempts'),
  'E2. no policy exists — the table is unreachable by any client, like audit_logs and outbox'
);

select contact_test_assert(
  contact_test_call_as('anon',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 2)$stmt$, :'DELIV_D', :'RIDER_C')
  ) like 'BLOCKED%',
  'E3. anon cannot insert an attempt'
);
select contact_test_assert(
  contact_test_call_as('authenticated',
    format($stmt$insert into public.delivery_contact_attempts (delivery_id, rider_id, attempt_no)
                 values (%L, %L, 2)$stmt$, :'DELIV_D', :'RIDER_C')
  ) like 'BLOCKED%',
  'E4. authenticated cannot insert an attempt — every write is the API''s service-role client'
);
select contact_test_assert(
  contact_test_call_as('authenticated',
    'select count(*) from public.delivery_contact_attempts'
  ) like 'BLOCKED%',
  'E5. authenticated cannot even read the table'
);
select contact_test_assert(
  contact_test_call_as('anon', 'select count(*) from public.delivery_contact_attempts') like 'BLOCKED%',
  'E6. anon cannot read the table'
);

\echo ''
\echo '==> F. recording an attempt declares nothing'

select contact_test_assert(
  (select state = 'ARRIVED' and failed_at is null and failure_cause is null
     from public.deliveries where id = :'DELIV_C'),
  'F1. the delivery is untouched by its attempts — still ARRIVED, still unfailed'
);

select contact_test_assert(
  (select state = 'DELIVERING' and cause_code is null from public.orders where id = :'ORDER_C'),
  'F2. the order is untouched — still DELIVERING, no cause recorded'
);

select contact_test_assert(
  (select count(*) = 0 from public.audit_logs where entity_id = :'DELIV_C'),
  'F3. no audit row — an attempt is the rider''s operational act, not an operator intervention'
);

\echo ''
\echo '==> BQ-017 Slice #2 contact-attempt assertions complete'
