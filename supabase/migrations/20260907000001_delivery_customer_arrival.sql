-- BANHAO — BQ-017 Slice #1: the customer-arrival foundation (DEC-054).
--
-- 1. WHY. DEC-053 resolves BQ-017: a post-pickup delivery that cannot be
--    completed ends as delivery FAILED / order DELIVERY_FAILED, declared by
--    an operator after 2 contact attempts and a 5-minute wait. DEC-054 locks
--    the anchor that wait is measured from, and it is NOT an existing
--    concept:
--
--      merchant arrival   RIDER_ASSIGNED -> AT_MERCHANT   (existing, unchanged)
--      customer arrival   EN_ROUTE       -> ARRIVED       (new — this migration)
--
--    AT_MERCHANT means "the rider reached the shop". ARRIVED means "the rider
--    reached the customer's delivery location". DEC-054 records that an
--    implementer wiring the timer to the endpoint whose *name* matched the
--    policy word would have started the five-minute clock at the shop, before
--    the food was collected. The two are kept textually distinct for exactly
--    that reason, here and everywhere else.
--
-- 2. WHAT THIS MIGRATION IS NOT.
--    * NOT the DEC-053 failure path. Nothing here writes FAILED, failed_at,
--      failure_cause, DELIVERY_FAILED or cause_code, and no operator command
--      exists yet. Those are the next slice.
--    * NOT the timer. The index below is created for a future scan; no runner
--      reads it in this slice and /internal/tick is untouched.
--    * NOT contact attempts. No table, column or counter for them is added.
--    * NOT financial. No refund, ledger, compensation or write-off surface is
--      created or implied — Q-020 and BQ-024 are both still OPEN.
--    * NOT a change to AT_MERCHANT or to POST /rider/deliveries/:id/arrived.
--
-- 3. THE STATE CHECK. deliveries.state's constraint is declared inline in
--    20260811000009_delivery_domain.sql, so PostgreSQL auto-named it
--    deliveries_state_check. PostgreSQL has no "ALTER CONSTRAINT ... ADD
--    VALUE", so the constraint is dropped and recreated with the identical
--    list plus ARRIVED. Every one of the ten existing values is preserved
--    verbatim; none is removed, renamed or reordered, and no unrelated state
--    is added. Existing rows are unaffected — the new list is a strict
--    superset, so nothing that validated before can fail now. The recreated
--    constraint keeps the original name, so a future migration or a reader
--    grepping for deliveries_state_check still finds it.
--
--    ARRIVED sits between EN_ROUTE and the terminal outcomes. It is a
--    progression state, not a terminal one: DELIVERED, FAILED and ABANDONED
--    remain the only terminals, and this migration adds no new terminal.
--
-- 4. arrived_at. Nullable, no default, no backfill. Every existing delivery
--    keeps NULL, which is the honest answer — none of them recorded a
--    customer arrival, and inventing one would corrupt the anchor DEC-053's
--    timer will later measure from. A delivery completed before this
--    migration therefore has delivered_at set and arrived_at NULL, exactly as
--    it happened.
--
--    Write-once by application rule, not by trigger. deliveries deliberately
--    carries no column-immutability trigger (20260811000009: "state and
--    rider_id are meant to change freely as the delivery progresses"), and
--    adding one now would have to enumerate every mutable column and would
--    risk the delivery state machine itself. The write-once property is
--    instead a structural consequence of the guarded UPDATE that sets it:
--    the transition matches only `state = 'EN_ROUTE'`, and ARRIVED never
--    returns to EN_ROUTE, so the statement that writes arrived_at can match a
--    given row at most once. Stated plainly rather than claimed as a database
--    guarantee — the same honesty 20260811000009 applies to proof_photo_path
--    (POD-Q-07).
--
-- 5. NO RLS CHANGE, NO NEW GRANT. `grant select on public.deliveries to
--    authenticated` (20260811000011_rls_policies.sql) is table-level, so
--    arrived_at is readable by the assigned rider through the existing
--    deliveries_select_rider policy and by nobody else — which is what the
--    driver app needs and all it needs. `authenticated` holds no UPDATE grant
--    on deliveries at all, and this migration adds none: the transition is
--    issued by the NestJS API's service-role client like every other delivery
--    transition (DEC-APP-008, ADR-001). anon is unchanged and still reads
--    nothing.
--
-- 6. THE INDEX. DEC-053's five-minute wait will be evaluated by scanning for
--    deliveries that have been ARRIVED for long enough. The existing
--    deliveries_searching_idx covers only RIDER_SEARCHING/RIDER_REASSIGNING,
--    so that scan has no index today. This is the smallest one that serves
--    it: partial on the single state the scan filters by, keyed by the single
--    column it orders and compares on. It stays tiny — a delivery is ARRIVED
--    for minutes, then leaves the predicate — and it is created now, with the
--    column, rather than left for the slice that adds the runner, so the
--    scan is never introduced against an unindexed table.

alter table public.deliveries
  drop constraint deliveries_state_check;

alter table public.deliveries
  add constraint deliveries_state_check check (state in (
    'UNASSIGNED', 'RIDER_SEARCHING', 'RIDER_ASSIGNED', 'RIDER_REASSIGNING',
    'AT_MERCHANT', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'FAILED', 'ABANDONED'
  ));

alter table public.deliveries
  add column arrived_at timestamptz;

comment on column public.deliveries.arrived_at is
  'DEC-054. When the rider reached the CUSTOMER''S delivery location — the EN_ROUTE -> ARRIVED transition. NOT merchant arrival: that is state AT_MERCHANT, reached by POST /api/v1/rider/deliveries/:id/arrived, and it has no timestamp column. This is the authoritative anchor for DEC-053''s 5-minute wait; that timer does not exist yet. NULL for every delivery created before this migration and for every delivery that has not yet reached the customer. Written once, by the guarded EN_ROUTE -> ARRIVED update alone, and never rewritten — an application property, not a trigger (see this migration''s header, § 4).';

-- The future DEC-053 timer scan's index. Nothing reads it in this slice.
create index deliveries_arrived_idx
  on public.deliveries (arrived_at)
  where state = 'ARRIVED';
