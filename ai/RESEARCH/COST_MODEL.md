# Cost Model

All unit prices checked **2026-08-09**, sourced in `ai/RESEARCH/SOURCES.md`. Currency: **USD** unless marked THB (฿).

**Read this first.** Every total below is an **`ASSUMPTION`**, because the usage volumes they multiply are assumptions (`ai/RESEARCH/SCALE_MODEL.md`) — no real usage data exists. The **unit prices are real and sourced**; the **volumes are not**. Where a price could not be verified, this model says so rather than substituting a guess.

## Method

For each stage: unit price (sourced) × assumed volume (from `SCALE_MODEL.md`) = indicative range. Ranges are given rather than point estimates. Payment processing is shown separately because it scales with GMV, not infrastructure.

---

## Stage 1 — อำเภอบุณฑริก (assumed low tens–hundreds of orders/day)

| Line item | Option assumed | Monthly cost | Source confidence |
|---|---|---|---|
| Compute | VPS (DigitalOcean $6 / Vultr $5) **or** Cloud Run Bangkok free tier | **$0–12** | Price verified |
| Database | Supabase Free / Neon Free, or DO Managed PG $15.15 | **$0–15** | Price verified |
| Object storage | Cloudflare R2 (under 10 GB free tier) | **$0** | Price verified |
| CDN | Cloudflare free tier | **$0** | Price verified |
| Maps | Mapbox free (100k directions/matrix) or Longdo free (800k map txn) | **$0** | Price verified |
| SMS / OTP | ThaiBulkSMS ฿0.15/credit — at ~500 OTPs/mo ≈ ฿75 | **~$2** | Price verified |
| Push | FCM | **$0** | Price verified |
| LINE | Free package (300 broadcasts/mo) | **$0** (฿0) | Price verified |
| Email | AWS SES ($0.10/1,000) | **<$1** | Price verified |
| Error tracking | Sentry Developer (free, **single user**) | **$0** | Price verified |
| Metrics/logs | Grafana Cloud Free | **$0** | Price verified |
| Domain/TLS | Not researched | **TBD** | — |
| **Infrastructure subtotal** | | **≈ $0–30/month** | |

**Stage 1 is essentially free to run on infrastructure.** Free tiers across compute, storage, maps, push, and observability cover this volume comfortably. The real Stage 1 costs are not infrastructure — they are payment processing (below), legal/compliance review, and people.

⚠️ **Sentry becomes $26/mo the moment a second developer joins** (free tier is single-user). That is likely the first infrastructure bill BANHAO actually pays.

---

## Stage 2 — district/province expansion (assumed ~10× Stage 1)

| Line item | Option assumed | Monthly cost |
|---|---|---|
| Compute | Small managed instance or 2× VPS | **$25–60** |
| Database | Supabase Pro $25 / DO Managed 4 GiB $60.90 | **$25–61** |
| Object storage | R2 (~50–100 GB) at $0.015/GB | **$1–2** |
| CDN egress | R2 = **$0** (vs ~$120/TB on S3/GCS) | **$0** |
| Maps | Likely still within Mapbox free tier; Longdo's **5,000 req/day** cap may bind first | **$0–50** |
| SMS / OTP | ~5,000 OTPs/mo × ฿0.15 ≈ ฿750 | **~$21** |
| LINE | May exceed 300 free broadcasts → Pro ฿1,780/mo | **$0–50** |
| Observability | Sentry Team $26 + Grafana Free | **$26** |
| **Infrastructure subtotal** | | **≈ $100–270/month** |

**The R2 decision starts paying here.** At Stage 2 image volumes, S3/GCS egress would add a meaningful line; R2 keeps it at zero.

---

## Stage 3 — multi-province (assumed low thousands–tens of thousands orders/day)

| Line item | Monthly cost |
|---|---|
| Compute (multiple instances / autoscaling) | **$150–600** |
| Database (larger managed instance + replica) | **$120–500** |
| Object storage (R2, several hundred GB) | **$5–15** |
| CDN | **$0** (R2/Cloudflare) |
| Maps | Likely paid tier — **$100–1,000+**, highly variable |
| SMS / OTP | **$100–400** |
| LINE Pro + overage (฿0.06/msg) | **$50–300** |
| Observability (Sentry Team/Business + Grafana Pro) | **$45–120** |
| **Infrastructure subtotal** | **≈ $600–3,000/month** |

⚠️ **Maps becomes the least predictable line item at this stage** — cost scales with driver-location update frequency, which is an engineering choice, not a fixed rate. An aggressive polling design can multiply this bill several-fold (see `ai/RESEARCH/RISK_MATRIX.md`). This is the strongest argument for evaluating self-hosted OSRM — Thailand's OSM extract is only 310 MB, making self-hosting viable at a fixed VPS cost instead of per-request fees.

---

## Stage 4 — national scale

**TBD.** `ai/RESEARCH/SCALE_MODEL.md` deliberately declines to assume volumes at this range, so multiplying unit prices by them would produce a fabricated number. Not estimated.

What can be said without a number: at national scale the cost structure changes qualitatively — reserved/committed-use discounts, dedicated infrastructure, and negotiated payment rates all become available, so extrapolating Stage 3 linearly would overstate cost anyway.

---

## Payment processing — scales with GMV, not infrastructure

This is **the dominant variable cost** and dwarfs infrastructure at every stage.

Using an **assumed** average order value of ฿150 (chosen to sit in the middle of the ฿50–130 order examples shown in `docs/04-payment`'s own ledger illustrations — those are design examples, not real data):

| Provider | PromptPay fee | Cost per ฿150 order |
|---|---|---|
| **Beam** | "Starts from Free" | **฿0** (terms unconfirmed) |
| **Omise** | 1.65% **+ 7% VAT added** | ฿2.48 + VAT ≈ **฿2.65** |
| **Xendit** | 2.50% (min ฿10) + ฿7.00 processing | **฿17.00** (the ฿10 minimum binds — 11.3% of a ฿150 order) |
| **2C2P** | Not published | **TBD** |

⚠️ **This is a material finding for unit economics.** Xendit's **฿10 minimum fee plus ฿7 fixed processing charge** means small orders are disproportionately expensive: on a ฿150 order that is ~11.3% of order value, versus ~1.8% for Omise. Since BANHAO's own design examples show orders in the ฿50–130 range, the minimum-fee floor may bind on a large share of transactions.

This creates a genuine tension with `ai/RESEARCH/PAYMENT_RESEARCH.md`'s finding that Xendit is the only provider with the marketplace capability BANHAO needs: **the best structural fit may also be the most expensive per small order.** Resolving this requires the unpublished xenPlatform sub-account and in-house transfer fees (Q-001), plus a decision on Q-010 (platform fee), to know whether the unit economics work.

Additional payout costs: Xendit bank payouts 1.00% (min ฿20) + ฿7; Omise transfers ฿20/transaction ≤฿2M. **Payout frequency directly drives this cost** — daily transfer rounds cost far more in fixed per-transfer fees than weekly ones. `docs/04-payment` shows a weekly cycle ("โอนทุกวันจันทร์"), which is favourable.

---

## Costs deliberately not estimated

- **Legal/compliance review** (Q-002, Q-012, Q-015, Q-017 — Thai counsel, tax advisor, possibly labour counsel). Likely a significant Stage 1 cost, but no basis to estimate professional fees.
- **AWS RDS Singapore/Thailand instance pricing** — ⚠️ could not be verified (JS-rendered page, region JSON 404'd). Use the AWS Pricing Calculator directly.
- **Fly.io Singapore compute**, **CloudFront APAC per-GB rates**, **True IDC / AIS Cloud pricing**, **Xendit xenPlatform platform fees**, **2C2P fees** — all ⚠️ unpublished or unverifiable; require vendor contact.
- **People costs** — out of scope for this research.
- **Domain, TLS beyond free options, business registration** — not researched.

---

## Summary

| Stage | Infrastructure/month | Dominant cost |
|---|---|---|
| **1** | **$0–30** | Payment fees + legal review, not infrastructure |
| **2** | **$100–270** | Payment fees |
| **3** | **$600–3,000** | Payment fees; **maps is the volatile line item** |
| **4** | **TBD** | Not estimated — no volume basis |

**The headline:** infrastructure is close to free at launch and stays modest well into growth. **Payment processing fees and the legal/compliance work are what actually cost money at Stage 1** — and the payment fee structure (particularly minimum-fee floors on small orders) deserves more scrutiny than the hosting decision.
