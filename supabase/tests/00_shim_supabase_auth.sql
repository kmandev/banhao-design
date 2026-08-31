-- Minimal Supabase-equivalent auth shim, for LOCAL RLS TESTING ONLY.
--
-- This file is NOT a migration and is never applied to a real Supabase project
-- (Supabase provides all of this already). It exists so the RLS policies in
-- supabase/migrations can be executed and tested against a plain PostgreSQL
-- container, since RLS recursion and column privileges are core PostgreSQL
-- behaviour rather than anything Supabase-specific.
--
-- It reproduces the parts of Supabase the policies actually depend on:
--   - an `auth` schema with a `users` table (profiles.id references it)
--   - `auth.uid()` reading the JWT subject from a GUC, exactly as Supabase does
--   - the `anon`, `authenticated`, and `service_role` database roles
--   - the `supabase_realtime` publication every Supabase project is
--     bootstrapped with (empty here — migrations add their own tables to it,
--     same as on the real platform)

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  email text unique,
  created_at timestamptz not null default now()
);

-- Supabase reads the authenticated user id from the request's JWT claims,
-- exposed to SQL via the `request.jwt.claims` setting.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

-- Supabase's three client-facing database roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS mirrors how the service role key behaves in Supabase.
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase provisions an empty `supabase_realtime` publication on every
-- project; migrations then add specific tables to it (e.g.
-- 20260831000001_orders_realtime_publication.sql). Vanilla PostgreSQL has no
-- such publication, so it is created here, empty, exactly as the platform
-- would hand it to a fresh project — no table is added by this shim.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Reproduce Supabase's permissive default: every table created in `public`
-- afterwards automatically grants ALL to anon and authenticated, leaving RLS
-- and column privileges as the only protection.
--
-- This must be set BEFORE the migrations run, so `profiles` is created in the
-- same over-permissive starting state a real Supabase project would give it.
-- The tests then measure what the migrations actually take away — if a test
-- fixture granted these itself, the suite would be verifying its own setup
-- rather than the migration.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
