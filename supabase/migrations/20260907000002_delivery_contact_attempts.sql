-- BANHAO — BQ-017 Slice #2: customer contact attempts (DEC-053 § 3).
--
-- 1. WHY. DEC-053 makes a post-pickup delivery failure resolvable only after
--    **2 customer contact attempts** and a **5-minute** wait from customer
--    arrival (`deliveries.arrived_at`, added by 20260907000001). The wait has
--    an anchor; the attempts had no representation at all — no table, no
--    counter, no event. This migration is that representation, and nothing
--    more.
--
-- 2. WHY A TABLE AND NOT A COUNTER. DEC-053 § 2 requires the rider to
--    "produce the evidence the operational system supports", and an operator
--    reviews that evidence before declaring the failure. A bare integer on
--    `deliveries` would record that two attempts happened but not *when* or
--    *by whom* — and would be mutable, so an operator could never tell a
--    genuine second attempt from an incremented number. Append-only rows are
--    the evidence; the count is derived from them.
--
--    This follows `delivery_status_history` and `rider_assignment_attempts`,
--    which are append-only child tables of `deliveries` for the same reason.
--
-- 3. THE CAP IS ENFORCED BY THE DATABASE, NOT BY COUNTING.
--
--    A naive `SELECT count(*)` → `if < 2` → `INSERT` is a read-then-write
--    race: two concurrent requests both read 1, both insert, and the delivery
--    ends with 3 attempts. The invariant DEC-053 needs is
--    `count(attempts per delivery) <= 2`, and it is made structural here by
--    two constraints working together:
--
--      * `attempt_no` is CHECKed to be exactly 1 or 2, so no third ordinal
--        can exist at all; and
--      * `delivery_contact_attempts_delivery_attempt_key` makes
--        (delivery_id, attempt_no) unique, so each ordinal exists at most
--        once per delivery.
--
--    Two rows maximum, by construction. Under concurrency the loser's INSERT
--    raises 23505 and the API re-derives the next ordinal — the same
--    "the unique constraint stays the sole authority (DEC-028)" discipline
--    `rider_assignments_one_active`, `rider_assignment_attempts`' own
--    `(delivery_id, rider_id, round_no)` key and `ledger_entry_groups.group_key`
--    already use. No trigger, no advisory lock, no serializable transaction,
--    and no framework.
--
--    Note what is NOT claimed: this does not deduplicate two *genuine*
--    attempts made a minute apart. It must not — those are two separate
--    pieces of evidence, and DEC-053 counts them separately. The constraint
--    bounds the total, which is the invariant that matters.
--
-- 4. WHAT THIS MIGRATION IS NOT.
--    * NOT the failure path. Nothing here writes `deliveries.state`,
--      `failed_at`, `failure_cause` or `orders.cause_code`; the operator
--      command that does is application code, not schema.
--    * NOT a timer. No scheduled scan reads this table in this slice.
--    * NOT financial. No amount, fee, ledger reference or refund field.
--    * NOT a customer-facing record. A contact attempt is the rider's
--      operational act, not a message to the customer, and this table stores
--      no message body, phone number or transcript — the recipient's number
--      already lives on the order snapshot and is not duplicated here.
--
-- 5. SECURITY. `revoke all ... from anon, authenticated` FIRST (Supabase
--    grants ALL on public tables by default), then RLS enabled with **no
--    policy at all** — the same shape `audit_logs`, `outbox` and
--    `delivery_status_history` use. A client therefore reaches this table
--    through nothing: every write is the NestJS API's service-role client
--    (DEC-APP-008, ADR-001), and the rider's own attempt count is served by
--    the API alongside the command that creates it. Append-only is enforced
--    by `reject_mutation` on UPDATE and DELETE, so an attempt can never be
--    edited away or replayed.

create table public.delivery_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries (id) on delete restrict,
  -- Who made the attempt. `riders.id`, matching `deliveries.rider_id`'s own
  -- referent — never a `profiles.id`, which would make "which rider" a second
  -- lookup on evidence an operator reads under time pressure.
  rider_id uuid not null references public.riders (id) on delete restrict,
  -- 1 or 2, and nothing else. Half of the cap; see the header, § 3.
  attempt_no smallint not null
    constraint delivery_contact_attempts_attempt_no_check check (attempt_no in (1, 2)),
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- The other half of the cap. Also what makes a concurrent duplicate fail
  -- loudly (23505) rather than silently becoming a third attempt.
  constraint delivery_contact_attempts_delivery_attempt_key unique (delivery_id, attempt_no)
);

comment on table public.delivery_contact_attempts is
  'DEC-053 § 3 — the rider''s customer-contact attempts for one delivery. Append-only evidence an operator reviews before declaring a post-pickup failure, never a mutable counter. At most TWO rows per delivery, enforced structurally by the attempt_no CHECK (1 or 2) plus the (delivery_id, attempt_no) unique constraint — never by counting rows in the application (see this migration''s header, § 3). Written only by the NestJS API''s service-role client; no client policy exists. Carries no message body, phone number or financial field.';

comment on column public.delivery_contact_attempts.attempt_no is
  'The ordinal, 1 or 2. DEC-053 fixes the maximum at 2; a third attempt is refused by the CHECK and by the unique constraint, not by an application count.';
comment on column public.delivery_contact_attempts.attempted_at is
  'When the rider made the attempt. Distinct from deliveries.arrived_at, which is DEC-053''s five-minute timer anchor (DEC-054) — an attempt neither starts nor extends that timer.';

-- The API's own read: "how many attempts does this delivery have, and when?"
create index delivery_contact_attempts_delivery_idx
  on public.delivery_contact_attempts (delivery_id, attempted_at);

-- Append-only. An attempt is evidence: it is never edited and never removed.
create trigger delivery_contact_attempts_reject_mutation
  before update or delete on public.delivery_contact_attempts
  for each row execute function public.reject_mutation();

revoke all on public.delivery_contact_attempts from anon, authenticated;
alter table public.delivery_contact_attempts enable row level security;
