-- BANHAO — Phase E-1: atomic order creation (database foundation only)
--
-- Implements the mechanism DEC-E-02 named: order creation writes `orders`,
-- `order_items`, `order_item_options` and `order_status_history` inside ONE
-- database transaction, via an additive `SECURITY INVOKER` Postgres function
-- following the `release_rider_assignment` precedent
-- (20260811000013_rider_reassignment_atomicity.sql) exactly.
--
-- This migration adds the function and one small supporting table
-- (`order_number_counters`, for DEC-E-03). It does NOT modify `orders`,
-- `order_items`, `order_item_options`, `order_status_history`, or any RLS
-- policy — every existing constraint, trigger and grant on those four
-- tables is unchanged. The schema is LOCKED; this is purely additive.
--
-- NOT included here, deliberately (Phase E-1 is the database foundation
-- only — see docs/DECISIONS.md DEC-E-05):
--   * `POST /api/v1/orders` and `OrdersService` — the NestJS caller.
--   * Cart clearing after order creation — whether/when the cart empties is
--     an API-layer orchestration decision (e.g. immediately vs. on payment
--     confirmation), not a database atomicity concern this migration needs
--     to settle.
--   * Any status transition beyond the initial `CREATED` row — accept,
--     reject, prepare, ready, cancel etc. are Phase E-2 work.
--   * Rejecting `CASH` as a payment method. The CHECK constraint on
--     `orders.payment_method` still allows it (DEC-016: "rejected at the
--     service boundary, not removed") — that rejection is the future
--     `OrdersService`'s job, not this function's. This function is a
--     structural/atomicity layer, not a business-rule gate.
--
-- ===========================================================================
-- DEC-E-01 — fee values are never invented or defaulted here
-- ===========================================================================
--
-- `orders.delivery_fee_satang` and `orders.service_fee_satang` are `bigint
-- not null` with no application-level default, on purpose: BQ-026 and
-- BQ-027 are OPEN, and `orders_enforce_immutable_columns()` makes every
-- money column permanent — including for `service_role` — with `DELETE`
-- refused outright. There is no repair path for a wrong value.
--
-- `create_order` below has NO DEFAULT for `p_delivery_fee_satang` or
-- `p_service_fee_satang`. Postgres will not resolve a call that omits them
-- (42883, "function does not exist") — the function is structurally
-- uncallable without an explicit value from the caller. This is what
-- "design the function signature so the future implementation can provide
-- explicitly approved values later" (the E-1 task brief) means in practice:
-- the gate is the signature itself, not a runtime check. `p_discount_satang`
-- DOES default to 0 — that mirrors the schema's own
-- `discount_satang bigint not null default 0`, which already treats "no
-- discount" as the neutral value; it is not the same class of invented
-- number as a delivery or service fee.

-- ===========================================================================
-- order_number_counters — DEC-E-03 support table
-- ===========================================================================
--
-- One row per Asia/Bangkok business day. `next_seq` is claimed by a single
-- atomic `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement
-- inside `create_order` — the row-level lock that statement takes on the
-- conflicting row is what makes concurrent callers on the same business day
-- serialize safely, with no `SELECT max(...) + 1` race window.

create table public.order_number_counters (
  business_date date primary key,
  next_seq int not null default 1
);

comment on table public.order_number_counters is
  'DEC-E-03 support: one row per Asia/Bangkok business day, claimed via INSERT ... ON CONFLICT DO UPDATE ... RETURNING inside create_order() for a concurrency-safe BH-YYYYMMDD-NNNN sequence. Never read or written by a client — service_role only, via create_order().';

revoke all on public.order_number_counters from anon, authenticated;
alter table public.order_number_counters enable row level security;
-- Deliberately no policy at all. RLS with zero policies denies every row to
-- every role except one with BYPASSRLS (service_role) — same shape as
-- `orders` itself, and there is no legitimate client read of this table.

-- ===========================================================================
-- create_order — the atomic order-creation entry point
-- ===========================================================================
--
-- SECURITY MODEL — identical reasoning to release_rider_assignment (see that
-- migration's header for the full argument): SECURITY INVOKER, not DEFINER.
--   1. service_role already has bypassrls and direct table grants on every
--      table this function touches, so no owner substitution is needed.
--   2. Under DEFINER, current_user resolves to the function OWNER, which
--      would make the in-body pg_has_role guard below check the wrong
--      identity. Under INVOKER, current_user is genuinely the caller's
--      active role, so the guard means what it says.
-- The PRIMARY protection is the EXECUTE grant at the bottom of this file
-- (service_role only). The in-body check is defence in depth.
--
-- IDENTITY — p_customer_id must be the server-verified JWT subject, resolved
-- by the future OrdersService exactly as CartService.validate already
-- requires for its own userId parameter — never a client-supplied value.
-- There is no cart_id parameter: "the caller's cart" is looked up by
-- user_id, the same one-cart-per-user lookup supabaseCart.ts and
-- CartService already use, so there is no id a caller could supply to reach
-- anyone else's cart even by mistake.
--
-- ATOMICITY — every insert below runs inside this one PL/pgSQL function
-- invocation, which is a single statement from the calling transaction's
-- point of view. Any RAISE EXCEPTION aborts that statement, and Postgres
-- rolls back everything the function did so far as part of unwinding it —
-- there is no window in which an order exists without its items, or items
-- exist without a status history row. This is the same guarantee
-- release_rider_assignment already documents and relies on; nothing new is
-- introduced here.
--
-- PRICE AUTHORITY — the function accepts no price, no subtotal, and no
-- total from the caller. Every money figure except the two fee parameters
-- (delivery/service — see DEC-E-01 above) is read live from menu_items and
-- menu_options inside this function, mirroring CartService.validate's own
-- re-pricing discipline.

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
  -- from any earlier client read (mirrors CartService.validate).
  -- ---------------------------------------------------------------------

  select r.id, r.name, r.status into v_restaurant
    from public.restaurants r
   where r.id = v_cart.restaurant_id;

  if v_restaurant.id is null or v_restaurant.status <> 'ACTIVE' then
    raise exception 'create_order: restaurant % is not ACTIVE', v_cart.restaurant_id
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
  'Phase E-1 (DEC-E-02). The sole sanctioned way to create an order: snapshots cart, restaurant, address and live catalog prices into orders/order_items/order_item_options/order_status_history inside one transaction. SECURITY INVOKER (not DEFINER — see release_rider_assignment for why). Primary protection: the EXECUTE grant below (service_role only). p_delivery_fee_satang/p_service_fee_satang have no default — DEC-E-01 forbids inventing them, so the signature itself makes the function uncallable without an explicit, approved value.';

revoke execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) to service_role;
