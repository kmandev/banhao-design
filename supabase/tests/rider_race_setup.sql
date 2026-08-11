-- BANHAO — fixtures for the rider race condition test
--
-- Run after domain_invariants_test.sql, in the same database (reuses its
-- customers/restaurant), before the concurrent claim attempts orchestrated
-- by run-domain-tests.sh.

\set ON_ERROR_STOP on

insert into auth.users (id, phone) values
  ('c0000000-0000-0000-0000-000000000003', '+66830000003')
on conflict (id) do nothing;

insert into public.riders (id, user_id, full_name, status)
values ('c1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'ไรเดอร์ ซี', 'APPROVED');

-- Delivery 1 — the concurrent-claim race target (Rider A vs Rider B, then
-- a correct release + reassignment to Rider C).
insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1000000-0000-0000-0000-000000000003', 'BH-TEST-0003', 'MERCHANT_ACCEPTED', 'a0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ 1',
  'ลูกค้า ทดสอบ', '+66811111113', 'ONLINE', 9000, 1500, 500, 0, 11000
);

insert into public.deliveries (id, order_id, state)
values ('f1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'RIDER_SEARCHING');

-- Delivery 2 — the "partial release" negative-path target, proving the
-- 2026-08-11 architecture review's HIGH finding: omitting either statement
-- of the release invariant makes the delivery permanently unassignable.
insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1000000-0000-0000-0000-000000000004', 'BH-TEST-0004', 'MERCHANT_ACCEPTED', 'a0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000001', 'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ 2',
  'ลูกค้า ทดสอบ', '+66811111114', 'ONLINE', 9000, 1500, 500, 0, 11000
);

insert into public.deliveries (id, order_id, state)
values ('f1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000004', 'RIDER_SEARCHING');

-- Mirrors the guarded conditional UPDATE documented in
-- 20260811000009_delivery_domain.sql exactly, plus the same-transaction
-- rider_assignments write a real NestJS handler would perform on a win.
-- Used by two concurrent psql processes for the race test, and directly for
-- the single-session negative-path tests.
create or replace function test_attempt_claim(p_delivery_id uuid, p_rider_id uuid)
returns boolean
language plpgsql
as $$
declare
  won boolean;
begin
  update public.deliveries
     set state = 'RIDER_ASSIGNED', rider_id = p_rider_id, assigned_at = now()
   where id = p_delivery_id
     and state in ('RIDER_SEARCHING', 'RIDER_REASSIGNING')
     and rider_id is null;

  won := found;

  if won then
    insert into public.rider_assignments (delivery_id, rider_id, status)
    values (p_delivery_id, p_rider_id, 'ACCEPTED');
  end if;

  return won;
end;
$$;

-- The CORRECT two-statement release, exactly as documented. Used for the
-- successful-reassignment test.
create or replace function test_release_correctly(p_delivery_id uuid, p_reason text)
returns void
language plpgsql
as $$
begin
  update public.deliveries
     set state = 'RIDER_SEARCHING', rider_id = null, reassignment_count = reassignment_count + 1
   where id = p_delivery_id and state in ('RIDER_ASSIGNED', 'RIDER_REASSIGNING');

  update public.rider_assignments
     set status = 'RELEASED', closed_at = now(), close_reason = p_reason
   where delivery_id = p_delivery_id and status = 'ACCEPTED';
end;
$$;

-- The INCOMPLETE release the architecture review found — nulls
-- deliveries.rider_id but leaves the old rider_assignments row ACCEPTED.
-- Deliberately reproduces the bug so its consequence can be proven, then
-- test_close_stale_assignment fixes it in the same test sequence.
create or replace function test_release_incompletely(p_delivery_id uuid)
returns void
language plpgsql
as $$
begin
  update public.deliveries
     set state = 'RIDER_SEARCHING', rider_id = null
   where id = p_delivery_id and state in ('RIDER_ASSIGNED', 'RIDER_REASSIGNING');
  -- Deliberately NOT updating rider_assignments — this is the bug.
end;
$$;

create or replace function test_close_stale_assignment(p_delivery_id uuid)
returns void
language plpgsql
as $$
begin
  update public.rider_assignments
     set status = 'RELEASED', closed_at = now(), close_reason = 'test cleanup'
   where delivery_id = p_delivery_id and status = 'ACCEPTED';
end;
$$;
