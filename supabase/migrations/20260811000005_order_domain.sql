-- BANHAO — order domain: orders, order_items, order_item_options, history
--
-- Implements docs/DATABASE_DESIGN.md § 5.5, § 6, § 7, § 8.
--
-- orders.state carries ORDER LIFECYCLE ONLY (DEC-018) — never a payment,
-- delivery, or settlement value. The state vocabulary is text + CHECK, not
-- an enum, because it has already changed once (DEC-019 superseded the
-- original 12-state machine) and five exception-state names remain
-- PROPOSED — see docs/DATABASE_DESIGN.md § 14 and § 7.
--
-- Money columns and every snapshot are immutable after creation, enforced
-- for every role including the service role (§ 13) — a printed order must
-- always show what the customer actually agreed to, even if the restaurant,
-- menu, or address are edited afterwards.

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,

  -- Order lifecycle only (DEC-018). Core states per DEC-019; the five
  -- exception states are PROPOSED and their names may change — see
  -- docs/ORDER_LIFECYCLE.md § 3. No transition logic lives in the database
  -- (ADR-001, ADR-003): this CHECK constrains the vocabulary only.
  state text not null default 'CREATED' check (state in (
    'CREATED', 'PENDING_PAYMENT', 'PAID', 'MERCHANT_ACCEPTED', 'PREPARING',
    'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERING', 'DELIVERED',
    -- exception states — PROPOSED, not yet approved (docs/ORDER_LIFECYCLE.md § 3)
    'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'MERCHANT_REJECTED', 'CANCELLED', 'DELIVERY_FAILED'
  )),

  customer_id uuid not null references public.profiles (id) on delete restrict,
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  address_id uuid references public.addresses (id) on delete set null,

  -- Snapshots — the order must be fully explicable from its own rows even
  -- if the restaurant, menu, or address are edited or removed later (§ 8).
  restaurant_name_snapshot text not null,
  delivery_address_snapshot text not null,
  delivery_lat numeric(9, 6),
  delivery_lng numeric(9, 6),
  delivery_landmark text,
  recipient_name_snapshot text not null,
  recipient_phone_snapshot text not null,

  -- payment_method is extensible text, not a boolean — CASH is present and
  -- rejected at the service boundary, not removed (DEC-016).
  payment_method text not null check (payment_method in ('ONLINE', 'CASH')),

  -- Money — integer satang throughout, never float/double/numeric/money
  -- (ADR-007). The order stores AMOUNTS, never rates: a rate changing later
  -- must not be able to rewrite what the customer was actually charged.
  subtotal_satang bigint not null check (subtotal_satang >= 0),
  delivery_fee_satang bigint not null check (delivery_fee_satang >= 0),
  service_fee_satang bigint not null check (service_fee_satang >= 0),
  discount_satang bigint not null default 0 check (discount_satang >= 0),
  grand_total_satang bigint not null check (grand_total_satang >= 0),
  currency char(3) not null default 'THB',

  distance_m int,
  quoted_eta_minutes int,
  cause_code text,

  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_order_number_key unique (order_number),
  -- Composite-FK anchor: order_items references (id, restaurant_id) so a
  -- line can only ever belong to its own order's restaurant (§ 6).
  constraint orders_id_restaurant_id_key unique (id, restaurant_id),
  constraint orders_total_check
    check (grand_total_satang = subtotal_satang + delivery_fee_satang + service_fee_satang - discount_satang)
);

comment on table public.orders is
  'The contract. BANHAO-owned — no actor writes state directly; every transition is a guarded conditional UPDATE issued by the owning service (ADR-001, ADR-003). Money columns and snapshots are immutable after creation for every role, including the service role — see orders_enforce_immutable_columns below.';
comment on column public.orders.state is
  'Order lifecycle only — never a payment, delivery, or settlement value (DEC-018). Nine core states are ACCEPTED (DEC-019); five exception states are PROPOSED and their names may change.';
comment on column public.orders.grand_total_satang is
  'A stored, checked column — never a computed view. This is the number the customer agreed to, independent of any later rate change (DEC-023/024/025 keep every rate OPEN).';

create index orders_customer_idx on public.orders (customer_id, placed_at desc);
create index orders_restaurant_state_idx on public.orders (restaurant_id, state);
create index orders_live_idx on public.orders (state)
  where state not in ('DELIVERED', 'CANCELLED', 'MERCHANT_REJECTED', 'PAYMENT_FAILED', 'DELIVERY_FAILED');

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Immutability: money and snapshot columns are permanent, even for the
-- service role. `state` and its milestone timestamps and cause_code are the
-- only columns allowed to change after creation. DELETE is refused entirely.
-- ---------------------------------------------------------------------------

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
  then
    raise exception 'order financial and snapshot columns are immutable after creation (docs/DATABASE_DESIGN.md § 8, § 13)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.orders_enforce_immutable_columns() is
  'Blocks changes to money and snapshot columns on orders, for every role including service_role. state and its milestone timestamps remain freely updatable — this is the state machine''s job (ADR-003), not this trigger''s.';

create trigger orders_enforce_immutable_columns
  before update or delete on public.orders
  for each row execute function public.orders_enforce_immutable_columns();

revoke all on public.orders from anon, authenticated;
alter table public.orders enable row level security;

-- ---------------------------------------------------------------------------
-- order_items — write-once
-- ---------------------------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  restaurant_id uuid not null,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  item_name_snapshot text not null,
  unit_price_satang bigint not null check (unit_price_satang >= 0),
  quantity int not null check (quantity > 0),
  line_total_satang bigint not null check (line_total_satang >= 0),
  note text,
  created_at timestamptz not null default now(),

  -- Same enforcement shape as cart_items: an order line can only belong to
  -- its own order's restaurant (§ 6).
  constraint order_items_order_restaurant_fkey
    foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id)
    on delete cascade
);

comment on table public.order_items is
  'Write-once. menu_item_id is nullable with ON DELETE SET NULL deliberately: the snapshot is the truth, the FK is only a convenience link back to the live item — a historical order must never block a merchant from discontinuing a dish.';

create index order_items_order_idx on public.order_items (order_id);

create trigger order_items_reject_mutation
  before update or delete on public.order_items
  for each row execute function public.reject_mutation();

revoke all on public.order_items from anon, authenticated;
alter table public.order_items enable row level security;

-- ---------------------------------------------------------------------------
-- order_item_options — write-once
-- ---------------------------------------------------------------------------
--
-- A child table rather than jsonb: these amounts participate in refund
-- arithmetic (BQ-031), and money should be queryable and checkable, not
-- buried in a document (docs/DATABASE_DESIGN.md § 5.5).

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  menu_option_id uuid references public.menu_options (id) on delete set null,
  group_name_snapshot text not null,
  option_name_snapshot text not null,
  price_delta_satang bigint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.order_item_options is
  'Write-once snapshot of a selected option, kept as a queryable row (not jsonb) because these amounts feed refund arithmetic.';

create index order_item_options_item_idx on public.order_item_options (order_item_id);

create trigger order_item_options_reject_mutation
  before update or delete on public.order_item_options
  for each row execute function public.reject_mutation();

revoke all on public.order_item_options from anon, authenticated;
alter table public.order_item_options enable row level security;

-- ---------------------------------------------------------------------------
-- order_status_history — append-only audit trail (REQ-002)
-- ---------------------------------------------------------------------------

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in
    ('CUSTOMER', 'MERCHANT', 'RIDER', 'OPERATOR', 'SYSTEM', 'WEBHOOK')),
  actor_id uuid,
  reason text,
  correlation_id uuid,
  occurred_at timestamptz not null default now()
);

comment on table public.order_status_history is
  'Append-only. The customer-facing timeline is derived from this table, never stored separately (REQ-002).';

create index order_status_history_order_idx
  on public.order_status_history (order_id, occurred_at);

create trigger order_status_history_reject_mutation
  before update or delete on public.order_status_history
  for each row execute function public.reject_mutation();

revoke all on public.order_status_history from anon, authenticated;
alter table public.order_status_history enable row level security;
