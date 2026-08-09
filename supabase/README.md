# Supabase

PostgreSQL + PostGIS + Auth + Storage + Realtime (DEC-010).

## Migrations

Applied in filename order. Naming: `YYYYMMDDHHMMSS_description.sql`.

| Migration | What it does |
|---|---|
| `20260809000001_enable_extensions.sql` | `uuid-ossp`, PostGIS |
| `20260809000002_profiles_and_roles.sql` | `user_role` enum, `profiles` table, signup trigger, RLS |
| `20260809000003_harden_profiles_rls.sql` | Column privileges, non-recursive policies, immutability trigger, `set_user_role()` |

## What exists so far

Only the **authentication and user-profile foundation**. The full domain schema
(orders, payments, refunds, ledger_entries, settlements, delivery_jobs, …) is
deliberately not created yet — it depends on decisions that are still open
(Q-001 payment provider, Q-002 legal/settlement model, Q-010 platform fee,
Q-020 refund mechanism). Writing a financial schema before those are answered
would mean rewriting it.

## Rules for future migrations

**PostgreSQL is the system of record** for `orders`, `payments`, `refunds`,
`ledger_entries`, and `settlements` (DEC-014). Realtime, client state, and any
cache are projections — never the source of truth for money.

Financial tables, when added, must be:

- **Idempotent** — a unique constraint on the operation key, so a retried
  webhook cannot create a second row (REQ-003).
- **Auditable** — append-only ledger entries; correct by writing a reversing
  entry, never by mutating or deleting one (CON-003).
- **Transactional** — an order state change and its ledger entries commit
  together or not at all.

And Order state must stay separate from Payment state (CON-001) — two columns
on two tables, never one merged status.

## Running locally

See [`docs/SETUP.md`](../docs/SETUP.md).

```bash
supabase start           # local stack
supabase db reset        # apply all migrations from scratch
supabase migration new <name>
```

## RLS

Enabled on `profiles`, with three layers so no single mistake re-opens access:

1. **Column privileges** — `authenticated` may write only `display_name`.
2. **RLS policies** — a user may only read and update their own row. The
   policies do not reference `profiles`, so they cannot recurse.
3. **Trigger** — `enforce_profile_immutable_columns()` rejects any client change
   to `role`, `id`, or `phone`, as a backstop against a future over-broad GRANT.

Clients have no INSERT or DELETE path: creation is the `on_auth_user_created`
trigger, deletion cascades from `auth.users`. `anon` cannot read `profiles`.

Role assignment goes through `public.set_user_role(uuid, user_role)`, which is
service-role only — one auditable entry point instead of ad-hoc updates.

The API uses the service-role key and bypasses RLS by design; it enforces
authorization in its own guards. RLS is the second line of defence for direct
client access.

> **Why not enforce "role unchanged" inside the policy?** RLS `WITH CHECK` only
> sees the new row, so the original policy had to query `profiles` from inside a
> `profiles` policy. That worked, but only because no SELECT policy referenced
> `profiles` — adding one (e.g. "admins can read all profiles") would make it
> genuinely recursive and break every update. Column privileges express the same
> rule declaratively and cannot recurse.

### Verifying RLS

```bash
./supabase/tests/run-rls-tests.sh
```

Starts a throwaway PostgreSQL 16 + PostGIS container, applies the auth shim and
every migration, then runs 13 assertions covering SELECT own/other, UPDATE
own/other, role escalation, phone and id immutability, INSERT, DELETE, anon
access, recursion, and the `set_user_role` path. Exits non-zero on any failure.

**Limitations — this does NOT verify:**

- Supabase's own GoTrue auth service, real JWT issuance, or PostgREST. The shim
  reproduces only `auth.uid()` and the three database roles.
- Anything against a live Supabase project. End-to-end auth is still unverified.
- Storage or Realtime policies (none exist yet).

The suite has been checked against a negative control (running it with the
hardening migration removed), where it correctly fails — so it measures the
migrations rather than its own fixture.
