-- BANHAO — DEC-068 A1: payment_events.payment_id write-once
-- (20261102000001_payment_events_payment_id_write_once.sql)
--
-- Run via run-domain-tests.sh (docker-composed, real PostgreSQL), after
-- domain_invariants_test.sql and reconciliation_cases_refund_kinds_test.sql
-- in the same database — it reuses their payments
-- a3000000-...-000000000001 and a1900000-...-0000000000a1. Proves:
--
--   A. the backfill the services perform (null → value) now succeeds
--   B. re-setting the SAME value is accepted (idempotent re-run)
--   C. value → a different payment is still refused (42501)
--   D. value → null is still refused (42501)
--   E. processed_at / processing_error stay updatable on a linked event
--   F. every other identity column is still immutable, on unlinked AND
--      linked events, including when payment_id is set in the same UPDATE
--   G. DELETE is still refused
--   H. grants/RLS on payment_events are unchanged
--
-- Fixture ids are unique to this file (evt_wo_…).

\set ON_ERROR_STOP on

create or replace function wo_assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end;
$$;

-- Runs one statement and returns the SQLSTATE it raised, or 'OK'.
create or replace function wo_sqlstate(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return SQLSTATE;
end;
$$;

insert into public.payment_events (provider, provider_event_id, event_type, signature_verified, raw_payload)
values
  ('stripe', 'evt_wo_001', 'payment_intent.succeeded', true, '{"providerPaymentId":"pi_wo_001"}'::jsonb),
  ('stripe', 'evt_wo_002', 'payment_intent.succeeded', true, '{"providerPaymentId":"pi_wo_002"}'::jsonb);

-- ===========================================================================
-- A. null → value, exactly as the processing services issue it
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$update public.payment_events set payment_id = 'a3000000-0000-0000-0000-000000000001'
                 where provider_event_id = 'evt_wo_001'$s$) = 'OK',
  'A. payment_id null → value is accepted (the backfill no longer fails)');

select wo_assert(
  (select payment_id from public.payment_events where provider_event_id = 'evt_wo_001')
    = 'a3000000-0000-0000-0000-000000000001',
  'A. the link is stored');

-- ===========================================================================
-- B. Same value again — not a change
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$update public.payment_events set payment_id = 'a3000000-0000-0000-0000-000000000001'
                 where provider_event_id = 'evt_wo_001'$s$) = 'OK',
  'B. re-setting the same payment_id is accepted (idempotent re-run)');

-- ===========================================================================
-- C/D. Once linked, the link is immutable
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$update public.payment_events set payment_id = 'a1900000-0000-0000-0000-0000000000a1'
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'C. value → a different payment is refused (42501)');

select wo_assert(
  wo_sqlstate($s$update public.payment_events set payment_id = null
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'D. value → null is refused (42501)');

select wo_assert(
  (select payment_id from public.payment_events where provider_event_id = 'evt_wo_001')
    = 'a3000000-0000-0000-0000-000000000001',
  'C/D. the original link survives both refused updates');

-- ===========================================================================
-- E. The two processing columns stay mutable after linking
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$update public.payment_events set processed_at = now(), processing_error = 'fixture'
                 where provider_event_id = 'evt_wo_001'$s$) = 'OK',
  'E. processed_at / processing_error are still updatable on a linked event');

-- ===========================================================================
-- F. Every other identity column is still immutable
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$update public.payment_events set raw_payload = '{}'::jsonb
                 where provider_event_id = 'evt_wo_002'$s$) = '42501',
  'F. raw_payload is immutable on an unlinked event');

select wo_assert(
  wo_sqlstate($s$update public.payment_events
                 set payment_id = 'a1900000-0000-0000-0000-0000000000a1', event_type = 'payment_intent.canceled'
                 where provider_event_id = 'evt_wo_002'$s$) = '42501',
  'F. the one-time link cannot carry another column change with it');

select wo_assert(
  (select payment_id is null from public.payment_events where provider_event_id = 'evt_wo_002'),
  'F. the refused combined update left evt_wo_002 unlinked');

select wo_assert(
  wo_sqlstate($s$update public.payment_events set provider = 'other'
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'F. provider is immutable on a linked event');

select wo_assert(
  wo_sqlstate($s$update public.payment_events set provider_event_id = 'evt_wo_001b'
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'F. provider_event_id is immutable');

select wo_assert(
  wo_sqlstate($s$update public.payment_events set signature_verified = false
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'F. signature_verified is immutable');

select wo_assert(
  wo_sqlstate($s$update public.payment_events set received_at = now() - interval '1 day'
                 where provider_event_id = 'evt_wo_001'$s$) = '42501',
  'F. received_at is immutable');

-- ===========================================================================
-- G. DELETE is still refused
-- ===========================================================================

select wo_assert(
  wo_sqlstate($s$delete from public.payment_events where provider_event_id = 'evt_wo_002'$s$) = '42501',
  'G. DELETE is refused (42501)');

-- ===========================================================================
-- H. Grants and RLS unchanged
-- ===========================================================================

select wo_assert(
  not has_table_privilege('authenticated', 'public.payment_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.payment_events', 'UPDATE')
  and not has_table_privilege('anon', 'public.payment_events', 'SELECT'),
  'H. anon/authenticated still hold no privilege on payment_events');

select wo_assert(
  (select relrowsecurity from pg_class where oid = 'public.payment_events'::regclass),
  'H. RLS is still enabled on payment_events');

select wo_assert(
  (select count(*) from pg_trigger
    where tgrelid = 'public.payment_events'::regclass
      and tgname = 'payment_events_enforce_immutable_columns'
      and not tgisinternal) = 1,
  'H. the immutability trigger is still attached');

\echo 'DEC-068 A1 payment_events write-once assertions complete'
