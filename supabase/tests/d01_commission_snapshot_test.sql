-- BANHAO — D-01 order-time commission snapshot (20260915000001)
--
-- Run by run-domain-tests.sh against real PostgreSQL, after every migration
-- and every earlier suite. Self-contained fixtures under the d0x00000-...
-- prefix block. Earlier suites' orders are never asserted on here. The freeze
-- assertions drain the whole database's legacy population first, then assert
-- only on this file's own orders.
--
-- Proves:
--   A. order_commission_snapshots: RLS on, zero policies, no anon/
--      authenticated privilege, and client SELECT blocked
--   B. the D-01 create_order() overload writes exactly one snapshot with the
--      caller's resolved amount, in the same call as the order
--   C. p_commission_satang / p_commission_base_satang: explicit NULL and
--      negative values refused (22023). Nothing is written
--   D. base != authoritative food subtotal is refused (P0001). Nothing is
--      written, not even the order_number counter
--   E. a forced snapshot-insert failure rolls back the whole order: no
--      partial order, item, history row or counter increment survives
--   F. the snapshot is append-only (UPDATE/DELETE 42501) and unique per
--      order (23505)
--   G. EXECUTE on the new overload and on expire_legacy_unpaid_orders() is
--      blocked for anon/authenticated
--   H. ledger guard: a snapshot-bearing order's MERCHANT_COMMISSION entries
--      must equal the snapshot (a live-rate amount is refused, 23514). A
--      legacy order and a non-original group are unguarded
--   I. COMMISSION_SNAPSHOT_MISSING: accepted, needs order_id, one
--      OPEN/IN_PROGRESS per order, re-openable after RESOLVED, and other
--      kinds' dedup behaviour unchanged
--   J. freeze: legacy CREATED/PENDING_PAYMENT → PAYMENT_EXPIRED with a
--      SYSTEM history row; snapshot-bearing, PAID and CANCELLED orders are
--      never frozen; the batch bound holds; a repeat call is a no-op; a PAID
--      transition against a frozen order matches 0 rows

\set ON_ERROR_STOP on

create or replace function d01_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

create or replace function d01_try(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

create or replace function d01_as_role(role_name text, stmt text)
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
\echo ' BANHAO D-01 — order-time commission snapshot'
\echo '=================================================='

-- ---------------------------------------------------------------------------
-- Fixtures — one customer, one address, one cart holding one ฿125 dish.
-- create_order() never clears the cart, so every create_order() call below
-- prices the same ฿125 (12500 satang) food subtotal. At D-01's 10% with
-- D-02 round-half-up that resolves to ฿13 (1300 satang), which is the value
-- the application passes as p_commission_satang.
-- ---------------------------------------------------------------------------

insert into auth.users (id, phone) values
  ('d0100000-0000-0000-0000-000000000001', '+66890100001'),
  ('d0100000-0000-0000-0000-000000000099', '+66890100099')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values ('d0200000-0000-0000-0000-000000000001', 'd0100000-0000-0000-0000-000000000099', 'ร้านทดสอบ D-01', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values ('d0300000-0000-0000-0000-000000000001', 'd0200000-0000-0000-0000-000000000001',
        'ร้านทดสอบ D-01', 'ACTIVE', 14.3, 105.2);

insert into public.menu_categories (id, restaurant_id, name)
values ('d0400000-0000-0000-0000-000000000001', 'd0300000-0000-0000-0000-000000000001', 'จานหลัก');

insert into public.menu_items (id, restaurant_id, category_id, name, base_price_satang, is_available)
values ('d0500000-0000-0000-0000-000000000001', 'd0300000-0000-0000-0000-000000000001',
        'd0400000-0000-0000-0000-000000000001', 'กะเพราทดสอบ D-01', 12500, true);

insert into public.addresses (id, user_id, recipient_name, recipient_phone, address_line)
values ('d0600000-0000-0000-0000-000000000001', 'd0100000-0000-0000-0000-000000000001',
        'ลูกค้า D-01', '+66890100001', 'ที่อยู่ทดสอบ D-01');

insert into public.carts (id, user_id, restaurant_id)
values ('d0700000-0000-0000-0000-000000000001', 'd0100000-0000-0000-0000-000000000001',
        'd0300000-0000-0000-0000-000000000001');

insert into public.cart_items (id, cart_id, restaurant_id, menu_item_id, quantity)
values ('d0800000-0000-0000-0000-000000000001', 'd0700000-0000-0000-0000-000000000001',
        'd0300000-0000-0000-0000-000000000001', 'd0500000-0000-0000-0000-000000000001', 1);

-- Two helpers, one per overload. snapshot_order() uses the D-01 overload by
-- named notation, which is how PostgREST calls it. legacy_order() uses the
-- retained pre-D-01 overload exactly as an old application instance would.
create or replace function d01_snapshot_order(p_commission bigint, p_base bigint)
returns uuid language sql as $$
  select order_id from public.create_order(
    p_customer_id => 'd0100000-0000-0000-0000-000000000001'::uuid,
    p_address_id => 'd0600000-0000-0000-0000-000000000001'::uuid,
    p_payment_method => 'ONLINE',
    p_delivery_fee_satang => 1000::bigint,
    p_service_fee_satang => 500::bigint,
    p_commission_satang => p_commission,
    p_commission_base_satang => p_base
  );
$$;

create or replace function d01_legacy_order()
returns uuid language sql as $$
  select order_id from public.create_order(
    'd0100000-0000-0000-0000-000000000001'::uuid,
    'd0600000-0000-0000-0000-000000000001'::uuid,
    'ONLINE', 1000::bigint, 500::bigint
  );
$$;

-- ===========================================================================
-- A. Storage boundary
-- ===========================================================================

select d01_assert(
  (select relrowsecurity from pg_class where oid = 'public.order_commission_snapshots'::regclass),
  'A1. order_commission_snapshots has RLS enabled'
);
select d01_assert(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_commission_snapshots') = 0,
  'A2. order_commission_snapshots has zero policies (no customer/merchant/rider read path)'
);
select d01_assert(
  not has_table_privilege('anon', 'public.order_commission_snapshots', 'select')
  and not has_table_privilege('authenticated', 'public.order_commission_snapshots', 'select')
  and not has_table_privilege('authenticated', 'public.order_commission_snapshots', 'insert'),
  'A3. anon/authenticated hold no SELECT/INSERT privilege on order_commission_snapshots'
);
select d01_assert(
  d01_as_role('authenticated', 'select count(*) from public.order_commission_snapshots') like 'BLOCKED:%',
  'A4. an authenticated client SELECT on order_commission_snapshots is blocked'
);
select d01_assert(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'orders' and column_name like '%commission%'
  ),
  'A5. no commission column was added to the full-row-readable orders table'
);

-- ===========================================================================
-- B. The D-01 overload writes exactly one snapshot, atomically with the order
-- ===========================================================================

select d01_snapshot_order(1300, 12500) as b_order \gset

select d01_assert(
  (select subtotal_satang from public.orders where id = :'b_order') = 12500,
  'B1. the order stores the ฿125 food subtotal the commission base named'
);
select d01_assert(
  (select count(*) from public.order_commission_snapshots where order_id = :'b_order') = 1,
  'B2. exactly one snapshot row exists for the new order'
);
select d01_assert(
  (select commission_satang from public.order_commission_snapshots where order_id = :'b_order') = 1300,
  'B3. the snapshot holds the caller''s resolved amount (10% of ฿125, round-half-up = 1300 satang)'
);

-- ===========================================================================
-- C. Required, non-null, non-negative commission inputs
-- ===========================================================================

select count(*) as c_orders_before from public.orders
 where customer_id = 'd0100000-0000-0000-0000-000000000001' \gset

select d01_assert(d01_try('select d01_snapshot_order(null, 12500)') = '22023',
  'C1. an explicit NULL p_commission_satang is refused (22023)');
select d01_assert(d01_try('select d01_snapshot_order(1300, null)') = '22023',
  'C2. an explicit NULL p_commission_base_satang is refused (22023)');
select d01_assert(d01_try('select d01_snapshot_order(-100, 12500)') = '22023',
  'C3. a negative commission is refused (22023)');
select d01_assert(
  (select count(*) from public.orders where customer_id = 'd0100000-0000-0000-0000-000000000001') = :c_orders_before,
  'C4. no order was written by any refused call'
);
select d01_assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_order'
      and pg_get_function_identity_arguments(p.oid) like '%p_commission_satang bigint%'
      and pg_get_function_arguments(p.oid) not like '%p_commission_satang bigint DEFAULT%') = 1,
  'C5. the D-01 overload declares p_commission_satang with no default'
);

-- ===========================================================================
-- D. Base must equal the authoritative food subtotal
-- ===========================================================================

select coalesce(max(next_seq), 0) as d_seq_before from public.order_number_counters \gset

select d01_assert(d01_try('select d01_snapshot_order(1200, 12000)') = 'P0001',
  'D1. a commission resolved against a different subtotal (12000 vs the order''s 12500) is refused (P0001)');
select d01_assert(
  (select count(*) from public.orders where customer_id = 'd0100000-0000-0000-0000-000000000001') = :c_orders_before,
  'D2. no order was written by the refused mismatch'
);
select d01_assert(
  coalesce((select max(next_seq) from public.order_number_counters), 0) = :d_seq_before,
  'D3. the order_number counter increment was rolled back with it'
);

-- ===========================================================================
-- E. A snapshot-insert failure unwinds the whole order (atomicity)
-- ===========================================================================

create or replace function d01_fail_snapshot_insert() returns trigger language plpgsql as $$
begin
  raise exception 'forced snapshot insert failure (D-01 atomicity test)';
end;
$$;

create trigger d01_force_snapshot_failure
  before insert on public.order_commission_snapshots
  for each row execute function d01_fail_snapshot_insert();

select count(*) as e_items_before from public.order_items oi
  join public.orders o on o.id = oi.order_id
 where o.customer_id = 'd0100000-0000-0000-0000-000000000001' \gset
select count(*) as e_history_before from public.order_status_history h
  join public.orders o on o.id = h.order_id
 where o.customer_id = 'd0100000-0000-0000-0000-000000000001' \gset
select coalesce(max(next_seq), 0) as e_seq_before from public.order_number_counters \gset

select d01_assert(d01_try('select d01_snapshot_order(1300, 12500)') <> 'OK',
  'E1. create_order fails when its snapshot insert fails');

drop trigger d01_force_snapshot_failure on public.order_commission_snapshots;

select d01_assert(
  (select count(*) from public.orders where customer_id = 'd0100000-0000-0000-0000-000000000001') = :c_orders_before,
  'E2. no partial order survived the snapshot failure'
);
select d01_assert(
  (select count(*) from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.customer_id = 'd0100000-0000-0000-0000-000000000001') = :e_items_before,
  'E3. no order_items survived the snapshot failure'
);
select d01_assert(
  (select count(*) from public.order_status_history h join public.orders o on o.id = h.order_id
    where o.customer_id = 'd0100000-0000-0000-0000-000000000001') = :e_history_before,
  'E4. no order_status_history row survived the snapshot failure'
);
select d01_assert(
  coalesce((select max(next_seq) from public.order_number_counters), 0) = :e_seq_before,
  'E5. the order_number counter increment was rolled back too'
);

-- ===========================================================================
-- F. Append-only and unique per order
-- ===========================================================================

select d01_assert(
  d01_try(format('update public.order_commission_snapshots set commission_satang = 1000 where order_id = %L', :'b_order')) = '42501',
  'F1. UPDATE of a snapshot is rejected (42501), even for the owner role'
);
select d01_assert(
  d01_try(format('delete from public.order_commission_snapshots where order_id = %L', :'b_order')) = '42501',
  'F2. DELETE of a snapshot is rejected (42501)'
);
select d01_assert(
  d01_try(format('insert into public.order_commission_snapshots (order_id, commission_satang) values (%L, 1)', :'b_order')) = '23505',
  'F3. a second snapshot for the same order is rejected (23505)'
);
select d01_assert(
  (select commission_satang from public.order_commission_snapshots where order_id = :'b_order') = 1300,
  'F4. the original snapshot is unchanged'
);

-- ===========================================================================
-- G. Execution privilege
-- ===========================================================================

select d01_assert(
  d01_as_role('authenticated', 'select d01_snapshot_order(1300, 12500)') like 'BLOCKED:%',
  'G1. authenticated cannot execute the D-01 create_order overload'
);
select d01_assert(
  d01_as_role('anon', 'select d01_snapshot_order(1300, 12500)') like 'BLOCKED:%',
  'G2. anon cannot execute the D-01 create_order overload'
);
select d01_assert(
  d01_as_role('authenticated', 'select * from public.expire_legacy_unpaid_orders(1)') like 'BLOCKED:%',
  'G3. authenticated cannot execute expire_legacy_unpaid_orders()'
);

-- ===========================================================================
-- H. Ledger guard — MERCHANT_COMMISSION entries must equal the snapshot
-- ===========================================================================

insert into public.ledger_entry_groups (id, group_key, order_id, kind)
values ('d0900000-0000-0000-0000-000000000001', 'd01:commission:snapshot-order', :'b_order', 'MERCHANT_COMMISSION');

select d01_assert(
  d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000001', 'MERCHANT_PAYABLE', 'MERCHANT', 'd0200000-0000-0000-0000-000000000001', -1000)$$) = '23514',
  'H1. a live-rate (8%) MERCHANT_PAYABLE entry for a snapshot-bearing order is refused (23514)'
);
select d01_assert(
  d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000001', 'PLATFORM_REVENUE', 'PLATFORM', null, 1300)$$) = 'OK'
  and d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000001', 'MERCHANT_PAYABLE', 'MERCHANT', 'd0200000-0000-0000-0000-000000000001', -1300)$$) = 'OK',
  'H2. entries equal to the snapshot (-1300 / +1300) are accepted'
);
select d01_assert(
  d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000001', 'RIDER_PAYABLE', 'RIDER', null, 1300)$$) = '23514',
  'H3. any other account inside an original MERCHANT_COMMISSION group of a snapshot-bearing order is refused'
);

select d01_legacy_order() as h_legacy_order \gset

select d01_assert(
  (select count(*) from public.order_commission_snapshots where order_id = :'h_legacy_order') = 0,
  'H4. the retained pre-D-01 overload still creates an order, with no snapshot — a legacy order'
);

insert into public.ledger_entry_groups (id, group_key, order_id, kind)
values ('d0900000-0000-0000-0000-000000000002', 'd01:commission:legacy-order', :'h_legacy_order', 'MERCHANT_COMMISSION');

select d01_assert(
  d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000002', 'MERCHANT_PAYABLE', 'MERCHANT', 'd0200000-0000-0000-0000-000000000001', -1000)$$) = 'OK',
  'H5. a legacy (no-snapshot) order''s commission entries are not guarded'
);

insert into public.ledger_entry_groups (id, group_key, order_id, kind)
values ('d0900000-0000-0000-0000-000000000003', 'd01:commission-refund:snapshot-order', :'b_order', 'MERCHANT_COMMISSION_REFUND');

select d01_assert(
  d01_try($$insert into public.ledger_entries (group_id, account, party_type, party_id, amount_satang)
             values ('d0900000-0000-0000-0000-000000000003', 'PLATFORM_REVENUE', 'PLATFORM', null, -1300)$$) = 'OK',
  'H6. a refund-reversal group (MERCHANT_COMMISSION_REFUND) is not guarded by the snapshot trigger'
);

-- ===========================================================================
-- I. COMMISSION_SNAPSHOT_MISSING
-- ===========================================================================

select d01_assert(
  d01_try(format($$insert into public.reconciliation_cases (kind, order_id, state) values ('COMMISSION_SNAPSHOT_MISSING', %L, 'OPEN')$$, :'h_legacy_order')) = 'OK',
  'I1. COMMISSION_SNAPSHOT_MISSING is an accepted kind'
);
select d01_assert(
  d01_try($$insert into public.reconciliation_cases (kind, state) values ('COMMISSION_SNAPSHOT_MISSING', 'OPEN')$$) = '23514',
  'I2. COMMISSION_SNAPSHOT_MISSING without an order_id is refused (23514)'
);
select d01_assert(
  d01_try(format($$insert into public.reconciliation_cases (kind, order_id, state) values ('COMMISSION_SNAPSHOT_MISSING', %L, 'IN_PROGRESS')$$, :'h_legacy_order')) = '23505',
  'I3. a second OPEN/IN_PROGRESS case for the same order is refused (23505) — deduplicated'
);

update public.reconciliation_cases set state = 'RESOLVED', resolution_note = 'D-01 test'
 where kind = 'COMMISSION_SNAPSHOT_MISSING' and order_id = :'h_legacy_order';

select d01_assert(
  d01_try(format($$insert into public.reconciliation_cases (kind, order_id, state) values ('COMMISSION_SNAPSHOT_MISSING', %L, 'OPEN')$$, :'h_legacy_order')) = 'OK',
  'I4. a RESOLVED case never blocks a genuinely new OPEN one for the same order'
);
select d01_assert(
  d01_try(format($$insert into public.reconciliation_cases (kind, order_id, state) values ('LATE_PAYMENT', %L, 'OPEN')$$, :'h_legacy_order')) = 'OK'
  and d01_try(format($$insert into public.reconciliation_cases (kind, order_id, state) values ('LATE_PAYMENT', %L, 'OPEN')$$, :'h_legacy_order')) = 'OK',
  'I5. LATE_PAYMENT''s long-standing undeduplicated behaviour is unchanged'
);
select d01_assert(
  d01_try($$insert into public.reconciliation_cases (kind, state) values ('NOT_A_KIND', 'OPEN')$$) = '23514',
  'I6. an unrecognized kind is still refused'
);

-- ===========================================================================
-- J. Freeze — expire_legacy_unpaid_orders()
-- ===========================================================================

-- Drain every legacy candidate in the database (earlier suites' orders
-- included), so the assertions below are about this file's orders alone.
do $$
declare
  n int;
begin
  loop
    select count(*) into n from public.expire_legacy_unpaid_orders(1000);
    exit when n = 0;
  end loop;
end $$;

-- Fresh fixtures, created after the drain.
select d01_legacy_order() as j_legacy_created \gset
select d01_legacy_order() as j_legacy_pending \gset
select d01_legacy_order() as j_legacy_paid \gset
select d01_legacy_order() as j_legacy_cancelled \gset
select d01_snapshot_order(1300, 12500) as j_snapshot_created \gset
select d01_snapshot_order(1300, 12500) as j_snapshot_pending \gset

update public.orders set state = 'PENDING_PAYMENT' where id in (:'j_legacy_pending', :'j_snapshot_pending');
update public.orders set state = 'PAID' where id = :'j_legacy_paid';
update public.orders set state = 'CANCELLED' where id = :'j_legacy_cancelled';

create temporary table d01_frozen as
  select * from public.expire_legacy_unpaid_orders(1000);

select d01_assert(
  (select count(*) from d01_frozen) = 2,
  'J1. exactly the two legacy unpaid orders were frozen (got ' || (select count(*) from d01_frozen) || ')'
);
select d01_assert(
  (select state from public.orders where id = :'j_legacy_created') = 'PAYMENT_EXPIRED'
  and (select state from public.orders where id = :'j_legacy_pending') = 'PAYMENT_EXPIRED',
  'J2. legacy CREATED and PENDING_PAYMENT orders are now PAYMENT_EXPIRED'
);
select d01_assert(
  (select from_state from d01_frozen where order_id = :'j_legacy_created') = 'CREATED'
  and (select from_state from d01_frozen where order_id = :'j_legacy_pending') = 'PENDING_PAYMENT',
  'J3. the function reports each order''s true prior state'
);
select d01_assert(
  (select count(*) from public.order_status_history
    where order_id in (:'j_legacy_created', :'j_legacy_pending')
      and to_state = 'PAYMENT_EXPIRED' and actor_type = 'SYSTEM' and actor_id is null) = 2,
  'J4. each freeze wrote one SYSTEM order_status_history row with no actor_id'
);
select d01_assert(
  (select state from public.orders where id = :'j_snapshot_created') = 'CREATED'
  and (select state from public.orders where id = :'j_snapshot_pending') = 'PENDING_PAYMENT',
  'J5. snapshot-bearing CREATED/PENDING_PAYMENT orders are never frozen'
);
select d01_assert(
  (select state from public.orders where id = :'j_legacy_paid') = 'PAID',
  'J6. a PAID legacy order is never frozen'
);
select d01_assert(
  (select state from public.orders where id = :'j_legacy_cancelled') = 'CANCELLED',
  'J7. a CANCELLED legacy order is never frozen'
);
select d01_assert(
  (select count(*) from public.expire_legacy_unpaid_orders(1000)) = 0,
  'J8. a repeated freeze is a no-op (idempotent)'
);
select d01_assert(
  (select count(*) from public.order_status_history
    where order_id in (:'j_legacy_created', :'j_legacy_pending') and to_state = 'PAYMENT_EXPIRED') = 2,
  'J9. the repeat wrote no second history row'
);

-- The PAID transition exactly as PaymentEventProcessingService issues it,
-- against a frozen order: it must match 0 rows, which is the LATE_PAYMENT
-- branch, where no money is posted (D-01-ARCH-8).
with paid as (
  update public.orders set state = 'PAID', paid_at = now()
   where id = :'j_legacy_pending' and state = 'PENDING_PAYMENT'
  returning id
)
select count(*) as j_paid_rows from paid \gset

select d01_assert(:j_paid_rows = 0,
  'J10. the guarded PENDING_PAYMENT → PAID transition matches 0 rows for a frozen order');
select d01_assert(
  (select state from public.orders where id = :'j_legacy_pending') = 'PAYMENT_EXPIRED',
  'J11. the frozen order stays PAYMENT_EXPIRED'
);

-- Batch bound.
select d01_legacy_order() as j_b1 \gset
select d01_legacy_order() as j_b2 \gset
select d01_legacy_order() as j_b3 \gset

select d01_assert((select count(*) from public.expire_legacy_unpaid_orders(2)) = 2,
  'J12. p_batch_size bounds one call (2 of 3 frozen)');
select d01_assert((select count(*) from public.expire_legacy_unpaid_orders(2)) = 1,
  'J13. the next call freezes the remainder');
select d01_assert((select count(*) from public.expire_legacy_unpaid_orders(2)) = 0,
  'J14. and then nothing is left');
select d01_assert(d01_try('select * from public.expire_legacy_unpaid_orders(0)') = '22023',
  'J15. a non-positive batch size is refused (22023)');

\echo ''
\echo '=================================================='
\echo ' D-01 commission snapshot: ALL ASSERTIONS PASSED'
\echo '=================================================='
