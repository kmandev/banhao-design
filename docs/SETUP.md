# Setup

First-time setup for the BANHAO monorepo.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 (22 recommended) | CI runs on 22 |
| pnpm | 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Supabase CLI | latest | [install guide](https://supabase.com/docs/guides/cli) |
| Docker | any recent | Optional — only needed to run the API in a container |

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in the Supabase values from your project dashboard (Settings → API):

| Variable | Where to find it | Who may see it |
|---|---|---|
| `SUPABASE_URL` | Project URL | Anyone |
| `SUPABASE_ANON_KEY` | Project API keys → `anon public` | Clients — protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API keys → `service_role` | **Backend only** |
| `SUPABASE_JWT_SECRET` | Settings → API → JWT Secret | **Backend only** |

> ⚠️ The service role key **bypasses Row Level Security entirely**. It must
> never appear in a React Native bundle, a Next.js browser bundle, or any
> client-side JavaScript. Only `apps/api` reads it. See `AGENTS.md`.

`.env` is gitignored. Never commit it.

## 3. Set up Supabase

Local stack:

```bash
supabase start
supabase db reset      # applies every migration in supabase/migrations
```

Or push migrations to a hosted project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Phase 1 authentication is **Phone OTP**, so enable the Phone provider in
Authentication → Providers and configure an SMS provider.

> Note: sending OTP SMS to Thai numbers needs an NBTC-registered Sender ID, and
> since October 2025 Thai operators prepend a warning marker to SMS originating
> overseas. See Q-019 in `ai/KNOWLEDGE/QUESTIONS.md` — this has ~2 weeks of
> lead time and should be started early.

## 4. Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All four must pass before committing.

## 5. Run the API

```bash
pnpm --filter @banhao/api dev
```

- API: http://localhost:3000
- OpenAPI docs: http://localhost:3000/docs
- Health check: `curl http://localhost:3000/health`

Expected:

```json
{ "success": true, "data": { "status": "ok", "service": "banhao-api", ... } }
```

## 6. Run the apps

```bash
pnpm --filter @banhao/admin dev       # Next.js  → http://localhost:3001
pnpm --filter @banhao/customer dev    # Expo
pnpm --filter @banhao/merchant dev    # Expo
pnpm --filter @banhao/driver dev      # Expo
```

Expo opens its dev tools; press `i` for iOS Simulator, `a` for Android, or scan
the QR code with Expo Go.

## Docker (optional)

```bash
docker compose up --build
```

Only the API is containerised — Supabase runs via its own CLI, and the mobile
apps need host tooling. See `docker-compose.yml`.

## Troubleshooting

**`EnvValidationError` on API start** — a required variable is missing from
`.env`. The error names each one.

**`User profile not found` from `/api/v1/me`** — the user authenticated with
Supabase but has no `profiles` row. The `on_auth_user_created` trigger creates
one automatically; if it's missing, migrations probably haven't been applied
(`supabase db reset`).

**Expo can't resolve `@banhao/*`** — run `pnpm install` from the repo root, not
from inside the app directory.
