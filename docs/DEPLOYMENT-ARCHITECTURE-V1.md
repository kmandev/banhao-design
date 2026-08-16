# BANHAO — Deployment Architecture V1

Written 2026-08-12, after the Phase A local Docker validation gate passed.
Records the deployment decisions locked in that session — **not** a new
`DEC-APP` series entry. Where [`BANHAO-APP-ARCHITECTURE-V1.md`](BANHAO-APP-ARCHITECTURE-V1.md)
(V1.1) already decided something (DEC-APP-003/008/009/010), this file cites it
rather than restating it. Where V1.1 left an implementation detail open — WIF
vs. service-account keys, the Worker's location, admin's rendering mode — this
file is where that choice now lives. **If anything here appears to conflict
with a `DEC-APP` decision, V1.1 wins**, per its own precedence rule.

This document describes the *target* architecture. Nothing in it is deployed —
see [`CURRENT_STATUS.md`](CURRENT_STATUS.md) for what's actually live.

---

## 1. Decision summary

| Component | Target | Status |
|---|---|---|
| `apps/api` | Google Cloud Run, `asia-southeast3` | Not deployed |
| `apps/admin` | Cloudflare Pages, static export | Not deployed |
| `apps/tick-worker` (new) | Cloudflare Worker (cron) | Not created |
| `apps/customer`, `apps/driver` | Expo/EAS → App Store, Google Play | Separate track, not part of this document |
| `apps/merchant` | Cloudflare Pages, **after** DEC-APP-003 conversion to Next.js | Deferred — still an Expo shell today |
| GCP auth | Workload Identity Federation | Not configured |
| Secrets | Google Secret Manager (API), Cloudflare Worker secrets (tick) | None provisioned |
| Production database | A **separate** Supabase project — never `banhao-dev` | Does not exist yet |

## 2. Cloud Run topology

Governed by **DEC-APP-009** (V1.1 §12). Confirmed here, not re-decided:

- Region `asia-southeast3` (Bangkok) — retained as written. `COST VERIFICATION REQUIRED` per V1.1 still applies; region/pricing availability must be checked when GCP setup actually begins, not assumed now (V1.1 explicitly did not re-confirm it).
- `min-instances=0`, `max-instances=5`, request-based billing.
- Container port is controlled by `PORT` — already honoured by `packages/config/src/env.ts`; Cloud Run's injected value requires no code change.
- **Public network accessibility is required.** `/webhooks/payments/:provider` (DEC-APP-005) must be reachable by an external payment provider, and `/internal/tick` (DEC-APP-010) must be reachable by the Cloudflare Worker — neither can present a Google IAM identity. Application-level guards remain the sole authorization boundary:
  - `SupabaseAuthGuard` — default-deny, `@Public()` opt-out
  - `TickHmacGuard` — HMAC-SHA256, A-6, verified surviving containerization in A-7
  - Provider signature verification — `PaymentProvider.verifyWebhookSignature`, A-5

## 3. GCP authentication model

- GitHub Actions authenticates to GCP via **Workload Identity Federation**. No service-account JSON key is generated or stored anywhere, in Git or in GitHub Secrets.
- Runtime secrets (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `INTERNAL_TICK_SECRET`) live in **Google Secret Manager** and are injected into the Cloud Run service at deploy time — never passed as Docker `ARG`/`ENV` during the image build. The existing `apps/api/Dockerfile` takes no build-time secrets today (confirmed in A-7); this must not change.
- Cloud Run image is stored in **Artifact Registry**. Recommended cleanup policy: retain the most recent 5 images (or last 30 days), whichever is smaller. Not created in this task — recorded here so the number isn't invented later under time pressure. Image size is 345MB (measured, A-7); AR's free tier (0.5 GB) is exhausted in roughly two pushes without this policy.

## 4. Supabase environment boundary

**Locked:** `banhao-dev` remains development/staging only. Production deployment must target a **separate, dedicated production Supabase project** — it is never acceptable to point a "production" Cloud Run service at `banhao-dev`.

- The 16 locked migrations (`e471ec1d` checkpoint, `supabase/migrations/`) are unchanged by this decision and must be applied to the production project when it is created, by the same process that applied them to `banhao-dev` (see `docs/DATABASE_MIGRATION_V1_REPORT.md`).
- Creating the production Supabase project is an **external prerequisite** — it does not exist today and is not created by this document.

## 5. Cloudflare Pages topology

| App | Target | Rationale |
|---|---|---|
| `apps/admin` | **Cloudflare Pages** — the only deployable Pages target today | Next.js 15 App Router, static export (§6) |
| `apps/merchant` | **Not yet deployable.** Still an Expo shell (`App.tsx`, `expo` dependency, no Next.js). DEC-APP-003 requires converting it to Next.js first; Pages deployment is a later task, not part of this one | DEC-APP-003 |
| `apps/customer` | **Not a Pages target, ever.** React Native/Expo, ships via EAS to the App Store and Google Play — a separate release track entirely, out of scope for this document | V1.1 §12 cost table: *"Customer + driver apps · Expo, OTA updates"* |
| `apps/driver` | **Not a Pages target, ever.** Same as customer — native, EAS, app stores | DEC-APP-003: *"Keep `apps/driver` on Expo"* |

## 6. Admin rendering mode

**Locked: Next.js static export (`output: 'export'`) for V1.** Applied in `apps/admin/next.config.mjs`.

Verified before applying: `apps/admin/src/app/` contains exactly `layout.tsx` and `page.tsx`, both static — no `route.ts` handler, no `middleware.ts`, no `cookies()`/`headers()`/`revalidate`/`generateStaticParams` call, no `next/image`. `next build` with `output: 'export'` was run and confirmed to produce a static `out/` directory (`index.html`, `404.html`, `_next/`) with no server runtime required. No blocker found.

If a future admin screen genuinely needs SSR, a route handler, or middleware, reverting this line is an architecture decision (a new `DEC-APP` entry or an update to this document), not a silent change made in passing.

## 7. Tick Worker topology

Governed by **DEC-APP-010** (V1.1 §12) and **A-6**'s already-deployed `TickHmacGuard`. The Worker adapts to the guard; the guard is never modified to accommodate the Worker.

- **Location:** `apps/tick-worker/`, inside this monorepo — kept alongside `TickHmacGuard` so the two cannot silently drift apart.
- **Schedule:** `* * * * *` (every minute).
- **Target:** `POST <cloud-run-url>/internal/tick`.
- **Request:** `Content-Type: application/json`, a non-empty JSON body (e.g. `{}`). `TickHmacGuard` rejects an empty `rawBody` and Nest only populates `rawBody` for content types its parsers handle — both already verified in A-6/A-7.
- **Signature:** header `X-Tick-Signature`, value = lowercase hex `HMAC-SHA256(INTERNAL_TICK_SECRET, exact raw request body bytes)`, exactly 64 characters. No JSON re-serialization before signing.
- **Secret:** `INTERNAL_TICK_SECRET` stored as a Cloudflare Worker secret (`wrangler secret put`), identical to the value configured in Google Secret Manager for Cloud Run. Never committed.

## 8. GitHub Actions — deployment workflow separation

- `.github/workflows/ci.yml` is unchanged and remains the sole validation gate (lint, typecheck, test, build, RLS, Docker build-only, secrets scan).
- Deployment workflows are separate files, not additions to `ci.yml`:
  - `deploy-api.yml` — Cloud Run
  - `deploy-web.yml` — Cloudflare Pages (admin; merchant added later)
  - `deploy-worker.yml` — Cloudflare Worker
- **No deployment runs from a pull request.** Production deployment triggers only from `main`.
- Each deploy workflow must not proceed unless CI has succeeded for the same commit — via `workflow_run` gating or an equivalent `needs:` dependency, not merely a path filter.
- Prefer **GitHub Environments** (`production`) for required-reviewer approval and to scope secrets/variables away from the repository default.
- Prefer WIF for GCP auth (§3); a Cloudflare API token, scoped to Pages + Workers edit only, for Cloudflare.
- Deployment workflows must not duplicate the entire CI suite — they consume its result, they don't re-run lint/typecheck/test from scratch, unless a step is technically unavoidable to repeat (e.g., the production image build itself).

## 9. API deployment mechanics

- Artifact Registry → Cloud Run, via `google-github-actions/deploy-cloudrun` or an equivalent official action.
- Image built for **`linux/amd64`** explicitly — Cloud Run does not run `arm64` images, and the local A-7 build (Apple Silicon host) produced `arm64`; the deploy workflow must target the correct platform.
- `apps/api/Dockerfile` is not modified for this — it already builds correctly (A-7) and takes no build-time secrets. It changes only if a concrete deployment defect is found, not preemptively.
- Runtime secrets are injected by Cloud Run from Secret Manager at container start, never baked into the image and never passed as a build argument.

## 10. Production Swagger

**Locked: `/docs` must not be publicly exposed in production.** `apps/api/src/main.ts` currently mounts `SwaggerModule` unconditionally. This is a real, narrowly-scoped code change — deliberately **not made in this document**, per the instruction to report rather than implement it here. It belongs in its own task (gate `SwaggerModule.setup` behind `env.nodeEnv !== 'production'`, or an explicit `ENABLE_SWAGGER` flag).

## 11. Domain

No custom domain is required for initial deployment. `*.run.app` (Cloud Run) and `*.pages.dev` (Cloudflare Pages) are acceptable. Custom DNS is a later task; none is named anywhere in this repository today.

## 12. Region verification

`asia-southeast3` is retained as DEC-APP-009 states — not changed here. Whether it currently offers the full Cloud Run + Artifact Registry path must be verified at the time external GCP setup actually begins, not assumed in advance.

## 13. Explicitly deferred / out of scope

- **Sentry** — a separate future task. No dependency, DSN, workflow, or runtime integration added here.
- **Payment provider** — Q-001 remains OPEN. `NullPaymentProvider` unchanged. No credentials provisioned.
- **Phase E/F/G/H** — untouched.
- **Merchant Pages deployment** — blocked on the DEC-APP-003 Next.js conversion, which has not happened.
- **Customer/driver store releases** — a separate EAS/App Store/Google Play track, not covered by this document.
- **Swagger production gating** — identified (§10), not implemented here.

## 14. Prerequisites for actual deployment

None of the following exist yet; none is claimed to exist:

- GCP project with billing enabled.
- Confirmation `asia-southeast3` supports Cloud Run + Artifact Registry (§12).
- WIF pool/provider, deployer service account, runtime service account, IAM bindings.
- Cloudflare account, API token (Pages + Workers edit scope), account ID.
- A **separate production Supabase project**, with the 16 locked migrations applied (§4).
- GitHub repository configuration: `production` Environment, its secrets and variables.

---

## 15. Implementation record (repo-side workflows)

The three workflow files below exist in the repository. **None has been executed against real infrastructure** — every run will fail until the prerequisites in §14 are provisioned. This section is the reference for provisioning them.

### 15.1 Workflow files and their gate

| File | Deploys | Path filter |
|---|---|---|
| `.github/workflows/deploy-api.yml` | `apps/api` → Cloud Run | `apps/api/**`, `packages/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| `.github/workflows/deploy-web.yml` | `apps/admin` → Cloudflare Pages | `apps/admin/**`, `packages/**`, `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| `.github/workflows/deploy-worker.yml` | `apps/tick-worker` → Cloudflare Workers | `apps/tick-worker/**` only — the Worker has no workspace dependency |

All three trigger on `workflow_run: workflows: ['CI']` rather than a raw `push`. This was a deliberate choice over duplicating CI's job list, made after inspecting `ci.yml`'s actual name (`CI`) and jobs (`verify`, `rls`, `docker`, `secrets-scan`):

- The job-level `if` requires `conclusion == 'success'`, `head_branch == 'main'`, and `event == 'push'` together — a PR's CI run always has `head_branch` equal to the PR's source branch, never `main`, so no PR can ever satisfy this regardless of its outcome.
- Every checkout step uses `ref: ${{ github.event.workflow_run.head_sha }}`, not `main`'s current tip — so a deploy always builds the exact commit CI tested, even if a newer commit lands on `main` before the deploy job starts. This is what closes the "stale successful run deploys a newer, untested commit" hazard named in the task brief.
- `ci.yml`'s own `concurrency: cancel-in-progress: true` on `${{ github.workflow }}-${{ github.ref }}` means an in-flight CI run for an older commit on `main` is normally cancelled — not completed successfully — the moment a newer commit is pushed. This makes the hazard above unlikely to occur at all in this repo's specific CI configuration, on top of the head_sha pinning that closes it completely.
- Each deploy workflow has its own `concurrency: group: deploy-<x>-main, cancel-in-progress: false` — overlapping deploy triggers queue rather than race or cancel a partial deploy.

Path filtering is implemented with `dorny/paths-filter@v3`, diffing against `head_sha^` (the tested commit's parent). This assumes linear history on `main` (true of this repo to date); a worst-case false positive triggers one redundant, harmless redeploy of an unchanged image — not a correctness or security issue, so no more elaborate mechanism was built for it.

### 15.2 Required GitHub configuration

Create a `production` **GitHub Environment** and populate it with:

**Variables** (`vars.*`, non-secret):

| Name | Used by | Purpose |
|---|---|---|
| `GCP_PROJECT_ID` | deploy-api | GCP project |
| `GCP_REGION` | deploy-api | `asia-southeast3` |
| `AR_REPOSITORY` | deploy-api | Artifact Registry repository name |
| `CLOUD_RUN_SERVICE` | deploy-api | Cloud Run service name |
| `GCP_WIF_PROVIDER` | deploy-api | Workload Identity Federation provider resource name |
| `GCP_DEPLOY_SA_EMAIL` | deploy-api | Deployer service account email (impersonated via WIF) |
| `SUPABASE_URL` | deploy-api | Production Supabase project URL — **not** `banhao-dev`'s |
| `SUPABASE_ANON_KEY` | deploy-api | Production anon key — public by design (RLS-protected) |
| `CORS_ORIGINS` | deploy-api | Real production web origin(s), comma-separated |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-web, deploy-worker | Cloudflare account |
| `CLOUDFLARE_PAGES_PROJECT` | deploy-web | The Pages project name for `apps/admin` |

**Secrets** (`secrets.*`):

| Name | Used by | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy-web, deploy-worker | Scoped to *Pages: Edit* + *Workers Scripts: Edit* only |

Notably **absent** from GitHub Secrets: any GCP credential. WIF issues a short-lived OIDC token at run time; no `GOOGLE_CREDENTIALS` JSON, no service-account key, ever.

### 15.3 Required GCP resources (not created by this task)

- Project with billing enabled, in a region supporting Cloud Run + Artifact Registry (verify against §12 before assuming `asia-southeast3`).
- Artifact Registry Docker repository — **with a cleanup policy retaining the 5 most recent images** (§3; the image is 345 MB, measured in A-7, and the AR free tier is 0.5 GB).
- WIF pool + provider trusting this GitHub repository.
- Deployer service account: `roles/run.developer`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`.
- Runtime service account (the Cloud Run service identity): `roles/secretmanager.secretAccessor` only.
- Secret Manager secrets, **created but not referenced from any YAML value** — `deploy-api.yml` references them by name only:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_JWT_SECRET`
  - `INTERNAL_TICK_SECRET` — **must hold the identical value** provisioned into the Worker (§15.4).

### 15.4 Required Cloudflare resources (not created by this task)

- Cloudflare account; API token scoped to Pages + Workers edit.
- A Pages project for `apps/admin` (name → `CLOUDFLARE_PAGES_PROJECT`).
- The Worker itself is created by its first `wrangler deploy` (via `deploy-worker.yml` or manually) — no separate manual creation step.

### 15.5 Worker provisioning commands

Run once, locally or from an authenticated shell — never from a workflow YAML:

```bash
cd apps/tick-worker
pnpm exec wrangler login
pnpm exec wrangler secret put INTERNAL_TICK_SECRET
# paste the same value stored in Google Secret Manager as INTERNAL_TICK_SECRET
```

After the first Cloud Run deploy produces a real URL, update `apps/tick-worker/wrangler.toml`'s `API_URL` (a one-line edit — this is deliberately not auto-discovered; the task did not ask for cross-workflow orchestration, and none was built) and let `deploy-worker.yml` redeploy, or run `pnpm exec wrangler deploy` locally.

### 15.6 Deployment order (operational sequence)

1. Provision GCP (§15.3) and Cloudflare (§15.4) resources; populate the `production` Environment (§15.2).
2. Push to `main` → CI runs → `deploy-api.yml` fires → Cloud Run URL exists. Its own smoke test (`GET /health`, asserting `success:true` and `data.status:ok`) runs automatically as the workflow's last step.
3. Set `apps/tick-worker/wrangler.toml`'s `API_URL` to that Cloud Run URL.
4. Run `wrangler secret put INTERNAL_TICK_SECRET` (§15.5), matching Secret Manager's value exactly.
5. Push the `API_URL` change (or deploy manually) → `deploy-worker.yml` fires.
6. Manually verify one signed tick succeeds end-to-end — e.g. `curl` with a hand-computed HMAC against the real URL, the same shape verified locally against Docker in A-7 §6.4/§7 — before trusting the cron schedule.
7. `deploy-web.yml` fires independently on the same `main` push (no ordering dependency on the API).

### 15.7 Smoke tests

- **API:** `deploy-api.yml`'s final step — `GET /health`, requires HTTP 200, `success:true`, `data.status:ok`. Fails the workflow (`exit 1`) if either assertion fails. No payment path is exercised (Q-001 OPEN, no provider credentials exist).
- **Worker / tick:** not automated in `deploy-worker.yml` — a signed tick cannot be constructed without the real `INTERNAL_TICK_SECRET`, which is never in CI. Verify manually per §15.6 step 6.
- **Web:** not automated beyond `test -f apps/admin/out/index.html` before deploy; Cloudflare Pages' own deploy step fails the workflow if the upload itself fails.

### 15.8 Rollback (manual — nothing here is automated)

- **Cloud Run:** `gcloud run services update-traffic <CLOUD_RUN_SERVICE> --region=<GCP_REGION> --to-revisions=<previous-revision>=100`. Revisions are retained by Cloud Run automatically; no rebuild needed.
- **Cloudflare Pages:** every deploy is a retained, named deployment — roll back from the Pages dashboard's deployment history with one click, or `wrangler pages deployment list` / re-promote a prior deployment.
- **Tick Worker:** redeploy the previous commit — `git checkout <previous-sha> -- apps/tick-worker && pnpm exec wrangler deploy` (from `apps/tick-worker`), or re-run `deploy-worker.yml` against an older commit manually.

---

*Supersedes nothing. Extends V1.1 §12/§15/§19 with the implementation-level choices those sections left open. Any future change to a `DEC-APP` decision cited here takes precedence over this document.*
