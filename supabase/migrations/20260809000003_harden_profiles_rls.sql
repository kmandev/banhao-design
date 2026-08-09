-- BANHAO — harden profiles RLS
--
-- Follows a pre-merge review of the foundation. Verified by executing
-- supabase/tests/rls_profiles_test.sql against PostgreSQL 16 + PostGIS.
--
-- WHAT THE REVIEW ASKED ABOUT (both measured, neither was an active bug):
--
--   * Infinite recursion — NOT present. The old UPDATE policy's subquery on
--     public.profiles terminated because the SELECT policy does not itself
--     reference profiles. Verified: updates succeeded, no 42P17.
--   * Privilege escalation — NOT present. Role escalation, INSERT of a
--     fabricated ADMIN row, DELETE, and id change were all rejected.
--
-- WHY THIS MIGRATION EXISTS ANYWAY — two real problems were found:
--
--   1. LATENT RECURSION. The old policy only avoided recursion by accident of
--      the current SELECT policy. The moment anyone adds a SELECT policy that
--      reads profiles (e.g. "admins can read all profiles", the single most
--      likely next policy), the UPDATE policy becomes genuinely recursive and
--      every update fails with 42P17. Depending on a policy NOT existing is a
--      trap for whoever writes it next.
--
--   2. PHONE WAS CLIENT-WRITABLE. Measured: a user successfully changed their
--      own profiles.phone. phone mirrors the Supabase Auth identity used for
--      OTP login, so a client rewriting it lets the profile drift from
--      auth.users and lets a user occupy a number they never proved they own.
--      The review did not raise this; it was found while testing.
--
-- APPROACH: stop expressing "which columns may change" in RLS at all. RLS
-- WITH CHECK sees only the new row and has no access to the old one, which is
-- exactly why the old policy had to query the table. Column privileges are the
-- right primitive for this, cost nothing at runtime, and cannot recurse.
--
-- Defence in depth, outermost first:
--   1. Column-level GRANT — a client may only write display_name.
--   2. RLS policies — a client may only touch its own row. No self-reference.
--   3. Trigger — rejects role/id/phone changes from any non-service session,
--      so a future over-broad GRANT cannot silently re-open escalation.

-- ---------------------------------------------------------------------------
-- 1. Column-level privileges
-- ---------------------------------------------------------------------------

-- Supabase grants ALL on public tables to anon/authenticated by default, so
-- revoke first and re-grant narrowly. Without this, table-level UPDATE would
-- cover every column.
revoke update on public.profiles from anon, authenticated;

-- display_name is the only column a client may write.
--
-- Deliberately excluded:
--   role  — server-assigned only; writable client-side is privilege escalation
--   id    — the auth.users foreign key; must never move
--   phone — the authentication identity; changing it belongs to Supabase Auth's
--           phone-change flow, which re-verifies ownership by OTP. If the
--           Product Owner wants self-service phone edits, add phone to this
--           grant AND remove it from the trigger below AND route the change
--           through Auth so auth.users stays in sync.
grant update (display_name) on public.profiles to authenticated;

-- Clients never create or remove profile rows: creation is the
-- on_auth_user_created trigger, deletion cascades from auth.users.
revoke insert, delete, truncate on public.profiles from anon, authenticated;

-- anon (signed-out) has no business reading profiles at all.
revoke select on public.profiles from anon;
grant select on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. RLS policies — no self-reference
-- ---------------------------------------------------------------------------

drop policy if exists profiles_update_own on public.profiles;

-- Row scope only. Which COLUMNS may change is enforced by the grants above,
-- so this expression never needs to read profiles and can never recurse.
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Recreate the read policy scoped to `authenticated` (it previously applied to
-- PUBLIC, which included anon).
drop policy if exists profiles_select_own on public.profiles;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- Still deliberately absent: INSERT and DELETE policies. With RLS enabled and
-- no policy, both are denied regardless of any GRANT.

-- ---------------------------------------------------------------------------
-- 3. Trigger — defence in depth
-- ---------------------------------------------------------------------------

create or replace function public.enforce_profile_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The service role (BYPASSRLS) is the trusted server-side path: the API,
  -- migrations, and admin tooling. Everything else is a client.
  if current_setting('role', true) = 'service_role'
     or pg_has_role(current_user, 'service_role', 'member') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'role is server-assigned and cannot be changed by a client'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'id is immutable'
      using errcode = '42501';
  end if;

  if new.phone is distinct from old.phone then
    raise exception 'phone is managed by Supabase Auth and cannot be changed directly'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.enforce_profile_immutable_columns() is
  'Rejects client changes to role/id/phone. Backstop in case a future GRANT is too broad.';

create trigger profiles_enforce_immutable_columns
  before update on public.profiles
  for each row execute function public.enforce_profile_immutable_columns();

-- ---------------------------------------------------------------------------
-- Trusted server-side path for role assignment
-- ---------------------------------------------------------------------------

-- Callable only by the service role, so promoting a user to MERCHANT/DRIVER/
-- ADMIN is one auditable entry point rather than an ad-hoc UPDATE.
create or replace function public.set_user_role(target_user_id uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'set_user_role may only be called by the service role'
      using errcode = '42501';
  end if;

  update public.profiles set role = new_role where id = target_user_id;

  if not found then
    raise exception 'no profile for user %', target_user_id using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_user_role(uuid, public.user_role) from public, anon, authenticated;
grant execute on function public.set_user_role(uuid, public.user_role) to service_role;

comment on function public.set_user_role(uuid, public.user_role) is
  'Trusted server-side role assignment. Service role only. See docs/DEVELOPMENT.md.';
