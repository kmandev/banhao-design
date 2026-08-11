-- BANHAO — merchant domain: merchants, bank accounts, restaurants, membership
--
-- Implements docs/DATABASE_DESIGN.md § 5.2.
--
-- merchants and restaurants are deliberately separate tables: settlement pays
-- a merchant, not a storefront, so a two-branch owner must have one
-- commission relationship and one payout destination, not two
-- (docs/SETTLEMENT_MODEL.md). restaurant_members — not a role column — is
-- the merchant authorization boundary (DEC-033): a MERCHANT capability
-- grants nothing on its own, only membership in a specific restaurant does.

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete restrict,
  legal_name text not null,
  tax_id text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  -- Basis points. NULL and unset — DEC-025 keeps the commission rate OPEN.
  -- No default value may be invented; see docs/DATABASE_DESIGN.md § 5.2.
  commission_bps int check (commission_bps is null or commission_bps between 0 and 10000),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.merchants is
  'The business entity that gets paid — separate from the restaurant storefront it operates. Status vocabulary is PROPOSED (BQ-006 OPEN).';
comment on column public.merchants.commission_bps is
  'Basis points (1% = 100). NULL until DEC-025''s commission rate is set — do not default this.';

create trigger merchants_set_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

-- Never hard-deleted — status moves to CLOSED instead (§ 13).
create trigger merchants_reject_delete
  before delete on public.merchants
  for each row execute function public.reject_delete();

revoke all on public.merchants from anon, authenticated;
alter table public.merchants enable row level security;

-- ---------------------------------------------------------------------------
-- merchant_bank_accounts — payout destination
-- ---------------------------------------------------------------------------
--
-- Only account_number_last4 is ever intended to be returned by an API.
-- Whether the full number is stored at all, and how it is encrypted, is
-- DBQ-004 (gated on Q-002) — unresolved. This migration implements the
-- column shape from docs/DATABASE_DESIGN.md § 5.2 without deciding that
-- question: account_number_encrypted is nullable and unused until DBQ-004
-- is answered.

create table public.merchant_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete cascade,
  bank_code text not null,
  account_name text not null,
  account_number_last4 text not null,
  account_number_encrypted text, -- DBQ-004 OPEN — not populated by this migration
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.merchant_bank_accounts is
  'Merchant payout destination. No client SELECT at all — API-only (§ 18). Full account number storage/encryption is DBQ-004, unresolved.';

create index merchant_bank_accounts_merchant_idx
  on public.merchant_bank_accounts (merchant_id);

-- Settlement history references a bank account — never hard-deleted, only
-- superseded by a new primary row (§ 13).
create trigger merchant_bank_accounts_reject_delete
  before delete on public.merchant_bank_accounts
  for each row execute function public.reject_delete();

revoke all on public.merchant_bank_accounts from anon, authenticated;
alter table public.merchant_bank_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- restaurants — the Phase-1 storefront
-- ---------------------------------------------------------------------------
--
-- zone_id is a bare uuid with no FK — the geo domain is deferred from this
-- migration set (see docs/DATABASE_MIGRATION_V1_REPORT.md).
--
-- "Is this restaurant open right now" is NOT stored here. It is derived by
-- the application from status + restaurant_hours + temporarily_closed_until
-- (docs/DATABASE_DESIGN.md § 5.2) — storing an is_open boolean would need a
-- job to keep it true and would be wrong between ticks.

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants (id) on delete restrict,
  name text not null,
  description text,
  cuisine text,
  image_url text,
  phone text,
  address_line text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  location geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null
      then st_setsrid(st_makepoint(lng, lat), 4326)::geography
      else null
    end
  ) stored,
  zone_id uuid, -- no FK yet — geo domain deferred
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  temporarily_closed_until timestamptz,
  temporary_close_reason text,
  min_order_satang bigint check (min_order_satang is null or min_order_satang >= 0),
  service_radius_m int check (service_radius_m is null or service_radius_m > 0),
  avg_prep_minutes int check (avg_prep_minutes is null or avg_prep_minutes > 0),
  rating_avg numeric(2, 1) check (rating_avg is null or rating_avg between 0 and 5),
  rating_count int not null default 0 check (rating_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Specified in docs/DATABASE_DESIGN.md § 5.2 as a composite-FK anchor
  -- alongside the (id, restaurant_id) pattern used elsewhere in this schema.
  -- No current table references it (§ 6 lists only cart_items, order_items,
  -- cart_item_options), kept for forward compatibility at negligible cost.
  constraint restaurants_id_merchant_id_key unique (id, merchant_id)
);

comment on table public.restaurants is
  'The Phase-1 storefront customers browse. "Open now" is derived by the application, never stored — see docs/DATABASE_DESIGN.md § 5.2.';

create index restaurants_status_idx on public.restaurants (status);
create index restaurants_zone_idx on public.restaurants (zone_id);
create index restaurants_location_idx on public.restaurants using gist (location);

create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

-- Never hard-deleted — status moves to CLOSED instead (§ 13).
create trigger restaurants_reject_delete
  before delete on public.restaurants
  for each row execute function public.reject_delete();

revoke all on public.restaurants from anon, authenticated;
alter table public.restaurants enable row level security;

-- ---------------------------------------------------------------------------
-- restaurant_members — the merchant authorization boundary (DEC-033)
-- ---------------------------------------------------------------------------

create table public.restaurant_members (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  member_role text not null check (member_role in ('OWNER', 'MANAGER', 'STAFF')),
  invited_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  constraint restaurant_members_restaurant_user_key unique (restaurant_id, user_id)
);

comment on table public.restaurant_members is
  'DEC-033: this table, not a role column, is what authorizes a merchant user against a specific restaurant. A MERCHANT capability grants nothing on its own.';

create index restaurant_members_active_idx
  on public.restaurant_members (user_id)
  where revoked_at is null;

-- Revocation, never deletion — membership history stays explicable.
create trigger restaurant_members_reject_delete
  before delete on public.restaurant_members
  for each row execute function public.reject_delete();

revoke all on public.restaurant_members from anon, authenticated;
alter table public.restaurant_members enable row level security;
