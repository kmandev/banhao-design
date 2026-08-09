-- BANHAO — user profiles and roles
--
-- Identity lives in Supabase Auth (auth.users). This adds the application-owned
-- profile row carrying role and display data.
--
-- Role is a database enum so an invalid role cannot be written at all, and so
-- authorization has a single server-side source of truth. A client can never
-- assign or change its own role — see the RLS policies below.

create type public.user_role as enum ('CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'CUSTOMER',
  phone text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application user profile. One row per auth.users record. Role is authoritative for authorization.';
comment on column public.profiles.role is
  'Server-controlled. Clients cannot write this column (see RLS policy profiles_update_own).';

create index profiles_role_idx on public.profiles (role);
create unique index profiles_phone_idx on public.profiles (phone) where phone is not null;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile when a user signs up
--
-- Phase 1 signs up via Phone OTP, so phone is copied across when present.
-- Role always defaults to CUSTOMER; elevating a user to MERCHANT/DRIVER/ADMIN
-- is a deliberate backend action, never a side effect of signing up.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Kept deliberately minimal for the foundation. The API enforces authorization
-- in its own guards using the service-role key (which bypasses RLS); these
-- policies protect the table from direct client access with the anon key.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- A user may read their own profile.
create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);

-- A user may update their own profile, but NOT their role.
-- The role check compares against the existing row, so any attempt to change it
-- fails regardless of what the client sends.
create policy profiles_update_own
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- Deliberately absent: INSERT and DELETE policies for clients.
-- Profile creation happens via the on_auth_user_created trigger; deletion
-- cascades from auth.users. Neither should be client-initiated.
