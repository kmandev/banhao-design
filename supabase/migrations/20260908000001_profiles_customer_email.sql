-- BANHAO — customer payment email (DEC-056)
--
-- Adds public.profiles.email: BANHAO-owned customer data (never Stripe,
-- never Supabase Auth, never a JWT claim — DEC-056 clauses 1, 9, 10),
-- collected at payment time rather than phone-OTP signup (clause 2).
--
-- Nullable, additive, no backfill: every existing row starts NULL and stays
-- NULL until the customer supplies one through PATCH /api/v1/me. No
-- synthetic value is written here or anywhere (clause 9) — a customer with
-- no email simply has NULL until they provide one, and every other profile
-- field, every existing row, and every other table is untouched.
--
-- Follows the display_name precedent exactly
-- (20260809000003_harden_profiles_rls.sql): a client may write this one
-- additional column, enforced by a column-level GRANT, not by widening RLS.
-- The existing profiles_update_own policy already scopes every update to the
-- caller's own row (`auth.uid() = id`, `with check (auth.uid() = id)`) and
-- needs no change — it checks row ownership only, never which columns
-- changed, so it already covers this column the moment the grant below
-- allows writing it. `profiles_enforce_immutable_columns` (the same
-- migration) only protects role/id/phone; it does not need to know about
-- this column either, and does not raise for it.
--
-- Format validation is `emailSchema` (packages/validation/src/common.ts,
-- DEC-056 clause 6 — a practical Phase 1 check, not full RFC 5322), applied
-- server-side by `AuthController.updateMe` before this column is ever
-- written, and independently re-applied by
-- `PaymentsService.resolveAuthoritativeEmail` before any payment can use the
-- value. This matches the codebase's existing convention of no DB-level
-- format CHECK for free-text identity fields — `phone` carries none either;
-- `thaiPhoneSchema` is where that validation lives.

alter table public.profiles add column email text;

comment on column public.profiles.email is
  'Customer payment email (DEC-056) — BANHAO-owned, collected at payment time via PATCH /api/v1/me, never at signup. NULL until the customer supplies one; never backfilled, never synthetic. Client-writable (see the column grant below); read authoritatively server-side by PaymentsService via CustomerEmailSource, independent of how it was set.';

-- Additive column grant, following display_name's own precedent exactly —
-- a client may write this one additional column. Postgres column privileges
-- accumulate: this does not need to repeat the existing display_name grant,
-- and does not touch role/id/phone, which stay off every client grant.
grant update (email) on public.profiles to authenticated;
