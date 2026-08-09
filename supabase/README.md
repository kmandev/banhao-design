# Supabase

PostgreSQL + PostGIS + Auth + Storage + Realtime (DEC-010).

## Migrations

Applied in filename order. Naming: `YYYYMMDDHHMMSS_description.sql`.

| Migration | What it does |
|---|---|
| `20260809000001_enable_extensions.sql` | `uuid-ossp`, PostGIS |
| `20260809000002_profiles_and_roles.sql` | `user_role` enum, `profiles` table, signup trigger, RLS |

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

Enabled on `profiles`. Policies are intentionally minimal at this stage:
a user may read their own profile and update it **except** their role.

Profile creation is handled by the `on_auth_user_created` trigger and deletion
cascades from `auth.users`, so no client-facing INSERT or DELETE policy exists.

The API uses the service-role key and bypasses RLS by design — it enforces
authorization in its own guards. RLS is the second line of defence protecting
the table from direct anon-key access.
