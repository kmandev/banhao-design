-- BANHAO — DEC-068 C3 / C3-A: restaurant availability mode change, atomic with its audit row
--
-- ---------------------------------------------------------------------------
-- What this is for
-- ---------------------------------------------------------------------------
--
-- DEC-068 C3-A (Product Owner, 2026-11-02) amends M-AV G-2: for a
-- NORMAL / BUSY / PAUSED mode change, the audit record is no longer best
-- effort. Every successful change has an audit row, and if the row cannot be
-- written the change fails. G-2 item 6 recorded that the two writes were two
-- separate PostgREST requests and "not atomic"; that is exactly what this
-- function replaces. One function body is one transaction, so a failing audit
-- INSERT rolls the UPDATE back with it.
--
-- Additive only. No table, column, constraint, trigger, index, grant or RLS
-- policy on any existing object is modified. The one new object is this
-- function, `service_role`-only and `SECURITY INVOKER`, exactly as
-- `create_order` and the four merchant catalog-write functions are.
--
-- ---------------------------------------------------------------------------
-- What it does
-- ---------------------------------------------------------------------------
--
--   1. Locks the restaurant row (`FOR UPDATE`), so the read, the guard and the
--      write below see one consistent row even against a concurrent change.
--   2. Returns `NOT_FOUND` if there is no such restaurant.
--   3. Returns `NOOP` — with **no UPDATE and no audit row** — when the request
--      would change nothing (AC-12: "same mode, no error, no duplicate audit
--      row").
--   4. Returns `INVALID_TRANSITION` when the target is not reachable from the
--      current mode. The rule is unchanged from the service it replaces:
--      NORMAL from anywhere; BUSY only from NORMAL or BUSY; PAUSED from
--      anywhere. `PAUSED -> BUSY` is two calls, not one (AV-D02).
--   5. Otherwise UPDATEs `availability_mode` / `busy_prep_minutes` and INSERTs
--      the `audit_logs` row in the same transaction, then returns `CHANGED`.
--
-- ---------------------------------------------------------------------------
-- The audit row (DEC-068 C3)
-- ---------------------------------------------------------------------------
--
-- Actor, role, restaurant, old mode, new mode, timestamp and source:
--
--   actor_id / actor_type   who; `MERCHANT` for a restaurant member,
--                           `OPERATOR` for BANHAO staff (DEC-068 C3-A: an
--                           existing actor type, no new one)
--   entity_id               the restaurant
--   before / after          old and new `availabilityMode` / `busyPrepMinutes`;
--                           `after` also carries `actorRole` and `merchantId`
--   created_at              the timestamp (column default)
--   source                  passed in; the API sends `api`
--
-- **Staff must give a reason.** `audit_logs_operator_reason_check` (DEC-032)
-- already makes a NULL reason on an OPERATOR row impossible, but this function
-- also refuses a blank one up front with a clear message rather than letting a
-- member's empty string through as "a reason".
--
-- The action name stays `MerchantAvailabilityChanged`, so every existing
-- reader of those rows is unaffected.
--
-- ---------------------------------------------------------------------------
-- What it deliberately does not do
-- ---------------------------------------------------------------------------
--
-- It does not touch `restaurants.status` or `temporarily_closed_until`.
-- Operating mode is not restaurant status and is not a temporary close
-- (DEC-041, DEC-068 C3). It does not decide *who* may call it: the API proves
-- membership or staff grant before calling, as it does for every write.

create or replace function public.set_restaurant_availability(
  p_restaurant_id uuid,
  p_mode text,
  p_busy_prep_minutes integer,
  p_actor_id uuid,
  p_actor_type text,
  p_actor_role text,
  p_reason text,
  p_source text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_old public.restaurants%rowtype;
  v_new public.restaurants%rowtype;
  v_allowed_from text[];
begin
  if p_mode not in ('NORMAL', 'BUSY', 'PAUSED') then
    raise exception 'set_restaurant_availability: unknown mode %', p_mode;
  end if;

  if p_actor_type not in ('MERCHANT', 'OPERATOR') then
    raise exception 'set_restaurant_availability: actor_type must be MERCHANT or OPERATOR, got %', p_actor_type;
  end if;

  if p_actor_id is null then
    raise exception 'set_restaurant_availability: actor_id is required';
  end if;

  if p_actor_role is null or btrim(p_actor_role) = '' then
    raise exception 'set_restaurant_availability: actor_role is required';
  end if;

  if p_actor_type = 'OPERATOR' and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'set_restaurant_availability: staff changes require a reason (DEC-068 C3, DEC-032)';
  end if;

  select * into v_old from public.restaurants r where r.id = p_restaurant_id for update;

  if not found then
    return jsonb_build_object('result', 'NOT_FOUND');
  end if;

  if v_old.availability_mode = p_mode
     and v_old.busy_prep_minutes is not distinct from p_busy_prep_minutes then
    return jsonb_build_object(
      'result', 'NOOP',
      'restaurantId', v_old.id,
      'availabilityMode', v_old.availability_mode,
      'busyPrepMinutes', v_old.busy_prep_minutes,
      'updatedAt', v_old.updated_at
    );
  end if;

  v_allowed_from := case p_mode
    when 'NORMAL' then array['NORMAL', 'BUSY', 'PAUSED']
    when 'BUSY' then array['NORMAL', 'BUSY']
    else array['NORMAL', 'BUSY', 'PAUSED']
  end;

  if not (v_old.availability_mode = any (v_allowed_from)) then
    return jsonb_build_object(
      'result', 'INVALID_TRANSITION',
      'currentMode', v_old.availability_mode
    );
  end if;

  -- The table's own pairing and value CHECKs fire here for an invalid
  -- busy_prep_minutes and abort the whole call. Nothing re-implements them.
  update public.restaurants r
     set availability_mode = p_mode,
         busy_prep_minutes = p_busy_prep_minutes
   where r.id = p_restaurant_id
  returning * into v_new;

  -- Same transaction as the UPDATE above: if this INSERT fails for any reason,
  -- the mode change is rolled back and the caller sees an error. Nothing here
  -- catches an exception — fail-closed is the whole point of C3-A.
  insert into public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id,
    before, after, reason, correlation_id, source
  ) values (
    p_actor_type,
    p_actor_id,
    'MerchantAvailabilityChanged',
    'restaurant',
    p_restaurant_id,
    jsonb_build_object(
      'availabilityMode', v_old.availability_mode,
      'busyPrepMinutes', v_old.busy_prep_minutes
    ),
    jsonb_build_object(
      'availabilityMode', v_new.availability_mode,
      'busyPrepMinutes', v_new.busy_prep_minutes,
      'actorRole', p_actor_role,
      'merchantId', v_new.merchant_id
    ),
    nullif(btrim(p_reason), ''),
    p_correlation_id,
    p_source
  );

  return jsonb_build_object(
    'result', 'CHANGED',
    'restaurantId', v_new.id,
    'availabilityMode', v_new.availability_mode,
    'busyPrepMinutes', v_new.busy_prep_minutes,
    'updatedAt', v_new.updated_at
  );
end;
$$;

comment on function public.set_restaurant_availability(uuid, text, integer, uuid, text, text, text, text, uuid) is
  'DEC-068 C3/C3-A. Changes restaurants.availability_mode and writes its audit_logs row in one transaction: no audit row, no change. Returns {result: CHANGED|NOOP|INVALID_TRANSITION|NOT_FOUND}. service_role only.';

revoke execute on function public.set_restaurant_availability(uuid, text, integer, uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.set_restaurant_availability(uuid, text, integer, uuid, text, text, text, text, uuid)
  to service_role;
