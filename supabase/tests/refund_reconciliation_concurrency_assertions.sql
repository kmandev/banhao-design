-- BANHAO — Q-020 Slice 4B: assertions for the reconciliation-case
-- concurrency proof
--
-- Run immediately after run-domain-tests.sh's two genuinely concurrent
-- `test_attempt_reconciliation_case_insert(...)` calls, both racing for the
-- same (kind='PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED',
-- payment_id='a1900000-0000-0000-0000-0000000000a2'). Proves:
--   1. exactly one active (OPEN) case exists for that (kind, payment_id)
--   2. a genuinely new occurrence after that case is CLOSED still inserts
--      cleanly — recurrence-after-resolution (Requirement L), reproduced at
--      the database layer, not only in the app-level stub spec
--   3. a different kind for the SAME payment_id is never blocked by the
--      first case (Requirement K)

\set ON_ERROR_STOP on

do $$
declare
  cnt int;
begin
  select count(*) into cnt
    from public.reconciliation_cases
   where kind = 'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED'
     and payment_id = 'a1900000-0000-0000-0000-0000000000a2'
     and state = 'OPEN';

  if cnt <> 1 then
    raise exception 'FAIL  1. expected exactly one OPEN PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED case for the concurrency fixture payment, found %', cnt;
  end if;
  raise notice 'PASS  1. two genuinely concurrent inserts for the same (kind, payment_id) produced exactly one active case';
end $$;

do $$
declare
  new_id uuid;
begin
  update public.reconciliation_cases
     set state = 'CLOSED', resolution_note = 'Slice 4B concurrency test — closed on purpose'
   where kind = 'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED'
     and payment_id = 'a1900000-0000-0000-0000-0000000000a2'
     and state = 'OPEN';

  if not found then
    raise exception 'FAIL  2. setup — no OPEN case found to close';
  end if;

  insert into public.reconciliation_cases (kind, payment_id, order_id, state)
  values ('PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'a1900000-0000-0000-0000-0000000000a2', 'a1900000-0000-0000-0000-000000000002', 'OPEN')
  returning id into new_id;

  if new_id is null then
    raise exception 'FAIL  2. a genuinely new occurrence after a CLOSED case failed to insert';
  end if;
  raise notice 'PASS  2. a genuinely new occurrence inserts cleanly once the earlier case is CLOSED (Requirement L)';
end $$;

do $$
declare
  new_id uuid;
begin
  insert into public.reconciliation_cases (kind, payment_id, order_id, state)
  values ('REFUND_AMOUNT_MISMATCH', 'a1900000-0000-0000-0000-0000000000a2', 'a1900000-0000-0000-0000-000000000002', 'OPEN')
  returning id into new_id;

  if new_id is null then
    raise exception 'FAIL  3. a different kind for the same payment_id was blocked';
  end if;
  raise notice 'PASS  3. a different anomaly kind for the same payment_id opens its own independent case (Requirement K)';
end $$;

do $$
begin
  raise notice '3/3 Slice 4B concurrency assertions passed';
end $$;
