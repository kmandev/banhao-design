-- ===========================================================================
-- BANHAO — M-05 live verification fixtures: disposable PAID orders
--
--   ####  FOR `banhao-dev` (ref yssnwnboiwldogmlvvlw) ONLY.  ####
--   ####  NEVER run this against production.                ####
--   ####  NEVER wire this into CI/CD or any deploy workflow. ####
--
-- FIXTURE HISTORY — why there is more than one order below
--   FIXTURE 1 (`M05-VERIFY-0001`) was provisioned first and is UNCHANGED
--   below — same id, same values, same rationale. It later exceeded
--   `MERCHANT_ACCEPT_WINDOW_SECONDS = 180`
--   (apps/merchant/src/lib/orderBoardDisplay.ts) before the accept-click
--   step of live verification ran, because `paid_at` is stamped once, at
--   INSERT time, and — being one of `orders_enforce_immutable_columns`'s
--   denylisted columns — can never be updated afterwards, by any role. That
--   is expected behaviour, not a defect: FIXTURE 1 remains valid evidence
--   that M-05's *expired* state renders correctly (retry removed, contact-
--   admin only), and it is left in this file exactly as first written.
--
--   FIXTURE 2 (`M05-VERIFY-0002`) exists solely to re-open the accept-click
--   path with a fresh `paid_at = now()` at the moment IT is executed. It is
--   a second, independent `begin/commit` block below — running it does not
--   touch FIXTURE 1's row (FIXTURE 1's own `insert` is not re-executed).
--
-- WHY THIS FILE EXISTS
--   M-05 (merchant accept confirmation with prep-time entry) is implemented,
--   committed, and its migration (20260901000001_orders_prep_minutes.sql) is
--   applied to `banhao-dev`. Live end-to-end verification needs an order in
--   `PAID` — the only state from which `POST /api/v1/orders/:id/accept` can
--   move an order — and `banhao-dev` has none: its 9 orders sit in `CREATED`,
--   `MERCHANT_ACCEPTED` and `PREPARING`.
--
--   The designed way to reach `PAID` is the real payment path (order ->
--   payment attempt -> signed provider webhook -> tick). That path works and
--   has been exercised live once (see `payment_events`, 2026-08-26), but it
--   requires an env-var change, an ad-hoc webhook-simulator runner, and a
--   `/internal/tick` call whose dispatch/escalation/retention side effects
--   reach rows far beyond the order under test. M-05 is a UI change; it needs
--   an order in `PAID`, not a payment. This file is the deliberate,
--   explicitly authorised, minimum-blast-radius bridge.
--
-- WHAT THIS FILE IS NOT  —  READ THIS BEFORE USING THE ROW FOR ANYTHING
--   This is a **UI-state fixture only**. The order is `PAID` with **no**
--   `payments`, `payment_attempts`, `payment_events`, `payment_transactions`
--   or ledger row behind it. No money was ever moved, simulated or otherwise.
--   It MUST NEVER be treated as a financial settlement or reconciliation
--   record, and must never be used as an input to settlement work. The same
--   deliberate inconsistency already exists in `banhao-dev`: the seven
--   `G71-…` orders are `PREPARING` with no payment rows at all
--   (docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md § 3.6).
--
-- WHAT THIS FILE DOES
--   Inserts exactly ONE row into `public.orders` per fixture block (two
--   blocks below, run independently — see FIXTURE HISTORY above). Nothing
--   else, ever.
--
-- WHAT THIS FILE NEVER DOES
--   * No second row, in this or any other table. Specifically: no
--     `order_items`, no `order_item_options`, no `order_status_history`, no
--     `payments`, no `payment_attempts`, no `payment_events`, no ledger row,
--     no `deliveries`, no `notification_outbox` row.
--   * No `TRUNCATE`, `DROP`, `DELETE`, or `UPDATE` of any row whatsoever —
--     not even one it created. `orders` is delete-protected for every role
--     including `service_role` (`orders_enforce_immutable_columns`), and
--     this file never attempts it.
--   * No DDL: no `alter`, no policy, no function, no index, no migration.
--     The schema lock stands. This file is NOT in `supabase/migrations/`.
--   * No touch of `merchants`, `restaurants`, `menu_*`, `profiles`,
--     `auth.users`, `addresses` — every one of them is read by FK only.
--   * No write to `order_number_counters` — `M05-` numbers are hand-assigned
--     and cannot collide with `create_order()`'s `BH-YYYYMMDD-NNNN` scheme.
--   * No state transition. The row is BORN `PAID`; nothing here moves an
--     order between states, so no `order_status_history` row is owed
--     (provisioning is not a domain transition —
--     docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md § 5.3 rule 6).
--
-- SAFETY PROPERTIES
--   * Idempotent — `on conflict (id) do nothing`. A re-run inserts nothing
--     and changes nothing. Never `do update`.
--   * Non-destructive — see above; there is no `UPDATE` or `DELETE` in this
--     file at all, so it is structurally incapable of modifying any existing
--     order, fixture or not.
--   * Namespaced — the reserved `05000000-…` id prefix, distinct from
--     `dede0000-…` (catalog seed), `67100000-…` (G-7.1) and the
--     `a9/b9/d9/e9/f9/99000000-…` order-creation domain-test family. Order
--     number `M05-VERIFY-0001` carries the same marker, and every snapshot
--     string is tagged `(m05 fixture)`.
--   * Single transaction — `begin; … commit;`.
--   * Requires privileged access — `revoke all on public.orders from anon,
--     authenticated` means this runs only as the project owner / `postgres`
--     (SQL Editor, or `psql` with `PGOPTIONS=-c role=postgres`). The merchant,
--     customer and driver apps hold no credential that can execute it.
--   * Contains no secret — no key, no password, no token, no phone number.
--
-- INSERTED VALUES, AND WHY EACH ONE
--   id                       05000000-0000-4000-8000-000000000001  (new M-05 namespace)
--   order_number             M05-VERIFY-0001
--   state                    PAID          — the one state M-05's accept can leave
--   paid_at                  now()         — a PAID order without it would be a lie
--   customer_id              d25a51f9-…    — the existing G-7.1 fixture customer, so
--                                            no additional real identity gains order
--                                            history for this test
--   restaurant_id            dede0000-…-c001 — the dev catalogue restaurant, and the
--                                            only one with an unrevoked
--                                            `restaurant_members` row, so the
--                                            merchant app can actually see this order
--   payment_method           ONLINE        — DEC-016; `CASH` must never appear
--   subtotal_satang          8000
--   delivery_fee_satang      1000          — DEC-035 (flat ฿10). NOT the stale
--                                            SAMPLE_DELIVERY_FEE_SATANG = 1500 in
--                                            apps/customer/src/mocks/pricing.ts
--   service_fee_satang       500           — DEC-036 (fixed ฿5)
--   discount_satang          0
--   grand_total_satang       9500          — satisfies `orders_total_check`:
--                                            8000 + 1000 + 500 - 0 = 9500
--   prep_minutes             OMITTED       — must be NULL. It is the column M-05
--                                            writes; a fixture that pre-filled it
--                                            would verify nothing. The CHECK
--                                            (`prep_minutes > 0`) passes on NULL,
--                                            since a CHECK rejects only FALSE.
--   address_id               OMITTED       — nullable; the snapshot columns are what
--                                            the order is explicable from (§ 8), and
--                                            this file writes no `addresses` row.
--   currency, placed_at,
--   created_at, updated_at   DEFAULTED     — 'THB' and now()
--
-- EXPECTED EFFECT — INSERT 1, UPDATE 0, DELETE 0.
--
-- HOW TO RUN (by hand, once per fixture block)
--   Supabase Dashboard → SQL Editor, paste one block and run; or
--   PGOPTIONS='-c role=postgres' psql -v ON_ERROR_STOP=1 -f this-file  (runs both)
-- ===========================================================================

-- =========================== FIXTURE 1 : M05-VERIFY-0001 ===========================
-- Unchanged since first provisioned. Now past its 180-second accept window
-- (see FIXTURE HISTORY above) — left in place as evidence of the expired-
-- state UI, not re-run, not touched.

begin;

insert into public.orders (
  id,
  order_number,
  state,
  paid_at,
  customer_id,
  restaurant_id,
  restaurant_name_snapshot,
  delivery_address_snapshot,
  recipient_name_snapshot,
  recipient_phone_snapshot,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang
)
values (
  '05000000-0000-4000-8000-000000000001',
  'M05-VERIFY-0001',
  'PAID',
  now(),
  'd25a51f9-93fb-48af-b208-512883ad4640',
  'dede0000-0000-4000-8000-00000000c001',
  'ร้านส้มตำป้าทองดี (dev)',
  'บ้านทดสอบ M-05 เลขที่ 1 ต.บุณฑริก อ.บุณฑริก (m05 fixture)',
  'ลูกค้าทดสอบ M-05 (m05 fixture)',
  '+66811110009',
  'ONLINE',
  8000,
  1000,
  500,
  0,
  9500
)
on conflict (id) do nothing;

commit;

-- Summary select, so the operator sees the result without writing a second
-- query (docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md § 5.3 rule 9). Read-only.
select
  id,
  order_number,
  state,
  prep_minutes,
  restaurant_id,
  customer_id,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang,
  paid_at,
  placed_at
from public.orders
where id = '05000000-0000-4000-8000-000000000001';

-- =========================== FIXTURE 2 : M05-VERIFY-0002 ===========================
-- Same shape and rationale as FIXTURE 1 (see the header above for every
-- column's justification — unchanged here except id, order_number, the
-- snapshot address line's sequence number, and `paid_at`/`placed_at`
-- necessarily being a later `now()`). Exists only because FIXTURE 1's
-- accept window closed before it could be used. `prep_minutes` is again
-- OMITTED — must be NULL. Independent `begin/commit`; does not reference
-- or touch FIXTURE 1's row.

begin;

insert into public.orders (
  id,
  order_number,
  state,
  paid_at,
  customer_id,
  restaurant_id,
  restaurant_name_snapshot,
  delivery_address_snapshot,
  recipient_name_snapshot,
  recipient_phone_snapshot,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang
)
values (
  '05000000-0000-4000-8000-000000000002',
  'M05-VERIFY-0002',
  'PAID',
  now(),
  'd25a51f9-93fb-48af-b208-512883ad4640',
  'dede0000-0000-4000-8000-00000000c001',
  'ร้านส้มตำป้าทองดี (dev)',
  'บ้านทดสอบ M-05 เลขที่ 2 ต.บุณฑริก อ.บุณฑริก (m05 fixture)',
  'ลูกค้าทดสอบ M-05 (m05 fixture)',
  '+66811110009',
  'ONLINE',
  8000,
  1000,
  500,
  0,
  9500
)
on conflict (id) do nothing;

commit;

-- Summary select, so the operator sees the result without writing a second
-- query (docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md § 5.3 rule 9). Read-only.
select
  id,
  order_number,
  state,
  prep_minutes,
  restaurant_id,
  customer_id,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang,
  paid_at,
  placed_at
from public.orders
where id = '05000000-0000-4000-8000-000000000002';

-- =========================== FIXTURE 3 : M05-VERIFY-0003 ===========================
-- Same shape and rationale as FIXTURE 1/2. FIXTURE 2 also expired before its
-- accept-click could run (turn round-trip cost > 180s window). This block
-- exists so the accept-click sequence can begin in the same tool-call batch
-- as the INSERT, closing that gap. `prep_minutes` again OMITTED — must be
-- NULL. Independent `begin/commit`; does not touch FIXTURE 1 or 2's rows.

begin;

insert into public.orders (
  id,
  order_number,
  state,
  paid_at,
  customer_id,
  restaurant_id,
  restaurant_name_snapshot,
  delivery_address_snapshot,
  recipient_name_snapshot,
  recipient_phone_snapshot,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang
)
values (
  '05000000-0000-4000-8000-000000000003',
  'M05-VERIFY-0003',
  'PAID',
  now(),
  'd25a51f9-93fb-48af-b208-512883ad4640',
  'dede0000-0000-4000-8000-00000000c001',
  'ร้านส้มตำป้าทองดี (dev)',
  'บ้านทดสอบ M-05 เลขที่ 3 ต.บุณฑริก อ.บุณฑริก (m05 fixture)',
  'ลูกค้าทดสอบ M-05 #3 (m05 fixture)',
  '+66811110011',
  'ONLINE',
  8000,
  1000,
  500,
  0,
  9500
)
on conflict (id) do nothing;

commit;

select
  id, order_number, state, prep_minutes, restaurant_id, customer_id,
  payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
  discount_satang, grand_total_satang, paid_at, placed_at
from public.orders
where id = '05000000-0000-4000-8000-000000000003';

-- =========================== FIXTURE 4 : M05-VERIFY-0004 ===========================
-- Same shape/rationale as FIXTURE 1-3. FIXTURE 3's accept attempt failed on
-- an expired merchant browser session (401, unrelated to the 180s window,
-- which still had ~146s left) — the merchant session has since been
-- re-authenticated. This block exists to retry the accept-click sequence
-- with a fresh `paid_at`. `prep_minutes` again OMITTED — must be NULL.
-- Independent `begin/commit`; does not touch fixtures 1-3.

begin;

insert into public.orders (
  id,
  order_number,
  state,
  paid_at,
  customer_id,
  restaurant_id,
  restaurant_name_snapshot,
  delivery_address_snapshot,
  recipient_name_snapshot,
  recipient_phone_snapshot,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang
)
values (
  '05000000-0000-4000-8000-000000000004',
  'M05-VERIFY-0004',
  'PAID',
  now(),
  'd25a51f9-93fb-48af-b208-512883ad4640',
  'dede0000-0000-4000-8000-00000000c001',
  'ร้านส้มตำป้าทองดี (dev)',
  'บ้านทดสอบ M-05 เลขที่ 4 ต.บุณฑริก อ.บุณฑริก (m05 fixture)',
  'ลูกค้าทดสอบ M-05 #4 (m05 fixture)',
  '+66811110011',
  'ONLINE',
  8000,
  1000,
  500,
  0,
  9500
)
on conflict (id) do nothing;

commit;

select
  id, order_number, state, prep_minutes, restaurant_id, customer_id,
  payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
  discount_satang, grand_total_satang, paid_at, placed_at
from public.orders
where id = '05000000-0000-4000-8000-000000000004';

-- =========================== FIXTURE 5 : M05-VERIFY-0005 ===========================
-- Same shape/rationale as fixtures 1-4. Fixture 4's accept attempt failed on
-- a misconfigured API process (wrong SUPABASE_URL, then a CORS allowlist
-- missing the merchant app's origin) — both now fixed (API restarted against
-- banhao-dev; CORS_ORIGINS extended to include localhost:3002). This block
-- exists to retry the accept-click sequence with a fresh `paid_at`.
-- `prep_minutes` again OMITTED — must be NULL. Independent `begin/commit`;
-- does not touch fixtures 1-4.

begin;

insert into public.orders (
  id,
  order_number,
  state,
  paid_at,
  customer_id,
  restaurant_id,
  restaurant_name_snapshot,
  delivery_address_snapshot,
  recipient_name_snapshot,
  recipient_phone_snapshot,
  payment_method,
  subtotal_satang,
  delivery_fee_satang,
  service_fee_satang,
  discount_satang,
  grand_total_satang
)
values (
  '05000000-0000-4000-8000-000000000005',
  'M05-VERIFY-0005',
  'PAID',
  now(),
  'd25a51f9-93fb-48af-b208-512883ad4640',
  'dede0000-0000-4000-8000-00000000c001',
  'ร้านส้มตำป้าทองดี (dev)',
  'บ้านทดสอบ M-05 เลขที่ 5 ต.บุณฑริก อ.บุณฑริก (m05 fixture)',
  'ลูกค้าทดสอบ M-05 #5 (m05 fixture)',
  '+66811110011',
  'ONLINE',
  8000,
  1000,
  500,
  0,
  9500
)
on conflict (id) do nothing;

commit;

select
  id, order_number, state, prep_minutes, restaurant_id, customer_id,
  payment_method, subtotal_satang, delivery_fee_satang, service_fee_satang,
  discount_satang, grand_total_satang, paid_at, placed_at
from public.orders
where id = '05000000-0000-4000-8000-000000000005';
