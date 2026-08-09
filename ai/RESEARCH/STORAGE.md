# Object Storage Analysis

All pricing checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a storage provider.**

## Use cases (TR-015)

Restaurant/shop images, product/menu images, receipts, merchant/driver verification documents, user avatars. Note this is a **read-dominant, image-heavy** workload: every menu view fetches many images, and browsing generates far more reads than writes.

**That workload shape is the whole analysis.** For BANHAO, egress — not storage — is the bill that grows.

## Options compared

### Cloudflare R2

| Item | Price |
|---|---|
| Standard storage | **$0.015/GB-month** |
| Infrequent Access | $0.01/GB-month (+ $0.01/GB retrieval, 30-day minimum) |
| Class A ops (writes/lists) | $4.50/million |
| Class B ops (reads) | $0.36/million |
| **Egress** | **$0 — free at any volume** |
| Free tier | 10 GB-month storage, 1M Class A, 10M Class B, **unlimited egress** |

Cloudflare's docs state plainly: egressing directly from R2 "does not incur data transfer (egress) charges and is free."

### AWS S3

| Item | Thailand (`ap-southeast-7`) | Singapore (`ap-southeast-1`) |
|---|---|---|
| Standard storage (first 50 TB) | **$0.0225/GB-mo** | $0.025/GB-mo |
| PUT/COPY/POST/LIST | $0.0045 per 1,000 | $0.005 per 1,000 |
| GET and others | $0.0036 per 10,000 | $0.004 per 10,000 |
| **Egress to internet (first 10 TB)** | **$0.108/GB** | **$0.12/GB** |

100 GB/month of internet egress is free globally across AWS.

### Google Cloud Storage

| Item | Bangkok (`asia-southeast3`) | Singapore (`asia-southeast1`) |
|---|---|---|
| Standard regional storage | $0.021/GiB-mo | **$0.020/GiB-mo** |
| Nearline / Coldline / Archive | $0.013 / $0.0055 / $0.0025 | $0.010 / $0.005 / $0.0015 |
| Class A ops | $0.005 per 1,000 | $0.005 per 1,000 |
| Class B ops | $0.0004 per 1,000 | $0.0004 per 1,000 |
| **Egress to Asia destinations** | **$0.12/GiB** (0–10 TiB) | **$0.12/GiB** (0–10 TiB) |

Buckets with hierarchical namespace cost ~10% more. Inbound is free. *(Note GCS is the one case where Bangkok is slightly more expensive than Singapore on storage — the opposite of the compute pattern in `ai/RESEARCH/INFRASTRUCTURE.md`.)*

### DigitalOcean Spaces

$5/month flat includes 250 GiB storage **and 1 TiB outbound transfer**, up to 100 buckets, with a built-in CDN. Overage: $0.02/GiB storage, $0.01/GiB transfer. Worth flagging as the simplest option if BANHAO is already on DigitalOcean Droplets.

## The egress comparison that decides this

At **1 TB/month of image egress** — a plausible figure for an image-heavy marketplace once it has real traffic:

| Provider | Monthly egress cost |
|---|---|
| **Cloudflare R2** | **$0** |
| AWS S3 (Thailand) | ~$108 |
| AWS S3 (Singapore) | ~$120 |
| Google Cloud Storage | ~$120 |
| DigitalOcean Spaces | $0 (within the 1 TiB included in the $5 flat fee) |

Storage cost differences between providers are cents per GB and effectively noise. **Egress is the line item that scales with success**, and R2 removes it entirely.

## CDN considerations for Thailand

- **Cloudflare has a Bangkok, TH point of presence** — in-country edge, and Cloudflare CDN is included free on all plans with unlimited bandwidth.
- ⚠️ **A caveat worth recording:** an empirical check from a Thai connection during this research resolved to Cloudflare colo **SIN (Singapore), not BKK**. That's a single sample and not conclusive, but it's a useful reminder that an in-country PoP does not guarantee in-country routing for every Thai ISP. Worth measuring from real user connections rather than assuming.
- **AWS CloudFront** restructured into flat-rate plans with **no overage charges**: Free $0/mo (1M requests, 100 GB transfer), Pro $15/mo (10M requests, 50 TB), Business $200/mo, Premium $1,000/mo. Plans bundle CDN + WAF + DDoS + Route 53 DNS + TLS + edge compute, and data transfer from AWS origins to CloudFront is waived. The free plan alone would cover a Stage 1 launch. ⚠️ CloudFront's per-GB pay-as-you-go APAC rates were **not found** — the pricing page now leads with flat-rate plans.
- **GCP**: no charge for data transfer from Cloud Storage/Cloud Run to Cloud CDN, Media CDN, or Cloud Load Balancing.

## Trade-off summary

**Cloudflare R2 behind a Cloudflare custom domain is the strongest fit on the evidence** — it eliminates the single largest and least predictable storage cost line for an image-heavy marketplace, includes a free CDN with a Bangkok PoP, and its **S3-compatible API keeps lock-in low despite the proprietary pricing advantage** (migration in or out uses standard tooling).

The realistic alternatives: **DigitalOcean Spaces** if BANHAO consolidates on DigitalOcean and values one flat $5 bill over optimization; **S3 in the Thailand region** if BANHAO consolidates on AWS and wants everything in one provider with in-country residency.

This is a recommendation for Product Owner evaluation. It interacts with the hosting decision (Q-009) — consolidating on one provider has real operational value that may outweigh R2's egress advantage at Stage 1 volumes, where egress bills are small in absolute terms regardless.
