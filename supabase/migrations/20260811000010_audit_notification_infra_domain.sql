-- BANHAO — audit, notification, and infrastructure tables
--
-- Implements docs/DATABASE_DESIGN.md § 12 (idempotency_records), § 16
-- (audit_logs, notifications, outbox, jobs, reconciliation_cases).
--
-- audit_logs is the operator-intervention trail required by DEC-032: every
-- manual action must carry a reason, enforced below by a CHECK constraint
-- rather than a comment — "prefer database-enforced invariants" (§25 of the
-- migration brief), applied to exactly the rule that is a database
-- invariant (a reason column being non-null) and not a business policy.

-- ---------------------------------------------------------------------------
-- idempotency_records
-- ---------------------------------------------------------------------------

create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  endpoint text not null,
  user_id uuid references public.profiles (id) on delete set null,
  -- The same key with a DIFFERENT body is a client bug and must return 422,
  -- not a stale response — this is what request_hash is for.
  request_hash text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),

  constraint idempotency_records_key_endpoint_key unique (idempotency_key, endpoint)
);

comment on table public.idempotency_records is
  'Idempotency for operations with no natural key of their own (order creation). Purged on a retention schedule (~30 days proposed, DBQ-008) — not immutable.';

create index idempotency_records_created_idx on public.idempotency_records (created_at);

revoke all on public.idempotency_records from anon, authenticated;
alter table public.idempotency_records enable row level security;

-- ---------------------------------------------------------------------------
-- audit_logs — operator-intervention trail (DEC-032)
-- ---------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in
    ('CUSTOMER', 'MERCHANT', 'RIDER', 'OPERATOR', 'SYSTEM', 'WEBHOOK')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  reason text,
  correlation_id uuid,
  source text not null check (source in ('api', 'worker', 'webhook')),
  created_at timestamptz not null default now(),

  -- DEC-032: every manual operator action must carry a reason. This is a
  -- database invariant (a column must be non-null under a condition), not a
  -- business policy — the CONTENT of the reason remains entirely an
  -- application concern.
  constraint audit_logs_operator_reason_check
    check (actor_type <> 'OPERATOR' or reason is not null)
);

comment on table public.audit_logs is
  'Append-only, no client access. reason is mandatory for every OPERATOR action (DEC-032), enforced by CHECK. before/after should capture changed columns only, with PII redacted at write time — see DBQ-009 (unresolved: exact redaction policy).';

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

create trigger audit_logs_reject_mutation
  before update or delete on public.audit_logs
  for each row execute function public.reject_mutation();

revoke all on public.audit_logs from anon, authenticated;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- outbox — transactional domain events (ADR-005)
-- ---------------------------------------------------------------------------

create table public.outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  attempts int not null default 0,
  last_error text
);

comment on table public.outbox is
  'Written in the SAME transaction as the change that causes it (ADR-005) — no message broker. Purged on a retention schedule once dispatched, not immutable.';

create index outbox_undispatched_idx
  on public.outbox (created_at)
  where dispatched_at is null;

revoke all on public.outbox from anon, authenticated;
alter table public.outbox enable row level security;

-- ---------------------------------------------------------------------------
-- jobs — scheduled/background work (ADR-006), consumed with
-- SELECT ... FOR UPDATE SKIP LOCKED
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_after timestamptz not null default now(),
  next_run_at timestamptz not null default now(),
  state text not null default 'PENDING'
    check (state in ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempts int not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.jobs is
  'ADR-006: PostgreSQL as the Phase 1 job store, behind a JobQueue interface — consumed with SELECT ... FOR UPDATE SKIP LOCKED. dead_lettered_at is set after N attempts and must raise an operator alert (TQ-006) — a silently dropped job in a financial system is unacceptable.';

create index jobs_due_idx
  on public.jobs (next_run_at)
  where state = 'PENDING';

revoke all on public.jobs from anon, authenticated;
alter table public.jobs enable row level security;

-- ---------------------------------------------------------------------------
-- reconciliation_cases — where a late/surplus/mismatched payment lands
-- (DEC-029, DEC-032)
-- ---------------------------------------------------------------------------

create table public.reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in
    ('LATE_PAYMENT', 'SURPLUS_PAYMENT', 'AMOUNT_MISMATCH', 'UNMATCHED_EVENT')),
  payment_id uuid references public.payments (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  payment_event_id uuid references public.payment_events (id) on delete set null,
  state text not null default 'OPEN'
    check (state in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  assigned_to uuid references public.profiles (id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reconciliation_cases is
  'Where a late payment (DEC-029), a surplus payment, or a webhook mismatch lands for operator review (DEC-032). Reconciliation is mandatory rather than optional under DEC-034, since no database trigger enforces the ledger''s zero-sum invariant.';

create index reconciliation_cases_open_idx
  on public.reconciliation_cases (state)
  where state in ('OPEN', 'IN_PROGRESS');

create trigger reconciliation_cases_set_updated_at
  before update on public.reconciliation_cases
  for each row execute function public.set_updated_at();

revoke all on public.reconciliation_cases from anon, authenticated;
alter table public.reconciliation_cases enable row level security;

-- ---------------------------------------------------------------------------
-- notifications / notification_deliveries
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  recipient_type text not null check (recipient_type in ('CUSTOMER', 'MERCHANT', 'RIDER', 'OPERATOR')),
  event_type text not null,
  title text not null,
  body text,
  deep_link text,
  order_id uuid references public.orders (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notification record — persistence is needed in Phase 1 so "was the merchant actually told?" is answerable. No provider integration; channel selection is BQ-035 (OPEN).';

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

revoke all on public.notifications from anon, authenticated;
alter table public.notifications enable row level security;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('PUSH', 'SMS', 'EMAIL', 'IN_APP')),
  state text not null default 'PENDING' check (state in ('PENDING', 'SENT', 'FAILED')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notification_deliveries is
  'Per-channel delivery attempts for one notification. No provider is named (TQ-003) — channel is a label, dispatched by a NotificationChannel adapter (ADR-011).';

create index notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id);

revoke all on public.notification_deliveries from anon, authenticated;
alter table public.notification_deliveries enable row level security;
