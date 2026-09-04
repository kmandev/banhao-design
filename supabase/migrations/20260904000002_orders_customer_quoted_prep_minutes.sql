-- BANHAO — AC-04 / DEC-042: the customer-quoted preparation estimate on
-- public.orders.
--
-- 1. WHY. M-AV (Merchant Availability — NORMAL/BUSY/PAUSED,
--    20260904000001) made the preparation estimate a customer sees before
--    ordering depend on a merchant-controlled mode that can change at any
--    moment. Nothing recorded which estimate was in force when an order was
--    actually placed: the shop screen derives it live
--    (apps/customer/src/lib/catalogDisplay.ts), and the derivation reads
--    columns on `restaurants`, not on the order. A merchant leaving BUSY a
--    second after an order was placed erased, with no trace, the number the
--    customer had relied on when committing money.
--
--    This is the same class of fact `orders` already snapshots eleven times
--    over — the restaurant's name, the address, every line price. As
--    20260811000005_order_domain.sql puts it: "The order stores AMOUNTS,
--    never rates: a rate changing later must not be able to rewrite what
--    the customer was actually charged." A prep estimate read live off a
--    mutable `restaurants` row is that same mistake wearing different
--    clothes. DEC-042 closes it with one additive column.
--
-- 2. WHAT THIS IS NOT. Three neighbouring values exist and this column is
--    none of them. The distinction is the whole point of the decision, so
--    it is written here rather than left to be rediscovered:
--    * NOT `orders.prep_minutes` (20260901000001). That is the MERCHANT's
--      per-order answer, chosen at accept time in M-05. This column is what
--      the PLATFORM told the CUSTOMER, before payment, at creation time.
--      Different actor, different moment, different question — and the two
--      may legitimately differ. Neither defaults from the other, in either
--      direction, and M-05 is unchanged by this migration.
--    * NOT `orders.quoted_eta_minutes` (20260811000005). That is a
--      delivery-ARRIVAL estimate. This is kitchen work only. Prep time plus
--      travel time is not an arrival time, and this column must not enter
--      any delivery-ETA computation unless a later decision says so
--      explicitly. `quoted_eta_minutes` is not repurposed, not written, and
--      not read here.
--    * NOT `restaurants.avg_prep_minutes` / `restaurants.busy_prep_minutes`.
--      Those are the live, mutable catalogue values this column is a
--      point-in-time copy OF. They stay exactly as they are; AV-D01
--      (Busy is never signalled by overwriting avg_prep_minutes) is
--      untouched.
--
-- 3. NULLABLE, NO DEFAULT, NO BACKFILL. Every order that already exists was
--    placed before this question was asked, and no record of what was
--    displayed at that moment survives anywhere — `audit_logs` carries mode
--    changes only from M-AV onward, and `avg_prep_minutes` today is not
--    evidence of `avg_prep_minutes` then. Inventing a value would fabricate
--    a fact about what a customer was told. Historical rows stay NULL,
--    permanently, and every reader must treat NULL as "no estimate was
--    recorded" rather than substituting the restaurant's current one. The
--    same rule 20260901000001 set for `prep_minutes`, for the same reason.
--
--    A live NULL is equally legitimate and equally permanent: a restaurant
--    with no `avg_prep_minutes` shows the customer no estimate (AV-E5), so
--    an order placed there records none.
--
-- 4. THE CHECK IS `> 0` AND NOTHING MORE. While BUSY the value can only be
--    one of M-AV's five (`restaurants_busy_prep_minutes_values_check`
--    already enforces that at source); while NORMAL it is
--    `avg_prep_minutes`, which carries only its own `> 0` check and is free
--    catalogue input. Constraining this column to the five would therefore
--    reject perfectly valid NORMAL quotes. The database constrains what is
--    universally true — an estimate is a positive number of minutes — and a
--    NULL passes, because a CHECK rejects only a FALSE result.
--
-- 5. IMMUTABLE AFTER CREATION. Unlike `prep_minutes`, this column IS added
--    to `orders_enforce_immutable_columns()`. That trigger is the denylist
--    of money and snapshot columns, and this is a snapshot in the strictest
--    sense: it records what a customer was told at a single instant. If it
--    could be rewritten it would be worthless as evidence, and M-AV's
--    AC-05/AC-10 ("switching mode alters no existing order") would hold
--    only by there being nothing to alter rather than by protection. The
--    function is restated in full below because PL/pgSQL has no
--    ALTER FUNCTION ... ADD-a-clause equivalent; every other line is
--    reproduced byte-for-byte from 20260811000005_order_domain.sql,
--    including its DELETE guard and its exception message, and the trigger
--    itself is NOT recreated — it already points at this function by name.
--
-- 6. NO RLS CHANGE, NO NEW POLICY, NO NEW GRANT. `public.orders` carries
--    `grant select on public.orders to authenticated`
--    (20260811000011_rls_policies.sql) — a table-level grant, not a column
--    list, so a new column is covered automatically. `orders_select_customer`
--    (`customer_id = auth.uid()`) already decides who may read the row and
--    is not touched, which is what lets the customer app read this column
--    on its existing direct-to-Supabase order-detail path (DEC-APP-008)
--    with no new endpoint. `authenticated` still holds no UPDATE on
--    `orders` at all.
--
-- 7. NO INDEX. Nothing queries by quoted prep time — it is read as part of
--    an order row already fetched by primary key.
--
-- 8. NO STATE-MACHINE CHANGE, AND NO SECOND FIELD. `orders.state`, its
--    CHECK and every transition are untouched: this column is data, not a
--    state. Deliberately NOT added: a mode snapshot, a quote timestamp, or
--    a second quote field. `placed_at` already timestamps the quote, and
--    the mode is recoverable from `audit_logs` — a second column would be
--    denormalised restatement of facts the row already carries.
--
-- 9. create_order() (20260904000001) is restated below to capture the value
--    atomically, from the same `restaurants` row the availability guard
--    already reads. There is no update-it-afterwards path and no parameter:
--    the client cannot supply, override or influence this value, which is
--    the same discipline DEC-E-01 applies to fees and CON-002 to payment
--    confirmation.

alter table public.orders
  add column customer_quoted_prep_minutes integer
    constraint orders_customer_quoted_prep_minutes_positive
    check (customer_quoted_prep_minutes > 0);

comment on column public.orders.customer_quoted_prep_minutes is
  'AC-04 / DEC-042: the preparation-time estimate, in minutes, that the platform presented to the customer and that was in force when this order was created — BUSY quotes restaurants.busy_prep_minutes, NORMAL quotes restaurants.avg_prep_minutes, PAUSED cannot create an order at all. Captured by create_order() alone, never client-supplied, and immutable afterwards (orders_enforce_immutable_columns). NULL means no estimate was recorded: every order placed before this column existed, permanently, and any order placed at a restaurant that had no estimate to show. Distinct from orders.prep_minutes (the merchant''s own per-order answer at accept time, M-05) and from orders.quoted_eta_minutes (a delivery-arrival estimate). Kitchen preparation only — it must not participate in any delivery-ETA calculation unless a later decision says otherwise.';

-- ===========================================================================
-- orders_enforce_immutable_columns() — add the new snapshot to the denylist
-- ===========================================================================
--
-- Restated in full (see note 5). The only change is the
-- `customer_quoted_prep_minutes` clause; the DELETE guard, every existing
-- column, both exception messages and their errcodes are unchanged from
-- 20260811000005_order_domain.sql. `prep_minutes`, `state` and the
-- milestone timestamps stay freely updatable — that is the state machine's
-- job (ADR-003), and M-05 writes `prep_minutes` after creation by design.

create or replace function public.orders_enforce_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'orders are permanent and cannot be deleted (docs/DATABASE_DESIGN.md § 13)'
      using errcode = '42501';
  end if;

  if new.order_number is distinct from old.order_number
     or new.customer_id is distinct from old.customer_id
     or new.restaurant_id is distinct from old.restaurant_id
     or new.address_id is distinct from old.address_id
     or new.restaurant_name_snapshot is distinct from old.restaurant_name_snapshot
     or new.delivery_address_snapshot is distinct from old.delivery_address_snapshot
     or new.delivery_lat is distinct from old.delivery_lat
     or new.delivery_lng is distinct from old.delivery_lng
     or new.delivery_landmark is distinct from old.delivery_landmark
     or new.recipient_name_snapshot is distinct from old.recipient_name_snapshot
     or new.recipient_phone_snapshot is distinct from old.recipient_phone_snapshot
     or new.payment_method is distinct from old.payment_method
     or new.subtotal_satang is distinct from old.subtotal_satang
     or new.delivery_fee_satang is distinct from old.delivery_fee_satang
     or new.service_fee_satang is distinct from old.service_fee_satang
     or new.discount_satang is distinct from old.discount_satang
     or new.grand_total_satang is distinct from old.grand_total_satang
     or new.currency is distinct from old.currency
     or new.placed_at is distinct from old.placed_at
     -- AC-04 / DEC-042: what the customer was told is evidence, and evidence
     -- that can be rewritten is not evidence.
     or new.customer_quoted_prep_minutes is distinct from old.customer_quoted_prep_minutes
  then
    raise exception 'order financial and snapshot columns are immutable after creation (docs/DATABASE_DESIGN.md § 8, § 13)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.orders_enforce_immutable_columns() is
  'Blocks changes to money and snapshot columns on orders, for every role including service_role. Extended by DEC-042 (20260904000002) to cover customer_quoted_prep_minutes. state, prep_minutes and the milestone timestamps remain freely updatable — this is the state machine''s job (ADR-003), not this trigger''s.';

-- ===========================================================================
-- create_order() — capture the quote atomically with the order
-- ===========================================================================
--
-- Restated in full for the same PL/pgSQL reason. Every line is reproduced
-- from 20260904000001_restaurant_availability_mode.sql except: one new
-- local, two extra columns on the restaurant lookup that already runs, the
-- CASE that derives the quote directly after the PAUSED guard, and the
-- column in the INSERT. The signature is unchanged — no new parameter,
-- because a client must never be able to name its own quote.

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
  -- AC-04 / DEC-042. The estimate the platform showed this customer,
  -- resolved below from the same restaurant row the availability guard
  -- already reads. NULL is a legitimate outcome and is never replaced.
  v_customer_quoted_prep_minutes int;
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

  select r.id, r.name, r.status, r.availability_mode,
         r.avg_prep_minutes, r.busy_prep_minutes
    into v_restaurant
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
  -- AC-04 / DEC-042 — the customer-quoted preparation estimate.
  --
  -- Derived here, from the row the guard above just read, inside the same
  -- transaction: the mode that gated this order is the mode that decides
  -- its quote, so the two can never disagree. It mirrors
  -- apps/customer/src/lib/catalogDisplay.ts's prepEstimateMinutes()
  -- exactly — BUSY reads busy_prep_minutes, NORMAL reads avg_prep_minutes,
  -- and PAUSED is unreachable because the raise above already returned.
  --
  -- A NULL restaurant estimate yields a NULL quote. The customer was shown
  -- no number, so no number is recorded (AV-E5). Never a default, never the
  -- other mode's value, never restaurants.avg_prep_minutes while BUSY
  -- (AV-D01).
  -- ---------------------------------------------------------------------

  v_customer_quoted_prep_minutes := case
    when v_restaurant.availability_mode = 'BUSY' then v_restaurant.busy_prep_minutes
    else v_restaurant.avg_prep_minutes
  end;

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
    discount_satang, grand_total_satang, distance_m, quoted_eta_minutes,
    customer_quoted_prep_minutes
  ) values (
    v_order_id, v_order_number, 'CREATED', p_customer_id, v_cart.restaurant_id, v_address.id,
    v_restaurant.name, v_address.address_line, v_address.lat, v_address.lng,
    v_address.landmark, v_address.recipient_name, v_address.recipient_phone,
    p_payment_method, v_subtotal_satang, p_delivery_fee_satang, p_service_fee_satang,
    p_discount_satang, v_grand_total_satang, p_distance_m, p_quoted_eta_minutes,
    v_customer_quoted_prep_minutes
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
  'Phase E-1 (DEC-E-02), extended by M-AV (20260904000001) to refuse availability_mode = PAUSED, and by AC-04 / DEC-042 (20260904000002) to snapshot customer_quoted_prep_minutes. The sole sanctioned way to create an order: snapshots cart, restaurant, address and live catalog prices into orders/order_items/order_item_options/order_status_history inside one transaction. SECURITY INVOKER (not DEFINER — see release_rider_assignment for why). Primary protection: the EXECUTE grant below (service_role only). p_delivery_fee_satang/p_service_fee_satang have no default — DEC-E-01 forbids inventing them, so the signature itself makes the function uncallable without an explicit, approved value.';

revoke execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) to service_role;
