# BANHAO — Infrastructure Readiness V1

Written 2026-08-16, after the repo-side deployment implementation was committed
(`e07cc02a`) and the external infrastructure readiness audit completed.

This is a **pre-provisioning checklist**. Nothing in it has been executed. It
records what the user must create and configure before the first real
deployment, in the order it must happen.

Architecture decisions live in
[`DEPLOYMENT-ARCHITECTURE-V1.md`](DEPLOYMENT-ARCHITECTURE-V1.md) and are
referenced here rather than restated. Where the two disagree, that document
wins.

---

## 1. Current repository state

| | |
|---|---|
| HEAD | `e07cc02a203f0fd858ebc5fbe76693f41a98c393` |
| Branch | `main`, in sync with `origin/main` |
| Working tree | clean |
| Remote | `https://github.com/kmandev/banhao-design.git` |
| Deploy workflows | present, validated (YAML + actionlint), **never executed** |
| `apps/tick-worker` | present, typechecks, bundles via dry-run, **never deployed** |
| External infrastructure | **none exists** |

## 2. Supabase decision — Option A (staging on `banhao-dev`)

**Decided 2026-08-16 by the Product Owner: Option A.**

The first deployment targets the existing `banhao-dev` project
(`yssnwnboiwldogmlvvlw`, `ap-southeast-1`) and is a **staging deployment**. It
proves the whole pipeline — WIF → Artifact Registry → Cloud Run → the Worker's
HMAC tick → Pages — without introducing a new database at the same time.

**What this does and does not change:**

- No new Supabase project. No migrations re-applied. The 16 locked migrations
  and the `e471ec1d` checkpoint are untouched.
- [`DEPLOYMENT-ARCHITECTURE-V1.md`](DEPLOYMENT-ARCHITECTURE-V1.md) §4 remains
  in force: **a service labelled "production" must never point at
  `banhao-dev`.** Option A is compatible with that rule *only because this
  deployment is named and treated as staging.*
- Option B (a dedicated production Supabase project) is deferred, not
  cancelled. It becomes materially safer once this pipeline is proven.

**⚠️ Naming consequence — DECIDED as A1.** All three deploy workflows declare
`environment: production` (a GitHub Environment name, used for approval gating
and secret scoping). Under Option A staging, this is clarified as follows:

- **A1 (CHOSEN):** The GitHub Environment is named `production` as an internal
  CI/CD construct only — it is the conventional name for deployment secrets and
  vars. The *actual Cloud Run service* is explicitly named `banhao-api-staging`
  and its `*.run.app` URL is self-describing. This naming is honest
  end-to-end: the GitHub Environment holds staging secrets, the Cloud Run
  service is a staging service, no confusion possible. Zero workflow changes.
  Setting: `CLOUD_RUN_SERVICE=banhao-api-staging`.

**⚠️ Operational hazard, unrelated to the choice above.** The Supabase CLI on
this machine is currently linked to `banhao-dev`
(`supabase/.temp/linked-project.json`). Any `supabase db push` / `supabase link`
would reach the dev project. Per `CLAUDE.md`, neither command may be run without
an explicit instruction. **Option A requires no Supabase CLI command at all.**

## 3. GCP prerequisites

None of these exist. All are user actions.

| # | Item | Notes |
|---|---|---|
| 1 | GCP project | New or existing. Its ID becomes `GCP_PROJECT_ID` |
| 2 | Billing enabled | Required by Cloud Run even inside the free tier |
| 3 | APIs enabled | Cloud Run Admin, Artifact Registry, Secret Manager, IAM Credentials (for WIF token exchange), Cloud Resource Manager |
| 4 | Artifact Registry repository | Docker format, in `GCP_REGION`. Name becomes `AR_REPOSITORY` |
| 5 | **AR cleanup policy** | Retain 5 most recent images. **Not optional — see §8** |
| 6 | WIF pool | — |
| 7 | WIF provider | Resource name becomes `GCP_WIF_PROVIDER` |
| 8 | **WIF trust restriction** | Must be scoped to this repository (`kmandev/banhao-design`), ideally to `ref:refs/heads/main`. An unscoped provider would let any repo impersonate the deployer SA |
| 9 | Deployer service account | Email becomes `GCP_DEPLOY_SA_EMAIL`. Impersonated via WIF |
| 10 | Runtime service account | The Cloud Run service identity |
| 11 | IAM bindings | Deployer: `roles/run.developer`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser`. Runtime: `roles/secretmanager.secretAccessor` **only** |
| 12 | Secret Manager secrets | Three, by exact name — see §6 |

Region `asia-southeast3` (Bangkok) is **verified available** for both Cloud Run
and Artifact Registry against official Google Cloud documentation (audit,
2026-08-16). Numeric pricing was **not** re-verified — see §8.

Cloud Run itself is **not** pre-created; the first `deploy-api.yml` run creates
the service.

## 4. GitHub prerequisites

A GitHub Environment named **`production`** (as the workflows currently
declare — subject to the §2 A1/A2 decision), containing:

### Variables (`vars.*`, non-secret)

| Name | Value source | Configured in |
|---|---|---|
| `GCP_PROJECT_ID` | GCP project (§3.1) | GitHub Environment |
| `GCP_REGION` | `asia-southeast3` | GitHub Environment |
| `AR_REPOSITORY` | AR repo name (§3.4) | GitHub Environment |
 `CLOUD_RUN_SERVICE` | `banhao-api-staging` (A1 decision — first deploy is staging) | GitHub Environment |
| `GCP_WIF_PROVIDER` | WIF provider resource name (§3.7) | GitHub Environment |
| `GCP_DEPLOY_SA_EMAIL` | Deployer SA email (§3.9) | GitHub Environment |
| `SUPABASE_URL` | **`banhao-dev` project URL** (Option A) | GitHub Environment |
| `SUPABASE_ANON_KEY` | **`banhao-dev` anon key** — public by design, RLS-protected | GitHub Environment |
| `CORS_ORIGINS` | The Pages origin, once known (Stage 6) | GitHub Environment |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account (§5) | GitHub Environment |
| `CLOUDFLARE_PAGES_PROJECT` | Pages project name (§5) | GitHub Environment |

### Secret (`secrets.*`)

| Name | Value source | Configured in |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard, scoped to *Pages: Edit* + *Workers Scripts: Edit* | GitHub Environment secret |

**No GCP credential appears here.** WIF issues a short-lived OIDC token at run
time; there is no `credentials_json` input in any workflow and no
service-account key is ever created.

## 5. Cloudflare prerequisites

| # | Item | Notes |
|---|---|---|
| 1 | Cloudflare account | ID becomes `CLOUDFLARE_ACCOUNT_ID` |
| 2 | API token | Scoped to Pages Edit + Workers Scripts Edit only. Becomes the GitHub secret |
| 3 | Pages project | For `apps/admin`. Name becomes `CLOUDFLARE_PAGES_PROJECT` |
| 4 | Worker | **Not pre-created** — the first `wrangler deploy` creates it |
| 5 | Worker `API_URL` | A one-line edit to `apps/tick-worker/wrangler.toml` after Stage 5 produces a Cloud Run URL. Deliberately not auto-discovered |
| 6 | Worker secret | `wrangler secret put INTERNAL_TICK_SECRET` — manual, out of band, never from a workflow |

## 6. Secret inventory

Three secrets in Google Secret Manager, by exact name (referenced in
`deploy-api.yml` as `NAME:latest`):

| Secret Manager name | Value source (Option A) | Also needed elsewhere |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `banhao-dev` → Settings → API | No |
| `SUPABASE_JWT_SECRET` | `banhao-dev` → Settings → API → JWT Secret | No |
| `INTERNAL_TICK_SECRET` | **Generated by the user** — not from Supabase | **Yes — see below** |

### `INTERNAL_TICK_SECRET` must be identical in two places

```
                    one generated value
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
  GCP Secret Manager                Cloudflare Worker secret
  (Cloud Run injects it)            (wrangler secret put)
            │                               │
            ▼                               ▼
  TickHmacGuard VERIFIES            tick-worker SIGNS
```

Nothing synchronises these two. They are provisioned separately, by hand, and a
mismatch produces a silent, permanent `401` on every tick — the failure mode is
a tick that never succeeds, not a crash. Verify with the Stage 7 signed-tick
check before trusting the cron.

The user generates the value themselves, e.g.:

```bash
openssl rand -hex 32
```

**No secret value appears in this repository, in this document, or in any
workflow file.**

## 7. Dependency graph

```
GCP project + billing
  ↓
APIs enabled
  ↓
┌──────────────────────┬────────────────────────┐
│ Artifact Registry    │ Secret Manager         │   (parallel)
│ + cleanup policy     │ 3 secrets              │
└──────────┬───────────┴───────────┬────────────┘
           ↓                       │
   WIF pool + provider             │
   + deployer SA + runtime SA      │
   + IAM bindings                  │
           └───────────┬───────────┘
                       ↓
        GitHub `production` Environment
        (11 variables + 1 secret)
                       ↓
        push to main → CI → deploy-api.yml
                       ↓
             Cloud Run URL exists
                       ↓
        ┌──────────────┴───────────────┐
        ▼                              ▼
  Worker: set API_URL          deploy-web.yml (Pages)
  + wrangler secret put         — INDEPENDENT, no
        ▼                         dependency on the API
  deploy-worker.yml                     │
        ▼                               │
  manual signed-tick check              │
        └──────────────┬────────────────┘
                       ▼
        CORS_ORIGINS updated → API redeploy
                       ▼
              final manual E2E pass
```

Cloudflare account setup (§5.1–5.3) can proceed in parallel with all GCP work.
Pages deployment has **no** ordering dependency on the API.

## 8. Cost controls

**No configuration here is guaranteed $0.** Items that can incur unexpected
charges, and the control for each:

| Resource | Risk | Control needed |
|---|---|---|
| **Artifact Registry** | **Highest concrete risk.** The image is 345 MB (measured, A-7); the free tier is 0.5 GB — roughly two pushes | **Cleanup policy retaining 5 images (§3.5). Create it with the repository, not later** |
| GCP billing | A billing account is required and can accrue charges | **Set a budget + alert** before the first deploy. Recommended by this document; not an architecture decision |
| Cloud Run | Request/CPU beyond free tier | Already capped: `min-instances=0` (no idle cost), `max-instances=5`. Free-tier thresholds **COST MUST BE VERIFIED** — V1.1's figures were not re-confirmed |
| Secret Manager | Per active secret version | 3 secrets. Low. Delete superseded versions rather than accumulating them |
| Cloudflare Pages | — | Free tier; no known charge at this scale |
| Cloudflare Workers | 1,440 invocations/day vs 100k/day free | Free-tier likely |
| Supabase | Unchanged by Option A — `banhao-dev` already exists on the free tier | None. Option A adds no Supabase cost |
| GitHub Actions | 2,000 min/mo on a private repo | Path filters already skip expensive steps when irrelevant. Monitor if usage grows |

**Deletion policy:** every resource in §3 and §5 is deletable and should be
treated as disposable during staging. Nothing in this stage holds unique data —
the database is `banhao-dev`, which pre-exists and is not created or modified by
any of this.

## 9. Provisioning order (all user actions — none executed)

1. Resolve the §2 naming decision (A1 or A2).
2. GCP project + billing + **budget alert**.
3. Enable the five APIs (§3.3).
4. Artifact Registry repository **+ cleanup policy**, in `asia-southeast3`.
5. WIF pool + provider, **scoped to this repository**.
6. Deployer SA + runtime SA + IAM bindings (§3.11).
7. Generate `INTERNAL_TICK_SECRET`; create all three Secret Manager secrets (§6).
8. Cloudflare: account, API token, Pages project.
9. GitHub `production` Environment: 11 variables + 1 secret (§4).

## 10. Deployment order

1. Push to `main` → CI passes → `deploy-api.yml` fires → image built
   (`linux/amd64`), pushed to AR, Cloud Run service created. Its own smoke test
   (`GET /health` → `success:true`, `data.status:ok`) runs automatically and
   fails the workflow if either assertion fails.
2. `deploy-web.yml` fires on the same push, independently → admin live on Pages.
3. Set `apps/tick-worker/wrangler.toml` → `API_URL` to the real Cloud Run URL.
4. `wrangler secret put INTERNAL_TICK_SECRET` (same value as Secret Manager).
5. Push, or deploy manually → `deploy-worker.yml` → Worker live.
6. **Manually verify one signed tick** returns `200 {"success":true,"data":{"accepted":true}}`
   — the same check performed against Docker in A-7 §6.4, now against the real
   URL. Do this before trusting the minute cron.
7. Update `CORS_ORIGINS` to the real Pages origin; redeploy the API.
8. Final manual pass: health, correlation ID echo, webhook `401`, unsigned tick
   `401`, signed tick `200`.

## 11. Rollback considerations

Per [`DEPLOYMENT-ARCHITECTURE-V1.md`](DEPLOYMENT-ARCHITECTURE-V1.md) §15.8 —
nothing is automated:

- **Cloud Run:** `gcloud run services update-traffic <service> --region=<region> --to-revisions=<previous>=100`. Revisions are retained; no rebuild.
- **Cloudflare Pages:** roll back from the deployment history in the dashboard.
- **Tick Worker:** redeploy the previous commit's `apps/tick-worker`.
- **Whole staging environment:** deletable. Because Option A introduces no new
  database, tearing down every GCP and Cloudflare resource created here loses
  nothing but the deployment itself.

**One gap worth knowing:** `deploy-api.yml`'s smoke test runs *after* the
revision is live and receiving traffic. A failed smoke test fails the workflow
loudly but does **not** automatically shift traffic back — rollback is the
manual command above. No traffic-shifting automation was built, and none is
required by the architecture.

## 12. Explicitly NOT provisioned

Nothing external exists. As of this document:

- ❌ GCP project, billing, APIs, Artifact Registry, cleanup policy
- ❌ WIF pool, WIF provider, repository trust restriction
- ❌ Deployer SA, runtime SA, IAM bindings
- ❌ Secret Manager secrets (all three)
- ❌ Cloudflare account, API token, Pages project, Worker
- ❌ Worker `API_URL` value, Worker secret
- ❌ GitHub `production` Environment, its 11 variables, its 1 secret
- ❌ Cloud Run service (created by first deploy)
- ❌ Any deployment of any component

**Open decisions / follow-ups:**

- Option B (dedicated production Supabase) — deferred, not cancelled
- Swagger production gating — `/docs` is currently mounted unconditionally in
  `apps/api/src/main.ts` ([`DEPLOYMENT-ARCHITECTURE-V1.md`](DEPLOYMENT-ARCHITECTURE-V1.md) §10). Under Option A this exposes
  a staging API's OpenAPI UI; still a separate, narrowly-scoped task
- Sentry — deferred
- Custom domain — not required; `*.run.app` / `*.pages.dev` are acceptable
- Q-001 payment provider — OPEN; blocks payment features only, not this deployment

---

*Companion to [`DEPLOYMENT-ARCHITECTURE-V1.md`](DEPLOYMENT-ARCHITECTURE-V1.md). That document decides; this one prepares. Neither provisions.*
