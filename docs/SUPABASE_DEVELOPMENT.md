# Supabase — Development Environment

How the `banhao-dev` Supabase project is configured and how to run the Customer
App against it. Development only. **No secret values appear in this document**;
everything sensitive lives in gitignored `.env` files.

---

## The dev project

| Item | Value |
|---|---|
| Project name | `banhao-dev` |
| Plan | Free |
| Region | `ap-southeast-1` (Singapore) |
| Postgres | with PostGIS enabled (migration `20260809000001`) |
| Auth provider enabled | **Phone** only |
| SMS provider | none — **Supabase Test OTP** |

The project reference and anon key are public client credentials and live in
`apps/customer/.env`, which is gitignored. **The service role key is never put
in any app, any `.env` that a client reads, or any document.** See `AGENTS.md`.

## Migrations

Applied with the Supabase CLI from the repo root:

```bash
supabase db push
```

Migrations in `supabase/migrations/` — in particular
`20260809000003_harden_profiles_rls.sql`, which is what the live RLS check
below exercises.

## Test OTP (no SMS)

Phone auth is tested using Supabase's official **Test OTP** feature. Fixed
phone/code pairs are configured on the project's Auth settings; Supabase accepts
the code without sending an SMS and without a provider account. Two numbers are
configured so the RLS check can sign in as two distinct users.

**No custom OTP backend exists, and no OTP is stored in our database.** The
codes are configuration on the Supabase side.

Do not log an OTP or an access token anywhere.

## Running the Customer App against the dev project

```bash
pnpm --filter @banhao/customer start
```

`apps/customer/.env` must contain:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Both are inlined by `babel-preset-expo` **at transform time**, so after editing
`.env` you must restart Metro with `--clear`, and reloading the app is not
enough — terminate Expo Go and relaunch so a new bundle is fetched.

When the app cannot see these variables it renders a dev-mode notice on the
login screen and refuses to attempt a real sign-in. The absence of that notice
is the quickest confirmation that the environment loaded.

## ⚠️ iOS Simulator cannot hold an HTTP/3 connection to Supabase

**Symptom:** the first HTTPS request to the Supabase host succeeds; every
request after it fails, and React Native surfaces `Network request failed`. It
survives an app restart and a Simulator reboot.

**Cause (measured, not inferred).** From the Simulator's own log:

```
[C738 ... quic-connection, url: https://<ref>.supabase.co/auth/v1/otp, tls ...] cancelled
Task <...> finished with error [-1005] NSURLErrorDomain "The network connection was lost."
```

The first response advertises `alt-svc: h3`. CFNetwork caches that in the app's
`HTTPStorages` database and switches to QUIC, which the Simulator's stack cannot
sustain against this host. Evidence that it is the transport and not the network:
`curl` **inside the same Simulator runtime** reaches the host fine (it does not
use QUIC), and deleting Expo Go's `HTTPStorages` database buys exactly one more
successful request before the cache is poisoned again. Expo Go exposes no switch
to disable HTTP/3.

**Workaround for QA:** `scripts/sim-supabase-proxy.mjs` — a loopback proxy that
forwards every request verbatim to the real Supabase project over HTTPS from the
host, and serves the Simulator over plain HTTP, which never negotiates QUIC. It
also strips `alt-svc` so nothing is re-advertised.

```bash
SIM_PROXY_UPSTREAM=https://<project-ref>.supabase.co node scripts/sim-supabase-proxy.mjs
```

then temporarily set `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54331` and
restart Metro with `--clear`.

**This is not a mock.** Sessions are issued by real GoTrue, and RLS is enforced
by the real database — the QA below was performed through it. Restore the direct
`https://` URL when finished; never point a build that leaves this machine at
the proxy.

Physical devices and Android emulators are unaffected as far as we know — **but
that is untested**, because neither was available.

## Live RLS verification

`supabase/tests/live-rls-check.mjs` signs in through **real Supabase Auth** with
the anon key, exactly as the mobile app does, and then attempts what a hostile
client would.

```bash
node supabase/tests/live-rls-check.mjs
```

**Result: 14 / 14 checks passed** against `banhao-dev` on 2026-08-10.

| Check | Expectation |
|---|---|
| Real session for user A and user B | established via `verifyOtp` |
| Profile row auto-created by trigger | present |
| `profiles.id` matches `auth.users.id` | equal |
| Role defaults to `CUSTOMER` | yes |
| Read another customer's profile | **denied** |
| Unfiltered `select` | returns only own row |
| Escalate own role to `ADMIN` | **rejected** |
| Change protected `phone` | **rejected** |
| Change `id` | **rejected** |
| Insert fabricated profile | **rejected** |
| Delete own profile | **rejected** |
| Update own `display_name` | **allowed** — the only permitted client write |
| Signed-out client reads profiles | returns nothing |

This is distinct from `supabase/tests/rls_profiles_test.sql`, which runs against
a plain PostgreSQL container with an auth shim. That shim does not exercise
GoTrue, real JWT issuance, or PostgREST. **Only results from
`live-rls-check.mjs` may be described as live Supabase verification.**

## What is still not covered

- **Android** — untested against the dev project; no Android SDK on this machine.
- **A physical iOS device** — untested; the HTTP/3 problem above is believed to
  be Simulator-specific but has not been confirmed on hardware.
- **Real SMS delivery** — no SMS provider is configured (Q-019, ~2 week lead
  time for a Thai sender ID).
- Everything except authentication and `profiles` is still mock-backed. No
  order, payment, dispatch, or settlement data exists in this project.
