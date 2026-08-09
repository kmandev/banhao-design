# Technology Decision Matrix

Consolidated view across every technology category. **Every "Recommendation" is a recommendation for Product Owner evaluation — none is a decision.** Q-001, Q-006, and Q-007 remain `OPEN`. Details and citations live in the per-category documents linked from each row.

Confidence: **HIGH** = strong evidence, clear differentiation · **MEDIUM** = evidence supports it but genuine trade-offs remain · **LOW** = weak evidence or largely judgment.

---

## Backend — [`BACKEND_COMPARISON.md`](BACKEND_COMPARISON.md)

| | |
|---|---|
| **Requirements** | Own Order + Payment state machines (REQ-002), webhook handling with signature verification (CON-002), background jobs (timeouts, dispatch, settlement), real-time capability, AI-assisted-coding friendliness |
| **Options** | NestJS/TS · Laravel · Go · Node+TS · Python |
| **Pros/Cons** | NestJS: best AI-coding leverage + enforced structure, weaker local hiring. Laravel: deepest Thai hiring pool (127 Laravel/318 PHP listings), best queue tooling (Horizon), **but no LTS since 2019**. Go: best real-time efficiency, runs at Grab, weakest hiring cost + queue maturity |
| **Risks** | Wrong choice is expensive to reverse once code exists; a framework the team can't maintain is worse than a "better" one they can't staff |
| **Cost** | Comparable; Go marginally cheaper to host |
| **Operational complexity** | Laravel lowest; Go/Node moderate |
| **Lock-in** | Low for all (open source) |
| **Recommendation** | **No single recommendation — a genuine three-way trade.** Decide on team capability (Q-016), not on the ratings |
| **Confidence** | **LOW** on any single winner; HIGH on the shortlist being these three |
| **Evidence** | Stack Overflow 2025, GitHub Octoverse 2025, JobsDB Thailand, official release/EOL pages |

## Database — [`DATABASE_COMPARISON.md`](DATABASE_COMPARISON.md)

| | |
|---|---|
| **Requirements** | ACID for ledger (CON-003), Order/Payment separation (CON-001), geospatial driver matching, flexible JSON for phase-generic entities (REQ-004) |
| **Options** | PostgreSQL · MySQL/MariaDB · MongoDB |
| **Pros/Cons** | PostgreSQL: only option best-in-class on all three weighted criteria (SSI, PostGIS indexed KNN, GIN-indexed jsonb); weakness is connection scaling. MySQL: simplest ops, aligns with PHP hiring pool, but hand-rolled two-stage geo queries + pre-declared JSON indexes. MongoDB: best schema flexibility and managed HA, **but transactions work against the grain of a ledger** |
| **Risks** | PostgreSQL requires **PgBouncer from day one** — plan it, don't retrofit |
| **Cost** | Comparable; Atlas ~4× DO for similar specs |
| **Operational complexity** | MySQL lowest; PostgreSQL moderate (pooling); MongoDB lowest if Atlas |
| **Lock-in** | Low for all |
| **Recommendation** | **PostgreSQL** |
| **Confidence** | **HIGH** — the evidence points clearly here, unlike backend |
| **Evidence** | PostgreSQL/PostGIS/MongoDB official docs; Stack Overflow 2025 |

## Payment — [`PAYMENT_RESEARCH.md`](PAYMENT_RESEARCH.md)

| | |
|---|---|
| **Requirements** | PromptPay QR, webhook confirmation with signature verification (CON-002), refunds, **multi-recipient payouts to merchants + drivers**, individual-driver onboarding |
| **Options** | Xendit · Omise/Opn · Beam · 2C2P · ~~Stripe~~ |
| **Pros/Cons** | Xendit: only documented THB marketplace split + **individuals onboardable as sub-accounts**; but weak webhook auth (static token) and **unpublished platform fees**. Omise: best webhook security, but **KYB has no natural-person category** — blocks drivers. Beam: best docs + cheapest PromptPay, **no marketplace layer**. 2C2P: payout-by-instruction, **PromptPay never named in docs, no public pricing** |
| **Risks** | 🚨 **No provider supports native PromptPay refunds** (Q-020). Xendit's ฿10 min + ฿7 fee ≈ 11.3% of a ฿150 order. Provider choice is downstream of the legal structure (Q-002) |
| **Cost** | Omise 1.65%+VAT · Xendit 2.50% min ฿10 + ฿7 · Beam "from Free" · 2C2P TBD |
| **Operational complexity** | Beam lowest; 2C2P highest (JWE/JWS) |
| **Lock-in** | **Highest of any category** — touches money movement and merchant onboarding |
| **Recommendation** | **Xendit is the only structural fit** — but do not commit before resolving Q-002 (legal structure), Q-020 (refunds), and Xendit's unpublished platform fees |
| **Confidence** | **MEDIUM** — clear on structural fit, unresolved on economics and legality |
| **Evidence** | Provider docs and pricing pages, checked 2026-08-09 |

## Authentication — [`AUTHENTICATION.md`](AUTHENTICATION.md)

| | |
|---|---|
| **Requirements** | Customer/Driver mobile signup, Merchant business accounts, Admin privileged access |
| **Options** | Phone+OTP · Email+password · Social (LINE Login) · Passkeys |
| **Pros/Cons** | Phone+OTP matches the existing designed flow and Thai norms, costs per-message. Passkeys strongest security, unfamiliar to consumers. LINE Login plausible given Thai LINE dominance |
| **Risks** | SIM-swap on OTP; **OTP delivery cost/deliverability** (see Q-019 — foreign SMS gets an alert symbol prepended) |
| **Cost** | ~฿0.15 per OTP via Thai gateway |
| **Operational complexity** | Low |
| **Lock-in** | Low |
| **Recommendation** | **Phone+OTP** for Customer/Driver (already designed); **strongest available** for Admin (passkeys or mandatory 2FA); Merchant undetermined |
| **Confidence** | **LOW** for Merchant/Admin (no design evidence); MEDIUM for Customer/Driver |
| **Evidence** | Existing design screens `03`/`04`; PROP-005 |

## Real-time — [`REALTIME.md`](REALTIME.md)

| | |
|---|---|
| **Requirements** | Live order status across 4 surfaces (REQ-002), Merchant glanceable queue, Admin live map, driver location (TR-009) |
| **Options** | WebSocket · SSE · Polling · Push · Redis Pub/Sub · Managed services |
| **Pros/Cons** | Requirements genuinely differ per surface — no single mechanism fits all |
| **Risks** | Shipping polling first and never upgrading; WebSocket across instances needs shared pub/sub |
| **Cost** | Low; Redis is shared with queue/cache |
| **Operational complexity** | Moderate |
| **Lock-in** | Low (unless a managed real-time service is chosen) |
| **Recommendation** | **Layered** — WebSocket/SSE in-app + FCM push for closed-app + polling as fallback and initial implementation (PROP-003) |
| **Confidence** | **MEDIUM** |
| **Evidence** | Design requirements; `ai/RESEARCH/SCALE_MODEL.md` |

## Queue — [`QUEUE_ARCHITECTURE.md`](QUEUE_ARCHITECTURE.md)

| | |
|---|---|
| **Requirements** | Webhook processing (idempotent, REQ-003), order/restaurant timeouts, driver dispatch, notifications, settlement, reports |
| **Options** | DB-backed · Redis-backed · RabbitMQ · Managed cloud queue |
| **Pros/Cons** | DB-backed enqueues **in the same transaction as the data write** — eliminates a class of dual-write bugs on money operations. Broker solves throughput/routing problems BANHAO doesn't have yet |
| **Risks** | Throughput ceiling at Stage 3+ (contained, revisitable) |
| **Cost** | $0 additional if DB-backed |
| **Operational complexity** | Lowest for DB-backed |
| **Lock-in** | Low |
| **Recommendation** | **Database-backed or Redis-backed** (PROP-004); defer a dedicated broker |
| **Confidence** | **MEDIUM** |
| **Evidence** | Framework queue ecosystems; Go's River as transactional-enqueue example |

## Maps — [`MAPS_LOCATION.md`](MAPS_LOCATION.md)

| | |
|---|---|
| **Requirements** | Display, geocoding/reverse, routing, distance matrix, driver tracking, geofencing |
| **Options** | Google · Mapbox · Longdo · self-hosted OSM · ~~HERE~~ |
| **Pros/Cons** | Mapbox most generous free tier (100k directions/matrix). Longdo huge free tier (800k) but **5,000 req/day cap**. Google free caps are **per-SKU**; mobile SDK unlimited free. Self-hosted OSM viable — **Thailand extract is only 310 MB** |
| **Risks** | ⚠️ **HERE Base Plan excludes asset tracking** — the core use case. 🚨 **Rural Buntharik accuracy is unverifiable by desk research** (Q-018). Maps cost scales with location-update frequency |
| **Cost** | $0 at Stage 1–2; $100–1,000+ and volatile at Stage 3 |
| **Operational complexity** | Low (hosted) / High (self-hosted) |
| **Lock-in** | Moderate (hosted); low (OSM) |
| **Recommendation** | **Field-test coverage in Buntharik before choosing** (Q-018). Shortlist: Mapbox or Longdo; evaluate self-hosted OSRM for routing at Stage 3. **Exclude HERE** |
| **Confidence** | **LOW** — the deciding factor (local data quality) is unmeasured |
| **Evidence** | Provider pricing pages; Nominatim query confirming Buntharik admin boundary |

## Notifications — [`NOTIFICATIONS.md`](NOTIFICATIONS.md)

| | |
|---|---|
| **Requirements** | Order status push, OTP SMS, LINE messaging, email |
| **Options** | FCM · LINE Messaging API · ThaiBulkSMS/Twilio · SES/SendGrid |
| **Pros/Cons** | FCM free with no volume charge. **LINE reply messages are free; push/broadcast are not** — a major architectural lever. Thai SMS gateway ~5–7× cheaper than Twilio |
| **Risks** | ⚠️ **NBTC prepends an alert symbol to overseas-originated SMS** (since 21 Oct 2025) — harms OTP trust. Sender ID registration has ~2-week lead time (Q-019). LINE returns an **error and does not send** when quota is exceeded |
| **Cost** | FCM $0 · SMS ~฿0.15/OTP · LINE ฿0→฿1,780/mo · SES $0.10/1,000 |
| **Operational complexity** | Low |
| **Lock-in** | Low |
| **Recommendation** | **FCM** + **Thai domestic SMS gateway** + **LINE designed around reply messages** + **SES** |
| **Confidence** | **HIGH** |
| **Evidence** | Provider pricing pages; NBTC regulatory reporting |

## Storage — [`STORAGE.md`](STORAGE.md)

| | |
|---|---|
| **Requirements** | Shop/product images, receipts, verification documents, avatars (TR-015) — read-dominant |
| **Options** | Cloudflare R2 · AWS S3 · GCS · DO Spaces |
| **Pros/Cons** | R2 has **$0 egress at any volume** vs ~$120/TB on S3/GCS. S3-compatible API keeps lock-in low. DO Spaces bundles 1 TiB egress into $5 flat |
| **Risks** | Low. Cloudflare Bangkok PoP exists but one empirical check routed to Singapore |
| **Cost** | R2 $0.015/GB-mo + $0 egress; free under 10 GB |
| **Operational complexity** | Low |
| **Lock-in** | Low (S3-compatible) |
| **Recommendation** | **Cloudflare R2** — egress is the line item that scales with success |
| **Confidence** | **HIGH** |
| **Evidence** | Provider pricing pages |

## Infrastructure — [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md)

| | |
|---|---|
| **Requirements** | Serve Thai users with low latency; small initial budget; minimal ops burden |
| **Options** | VPS (DO/Vultr/Akamai) · PaaS (Railway/Render/Fly) · AWS/GCP Bangkok · Serverless · Thai-local |
| **Pros/Cons** | ⭐ **AWS and GCP now have Bangkok regions, both cheaper than Singapore** — latency, residency, and cost align rather than trade off. VPS cheapest and most portable. Thai-local providers have **no public pricing** |
| **Risks** | ⚠️ **EKS costs ~$73/mo before a single pod** (GKE gives one cluster free). ⚠️ **Render free tier spins down after 15 min** — disqualifying for order-taking. Serverless cold starts hurt real-time UX |
| **Cost** | $0–30/mo at Stage 1 |
| **Operational complexity** | VPS highest; Cloud Run/PaaS lowest |
| **Lock-in** | VPS lowest; serverless highest |
| **Recommendation** | **Cloud Run Bangkok** (residency + Tier 1 pricing + no ops) **or a $5–10 VPS** for maximum simplicity/portability. **Avoid EKS, Render free tier, Thai enterprise clouds** |
| **Confidence** | **MEDIUM** — depends on budget/ops preference (Q-009) |
| **Evidence** | AWS/GCP region announcements; machine-readable AWS pricing JSON; provider pricing pages |

## Observability — [`OBSERVABILITY.md`](OBSERVABILITY.md)

| | |
|---|---|
| **Requirements** | Error tracking, metrics, tracing; **audit trail is separate** (CON-003) |
| **Options** | Sentry · Grafana Cloud · Prometheus · OpenTelemetry · ~~Datadog~~ |
| **Pros/Cons** | Grafana Cloud free tier unusually generous. OTel is a standard, not a product — costs nothing, prevents lock-in |
| **Risks** | ⚠️ Prometheus's own docs: unsuitable where "100% accuracy, such as for per-request billing" is needed — **must never be the source of truth for financial data** |
| **Cost** | **$0–26/mo** |
| **Operational complexity** | Low (hosted) |
| **Lock-in** | Low if instrumented with OTel |
| **Recommendation** | **OpenTelemetry + Sentry + Grafana Cloud Free.** Audit trail in the database. **Exclude Datadog** ($46/host/mo = 2–9× the compute bill) |
| **Confidence** | **HIGH** |
| **Evidence** | Provider pricing pages; Prometheus official docs |

## Repository strategy — [`REPOSITORY_STRATEGY.md`](REPOSITORY_STRATEGY.md)

| | |
|---|---|
| **Requirements** | Four client surfaces + backend sharing Order/Payment state definitions (CON-001, REQ-002); preserve the AI Memory System's single-source-of-truth model |
| **Options** | Single repo (current) · Formalized monorepo · Multiple repos |
| **Pros/Cons** | Monorepo makes "all four apps agree on the state machine" a compile-time guarantee. Multiple repos fragment the AI Memory System |
| **Risks** | CI slowness (solvable tooling problem). If Driver is Flutter/Dart, shared types cross a language boundary and need codegen |
| **Cost** | $0 |
| **Operational complexity** | Low-moderate |
| **Lock-in** | None |
| **Recommendation** | **Monorepo built on this repository** (PROP-002) |
| **Confidence** | **MEDIUM** |
| **Evidence** | `docs/AI_CONTEXT.md` single-source-of-truth principle; CON-001 |

---

## Where confidence is highest and lowest

| Confidence | Categories |
|---|---|
| **HIGH** | Database (PostgreSQL) · Storage (R2) · Observability (OTel+Sentry+Grafana) · Notifications |
| **MEDIUM** | Payment (structural fit clear, economics/legality unresolved) · Infrastructure · Real-time · Queue · Repository strategy |
| **LOW** | **Backend** (genuine three-way trade — needs Q-016) · **Maps** (needs field testing — Q-018) · Authentication for Merchant/Admin |

**The two lowest-confidence categories are also two of the three that block implementation.** Backend needs a team-capability answer only the Product Owner has; maps needs field data nobody has gathered. Neither gap is closable by more desk research.
