-- BANHAO — M-11 / M-12: transactional merchant catalog writes
--
-- Adds four `SECURITY INVOKER` functions, following the
-- `release_rider_assignment` / `create_order` precedent exactly. Purely
-- additive: no table, column, constraint, trigger, index, grant or RLS policy
-- on any existing object is modified. The schema stays LOCKED.
--
-- ===========================================================================
-- Why these four, and only these four
-- ===========================================================================
--
-- Most merchant catalog writes are a single statement against a single row —
-- create a dish, rename a category, flip `is_available`, set `archived_at`.
-- A single statement is already atomic, so those need no function and get
-- none; `MenuService` issues them directly through the service-role client,
-- exactly as `MenuItemImageService` already writes `menu_items.image_url`.
--
-- What genuinely cannot be expressed as one statement is here, and nothing
-- else is:
--
--   1. `replace_restaurant_hours`  — M-12. `restaurant_hours`'s own table
--      comment fixes the edit strategy: "the application deletes and
--      re-inserts a restaurant's rows rather than patching individual ones".
--      Outside a transaction a failure between the delete and the insert
--      leaves a restaurant with **no hours at all**, which the derived
--      open/closed reads as permanently closed. That is a correctness
--      requirement (M-12 §11 C-02), not an optimisation.
--
--   2. `reorder_menu_categories`   — M-11. Reordering rewrites several
--   3. `reorder_menu_items`          `sort_order` values at once; a partial
--                                    failure leaves a visibly scrambled menu
--                                    (M-11 §14 C-06).
--
--   4. `replace_menu_item_option_groups` — M-11 §06. An option group edit
--      adds, removes and reorders groups and their options together. The
--      same delete-and-re-insert shape as hours, and safe for the same
--      reason: `menu_option_groups` cascades from `menu_items` and carries
--      no `reject_delete` trigger, so unlike `menu_items` and
--      `menu_categories` these rows genuinely may be deleted. Nothing
--      historical points at them — `order_item_options` snapshots
--      `group_name_snapshot` and `option_name_snapshot` as text.
--
-- ===========================================================================
-- Authorization — deliberately NO new grant to `authenticated`
-- ===========================================================================
--
-- The M-11 and M-12 artifacts both record that `authenticated` holds `select`
-- only on every catalog table and that no merchant write path exists. The fix
-- is **not** to grant writes to `authenticated`: DEC-APP-008 puts every write
-- through NestJS, and a browser-side catalog write would contradict it.
--
-- So the client keeps exactly the privileges it has today, the API writes as
-- `service_role`, and these functions are `service_role`-only in the same way
-- `create_order` is. `SECURITY INVOKER`, not `DEFINER` — the caller is already
-- `service_role` and therefore already bypasses RLS; `DEFINER` would add a
-- privilege escalation path for no benefit, which is the reasoning
-- `release_rider_assignment` recorded first.
--
-- Every function re-checks `restaurant_id` ownership of the rows it touches.
-- The API has already proved membership by the time it calls, but a function
-- that trusts its arguments about which restaurant a row belongs to would let
-- one bug cross a tenant boundary.

-- ===========================================================================
-- replace_restaurant_hours — M-12
-- ===========================================================================
--
-- `p_hours` is a JSON array of objects, each `{ "dayOfWeek": 0-6,
-- "opensAt": "HH:MM", "closesAt": "HH:MM" }`. An empty array is meaningful
-- and legal: it means the restaurant has no opening hours at all, which the
-- derived open/closed correctly reads as closed. A day is closed by having
-- no entry — there is no `is_closed` column and none is invented here.
--
-- `day_of_week` semantics are **0 = Sunday … 6 = Saturday**, which is what
-- the deployed system already means everywhere it reads the column:
-- `apps/customer/src/lib/openingHours.ts`, `ShopScreen.tsx`'s weekday labels
-- and `supabase/seed-dev/catalog_dev_seed.sql` all say so explicitly. This
-- function neither reinterprets nor migrates anything — the `check
-- (day_of_week between 0 and 6)` on the table is unchanged and no stored row
-- changes meaning.
--
-- Ordering inside a day is not stored. `restaurant_hours` has no
-- `sort_order`, and intervals are totally ordered by `opens_at` anyway, so
-- reads sort by time rather than by insertion.

create or replace function public.replace_restaurant_hours(
  p_restaurant_id uuid,
  p_hours jsonb
)
returns table (day_of_week smallint, opens_at time, closes_at time)
language plpgsql
security invoker
as $$
declare
  v_exists boolean;
begin
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    raise exception 'replace_restaurant_hours: p_hours must be a JSON array';
  end if;

  select exists (select 1 from public.restaurants r where r.id = p_restaurant_id)
    into v_exists;

  if not v_exists then
    raise exception 'replace_restaurant_hours: restaurant % does not exist', p_restaurant_id;
  end if;

  -- Delete and re-insert, in this one transaction. The table comment names
  -- this as the intended edit strategy; the atomicity is what this function
  -- exists to add.
  delete from public.restaurant_hours h where h.restaurant_id = p_restaurant_id;

  insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
  select
    p_restaurant_id,
    (entry ->> 'dayOfWeek')::smallint,
    (entry ->> 'opensAt')::time,
    (entry ->> 'closesAt')::time
  from jsonb_array_elements(p_hours) as entry;

  -- The table's own `restaurant_hours_span_check` (closes_at > opens_at) and
  -- its 0–6 CHECK both fire on the INSERT above and abort the whole
  -- transaction, restoring the previous week. Nothing here re-implements
  -- them: a second copy of a constraint is a second thing to drift.

  return query
    select h.day_of_week, h.opens_at, h.closes_at
      from public.restaurant_hours h
     where h.restaurant_id = p_restaurant_id
     order by h.day_of_week, h.opens_at;
end;
$$;

comment on function public.replace_restaurant_hours(uuid, jsonb) is
  'M-12. Replaces a restaurant''s whole weekly schedule in one transaction — the delete-and-re-insert strategy restaurant_hours'' own table comment specifies, made atomic so a failure can never leave a restaurant with zero hours. day_of_week is 0 = Sunday … 6 = Saturday, matching every existing reader. SECURITY INVOKER; service_role only.';

revoke execute on function public.replace_restaurant_hours(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_restaurant_hours(uuid, jsonb) to service_role;

-- ===========================================================================
-- reorder_menu_categories — M-11 §07
-- ===========================================================================
--
-- `p_category_ids` is the complete new order. Position in the array becomes
-- `sort_order`, so the values stay a dense 0..n-1 sequence rather than
-- drifting into arbitrary integers.
--
-- Every id must belong to `p_restaurant_id`, and the array must name every
-- one of that restaurant's active categories exactly once. A partial list is
-- rejected rather than applied, because "reorder these three and leave the
-- rest wherever they were" has no well-defined result when sort_order is
-- being renumbered.

create or replace function public.reorder_menu_categories(
  p_restaurant_id uuid,
  p_category_ids uuid[]
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_supplied int := coalesce(array_length(p_category_ids, 1), 0);
  v_distinct int;
  v_owned int;
  v_active int;
begin
  select count(distinct id) into v_distinct from unnest(p_category_ids) as id;

  if v_distinct <> v_supplied then
    raise exception 'reorder_menu_categories: duplicate category id in the supplied order';
  end if;

  select count(*) into v_owned
    from public.menu_categories c
   where c.id = any (p_category_ids)
     and c.restaurant_id = p_restaurant_id
     and c.archived_at is null;

  if v_owned <> v_supplied then
    raise exception 'reorder_menu_categories: every id must be an active category of restaurant %', p_restaurant_id;
  end if;

  select count(*) into v_active
    from public.menu_categories c
   where c.restaurant_id = p_restaurant_id
     and c.archived_at is null;

  if v_active <> v_supplied then
    raise exception 'reorder_menu_categories: the supplied order must name all % active categories, got %', v_active, v_supplied;
  end if;

  update public.menu_categories c
     set sort_order = ordered.position
    from (
      select id, (ordinality - 1)::int as position
        from unnest(p_category_ids) with ordinality as t(id, ordinality)
    ) as ordered
   where c.id = ordered.id;

  return v_supplied;
end;
$$;

comment on function public.reorder_menu_categories(uuid, uuid[]) is
  'M-11 §07. Rewrites sort_order for all of a restaurant''s active menu categories in one transaction, so a partial failure cannot leave a scrambled menu. Position in the array becomes sort_order. SECURITY INVOKER; service_role only.';

revoke execute on function public.reorder_menu_categories(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_menu_categories(uuid, uuid[]) to service_role;

-- ===========================================================================
-- reorder_menu_items — M-11 §07
-- ===========================================================================
--
-- Scoped to one category, because `menu_items.sort_order` orders dishes
-- within their section — the overview renders category by category. Same
-- completeness rule as categories, for the same reason.

create or replace function public.reorder_menu_items(
  p_restaurant_id uuid,
  p_category_id uuid,
  p_menu_item_ids uuid[]
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_supplied int := coalesce(array_length(p_menu_item_ids, 1), 0);
  v_distinct int;
  v_owned int;
  v_active int;
begin
  select count(distinct id) into v_distinct from unnest(p_menu_item_ids) as id;

  if v_distinct <> v_supplied then
    raise exception 'reorder_menu_items: duplicate menu item id in the supplied order';
  end if;

  select count(*) into v_owned
    from public.menu_items mi
   where mi.id = any (p_menu_item_ids)
     and mi.restaurant_id = p_restaurant_id
     and mi.category_id = p_category_id
     and mi.archived_at is null;

  if v_owned <> v_supplied then
    raise exception 'reorder_menu_items: every id must be an active item of category % in restaurant %', p_category_id, p_restaurant_id;
  end if;

  select count(*) into v_active
    from public.menu_items mi
   where mi.restaurant_id = p_restaurant_id
     and mi.category_id = p_category_id
     and mi.archived_at is null;

  if v_active <> v_supplied then
    raise exception 'reorder_menu_items: the supplied order must name all % active items, got %', v_active, v_supplied;
  end if;

  update public.menu_items mi
     set sort_order = ordered.position
    from (
      select id, (ordinality - 1)::int as position
        from unnest(p_menu_item_ids) with ordinality as t(id, ordinality)
    ) as ordered
   where mi.id = ordered.id;

  return v_supplied;
end;
$$;

comment on function public.reorder_menu_items(uuid, uuid, uuid[]) is
  'M-11 §07. Rewrites sort_order for all active dishes in one category, in one transaction. Position in the array becomes sort_order. SECURITY INVOKER; service_role only.';

revoke execute on function public.reorder_menu_items(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_menu_items(uuid, uuid, uuid[]) to service_role;

-- ===========================================================================
-- replace_menu_item_option_groups — M-11 §06
-- ===========================================================================
--
-- `p_groups` is a JSON array of
--   { "title": text,
--     "minSelect": int, "maxSelect": int,
--     "options": [ { "label": text, "priceDeltaSatang": bigint,
--                    "isAvailable": bool } ] }
--
-- Array position becomes `sort_order` at both levels. An empty array removes
-- every option group from the dish, which is a legitimate edit.
--
-- Ids are not accepted and not preserved: every group and option is
-- recreated. That is safe precisely because nothing durable references them —
-- `order_item_options` stores `group_name_snapshot` and `option_name_snapshot`
-- as text, and its `menu_option_id` is nullable. `cart_item_options` does
-- reference `menu_options`; a cascade delete there removes a stale selection
-- from an open cart, which is the correct outcome when the merchant has just
-- deleted that choice, and the customer app already revalidates a cart at
-- checkout (`POST /cart/validate`).

create or replace function public.replace_menu_item_option_groups(
  p_menu_item_id uuid,
  p_groups jsonb
)
returns integer
language plpgsql
security invoker
as $$
declare
  v_exists boolean;
  v_group record;
  v_group_id uuid;
  v_group_count int := 0;
begin
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'replace_menu_item_option_groups: p_groups must be a JSON array';
  end if;

  select exists (select 1 from public.menu_items mi where mi.id = p_menu_item_id)
    into v_exists;

  if not v_exists then
    raise exception 'replace_menu_item_option_groups: menu item % does not exist', p_menu_item_id;
  end if;

  -- menu_options cascades from menu_option_groups, so one delete clears both
  -- levels. Neither table carries reject_delete — unlike menu_items and
  -- menu_categories, these rows are genuinely deletable.
  delete from public.menu_option_groups g where g.menu_item_id = p_menu_item_id;

  for v_group in
    select
      (entry ->> 'title') as title,
      (entry ->> 'minSelect')::smallint as min_select,
      (entry ->> 'maxSelect')::smallint as max_select,
      coalesce(entry -> 'options', '[]'::jsonb) as options,
      (ordinality - 1)::int as position
    from jsonb_array_elements(p_groups) with ordinality as t(entry, ordinality)
  loop
    insert into public.menu_option_groups (menu_item_id, title, min_select, max_select, sort_order)
    values (p_menu_item_id, v_group.title, v_group.min_select, v_group.max_select, v_group.position)
    returning id into v_group_id;

    insert into public.menu_options (group_id, label, price_delta_satang, is_available, sort_order)
    select
      v_group_id,
      (opt ->> 'label'),
      coalesce((opt ->> 'priceDeltaSatang')::bigint, 0),
      coalesce((opt ->> 'isAvailable')::boolean, true),
      (opt_ordinality - 1)::int
    from jsonb_array_elements(v_group.options) with ordinality as o(opt, opt_ordinality);

    v_group_count := v_group_count + 1;
  end loop;

  return v_group_count;
end;
$$;

comment on function public.replace_menu_item_option_groups(uuid, jsonb) is
  'M-11 §06. Replaces a dish''s option groups and their options wholesale in one transaction. Array position becomes sort_order at both levels. Safe to recreate rows because order history snapshots option names as text. SECURITY INVOKER; service_role only.';

revoke execute on function public.replace_menu_item_option_groups(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_menu_item_option_groups(uuid, jsonb) to service_role;
