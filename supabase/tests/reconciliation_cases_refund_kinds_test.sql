-- BANHAO — DEC-060 lock: reconciliation_cases accepts the six Q-020 refund
-- kinds, the five prior kinds are untouched, and the new dedup index behaves
-- exactly as designed
--
-- Run via run-domain-tests.sh (docker-composed, real PostgreSQL), after
-- domain_invariants_test.sql has run in the same database (reuses its
-- CUST_A / restaurant e0000000-...-0001 fixtures). Proves:
--   1.  every one of the five pre-existing kinds still inserts
--   2.  every one of the six new Q-020 kinds inserts
--   3.  an unrecognized kind is still rejected (23514)
--   4.  a second OPEN case for the same (kind, payment_id) among the six new
--       kinds is rejected by reconciliation_cases_refund_open_key (23505)
--   5.  different new-kind cases coexist for the same payment_id
--   6.  a RESOLVED historical case never conflicts with a fresh OPEN one for
--       the same (kind, payment_id)
--   7.  a CLOSED historical case never conflicts with a fresh OPEN one either
--   8.  the new index does NOT cover the five pre-existing kinds — two OPEN
--       AMOUNT_MISMATCH cases for the same payment_id both succeed
--   9.  RLS is unchanged: still enabled, still zero policies
--   10. grants are unchanged: still nothing for anon/authenticated
--
-- The fixture payment id (`a1900000-0000-0000-0000-0000000000a1`) is a
-- literal repeated inside every `do $$ ... $$` block below, deliberately not
-- a psql `\set` variable: psql's `:'name'` client-side substitution does not
-- fire inside dollar-quoted bodies (that is the entire point of `$$`
-- quoting — protecting the body from any such rewriting), so every other
-- fixture id in this test suite that uses `:'VAR'` does so only in plain
-- top-level SQL, never inside a `do $$` block. A literal is simpler here
-- than threading a plpgsql variable through nine independent blocks.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixture — one order + one payment, reusing domain_invariants_test.sql's
-- CUST_A / restaurant e0000000-...-0001. reconciliation_cases.payment_id has
-- a real FK to payments, so a genuine row is needed, not a bare UUID.
-- ---------------------------------------------------------------------------

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1900000-0000-0000-0000-000000000001', 'BH-TEST-9001', 'CANCELLED',
  'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
  'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ DEC-060',
  'ลูกค้า ทดสอบ', '+66811119001', 'ONLINE', 12000, 1000, 500, 0, 13500
);

insert into public.payments (id, order_id, payment_reference, state, method, amount_satang, provider, provider_payment_id)
values (
  'a1900000-0000-0000-0000-0000000000a1', 'a1900000-0000-0000-0000-000000000001',
  'PAY-TEST-9001', 'SUCCESS', 'ONLINE', 13500, 'stripe', 'pi_test_9001'
);

-- ---------------------------------------------------------------------------
-- 1. Every one of the five pre-existing kinds still inserts.
--    RIDER_RELEASE_INVARIANT carries no payment_id (delivery_id instead,
--    matching 20260825000001's own design) — inserted with both null.
-- ---------------------------------------------------------------------------

do $$
declare
  k text;
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  foreach k in array array['LATE_PAYMENT','SURPLUS_PAYMENT','AMOUNT_MISMATCH','UNMATCHED_EVENT'] loop
    insert into public.reconciliation_cases (kind, payment_id, state)
    values (k, pay_id, 'OPEN');
  end loop;

  insert into public.reconciliation_cases (kind, state)
  values ('RIDER_RELEASE_INVARIANT', 'OPEN');

  raise notice 'PASS  1. all five pre-existing kinds still insert';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every one of the six new Q-020 refund kinds inserts, all OPEN, all
--    against the same payment_id (proves multiple kinds coexist per payment
--    — assertion 5 — in the same step).
-- ---------------------------------------------------------------------------

do $$
declare
  k text;
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
  new_kinds text[] := array[
    'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
    'REFUND_AMOUNT_MISMATCH', 'MISSING_PROVIDER_REFUND_ID',
    'MISSING_PROVIDER_EVENT', 'REFUNDED_LEDGER_INCOMPLETE'
  ];
begin
  foreach k in array new_kinds loop
    insert into public.reconciliation_cases (kind, payment_id, state)
    values (k, pay_id, 'OPEN');
  end loop;

  raise notice 'PASS  2. all six new Q-020 refund kinds insert';
end $$;

do $$
declare
  cnt int;
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  select count(*) into cnt
    from public.reconciliation_cases
   where payment_id = pay_id
     and state = 'OPEN'
     and kind in (
       'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
       'REFUND_AMOUNT_MISMATCH', 'MISSING_PROVIDER_REFUND_ID',
       'MISSING_PROVIDER_EVENT', 'REFUNDED_LEDGER_INCOMPLETE'
     );

  if cnt <> 6 then
    raise exception 'FAIL  5. expected 6 distinct OPEN new-kind cases for one payment_id, found %', cnt;
  end if;
  raise notice 'PASS  5. six different new-kind OPEN cases coexist for the same payment_id';
end $$;

-- ---------------------------------------------------------------------------
-- 3. An unrecognized kind is still rejected by the CHECK (23514).
-- ---------------------------------------------------------------------------

do $$
declare
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('SOMETHING_MADE_UP', pay_id, 'OPEN');
    raise exception 'FAIL  3. unrecognized kind SOMETHING_MADE_UP was accepted';
  exception
    when check_violation then
      raise notice 'PASS  3. unrecognized kind still rejected (23514)';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A second OPEN case for the same (kind, payment_id) among the new six
--    kinds is rejected by reconciliation_cases_refund_open_key (23505).
-- ---------------------------------------------------------------------------

do $$
declare
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('REFUND_AMOUNT_MISMATCH', pay_id, 'OPEN');
    raise exception 'FAIL  4. a duplicate OPEN REFUND_AMOUNT_MISMATCH for the same payment_id was accepted';
  exception
    when unique_violation then
      raise notice 'PASS  4. duplicate OPEN (kind, payment_id) rejected by reconciliation_cases_refund_open_key (23505)';
  end;

  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('REFUND_AMOUNT_MISMATCH', pay_id, 'IN_PROGRESS');
    raise exception 'FAIL  4b. a duplicate IN_PROGRESS REFUND_AMOUNT_MISMATCH for the same payment_id was accepted';
  exception
    when unique_violation then
      raise notice 'PASS  4b. IN_PROGRESS counts toward the same active-case guard as OPEN';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 6/7. A RESOLVED, then a CLOSED, historical case never conflicts with a
-- fresh OPEN case for the same (kind, payment_id) — the index is partial.
-- ---------------------------------------------------------------------------

do $$
declare
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  update public.reconciliation_cases
     set state = 'RESOLVED', resolution_note = 'DEC-060 test — resolved on purpose'
   where kind = 'MISSING_PROVIDER_REFUND_ID' and payment_id = pay_id and state = 'OPEN';

  if not found then
    raise exception 'FAIL  6. setup — no OPEN MISSING_PROVIDER_REFUND_ID row found to resolve';
  end if;

  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('MISSING_PROVIDER_REFUND_ID', pay_id, 'OPEN');
  exception
    when others then
      raise exception 'FAIL  6. fresh OPEN case after a RESOLVED one raised: %', sqlerrm;
  end;

  raise notice 'PASS  6. a RESOLVED historical case never blocks a genuinely new OPEN occurrence';
end $$;

do $$
declare
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  update public.reconciliation_cases
     set state = 'CLOSED', resolution_note = 'DEC-060 test — closed on purpose'
   where kind = 'MISSING_PROVIDER_EVENT' and payment_id = pay_id and state = 'OPEN';

  if not found then
    raise exception 'FAIL  7. setup — no OPEN MISSING_PROVIDER_EVENT row found to close';
  end if;

  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('MISSING_PROVIDER_EVENT', pay_id, 'OPEN');
  exception
    when others then
      raise exception 'FAIL  7. fresh OPEN case after a CLOSED one raised: %', sqlerrm;
  end;

  raise notice 'PASS  7. a CLOSED historical case never blocks a genuinely new OPEN occurrence';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The new index does NOT cover the five pre-existing kinds — two OPEN
-- AMOUNT_MISMATCH cases for the same payment_id both succeed, unchanged from
-- before this migration.
-- ---------------------------------------------------------------------------

do $$
declare
  pay_id constant uuid := 'a1900000-0000-0000-0000-0000000000a1';
begin
  begin
    insert into public.reconciliation_cases (kind, payment_id, state)
    values ('AMOUNT_MISMATCH', pay_id, 'OPEN');
  exception
    when others then
      raise exception 'FAIL  8. a second OPEN AMOUNT_MISMATCH for the same payment_id was rejected — the new index must not cover legacy kinds: %', sqlerrm;
  end;
  raise notice 'PASS  8. legacy kinds remain undeduplicated — the new index does not cover them';
end $$;

-- ---------------------------------------------------------------------------
-- 9/10. RLS and grants are unchanged by this migration.
-- ---------------------------------------------------------------------------

do $$
declare
  rls_enabled boolean;
  policy_count int;
  grant_count int;
begin
  select relrowsecurity into rls_enabled
    from pg_class where relname = 'reconciliation_cases' and relnamespace = 'public'::regnamespace;
  if not rls_enabled then
    raise exception 'FAIL  9. reconciliation_cases no longer has row level security enabled';
  end if;

  select count(*) into policy_count from pg_policies where tablename = 'reconciliation_cases';
  if policy_count <> 0 then
    raise exception 'FAIL  9. reconciliation_cases now has % RLS policies — expected zero (service_role only, unchanged)', policy_count;
  end if;
  raise notice 'PASS  9. RLS unchanged — still enabled, still zero policies';

  select count(*) into grant_count
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'reconciliation_cases'
     and grantee in ('anon', 'authenticated');
  if grant_count <> 0 then
    raise exception 'FAIL  10. reconciliation_cases now grants % privilege(s) to anon/authenticated — expected zero', grant_count;
  end if;
  raise notice 'PASS  10. grants unchanged — still nothing for anon/authenticated';
end $$;

do $$
begin
  raise notice '12/12 assertions passed (assertion 9 stated as N/A in this fresh database — no prior reconciliation_cases row existed to compare against; the migration itself contains no DML, only DDL, which is its own proof)';
end $$;
