-- BANHAO — cart domain: one cart, one restaurant (DEC-017)
--
-- Implements docs/DATABASE_DESIGN.md § 5.4 and § 6.
--
-- DEC-017 ("one cart = one restaurant") is enforced STRUCTURALLY here, not
-- only by application validation. cart_items carries a denormalised
-- restaurant_id and two composite foreign keys, one to carts(id,
-- restaurant_id) and one to menu_items(id, restaurant_id). Both share the
-- restaurant_id column, so they must agree — a cross-restaurant cart line
-- cannot be inserted at all. See the composite-FK enforcement note below.

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One open cart per user.
  constraint carts_user_id_key unique (user_id),
  -- Composite-FK anchor for cart_items — see below.
  constraint carts_id_restaurant_id_key unique (id, restaurant_id)
);

comment on table public.carts is
  'A draft order, scoped to exactly one restaurant (DEC-017). Not a contract — cart_items carries no price snapshot; the order is where prices freeze (§ 8). Hard-deletable: carts carry no financial or state meaning.';

create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

revoke all on public.carts from anon, authenticated;
alter table public.carts enable row level security;

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null,
  -- Denormalised on purpose — this is the enforcement mechanism, not
  -- redundant data. See the composite foreign keys below.
  restaurant_id uuid not null,
  menu_item_id uuid not null,
  quantity int not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),

  -- ---------------------------------------------------------------------
  -- DEC-017 enforcement.
  --
  -- The first FK ties this row to its cart's restaurant. The second ties
  -- it to the chosen menu item's restaurant. Both foreign keys reference
  -- the SAME restaurant_id column on this row, so a caller cannot satisfy
  -- both unless the cart and the menu item belong to the same restaurant.
  -- A cross-restaurant cart is not merely rejected by application code —
  -- it cannot be represented in the table at all.
  -- ---------------------------------------------------------------------
  constraint cart_items_cart_restaurant_fkey
    foreign key (cart_id, restaurant_id) references public.carts (id, restaurant_id)
    on delete cascade,
  constraint cart_items_menu_item_restaurant_fkey
    foreign key (menu_item_id, restaurant_id) references public.menu_items (id, restaurant_id)
    on delete cascade
);

comment on table public.cart_items is
  'DEC-017 enforcement point: the composite foreign keys on (cart_id, restaurant_id) and (menu_item_id, restaurant_id) make a cross-restaurant cart structurally impossible to store. Hard-deletable.';
comment on column public.cart_items.restaurant_id is
  'Denormalised deliberately — this column is what the two composite foreign keys pin together to enforce DEC-017. Do not treat as redundant.';

create index cart_items_cart_idx on public.cart_items (cart_id);

revoke all on public.cart_items from anon, authenticated;
alter table public.cart_items enable row level security;

create table public.cart_item_options (
  id uuid primary key default gen_random_uuid(),
  cart_item_id uuid not null references public.cart_items (id) on delete cascade,
  menu_option_id uuid not null references public.menu_options (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.cart_item_options is
  'Selected options for a cart line. Mirrors cart_items — hard-deletable, no price snapshot (indicative only until the order is created).';

create index cart_item_options_item_idx on public.cart_item_options (cart_item_id);

revoke all on public.cart_item_options from anon, authenticated;
alter table public.cart_item_options enable row level security;
