-- ===========================================================================
-- BANHAO — G-7.1 (Driver Offer Inbox) live fixture provisioning
--
--   ####  FOR `banhao-dev` (ref yssnwnboiwldogmlvvlw) ONLY.  ####
--   ####  NEVER run this against production.                ####
--   ####  NEVER wire this into CI/CD or any deploy workflow. ####
--
-- Design authority: docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md — read it before
-- editing this file. This file implements §3 (fixture spec), §5 (provisioning
-- mechanism) and the G-7 abort guard from §7. Where this file and the design
-- doc disagree, the design doc wins; fix this file, not the doc.
--
-- WHAT THIS FILE DOES
--   1. Resolves four EXISTING Supabase Auth accounts by phone number — it
--      never creates one. `RAISE EXCEPTION` if any is missing.
--   2. Aborts the whole transaction if any resolved identity collides with
--      the locked G-7 fixture (recorded in the design doc §7.0).
--   3. Provisions three permanent rider fixtures (RIDER_A, RIDER_B —
--      APPROVED; NON_APPROVED_RIDER — PENDING_APPROVAL) plus their
--      `rider_availability` rows (RIDER_A/B only).
--   4. Provisions two disposable order → delivery → offer triples: a
--      PENDING baseline (Test C/D/E/M/N/O/P/Q raw material) and an
--      already-expired offer (Test I). Every other consumptive scenario
--      (F/G/H/J/K/L/R) needs its OWN fresh triple — see the template block
--      at the end of this file, which is inert until copied and edited.
--
-- WHAT THIS FILE NEVER DOES
--   * No raw `insert into auth.users` — every identity is resolved, never
--     fabricated (this is the one hard difference from
--     `catalog_dev_seed.sql`'s synthetic merchant owner, which never signs
--     in and therefore could be raw-inserted; every G-7.1 rider must be able
--     to sign in on a real device, so it cannot be).
--   * No `TRUNCATE`, `DROP`, `DELETE`, or `UPDATE` of any row it did not
--     create in this same run.
--   * No write to `supabase/migrations/`, no DDL, no new policy, no new
--     function, no `ALTER TABLE`.
--   * No touch of `merchants`, `restaurants`, `menu_*` — the dev catalog
--     restaurant is reused exactly as `catalog_dev_seed.sql` created it.
--   * No write to `order_number_counters` — `G71-` order numbers are
--     hand-assigned and cannot collide with `create_order()`'s `BH-…` scheme.
--   * No change to `ACCEPT_WINDOW_SECONDS` (still 60s, DEC-037, unchanged in
--     code) — the 60-minute `expires_at` on the PENDING baseline offer below
--     is fixture data only, sized for manual acceptance, not a new decision.
--
-- SAFETY PROPERTIES
--   * Idempotent for the permanent identities — `on conflict (id) do
--     nothing`. Re-running this file does not re-create or overwrite an
--     already-provisioned rider or its availability row (their live state,
--     e.g. `active_delivery_count` moved by a real accept, is never
--     silently reset by a re-run).
--   * Namespaced — every row this file creates uses the reserved
--     `67100000-…` id prefix, distinct from `dede0000-…` (catalog seed) and
--     `a9/b9/d9/e9/f9/99000000-…` (order-creation domain tests). Order
--     numbers are `G71-…`, distinct from `BH-YYYYMMDD-NNNN`.
--   * Isolated identity — resolves EXISTING Auth users by phone; provisions
--     no Auth account itself.
--   * Fails closed on the locked G-7 fixture — see the `DO` block below.
--   * `rider_earning_satang` is never written (BQ-029 is `OPEN`).
--
-- PREREQUISITE (must be done by a human, outside this file, before running
-- it — this file's own guard will RAISE EXCEPTION and abort cleanly if it
-- is not):
--   In the Supabase Dashboard → Auth → Phone → Test OTP, add these four
--   phone/code pairs, then sign in ONCE per account through the Driver App
--   (riders) or any OTP-capable client (customer) so `auth.users` and the
--   trigger-created `profiles` row exist:
--     RIDER_A              +66811110001
--     RIDER_B               +66811110002
--     NON_APPROVED_RIDER    +66811110003
--     CUSTOMER               +66811110009
--   This file cannot perform that step — Test OTP configuration is a
--   Dashboard / Management-API action with no equivalent in this file's
--   execution context, and this file must never fabricate a session
--   (CLAUDE.md "Never fabricate a session to make authenticated screens
--   reachable").
--
--   STATUS as of 2026-08-26 — all four Auth accounts ALREADY EXIST on
--   banhao-dev, provisioned with `auth.admin.createUser({ phone,
--   phone_confirm: true })` (an official Supabase mechanism; no raw
--   auth.users insert was used). Their ids, for operator cross-checking:
--     RIDER_A             18c3a27c-d298-4a31-b512-4a01220786d4
--     RIDER_B             caf2cf17-01ea-4c21-a92c-cc07c6565459
--     NON_APPROVED_RIDER  3f6f98a8-ac07-4949-b0d4-8defed3e23bd
--     CUSTOMER            d25a51f9-93fb-48af-b208-512883ad4640
--   What is still missing is the Test-OTP MAP ENTRY for each number —
--   without it `signInWithOtp` returns "Unable to get SMS provider" and no
--   rider can obtain a session. This file does not depend on that (it
--   resolves ids, not sessions) and can be run before it is fixed; the live
--   acceptance tests cannot.
--
-- LOCKED G-7 FIXTURE — NEVER TOUCHED, NEVER REUSED (design doc §7.0):
--     riders.id   a0d763a3-16ca-4b6c-adf0-59ece258587f
--     user_id     fd073d3e-0bca-4a22-8e3d-0a01eea18870
--     phone       not available — the guard below deliberately does not
--                 compare on phone, only on the two ids above.
-- ===========================================================================

begin;

do $$
declare
  v_rider_a_user_id          uuid;
  v_rider_b_user_id          uuid;
  v_non_approved_user_id     uuid;
  v_customer_user_id         uuid;

  -- Locked G-7 fixture — see docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md §7.0.
  -- Recorded as constants here, not looked up, because the whole point of
  -- this guard is to fail even if a *coincidental* collision occurred —
  -- comparing against a live-read value would not catch that.
  c_g7_rider_id   constant uuid := 'a0d763a3-16ca-4b6c-adf0-59ece258587f';
  c_g7_user_id    constant uuid := 'fd073d3e-0bca-4a22-8e3d-0a01eea18870';

  -- G-7.1 fixture identities — the `67100000-…` namespace (design §3.0).
  c_rider_a_id            constant uuid := '67100000-0000-4000-8000-0000000000a1';
  c_rider_b_id            constant uuid := '67100000-0000-4000-8000-0000000000a2';
  c_non_approved_id       constant uuid := '67100000-0000-4000-8000-0000000000a3';

  -- Reused, not created — the existing ACTIVE dev catalog restaurant
  -- (supabase/seed-dev/catalog_dev_seed.sql).
  c_restaurant_id         constant uuid := 'dede0000-0000-4000-8000-00000000c001';
  c_restaurant_lat        constant numeric := 14.780000;
  c_restaurant_lng        constant numeric := 105.420000;

  -- Disposable baseline triple #1 — PENDING offer, live 60-minute window.
  -- Raw material for Tests C/D/E/M/N/O/P/Q. Consumed by an accept/decline
  -- during acceptance testing; a fresh triple (see the template block at
  -- the end of this file) is required for each such test — this row is not
  -- reused across them.
  c_order_pending_id      constant uuid := '67100000-0000-4000-8000-000000010001';
  c_delivery_pending_id   constant uuid := '67100000-0000-4000-8000-000000020001';
  c_offer_pending_id      constant uuid := '67100000-0000-4000-8000-000000030001';

  -- Disposable baseline triple #2 — already-EXPIRED offer, for Test I.
  -- `outcome` stays 'PENDING' deliberately: the client filters on outcome
  -- only, not expires_at (apps/driver/src/data/riderOfferQueries.ts), so a
  -- PENDING+past-expiry row is exactly what makes the row visible in the
  -- inbox and refused with OFFER_EXPIRED on accept/decline.
  c_order_expired_id      constant uuid := '67100000-0000-4000-8000-000000010002';
  c_delivery_expired_id   constant uuid := '67100000-0000-4000-8000-000000020002';
  c_offer_expired_id      constant uuid := '67100000-0000-4000-8000-000000030002';
begin
  -----------------------------------------------------------------------
  -- 1. Resolve existing Auth accounts by phone. Never fabricated.
  -----------------------------------------------------------------------
  -- NOTE: GoTrue stores E.164 phone numbers WITHOUT the leading '+'
  -- (verified live on banhao-dev: `auth.users.phone` = '66811110001', and the
  -- locked G-7 account's is '66800000099'). Both forms are matched so this
  -- resolution is correct regardless of how a future account was enrolled —
  -- matching only '+66…' silently finds nothing and would fire the
  -- "not found" RAISE below on a fixture that actually exists.
  select id into v_rider_a_user_id      from auth.users where phone in ('66811110001', '+66811110001');
  select id into v_rider_b_user_id      from auth.users where phone in ('66811110002', '+66811110002');
  select id into v_non_approved_user_id from auth.users where phone in ('66811110003', '+66811110003');
  select id into v_customer_user_id     from auth.users where phone in ('66811110009', '+66811110009');

  if v_rider_a_user_id is null then
    raise exception 'G-7.1 fixture: RIDER_A Auth account (phone +66811110001) not found. Provision it in the Supabase Dashboard (Auth -> Phone -> Test OTP) and sign in once through the Driver App before running this script.';
  end if;

  if v_rider_b_user_id is null then
    raise exception 'G-7.1 fixture: RIDER_B Auth account (phone +66811110002) not found. Provision it in the Supabase Dashboard (Auth -> Phone -> Test OTP) and sign in once through the Driver App before running this script. Use a genuinely separate device/session from RIDER_A.';
  end if;

  if v_non_approved_user_id is null then
    raise exception 'G-7.1 fixture: NON_APPROVED_RIDER Auth account (phone +66811110003) not found. Provision it in the Supabase Dashboard (Auth -> Phone -> Test OTP) and sign in once through the Driver App before running this script.';
  end if;

  if v_customer_user_id is null then
    raise exception 'G-7.1 fixture: CUSTOMER Auth account (phone +66811110009) not found. Provision it in the Supabase Dashboard (Auth -> Phone -> Test OTP) and complete one OTP sign-in (any OTP-capable client) before running this script.';
  end if;

  -----------------------------------------------------------------------
  -- 2. G-7 ABORT GUARD — must run before any INSERT below.
  --
  -- Two independent checks: the resolved Auth user ids (would catch an
  -- operator accidentally reusing the G-7 rider's real phone/account for a
  -- G-7.1 slot) and the fixture rider id literals themselves (would catch
  -- a copy-paste error in this file). Deliberately does NOT compare on
  -- phone — the G-7 fixture's phone is not recorded (design doc §7.0) and
  -- none may be invented to fill that gap.
  -----------------------------------------------------------------------
  if v_rider_a_user_id = c_g7_user_id
     or v_rider_b_user_id = c_g7_user_id
     or v_non_approved_user_id = c_g7_user_id
     or v_customer_user_id = c_g7_user_id
  then
    raise exception 'G-7.1 ABORT: a resolved Auth user_id matches the locked G-7 fixture user_id (%). Refusing to provision — the G-7 fixture must never be reused as a G-7.1 fixture.', c_g7_user_id;
  end if;

  if c_rider_a_id = c_g7_rider_id
     or c_rider_b_id = c_g7_rider_id
     or c_non_approved_id = c_g7_rider_id
  then
    raise exception 'G-7.1 ABORT: a G-7.1 fixture rider id literal matches the locked G-7 rider id (%). Refusing to provision.', c_g7_rider_id;
  end if;

  -----------------------------------------------------------------------
  -- 3. Riders — permanent once written (riders_reject_delete forbids
  --    DELETE for every role). `on conflict do nothing`: a re-run never
  --    rewrites `status`/`approved_at` on an already-provisioned rider.
  -----------------------------------------------------------------------
  insert into public.riders (id, user_id, full_name, status, approved_at)
  values (c_rider_a_id, v_rider_a_user_id, 'ไรเดอร์ทดสอบ A (g71 fixture)', 'APPROVED', now())
  on conflict (id) do nothing;

  insert into public.riders (id, user_id, full_name, status, approved_at)
  values (c_rider_b_id, v_rider_b_user_id, 'ไรเดอร์ทดสอบ B (g71 fixture)', 'APPROVED', now())
  on conflict (id) do nothing;

  -- PENDING_APPROVAL, never online, never approved — Test B / Test L.
  -- Never promoted to APPROVED; see design doc §8.4.
  insert into public.riders (id, user_id, full_name, status)
  values (c_non_approved_id, v_non_approved_user_id, 'ไรเดอร์รออนุมัติ C (g71 fixture)', 'PENDING_APPROVAL')
  on conflict (id) do nothing;

  -----------------------------------------------------------------------
  -- 4. rider_availability — RIDER_A / RIDER_B only. NON_APPROVED_RIDER
  --    gets no row at all (design doc §3.3) — it has no operational
  --    dispatch-eligibility state to hold.
  --
  --    `location` is a GENERATED column (last_lat/last_lng) — never
  --    inserted directly.
  -----------------------------------------------------------------------
  insert into public.rider_availability
    (rider_id, is_online, last_lat, last_lng, location_updated_at, active_delivery_count)
  values
    (c_rider_a_id, true, 14.780000, 105.230000, now(), 0)
  on conflict (rider_id) do nothing;

  insert into public.rider_availability
    (rider_id, is_online, last_lat, last_lng, location_updated_at, active_delivery_count)
  values
    (c_rider_b_id, true, 14.782000, 105.232000, now(), 0)
  on conflict (rider_id) do nothing;

  -----------------------------------------------------------------------
  -- 5. Disposable baseline #1 — order (PREPARING) -> delivery
  --    (RIDER_SEARCHING) -> offer to RIDER_A (PENDING, 60-minute window).
  --
  --    Money: delivery_fee_satang = 1000 (DEC-035, ฿10), service_fee_satang
  --    = 500 (DEC-036, ฿5) — the APPROVED amounts, never
  --    apps/customer/src/mocks/pricing.ts's stale SAMPLE_DELIVERY_FEE_SATANG.
  --    subtotal + delivery_fee + service_fee - discount = grand_total
  --    (orders_total_check): 8000 + 1000 + 500 - 0 = 9500.
  --
  --    Only NOT NULL / operationally-relevant columns are set — no
  --    order_items are created (no CHECK or FK requires them, and G-7.1
  --    exercises the offer/delivery surface only, never order contents).
  -----------------------------------------------------------------------
  insert into public.orders (
    id, order_number, state, customer_id, restaurant_id,
    restaurant_name_snapshot, delivery_address_snapshot,
    recipient_name_snapshot, recipient_phone_snapshot,
    payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
    grand_total_satang
  )
  values (
    c_order_pending_id, 'G71-BASELINE-0001', 'PREPARING', v_customer_user_id, c_restaurant_id,
    'ร้านส้มตำป้าทองดี (dev)', 'บ้านทดสอบ G7.1 เลขที่ 1 ต.บุณฑริก อ.บุณฑริก (g71 fixture)',
    'ลูกค้าทดสอบ G7.1 (g71 fixture)', '+66811110009',
    'ONLINE', 8000, 1000, 500,
    9500
  )
  on conflict (id) do nothing;

  insert into public.deliveries (
    id, order_id, state, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
  )
  values (
    c_delivery_pending_id, c_order_pending_id, 'RIDER_SEARCHING',
    c_restaurant_lat, c_restaurant_lng, 14.775000, 105.415000
  )
  on conflict (id) do nothing;

  insert into public.rider_assignment_attempts (
    id, delivery_id, rider_id, round_no, offered_at, expires_at, outcome
  )
  values (
    c_offer_pending_id, c_delivery_pending_id, c_rider_a_id, 1, now(), now() + interval '60 minutes', 'PENDING'
  )
  on conflict (id) do nothing;

  -----------------------------------------------------------------------
  -- 6. Disposable baseline #2 — same shape, but expires_at is already in
  --    the past. Test I (OFFER_EXPIRED) reads and acts on this one.
  -----------------------------------------------------------------------
  insert into public.orders (
    id, order_number, state, customer_id, restaurant_id,
    restaurant_name_snapshot, delivery_address_snapshot,
    recipient_name_snapshot, recipient_phone_snapshot,
    payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
    grand_total_satang
  )
  values (
    c_order_expired_id, 'G71-EXPIRED-0001', 'PREPARING', v_customer_user_id, c_restaurant_id,
    'ร้านส้มตำป้าทองดี (dev)', 'บ้านทดสอบ G7.1 เลขที่ 2 ต.บุณฑริก อ.บุณฑริก (g71 fixture)',
    'ลูกค้าทดสอบ G7.1 (g71 fixture)', '+66811110009',
    'ONLINE', 8000, 1000, 500,
    9500
  )
  on conflict (id) do nothing;

  insert into public.deliveries (
    id, order_id, state, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng
  )
  values (
    c_delivery_expired_id, c_order_expired_id, 'RIDER_SEARCHING',
    c_restaurant_lat, c_restaurant_lng, 14.776000, 105.416000
  )
  on conflict (id) do nothing;

  insert into public.rider_assignment_attempts (
    id, delivery_id, rider_id, round_no, offered_at, expires_at, outcome
  )
  values (
    c_offer_expired_id, c_delivery_expired_id, c_rider_a_id, 1, now() - interval '2 minutes', now() - interval '1 minute', 'PENDING'
  )
  on conflict (id) do nothing;

  raise notice 'G-7.1 fixture provisioning complete: riders %, %, % ; baseline offer % ; expired offer %',
    c_rider_a_id, c_rider_b_id, c_non_approved_id, c_offer_pending_id, c_offer_expired_id;
end $$;

commit;

-- ===========================================================================
-- TEMPLATE — one additional disposable triple, for a single consumptive
-- scenario (F, G, H, J, K, L, M, N, O, Q, R). Inert as written: copy this
-- block, pick a fresh unused suffix in the `67100000-…-0000030xxx` family
-- (increment past the highest one already used, including by prior copies
-- of this template), give it a distinct `order_number` suffix, and adjust
-- `rider_id`/`state`/`expires_at` for the scenario before running it as its
-- own statement. Do not uncomment and run this block unedited — the ids
-- below are placeholders and would collide with baseline triple #1 above.
--
-- do $$
-- declare
--   c_order_id    constant uuid := '67100000-0000-4000-8000-0000000100XX';
--   c_delivery_id constant uuid := '67100000-0000-4000-8000-0000002000XX';
--   c_offer_id    constant uuid := '67100000-0000-4000-8000-0000003000XX';
--   c_rider_a_id  constant uuid := '67100000-0000-4000-8000-0000000000a1';
--   c_restaurant_id constant uuid := 'dede0000-0000-4000-8000-00000000c001';
-- begin
--   insert into public.orders (
--     id, order_number, state, customer_id, restaurant_id,
--     restaurant_name_snapshot, delivery_address_snapshot,
--     recipient_name_snapshot, recipient_phone_snapshot,
--     payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
--     grand_total_satang
--   )
--   select
--     c_order_id, 'G71-<SCENARIO>-0001', 'PREPARING', id, c_restaurant_id,
--     'ร้านส้มตำป้าทองดี (dev)', 'บ้านทดสอบ G7.1 (g71 fixture)',
--     'ลูกค้าทดสอบ G7.1 (g71 fixture)', '+66811110009',
--     'ONLINE', 8000, 1000, 500, 9500
--   from auth.users where phone = '+66811110009'
--   on conflict (id) do nothing;
--
--   insert into public.deliveries (id, order_id, state, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
--   values (c_delivery_id, c_order_id, 'RIDER_SEARCHING', 14.780000, 105.420000, 14.775000, 105.415000)
--   on conflict (id) do nothing;
--
--   insert into public.rider_assignment_attempts (id, delivery_id, rider_id, round_no, offered_at, expires_at, outcome)
--   values (c_offer_id, c_delivery_id, c_rider_a_id, 1, now(), now() + interval '60 minutes', 'PENDING')
--   on conflict (id) do nothing;
-- end $$;
-- ===========================================================================
