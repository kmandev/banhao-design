-- BANHAO — M-13: merchant availability mode (Normal / Busy / Paused)
--
-- 1. WHY. Today a merchant has one lever between "fine" and "closed":
--    restaurants.status. M-13 (docs/design/BANHAO MERCHANT - NORMAL BUSY
--    PAUSE - AVAILABILITY FLOW.dc.html) adds two more positions — Busy
--    (open, accepting, slower — a higher preparation estimate) and Paused
--    (open, but not accepting new orders) — that must never be confused
--    with restaurant lifecycle status. This migration is the AV-Q04/AV-Q03
--    decision lock's approved storage: one additive operational-availability
--    field, never restaurants.status, never temporarily_closed_until.
--
-- 2. WHAT THIS IS NOT.
--    * NOT restaurants.status. That CHECK (DRAFT/PENDING_APPROVAL/ACTIVE/
--      SUSPENDED/CLOSED) is untouched by this migration. A Busy or Paused
--      restaurant keeps status = ACTIVE — using SUSPENDED or CLOSED would
--      both conflate an operational mode with a lifecycle/administrative
--      state AND drop the restaurant out of restaurants_select_active
--      (20260811000011_rls_policies.sql), which filters on status = ACTIVE.
--      A Busy restaurant that vanished from the public catalog would be the
--      exact inverse of what Busy means.
--    * NOT temporarily_closed_until / temporary_close_reason. Those columns
--      exist (20260811000002_merchant_domain.sql) and already have a live
--      customer-facing reader (apps/customer/src/lib/openingHours.ts), but
--      their semantic belongs to BQ-007 (temporary closure, holidays, order
--      cutoff), which is OPEN. A merchant pause here never writes them.
--    * NOT restaurants.avg_prep_minutes. That is restaurant-level catalogue
--      data — the Normal estimate — and AV-D01 records, as a design decision,
--      that Busy must never be implemented by overwriting it.
--
-- 3. availability_mode. NORMAL is the default and is already what every
--    existing restaurant represents (status = ACTIVE, no closure) — no
--    backfill is required or performed; the column default handles every
--    existing row. BUSY and PAUSED are new.
--
-- 4. busy_prep_minutes. The five values a merchant may choose while Busy are
--    the same five M-05 already offers for the per-order accept flow
--    (10/20/30/45/60 นาที — apps/merchant/src/components/AcceptConfirmDialog.tsx
--    PREP_MINUTE_PRESETS), matching the M-13 design package's own
--    prepOptions array and its explicit "Same set, same nothing-preselected
--    rule." Unlike orders.prep_minutes (20260901000001_orders_prep_minutes.sql),
--    which deliberately constrains only "> 0" because M05-Q-01 leaves the
--    preset list open to change, this decision lock's Product Owner approval
--    is explicit that the busy set is fixed and must be enforced by a
--    database CHECK, not application validation alone.
--
-- 5. THE PAIRING CONSTRAINT. availability_mode and busy_prep_minutes must
--    never disagree: BUSY always carries one of the five values, and NORMAL
--    or PAUSED always carry NULL. Enforced by a table CHECK so this is true
--    of every writer, not just the one API endpoint this phase adds.
--
-- 6. NO NEW TABLE. restaurants already stores operational availability data
--    (temporarily_closed_until, temporary_close_reason) alongside lifecycle
--    status, so these two columns join data of their own kind rather than
--    relocating it. The decision lock's RLS-trap finding (a status-based
--    mode would drop a restaurant out of restaurants_select_active) is what
--    rules out reusing status; it says nothing against reusing restaurants
--    itself, and rider_availability's own separation exists for continuous
--    GPS under its own privacy regime (DBQ-005), which does not apply here.
--
-- 7. NO RLS CHANGE, NO NEW GRANT. `grant select on public.restaurants to
--    anon, authenticated` (20260811000011_rls_policies.sql) is table-level,
--    so both new columns are covered automatically and are public — exactly
--    as intended: mode and busy prep time are customer-facing by design.
--    `authenticated` still holds no UPDATE grant on restaurants at all; the
--    write goes through the NestJS API's service-role client, like every
--    other restaurant write (DEC-APP-008).
--
-- 8. NO availability_set_by. The decision lock explicitly withdrew this
--    field: in M-13 there is exactly one setter (the merchant), audit_logs
--    already records actor_type/actor_id for every change, and BQ-013 (the
--    only feature that would introduce a second setter) is deferred out of
--    this phase entirely. Adding a column whose vocabulary only means
--    something under a deferred feature would be schema coupling to BQ-013.
--
-- 9. create_order() (20260819000001_order_creation_function.sql) is
--    extended in this same migration: PAUSED must refuse new order creation
--    through the same single authority that already refuses non-ACTIVE
--    status, never a second, independent gate. ACTIVE + NORMAL and
--    ACTIVE + BUSY are unaffected — a Busy restaurant is fully orderable.

alter table public.restaurants
  add column availability_mode text not null default 'NORMAL'
    constraint restaurants_availability_mode_check
    check (availability_mode in ('NORMAL', 'BUSY', 'PAUSED')),
  add column busy_prep_minutes integer
    constraint restaurants_busy_prep_minutes_values_check
    check (busy_prep_minutes is null or busy_prep_minutes in (10, 20, 30, 45, 60));

alter table public.restaurants
  add constraint restaurants_availability_mode_pairing_check check (
    (availability_mode = 'BUSY' and busy_prep_minutes is not null)
    or (availability_mode <> 'BUSY' and busy_prep_minutes is null)
  );

comment on column public.restaurants.availability_mode is
  'M-13. Operational availability, separate from restaurants.status — a Busy or Paused restaurant keeps status = ACTIVE. NORMAL: the default, ordinary hours and estimate. BUSY: open and orderable, quoting busy_prep_minutes instead of avg_prep_minutes. PAUSED: open (visible) but not accepting new orders — refused at create_order(), never written to temporarily_closed_until or restaurants.status. Never read after an order is created (orders carry no snapshot of it) — see the create_order() comment in this migration for why none is needed.';

comment on column public.restaurants.busy_prep_minutes is
  'M-13. Required and one of 10/20/30/45/60 while availability_mode = BUSY; NULL otherwise, enforced by restaurants_availability_mode_pairing_check. The same five values M-05''s accept dialog already offers (PREP_MINUTE_PRESETS) — reused deliberately (M-13 design package: "Same set, same nothing-preselected rule"), not to be confused with orders.prep_minutes, which is a separate per-order fact with no such CHECK. Never restaurants.avg_prep_minutes (AV-D01: never overwritten to signal a mode).';

-- ===========================================================================
-- create_order() — extend the single restaurant-availability authority
-- ===========================================================================
--
-- Only the restaurant lookup and its guard change. Every other line is
-- reproduced unchanged from 20260819000001_order_creation_function.sql
-- (create or replace preserves the signature; PL/pgSQL has no ALTER
-- FUNCTION ... ADD CHECK equivalent, so the full body must be restated).
--
-- The existing "is not ACTIVE" raise is left byte-for-byte identical — it is
-- what OrdersService.raiseFromCreateOrderError already matches on to throw
-- RESTAURANT_CLOSED, and orders.service.spec.ts asserts that exact message.
-- The PAUSED case is a second, separate raise with its own message, mapped
-- to the same RESTAURANT_CLOSED code by an additive match in that same
-- mapper (apps/api/src/modules/orders/orders.service.ts) — one authority,
-- one new condition, not a second independent gate.

create or replace function public.create_order(
  p_customer_id uuid,
  p_address_id uuid,
  p_payment_method text,
  p_delivery_fee_satang bigint,
  p_service_fee_satang bigint,
  p_discount_satang bigint default 0,
  p_distance_m int default null,
  p_quoted_eta_minutes int default null,
  p_correlation_id uuid default null
)
returns table (order_id uuid, order_number text, state text)
language plpgsql
set search_path = public
as $$
declare
  v_cart record;
  v_restaurant record;
  v_address record;
  v_business_date date;
  v_seq int;
  v_order_number text;
  v_order_id uuid;
  v_subtotal_satang bigint := 0;
  v_grand_total_satang bigint;
  v_item record;
  v_option_row record;
  v_group record;
  v_unit_price_satang bigint;
  v_line_total_satang bigint;
  v_order_item_id uuid;
  v_unavailable_names text[] := '{}';
  v_item_count int := 0;
begin
  -- SECOND layer only — see the header note above and
  -- release_rider_assignment's identical pattern. The EXECUTE grant below
  -- is the actual boundary.
  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'create_order may only be called by the service role'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = p_customer_id) then
    raise exception 'create_order: customer % does not exist', p_customer_id
      using errcode = 'P0001';
  end if;

  if p_payment_method not in ('ONLINE', 'CASH') then
    raise exception 'create_order: payment_method must be ONLINE or CASH, got %', p_payment_method
      using errcode = '22023';
  end if;

  if p_delivery_fee_satang < 0 or p_service_fee_satang < 0 or p_discount_satang < 0 then
    raise exception 'create_order: fee and discount amounts must not be negative'
      using errcode = '22023';
  end if;

  -- ---------------------------------------------------------------------
  -- Cart — looked up by customer, never by an id the caller supplies
  -- (DEC-E-02 / mirrors CartService.validate). Locked for the duration of
  -- this function so a concurrent cart mutation cannot interleave with
  -- order creation.
  -- ---------------------------------------------------------------------

  select c.id, c.restaurant_id into v_cart
    from public.carts c
   where c.user_id = p_customer_id
     for update;

  if v_cart.id is null then
    raise exception 'create_order: customer % has no open cart', p_customer_id
      using errcode = 'P0001';
  end if;

  select count(*) into v_item_count from public.cart_items where cart_id = v_cart.id;
  if v_item_count = 0 then
    raise exception 'create_order: cart % is empty', v_cart.id
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------
  -- Restaurant — re-verified ACTIVE at creation time, live, not trusted
  -- from any earlier client read (mirrors CartService.validate). M-13 adds
  -- the availability_mode = PAUSED refusal as a second condition in the
  -- same authority — never a second, independent gate.
  -- ---------------------------------------------------------------------

  select r.id, r.name, r.status, r.availability_mode into v_restaurant
    from public.restaurants r
   where r.id = v_cart.restaurant_id;

  if v_restaurant.id is null or v_restaurant.status <> 'ACTIVE' then
    raise exception 'create_order: restaurant % is not ACTIVE', v_cart.restaurant_id
      using errcode = 'P0001';
  end if;

  if v_restaurant.availability_mode = 'PAUSED' then
    raise exception 'create_order: restaurant % is PAUSED and not accepting new orders', v_cart.restaurant_id
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------
  -- Address — DEC-E-04: must be owned by this customer and not archived.
  -- The snapshot columns are copied from this row now, live; a later edit
  -- or archival of the address can never rewrite an existing order.
  -- ---------------------------------------------------------------------

  select a.id, a.recipient_name, a.recipient_phone, a.address_line,
         a.landmark, a.lat, a.lng
    into v_address
    from public.addresses a
   where a.id = p_address_id
     and a.user_id = p_customer_id
     and a.archived_at is null;

  if v_address.id is null then
    raise exception 'create_order: address % is not a usable address for customer %', p_address_id, p_customer_id
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------
  -- Price the cart from the live catalog. Collects every unavailable item
  -- before raising (mirrors CartService.validate's ITEM_UNAVAILABLE, which
  -- names every affected line rather than stopping at the first) — but the
  -- whole order is still all-or-nothing: no order_items are inserted until
  -- every line has passed.
  -- ---------------------------------------------------------------------

  for v_item in
    select ci.id, ci.menu_item_id, ci.restaurant_id, ci.quantity, ci.note
      from public.cart_items ci
     where ci.cart_id = v_cart.id
  loop
    -- Defence in depth only — DEC-017's composite foreign keys already make
    -- this structurally impossible (mirrors CartService.validate's own
    -- MIXED_RESTAURANT defence-in-depth check).
    if v_item.restaurant_id <> v_cart.restaurant_id then
      raise exception 'create_order: cart_item % belongs to restaurant %, cart belongs to %',
        v_item.id, v_item.restaurant_id, v_cart.restaurant_id
        using errcode = 'P0001';
    end if;

    declare
      v_menu_item record;
    begin
      select mi.id, mi.name, mi.base_price_satang, mi.is_available, mi.archived_at
        into v_menu_item
        from public.menu_items mi
       where mi.id = v_item.menu_item_id;

      if v_menu_item.id is null or v_menu_item.archived_at is not null or not v_menu_item.is_available then
        v_unavailable_names := array_append(
          v_unavailable_names,
          coalesce(v_menu_item.name, v_item.menu_item_id::text)
        );
      end if;
    end;
  end loop;

  if array_length(v_unavailable_names, 1) > 0 then
    raise exception 'create_order: unavailable items in cart: %', array_to_string(v_unavailable_names, ', ')
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------
  -- Generate the order number — DEC-E-03. INSERT ... ON CONFLICT DO
  -- UPDATE ... RETURNING is a single atomic statement: the row lock it
  -- takes on the conflicting (business_date) row is what serializes
  -- concurrent callers on the same day, so this is safe under real
  -- concurrency, unlike `SELECT max(...) + 1`.
  -- ---------------------------------------------------------------------

  v_business_date := (now() at time zone 'Asia/Bangkok')::date;

  insert into public.order_number_counters (business_date, next_seq)
  values (v_business_date, 2)
  on conflict (business_date) do update
    set next_seq = order_number_counters.next_seq + 1
  returning next_seq - 1 into v_seq;

  v_order_number := 'BH-' || to_char(v_business_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  -- ---------------------------------------------------------------------
  -- Insert the order. grand_total is computed here, matching
  -- orders_total_check exactly — the check constraint is the enforcement;
  -- this is not a duplicate authority, it just fails with a named
  -- exception before the constraint would, since the loop below still has
  -- to compute the subtotal from cart lines first.
  -- ---------------------------------------------------------------------

  v_order_id := gen_random_uuid();

  -- Compute the subtotal from live prices before insert, since
  -- orders_total_check needs it and order_items don't exist yet.
  select coalesce(sum(
    (mi.base_price_satang + coalesce((
      select sum(mo.price_delta_satang)
        from public.cart_item_options cio
        join public.menu_options mo on mo.id = cio.menu_option_id
       where cio.cart_item_id = ci.id
         and mo.is_available
    ), 0)) * ci.quantity
  ), 0)
    into v_subtotal_satang
    from public.cart_items ci
    join public.menu_items mi on mi.id = ci.menu_item_id
   where ci.cart_id = v_cart.id;

  v_grand_total_satang := v_subtotal_satang + p_delivery_fee_satang + p_service_fee_satang - p_discount_satang;

  insert into public.orders (
    id, order_number, state, customer_id, restaurant_id, address_id,
    restaurant_name_snapshot, delivery_address_snapshot, delivery_lat, delivery_lng,
    delivery_landmark, recipient_name_snapshot, recipient_phone_snapshot,
    payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
    discount_satang, grand_total_satang, distance_m, quoted_eta_minutes
  ) values (
    v_order_id, v_order_number, 'CREATED', p_customer_id, v_cart.restaurant_id, v_address.id,
    v_restaurant.name, v_address.address_line, v_address.lat, v_address.lng,
    v_address.landmark, v_address.recipient_name, v_address.recipient_phone,
    p_payment_method, v_subtotal_satang, p_delivery_fee_satang, p_service_fee_satang,
    p_discount_satang, v_grand_total_satang, p_distance_m, p_quoted_eta_minutes
  );

  -- ---------------------------------------------------------------------
  -- order_items + order_item_options — one row per cart line, priced from
  -- the same live read used to compute the subtotal above.
  -- ---------------------------------------------------------------------

  for v_item in
    select ci.id, ci.menu_item_id, ci.quantity, ci.note,
           mi.name as item_name, mi.base_price_satang
      from public.cart_items ci
      join public.menu_items mi on mi.id = ci.menu_item_id
     where ci.cart_id = v_cart.id
  loop
    v_unit_price_satang := v_item.base_price_satang;
    v_order_item_id := gen_random_uuid();

    for v_option_row in
      select cio.id, cio.menu_option_id, mo.label, mo.price_delta_satang, mo.is_available, mo.group_id
        from public.cart_item_options cio
        join public.menu_options mo on mo.id = cio.menu_option_id
       where cio.cart_item_id = v_item.id
    loop
      if not v_option_row.is_available then
        -- PC-Q-001 parity with CartService.validate: an unavailable option
        -- contributes nothing and is not snapshotted onto the order.
        continue;
      end if;

      select g.id, g.menu_item_id into v_group
        from public.menu_option_groups g
       where g.id = v_option_row.group_id;

      if v_group.id is null or v_group.menu_item_id <> v_item.menu_item_id then
        -- Same integrity fault CartService.validate logs and excludes
        -- rather than aborting on — an orphaned option reference is not
        -- reason enough to fail the whole order.
        raise warning 'create_order: cart_item_option % references menu_option % which does not resolve to a group under menu_item % — excluding it',
          v_option_row.id, v_option_row.menu_option_id, v_item.menu_item_id;
        continue;
      end if;

      v_unit_price_satang := v_unit_price_satang + v_option_row.price_delta_satang;
    end loop;

    v_line_total_satang := v_unit_price_satang * v_item.quantity;

    insert into public.order_items (
      id, order_id, restaurant_id, menu_item_id, item_name_snapshot,
      unit_price_satang, quantity, line_total_satang, note
    ) values (
      v_order_item_id, v_order_id, v_cart.restaurant_id, v_item.menu_item_id, v_item.item_name,
      v_unit_price_satang, v_item.quantity, v_line_total_satang, v_item.note
    );

    for v_option_row in
      select cio.id, cio.menu_option_id, mo.label, mo.price_delta_satang, mo.is_available, mo.group_id
        from public.cart_item_options cio
        join public.menu_options mo on mo.id = cio.menu_option_id
       where cio.cart_item_id = v_item.id
    loop
      if not v_option_row.is_available then
        continue;
      end if;

      select g.id, g.menu_item_id, g.title into v_group
        from public.menu_option_groups g
       where g.id = v_option_row.group_id;

      if v_group.id is null or v_group.menu_item_id <> v_item.menu_item_id then
        continue; -- already warned above
      end if;

      insert into public.order_item_options (
        order_item_id, menu_option_id, group_name_snapshot, option_name_snapshot, price_delta_satang
      ) values (
        v_order_item_id, v_option_row.menu_option_id, v_group.title, v_option_row.label, v_option_row.price_delta_satang
      );
    end loop;
  end loop;

  -- ---------------------------------------------------------------------
  -- order_status_history — the first row. DEC-019: CREATED is "Changed by:
  -- System." REQ-002: the customer-facing timeline is derived from this
  -- table alone.
  -- ---------------------------------------------------------------------

  insert into public.order_status_history (
    order_id, from_state, to_state, actor_type, actor_id, reason, correlation_id
  ) values (
    v_order_id, null, 'CREATED', 'SYSTEM', null, 'Order created from cart', p_correlation_id
  );

  return query select v_order_id, v_order_number, 'CREATED'::text;
end;
$$;

comment on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) is
  'Phase E-1 (DEC-E-02), extended by M-13 (20260904000001) to also refuse availability_mode = PAUSED. The sole sanctioned way to create an order: snapshots cart, restaurant, address and live catalog prices into orders/order_items/order_item_options/order_status_history inside one transaction. SECURITY INVOKER (not DEFINER — see release_rider_assignment for why). Primary protection: the EXECUTE grant below (service_role only). p_delivery_fee_satang/p_service_fee_satang have no default — DEC-E-01 forbids inventing them, so the signature itself makes the function uncallable without an explicit, approved value.';

revoke execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) to service_role;
