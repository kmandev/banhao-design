-- BANHAO — DEC-068 A1: payment_events.payment_id becomes write-once
--
-- ---------------------------------------------------------------------------
-- The defect this closes
-- ---------------------------------------------------------------------------
--
-- `payment_events` is recorded in its own transaction before anything else
-- happens (ADR-008), so `payment_id` starts null: the event has not been
-- matched to a payment yet. `PaymentEventProcessingService` and
-- `RefundEventProcessingService` then match it and set `payment_id` — exactly
-- what this table's design intends, since an unmatched event has to be
-- recorded first.
--
-- But `payment_events_enforce_immutable_columns()` (20260811000006) treats
-- `payment_id` like every other identity column and rejects ANY change to it,
-- including the first null → value. So that update has failed on every real
-- event since the services were written. Unit tests mocked it as successful,
-- and staging showed it on 2026-11-02 (DEC-066 run, orders BH-20261102-0002
-- and -0003): "payment_events are append-only except
-- processed_at/processing_error".
--
-- Payment confirmation was never affected — nothing uses the link as a
-- concurrency or matching authority. The refund reconciliation detector does
-- read refund status events by `payment_events.payment_id`, so anomalies A
-- and C could never see the provider's evidence. That is the real cost.
--
-- ---------------------------------------------------------------------------
-- The change — one function body, nothing else
-- ---------------------------------------------------------------------------
--
-- `payment_id` may go from null to a value once. After that it is as
-- immutable as every other identity column: value → other value is refused,
-- and value → null is refused. Re-setting the SAME value is not a change
-- (`is distinct from`), so an idempotent re-run of the backfill still
-- passes. Every other column keeps its exact rule, DELETE stays forbidden,
-- and the trigger, grants and RLS are untouched — only the function body is
-- replaced.
--
-- Note on `on delete set null`: the FK to payments still declares it, and it
-- still cannot fire on a linked event, exactly as before this migration
-- (value → null was refused then and is refused now). Payments are never
-- deleted, so this is unchanged behaviour, not a new restriction.

create or replace function public.payment_events_enforce_immutable_columns()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'payment_events are permanent and cannot be deleted (docs/DATABASE_DESIGN.md § 13)'
      using errcode = '42501';
  end if;

  if (old.payment_id is not null and new.payment_id is distinct from old.payment_id)
     or new.provider is distinct from old.provider
     or new.provider_event_id is distinct from old.provider_event_id
     or new.event_type is distinct from old.event_type
     or new.signature_verified is distinct from old.signature_verified
     or new.raw_payload is distinct from old.raw_payload
     or new.received_at is distinct from old.received_at
  then
    raise exception 'payment_events are append-only except processed_at/processing_error and a one-time payment_id link'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on table public.payment_events is
  'Duplicate-webhook protection lives in the unique (provider, provider_event_id) constraint. Raw payload and identity are immutable for every role; after insert only processed_at/processing_error may change, and payment_id may be set once from null (DEC-068 A1).';
