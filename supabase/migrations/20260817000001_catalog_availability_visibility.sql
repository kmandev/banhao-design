-- BANHAO — PC-Q-001: unavailable catalog rows are visible to customers
--
-- Product Owner decision, Option A. This migration removes the `is_available`
-- predicate from the two PUBLIC catalog read policies, and changes nothing else.
--
-- WHY
--
-- `20260811000011_rls_policies.sql` gave `menu_items_select_active` and
-- `menu_options_select_active` an `is_available` condition, which made a
-- sold-out dish invisible to customers entirely. That conflicts with the UX
-- contract in docs/design/BANHAO-UX-SPEC-V1.md § 5.3:
--
--   "Unavailable items are shown greyed with `วันนี้หมด` and are not tappable —
--    hiding them makes the menu inconsistent with what a customer saw yesterday."
--
-- The underlying mistake was categorical: availability is a *business state*
-- attribute of a row, not an authorization boundary. Whether a shop has run out
-- of som tam today is not a secret, and RLS is not the place to express it. The
-- customer app is responsible for rendering an unavailable item as unavailable
-- and for refusing to add it to a cart; that is presentation and interaction,
-- enforced where the interaction happens.
--
-- The policies were also inconsistent with themselves: `menu_items_select_member`
-- and `menu_options_select_member` never had an availability predicate, so a
-- user who happened to be a member of a restaurant already saw its unavailable
-- rows while every other customer did not. After this migration both audiences
-- see the same rows, and the difference between them is scope — which is what
-- an authorization policy should actually be about.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--
-- Every security predicate is reproduced verbatim from the original policies:
--
--   * `restaurants.status = 'ACTIVE'` — a DRAFT, SUSPENDED or CLOSED storefront
--     stays invisible to the public.
--   * `menu_items.archived_at is null` — a deleted dish stays deleted. Archival
--     is removal; availability is "not today". They are different facts and only
--     one of them is a visibility rule.
--   * The full parent chain for options: group → item → restaurant, including
--     the item's archived check and the restaurant's ACTIVE check.
--
-- No grant is altered, no table, column or index is touched, no member policy is
-- modified, and no privileged bypass is introduced. `menu_categories`,
-- `menu_option_groups`, `restaurant_hours` and `restaurants` policies are left
-- exactly as they are — none of them carried an availability predicate.
--
-- Note that `menu_option_groups` has no `archived_at` column, so the options
-- policy below checks the *item's* archived state, exactly as the original did.
--
-- The schema is LOCKED: this file replaces the two policies rather than editing
-- the migration that created them.

-- ---------------------------------------------------------------------------
-- menu_items — public read, availability no longer restricts visibility
-- ---------------------------------------------------------------------------

drop policy if exists menu_items_select_active on public.menu_items;

create policy menu_items_select_active
  on public.menu_items
  for select
  to anon, authenticated
  using (
    archived_at is null
    and exists (
      select 1 from public.restaurants r
      where r.id = menu_items.restaurant_id and r.status = 'ACTIVE'
    )
  );

comment on policy menu_items_select_active on public.menu_items is
  'PC-Q-001 (Option A): unavailable items ARE visible to customers so the app can render `วันนี้หมด` (UX-SPEC § 5.3). Availability is business state, not authorization. Archival and restaurant status remain visibility rules and are unchanged.';

-- ---------------------------------------------------------------------------
-- menu_options — same correction, same parent-chain guarantees
-- ---------------------------------------------------------------------------

drop policy if exists menu_options_select_active on public.menu_options;

create policy menu_options_select_active
  on public.menu_options
  for select
  to anon, authenticated
  using (
    exists (
      select 1
        from public.menu_option_groups g
        join public.menu_items mi on mi.id = g.menu_item_id
        join public.restaurants r on r.id = mi.restaurant_id
       where g.id = menu_options.group_id
         and mi.archived_at is null
         and r.status = 'ACTIVE'
    )
  );

comment on policy menu_options_select_active on public.menu_options is
  'PC-Q-001 (Option A): unavailable options ARE visible to customers so the app can show them as unselectable. The group → item → restaurant chain, the item archived check and the restaurant ACTIVE check are reproduced unchanged from 20260811000011.';
