-- BANHAO — delivery domain: deliveries, history, rider assignments
--
-- Implements docs/DATABASE_DESIGN.md § 11, § 11.1. THIS MIGRATION CONTAINS
-- THE RIDER RACE CONDITION PROTECTION — read the comment above
-- rider_assignments_one_active below before touching this file.
--
-- Delivery state is kept fully separate from Order state (DEC-018) — a
-- rider cancelling or being reassigned changes ONLY delivery.state; the
-- order never moves (DEC-021).

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  state text not null default 'UNASSIGNED' check (state in (
    'UNASSIGNED', 'RIDER_SEARCHING', 'RIDER_ASSIGNED', 'RIDER_REASSIGNING',
    'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE', 'DELIVERED', 'FAILED', 'ABANDONED'
  )),
  rider_id uuid references public.riders (id) on delete restrict,
  assigned_at timestamptz,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  pickup_lat numeric(9, 6),
  pickup_lng numeric(9, 6),
  dropoff_lat numeric(9, 6),
  dropoff_lng numeric(9, 6),
  distance_m int,
  -- Nullable and unset — BQ-029/DEC-023 keep the rider earnings formula
  -- OPEN. No default may be invented.
  rider_earning_satang bigint,
  reassignment_count int not null default 0 check (reassignment_count >= 0),
  proof_photo_path text,
  failure_cause text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deliveries_order_id_key unique (order_id)
);

comment on table public.deliveries is
  'DEC-018: delivery state is entirely separate from orders.state. rider_id IS THE authoritative "who is delivering this right now" — rider_assignments is history, never read to answer that question (docs/DATABASE_DESIGN.md § 11.1). Never hard-deleted; state and rider_id advance via guarded updates issued by NestJS (ADR-003), never a direct client write.';

-- The dispatcher's hot query.
create index deliveries_searching_idx
  on public.deliveries (state)
  where state in ('RIDER_SEARCHING', 'RIDER_REASSIGNING');
create index deliveries_active_rider_idx
  on public.deliveries (rider_id)
  where rider_id is not null;

create trigger deliveries_set_updated_at
  before update on public.deliveries
  for each row execute function public.set_updated_at();

-- Never hard-deleted (§ 13). state/rider_id are meant to change freely as
-- the delivery progresses, so no column-level immutability trigger — only
-- deletion is blocked.
create trigger deliveries_reject_delete
  before delete on public.deliveries
  for each row execute function public.reject_delete();

revoke all on public.deliveries from anon, authenticated;
alter table public.deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- delivery_status_history — append-only, separate from order_status_history
-- ---------------------------------------------------------------------------

create table public.delivery_status_history (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in
    ('CUSTOMER', 'MERCHANT', 'RIDER', 'OPERATOR', 'SYSTEM', 'WEBHOOK')),
  actor_id uuid,
  reason text,
  correlation_id uuid,
  occurred_at timestamptz not null default now()
);

comment on table public.delivery_status_history is
  'Append-only. Kept separate from order_status_history — a delivery status change is not an order status change (DEC-018).';

create index delivery_status_history_delivery_idx
  on public.delivery_status_history (delivery_id, occurred_at);

create trigger delivery_status_history_reject_mutation
  before update or delete on public.delivery_status_history
  for each row execute function public.reject_mutation();

revoke all on public.delivery_status_history from anon, authenticated;
alter table public.delivery_status_history enable row level security;

-- ---------------------------------------------------------------------------
-- rider_assignments — claim history AND the rider-race backstop
-- ---------------------------------------------------------------------------
--
-- ============================================================================
-- RIDER RACE CONDITION PROTECTION — read this before changing anything below.
--
-- Scenario: Order #123's delivery is broadcast. Rider A and Rider B both tap
-- Accept within the same instant. Exactly one may become the assigned rider.
--
-- Layer 1 (primary, application-level, NOT in this migration): NestJS issues
-- a GUARDED CONDITIONAL UPDATE —
--
--   UPDATE deliveries
--      SET state = 'RIDER_ASSIGNED', rider_id = :riderId, assigned_at = now()
--    WHERE id = :deliveryId
--      AND state IN ('RIDER_SEARCHING', 'RIDER_REASSIGNING')
--      AND rider_id IS NULL;
--
-- Under READ COMMITTED, the second concurrent UPDATE blocks on the row
-- lock, then re-evaluates its WHERE clause against the row the first
-- transaction just committed — and matches nothing, because rider_id is no
-- longer NULL. Rows affected: 1 = won, 0 = lost. No advisory lock, no
-- queue, no SELECT-then-UPDATE (which this schema deliberately does not
-- support — there is no window for a check-then-act race).
--
-- Layer 2 (database-level backstop, THIS INDEX):
--
--   rider_assignments_one_active, below.
--
-- Even if a future refactor broke the WHERE-clause guard above, this
-- partial unique index makes it physically impossible for two
-- rider_assignments rows with status = 'ACCEPTED' to exist for the same
-- delivery_id. Two independent mechanisms, because DEC-020's broadcast
-- dispatch makes this the hottest contested path in the product.
--
-- Layer 3 (release invariants, application-level, NOT in this migration):
-- reassignment (DEC-021) requires BOTH of these in the SAME transaction —
--
--   UPDATE deliveries
--      SET state = 'RIDER_SEARCHING', rider_id = NULL, ...
--    WHERE id = :deliveryId AND state IN ('RIDER_ASSIGNED','RIDER_REASSIGNING');
--
--   UPDATE rider_assignments
--      SET status = 'CANCELLED'|'RELEASED', closed_at = now(), ...
--    WHERE delivery_id = :deliveryId AND status = 'ACCEPTED';
--
-- Omitting either statement makes the delivery PERMANENTLY UNASSIGNABLE:
-- leaving deliveries.rider_id set makes Layer 1's "rider_id IS NULL" guard
-- unsatisfiable forever; leaving the old rider_assignments row ACCEPTED
-- makes rider_assignments_one_active (Layer 2) reject the next rider. This
-- was found by the 2026-08-11 architecture review — see
-- docs/TECHNICAL_ARCHITECTURE.md § 8.5 and ADR-003.
--
-- TQ-012 requires this to be proven by execution against real PostgreSQL,
-- not by reasoning about it — see supabase/tests/rider_race_test.sql.
-- ============================================================================

create table public.rider_assignments (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete restrict,
  rider_id uuid not null references public.riders (id) on delete restrict,
  status text not null default 'ACCEPTED'
    check (status in ('ACCEPTED', 'CANCELLED', 'RELEASED', 'COMPLETED')),
  accepted_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now()
);

comment on table public.rider_assignments is
  'Claim HISTORY — never read to answer "who is delivering this now" (that is deliveries.rider_id). rider_assignments_one_active is the database-level rider-race backstop; see the comment block above this table. Rows never deleted.';

-- ============================================================================
-- THE RIDER RACE BACKSTOP.
--
-- At most one row per delivery may hold status = 'ACCEPTED' at any time.
-- This is Layer 2 of the strategy documented above — do not drop or weaken
-- this index without a replacement mechanism and a new architecture review.
-- ============================================================================
create unique index rider_assignments_one_active
  on public.rider_assignments (delivery_id)
  where status = 'ACCEPTED';

create index rider_assignments_rider_idx
  on public.rider_assignments (rider_id, accepted_at desc);

-- "Never deleted" (§ 13) — status/closed_at advance instead.
create trigger rider_assignments_reject_delete
  before delete on public.rider_assignments
  for each row execute function public.reject_delete();

revoke all on public.rider_assignments from anon, authenticated;
alter table public.rider_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- rider_assignment_attempts — the broadcast offer log
-- ---------------------------------------------------------------------------
--
-- What makes "why did nobody take this order?" answerable. Also a rider's
-- ONLY read path to a broadcast offer before they accept — an unaccepted
-- rider is not yet a party to the order or the delivery.

create table public.rider_assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete cascade,
  rider_id uuid not null references public.riders (id) on delete cascade,
  round_no int not null check (round_no > 0),
  offered_at timestamptz not null default now(),
  expires_at timestamptz,
  outcome text not null default 'PENDING'
    check (outcome in ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED')),

  constraint rider_assignment_attempts_delivery_rider_round_key
    unique (delivery_id, rider_id, round_no)
);

comment on table public.rider_assignment_attempts is
  'The dispatch audit trail. A rider''s only read path to a broadcast offer before accepting — see docs/DATABASE_DESIGN.md § 18 "The rider''s read path".';

create index rider_assignment_attempts_pending_idx
  on public.rider_assignment_attempts (rider_id)
  where outcome = 'PENDING';

revoke all on public.rider_assignment_attempts from anon, authenticated;
alter table public.rider_assignment_attempts enable row level security;
