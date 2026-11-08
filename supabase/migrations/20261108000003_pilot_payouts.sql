-- BANHAO — DEC-073: pilot settlement. Weekly manual payouts, recorded.
--
-- payouts       — one bank transfer an ADMIN made to one merchant or rider.
-- payout_items  — the orders (merchant) or deliveries (rider) that transfer paid.
--
-- Amounts are never supplied by a client. record_payout() derives each item's
-- amount from facts frozen at order time: merchant = orders.subtotal_satang −
-- order_commission_snapshots.commission_satang for a DELIVERED order of that
-- merchant's restaurant; rider = deliveries.rider_earning_satang for a
-- DELIVERED delivery of that rider. An item can be in at most one non-voided
-- payout (partial unique index), so nothing is paid twice. A mistaken record is
-- voided with a reason, never edited or deleted. Each record and void writes
-- an audit_logs row in the same transaction.
--
-- API-only: no grant to anon/authenticated; functions are service_role-only.

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('MERCHANT', 'RIDER')),
  party_id uuid not null,
  period_start date not null,
  period_end date not null,
  total_satang bigint not null check (total_satang > 0),
  paid_on date not null,
  bank_reference text not null check (length(btrim(bank_reference)) > 0),
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id) on delete restrict,
  void_reason text,
  constraint payouts_period_check check (period_end >= period_start),
  constraint payouts_void_shape check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and length(btrim(coalesce(void_reason, ''))) > 0)
  )
);

create table public.payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.payouts (id) on delete restrict,
  item_type text not null check (item_type in ('ORDER', 'DELIVERY')),
  item_id uuid not null,
  amount_satang bigint not null check (amount_satang > 0),
  voided boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index payout_items_active_item_key
  on public.payout_items (item_type, item_id) where not voided;
create index payout_items_payout_idx on public.payout_items (payout_id);
create index payouts_party_idx on public.payouts (party_type, party_id, created_at desc);

comment on table public.payouts is
  'DEC-073 pilot settlement: one manual bank transfer to a merchant or rider, recorded by an ADMIN with the slip reference. Never edited or deleted; voided with a reason. API-only.';
comment on table public.payout_items is
  'DEC-073: the orders/deliveries a payout paid, with amounts derived from frozen order facts. An item is in at most one non-voided payout. API-only.';

revoke all on public.payouts from anon, authenticated;
revoke all on public.payout_items from anon, authenticated;
alter table public.payouts enable row level security;
alter table public.payout_items enable row level security;

-- Immutability: only the void fields may be set, once; items may only flip to voided.
create or replace function public.payouts_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payouts are never deleted (DEC-073)' using errcode = '42501';
  end if;
  if old.voided_at is not null
     or new.id <> old.id or new.party_type <> old.party_type or new.party_id <> old.party_id
     or new.period_start <> old.period_start or new.period_end <> old.period_end
     or new.total_satang <> old.total_satang or new.paid_on <> old.paid_on
     or new.bank_reference <> old.bank_reference or new.recorded_by <> old.recorded_by
     or new.created_at <> old.created_at then
    raise exception 'a payout can only be voided, once (DEC-073)' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger payouts_guard before update or delete on public.payouts
  for each row execute function public.payouts_guard();

create or replace function public.payout_items_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payout items are never deleted (DEC-073)' using errcode = '42501';
  end if;
  if old.voided or not new.voided
     or new.id <> old.id or new.payout_id <> old.payout_id or new.item_type <> old.item_type
     or new.item_id <> old.item_id or new.amount_satang <> old.amount_satang or new.created_at <> old.created_at then
    raise exception 'a payout item can only be marked voided (DEC-073)' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger payout_items_guard before update or delete on public.payout_items
  for each row execute function public.payout_items_guard();

-- record_payout: validates every item belongs to the party and is DELIVERED,
-- derives amounts, inserts the payout and its items, and audits — atomically.
create or replace function public.record_payout(
  p_party_type text,
  p_party_id uuid,
  p_period_start date,
  p_period_end date,
  p_paid_on date,
  p_bank_reference text,
  p_recorded_by uuid,
  p_item_ids uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_payout_id uuid;
  v_expected int := coalesce(array_length(p_item_ids, 1), 0);
  v_found int;
  v_total bigint;
begin
  if v_expected = 0 then
    raise exception 'record_payout: no items' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_item_ids) x) <> v_expected then
    raise exception 'record_payout: duplicate items' using errcode = '22023';
  end if;

  create temporary table if not exists pg_temp.payout_candidates (item_id uuid, amount bigint) on commit drop;
  truncate pg_temp.payout_candidates;

  if p_party_type = 'MERCHANT' then
    insert into pg_temp.payout_candidates (item_id, amount)
    select o.id, o.subtotal_satang - s.commission_satang
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    join public.order_commission_snapshots s on s.order_id = o.id
    where o.id = any (p_item_ids) and o.state = 'DELIVERED' and r.merchant_id = p_party_id;
  elsif p_party_type = 'RIDER' then
    insert into pg_temp.payout_candidates (item_id, amount)
    select d.id, d.rider_earning_satang
    from public.deliveries d
    where d.id = any (p_item_ids) and d.state = 'DELIVERED' and d.rider_id = p_party_id
      and d.rider_earning_satang is not null;
  else
    raise exception 'record_payout: unknown party type %', p_party_type using errcode = '22023';
  end if;

  select count(*), coalesce(sum(amount), 0) into v_found, v_total from pg_temp.payout_candidates where amount > 0;
  if v_found <> v_expected then
    raise exception 'record_payout: % of % items are not payable to this party', v_expected - v_found, v_expected
      using errcode = '22023';
  end if;

  insert into public.payouts (party_type, party_id, period_start, period_end, total_satang, paid_on, bank_reference, recorded_by)
  values (p_party_type, p_party_id, p_period_start, p_period_end, v_total, p_paid_on, p_bank_reference, p_recorded_by)
  returning id into v_payout_id;

  -- The partial unique index refuses an item already in a non-voided payout
  -- (23505), which aborts the whole transaction: nothing is paid twice.
  insert into public.payout_items (payout_id, item_type, item_id, amount_satang)
  select v_payout_id, case when p_party_type = 'MERCHANT' then 'ORDER' else 'DELIVERY' end, item_id, amount
  from pg_temp.payout_candidates;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after, reason, source)
  values ('OPERATOR', p_recorded_by, 'PayoutRecorded', 'payouts', v_payout_id,
          jsonb_build_object('partyType', p_party_type, 'partyId', p_party_id, 'totalSatang', v_total,
                             'items', v_expected, 'paidOn', p_paid_on, 'periodStart', p_period_start, 'periodEnd', p_period_end),
          'Bank reference: ' || p_bank_reference, 'api');

  return v_payout_id;
end;
$$;

create or replace function public.void_payout(p_payout_id uuid, p_voided_by uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'void_payout: a reason is required' using errcode = '22023';
  end if;

  update public.payouts
     set voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
   where id = p_payout_id and voided_at is null;
  if not found then
    raise exception 'void_payout: no such active payout' using errcode = 'P0002';
  end if;

  update public.payout_items set voided = true where payout_id = p_payout_id and not voided;

  insert into public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, reason, source)
  values ('OPERATOR', p_voided_by, 'PayoutVoided', 'payouts', p_payout_id, p_reason, 'api');
end;
$$;

revoke all on function public.record_payout(text, uuid, date, date, date, text, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.void_payout(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_payout(text, uuid, date, date, date, text, uuid, uuid[]) to service_role;
grant execute on function public.void_payout(uuid, uuid, text) to service_role;
