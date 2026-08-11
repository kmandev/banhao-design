-- BANHAO — HIGH-2 fix: rider reassignment atomicity (Architect Review, Step 7.2)
--
-- docs/DATABASE_DESIGN.md § 11.1 and 20260811000009_delivery_domain.sql
-- already document that a rider release requires BOTH of the following
-- statements in the SAME transaction:
--
--   update deliveries set state = 'RIDER_SEARCHING', rider_id = null, ...
--    where id = :deliveryId and state in ('RIDER_ASSIGNED','RIDER_REASSIGNING');
--
--   update rider_assignments set status = :cancelledOrReleased, closed_at = now(), ...
--    where delivery_id = :deliveryId and status = 'ACCEPTED';
--
-- supabase/tests/rider_race_assertions.sql (§4) already PROVES what happens
-- when an application only performs the first statement: the delivery looks
-- released (rider_id is null), but the next rider's claim raises
-- `23505 unique_violation` on `rider_assignments_one_active` — a hard,
-- unhandled database error, not a quiet failure. The database-level race
-- protection itself (the guarded UPDATE plus the partial unique index) is
-- correct and is NOT changed by this migration.
--
-- What was missing is a single, atomic, database-owned entry point for the
-- release — so "both statements, same transaction" is a property of the
-- API surface, not a rule the caller has to remember to follow correctly
-- every time. This migration adds exactly that.
--
-- SECURITY MODEL (corrected by the Architect Review's Step 7.3 pass — M-1):
-- this function is `SECURITY INVOKER` (the plain default — the `security
-- definer` clause an earlier version of this file had is REMOVED), not
-- `SECURITY DEFINER` like `set_user_role`. Two independent reasons:
--
--   1. It does not need elevated privilege. `service_role` already has
--      `bypassrls` and direct table grants on `deliveries`/
--      `rider_assignments` (the `revoke all ... from anon, authenticated`
--      statements in earlier migrations never touch `service_role`) — so a
--      `service_role` caller can perform every statement in this function
--      under its own privileges, with no owner substitution required.
--   2. `SECURITY DEFINER` made the in-function guard below
--      (`pg_has_role(current_user, 'service_role', 'member')`) FALSE
--      SECURITY: inside a `SECURITY DEFINER` function, `current_user`
--      resolves to the function's OWNER, not the caller — proven locally
--      (Step 7.3) by granting `EXECUTE` to `authenticated` and watching a
--      rider successfully release ANOTHER rider's delivery, because the
--      guard was silently checking whether the OWNER (a superuser in the
--      test container, which auto-passes any pg_has_role check) was a
--      service_role member, never the actual caller. Under `SECURITY
--      INVOKER`, `current_user` is genuinely the caller's role, so the same
--      guard now means what it says — and, as a second consequence, even a
--      future accidental `GRANT EXECUTE ... TO authenticated` could not
--      make the internal UPDATEs succeed as a rider either, since an
--      invoker-mode call runs with the CALLER's table privileges, and
--      `authenticated` has none on `deliveries`/`rider_assignments`.
--
-- The primary, load-bearing protection remains the EXECUTE grant at the
-- bottom of this file (`service_role` only) — that is what actually stops
-- an unauthorised caller from reaching this function at all. The
-- `pg_has_role` check is real defence-in-depth now, not vestigial, but it
-- is still the SECOND layer, not the first.
--
-- ATOMICITY GUARANTEE: both UPDATEs happen inside ONE PL/pgSQL function
-- invocation, which is a single statement from the calling transaction's
-- point of view. If the second UPDATE does not affect exactly the one row
-- it must, the function RAISEs — and Postgres rolls back everything the
-- function did, including the first UPDATE, as part of unwinding that one
-- statement. There is no window in which only one of the two UPDATEs is
-- visible to any other session: either both happened, or (as far as any
-- other transaction can observe) neither did. This holds even if the
-- calling application process crashes immediately after issuing the call —
-- an uncommitted/interrupted transaction is simply never committed, which
-- is ordinary Postgres transactional behaviour, not something this
-- migration adds.
--
-- WHAT REMAINS AN APPLICATION-LAYER RESPONSIBILITY (documented, not
-- silently assumed): deciding WHEN to release a rider (a rider tapping
-- "cancel", a no-response timeout, an operator's forced reassignment) and
-- choosing CANCELLED vs RELEASED is a business decision made by NestJS —
-- this function only makes the resulting write atomic and safe, it does
-- not decide when to call it. That decision logic is out of scope for a
-- migration (ADR-001).
--
-- Reviewed per the Architect Review, Step 7.2, HIGH-2 (unchanged — the
-- atomicity guarantee, locking, and invariant checks below are exactly as
-- reviewed and approved) and Step 7.3, M-1 (the security-mode correction
-- above). Does not touch rider_assignments_one_active, does not change the
-- guarded-UPDATE claim path, does not introduce a new delivery or
-- assignment state.

create or replace function public.release_rider_assignment(
  p_delivery_id uuid,
  p_status text,
  p_reason text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_prior_rider uuid;
  v_delivery_rows int;
  v_assignment_rows int;
begin
  -- SECOND layer only — the EXECUTE grant below is what actually stops an
  -- unauthorised caller from reaching this function. This check is
  -- meaningful (not vestigial) specifically BECAUSE this function is
  -- SECURITY INVOKER: current_user here is the real caller's active role,
  -- not a function owner substituted in by SECURITY DEFINER. Riders and
  -- every other client actor reach this exclusively through the NestJS API
  -- (ADR-001: no client writes a delivery/assignment transition directly).
  if not pg_has_role(current_user, 'service_role', 'member') then
    raise exception 'release_rider_assignment may only be called by the service role'
      using errcode = '42501';
  end if;

  if p_status not in ('CANCELLED', 'RELEASED') then
    raise exception 'release_rider_assignment: p_status must be CANCELLED or RELEASED, got %', p_status
      using errcode = '22023';
  end if;

  -- Lock the row and read who is currently assigned BEFORE clearing it.
  -- (A plain `UPDATE ... RETURNING rider_id` would return the NEW value —
  -- NULL, since this statement is the one nulling it — not the prior
  -- rider, so the prior rider has to be captured first. FOR UPDATE takes
  -- the same row lock a guarded UPDATE would take anyway, so this adds no
  -- new race window: any concurrent claim/release on this exact delivery
  -- still serializes on this lock, same as Layer 1's guarded UPDATE does.)
  select rider_id into v_prior_rider
    from public.deliveries
   where id = p_delivery_id
     and state in ('RIDER_ASSIGNED', 'RIDER_REASSIGNING')
     and rider_id is not null
   for update;

  if v_prior_rider is null then
    raise exception 'delivery % is not in a releasable state (must be RIDER_ASSIGNED or RIDER_REASSIGNING with a rider currently assigned)', p_delivery_id
      using errcode = 'P0001';
  end if;

  -- Statement 1 — guarded exactly like the claim's own guarded UPDATE
  -- (ADR-003): the WHERE clause repeats the state/rider check rather than
  -- trusting the SELECT above blindly, even though the FOR UPDATE lock
  -- already makes this safe from a concurrent change.
  update public.deliveries
     set state = 'RIDER_SEARCHING',
         rider_id = null,
         reassignment_count = reassignment_count + 1
   where id = p_delivery_id
     and state in ('RIDER_ASSIGNED', 'RIDER_REASSIGNING')
     and rider_id = v_prior_rider;

  get diagnostics v_delivery_rows = row_count;

  if v_delivery_rows = 0 then
    raise exception 'delivery % is not in a releasable state (must be RIDER_ASSIGNED or RIDER_REASSIGNING with a rider currently assigned)', p_delivery_id
      using errcode = 'P0001';
  end if;

  -- Statement 2 — closes the SAME rider's assignment that statement 1 just
  -- cleared (matched on delivery_id AND rider_id, not delivery_id alone),
  -- so this cannot cross-close a different rider's row.
  update public.rider_assignments
     set status = p_status, closed_at = now(), close_reason = p_reason
   where delivery_id = p_delivery_id
     and rider_id = v_prior_rider
     and status = 'ACCEPTED';

  get diagnostics v_assignment_rows = row_count;

  -- THE BACKSTOP: if this is not exactly 1, the invariant this function
  -- exists to guarantee has already been violated by something other than
  -- this call (there should be precisely one ACCEPTED row for a delivery
  -- whose rider_id was just non-null). Raising here — rather than
  -- proceeding — rolls back statement 1 too, so this function can never
  -- return having nulled deliveries.rider_id while leaving a stale
  -- ACCEPTED assignment behind. That specific half-done state is exactly
  -- the 2026-08-11 architecture review's original finding.
  if v_assignment_rows <> 1 then
    raise exception 'release invariant violated for delivery %: expected exactly one ACCEPTED rider_assignments row for rider %, found %',
      p_delivery_id, v_prior_rider, v_assignment_rows
      using errcode = 'P0001';
  end if;

  return v_prior_rider;
end;
$$;

comment on function public.release_rider_assignment(uuid, text, text) is
  'HIGH-2 fix (Architect Review, Step 7.2/7.3). The sole sanctioned way to release a rider from a delivery for reassignment (DEC-021) — both statements of docs/DATABASE_DESIGN.md § 11.1''s release invariant run inside this one function call, so they succeed or roll back together. SECURITY INVOKER (not DEFINER, see file header M-1 note) — service_role reaches every statement on its own bypassrls/table-grant privileges, no owner substitution needed. Primary protection: the EXECUTE grant below (service_role only). Secondary: the in-body pg_has_role check, meaningful under INVOKER mode. See supabase/tests/rider_reassignment_atomicity_test.sql Cases A-E.';

revoke execute on function public.release_rider_assignment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_rider_assignment(uuid, text, text) to service_role;
