-- BANHAO — BQ-017 Slice #1: the customer-arrival foundation (20260907000001).
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (7a/7b/7c/7d/7e/7f000000-...), so
-- nothing here collides with domain_invariants, catalog_availability, the
-- rider race, order-creation, merchant-catalog-write, availability or
-- customer-quoted-prep fixtures.
--
-- What this proves, by execution:
--   A. The state CHECK accepts ARRIVED, and still accepts all ten pre-existing
--      values. A bogus state is still rejected — the constraint was widened,
--      not dropped.
--   B. arrived_at exists, is nullable, has no default, and is NULL on every
--      row that predates it. No backfill happened.
--   C. The guarded EN_ROUTE -> ARRIVED update matches exactly once, and a
--      second attempt matches nothing — so arrived_at cannot be rewritten by
--      re-running the transition. (The application property the migration's
--      § 4 states, proven at the statement level rather than asserted.)
--   D. The partial timer index exists, with the right predicate and column.
--   E. Security is unchanged: anon and authenticated cannot write
--      deliveries.state or arrived_at, and the table's own delete protection
--      and RLS are intact.
--   F. The order does not move — customer arrival is delivery-domain only
--      (DEC-018) — and DEC-053's failure fields stay unwritten in this slice.
--   G. Merchant arrival is untouched: RIDER_ASSIGNED -> AT_MERCHANT still
--      works and still writes no arrived_at.

\set ON_ERROR_STOP on

create or replace function arrival_test_assert(condition boolean, label text)
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
create or replace function arrival_test_call_as(role_name text, stmt text)
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

\set OWNER_X  '7a000000-0000-0000-0000-000000000001'
\set MERCH_X  '7b000000-0000-0000-0000-000000000001'
\set REST_X   '7c000000-0000-0000-0000-000000000001'
\set CUST_X   '7d000000-0000-0000-0000-000000000001'
\set RIDER_U  '7d000000-0000-0000-0000-000000000002'
\set RIDER_X  '7e000000-0000-0000-0000-000000000001'
\set ORDER_X  '7f000000-0000-0000-0000-000000000001'
\set DELIV_X  '7f000000-0000-0000-0000-000000000002'
\set ORDER_Y  '7f000000-0000-0000-0000-000000000003'
\set DELIV_Y  '7f000000-0000-0000-0000-000000000004'

insert into auth.users (id, phone) values (:'OWNER_X', '+66892250001')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'CUST_X', '+66892250002')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'RIDER_U', '+66892250003')
on conflict (id) do nothing;
insert into public.profiles (id, role) values (:'CUST_X', 'CUSTOMER')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_X', :'OWNER_X', 'ร้านทดสอบการมาถึง', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_X', :'MERCH_X', 'ร้าน X', 'ACTIVE', 14.4, 105.3);

insert into public.riders (id, user_id, full_name, status)
values (:'RIDER_X', :'RIDER_U', 'ไรเดอร์ เอ็กซ์', 'APPROVED');

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  :'ORDER_X', 'BH-ARRIVE-0001', 'DELIVERING', :'CUST_X', :'REST_X',
  'ร้าน X', 'ที่อยู่ทดสอบการมาถึง', 'ลูกค้า เอ็กซ์', '+66892250002', 'ONLINE',
  9000, 1000, 500, 0, 10500
);

-- Created BEFORE anything writes arrived_at, so it stands in for every
-- delivery that predates this migration.
insert into public.deliveries (id, order_id, state, rider_id)
values (:'DELIV_X', :'ORDER_X', 'EN_ROUTE', :'RIDER_X');

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  :'ORDER_Y', 'BH-ARRIVE-0002', 'PAID', :'CUST_X', :'REST_X',
  'ร้าน X', 'ที่อยู่ทดสอบร้าน', 'ลูกค้า เอ็กซ์', '+66892250002', 'ONLINE',
  9000, 1000, 500, 0, 10500
);

insert into public.deliveries (id, order_id, state, rider_id)
values (:'DELIV_Y', :'ORDER_Y', 'RIDER_ASSIGNED', :'RIDER_X');

\echo ''
\echo '==> A. the state CHECK accepts ARRIVED, and still accepts every pre-existing value'

select arrival_test_assert(
  arrival_test_call_as('postgres',
    format($stmt$update public.deliveries set state = 'ARRIVED' where id = %L$stmt$, :'DELIV_X')
  ) = 'ALLOWED',
  'A1. ARRIVED is an accepted delivery state'
);
update public.deliveries set state = 'EN_ROUTE', arrived_at = null where id = :'DELIV_X';

-- Every value the constraint carried before this migration, one at a time.
-- A widened constraint that quietly dropped one would fail here.
select arrival_test_assert(
  bool_and(
    arrival_test_call_as('postgres',
      format($stmt$update public.deliveries set state = %L where id = %L$stmt$, s, :'DELIV_X')
    ) = 'ALLOWED'
  ),
  'A2. all ten pre-existing states are still accepted — the constraint was widened, not replaced'
)
from unnest(array[
  'UNASSIGNED', 'RIDER_SEARCHING', 'RIDER_ASSIGNED', 'RIDER_REASSIGNING',
  'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE', 'DELIVERED', 'FAILED', 'ABANDONED'
]) as s;
update public.deliveries set state = 'EN_ROUTE', arrived_at = null where id = :'DELIV_X';

select arrival_test_assert(
  arrival_test_call_as('postgres',
    format($stmt$update public.deliveries set state = 'BOGUS' where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'A3. an unknown state is still rejected'
);

-- DEC-054 authorises exactly one new state on this path. A name from a
-- neighbouring proposal appearing in the CHECK would be scope creep.
select arrival_test_assert(
  bool_and(
    arrival_test_call_as('postgres',
      format($stmt$update public.deliveries set state = %L where id = %L$stmt$, s, :'DELIV_X')
    ) like 'BLOCKED%'
  ),
  'A4. no unrelated state was added alongside ARRIVED'
)
from unnest(array['ARRIVED_AT_CUSTOMER', 'AT_CUSTOMER', 'WAITING', 'POD_CAPTURED', 'DELIVERY_FAILED']) as s;

select arrival_test_assert(
  (select count(*) = 1
     from pg_constraint
    where conrelid = 'public.deliveries'::regclass
      and conname = 'deliveries_state_check'),
  'A5. the constraint kept its original name, so later migrations and readers still find it'
);

\echo ''
\echo '==> B. arrived_at: nullable, no default, no backfill'

select arrival_test_assert(
  (select is_nullable = 'YES' and column_default is null and data_type = 'timestamp with time zone'
     from information_schema.columns
    where table_schema = 'public' and table_name = 'deliveries' and column_name = 'arrived_at'),
  'B1. arrived_at is timestamptz, nullable, with no default'
);

select arrival_test_assert(
  (select count(*) from public.deliveries where arrived_at is not null) = 0,
  'B2. no existing delivery has an arrived_at — nothing was backfilled'
);

select arrival_test_assert(
  (select arrived_at is null from public.deliveries where id = :'DELIV_X'),
  'B3. a delivery inserted without arrived_at keeps NULL'
);

\echo ''
\echo '==> C. the guarded transition writes arrived_at exactly once'

update public.deliveries
   set state = 'ARRIVED', arrived_at = now()
 where id = :'DELIV_X'
   and state = 'EN_ROUTE'
   and rider_id = :'RIDER_X';

select arrival_test_assert(
  (select state = 'ARRIVED' and arrived_at is not null from public.deliveries where id = :'DELIV_X'),
  'C1. the guarded EN_ROUTE -> ARRIVED update moves the state and stamps the anchor in one statement'
);

-- Capture what the winner wrote, then re-run the identical statement. The
-- pre-state guard is what makes the second one match nothing.
create temporary table arrival_probe as
  select arrived_at as first_value from public.deliveries where id = :'DELIV_X';

update public.deliveries
   set state = 'ARRIVED', arrived_at = now()
 where id = :'DELIV_X'
   and state = 'EN_ROUTE'
   and rider_id = :'RIDER_X';

select arrival_test_assert(
  (select d.arrived_at = p.first_value
     from public.deliveries d, arrival_probe p
    where d.id = :'DELIV_X'),
  'C2. re-running the transition matches nothing and cannot rewrite arrived_at (write-once, per the migration''s § 4)'
);

-- Ownership is inside the same WHERE clause: another rider cannot arrive on
-- this delivery even if it were still EN_ROUTE.
update public.deliveries set state = 'EN_ROUTE', arrived_at = null where id = :'DELIV_X';
update public.deliveries
   set state = 'ARRIVED', arrived_at = now()
 where id = :'DELIV_X'
   and state = 'EN_ROUTE'
   and rider_id = '7e000000-0000-0000-0000-000000000009';

select arrival_test_assert(
  (select state = 'EN_ROUTE' and arrived_at is null from public.deliveries where id = :'DELIV_X'),
  'C3. a foreign rider''s guarded update matches nothing — ownership lives in the WHERE clause'
);

\echo ''
\echo '==> D. the DEC-053 timer index'

select arrival_test_assert(
  (select count(*) = 1
     from pg_indexes
    where schemaname = 'public'
      and tablename = 'deliveries'
      and indexname = 'deliveries_arrived_idx'),
  'D1. deliveries_arrived_idx exists'
);

select arrival_test_assert(
  (select indexdef like '%(arrived_at)%' and indexdef like '%WHERE (state = ''ARRIVED''::text)%'
     from pg_indexes
    where schemaname = 'public' and tablename = 'deliveries' and indexname = 'deliveries_arrived_idx'),
  'D2. it is partial on state = ARRIVED and keyed by arrived_at — the shape the future timer scan needs'
);

select arrival_test_assert(
  (select count(*) = 1
     from pg_indexes
    where schemaname = 'public' and tablename = 'deliveries' and indexname = 'deliveries_searching_idx'),
  'D3. the pre-existing dispatch index is untouched'
);

\echo ''
\echo '==> E. security is unchanged — no client may write the new state or column'

select arrival_test_assert(
  arrival_test_call_as('anon',
    format($stmt$update public.deliveries set state = 'ARRIVED' where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'E1. anon cannot write deliveries.state'
);
select arrival_test_assert(
  arrival_test_call_as('authenticated',
    format($stmt$update public.deliveries set state = 'ARRIVED' where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'E2. authenticated cannot write deliveries.state — every transition stays behind the API''s service-role client'
);
select arrival_test_assert(
  arrival_test_call_as('authenticated',
    format($stmt$update public.deliveries set arrived_at = now() where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'E3. authenticated cannot write arrived_at directly — the anchor is server-controlled'
);
select arrival_test_assert(
  arrival_test_call_as('anon',
    format($stmt$update public.deliveries set arrived_at = now() where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'E4. anon cannot write arrived_at'
);

select arrival_test_assert(
  (select relrowsecurity from pg_class where oid = 'public.deliveries'::regclass),
  'E5. RLS is still enabled on deliveries'
);

select arrival_test_assert(
  arrival_test_call_as('postgres',
    format($stmt$delete from public.deliveries where id = %L$stmt$, :'DELIV_X')
  ) like 'BLOCKED%',
  'E6. the delete protection still fires — a delivery is never hard-deleted'
);

\echo ''
\echo '==> F. delivery domain only (DEC-018), and no DEC-053 failure field is written'

select arrival_test_assert(
  (select state = 'DELIVERING' from public.orders where id = :'ORDER_X'),
  'F1. the order stayed DELIVERING throughout — customer arrival moves no order state'
);

select arrival_test_assert(
  (select cause_code is null from public.orders where id = :'ORDER_X'),
  'F2. orders.cause_code is still unwritten — the cause vocabulary exists in code only, and this slice writes none'
);

select arrival_test_assert(
  (select failure_cause is null and failed_at is null from public.deliveries where id = :'DELIV_X'),
  'F3. deliveries.failure_cause and failed_at are still unwritten — the failure path is Slice #2'
);

select arrival_test_assert(
  (select rider_earning_satang is null from public.deliveries where id = :'DELIV_X'),
  'F4. no earning or compensation was written — BQ-024 is OPEN'
);

select arrival_test_assert(
  (select count(*) = 0 from public.ledger_entries le
     join public.ledger_entry_groups g on g.id = le.group_id
    where g.order_id = :'ORDER_X'),
  'F5. no ledger entry was posted — Q-020 is OPEN and arrival is not an economic event'
);

select arrival_test_assert(
  (select count(*) = 0 from public.refunds r
     join public.payments p on p.id = r.payment_id
    where p.order_id = :'ORDER_X'),
  'F6. no refund row exists — Q-020 is untouched'
);

\echo ''
\echo '==> G. merchant arrival is untouched'

update public.deliveries
   set state = 'AT_MERCHANT'
 where id = :'DELIV_Y'
   and state = 'RIDER_ASSIGNED'
   and rider_id = :'RIDER_X';

select arrival_test_assert(
  (select state = 'AT_MERCHANT' from public.deliveries where id = :'DELIV_Y'),
  'G1. RIDER_ASSIGNED -> AT_MERCHANT still works exactly as before'
);

select arrival_test_assert(
  (select arrived_at is null from public.deliveries where id = :'DELIV_Y'),
  'G2. merchant arrival writes no arrived_at — AT_MERCHANT is the shop, ARRIVED is the customer (DEC-054)'
);

\echo ''
\echo '==> BQ-017 Slice #1 customer-arrival assertions complete'
