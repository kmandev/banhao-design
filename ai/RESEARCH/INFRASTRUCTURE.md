# Infrastructure Analysis

All pricing checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a hosting option** — see Q-009 (`OPEN`).

## ⚠️ Premise correction: Thailand now has in-country cloud regions

This research began from the common assumption that Singapore is the nearest major cloud region for Thai users. **That is no longer true**, and it materially changes the analysis:

- **AWS Asia Pacific (Thailand)** — `ap-southeast-7`, 3 availability zones, GA since **8 January 2025**
- **Google Cloud Bangkok** — `asia-southeast3`, 3 availability zones, launched **21 January 2026**

In both cases **the Thai region is cheaper than Singapore, not more expensive** — the opposite of the usual "local region costs a premium" expectation. Cloud Run in Bangkok is Tier 1 pricing while Singapore is Tier 2 (~17% cheaper CPU); AWS Fargate and Lambda in Thailand run ~10% below Singapore; S3 and egress are likewise cheaper.

This means BANHAO can have **lower latency, data residency, and lower cost simultaneously** — these do not trade off against each other here.

The VPS/PaaS tier (DigitalOcean, Vultr, Linode/Akamai, Railway, Render, Fly.io) has **no Thailand presence** — Singapore genuinely is the nearest for all of them.

## Options compared

### VPS providers (Singapore only)

| Provider | Entry (Singapore) | Notes |
|---|---|---|
| **DigitalOcean** | **$4.00/mo** (512 MiB, 1 vCPU, 10 GiB SSD, 500 GiB transfer); $6.00/mo for 1 GiB | SGP1 is a full-feature region (Kubernetes, managed DBs, Spaces, LBs). Inbound bandwidth always free; per-second billing since 1 Jan 2026 |
| **Vultr** | **$5.00/mo** (1 vCPU, 1 GB, 25 GB, 1 TB) | ⚠️ The advertised $2.50/mo tier is **not available in Singapore** — it exists only in US regions. Bandwidth overage $0.01/GB, pooled globally |
| **Linode / Akamai** | **$5.00/mo** (Nanode 1 GB) | Materially more expensive above entry: 2 GB is $12 (vs Vultr $10), 4 GB is $24. Outbound overage $0.005/GiB |

**Operational model for all three:** you manage OS, runtime, deploys, patching, and backups. **Lock-in: low** (plain Linux VMs). Scaling is manual vertical resize plus your own horizontal setup.

### PaaS / managed containers (Singapore only)

| Provider | Pricing | Notes |
|---|---|---|
| **Railway** | Hobby $5/mo, Pro $20/mo per workspace — subscription doubles as usage credit. Usage: RAM $10/GB/mo, CPU $20/vCPU/mo, volume $0.15/GB/mo, egress $0.05/GB | Southeast Asia Metal region (Singapore). Push a repo/Dockerfile; Railway handles build, deploy, TLS, scaling. **Lock-in: moderate** — containers portable, but managed Postgres/Redis and volumes need migration work |
| **Render** | Workspace: Hobby $0, Pro $25/mo, Scale $499/mo — **plus** per-service instance cost: Starter $7/mo (512 MB), Standard $25/mo (2 GB), Pro $85/mo (4 GB) | ⚠️ **Two disqualifying details for BANHAO.** Free web services **spin down after 15 minutes of inactivity** and take ~1 minute to restart — unacceptable for order-taking. And bandwidth allowance is tiny (5 GB Hobby / 25 GB Pro) with **$0.15/GB** overage — 3× Railway's egress. Serve images from a CDN, never through Render |
| **Fly.io** | Pay-as-you-go, no subscription. Amsterdam reference: shared-cpu-1x $2.02/mo, performance-1x $32.19/mo. Volumes $0.15/GB/mo | Region `sin` exists. ⚠️ **Singapore-specific compute prices not found** — the pricing page renders per-region and defaulted to Amsterdam. APAC egress is **$0.04/GB, 2× the NA/EU rate** |

### Managed Kubernetes / containers (Bangkok available)

| Option | Control-plane cost | Compute |
|---|---|---|
| **AWS ECS on EC2** | **No control-plane fee** — you pay only for EC2 | — |
| **AWS Fargate** | No cluster fee | Thailand: **$0.045504/vCPU-hr**, $0.004977/GB-hr. Singapore: $0.05056 / $0.00553 (~10% more) |
| **AWS EKS** | **$0.10/cluster/hour ≈ $73/month before a single pod runs** | Plus node or Fargate cost |
| **GCP GKE** | $0.10/cluster/hour — **but $74.40/month in free credits per billing account covers one zonal/Autopilot cluster** | Standard bills underlying VMs; Autopilot bills per-Pod requests |

**The EKS-vs-GKE difference is real for an early-stage product:** EKS charges ~$73/month as a floor cost; GKE's free credit makes a single-cluster deployment $0 in management fee. GKE SLA is 99.95% for Autopilot/regional Standard, 99.5% for zonal.

### Serverless (Bangkok available, and cheaper)

**AWS Lambda** — Free tier 1M requests + 400,000 GB-seconds/month. Thailand: **$0.000015/GB-second, $0.18 per 1M requests**; Singapore: $0.0000166667/GB-s, $0.20 per 1M (~10% more).

**GCP Cloud Run** — Free tier 240,000 vCPU-seconds + 450,000 GiB-seconds/month (instance-based), or 2M requests/month (request-based). **Bangkok is Tier 1: $0.000018/vCPU-second, $0.000002/GiB-second. Singapore is Tier 2: $0.0000216 / $0.0000024** — Bangkok is ~17% cheaper on CPU *and* lower latency.

**Cold starts — the core risk for a near-real-time order system** (TR-001, `ai/RESEARCH/REALTIME.md`):

- AWS's fix is **provisioned concurrency**, which pre-initializes environments for "double-digit millisecond response times" — but it "runs continually and incurs separate billing," i.e. **you pay even when idle**, converting Lambda's pay-nothing-at-idle advantage into a fixed monthly cost. AWS does not publish a typical cold-start duration figure.
- GCP's equivalent is **minimum instances**. Under request-based billing, idle minimum instances bill at a *reduced* rate (a genuine advantage over Lambda's provisioned concurrency). Note Google describes minimum instances as a "best-effort target," not a guarantee.

### Thailand-local providers

All three exist and are real, but **none publishes public pricing** — every one is a contact-sales/enterprise motion, a poor fit for a pre-implementation platform that needs to self-serve and iterate.

- **True IDC** — largest carrier-neutral DC/cloud provider in Thailand; four Thai facilities, 150+ MW. Offers own cloud plus resold AWS/Azure/GCP/Alibaba/Huawei/Tencent. Pricing not published.
- **AIS Cloud** — built on Oracle Cloud Infrastructure via Oracle Alloy; marketed as Thailand's first locally owned and operated hyperscale cloud. Pricing not published.
- **NT (National Telecom)** — its cloud is **GDCC**, built for government agencies (40,000+ VMs, 800+ agencies), not a commercial IaaS you can sign up for.
- **INET** — a further Thai provider; not investigated in depth.

## PDPA and data residency — the honest read

This matters because `ai/RESEARCH/THAILAND_COMPLIANCE.md` flags cross-border transfer as a PDPA review item, and it's easy to over-correct into assuming Thai hosting is legally required. **It is not.**

- PDPA does **not** mandate in-country storage. Cross-border transfer is legal via adequacy designation (s.28), a derogation (consent, contractual necessity, legal obligation), or appropriate safeguards such as BCRs or **Standard Contractual Clauses** (s.29).
- As of 2026 the PDPC has **still not published an adequacy list** — so SCCs are the practical route.
- Notably: data stored on a cloud server abroad **where no third party has access is not treated as a cross-border transfer**.
- On 29 September 2025 the PDPC issued a formal BCR certification regime applying regardless of destination-country adequacy.

**Practical conclusion:** Bangkok regions give data residency *and* lower price *and* lower latency with no legal analysis required. Singapore remains legally workable under SCCs. Thai enterprise providers buy BANHAO nothing extra at this stage. This is still worth confirming with counsel as part of the Q-012 PDPA review, but it is not a blocker for hosting choice.

## Trade-off summary

| Concern | Best options |
|---|---|
| Lowest cost at launch | DigitalOcean/Vultr VPS ($4–5/mo), or Cloud Run Bangkok free tier |
| Lowest operational burden | Cloud Run or Railway (no servers to patch) |
| Lowest lock-in | Plain VPS (portable Linux), or GKE (standard Kubernetes) |
| Best latency + data residency | **AWS or GCP Bangkok regions** |
| Avoid at this stage | **EKS** (~$73/mo floor), **Render free tier** (15-min spin-down kills order-taking), **Thai enterprise clouds** (no public pricing, enterprise sales motion) |

**Unverifiable, flagged rather than guessed:** Fly.io Singapore compute prices, CloudFront per-GB pay-as-you-go APAC rates, and any pricing from True IDC / AIS Cloud — all three require contacting the vendor.

Hosting choice depends on budget and who will operate the system — Product Owner inputs this research cannot supply. See Q-009.
