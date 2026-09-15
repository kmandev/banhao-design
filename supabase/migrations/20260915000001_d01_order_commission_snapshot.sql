-- BANHAO — D-01: order-time commission snapshot (DEC-061 D-01, and the
-- D-01 clarifications locked 2026-09-15 in docs/DECISIONS.md: the timing
-- clarification, D-01-S1…S5, D-01-CUTOVER-1/2, D-01-ROLLBACK-1,
-- D-01-ROLLOUT-1 and D-01-ARCH-1…9).
--
-- 1. WHAT THIS DOES. Merchant commission stops being re-derived from a live
--    rate constant at payment confirmation and becomes an immutable fact
--    captured when the order is created — the same principle
--    20260811000005_order_domain.sql already applies to every other order
--    money column: "the order stores AMOUNTS, never rates".
--
--    * public.order_commission_snapshots — one immutable resolved
--      commission_satang per order (D-01-S1), behind a service-role-only
--      boundary with zero client policies (D-01-S2, D-01-ARCH-3).
--    * create_order(..., p_commission_satang, p_commission_base_satang, ...)
--      — a new overload that writes the snapshot inside its own single
--      transaction (D-01-ARCH-4). Both commission parameters are required,
--      have no default, and are rejected when NULL.
--    * reconciliation_cases gains COMMISSION_SNAPSHOT_MISSING (D-01-ARCH-9),
--      deduplicated per order while OPEN/IN_PROGRESS.
--    * A before-insert guard on ledger_entries: an original
--      MERCHANT_COMMISSION entry for a snapshot-bearing order must carry
--      exactly the snapshot amount (D-01-ROLLOUT-1).
--    * expire_legacy_unpaid_orders() — the D-01-CUTOVER-1 freeze, used by
--      the new first tick phase (D-01-ARCH-1/2/5).
--
-- 2. THE COMMISSION IS NOT COMPUTED HERE. D-02 locks the existing whole-baht
--    round-half-up rule, and its one canonical implementation is
--    apps/api/src/modules/payments/commission-pricing.ts. Restating that
--    arithmetic in PL/pgSQL would create a second implementation that could
--    drift. The caller resolves the amount once and passes it in, together
--    with the food subtotal it was resolved against
--    (p_commission_base_satang). This function checks only that the base
--    equals the food subtotal it computes itself, the order's authoritative
--    subtotal_satang. A mismatch means the cart was repriced between the
--    caller's validation and this call. Rather than freeze a commission
--    derived from a subtotal the order does not carry, the call is refused
--    (P0001) and nothing is written. No rounding logic lives in SQL.
--
-- 3. WHY A NEW OVERLOAD AND NOT A REPLACEMENT. D-01-S3 locks migration-first
--    sequencing with the requirement that "the migration must not make an
--    existing old-application call fail". The existing nine-argument
--    create_order() is left exactly as 20260904000002 defined it, so an
--    application instance still on the previous release keeps creating
--    orders during the rollout window. Those orders carry no snapshot, which
--    makes them legacy orders by construction (D-01-ARCH-5). The freeze
--    below handles them before payment confirmation, and
--    COMMISSION_SNAPSHOT_MISSING handles any that are paid first. The new
--    overload does not weaken the parameter rule: p_commission_satang is
--    required, has no default and cannot be NULL. PostgREST resolves the two
--    overloads by named arguments. A call that supplies
--    p_commission_satang can only match the new one, and a call that omits
--    it can only match the old one.
--
--    REQUIRED FOLLOW-UP (T7, NOT IN THIS FILE): once no snapshot-unaware
--    application version remains deployed anywhere, a separate migration
--    must `drop function public.create_order(uuid, uuid, text, bigint,
--    bigint, bigint, int, int, uuid)`, closing the snapshot-unaware creation
--    path structurally. It cannot live in this file: `supabase db push`
--    would apply it in the same step as everything above and break every
--    old-application order creation at T1, which is exactly what D-01-S3
--    forbids.
--
-- 4. WHY A LEDGER GUARD (D-01-ROLLOUT-1, D-01-ROLLBACK-1). Application code
--    can only constrain the application version that contains it. An older
--    release's PaymentEventProcessingService still computes commission from
--    its own compiled rate, and it claims payment_events through the same
--    processed_at guard as the new one, so a claim-time check in the new code
--    cannot stop it. The system of record can (DEC-014). The trigger rejects
--    any original (refund_id IS NULL) MERCHANT_COMMISSION entry for an order
--    that has a snapshot unless its amount is exactly the snapshot:
--    MERCHANT_PAYABLE = -commission_satang, PLATFORM_REVENUE =
--    +commission_satang. A snapshot-unaware worker, whether a mixed-version
--    peer during rollout or a forbidden rollback afterwards, gets its insert
--    refused (23514). Its claim is released, and the event is finalized by a
--    compatible worker using the stored amount. Orders without a snapshot
--    are not touched by the guard. This is NOT the zero-sum constraint
--    trigger DEC-034 declines: it never sums a group. It checks one row
--    against one immutable fact.
--
-- 5. PAYMENT_EXPIRED. Already present in orders.state's CHECK vocabulary
--    since 20260811000005. D-01-ARCH-1 approves it for the D-01 legacy
--    freeze. No state vocabulary is added or changed here.
--
-- 6. NOT TOUCHED: orders' columns, RLS and grants (the snapshot is
--    deliberately not an orders column — orders grants full-row SELECT to
--    customer, merchant and rider alike, 20260811000011); the existing
--    create_order() overload's body; every existing reconciliation kind and
--    its dedup behaviour; refund reversal, which reads the originally posted
--    ledger entry and never a snapshot (DEC-059 clause C); D-15…D-19.

-- ===========================================================================
-- order_commission_snapshots — D-01-S1 / D-01-S2 / D-01-ARCH-3
-- ===========================================================================

create table public.order_commission_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  commission_satang bigint not null check (commission_satang >= 0),
  created_at timestamptz not null default now(),

  -- Exactly zero or one snapshot per order (D-01-ARCH-3). Zero means a
  -- legacy order created before the snapshot capability existed
  -- (D-01-ARCH-5); it is never backfilled (D-01-CUTOVER-1).
  constraint order_commission_snapshots_order_id_key unique (order_id)
);

comment on table public.order_commission_snapshots is
  'D-01: the resolved merchant commission (10% of the food subtotal, D-02 whole-baht round-half-up), captured by create_order() in the same transaction as the order and immutable afterwards. The canonical order-time commission fact (D-01-S1). Consumed by PaymentEventProcessingService.postCommissionLedger. Once posted, ledger_entries is the accounting source of truth and refund reversal reads the ledger, never this table. Service-role only, with no client policy (D-01-S2), so customer, merchant and rider cannot read it. No row means a legacy order: never backfilled, never recomputed (D-01-CUTOVER-1/2, D-01-ARCH-5).';
comment on column public.order_commission_snapshots.commission_satang is
  'The resolved commission amount in satang — never a rate (D-01-S1). Resolved once, by commission-pricing.ts, from the same food subtotal create_order() stores as orders.subtotal_satang.';

create trigger order_commission_snapshots_reject_mutation
  before update or delete on public.order_commission_snapshots
  for each row execute function public.reject_mutation();

-- Revoke first: Supabase grants ALL on new public tables to anon and
-- authenticated by default. RLS with zero policies denies every row to every
-- role except one with BYPASSRLS (service_role) — order_number_counters'
-- exact shape (20260819000001).
revoke all on public.order_commission_snapshots from anon, authenticated;
alter table public.order_commission_snapshots enable row level security;

-- ===========================================================================
-- reconciliation_cases — COMMISSION_SNAPSHOT_MISSING (D-01-ARCH-9)
-- ===========================================================================
--
-- Same drop/re-add shape 20260825000001 and 20260909000001 already used for
-- this exact constraint. Every existing value is carried over unchanged and
-- unrenamed; one value is added.

alter table public.reconciliation_cases
  drop constraint reconciliation_cases_kind_check;

alter table public.reconciliation_cases
  add constraint reconciliation_cases_kind_check
  check (kind in (
    'LATE_PAYMENT', 'SURPLUS_PAYMENT', 'AMOUNT_MISMATCH', 'UNMATCHED_EVENT',
    'RIDER_RELEASE_INVARIANT',
    'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
    'REFUND_AMOUNT_MISMATCH', 'MISSING_PROVIDER_REFUND_ID',
    'MISSING_PROVIDER_EVENT', 'REFUNDED_LEDGER_INCOMPLETE',
    -- D-01-ARCH-9: an order that legitimately reached PAID with no
    -- order-time commission snapshot. Commission posting is withheld
    -- pending operator resolution.
    'COMMISSION_SNAPSHOT_MISSING'
  ));

-- A COMMISSION_SNAPSHOT_MISSING case is always about one specific order.
-- Scoped to this kind only, so no existing row of any other kind is
-- evaluated differently. No row of this kind can predate this migration.
alter table public.reconciliation_cases
  add constraint reconciliation_cases_commission_snapshot_missing_order_check
  check (kind <> 'COMMISSION_SNAPSHOT_MISSING' or order_id is not null);

comment on column public.reconciliation_cases.kind is
  'Payment kinds (DEC-029/DEC-032): LATE_PAYMENT, SURPLUS_PAYMENT, AMOUNT_MISMATCH, UNMATCHED_EVENT — via payment_id/payment_event_id. Rider kind (Phase G-3.1): RIDER_RELEASE_INVARIANT — via delivery_id. Q-020 refund kinds (DEC-060): PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED, LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED, REFUND_AMOUNT_MISMATCH, MISSING_PROVIDER_REFUND_ID, MISSING_PROVIDER_EVENT, REFUNDED_LEDGER_INCOMPLETE — via payment_id, deduplicated while OPEN/IN_PROGRESS by reconciliation_cases_refund_open_key. D-01 kind (D-01-ARCH-9): COMMISSION_SNAPSHOT_MISSING — always carries order_id, deduplicated per order while OPEN/IN_PROGRESS by reconciliation_cases_commission_snapshot_missing_open_key. Case G (PROVIDER_LOCAL_STATE_DIVERGENCE) is deliberately absent — see DEC-060 §2.';

-- Dedup: at most one OPEN/IN_PROGRESS COMMISSION_SNAPSHOT_MISSING case per
-- order. The same scoped, partial shape as reconciliation_cases_refund_open_key
-- (DEC-060 §4), scoped to this one kind for the same reason: the older kinds'
-- never-deduplicated behaviour must not change as a side effect. The writer
-- inserts first and treats a 23505 against this index as "already open".
-- The index is the concurrency authority, not a prior read.
create unique index reconciliation_cases_commission_snapshot_missing_open_key
  on public.reconciliation_cases (kind, order_id)
  where state in ('OPEN', 'IN_PROGRESS')
    and kind = 'COMMISSION_SNAPSHOT_MISSING';

comment on index public.reconciliation_cases_commission_snapshot_missing_open_key is
  'D-01-ARCH-9: at most one OPEN/IN_PROGRESS COMMISSION_SNAPSHOT_MISSING case per order. A RESOLVED/CLOSED row is never counted. Never applies to any other kind.';

-- ===========================================================================
-- ledger_entries guard — D-01-ROLLOUT-1 / D-01-ROLLBACK-1
-- ===========================================================================

create or replace function public.enforce_merchant_commission_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_group record;
  v_commission_satang bigint;
begin
  select g.kind, g.order_id, g.refund_id
    into v_group
    from public.ledger_entry_groups g
   where g.id = new.group_id;

  -- Only an ORIGINAL commission recognition is guarded. Refund reversals
  -- (kind MERCHANT_COMMISSION_REFUND, refund_id set) and every other group
  -- kind pass through untouched.
  if v_group.kind is distinct from 'MERCHANT_COMMISSION'
     or v_group.refund_id is not null
     or v_group.order_id is null then
    return new;
  end if;

  select s.commission_satang
    into v_commission_satang
    from public.order_commission_snapshots s
   where s.order_id = v_group.order_id;

  if not found then
    -- A legacy order (no snapshot). Not this guard's concern. D-01-ARCH-9
    -- keeps the snapshot-aware application from posting one at all.
    return new;
  end if;

  if new.account = 'MERCHANT_PAYABLE' and new.amount_satang = -v_commission_satang then
    return new;
  end if;

  if new.account = 'PLATFORM_REVENUE' and new.amount_satang = v_commission_satang then
    return new;
  end if;

  raise exception 'MERCHANT_COMMISSION entry (account %, amount % satang) for order % does not match its order-time commission snapshot of % satang (D-01)',
    new.account, new.amount_satang, v_group.order_id, v_commission_satang
    using errcode = '23514';
end;
$$;

comment on function public.enforce_merchant_commission_snapshot() is
  'D-01-ROLLOUT-1 / D-01-ROLLBACK-1: rejects any original MERCHANT_COMMISSION ledger entry for a snapshot-bearing order whose amount is not exactly the order_commission_snapshots amount (MERCHANT_PAYABLE = -commission_satang, PLATFORM_REVENUE = +commission_satang). This is what stops a snapshot-unaware application version from finalizing commission at a live rate. Per-row check against an immutable fact, not a zero-sum trigger (DEC-034 unchanged). Orders without a snapshot and non-commission groups pass through.';

create trigger ledger_entries_enforce_merchant_commission_snapshot
  before insert on public.ledger_entries
  for each row execute function public.enforce_merchant_commission_snapshot();

-- ===========================================================================
-- create_order() — the D-01 overload (D-01-ARCH-4)
-- ===========================================================================
--
-- The body is reproduced from 20260904000002 except for the two new
-- required parameters, their NULL/negative checks, the base-equals-subtotal
-- check, and the snapshot INSERT directly after the orders INSERT. The
-- snapshot INSERT runs inside this one function invocation, so its failure
-- (for example a duplicate order_id, or a CHECK violation) unwinds the order,
-- its items, options and history together. No order can survive without its
-- snapshot.
--
-- Parameter order is forced by PostgreSQL: a parameter without a default
-- cannot follow one with a default, so the two required commission
-- parameters sit before p_discount_satang.

create or replace function public.create_order(
  p_customer_id uuid,
  p_address_id uuid,
  p_payment_method text,
  p_delivery_fee_satang bigint,
  p_service_fee_satang bigint,
  p_commission_satang bigint,
  p_commission_base_satang bigint,
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

  -- D-01: the order-time commission snapshot inputs. The signature already
  -- gives them no default. An explicit NULL is refused here too, so the
  -- snapshot can never be silently absent for an order this overload creates.
  if p_commission_satang is null or p_commission_base_satang is null then
    raise exception 'create_order: p_commission_satang and p_commission_base_satang are required (D-01 order-time commission snapshot)'
      using errcode = '22023';
  end if;

  if p_commission_satang < 0 or p_commission_base_satang < 0 then
    raise exception 'create_order: commission amounts must not be negative'
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

  -- D-01: the commission must have been resolved against exactly the food
  -- subtotal this order is about to store. Anything else means the cart was
  -- repriced after the caller validated it. The order is refused rather
  -- than frozen with a commission that is not this subtotal's.
  if p_commission_base_satang <> v_subtotal_satang then
    raise exception 'create_order: commission was resolved against a food subtotal of % satang, but this order''s authoritative food subtotal is % satang',
      p_commission_base_satang, v_subtotal_satang
      using errcode = 'P0001';
  end if;

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

  -- D-01-ARCH-4: the order-time commission snapshot, in this same
  -- transaction. Any failure here unwinds the order above.
  insert into public.order_commission_snapshots (order_id, commission_satang)
  values (v_order_id, p_commission_satang);

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

comment on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, int, int, uuid) is
  'D-01 overload (20260915000001) of the sole sanctioned order-creation entry point. Everything 20260904000002 does, plus the order-time commission snapshot written into order_commission_snapshots in the same transaction (D-01-ARCH-4). p_commission_satang and p_commission_base_satang are required, have no default and are refused when NULL. The commission is resolved by the caller with the canonical commission-pricing.ts function (D-02) and is never recomputed here. p_commission_base_satang must equal the food subtotal this function computes, or nothing is written. SECURITY INVOKER; EXECUTE is granted to service_role only.';

revoke execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, int, int, uuid) from public, anon, authenticated;
grant execute on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, bigint, bigint, int, int, uuid) to service_role;

-- The pre-D-01 overload: body, grants and behaviour unchanged. Only its
-- description is updated, so nobody mistakes it for the current entry point.
comment on function public.create_order(uuid, uuid, text, bigint, bigint, bigint, int, int, uuid) is
  'PRE-D-01 overload, retained ONLY for the D-01 rollout window (D-01-S3: the migration must not make an old-application call fail). Creates orders WITHOUT an order_commission_snapshots row. Those are legacy orders, frozen to PAYMENT_EXPIRED by expire_legacy_unpaid_orders() before payment confirmation (D-01-CUTOVER-1) or routed to COMMISSION_SNAPSHOT_MISSING if paid first (D-01-ARCH-9). Must be dropped by a separate migration at T7, once no snapshot-unaware application version remains deployed. Otherwise identical to 20260904000002.';

-- ===========================================================================
-- expire_legacy_unpaid_orders() — the D-01 legacy freeze
-- (D-01-CUTOVER-1, D-01-ARCH-1/2/5)
-- ===========================================================================
--
-- Candidates are orders in CREATED or PENDING_PAYMENT with no snapshot row.
-- Snapshot absence is the sole discriminator (D-01-ARCH-5). An order created
-- by the D-01 overload commits its snapshot in the same transaction, so a
-- committed order is never visible without its committed snapshot, and a
-- snapshot-bearing order can never be selected here. PAID, CANCELLED and
-- every other state are excluded by the predicate itself.
--
-- One statement:
--   * candidates are locked FOR UPDATE SKIP LOCKED, so a row the payment
--     processor is concurrently moving to PAID is skipped, not waited on;
--   * the UPDATE repeats the state guard (never a prior SELECT deciding
--     alone, ADR-003);
--   * the order_status_history row (actor SYSTEM, D-01-ARCH-1) is written
--     in the same statement, with no crash window between state and history.
--
-- Race with the PAID transition. That transition is the guarded
-- `UPDATE orders SET state = 'PAID' WHERE id = … AND state = 'PENDING_PAYMENT'`.
-- If this function locks the row first, the PAID update waits, re-evaluates
-- its WHERE clause against PAYMENT_EXPIRED, matches 0 rows and becomes
-- LATE_PAYMENT, and no money is posted (D-01-ARCH-8). If the PAID update
-- locks first, this function skips the row. It commits as PAID and is
-- handled by COMMISSION_SNAPSHOT_MISSING (D-01-ARCH-9).
--
-- Idempotent: an already-expired order is no longer a candidate. No cause
-- code, timestamp column or payment-domain row is written, because none is
-- locked for this transition.

create or replace function public.expire_legacy_unpaid_orders(p_batch_size int)
returns table (order_id uuid, from_state text)
language plpgsql
set search_path = public
as $$
begin
  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'expire_legacy_unpaid_orders may only be called by the service role'
      using errcode = '42501';
  end if;

  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000 then
    raise exception 'expire_legacy_unpaid_orders: p_batch_size must be between 1 and 1000, got %', p_batch_size
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id, o.state
      from public.orders o
     where o.state in ('CREATED', 'PENDING_PAYMENT')
       and not exists (
         select 1 from public.order_commission_snapshots s where s.order_id = o.id
       )
     order by o.placed_at, o.id
     limit p_batch_size
     for update of o skip locked
  ),
  expired as (
    update public.orders o
       set state = 'PAYMENT_EXPIRED'
      from candidates c
     where o.id = c.id
       and o.state in ('CREATED', 'PENDING_PAYMENT')
    returning o.id, c.state as previous_state
  ),
  recorded as (
    insert into public.order_status_history (
      order_id, from_state, to_state, actor_type, actor_id, reason, correlation_id
    )
    select e.id, e.previous_state, 'PAYMENT_EXPIRED', 'SYSTEM', null,
           'D-01 cutover: legacy unpaid order has no order-time commission snapshot and cannot complete payment under the D-01 regime (D-01-CUTOVER-1)',
           null
      from expired e
    returning order_status_history.order_id, order_status_history.from_state
  )
  select r.order_id, r.from_state from recorded r;
end;
$$;

comment on function public.expire_legacy_unpaid_orders(int) is
  'D-01-CUTOVER-1 / D-01-ARCH-2: freezes up to p_batch_size CREATED/PENDING_PAYMENT orders that have no order_commission_snapshots row to PAYMENT_EXPIRED, writing the SYSTEM order_status_history row in the same statement. FOR UPDATE SKIP LOCKED and the repeated state guard make it safe against the concurrent PAID transition. Idempotent. Called only by the first /internal/tick phase. SECURITY INVOKER; EXECUTE is granted to service_role only.';

revoke execute on function public.expire_legacy_unpaid_orders(int) from public, anon, authenticated;
grant execute on function public.expire_legacy_unpaid_orders(int) to service_role;
