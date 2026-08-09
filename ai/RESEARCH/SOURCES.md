# Sources

Every external source used across `ai/RESEARCH/`. **All checked 2026-08-09.** Prices and capabilities change — re-verify before relying on any figure for a real decision.

Items marked ⚠️ could **not** be verified and are recorded so they don't leak into planning as facts.

---

## Payment providers

## Source
**Provider:** Opn Payments / Omise
**URL:** https://docs.omise.co/promptpay · https://docs.omise.co/api-webhooks · https://docs.omise.co/refunds-api · https://docs.omise.co/recipients-api · https://docs.omise.co/transfers-api · https://www.omise.co/en/pricing/thailand · https://docs.omise.co/en/what-documents-are-required-for-each-type-of-Legal-Entity/thailand · https://www.opn.ooo/th-en/products/payfac/
**Checked:** 2026-08-09
**Purpose:** PromptPay support, refund capability, webhook security, marketplace/payout capability, KYB requirements, fees
**Key Finding:** PromptPay ฿20–150,000; **"PromptPay charges cannot be voided or refunded through Omise"**; best-in-class webhook auth (HMAC-SHA256, timestamped, rotation-aware); 12 KYB entity types with **no natural-person category**; PromptPay 1.65% **+ 7% VAT added**. Note: `docs.opn.ooo` does not resolve — use `docs.omise.co`.

## Source
**Provider:** Xendit Thailand (acquired GB Prime Pay)
**URL:** https://docs.xendit.co/docs/qr-promptpay · https://docs.xendit.co/docs/split-payments · https://docs.xendit.co/xenplatform/accounts · https://docs.xendit.co/docs/transfer-balances · https://docs.xendit.co/docs/payouts-for-sub-accounts · https://docs.xendit.co/docs/payout-coverage-thailand · https://docs.xendit.co/docs/thailand-business-documents · https://docs.xendit.co/docs/handling-webhooks · https://docs.xendit.co/docs/xenplatform-fees · https://www.xendit.co/en-th/pricing/
**Checked:** 2026-08-09
**Purpose:** Marketplace split capability, sub-account onboarding, payout rails, webhook security, fees
**Key Finding:** Only provider with documented **THB marketplace splits + sub-accounts + payouts on behalf**; *"Individual applications are only allowed if they are XP sub-accounts"* (drivers onboardable); PromptPay 2.50% min ฿10 + ฿7; ⚠️ **webhook auth is a static token, not per-payload HMAC**; ⚠️ **xenPlatform sub-account activity and in-house transfer fees are not published**.

## Source
**Provider:** Beam Checkout
**URL:** https://docs.beamcheckout.com/charges/charges.md · https://docs.beamcheckout.com/refunds/refunds.md · https://docs.beamcheckout.com/webhook-authentication.md · https://docs.beamcheckout.com/playground.md · https://www.beamcheckout.com/pricing
**Checked:** 2026-08-09
**Purpose:** PromptPay support, refunds, webhook verification, marketplace capability, fees
**Key Finding:** Best documentation of the group (published webhook **test vector**); QR PromptPay "Starts from Free", T+1 settlement; refunds only for CARD/ALIPAY/WECHAT — **not PromptPay**; ⚠️ no marketplace/split capability found; ⚠️ KYC answer for individuals is JS-collapsed and unretrieved.

## Source
**Provider:** 2C2P
**URL:** https://developer.2c2p.com/docs/direct-api-method-qr-payment · https://developer.2c2p.com/docs/api-payment-response-backend · https://developer.2c2p.com/docs/payment-maintenance-refund-guide · https://developer.2c2p.com/docs/create-payout · https://developer.2c2p.com/docs/beneficiary-registration
**Checked:** 2026-08-09
**Purpose:** PromptPay support, payouts, refunds, webhooks
**Key Finding:** ⚠️ **"PromptPay" appears zero times in the developer docs** — only THQR/Thai QR is documented; payout-by-instruction with beneficiary registration including IdCard/DOB (individuals modelled); partial refunds on settled transactions; ⚠️ **no pricing published** (both /pricing URLs 404).

## Source
**Provider:** Stripe
**URL:** https://docs.stripe.com/payments/promptpay · https://support.stripe.com/questions/stripe-thailand-support-for-marketplaces · https://support.stripe.com/questions/are-there-any-businesses-that-stripe-cant-support-on-connect-in-thailand · https://stripe.com/en-th/pricing
**Checked:** 2026-08-09
**Purpose:** Whether Thailand + PromptPay + marketplace is viable
**Key Finding:** **Disqualified on two independent grounds** — TH Connect states *"We do not support separate charges and transfer"*, and **Food** and **Transportation Services** are both on the TH Connect restricted-industry list.

## Source
**Provider:** ChillPay / SCB API Market / KBank / Rabbit LINE Pay
**URL:** https://www.chillpay.co/en/pricing/ · https://developer.scb · https://apiportal.kasikornbank.com/open-api/register · https://docs.omise.co/rabbit-linepay
**Checked:** 2026-08-09
**Purpose:** Secondary provider survey
**Key Finding:** ChillPay "Chill Pro" 3.25%, docs are downloadable PDFs; SCB and KBank are **collection-only** bank acquiring APIs, no marketplace payout; Rabbit LINE Pay is a wallet best consumed through a PSP. ⚠️ **Paysolutions not verified** — official developer docs could not be located.

---

## Backend frameworks

## Source
**Provider:** Stack Overflow Developer Survey 2025
**URL:** https://survey.stackoverflow.co/2025/technology/
**Checked:** 2026-08-09
**Purpose:** Adoption/usage signal across languages, frameworks, databases
**Key Finding:** Node.js 48.7%, Express 19.9%, JavaScript 66%, TypeScript 43.6%, Python 57.9%, FastAPI 14.8%, Flask 14.4%, Django 12.6%, Go 16.4%, PHP 18.9%, Laravel 8.9%, NestJS 6.7%; PostgreSQL 55.6% (58.2% professional), MySQL 40.5%, MariaDB 22.5%, MongoDB 24%.

## Source
**Provider:** GitHub Octoverse 2025
**URL:** https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
**Checked:** 2026-08-09
**Purpose:** Language trend signal, AI-assisted-coding relevance
**Key Finding:** TypeScript became **#1 language on GitHub in August 2025** (~2.64M monthly contributors, +66% YoY), attributed to AI-assisted coding since types make generated code verifiable.

## Source
**Provider:** Framework release/EOL pages
**URL:** https://expressjs.com/2024/10/15/v5-release.html · https://trilon.io/blog/announcing-nestjs-11-whats-new · https://laravel-news.com/laravel-12-release-date · https://endoflife.date/laravel · https://laravel.com/docs/13.x/reverb · https://go.dev/blog/go1.25 · https://go.dev/blog/go1.26 · https://www.djangoproject.com/weblog/2025/apr/02/django-52-released/ · https://openjsf.org/blog/fastifys-growth-and-success
**Checked:** 2026-08-09
**Purpose:** Version currency, support windows, real-time capability
**Key Finding:** Express 5 (15 Oct 2024); NestJS 11 (20 Jan 2025); Laravel 13 (17 Mar 2026) with **no LTS since Laravel 6** (18-month bugfix / 2-year security); Laravel **Reverb** is first-party WebSockets, Redis-scalable; Go 1.26 (10 Feb 2026) Green Tea GC default, **10–40% GC overhead reduction**; Django 5.2 **LTS to ~April 2028**.

## Source
**Provider:** Go case studies / Grab engineering
**URL:** https://go.dev/solutions/case-studies · https://engineering.grab.com/
**Checked:** 2026-08-09
**Purpose:** Production users at comparable scale
**Key Finding:** Uber PGO eliminated ~24,000 CPU cores; **Grab** (SEA food-delivery/ride-hailing super-app — the closest comparable to BANHAO) runs Go+Java microservices. ⚠️ The detailed Grab stack breakdown came via a secondary source.

## Source
**Provider:** JobsDB Thailand
**URL:** https://th.jobsdb.com/python-jobs · /php-jobs · /laravel-jobs · /golang-jobs · /nodejs-jobs · /backend-developer-jobs
**Checked:** 2026-08-09
**Purpose:** Thai hiring-market signal
**Key Finding:** Python 961, PHP 318, Go 255, Backend Developer 222, Laravel 127, Node.js 137. ⚠️ **Indicative only, not measurements** — Python is heavily inflated by data/ML roles; Node is understated because roles post as "Backend Developer".

## Source
**Provider:** npm registry API / GitHub API
**URL:** https://api.npmjs.org/downloads/point/last-month/express · /fastify · /@nestjs/core · https://api.github.com/search/repositories
**Checked:** 2026-08-09
**Purpose:** Ecosystem size, machine-readable
**Key Finding:** express 514,866,070 and fastify 43,286,677 monthly downloads; @nestjs/core 53,820,199. Stars: golang/go 135,700; fastapi 101,424; gin 89,069; django 88,401; laravel/laravel 84,783; nestjs 76,373; express 69,366.

⚠️ **Unverified — do not cite:** NestJS enterprise adopters (Adidas, Roche, Decathlon) trace only to vendor/SEO blogs. FastAPI "50% of Fortune 500" and "38% of Python devs" — JetBrains survey page 404'd. FastAPI-vs-Django-Channels WebSocket benchmark — single marketing blog, not reproducible.

---

## Databases

## Source
**Provider:** PostgreSQL / PostGIS official
**URL:** https://www.postgresql.org/docs/current/mvcc-intro.html · https://www.postgresql.org/docs/release/18.0/ · https://postgis.net/docs/geometry_distance_knn.html · https://postgis.net/2025/05/PostGIS-3.5.3/
**Checked:** 2026-08-09
**Purpose:** ACID guarantees, geospatial capability for driver-matching
**Key Finding:** MVCC where "reading never blocks writing"; **Serializable Snapshot Isolation**; PostgreSQL 18 (25 Sep 2025) adds async I/O (io_uring, up to 3× read gains) and native **`uuidv7()`**; PostGIS `<->` is **index-assisted KNN**, "dramatically faster than computing all distances and sorting".

## Source
**Provider:** MySQL / MariaDB official
**URL:** https://dev.mysql.com/doc/refman/8.4/en/spatial-convenience-functions.html · https://endoflife.date/mysql · https://mariadb.org/11-8-lts-released/ · https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-rds-for-mysql-8-4-lts-release
**Checked:** 2026-08-09
**Purpose:** Geospatial and support-lifecycle comparison
**Key Finding:** `ST_Distance_Sphere` limited to points/multipoints and **must be combined with `MBRContains` + spatial index** — no single-operator indexed KNN; MySQL 8.4 LTS supported to **April 2032** (longest runway); MariaDB 11.8 LTS to June 2028.

## Source
**Provider:** Bytebase (Postgres vs MySQL JSON) / PlanetScale (connection scaling)
**URL:** https://www.bytebase.com/blog/postgres-vs-mysql-json-support/ · https://planetscale.com/blog/scaling-postgres-connections-with-pgbouncer
**Checked:** 2026-08-09
**Purpose:** JSON indexing and connection-model comparison
**Key Finding:** Postgres `jsonb` supports **GIN indexes on arbitrary paths**; MySQL cannot index JSON directly (requires generated columns on predeclared paths). Postgres forks a process per connection (~5 MB), default max_connections 100 — **PgBouncer required from day one**; PgBouncer ~15k qps single-threaded.

## Source
**Provider:** MongoDB official
**URL:** https://www.mongodb.com/docs/manual/core/transactions/ · https://www.mongodb.com/resources/basics/databases/acid-transactions · https://www.mongodb.com/docs/manual/geospatial-queries/ · https://www.mongodb.com/pricing · https://www.mongodb.com/docs/atlas/architecture/current/high-availability/ · https://www.mongodb.com/docs/atlas/backup-restore-cluster/
**Checked:** 2026-08-09
**Purpose:** Transaction suitability for a financial ledger
**Key Finding:** Transactions "incur a greater performance cost over single document writes"; snapshot isolation via **optimistic concurrency → app must retry write conflicts**; Atlas M0 free, M10 $0.08/hr, M30 $0.54/hr; Atlas HA is **RPO=0, RTO seconds, 99.995% SLA**, backups immutable by default. ⚠️ "1,000 doc modifications per transaction" is **obsolete** (removed in 4.2) — do not cite; exact current limits unverified.

## Source
**Provider:** Managed database pricing
**URL:** https://supabase.com/pricing · https://neon.com/pricing · https://www.digitalocean.com/pricing/managed-databases · https://aws.amazon.com/rds/pricing/
**Checked:** 2026-08-09
**Purpose:** Managed hosting cost
**Key Finding:** Supabase Free/$25 Pro/$599 Team; Neon Free/$0.106 per CU-hour; DigitalOcean $15.15/mo (1 GiB) → $122.10/mo (8 GiB). ⚠️ **AWS RDS Singapore pricing could not be verified** — page is JS-rendered, ap-southeast-1 JSON endpoints 404'd. Only `db.t4g.micro $0.016/hr (US West Oregon)` is reliable. Clean AWS figures: cross-AZ transfer $0.01/GB; free tier changed 15 Jul 2025.

---

## Infrastructure, storage, observability

## Source
**Provider:** AWS / Google Cloud region announcements
**URL:** https://aws.amazon.com/blogs/aws/announcing-the-new-aws-asia-pacific-thailand-region/ · https://www.googlecloudpresscorner.com/2026-01-21-Google-Cloud-Launches-New-Cloud-Region-in-Thailand...
**Checked:** 2026-08-09
**Purpose:** Latency and data-residency options for Thai users
**Key Finding:** **AWS `ap-southeast-7` (Bangkok, 3 AZs) GA 8 Jan 2025; GCP `asia-southeast3` (Bangkok, 3 AZs) launched 21 Jan 2026.** Both are **cheaper than Singapore** — reversing the usual local-region-premium assumption.

## Source
**Provider:** AWS pricing JSON (machine-readable, region-scoped)
**URL:** https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ap-southeast-7/index.json · .../ap-southeast-1/index.json · .../AWSLambda/... · .../AmazonS3/... · .../AWSDataTransfer/...
**Checked:** 2026-08-09
**Purpose:** Authoritative Fargate/Lambda/S3/egress pricing per region
**Key Finding:** Fargate Thailand $0.045504/vCPU-hr vs Singapore $0.05056 (~10% cheaper); Lambda Thailand $0.18/1M requests vs Singapore $0.20; S3 Thailand $0.0225/GB-mo vs Singapore $0.025; egress Thailand $0.108/GB vs Singapore $0.12; 100 GB/mo egress free globally.

## Source
**Provider:** GCP Cloud Run / GKE
**URL:** https://cloud.google.com/run/pricing · https://cloud.google.com/kubernetes-engine/pricing · https://docs.cloud.google.com/run/docs/configuring/min-instances
**Checked:** 2026-08-09
**Purpose:** Serverless cost and cold-start mitigation
**Key Finding:** **Bangkok is Tier 1 ($0.000018/vCPU-s), Singapore is Tier 2 ($0.0000216)** — Bangkok ~17% cheaper *and* lower latency; free tier 240k vCPU-s/mo; GKE **$74.40/mo credit covers one cluster free** (EKS has no equivalent — $0.10/cluster/hr ≈ $73/mo floor); min-instances bill at reduced rate under request-based billing but are "best-effort".

## Source
**Provider:** VPS / PaaS pricing
**URL:** https://www.digitalocean.com/pricing/droplets · https://api.vultr.com/v2/plans?type=vc2 · https://www.akamai.com/cloud/pricing/asia-pacific · https://railway.com/pricing · https://render.com/pricing · https://render.com/docs/free · https://fly.io/docs/about/pricing/
**Checked:** 2026-08-09
**Purpose:** Entry-level hosting cost, Singapore availability
**Key Finding:** DO $4/mo entry; **Vultr's $2.50 tier is NOT available in Singapore** (verified via public API) — effective entry $5; Akamai $5 entry but pricier above; Railway RAM $10/GB/mo + CPU $20/vCPU/mo; **Render free services spin down after 15 min idle (~1 min restart)** — disqualifying for order-taking; Render bandwidth only 5–25 GB then $0.15/GB. ⚠️ Fly.io Singapore compute prices **not found** (page defaulted to Amsterdam); APAC egress $0.04/GB.

## Source
**Provider:** Object storage + CDN
**URL:** https://developers.cloudflare.com/r2/pricing/ · https://cloud.google.com/storage/pricing · https://www.digitalocean.com/pricing/spaces-object-storage · https://aws.amazon.com/cloudfront/pricing/ · https://www.cloudflare.com/network/
**Checked:** 2026-08-09
**Purpose:** Image storage/egress cost for an image-heavy marketplace
**Key Finding:** **R2 storage $0.015/GB-mo with $0 egress at any volume** vs ~$0.12/GB egress on S3/GCS — at 1 TB/mo that is $0 vs ~$120; R2 free tier 10 GB + unlimited egress; DO Spaces $5/mo flat includes 1 TiB transfer; CloudFront now flat-rate with **no overage** (Free $0, Pro $15/mo); **Cloudflare has a Bangkok PoP** — ⚠️ though an empirical check from a Thai connection resolved to SIN, not BKK (single sample).

## Source
**Provider:** Observability pricing
**URL:** https://sentry.io/pricing/ · https://grafana.com/pricing/ · https://prometheus.io/docs/introduction/overview/ · https://opentelemetry.io/docs/what-is-opentelemetry/ · https://www.datadoghq.com/pricing/
**Checked:** 2026-08-09
**Purpose:** Error tracking, metrics, tracing cost at small scale
**Key Finding:** Sentry free is **single-user**, Team $26/mo; **Grafana Cloud Free is unusually generous** (10k series, 50 GB logs, 3 users); OpenTelemetry is a **standard, not a product** — no price, best anti-lock-in move; Datadog Infra+APM = **$46/host/mo** → 3 hosts = $138/mo, **2–9× the compute bill it monitors**. ⚠️ Prometheus's own docs: unsuitable "if you need 100% accuracy, such as for per-request billing" — **must not be the source of truth for financial data**.

---

## Maps and location

## Source
**Provider:** Google Maps Platform
**URL:** https://mapsplatform.google.com/pricing/ · https://developers.google.com/maps/billing-and-pricing/pricing · https://developer.android.com/develop/sensors-and-location/location/geofencing
**Checked:** 2026-08-09
**Purpose:** Maps/geocoding/routing cost
**Key Finding:** **$200/mo credit replaced by per-SKU free caps from 1 Mar 2025** — 10,000 free per Essentials SKU per month (caps are per-SKU, so multiple APIs each get their own); **Mobile Maps SDK is unlimited free**; geofencing is not a billed Maps SKU (comes free from Play services, 100 geofences/device).

## Source
**Provider:** Mapbox
**URL:** https://www.mapbox.com/pricing
**Checked:** 2026-08-09
**Purpose:** Maps/geocoding/routing cost
**Key Finding:** Far more generous free tiers than Google at BANHAO's volume — **100,000/mo free** for Directions, Matrix, and temporary Geocoding; 50,000 free web map loads. ⚠️ **Permanent geocoding (storing results — what BANHAO would do for saved addresses) has no free tier**, $5.00/1,000.

## Source
**Provider:** HERE Technologies
**URL:** https://www.here.com/get-started/pricing · https://www.here.com/get-started/pricing/base-plan-restrictions
**Checked:** 2026-08-09
**Purpose:** Maps/routing cost and licence terms
**Key Finding:** ⚠️ **Base Plan excludes "Asset Management" — "locating, tracking and/or displaying on a map"** — i.e. exactly BANHAO's live driver tracking. Likely forces an Enterprise contract. Pricing page disclaims figures are "indicative estimates only".

## Source
**Provider:** OpenStreetMap ecosystem
**URL:** https://download.geofabrik.de/asia/thailand.html · https://github.com/Project-OSRM/osrm-backend · https://github.com/graphhopper/graphhopper · https://operations.osmfoundation.org/policies/tiles/ · https://www.maptiler.com/cloud/pricing/ · https://nominatim.openstreetmap.org/search?q=บุณฑริก+อุบลราชธานี
**Checked:** 2026-08-09
**Purpose:** Self-hosted routing viability and Buntharik coverage
**Key Finding:** **Thailand extract is only 310 MB** (2026-08-06) — self-hosting genuinely viable; OSRM (BSD-2) provides Route/Table/Match; ⚠️ **OSMF tile policy prohibits heavy/commercial use** — must self-host tiles or buy managed (MapTiler Flex $30/mo); **Nominatim confirms อำเภอบุณฑริก exists as an admin boundary relation (postcode 34230)** — but this does not imply house-number coverage. ⚠️ OSRM RAM requirements not officially documented.

## Source
**Provider:** Longdo Map (Thai provider)
**URL:** https://map.longdo.com/products/pricing · https://map-blog.longdo.com/pricing-calculator/ · https://map.longdo.com/products/api
**Checked:** 2026-08-09
**Purpose:** Thai-local maps alternative
**Key Finding:** Confirmed active in 2026; **free tier is enormous — 800,000 map + 100,000 service transactions/month at ฿0**, but rate-limited to **5,000 req/day** (the real ceiling); paid jumps steeply to ฿8,250/mo; route matrix costs m × n transactions. ⚠️ Geofencing/live tracking **not found** as named products.

⚠️ **Unverifiable across all map providers:** rural Thailand coverage/accuracy for อำเภอบุณฑริก. No provider publishes district-level data; no independent measurement found. **Requires field spot-checking** — see Q-018.

---

## Notifications

## Source
**Provider:** Firebase Cloud Messaging
**URL:** https://firebase.google.com/pricing · https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas
**Checked:** 2026-08-09
**Purpose:** Push notification cost and limits
**Key Finding:** **"No-cost" on both Spark and Blaze plans, no volume charge**; 600,000 messages/min project quota; per-device 240/min, 5,000/hour.

## Source
**Provider:** LINE for Business Thailand / LINE Developers
**URL:** https://developers.line.biz/en/docs/messaging-api/pricing/ · https://lineforbusiness.com/th/news/20240619_1 · https://notify-bot.line.me/closing-announce
**Checked:** 2026-08-09
**Purpose:** LINE messaging cost in Thailand
**Key Finding:** **Reply messages don't count against quota; push/multicast/broadcast do** — a major architectural lever. Thailand (from 1 Aug 2024): Free ฿0 with **300 broadcasts/mo**; Pro **฿1,780/mo** for 35,000; overage **฿0.06/message**. Exceeding quota without paid capacity **returns an error and the message is not sent**. ⚠️ **LINE Notify shut down 31 Mar 2025**. ⚠️ A ฿1,280 Basic tier is third-party-reported only.

## Source
**Provider:** Twilio / ThaiBulkSMS / NBTC regulatory
**URL:** https://www.twilio.com/en-us/sms/pricing/th · https://www.thaibulksms.com/pricing-f/ · https://www.thaibulksms.com/credit-calculation/ · https://www.thaibulksms.com/subscription/otp-ready-to-use/ · https://mobileecosystemforum.com/2025/10/30/thailands-nbtc-moves-to-curb-overseas-a2p-sms/ · https://www.nationthailand.com/news/general/40056926
**Checked:** 2026-08-09
**Purpose:** OTP delivery cost and deliverability in Thailand
**Key Finding:** Twilio **$0.0305/message** vs ThaiBulkSMS **฿0.15/credit** (~5–7× cheaper); Thai ≤70 chars = 1 credit; ⚠️ **from 21 Oct 2025 NBTC requires operators to prepend an alert symbol to SMS originating overseas** — actively harmful for OTP trust; Sender ID registration + KYC required, ~2 weeks *(third-party, unverified)*. ⚠️ ThaiBulkSMS package tables/VAT/expiry not found (JS-rendered).

## Source
**Provider:** AWS SES / Twilio SendGrid
**URL:** https://aws.amazon.com/ses/pricing/ · https://www.twilio.com/en-us/products/email-api/pricing
**Checked:** 2026-08-09
**Purpose:** Transactional email cost
**Key Finding:** SES **$0.10 per 1,000** vs SendGrid Essentials from **$19.95/mo** — ~100× cheaper at low volume; SendGrid free is now **100 emails/day for 60 days only**; SES's old 62,000-free-from-EC2 allowance is no longer listed.

---

## Thailand compliance

## Source
**Provider:** ETDA — Royal Decree on Digital Platform Services
**URL:** https://www.etda.or.th/getattachment/Regulator/DigitalPlatform/law/Clean-Royal-Decree-on-DP-Corrected-1.pdf.aspx · https://www.nishimura.com/en/knowledge/publications/thailands-royal-decree-on-the-supervision-of-digital-platform-services · https://iapp.org/news/a/navigating-thailands-digital-platform-services-law
**Checked:** 2026-08-09
**Purpose:** Platform-specific regulatory obligations
**Key Finding:** **Royal Decree B.E. 2565, effective 21 Aug 2023 — requires ETDA notification.** Full-form above THB 50M revenue or 5,000 MAU; **short-form "otherwise"** (may apply even at Stage 1). ETDA announced stepped-up enforcement in 2025 including criminal penalties. **Directly matches BANHAO's model** — see Q-015.

## Source
**Provider:** Bank of Thailand — Payment Systems Act
**URL:** https://www.bot.or.th/en/our-roles/payment-systems/payment-act-oversight.html · https://www.bot.or.th/content/dam/bot/documents/en/laws-and-rules/laws-and-regulations/legal-department/4-payment-act/4.1%20LAW04_PaymentSystemAct.pdf
**Checked:** 2026-08-09
**Purpose:** Payment licensing categories
**Key Finding:** Five Designated Payment Service categories including **e-money** and **payment facilitation** ("accepting electronic payment for and on behalf of others"). ⚠️ **The boundary between "using a licensed PSP" and BANHAO itself performing payment facilitation is not resolvable from public sources** — BANHAO's split/transfer-round/cash-liability design may implicate it. Requires counsel.

## Source
**Provider:** PDPA / PDPC
**URL:** https://www.mdes.go.th/law/detail/3577-Personal-Data-Protection-Act-B-E--2562--2019- · https://www.tilleke.com/insights/thailand-unveils-regulations-for-cross-border-personal-data-transfer/ · https://securiti.ai/thailand-cross-border-personal-data-transfer-overview/
**Checked:** 2026-08-09
**Purpose:** Data protection obligations and hosting residency
**Key Finding:** PDPA in force since 1 Jun 2022, enforced by PDPC; **does not mandate in-country storage** — cross-border transfer legal via SCCs (s.29); **PDPC has still not published an adequacy list**; data on foreign cloud servers **where no third party has access is not a cross-border transfer**.

## Source
**Provider:** Thai tax / consumer protection / labour
**URL:** https://www.tilleke.com/insights/thailand-enacts-law-imposing-vat-on-foreign-e-services-and-e-platforms/ · https://taxsummaries.pwc.com/thailand/corporate/other-taxes · https://www.tilleke.com/insights/thailands-consumer-protection-board-preparing-regulations-to-address-digital-risks/ · https://www.bangkokpost.com/opinion/opinion/2577024/delivering-justice-to-food-deliverers
**Checked:** 2026-08-09
**Purpose:** VAT, consumer protection, gig-worker classification
**Key Finding:** Foreign e-Service VAT regime (2021) targets **non-resident** providers — likely not BANHAO as a Thai entity; **OCPB "Dee-Delivery" initiative targets cash-on-delivery** — directly relevant to Phase 1; riders currently treated as contractors, outside Labor Protection Act, with active policy debate but **no confirmed reclassification**.

⚠️ **Jurisdiction error caught during research:** a search result appearing to be a "Thailand gig delivery worker ruling" was actually a **Hong Kong** Deliveroo case. Not applicable; recorded as a reminder to jurisdiction-check every citation.
