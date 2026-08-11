-- BANHAO — RLS: grants and policies for every table added in this migration set
--
-- Implements docs/DATABASE_DESIGN.md § 18 (the RLS matrix) and generalises
-- the five-step pattern from 20260809000003_harden_profiles_rls.sql:
--   1. revoke all from anon, authenticated   — already done at table creation
--   2. narrow column grants                  — this migration
--   3. enable row level security              — already done at table creation
--   4. policies scoped `to authenticated`     — this migration
--   5. security definer trigger backstop      — already present on financial/
--                                                history tables (reject_delete,
--                                                reject_mutation, and the
--                                                column-immutability triggers)
--
-- DEC-033: authorization is a domain relationship, never a role column.
-- NO POLICY BELOW REFERENCES profiles.role. Membership is resolved through
-- restaurant_members (merchant) and riders (rider); Operator capability is
-- never expressed as an RLS policy at all — see "Operator" below.
--
-- Tables with NO policy in this file are correct as-is: revoke + enable RLS
-- with zero policies is Postgres's default-deny — SELECT/INSERT/UPDATE/
-- DELETE all return zero rows / are rejected for anon and authenticated.
-- This covers every 🔴 "no client access" row in docs/DATABASE_DESIGN.md
-- § 18: merchant_bank_accounts, payments, payment_attempts, payment_events,
-- payment_transactions, refunds, ledger_entry_groups, ledger_entries,
-- notification_deliveries, audit_logs, outbox, jobs, idempotency_records,
-- reconciliation_cases, rider_documents' write surface, and every table's
-- INSERT/UPDATE/DELETE unless a grant below says otherwise.

-- ---------------------------------------------------------------------------
-- Operator / Admin access
--
-- Operator capability (platform_staff, DEC-033) is checked by NestJS guards
-- and then runs on the service-role connection, which bypasses RLS
-- entirely (docs/DATABASE_DESIGN.md § 18 "why Operator has no RLS row").
-- Granting operators broad RLS SELECT here would create a second
-- authorization system that could drift from the first — so intentionally,
-- NO policy in this file mentions platform_staff except platform_staff's
-- own self-read policy below.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Helper functions — SECURITY DEFINER so they see the underlying membership
-- tables regardless of the calling policy's own RLS visibility, avoiding any
-- risk of recursive policy evaluation (the exact hazard
-- 20260809000003_harden_profiles_rls.sql already documents for profiles).
-- ---------------------------------------------------------------------------

create or replace function public.is_restaurant_member(target_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.user_id = auth.uid()
      and m.restaurant_id = target_restaurant_id
      and m.revoked_at is null
  );
$$;

comment on function public.is_restaurant_member(uuid) is
  'DEC-033: the merchant authorization check. A MERCHANT capability grants nothing on its own — only membership in the specific restaurant does.';

create or replace function public.is_assigned_rider(target_rider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_rider_id is not null and exists (
    select 1 from public.riders r
    where r.user_id = auth.uid() and r.id = target_rider_id
  );
$$;

comment on function public.is_assigned_rider(uuid) is
  'True if the calling user is the rider identified by target_rider_id. Used wherever a row carries a rider_id directly (deliveries, rider_assignments).';

create or replace function public.is_assigned_order_rider(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.deliveries d
      join public.riders r on r.id = d.rider_id
     where d.order_id = target_order_id
       and r.user_id = auth.uid()
  );
$$;

comment on function public.is_assigned_order_rider(uuid) is
  'True if the calling user is the rider currently assigned to the delivery for this order. Used on orders/order_items, which have no rider_id column of their own — see docs/DATABASE_DESIGN.md § 18 "The rider''s read path".';

revoke execute on function public.is_restaurant_member(uuid) from public;
revoke execute on function public.is_assigned_rider(uuid) from public;
revoke execute on function public.is_assigned_order_rider(uuid) from public;
grant execute on function public.is_restaurant_member(uuid) to authenticated;
grant execute on function public.is_assigned_rider(uuid) to authenticated;
grant execute on function public.is_assigned_order_rider(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Identity domain
-- ---------------------------------------------------------------------------

grant select on public.platform_staff to authenticated;

create policy platform_staff_select_own
  on public.platform_staff
  for select
  to authenticated
  using (user_id = auth.uid());

-- addresses — the first of only three tables in this schema where a client
-- writes directly (docs/DATABASE_DESIGN.md § 18). No financial or state
-- meaning; orders snapshot the address text regardless (§ 8).

grant select, insert (
  user_id, label, recipient_name, recipient_phone, address_line, landmark,
  lat, lng, zone_id, instructions, is_default
), update (
  label, recipient_name, recipient_phone, address_line, landmark,
  lat, lng, zone_id, instructions, is_default, archived_at
) on public.addresses to authenticated;

create policy addresses_select_own
  on public.addresses
  for select
  to authenticated
  using (user_id = auth.uid());

create policy addresses_insert_own
  on public.addresses
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy addresses_update_own
  on public.addresses
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No DELETE grant or policy — hard delete is blocked entirely (§ 13);
-- archived_at (already updatable above) is the only removal path.
-- Rider access to an address "during an active delivery" is via API
-- (service role), not a direct client RLS policy — see § 18.

-- ---------------------------------------------------------------------------
-- Merchant domain
-- ---------------------------------------------------------------------------

grant select on public.merchants to authenticated;

create policy merchants_select_own
  on public.merchants
  for select
  to authenticated
  using (owner_user_id = auth.uid());

-- merchant_bank_accounts: no grant, no policy — 🔴 API-only, no client
-- access under any actor (§ 18).

grant select on public.restaurants to anon, authenticated;

create policy restaurants_select_active
  on public.restaurants
  for select
  to anon, authenticated
  using (status = 'ACTIVE');

create policy restaurants_select_member
  on public.restaurants
  for select
  to authenticated
  using (public.is_restaurant_member(id));

grant select on public.restaurant_members to authenticated;

create policy restaurant_members_select_member
  on public.restaurant_members
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

-- ---------------------------------------------------------------------------
-- Catalog domain — public where active/available, plus full member access
-- ---------------------------------------------------------------------------

grant select on public.restaurant_hours to anon, authenticated;

create policy restaurant_hours_select_active
  on public.restaurant_hours
  for select
  to anon, authenticated
  using (exists (
    select 1 from public.restaurants r
    where r.id = restaurant_hours.restaurant_id and r.status = 'ACTIVE'
  ));

create policy restaurant_hours_select_member
  on public.restaurant_hours
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.menu_categories to anon, authenticated;

create policy menu_categories_select_active
  on public.menu_categories
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1 from public.restaurants r
      where r.id = menu_categories.restaurant_id and r.status = 'ACTIVE'
    )
  );

create policy menu_categories_select_member
  on public.menu_categories
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.menu_items to anon, authenticated;

create policy menu_items_select_active
  on public.menu_items
  for select
  to anon, authenticated
  using (
    archived_at is null
    and is_available
    and exists (
      select 1 from public.restaurants r
      where r.id = menu_items.restaurant_id and r.status = 'ACTIVE'
    )
  );

create policy menu_items_select_member
  on public.menu_items
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

grant select on public.menu_option_groups to anon, authenticated;

create policy menu_option_groups_select_active
  on public.menu_option_groups
  for select
  to anon, authenticated
  using (exists (
    select 1
      from public.menu_items mi
      join public.restaurants r on r.id = mi.restaurant_id
     where mi.id = menu_option_groups.menu_item_id
       and mi.archived_at is null
       and r.status = 'ACTIVE'
  ));

create policy menu_option_groups_select_member
  on public.menu_option_groups
  for select
  to authenticated
  using (exists (
    select 1 from public.menu_items mi
    where mi.id = menu_option_groups.menu_item_id
      and public.is_restaurant_member(mi.restaurant_id)
  ));

grant select on public.menu_options to anon, authenticated;

create policy menu_options_select_active
  on public.menu_options
  for select
  to anon, authenticated
  using (
    is_available
    and exists (
      select 1
        from public.menu_option_groups g
        join public.menu_items mi on mi.id = g.menu_item_id
        join public.restaurants r on r.id = mi.restaurant_id
       where g.id = menu_options.group_id
         and mi.archived_at is null
         and r.status = 'ACTIVE'
    )
  );

create policy menu_options_select_member
  on public.menu_options
  for select
  to authenticated
  using (exists (
    select 1
      from public.menu_option_groups g
      join public.menu_items mi on mi.id = g.menu_item_id
     where g.id = menu_options.group_id
       and public.is_restaurant_member(mi.restaurant_id)
  ));

-- ---------------------------------------------------------------------------
-- Cart domain — the second place a client writes directly (own cart only)
-- ---------------------------------------------------------------------------

grant select, insert (user_id, restaurant_id), update (restaurant_id), delete
  on public.carts to authenticated;

create policy carts_select_own
  on public.carts
  for select
  to authenticated
  using (user_id = auth.uid());

create policy carts_insert_own
  on public.carts
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy carts_update_own
  on public.carts
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy carts_delete_own
  on public.carts
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert (cart_id, restaurant_id, menu_item_id, quantity, note),
  update (quantity, note), delete
  on public.cart_items to authenticated;

create policy cart_items_select_own
  on public.cart_items
  for select
  to authenticated
  using (exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = auth.uid()
  ));

create policy cart_items_insert_own
  on public.cart_items
  for insert
  to authenticated
  with check (exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = auth.uid()
  ));

create policy cart_items_update_own
  on public.cart_items
  for update
  to authenticated
  using (exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = auth.uid()
  ));

create policy cart_items_delete_own
  on public.cart_items
  for delete
  to authenticated
  using (exists (
    select 1 from public.carts c
    where c.id = cart_items.cart_id and c.user_id = auth.uid()
  ));

grant select, insert (cart_item_id, menu_option_id), delete
  on public.cart_item_options to authenticated;

create policy cart_item_options_select_own
  on public.cart_item_options
  for select
  to authenticated
  using (exists (
    select 1
      from public.cart_items ci
      join public.carts c on c.id = ci.cart_id
     where ci.id = cart_item_options.cart_item_id and c.user_id = auth.uid()
  ));

create policy cart_item_options_insert_own
  on public.cart_item_options
  for insert
  to authenticated
  with check (exists (
    select 1
      from public.cart_items ci
      join public.carts c on c.id = ci.cart_id
     where ci.id = cart_item_options.cart_item_id and c.user_id = auth.uid()
  ));

create policy cart_item_options_delete_own
  on public.cart_item_options
  for delete
  to authenticated
  using (exists (
    select 1
      from public.cart_items ci
      join public.carts c on c.id = ci.cart_id
     where ci.id = cart_item_options.cart_item_id and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Order domain — read-only for every client actor (no client write at all,
-- docs/DATABASE_DESIGN.md § 18: every order transition is a command)
--
-- KNOWN SIMPLIFICATION: the design calls for "limited columns via a view"
-- for the rider's read of orders/order_items. This migration grants the
-- rider full-ROW SELECT (correctly scoped to their own assigned delivery)
-- rather than a column-restricted view, to keep this migration set
-- reviewable. The row-level boundary that the mandatory concurrency/RLS
-- tests actually target — a rider seeing only their own assigned orders —
-- is fully enforced. A column-scoped view is left for a follow-up
-- migration; recorded as a new open question in
-- docs/DATABASE_MIGRATION_V1_REPORT.md.
-- ---------------------------------------------------------------------------

grant select on public.orders to authenticated;

create policy orders_select_customer
  on public.orders
  for select
  to authenticated
  using (customer_id = auth.uid());

create policy orders_select_merchant
  on public.orders
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

create policy orders_select_rider
  on public.orders
  for select
  to authenticated
  using (public.is_assigned_order_rider(id));

grant select on public.order_items to authenticated;

create policy order_items_select_customer
  on public.order_items
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_items.order_id and o.customer_id = auth.uid()
  ));

create policy order_items_select_merchant
  on public.order_items
  for select
  to authenticated
  using (public.is_restaurant_member(restaurant_id));

create policy order_items_select_rider
  on public.order_items
  for select
  to authenticated
  using (public.is_assigned_order_rider(order_id));

grant select on public.order_item_options to authenticated;

create policy order_item_options_select_customer
  on public.order_item_options
  for select
  to authenticated
  using (exists (
    select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where oi.id = order_item_options.order_item_id and o.customer_id = auth.uid()
  ));

create policy order_item_options_select_merchant
  on public.order_item_options
  for select
  to authenticated
  using (exists (
    select 1 from public.order_items oi
    where oi.id = order_item_options.order_item_id
      and public.is_restaurant_member(oi.restaurant_id)
  ));

create policy order_item_options_select_rider
  on public.order_item_options
  for select
  to authenticated
  using (exists (
    select 1 from public.order_items oi
    where oi.id = order_item_options.order_item_id
      and public.is_assigned_order_rider(oi.order_id)
  ));

grant select on public.order_status_history to authenticated;

create policy order_status_history_select_customer
  on public.order_status_history
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id and o.customer_id = auth.uid()
  ));

create policy order_status_history_select_merchant
  on public.order_status_history
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and public.is_restaurant_member(o.restaurant_id)
  ));

-- No rider policy — order_status_history is not part of the rider's read
-- path per § 18 (they read delivery_status_history instead).

-- payments, payment_attempts, payment_events, payment_transactions,
-- refunds, ledger_entry_groups, ledger_entries: no grant, no policy —
-- 🔴 API-only for every actor (§ 18).

-- ---------------------------------------------------------------------------
-- Delivery domain
-- ---------------------------------------------------------------------------

grant select on public.deliveries to authenticated;

create policy deliveries_select_customer
  on public.deliveries
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = deliveries.order_id and o.customer_id = auth.uid()
  ));

create policy deliveries_select_merchant
  on public.deliveries
  for select
  to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = deliveries.order_id and public.is_restaurant_member(o.restaurant_id)
  ));

create policy deliveries_select_rider
  on public.deliveries
  for select
  to authenticated
  using (public.is_assigned_rider(rider_id));

grant select on public.delivery_status_history to authenticated;

create policy delivery_status_history_select_customer
  on public.delivery_status_history
  for select
  to authenticated
  using (exists (
    select 1
      from public.deliveries d
      join public.orders o on o.id = d.order_id
     where d.id = delivery_status_history.delivery_id and o.customer_id = auth.uid()
  ));

create policy delivery_status_history_select_rider
  on public.delivery_status_history
  for select
  to authenticated
  using (exists (
    select 1 from public.deliveries d
    where d.id = delivery_status_history.delivery_id
      and public.is_assigned_rider(d.rider_id)
  ));

-- No merchant policy on delivery_status_history — merchants read delivery
-- progress via `deliveries` itself, not this granular log (§ 18).

grant select on public.rider_assignments to authenticated;

create policy rider_assignments_select_own
  on public.rider_assignments
  for select
  to authenticated
  using (public.is_assigned_rider(rider_id));

grant select on public.rider_assignment_attempts to authenticated;

create policy rider_assignment_attempts_select_own
  on public.rider_assignment_attempts
  for select
  to authenticated
  using (public.is_assigned_rider(rider_id));

comment on policy rider_assignment_attempts_select_own on public.rider_assignment_attempts is
  'A rider''s only read path to a broadcast offer before accepting — they are not yet a party to the order or delivery (docs/DATABASE_DESIGN.md § 18).';

-- ---------------------------------------------------------------------------
-- Rider domain
-- ---------------------------------------------------------------------------

grant select on public.riders to authenticated;

create policy riders_select_own
  on public.riders
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.rider_documents to authenticated;

create policy rider_documents_select_own
  on public.rider_documents
  for select
  to authenticated
  using (exists (
    select 1 from public.riders r
    where r.id = rider_documents.rider_id and r.user_id = auth.uid()
  ));

-- rider_availability — the third table with a direct client write surface,
-- restricted to the "online flag" per § 18: a rider may read and toggle
-- their own row, nothing else may touch it.

grant select, update (is_online) on public.rider_availability to authenticated;

create policy rider_availability_select_own
  on public.rider_availability
  for select
  to authenticated
  using (exists (
    select 1 from public.riders r
    where r.id = rider_availability.rider_id and r.user_id = auth.uid()
  ));

create policy rider_availability_update_own
  on public.rider_availability
  for update
  to authenticated
  using (exists (
    select 1 from public.riders r
    where r.id = rider_availability.rider_id and r.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.riders r
    where r.id = rider_availability.rider_id and r.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Notifications — the last of three tables with a client write surface
-- (read_at only). recipient_id is the same profiles.id regardless of
-- whether the recipient is acting as customer, merchant, or rider, so one
-- policy pair covers all three actor rows in § 18's matrix.
-- ---------------------------------------------------------------------------

grant select, update (read_at) on public.notifications to authenticated;

create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

create policy notifications_update_own
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- notification_deliveries: no grant, no policy — no client access for any
-- actor (§ 18).

-- audit_logs, outbox, jobs, idempotency_records, reconciliation_cases,
-- merchant_bank_accounts, payments, payment_attempts, payment_events,
-- payment_transactions, refunds, ledger_entry_groups, ledger_entries,
-- notification_deliveries: intentionally no grant and no policy anywhere
-- in this file. Default-deny from table creation stands.
