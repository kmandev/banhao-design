-- BANHAO — PC-Q-001 verification: unavailable catalog rows are visible
--
-- Run via: ./supabase/tests/run-domain-tests.sh
--
-- Proves BY EXECUTION, against real PostgreSQL with every migration applied,
-- that 20260817000001_catalog_availability_visibility.sql does exactly what the
-- Product Owner decision (Option A) asked for and nothing more:
--
--   A. An UNAVAILABLE menu item is readable by anon and by an authenticated
--      customer — this is the change.
--   B. An UNAVAILABLE option is readable by both — the change, for options.
--   C. Everything that was a visibility rule before still is: archived items
--      stay hidden, archived categories stay hidden, and rows belonging to a
--      non-ACTIVE restaurant stay hidden.
--   D. The member read path is unchanged and still scoped per restaurant.
--
-- Counting rows rather than asserting ALLOWED/BLOCKED matters here: RLS filters
-- rows, it does not raise. A `select` over a hidden row succeeds and returns
-- nothing, so "did not error" would prove nothing at all.

\set ON_ERROR_STOP on

create or replace function catalog_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

/** Row count visible to anon for an arbitrary query. */
create or replace function catalog_count_as_anon(stmt text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
  execute stmt into n;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

/** Row count visible to a specific authenticated user. */
create or replace function catalog_count_as_user(user_id uuid, stmt text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id)::text, true);
  execute stmt into n;
  perform set_config('role', 'postgres', true);
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures — ids are namespaced `ca……` so they cannot collide with the
-- domain-invariant fixtures loaded into the same database.
-- ---------------------------------------------------------------------------

\set CUSTOMER '\'ca000000-0000-0000-0000-0000000000c1\''
\set MEMBER   '\'ca000000-0000-0000-0000-0000000000b1\''

insert into auth.users (id) values (:CUSTOMER::uuid), (:MEMBER::uuid)
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values ('ca000000-0000-0000-0000-00000000d001', :MEMBER::uuid, 'PC-Q-001 merchant', 'ACTIVE')
on conflict (id) do nothing;

-- One ACTIVE storefront and one SUSPENDED one, so "still hidden" is proven
-- against a real row rather than assumed from the policy text.
insert into public.restaurants (id, merchant_id, name, status)
values
  ('ca000000-0000-0000-0000-00000000e001', 'ca000000-0000-0000-0000-00000000d001', 'ร้านเปิด',  'ACTIVE'),
  ('ca000000-0000-0000-0000-00000000e002', 'ca000000-0000-0000-0000-00000000d001', 'ร้านระงับ', 'SUSPENDED')
on conflict (id) do nothing;

insert into public.restaurant_members (restaurant_id, user_id, member_role)
values ('ca000000-0000-0000-0000-00000000e001', :MEMBER::uuid, 'OWNER')
on conflict (restaurant_id, user_id) do nothing;

insert into public.menu_categories (id, restaurant_id, name, archived_at)
values
  ('ca000000-0000-0000-0000-00000000f001', 'ca000000-0000-0000-0000-00000000e001', 'จานเดียว', null),
  ('ca000000-0000-0000-0000-00000000f002', 'ca000000-0000-0000-0000-00000000e001', 'เลิกขาย',  now()),
  ('ca000000-0000-0000-0000-00000000f003', 'ca000000-0000-0000-0000-00000000e002', 'ของร้านระงับ', null)
on conflict (id) do nothing;

insert into public.menu_items
  (id, restaurant_id, category_id, name, base_price_satang, is_available, archived_at)
values
  -- available, active restaurant — the control
  ('ca000000-0000-0000-0000-000000001001', 'ca000000-0000-0000-0000-00000000e001',
   'ca000000-0000-0000-0000-00000000f001', 'ส้มตำไทย', 6000, true, null),
  -- UNAVAILABLE, active restaurant — must now be VISIBLE (PC-Q-001)
  ('ca000000-0000-0000-0000-000000001002', 'ca000000-0000-0000-0000-00000000e001',
   'ca000000-0000-0000-0000-00000000f001', 'ตำซั่ว (หมดวันนี้)', 6500, false, null),
  -- archived — must stay hidden
  ('ca000000-0000-0000-0000-000000001003', 'ca000000-0000-0000-0000-00000000e001',
   'ca000000-0000-0000-0000-00000000f001', 'เมนูที่ลบแล้ว', 5000, true, now()),
  -- available but SUSPENDED restaurant — must stay hidden
  ('ca000000-0000-0000-0000-000000001004', 'ca000000-0000-0000-0000-00000000e002',
   'ca000000-0000-0000-0000-00000000f003', 'เมนูร้านระงับ', 5000, true, null)
on conflict (id) do nothing;

insert into public.menu_option_groups (id, menu_item_id, title, min_select, max_select)
values
  ('ca000000-0000-0000-0000-000000002001', 'ca000000-0000-0000-0000-000000001001', 'ระดับความเผ็ด', 1, 1),
  -- a group on the ARCHIVED item, to prove the parent chain still applies
  ('ca000000-0000-0000-0000-000000002002', 'ca000000-0000-0000-0000-000000001003', 'ของเมนูที่ลบแล้ว', 0, 1)
on conflict (id) do nothing;

insert into public.menu_options (id, group_id, label, price_delta_satang, is_available)
values
  ('ca000000-0000-0000-0000-000000003001', 'ca000000-0000-0000-0000-000000002001', 'เผ็ดน้อย', 0, true),
  -- UNAVAILABLE option — must now be VISIBLE (PC-Q-001)
  ('ca000000-0000-0000-0000-000000003002', 'ca000000-0000-0000-0000-000000002001', 'เผ็ดมาก (หมด)', 0, false),
  -- option under the archived item — must stay hidden
  ('ca000000-0000-0000-0000-000000003003', 'ca000000-0000-0000-0000-000000002002', 'ของเมนูที่ลบแล้ว', 0, true)
on conflict (id) do nothing;

-- ===========================================================================
-- A. THE CHANGE — unavailable menu items are visible to customers
-- ===========================================================================

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001002'
  $stmt$) = 1,
  'A1. anon CAN read an unavailable menu item (PC-Q-001 Option A)'
);

select catalog_assert(
  catalog_count_as_user(:CUSTOMER::uuid, $stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001002'
  $stmt$) = 1,
  'A2. an authenticated customer CAN read an unavailable menu item'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_items
     where restaurant_id = 'ca000000-0000-0000-0000-00000000e001'
  $stmt$) = 2,
  'A3. the active menu shows BOTH the available and the unavailable item'
);

-- ===========================================================================
-- B. THE CHANGE — unavailable options are visible to customers
-- ===========================================================================

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_options
     where id = 'ca000000-0000-0000-0000-000000003002'
  $stmt$) = 1,
  'B1. anon CAN read an unavailable menu option (PC-Q-001 Option A)'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_options
     where group_id = 'ca000000-0000-0000-0000-000000002001'
  $stmt$) = 2,
  'B2. the option group shows BOTH the available and the unavailable option'
);

-- ===========================================================================
-- C. UNCHANGED — everything that was a visibility rule still is
-- ===========================================================================

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001003'
  $stmt$) = 0,
  'C1. an ARCHIVED menu item is still hidden — archival is not availability'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001004'
  $stmt$) = 0,
  'C2. a menu item on a SUSPENDED restaurant is still hidden'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.restaurants
     where id = 'ca000000-0000-0000-0000-00000000e002'
  $stmt$) = 0,
  'C3. a SUSPENDED restaurant is still hidden'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_categories
     where id = 'ca000000-0000-0000-0000-00000000f002'
  $stmt$) = 0,
  'C4. an ARCHIVED menu category is still hidden'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_options
     where id = 'ca000000-0000-0000-0000-000000003003'
  $stmt$) = 0,
  'C5. an option under an ARCHIVED item is still hidden (parent chain intact)'
);

select catalog_assert(
  catalog_count_as_anon($stmt$
    select count(*) from public.menu_option_groups
     where id = 'ca000000-0000-0000-0000-000000002002'
  $stmt$) = 0,
  'C6. an option GROUP under an ARCHIVED item is still hidden'
);

-- ===========================================================================
-- D. Member path unchanged — still scoped, still no privileged bypass
-- ===========================================================================

select catalog_assert(
  catalog_count_as_user(:MEMBER::uuid, $stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001002'
  $stmt$) = 1,
  'D1. a member still reads their own unavailable item'
);

select catalog_assert(
  catalog_count_as_user(:MEMBER::uuid, $stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001003'
  $stmt$) = 1,
  'D2. a member still reads their own ARCHIVED item (member policy, unchanged)'
);

select catalog_assert(
  catalog_count_as_user(:CUSTOMER::uuid, $stmt$
    select count(*) from public.menu_items
     where id = 'ca000000-0000-0000-0000-000000001003'
  $stmt$) = 0,
  'D3. a NON-member customer still cannot read an archived item — no bypass'
);

-- ===========================================================================
-- E. Availability is not an authorization boundary — writes stay refused
-- ===========================================================================

do $$
declare
  allowed boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'ca000000-0000-0000-0000-0000000000c1')::text, true);
  begin
    update public.menu_items set is_available = true
     where id = 'ca000000-0000-0000-0000-000000001002';
    -- No write grant exists for `authenticated`, so this must not succeed.
    allowed := found;
  exception when others then
    allowed := false;
  end;
  perform set_config('role', 'postgres', true);

  perform catalog_assert(
    not allowed,
    'E1. a customer still CANNOT flip is_available — read visibility only'
  );
end;
$$;

select 'catalog availability (PC-Q-001): all assertions passed' as result;
