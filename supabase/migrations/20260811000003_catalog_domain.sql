-- BANHAO — catalog domain: opening hours and menu
--
-- Implements docs/DATABASE_DESIGN.md § 5.3.
--
-- Menu items are freely editable, which is exactly why order_items (added in
-- the order-domain migration) snapshot name/price at the moment of purchase
-- rather than joining to these tables — a price change here must never
-- rewrite a historical order (§ 8).
--
-- Reconciles one internal inconsistency in the design document: § 5.3's
-- table catalog states menu_items.category_id is `on delete restrict`,
-- while § 19's summary table describes the whole restaurants → categories →
-- items chain as CASCADE. The more specific, deliberate per-table
-- declaration (§ 5.3) is followed for that one edge; restaurant_id FKs
-- follow § 19's CASCADE. Restaurants can never be hard-deleted (reject_delete
-- in the merchant-domain migration), so this is defensive rather than live
-- behaviour either way. Documented in docs/DATABASE_MIGRATION_V1_REPORT.md.

-- ---------------------------------------------------------------------------
-- restaurant_hours — per-day opening intervals
-- ---------------------------------------------------------------------------
--
-- Multiple rows per day are allowed, so a shop that closes in the afternoon
-- is representable. Overnight spans (18:00 → 02:00) are not yet supported —
-- DBQ-006, gated on BQ-007.

create table public.restaurant_hours (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),

  constraint restaurant_hours_span_check check (closes_at > opens_at)
);

comment on table public.restaurant_hours is
  'Per-day opening windows. Replaced wholesale on edit — the application deletes and re-inserts a restaurant''s rows rather than patching individual ones, so no immutability trigger is attached.';

create index restaurant_hours_restaurant_idx on public.restaurant_hours (restaurant_id);

revoke all on public.restaurant_hours from anon, authenticated;
alter table public.restaurant_hours enable row level security;

-- ---------------------------------------------------------------------------
-- menu_categories
-- ---------------------------------------------------------------------------

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.menu_categories is
  'Menu section (e.g. "แนะนำ", "อาหารจานเดียว"). Soft delete only.';

create index menu_categories_active_idx
  on public.menu_categories (restaurant_id)
  where archived_at is null;

create trigger menu_categories_reject_delete
  before delete on public.menu_categories
  for each row execute function public.reject_delete();

revoke all on public.menu_categories from anon, authenticated;
alter table public.menu_categories enable row level security;

-- ---------------------------------------------------------------------------
-- menu_items
-- ---------------------------------------------------------------------------

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  category_id uuid not null references public.menu_categories (id) on delete restrict,
  name text not null,
  description text,
  base_price_satang bigint not null check (base_price_satang >= 0),
  image_url text,
  is_available boolean not null default true,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite-FK anchor: cart_items and order_items reference
  -- (id, restaurant_id) so a cart/order line can only ever point at a menu
  -- item belonging to the SAME restaurant as its cart/order — see § 6.
  constraint menu_items_id_restaurant_id_key unique (id, restaurant_id)
);

comment on table public.menu_items is
  'Freely editable — this is exactly why order_items snapshot name and price rather than joining here (§ 8). Soft delete only: base_price_satang, name etc. may change at any time, but the row itself is archived, never removed, so historical FKs from order_items (ON DELETE SET NULL) stay meaningful as long as possible.';

create index menu_items_active_idx
  on public.menu_items (restaurant_id)
  where archived_at is null;

create trigger menu_items_set_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

create trigger menu_items_reject_delete
  before delete on public.menu_items
  for each row execute function public.reject_delete();

revoke all on public.menu_items from anon, authenticated;
alter table public.menu_items enable row level security;

-- ---------------------------------------------------------------------------
-- menu_option_groups / menu_options
-- ---------------------------------------------------------------------------
--
-- min_select/max_select rather than an is_required boolean: BQ-009
-- (single- vs multi-select) is OPEN. min=1,max=1 is required single-select;
-- min=0,max=N is optional multi-select. The open question becomes data, not
-- a schema change (docs/DATABASE_DESIGN.md § 5.3).

create table public.menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  title text not null,
  min_select smallint not null default 0 check (min_select >= 0),
  max_select smallint not null default 1 check (max_select >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  constraint menu_option_groups_select_range_check check (max_select >= min_select)
);

comment on table public.menu_option_groups is
  'min_select/max_select encode BQ-009 (single vs multi-select) as data rather than schema — see docs/DATABASE_DESIGN.md § 5.3.';

create index menu_option_groups_item_idx on public.menu_option_groups (menu_item_id);

revoke all on public.menu_option_groups from anon, authenticated;
alter table public.menu_option_groups enable row level security;

create table public.menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.menu_option_groups (id) on delete cascade,
  label text not null,
  price_delta_satang bigint not null default 0,
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.menu_options is
  'A single choice within a menu_option_groups group, e.g. "ไข่ดาว +10 บาท". price_delta_satang may be negative only if a future business rule requires it — no CHECK forbids it, since none is documented.';

create index menu_options_group_idx on public.menu_options (group_id);

revoke all on public.menu_options from anon, authenticated;
alter table public.menu_options enable row level security;
