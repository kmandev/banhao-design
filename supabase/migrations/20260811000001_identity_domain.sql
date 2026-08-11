-- BANHAO — identity domain: shared trigger functions, platform_staff, addresses
--
-- Implements docs/DATABASE_DESIGN.md § 4.2 and § 5.1, locked by DEC-033
-- ("profiles is identity; authorization is a domain relationship").
--
-- DEC-033 rejected the design's own earlier `user_roles` proposal. There is
-- NO generic RBAC table here. Capability is established by domain membership:
--   Customer  — implicit, every authenticated profile
--   Merchant  — restaurant_members (added in the merchant-domain migration)
--   Rider     — riders (added in the rider-domain migration)
--   Operator / Admin — platform_staff (this migration)
--
-- `profiles.role` is UNCHANGED and UNTOUCHED by this migration. It is
-- deprecated per DEC-033 but cannot be dropped here — RolesGuard,
-- set_user_role(), and enforce_profile_immutable_columns() still read it.
-- See docs/TODO.md "Retire profiles.role in favour of domain membership".
--
-- No PROMPT — as with every migration in this set, RLS policies and column
-- grants are added later in 20260811000011_rls_policies.sql. Tables are
-- created with the default-deny posture immediately (revoke + enable RLS
-- with no policies yet), so there is never a window where a new table is
-- open to anon/authenticated.

-- ---------------------------------------------------------------------------
-- Shared immutability trigger functions
--
-- Two generic functions cover most append-only tables in this schema.
-- Per docs/DATABASE_DESIGN.md § 13: "even the service role is refused" on
-- ledger and history tables, because the service role bypasses RLS and holds
-- broad rights — revoking grants alone is not enough. These triggers fire
-- unconditionally, with no service_role escape hatch, unlike
-- enforce_profile_immutable_columns() (which deliberately allows the service
-- role through for role assignment). Financial and history rows are
-- corrected with a compensating record, never an edit — DEC-014, DEC-034.
-- ---------------------------------------------------------------------------

create or replace function public.reject_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'rows in % are permanent and cannot be deleted (see docs/DATABASE_DESIGN.md § 13)', TG_TABLE_NAME
    using errcode = '42501';
end;
$$;

comment on function public.reject_delete() is
  'Unconditional DELETE rejection, including for the service role. Attached to tables whose delete strategy is "never deleted" — status/state changes are still allowed.';

create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'rows in % are append-only and cannot be deleted (see docs/DATABASE_DESIGN.md § 13)', TG_TABLE_NAME
      using errcode = '42501';
  else
    raise exception 'rows in % are append-only and cannot be modified — write a compensating record instead (DEC-014, DEC-034)', TG_TABLE_NAME
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.reject_mutation() is
  'Unconditional UPDATE and DELETE rejection, including for the service role. Attached to true append-only tables: ledger, order/delivery snapshots and history, audit log.';

-- ---------------------------------------------------------------------------
-- platform_staff — operator and admin membership (DEC-033)
-- ---------------------------------------------------------------------------

create table public.platform_staff (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  staff_role text not null check (staff_role in ('OPERATOR', 'ADMIN')),
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),

  constraint platform_staff_user_id_key unique (user_id)
);

comment on table public.platform_staff is
  'Operator/admin capability grant (DEC-033). The only role with no other domain table, so it gets one dedicated table rather than generic RBAC. Not to be confused with the deprecated profiles.role.';
comment on column public.platform_staff.user_id is
  'One active grant per user — see the unique constraint. A revoked grant is superseded, not deleted.';

create index platform_staff_active_idx
  on public.platform_staff (user_id)
  where revoked_at is null;

-- profiles → platform_staff is RESTRICT (docs/DATABASE_DESIGN.md § 19):
-- an operator's past authority must stay explicable alongside the audit log.
-- The FK above already specifies on delete restrict.

-- Revoked grants are still evidence of who had authority and when — never
-- deleted, only superseded via revoked_at.
create trigger platform_staff_reject_delete
  before delete on public.platform_staff
  for each row execute function public.reject_delete();

revoke all on public.platform_staff from anon, authenticated;
alter table public.platform_staff enable row level security;

-- ---------------------------------------------------------------------------
-- addresses — saved delivery addresses
-- ---------------------------------------------------------------------------
--
-- zone_id is a bare uuid with NO foreign key: the geo domain
-- (service_areas / zones / delivery_fee_bands) is deferred from this
-- migration set — see docs/DATABASE_MIGRATION_V1_REPORT.md "Deferred
-- Tables". The column is kept so a future migration can add the FK without
-- an application-visible schema change.

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text,
  recipient_name text not null,
  recipient_phone text not null,
  address_line text not null,
  landmark text,
  lat numeric(9, 6),
  lng numeric(9, 6),
  location geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null
      then st_setsrid(st_makepoint(lng, lat), 4326)::geography
      else null
    end
  ) stored,
  zone_id uuid, -- no FK yet — geo domain deferred, see migration report
  instructions text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.addresses is
  'Saved delivery addresses. Soft-delete only (archived_at) — an order snapshots the address text at creation time regardless (docs/DATABASE_DESIGN.md § 8), so editing or archiving an address never rewrites order history.';
comment on column public.addresses.zone_id is
  'Reserved for the geo domain (service_areas/zones), deferred from this migration set. No FK yet.';

create index addresses_active_idx
  on public.addresses (user_id)
  where archived_at is null;

-- At most one default address per user, among active (non-archived) rows.
create unique index addresses_one_default_idx
  on public.addresses (user_id)
  where is_default and archived_at is null;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- Hard delete is blocked; archived_at is the only removal path (§ 13).
create trigger addresses_reject_delete
  before delete on public.addresses
  for each row execute function public.reject_delete();

revoke all on public.addresses from anon, authenticated;
alter table public.addresses enable row level security;
