-- ===========================================================================
-- BANHAO — DEVELOPMENT-ONLY catalog seed
--
--   ####  FOR `banhao-dev` (ref yssnwnboiwldogmlvvlw) ONLY.  ####
--   ####  NEVER run this against production.                ####
--   ####  NEVER wire this into CI/CD or any deploy workflow. ####
--
-- Why this file exists
-- --------------------
-- V1.1 Phase C is "done when the customer app browses real data from
-- `banhao-dev`", but the designed way to create catalog content is the merchant
-- menu UI (M-11/M-12) and operator activation (A-06) — none of which is built.
-- That leaves a circular dependency, and this file is the deliberate,
-- development-only bridge across it. It is NOT product content and must never
-- be presented as a real restaurant, menu, or price.
--
-- Every row is obviously synthetic: names carry a (dev) marker, prices are
-- round test values, and the merchant is literally called a test entity.
--
-- Safety properties
-- -----------------
--   * Idempotent — every statement is `on conflict do nothing`, so re-running
--     changes nothing.
--   * Non-destructive — no TRUNCATE, no DROP, no DELETE, no UPDATE of any row.
--     It cannot modify data it did not create.
--   * Namespaced — every id is in the reserved `dede0000-…` prefix, so seed
--     rows are trivially distinguishable from anything else and can be removed
--     later by id without touching real data.
--   * Isolated identity — creates its own synthetic merchant-owner auth user
--     rather than repurposing an existing QA/test account, so no existing
--     profile gains merchant semantics.
--
-- Schema facts this file respects (do not "simplify" these away)
-- -------------------------------------------------------------
--   * `restaurant_hours` has CHECK (closes_at > opens_at) — overnight windows
--     are impossible by design. None are attempted here.
--   * `day_of_week` is 0 = Sunday … 6 = Saturday.
--   * `menu_items.category_id` is ON DELETE RESTRICT — categories must outlive
--     their items; delete children first if this is ever unwound.
--   * `restaurants.location` is a GENERATED column — never inserted.
--   * Only `status = 'ACTIVE'` restaurants are visible to customers (RLS).
--
-- What the dataset is designed to prove
-- -------------------------------------
--   PC-Q-001  unavailable items/options are VISIBLE but inert
--   C-9       open vs closed restaurant, today's hours, next opening
--   C-8       sold-out rendering and interaction safety
--   F-2/F-4   Thai search, `%` / `_` / `\` escaping
--   RLS       archived rows and SUSPENDED restaurants stay hidden
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Synthetic merchant owner.
--
-- `merchants.owner_user_id` is NOT NULL → profiles → auth.users, so a catalog
-- cannot exist without an identity. This user never signs in; it exists purely
-- as the FK anchor. The `on_auth_user_created` trigger creates its profile.
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values (
  'dede0000-0000-4000-8000-00000000a001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev-seed-merchant@banhao.invalid',   -- .invalid TLD: cannot be a real address
  now(), now()
)
on conflict (id) do nothing;

-- Belt and braces: if the trigger is ever absent, the profile still exists.
insert into public.profiles (id, display_name)
values ('dede0000-0000-4000-8000-00000000a001', 'Dev Seed Merchant (dev)')
on conflict (id) do nothing;

insert into public.merchants (id, owner_user_id, legal_name, status)
values (
  'dede0000-0000-4000-8000-00000000b001',
  'dede0000-0000-4000-8000-00000000a001',
  'BANHAO Dev Seed Co., Ltd. (dev)',
  'ACTIVE'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Restaurants
--
--   R1  ACTIVE, open every day 09:00–20:00  → visible, open (most of the day)
--   R2  ACTIVE, opens one weekday only      → visible, closed, has next-opening
--   R3  SUSPENDED                           → MUST stay invisible to customers
-- ---------------------------------------------------------------------------

insert into public.restaurants
  (id, merchant_id, name, description, cuisine, phone, address_line, lat, lng,
   status, avg_prep_minutes, rating_avg, rating_count)
values
  ('dede0000-0000-4000-8000-00000000c001',
   'dede0000-0000-4000-8000-00000000b001',
   'ร้านส้มตำป้าทองดี (dev)',
   'ข้อมูลทดสอบสำหรับการพัฒนา ไม่ใช่ร้านจริง',
   'อาหารอีสาน', '+66812345678',
   'ใกล้ตลาดสดบุณฑริก ต.บุณฑริก อ.บุณฑริก จ.อุบลราชธานี (ที่อยู่ทดสอบ)',
   14.780000, 105.420000,
   'ACTIVE', 20, 4.8, 326),

  ('dede0000-0000-4000-8000-00000000c002',
   'dede0000-0000-4000-8000-00000000b001',
   'ก๋วยเตี๋ยวลุงหนวด (dev)',
   'ข้อมูลทดสอบสำหรับการพัฒนา ไม่ใช่ร้านจริง',
   'ก๋วยเตี๋ยว', null,
   'ถนนทดสอบ ต.บุณฑริก (ที่อยู่ทดสอบ)',
   14.781000, 105.421000,
   'ACTIVE', 15, null, 0),          -- rating_avg NULL → proves "unrated" path

  ('dede0000-0000-4000-8000-00000000c003',
   'dede0000-0000-4000-8000-00000000b001',
   'ร้านทดสอบระงับ (dev)',
   'ต้องไม่ปรากฏต่อลูกค้า',
   'ทดสอบ', null, null, null, null,
   'SUSPENDED', null, null, 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Opening hours
--
--   R1: all seven days 09:00–20:00. Open during Bangkok daytime; the closed
--       path is still exercised deterministically by R2.
--   R2: Wednesday only (day_of_week = 3) → closed on six days out of seven,
--       and `nextOpening()` always has a real answer to compute.
--   R3: none → the "no hours at all ⇒ closed" branch.
-- ---------------------------------------------------------------------------

insert into public.restaurant_hours (id, restaurant_id, day_of_week, opens_at, closes_at)
values
  ('dede0000-0000-4000-8000-00000000d000', 'dede0000-0000-4000-8000-00000000c001', 0, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d001', 'dede0000-0000-4000-8000-00000000c001', 1, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d002', 'dede0000-0000-4000-8000-00000000c001', 2, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d003', 'dede0000-0000-4000-8000-00000000c001', 3, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d004', 'dede0000-0000-4000-8000-00000000c001', 4, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d005', 'dede0000-0000-4000-8000-00000000c001', 5, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d006', 'dede0000-0000-4000-8000-00000000c001', 6, '09:00', '20:00'),
  ('dede0000-0000-4000-8000-00000000d103', 'dede0000-0000-4000-8000-00000000c002', 3, '10:00', '18:00')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Categories — R1 has two (ordering + grouping), R2 has one (per-restaurant
-- scoping: a category belongs to exactly one restaurant).
-- ---------------------------------------------------------------------------

insert into public.menu_categories (id, restaurant_id, name, sort_order, archived_at)
values
  ('dede0000-0000-4000-8000-00000000e001', 'dede0000-0000-4000-8000-00000000c001', 'แนะนำ',      0, null),
  ('dede0000-0000-4000-8000-00000000e002', 'dede0000-0000-4000-8000-00000000c001', 'ของหวาน',    1, null),
  ('dede0000-0000-4000-8000-00000000e003', 'dede0000-0000-4000-8000-00000000c002', 'เส้น',        0, null),
  ('dede0000-0000-4000-8000-00000000e004', 'dede0000-0000-4000-8000-00000000c003', 'ของร้านระงับ', 0, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Menu items
--
--   f001  available            → normal render
--   f002  is_available = false → PC-Q-001: VISIBLE, labelled วันนี้หมด, inert
--   f003  archived_at set      → MUST stay hidden
--   f004  under SUSPENDED R3   → MUST stay hidden
--   f005  name contains '%'    → F-4 wildcard escaping
--   f006  name contains '_'    → F-4 wildcard escaping
--   f007  name contains '\'    → F-4 backslash escaping
-- ---------------------------------------------------------------------------

insert into public.menu_items
  (id, restaurant_id, category_id, name, description, base_price_satang,
   is_available, sort_order, archived_at)
values
  ('dede0000-0000-4000-8000-00000000f001', 'dede0000-0000-4000-8000-00000000c001',
   'dede0000-0000-4000-8000-00000000e001', 'ส้มตำไทย (dev)',
   'เมนูทดสอบ พร้อมขาย', 6000, true, 0, null),

  ('dede0000-0000-4000-8000-00000000f002', 'dede0000-0000-4000-8000-00000000c001',
   'dede0000-0000-4000-8000-00000000e001', 'ตำซั่วปูปลาร้า (dev)',
   'เมนูทดสอบ หมดวันนี้', 6500, false, 1, null),

  ('dede0000-0000-4000-8000-00000000f003', 'dede0000-0000-4000-8000-00000000c001',
   'dede0000-0000-4000-8000-00000000e002', 'เมนูที่ถูกลบแล้ว (dev)',
   'ต้องไม่ปรากฏ', 5000, true, 2, now()),

  ('dede0000-0000-4000-8000-00000000f004', 'dede0000-0000-4000-8000-00000000c003',
   'dede0000-0000-4000-8000-00000000e004', 'เมนูร้านระงับ (dev)',
   'ต้องไม่ปรากฏ', 5000, true, 0, null),

  ('dede0000-0000-4000-8000-00000000f005', 'dede0000-0000-4000-8000-00000000c001',
   'dede0000-0000-4000-8000-00000000e002', 'ส้มตำ100%พิเศษ (dev)',
   'ทดสอบ escaping ของ %', 7000, true, 3, null),

  ('dede0000-0000-4000-8000-00000000f006', 'dede0000-0000-4000-8000-00000000c002',
   'dede0000-0000-4000-8000-00000000e003', 'เมนู_ทดสอบ (dev)',
   'ทดสอบ escaping ของ _', 5500, true, 0, null),

  ('dede0000-0000-4000-8000-00000000f007', 'dede0000-0000-4000-8000-00000000c002',
   'dede0000-0000-4000-8000-00000000e003', E'เมนู\\ทดสอบ (dev)',
   'ทดสอบ escaping ของ backslash', 5500, true, 1, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Option groups (BQ-009 encodes select semantics as data, not schema)
--
--   g001  min 1 / max 1  required single-select, first option AVAILABLE
--   g002  min 0 / max 3  optional multi-select
--   g003  min 1 / max 1  required, but its FIRST option is sold out —
--                        proves the default skips unavailable options
-- ---------------------------------------------------------------------------

insert into public.menu_option_groups (id, menu_item_id, title, min_select, max_select, sort_order)
values
  ('dede0000-0000-4000-8000-000000009001', 'dede0000-0000-4000-8000-00000000f001',
   'ระดับความเผ็ด', 1, 1, 0),
  ('dede0000-0000-4000-8000-000000009002', 'dede0000-0000-4000-8000-00000000f001',
   'เพิ่มเติม', 0, 3, 1),
  ('dede0000-0000-4000-8000-000000009003', 'dede0000-0000-4000-8000-00000000f001',
   'ขนาด', 1, 1, 2),
  -- group under the ARCHIVED item — must stay hidden with its parent
  ('dede0000-0000-4000-8000-000000009004', 'dede0000-0000-4000-8000-00000000f003',
   'ของเมนูที่ถูกลบ', 0, 1, 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Options
--
--   Includes available + unavailable, zero + positive price delta, and one
--   group whose first option is sold out.
-- ---------------------------------------------------------------------------

insert into public.menu_options (id, group_id, label, price_delta_satang, is_available, sort_order)
values
  -- g001 required single-select: first option available
  ('dede0000-0000-4000-8000-000000008001', 'dede0000-0000-4000-8000-000000009001', 'เผ็ดน้อย (dev)',  0,    true,  0),
  ('dede0000-0000-4000-8000-000000008002', 'dede0000-0000-4000-8000-000000009001', 'เผ็ดกลาง (dev)',  0,    true,  1),
  ('dede0000-0000-4000-8000-000000008003', 'dede0000-0000-4000-8000-000000009001', 'เผ็ดมาก (dev)',   0,    false, 2),  -- sold out

  -- g002 optional multi-select, positive deltas
  ('dede0000-0000-4000-8000-000000008004', 'dede0000-0000-4000-8000-000000009002', 'ไข่ดาว (dev)',    1000, true,  0),
  ('dede0000-0000-4000-8000-000000008005', 'dede0000-0000-4000-8000-000000009002', 'ข้าวเหนียว (dev)', 1500, true,  1),

  -- g003 required, FIRST option sold out → default must skip to the second
  ('dede0000-0000-4000-8000-000000008006', 'dede0000-0000-4000-8000-000000009003', 'จานใหญ่ (dev)',   2000, false, 0),  -- sold out, first
  ('dede0000-0000-4000-8000-000000008007', 'dede0000-0000-4000-8000-000000009003', 'จานปกติ (dev)',   0,    true,  1),

  -- option under the ARCHIVED item's group — must stay hidden
  ('dede0000-0000-4000-8000-000000008008', 'dede0000-0000-4000-8000-000000009004', 'ของเมนูที่ถูกลบ (dev)', 0, true, 0)
on conflict (id) do nothing;

commit;
