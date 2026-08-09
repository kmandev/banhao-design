# Development

Day-to-day guide for working in the BANHAO monorepo. For first-time setup see
[`SETUP.md`](SETUP.md).

## Layout

```
apps/
  api/        NestJS modular monolith — the only backend
  customer/   Expo (React Native)
  merchant/   Expo (React Native)
  driver/     Expo (React Native)
  admin/      Next.js

packages/
  types/       Shared TypeScript types — Role, UserProfile, ApiResponse, Money
  validation/  Shared zod schemas used by both frontend and backend
  api-client/  One typed HTTP client for all four apps
  config/      Validated environment loading (backend)
  ui/          Design tokens from the Design System canvas

supabase/migrations/   SQL migrations, applied in filename order
```

## Commands

Run from the repo root — Turborepo fans them out across the workspace.

```bash
pnpm lint          # ESLint
pnpm typecheck     # tsc --noEmit everywhere
pnpm test          # Jest
pnpm build         # Build all packages and apps
pnpm format        # Prettier write
```

Scope to one workspace with `--filter`:

```bash
pnpm --filter @banhao/api test
pnpm --filter @banhao/api dev
```

## Adding a shared type

Types live in `packages/types` so the API and all four apps agree. Never
redeclare a shared shape inside an app — CON-001 depends on every client
agreeing on the same Order and Payment state values.

```ts
// packages/types/src/order.ts
export const ORDER_STATES = ['NEW', 'ACCEPTED', ...] as const;
export type OrderState = (typeof ORDER_STATES)[number];
```

Export it from `src/index.ts`, then `pnpm build` so consumers pick it up.

## Adding validation

Schemas live in `packages/validation` and are used by both sides — the frontend
for instant feedback, the backend as the authoritative check. **The backend
must always validate regardless of what the client did.**

## Adding an API module

See [`apps/api/src/modules/README.md`](../apps/api/src/modules/README.md).
Briefly:

1. Create `apps/api/src/modules/<name>/` with a module, controller, service.
2. Register it in `app.module.ts`.
3. Routes are authenticated by default. Use `@Public()` to opt out, `@Roles()`
   to restrict.
4. Don't read another module's tables directly — call its service.

## Authentication and authorization

Two global guards run on every request:

1. **`SupabaseAuthGuard`** — verifies the Supabase JWT, loads the profile,
   attaches `request.user`. The role comes from the **database**, never from a
   token claim or header the client controls.
2. **`RolesGuard`** — enforces `@Roles(...)`.

```ts
@Roles('ADMIN')
@Get('reports')
getReports() { ... }
```

Routes are protected by default, so forgetting a decorator fails closed.

## Money

Money is an **integer in satang** (`@banhao/types` → `Money`, `Satang`).
฿130.50 is `13050`. Never use floating point — CON-003 requires every order's
ledger to balance to exactly zero, and floats make that impossible to guarantee.

## Payments

Business logic must never import a payment provider SDK. Everything goes through
the `PaymentProvider` interface in `apps/api/src/modules/payments/`. Provider
SDKs may only be imported inside `payments/providers/`.

No provider is implemented — Q-001 is still `OPEN`. `NullPaymentProvider`
throws on every operation deliberately, so money paths cannot silently appear
to work.

Non-negotiables when payments are built (see `AGENTS.md`):

- Order state and Payment state stay separate (CON-001).
- Only a signature-verified provider webhook may confirm a payment (CON-002).
- Webhook handling is idempotent on a single payment reference (REQ-003).
- Ledger entries are append-only; correct by reversing entry, never by mutation.

## Database

PostgreSQL is the **system of record** for orders, payments, refunds, ledger
entries, and settlements (DEC-014). Supabase Realtime, client state, and any
cache are projections — never the source of truth for money.

New migration:

```bash
supabase migration new add_orders_table
supabase db reset      # re-apply everything from scratch
```

## Testing

```bash
pnpm test
pnpm --filter @banhao/api test -- --watch
```

The API has unit tests for both guards and an integration test for `/health`.
Anything touching money will need tests for the idempotency and
ledger-balancing properties specifically — those are the constraints most
expensive to get wrong.

## Before committing

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

CI runs the same four, plus a Docker build and a check that no secret-bearing
file is tracked.

Branch from `main` as `feature/<description>`; commit with Conventional Commits
(`feat:`, `fix:`, `docs:`, `chore:`). See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## For AI agents

Read [`ai/DEVELOPMENT_RULES.md`](../ai/DEVELOPMENT_RULES.md) before writing code,
and [`ai/HANDOFF.md`](../ai/HANDOFF.md) for current state.
