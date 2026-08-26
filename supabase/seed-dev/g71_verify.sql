-- ===========================================================================
-- BANHAO — G-7.1 (Driver Offer Inbox) live fixture verification
--
--   READ-ONLY. Every statement in this file is a `select`. No `insert`,
--   `update`, `delete`, or DDL of any kind appears below, or may be added.
--
--   ####  FOR `banhao-dev` (ref yssnwnboiwldogmlvvlw) ONLY.  ####
--
-- Design authority: docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md §6 (verification
-- design) and §7 (locked G-7 fixture protection / Test S). Run this file
-- before AND after `g71_offer_fixture.sql`, and again after each live
-- acceptance scenario, to confirm nothing outside the `67100000-…` namespace
-- moved and the locked G-7 fixture is byte-identical.
--
-- Run with `psql` or the Supabase SQL Editor as the project owner / a role
-- that can read `auth.users` and every table below directly (RLS is not a
-- substitute for this check — it would hide the very rows this file exists
-- to inspect). Test R (foreign-rider RLS isolation) is explicitly OUT OF
-- SCOPE for this file — it must be proven with two real anon-key rider
-- sessions, the same way supabase/tests/live-rls-check.mjs proves the
-- customer app's RLS, because a privileged read here bypasses RLS entirely
-- and would produce a false PASS.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- V0. Confirm target — sanity check this is banhao-dev, not another project.
-- Compare the output against ref `yssnwnboiwldogmlvvlw` (CLAUDE.md §7).
-- ---------------------------------------------------------------------------
select current_database(), current_setting('cluster_name', true);

-- ---------------------------------------------------------------------------
-- V13 (run first, and again last). G-7 LOCKED FIXTURE — before/after
-- snapshot. `updated_at` unchanged across two runs is the positive evidence
-- that nothing touched the row (riders_set_updated_at /
-- rider_availability_set_updated_at fire on any UPDATE).
-- ---------------------------------------------------------------------------
select id, user_id, status, approved_at, approved_by, updated_at
from public.riders
where id = 'a0d763a3-16ca-4b6c-adf0-59ece258587f';

select rider_id, is_online, last_lat, last_lng, location_updated_at,
       active_delivery_count, blocked_reason, updated_at
from public.rider_availability
where rider_id = 'a0d763a3-16ca-4b6c-adf0-59ece258587f';

-- No G-7.1 fixture row may ever reference the locked G-7 rider.
select count(*) as g7_contamination_in_offers
from public.rider_assignment_attempts
where rider_id = 'a0d763a3-16ca-4b6c-adf0-59ece258587f'
  and delivery_id in (
    select id from public.deliveries where id::text like '67100000%'
  );

-- ---------------------------------------------------------------------------
-- V1 / V2 / V3. Rider A APPROVED, Rider B APPROVED, non-approved rider
-- PENDING_APPROVAL. All three must be `67100000-…` ids only.
-- ---------------------------------------------------------------------------
select id, user_id, status, approved_at, approved_by, full_name
from public.riders
where id in (
  '67100000-0000-4000-8000-0000000000a1',
  '67100000-0000-4000-8000-0000000000a2',
  '67100000-0000-4000-8000-0000000000a3'
)
order by id;

-- Expected: exactly two rows (Rider A, Rider B) — the non-approved rider
-- must have none.
select rider_id, is_online, last_lat, last_lng,
       last_lat is not null and last_lng is not null as has_location,
       location_updated_at, active_delivery_count, updated_at
from public.rider_availability
where rider_id in (
  '67100000-0000-4000-8000-0000000000a1',
  '67100000-0000-4000-8000-0000000000a2',
  '67100000-0000-4000-8000-0000000000a3'
)
order by rider_id;

-- V5. Explicit zero-row check for the non-approved rider's availability.
select count(*) as non_approved_rider_availability_rows
from public.rider_availability
where rider_id = '67100000-0000-4000-8000-0000000000a3';

-- ---------------------------------------------------------------------------
-- V7 / V8 / V9. Offer ownership, outcome, and expiry — every `67100000-…`
-- offer must belong to Rider A or Rider B, never the non-approved rider and
-- never the locked G-7 rider.
-- ---------------------------------------------------------------------------
select id, delivery_id, rider_id, round_no, offered_at, expires_at, outcome,
       expires_at > now() as is_live
from public.rider_assignment_attempts
where id::text like '67100000%'
order by offered_at;

select count(*) as offers_owned_by_non_fixture_or_g7_rider
from public.rider_assignment_attempts
where id::text like '67100000%'
  and rider_id not in (
    '67100000-0000-4000-8000-0000000000a1',
    '67100000-0000-4000-8000-0000000000a2'
  );

-- ---------------------------------------------------------------------------
-- V10 / V12. Delivery and order state for the G-7.1 namespace.
-- `rider_earning_satang` must stay NULL (BQ-029 is OPEN — no value invented).
-- ---------------------------------------------------------------------------
select id, order_id, state, rider_id, assigned_at, reassignment_count,
       rider_earning_satang
from public.deliveries
where id::text like '67100000%'
order by created_at;

select id, order_number, state, customer_id, restaurant_id, payment_method,
       subtotal_satang, delivery_fee_satang, service_fee_satang,
       discount_satang, grand_total_satang, currency
from public.orders
where order_number like 'G71-%'
order by placed_at;

-- Fee amounts must be the DEC-035/036 approved values, never the stale
-- SAMPLE_DELIVERY_FEE_SATANG from apps/customer/src/mocks/pricing.ts.
select count(*) as orders_with_wrong_fees
from public.orders
where order_number like 'G71-%'
  and (delivery_fee_satang <> 1000 or service_fee_satang <> 500 or payment_method <> 'ONLINE');

-- ---------------------------------------------------------------------------
-- V11. One-active-assignment invariant intact system-wide — this file must
-- never see more than one ACCEPTED row per delivery, fixture or otherwise.
-- A non-empty result here means the rider-race backstop failed, not
-- something specific to G-7.1.
-- ---------------------------------------------------------------------------
select delivery_id, count(*) as accepted_rows
from public.rider_assignments
where status = 'ACCEPTED'
group by delivery_id
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- V14. No fixture leakage into live dispatch eligibility. The online +
-- APPROVED pool (BroadcastDispatchStrategy's candidate set) must contain
-- exactly the fixture riders intended online, and never the non-approved
-- rider (it has no row here at all if V5 passed, so this is a second,
-- independent check of the same invariant from the dispatch side).
-- ---------------------------------------------------------------------------
select r.id, r.status, a.is_online
from public.riders r
join public.rider_availability a on a.rider_id = r.id
where a.is_online = true
  and r.status = 'APPROVED'
  and r.id::text like '67100000%'
order by r.id;

-- ---------------------------------------------------------------------------
-- Shared restaurant — confirm reused, not duplicated. Expect exactly one
-- row, unchanged from supabase/seed-dev/catalog_dev_seed.sql.
-- ---------------------------------------------------------------------------
select id, name, status, lat, lng
from public.restaurants
where id = 'dede0000-0000-4000-8000-00000000c001';

-- ---------------------------------------------------------------------------
-- Namespace isolation — nothing outside `67100000-…` / `G71-…` was created
-- by this fixture. Compare row counts before and after running
-- g71_offer_fixture.sql; any table other than the six below growing is a
-- sign this fixture (or something else running concurrently) touched
-- unrelated data.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.riders where id::text like '67100000%')                     as g71_riders,
  (select count(*) from public.rider_availability where rider_id::text like '67100000%')    as g71_rider_availability,
  (select count(*) from public.orders where order_number like 'G71-%')                      as g71_orders,
  (select count(*) from public.deliveries where id::text like '67100000%')                  as g71_deliveries,
  (select count(*) from public.rider_assignment_attempts where id::text like '67100000%')   as g71_offers,
  (select count(*) from public.rider_assignments where rider_id::text like '67100000%')     as g71_assignments;
