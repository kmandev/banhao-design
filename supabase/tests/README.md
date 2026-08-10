# Supabase tests — LIVE vs MOCK

Two suites live here. They prove different things, and their results must never
be reported as if they were interchangeable.

## LIVE — `live-rls-check.mjs`

```bash
node live-rls-check.mjs      # from this directory, or give the full path
```

Signs in through **real Supabase Auth** on the `banhao-dev` project using the
anon key and Test OTP numbers, exactly as the mobile app does, then attempts the
operations a hostile client would. Exercises GoTrue, real JWT issuance,
PostgREST, and the real RLS policies.

Requires `apps/customer/.env` (gitignored). Exits non-zero on any failure.

**Only results from this script may be described as live Supabase
verification.** Last run 2026-08-10: **14 / 14 passed**.

## MOCK — `rls_profiles_test.sql` + `00_shim_supabase_auth.sql`

```bash
./run-rls-tests.sh
```

Runs the policies against a plain PostgreSQL 16 + PostGIS container with a small
shim that fakes `auth.uid()` and the Supabase roles. This is what CI runs,
because it needs no project and no credentials.

It does **not** exercise GoTrue, real JWT issuance, or PostgREST. A pass here
means the SQL policies behave; it does not mean authentication works.

The suite is validated against a negative control: with
`20260809000003_harden_profiles_rls.sql` removed, it must fail. An earlier draft
passed that control because its fixture re-applied the grants it claimed to
verify — do not reintroduce permissive grants into the shim.
