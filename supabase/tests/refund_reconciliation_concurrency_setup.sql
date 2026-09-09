-- BANHAO — Q-020 Slice 4B: fixtures + helper for the reconciliation-case
-- concurrency proof
--
-- Run after domain_invariants_test.sql (reuses its CUST_A / restaurant
-- e0000000-...-0001 fixtures) and after
-- reconciliation_cases_refund_kinds_test.sql (Slice 4A's own schema proof),
-- in the same database, before the two genuinely concurrent psql client
-- processes orchestrated by run-domain-tests.sh.
--
-- Mirrors `RefundReconciliationDetectorService.insertOrReuseCase` exactly:
-- an insert-first attempt against `reconciliation_cases`, relying on
-- `reconciliation_cases_refund_open_key` (DEC-060 §4) as the sole
-- concurrency authority, never a prior `SELECT`. This proves at the database
-- layer, with two real connections, what the application-level spec
-- (`refund-reconciliation-detector.service.spec.ts`) can only prove against a
-- queued stub: two genuinely concurrent detector attempts for the same
-- (kind, payment_id) yield exactly one active case.

\set ON_ERROR_STOP on

-- A distinct fixture payment — deliberately not
-- a1900000-0000-0000-0000-0000000000a1 (Slice 4A's own fixture, already
-- carrying several OPEN/RESOLVED/CLOSED rows by the time this file runs in
-- the same database) — so this test's own row count assertions are never
-- entangled with that file's fixture state.

insert into public.orders (
  id, order_number, state, customer_id, restaurant_id,
  restaurant_name_snapshot, delivery_address_snapshot,
  recipient_name_snapshot, recipient_phone_snapshot, payment_method,
  subtotal_satang, delivery_fee_satang, service_fee_satang, discount_satang, grand_total_satang
) values (
  'a1900000-0000-0000-0000-000000000002', 'BH-TEST-9002', 'CANCELLED',
  'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
  'ส้มตำป้าทองดี', 'ที่อยู่ทดสอบ Slice 4B concurrency',
  'ลูกค้า ทดสอบ', '+66811119002', 'ONLINE', 12000, 1000, 500, 0, 13500
);

insert into public.payments (id, order_id, payment_reference, state, method, amount_satang, provider, provider_payment_id)
values (
  'a1900000-0000-0000-0000-0000000000a2', 'a1900000-0000-0000-0000-000000000002',
  'PAY-TEST-9002', 'SUCCESS', 'ONLINE', 13500, 'stripe', 'pi_test_9002'
);

-- Insert-first attempt, exactly as the application code does — returns
-- true on success, false on a unique_violation against
-- reconciliation_cases_refund_open_key (never raises, so both concurrent
-- callers return cleanly and run-domain-tests.sh can read both results).
create or replace function test_attempt_reconciliation_case_insert(p_kind text, p_payment_id uuid, p_order_id uuid)
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.reconciliation_cases (kind, payment_id, order_id, state)
    values (p_kind, p_payment_id, p_order_id, 'OPEN');
    return true;
  exception
    when unique_violation then
      return false;
  end;
end;
$$;
