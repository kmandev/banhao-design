-- BANHAO — HIGH-1 fix: rider column exposure (Architect Review, Step 7.2)
--
-- Closes DBQ-015 / docs/DATABASE_MIGRATION_V1_REPORT.md § 7's "known
-- simplification": 20260811000011_rls_policies.sql correctly scoped rider
-- SELECT access to orders/order_items/order_item_options at the ROW level
-- (is_assigned_order_rider — proven by execution, F5 in
-- domain_invariants_test.sql) but granted the RIDER the FULL ROW once
-- assigned, including every money column and the customer/restaurant FK
-- columns. This migration does not touch that row-level boundary at all —
-- it removes the full-row grant and replaces it with three column-scoped
-- views.
--
-- WHY A VIEW, NOT A NARROWER GRANT: column-level GRANT is per database
-- ROLE, and `authenticated` is the one shared role for every client actor
-- (customer, merchant, rider) — see docs/DATABASE_DESIGN.md § 4.2/DEC-033.
-- There is no way to give a rider a different column set than a customer on
-- the SAME table via GRANT alone. A view with its own fixed column list is
-- the only structural way to do this without duplicating the `authenticated`
-- role.
--
-- WHY THESE VIEWS ARE SAFE AGAINST DIRECT CLIENT SQL (not merely "the app
-- won't ask for the hidden columns"):
--
--   1. The rider's own SELECT policy is DROPPED from orders/order_items/
--      order_item_options below. A rider querying those base tables
--      directly — via PostgREST, psql, or any other client — now matches
--      ZERO policies and gets ZERO rows. There is no direct path to the
--      base table left for a rider at all, full-row or otherwise. Customer
--      and merchant policies are untouched — their access is unchanged.
--   2. The three replacement views are created WITHOUT `security_invoker`
--      (i.e. the pre-PG15 default, `security_invoker = false`, made
--      explicit below). A view without security_invoker runs with its
--      OWNER's privileges — the migration role, which owns every table in
--      this schema and is therefore exempt from RLS on it (Postgres never
--      applies RLS to a table's owner unless FORCE ROW LEVEL SECURITY is
--      set, which nothing in this schema does). The view's own `where`
--      clause — the same `is_assigned_order_rider()` used by the row-level
--      policy that was proven by execution — is what does the row scoping
--      instead of RLS. Row scoping is still enforced; it just moved from a
--      policy to a view predicate, and the predicate calls the identical
--      SECURITY DEFINER function.
--   3. The COLUMN list a client can retrieve is fixed by the view
--      definition, not by anything the client sends. `select * from
--      rider_order_view` cannot return `grand_total_satang` — that column
--      was never projected into the view, so it does not exist as far as
--      any query against the view is concerned. There is no client-supplied
--      input that can widen it.
--
-- This is a refinement of DBQ-015's own recommendation
-- (docs/OPEN_DATABASE_QUESTIONS.md), corrected on one point: DBQ-015
-- suggested `security_invoker = true`. That would NOT work once the
-- underlying rider policy is removed (an invoker-security view still runs
-- RLS as the querying role, so a rider would see zero rows through it,
-- same as querying the base table) — the two changes have to be made
-- together, which is what this migration does.
--
-- Reviewed per the Architect Review, Step 7.2, HIGH-1. Does not touch
-- customer or merchant access, does not add a business rule, does not
-- change orders/order_items/order_item_options themselves.

-- ---------------------------------------------------------------------------
-- 1. Remove the full-row rider policies. Customer and merchant policies on
--    these three tables are untouched — this is the only change to RLS.
-- ---------------------------------------------------------------------------

drop policy if exists orders_select_rider on public.orders;
drop policy if exists order_items_select_rider on public.order_items;
drop policy if exists order_item_options_select_rider on public.order_item_options;

-- ---------------------------------------------------------------------------
-- 2. rider_order_view
--
-- WHAT A RIDER CAN SELECT: order identity and lifecycle state, the pickup
-- restaurant's id (restaurants is already public for ACTIVE restaurants —
-- this is a join key, not new exposure), the delivery-address snapshot
-- (address text/lat/lng/landmark), the recipient's name and phone (needed
-- to contact the customer for handover), distance/ETA, and the order's
-- lifecycle timestamps.
--
-- WHAT A RIDER CANNOT SELECT: customer_id, address_id, payment_method,
-- every money column (subtotal/delivery_fee/service_fee/discount/
-- grand_total/currency), and cause_code. None of these are needed to
-- perform a delivery — Phase 1 is online-payment-only (DEC-016), so a rider
-- never collects money and has no operational need for the order's price
-- breakdown.
-- ---------------------------------------------------------------------------

create view public.rider_order_view
with (security_invoker = false)
as
select
  o.id,
  o.order_number,
  o.state,
  o.restaurant_id,
  o.restaurant_name_snapshot,
  o.delivery_address_snapshot,
  o.delivery_lat,
  o.delivery_lng,
  o.delivery_landmark,
  o.recipient_name_snapshot,
  o.recipient_phone_snapshot,
  o.distance_m,
  o.quoted_eta_minutes,
  o.placed_at,
  o.accepted_at,
  o.ready_at,
  o.picked_up_at,
  o.delivered_at,
  o.cancelled_at,
  o.created_at,
  o.updated_at
from public.orders o
where public.is_assigned_order_rider(o.id);

comment on view public.rider_order_view is
  'HIGH-1 fix (Architect Review, Step 7.2). The rider''s ONLY read path to an order once assigned — orders_select_rider no longer exists. Column list is deliberately minimal: no money column, no payment_method, no customer_id/address_id. Row scope is public.is_assigned_order_rider(), the same function the dropped policy used, evaluated by the view (owned by the migration role, so it bypasses orders'' RLS) rather than by a policy. See the file header for why this is safe against direct client SQL.';

revoke all on public.rider_order_view from public, anon, authenticated;
grant select on public.rider_order_view to authenticated;

-- ---------------------------------------------------------------------------
-- 3. rider_order_item_view
--
-- WHAT A RIDER CAN SELECT: the item name and quantity, and any free-text
-- note — what a rider needs to verify the bag at pickup matches the order.
--
-- WHAT A RIDER CANNOT SELECT: unit_price_satang, line_total_satang,
-- menu_item_id. Price has no delivery purpose; menu_item_id is an internal
-- catalogue link with no rider-facing use.
-- ---------------------------------------------------------------------------

create view public.rider_order_item_view
with (security_invoker = false)
as
select
  oi.id,
  oi.order_id,
  oi.item_name_snapshot,
  oi.quantity,
  oi.note,
  oi.created_at
from public.order_items oi
where public.is_assigned_order_rider(oi.order_id);

comment on view public.rider_order_item_view is
  'HIGH-1 fix (Architect Review, Step 7.2). Rider read path for order lines — order_items_select_rider no longer exists. No price column is projected: a rider never needs a line''s unit_price_satang/line_total_satang to perform delivery.';

revoke all on public.rider_order_item_view from public, anon, authenticated;
grant select on public.rider_order_item_view to authenticated;

-- ---------------------------------------------------------------------------
-- 4. rider_order_item_option_view
--
-- WHAT A RIDER CAN SELECT: the option group/name text (e.g. "spice level:
-- hot") — the same pickup-verification purpose as the item view.
--
-- WHAT A RIDER CANNOT SELECT: price_delta_satang, menu_option_id.
-- ---------------------------------------------------------------------------

create view public.rider_order_item_option_view
with (security_invoker = false)
as
select
  oo.id,
  oo.order_item_id,
  oo.group_name_snapshot,
  oo.option_name_snapshot,
  oo.created_at
from public.order_item_options oo
where exists (
  select 1 from public.order_items oi
  where oi.id = oo.order_item_id
    and public.is_assigned_order_rider(oi.order_id)
);

comment on view public.rider_order_item_option_view is
  'HIGH-1 fix (Architect Review, Step 7.2). Rider read path for selected options — order_item_options_select_rider no longer exists. No price_delta_satang projected, same reasoning as rider_order_item_view.';

revoke all on public.rider_order_item_option_view from public, anon, authenticated;
grant select on public.rider_order_item_option_view to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tables reviewed and deliberately left unchanged (HIGH-1 scope)
--
-- deliveries        — full-row rider access (deliveries_select_rider) is
--                      unchanged. Its columns are the delivery's own
--                      operational data (state, pickup/dropoff coordinates,
--                      the RIDER'S OWN rider_earning_satang, proof photo,
--                      failure cause) — nothing here is another party's
--                      financial detail. rider_earning_satang is what the
--                      rider is paid, not the order's price breakdown.
-- restaurants        — already public to anon for ACTIVE restaurants
--                      (restaurants_select_active). A rider sees exactly
--                      what any unauthenticated menu browser already sees.
-- addresses          — riders already have NO policy on this table (§18:
--                      "via API"). The dropoff address a rider needs is the
--                      order's own snapshot columns, now served by
--                      rider_order_view above — addresses itself was never
--                      the exposure path.
-- ---------------------------------------------------------------------------
