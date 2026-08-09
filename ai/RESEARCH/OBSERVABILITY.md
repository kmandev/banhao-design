# Observability Analysis

All pricing checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select tooling.**

## What BANHAO needs observability for

- **Error tracking** — knowing when order placement, payment webhook processing, or dispatch fails, before a customer reports it.
- **Metrics** — latency, error rate, saturation across the API and background jobs.
- **Tracing** — following a single order through its lifecycle across modules (relevant given the modular-monolith direction in `ai/RESEARCH/ARCHITECTURE_PATTERN.md`, and even more so if modules are ever split out).
- **Audit log** — a distinct concern, already required by CON-003 and `AGENTS.md`. **This is not an observability-tool responsibility** — see the warning below.

## Options compared

### Sentry (error tracking)

| Tier | Price | Includes |
|---|---|---|
| Developer | **$0/mo** | 5k errors, 5M spans, 50 replays, 1 cron monitor, 1 GB attachments — ⚠️ **single user only** |
| Team | **$26/mo** (annual) | 50k errors, 5M spans, **unlimited users and projects** |
| Business | **$80/mo** (annual) | Adds unlimited custom dashboards, anomaly detection, SAML + SCIM |

Pay-as-you-go beyond allocations: logs/metrics +$0.50/GB, UI profiling +$0.25/hr, continuous profiling +$0.0315/hr, extra cron monitors $0.78 each, uptime alerts $1.00 each.

The single-user restriction on the free tier is the practical constraint — the moment a second developer joins BANHAO, it becomes $26/mo.

### Grafana Cloud (metrics / logs / traces / profiles)

| Tier | Price | Includes |
|---|---|---|
| Free | **$0/mo** | **10k active metric series, 50 GB logs/mo, 50 GB traces/mo, 50 GB profiles/mo**, 14-day retention, **3 active users** |
| Pro | **$19/mo** platform fee + usage | Metrics $6.50 per 1k series (13-month retention); logs from $0.050/GB process, $0.400/GB write, $0.100/GB retain; traces/profiles at same per-GB rates (30-day retention) |
| Enterprise | **$25,000/year minimum commitment** | — |

The most generous free tier of anything surveyed here, and it covers metrics, logs, traces, and profiles in one product — which matters because it means BANHAO doesn't need three separate vendors at Stage 1.

### Self-hosted Prometheus

Software cost is **zero** (Apache 2 licence; CNCF's second hosted project, joined 2016). The real cost is the infrastructure it runs on plus your time — roughly a $5–10/mo VPS on the numbers in `ai/RESEARCH/INFRASTRUCTURE.md`, but with no managed retention, no HA, and you own upgrades and disk management.

⚠️ **A caveat that matters directly for BANHAO.** Prometheus's own documentation states: *"If you need 100% accuracy, such as for per-request billing, Prometheus is not a good choice, as the collected data will likely not be detailed and complete enough."*

This is a hard boundary given CON-003 (every order's ledger must balance to exactly zero). Prometheus is appropriate for latency/error-rate/saturation dashboards. It must **never** be the source of truth for order counts, commission calculations, merchant payouts, or driver earnings — those come from the database. The same caution applies to any metrics system: observability data is sampled and lossy by design; financial data is not.

### OpenTelemetry

**Not a product and not a hosted service — it is an open standard, and it has no price.** OpenTelemetry's own docs state it "is not an observability backend itself"; storage and visualization are left to other tools.

Its value here is strategic rather than functional: instrumenting with OTel once means BANHAO can change observability backends later without re-instrumenting the application. Given that every vendor decision in this research is still open, **this is the single most effective anti-lock-in move available in observability** — and it costs nothing.

### Datadog — the numbers confirm it is out of range

| Item | Price |
|---|---|
| Infrastructure Pro | **$15/host/month** (annual), $18 on-demand |
| APM | **$31/host/month** (annual, bundled with Infrastructure), $36 standalone |
| Log Management | Ingest from $0.10/GB; standard indexing $1.70 per million events/month (15-day retention, annual) |
| Free tier | Up to 5 hosts, **1-day metric retention only** |

**The arithmetic, stated explicitly:** Infrastructure + APM on annual pricing is $15 + $31 = **$46/host/month**. Three hosts is **$138/month before a single log line is ingested**. Those same three hosts cost $15–60/month total on Vultr or DigitalOcean (`ai/RESEARCH/INFRASTRUCTURE.md`).

**Datadog would cost 2–9× the entire compute bill it is monitoring.** For comparison, Sentry Team ($26/mo) plus Grafana Cloud Free ($0) covers error tracking, metrics, logs, and traces for **$26/month total**.

This confirms the hypothesis that prompted checking it: Datadog is not a reasonable choice for BANHAO at this stage. Revisit only if the platform reaches a scale with a dedicated ops budget. *(Datadog RUM-specific rates were **not found** on the pricing page as fetched.)*

## Audit logging is a separate concern

Worth stating clearly because it is easy to conflate: the audit trail required by CON-003 and `AGENTS.md` (who changed a Payment or Order state, when; who force-unassigned a driver; who approved a merchant) is **application data, not telemetry**. It belongs in the database with the same durability and integrity guarantees as the ledger — not in a log-aggregation tool with 14-day retention and sampling. Observability tooling can *also* ingest these events for convenience, but must not be their system of record.

## Trade-off summary

The evidence points to a clear low-cost starting combination, offered as a recommendation:

| Layer | Option | Cost at launch |
|---|---|---|
| Instrumentation | **OpenTelemetry** — from day one, keeps every backend below swappable | $0 |
| Errors | **Sentry** Developer → Team when a second developer joins | $0 → $26/mo |
| Metrics / logs / traces | **Grafana Cloud Free** (10k series, 50 GB logs, 3 users) | $0 |
| Audit trail | **The application database** — not an observability tool | — |
| Avoid at this stage | **Datadog** ($46/host/mo, 2–9× the compute bill) | — |

Total observability cost at launch: **$0–26/month**. This is a recommendation for Product Owner evaluation, not a decision.
