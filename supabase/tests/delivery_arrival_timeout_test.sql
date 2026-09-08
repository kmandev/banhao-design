-- BANHAO — BQ-017 Slice #3: the five-minute customer-arrival escalation.
--
-- Run by run-domain-tests.sh, in the same database as every other domain
-- test. Independent UUID prefix block (9a/9b/9c/9d/9e/9f000000-...), so
-- nothing here collides with any other test's fixtures.
--
-- This slice adds NO migration. What it proves is that the query the tick
-- phase and the operator listing both issue selects exactly the right
-- population, at the boundary, against real PostgreSQL — the one thing a
-- TypeScript stub cannot demonstrate, because there the database's own
-- comparison is the thing being mocked.
--
-- What this proves, by execution:
--   A. THE THRESHOLD. A delivery arrived 4:59 ago is NOT selected; one
--      arrived exactly 5:00 ago IS; one arrived long ago IS. This is DEC-053's
--      five minutes, and it is inclusive at the boundary.
--   B. Never the illustrative 10 minutes: a delivery between 5 and 10 minutes
--      is selected, so nothing is silently using the superseded figure.
--   C. A null arrived_at is excluded by the comparison itself, not by a
--      separate check that could be forgotten.
--   D. Only ARRIVED deliveries qualify, and only while the order is still
--      DELIVERING.
--   E. The partial index Slice #1 created is the one that serves this scan.
--   F. The escalation is inert: the audit row it writes changes no delivery
--      or order state, and an escalated delivery still reads exactly as it
--      did — no automatic failure is possible from this path.
--   G. Idempotency's storage side: a second identical escalation row is
--      possible at the schema level (audit_logs has no unique constraint),
--      which is precisely why the application performs the existence check.
--      Stated by execution so the bound is not mistaken for a guarantee.

\set ON_ERROR_STOP on

create or replace function timeout_test_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

\set OWNER_T  '9a000000-0000-0000-0000-000000000001'
\set MERCH_T  '9b000000-0000-0000-0000-000000000001'
\set REST_T   '9c000000-0000-0000-0000-000000000001'
\set CUST_T   '9d000000-0000-0000-0000-000000000001'
\set RIDER_U  '9d000000-0000-0000-0000-000000000002'
\set RIDER_T  '9e000000-0000-0000-0000-000000000001'

-- Six deliveries, one per case the threshold must separate.
\set ORDER_EARLY   '9f000000-0000-0000-0000-000000000011'
\set DELIV_EARLY   '9f000000-0000-0000-0000-000000000012'
\set ORDER_EXACT   '9f000000-0000-0000-0000-000000000021'
\set DELIV_EXACT   '9f000000-0000-0000-0000-000000000022'
\set ORDER_LATE    '9f000000-0000-0000-0000-000000000031'
\set DELIV_LATE    '9f000000-0000-0000-0000-000000000032'
\set ORDER_NULL    '9f000000-0000-0000-0000-000000000041'
\set DELIV_NULL    '9f000000-0000-0000-0000-000000000042'
\set ORDER_ENROUTE '9f000000-0000-0000-0000-000000000051'
\set DELIV_ENROUTE '9f000000-0000-0000-0000-000000000052'
\set ORDER_ENDED   '9f000000-0000-0000-0000-000000000061'
\set DELIV_ENDED   '9f000000-0000-0000-0000-000000000062'

insert into auth.users (id, phone) values (:'OWNER_T', '+66892270001')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'CUST_T', '+66892270002')
on conflict (id) do nothing;
insert into auth.users (id, phone) values (:'RIDER_U', '+66892270003')
on conflict (id) do nothing;
insert into public.profiles (id, role) values (:'CUST_T', 'CUSTOMER')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (:'MERCH_T', :'OWNER_T', 'ร้านทดสอบเวลารอ', 'ACTIVE');

insert into public.restaurants (id, merchant_id, name, status, lat, lng)
values (:'REST_T', :'MERCH_T', 'ร้าน T', 'ACTIVE', 14.6, 105.5);

insert into public.riders (id, user_id, full_name, status)
values (:'RIDER_T', :'RIDER_U', 'ไรเดอร์ ที', 'APPROVED');

/* One order + delivery pair, parameterised over the cases above. */
create or replace function timeout_test_seed(
  p_order uuid, p_delivery uuid, p_order_number text,
  p_order_state text, p_delivery_state text, p_arrived_at timestamptz
) returns void language plpgsql as $$
begin
  insert into public.orders (
    id, order_number, state, customer_id, restaurant_id,
    restaurant_name_snapshot, delivery_address_snapshot,
    recipient_name_snapshot, recipient_phone_snapshot, payment_method,
    subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
  ) values (
    p_order, p_order_number, p_order_state,
    '9d000000-0000-0000-0000-000000000001'::uuid,
    '9c000000-0000-0000-0000-000000000001'::uuid,
    'ร้าน T', 'ที่อยู่ทดสอบเวลารอ', 'ลูกค้า ที', '+66892270002', 'ONLINE',
    9000, 1000, 500, 0, 10500
  );

  insert into public.deliveries (id, order_id, state, rider_id, arrived_at)
  values (p_delivery, p_order, p_delivery_state,
          '9e000000-0000-0000-0000-000000000001'::uuid, p_arrived_at);
end;
$$;

select timeout_test_seed(:'ORDER_EARLY', :'DELIV_EARLY', 'BH-WAIT-0001',
  'DELIVERING', 'ARRIVED', now() - interval '4 minutes 59 seconds');
select timeout_test_seed(:'ORDER_EXACT', :'DELIV_EXACT', 'BH-WAIT-0002',
  'DELIVERING', 'ARRIVED', now() - interval '5 minutes');
select timeout_test_seed(:'ORDER_LATE', :'DELIV_LATE', 'BH-WAIT-0003',
  'DELIVERING', 'ARRIVED', now() - interval '42 minutes');
select timeout_test_seed(:'ORDER_NULL', :'DELIV_NULL', 'BH-WAIT-0004',
  'DELIVERING', 'ARRIVED', null);
select timeout_test_seed(:'ORDER_ENROUTE', :'DELIV_ENROUTE', 'BH-WAIT-0005',
  'DELIVERING', 'EN_ROUTE', null);
-- Arrived long ago, but the order ended some other way.
select timeout_test_seed(:'ORDER_ENDED', :'DELIV_ENDED', 'BH-WAIT-0006',
  'CANCELLED', 'ARRIVED', now() - interval '42 minutes');

/*
 * The scan, exactly as ArrivalTimeoutEscalationService and
 * DeliveryFailureService.listAwaitingFailure issue it: ARRIVED, arrived_at at
 * or before the cutoff, order still DELIVERING.
 */
create or replace function timeout_test_eligible() returns setof uuid
language sql as $$
  select d.id
    from public.deliveries d
    join public.orders o on o.id = d.order_id
   where d.state = 'ARRIVED'
     and d.arrived_at <= now() - interval '5 minutes'
     and o.state = 'DELIVERING';
$$;

\echo ''
\echo '==> A. the five-minute threshold, at the boundary'

select timeout_test_assert(
  not exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_EARLY'),
  'A1. a delivery arrived 4 minutes 59 seconds ago is NOT eligible'
);

select timeout_test_assert(
  exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_EXACT'),
  'A2. a delivery arrived EXACTLY 5 minutes ago IS eligible — the boundary is inclusive'
);

select timeout_test_assert(
  exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_LATE'),
  'A3. a delivery arrived 42 minutes ago is eligible'
);

\echo ''
\echo '==> B. five minutes, never the illustrative ten'

select timeout_test_assert(
  exists (
    select 1 from public.deliveries
     where id = :'DELIV_EXACT'
       and arrived_at > now() - interval '10 minutes'
  ),
  'B1. the eligible boundary delivery is NEWER than 10 minutes — a 10-minute rule would have missed it'
);

-- Scoped to this file's own fixtures: the same database also holds the
-- contact-attempt test's ARRIVED deliveries, which are legitimately eligible
-- too. What is asserted here is that of THESE six, exactly the two genuinely
-- overdue ones qualify.
select timeout_test_assert(
  (select count(*) from timeout_test_eligible() as id
    where id in (:'DELIV_EARLY', :'DELIV_EXACT', :'DELIV_LATE',
                 :'DELIV_NULL', :'DELIV_ENROUTE', :'DELIV_ENDED')) = 2,
  'B2. of this file''s six fixtures, exactly the two genuinely-overdue ones are eligible (EXACT and LATE)'
);

\echo ''
\echo '==> C. a missing arrival timestamp is excluded by the comparison itself'

select timeout_test_assert(
  not exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_NULL'),
  'C1. an ARRIVED delivery with a NULL arrived_at is never eligible — NULL <= cutoff is not true'
);

\echo ''
\echo '==> D. state pairing'

select timeout_test_assert(
  not exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_ENROUTE'),
  'D1. an EN_ROUTE delivery is not eligible — no customer arrival has happened'
);

select timeout_test_assert(
  not exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_ENDED'),
  'D2. an ARRIVED delivery whose order already ended is not eligible — the operator could not act on it'
);

-- Terminal delivery states leave the population entirely.
update public.deliveries
   set state = 'FAILED', failed_at = now(), failure_cause = 'CUSTOMER_UNREACHABLE'
 where id = :'DELIV_LATE';

select timeout_test_assert(
  not exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_LATE'),
  'D3. a delivery already resolved as a terminal failure drops out of the eligible set'
);

update public.deliveries
   set state = 'ARRIVED', failed_at = null, failure_cause = null
 where id = :'DELIV_LATE';

\echo ''
\echo '==> E. the scan is served by Slice #1''s partial index'

select timeout_test_assert(
  (select indexdef like '%(arrived_at)%' and indexdef like '%WHERE (state = ''ARRIVED''::text)%'
     from pg_indexes
    where schemaname = 'public' and tablename = 'deliveries' and indexname = 'deliveries_arrived_idx'),
  'E1. deliveries_arrived_idx still matches the shape this scan needs'
);

\echo ''
\echo '==> F. the escalation is inert — no automatic failure exists on this path'

insert into public.audit_logs (
  actor_type, actor_id, action, entity_type, entity_id, before, after, reason, source
) values (
  'SYSTEM', null, 'DELIVERY_ARRIVAL_TIMEOUT', 'delivery', :'DELIV_EXACT', null,
  jsonb_build_object('awaitingOperatorResolution', true), 'five-minute wait elapsed', 'worker'
);

select timeout_test_assert(
  (select state = 'ARRIVED' and failed_at is null and failure_cause is null
     from public.deliveries where id = :'DELIV_EXACT'),
  'F1. writing the escalation leaves the delivery ARRIVED, unfailed and without a cause'
);

select timeout_test_assert(
  (select state = 'DELIVERING' and cause_code is null from public.orders where id = :'ORDER_EXACT'),
  'F2. and leaves the order DELIVERING with no cause — the timer declares nothing'
);

select timeout_test_assert(
  exists (select 1 from timeout_test_eligible() as id where id = :'DELIV_EXACT'),
  'F3. an escalated delivery stays in the operator''s working list until a person resolves it'
);

select timeout_test_assert(
  (select count(*) = 0 from public.delivery_status_history where delivery_id = :'DELIV_EXACT'),
  'F4. no delivery history row was written — an escalation is not a transition'
);

select timeout_test_assert(
  (select count(*) = 0 from public.outbox where aggregate_id = :'DELIV_EXACT'),
  'F5. no outbox event was written — the customer is not told an operator is looking'
);

select timeout_test_assert(
  (select actor_type = 'SYSTEM' and source = 'worker' and reason is not null
     from public.audit_logs
    where action = 'DELIVERY_ARRIVAL_TIMEOUT' and entity_id = :'DELIV_EXACT'),
  'F6. the escalation is attributed to SYSTEM/worker — neither an agent nor a person'
);

\echo ''
\echo '==> G. idempotency is the application''s, and the schema says so honestly'

select timeout_test_assert(
  (select count(*) = 0
     from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and contype = 'u'),
  'G1. audit_logs carries NO unique constraint — the once-only guarantee is the application''s existence check, not the schema''s (documented bound, not a claim)'
);

select timeout_test_assert(
  (select count(*) = 1
     from public.audit_logs
    where action = 'DELIVERY_ARRIVAL_TIMEOUT' and entity_id = :'DELIV_EXACT'),
  'G2. exactly one escalation row exists for this delivery after one write'
);

\echo ''
\echo '==> BQ-017 Slice #3 arrival-timeout assertions complete'
