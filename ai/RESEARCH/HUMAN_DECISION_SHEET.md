# BANHAO Technology Decision Sheet

**For the Product Owner.** Every "My Decision" field below is deliberately left as `TBD` — **an AI agent must never fill these in.** Once you record a decision here, it gets promoted into `docs/DECISIONS.md` as a `DEC-NNN` with `Status: ACCEPTED`, and the corresponding question in `ai/KNOWLEDGE/QUESTIONS.md` moves to `RESOLVED`.

Background for each choice: [`EXECUTIVE_SUMMARY.md`](EXECUTIVE_SUMMARY.md) and [`DECISION_MATRIX.md`](DECISION_MATRIX.md).

---

## ⚠️ Decide these first — they gate everything else

### Legal / marketplace settlement model (Q-002)

Whether BANHAO's split/transfer-round/cash-liability design constitutes regulated payment facilitation under the Payment Systems Act — **even when using a licensed PSP** — is unresolved and not answerable from public sources.

**Recommended action:** commission Thai legal review before selecting a payment provider.

**My Decision:**
TBD

---

### PromptPay refund mechanism (Q-020)

🚨 **No payment provider examined supports native PromptPay refunds.** This contradicts the documented refund design in `docs/04-payment`.

Options:
- A: Wallet / store credit on a BANHAO balance (⚠️ stored value may carry its own regulatory implications)
- B: Manual bank transfer as an operational process
- C: Cash refund via driver
- D: Restrict cancellation windows to reduce refund frequency

**My Decision:**
TBD

---

## Backend (Q-006)

Needs Q-016 (team capability) answered first. Research found a genuine three-way trade with **no single winner**.

- **A: NestJS / TypeScript** — best AI-assisted-coding leverage, enforced structure; weaker local hiring signal
- **B: Laravel / PHP** — deepest Thai hiring pool (127 Laravel + 318 PHP listings), best queue tooling (Horizon); ⚠️ no LTS since 2019
- **C: Go** — best real-time efficiency, runs at Grab; weakest hiring cost, least mature queue ecosystem

**My Decision:**
TBD

---

## Database (Q-007)

- **A: PostgreSQL** — ⭐ *recommended, HIGH confidence.* Only option best-in-class on ACID (SSI), geospatial (PostGIS indexed KNN), and JSON (GIN-indexed `jsonb`). ⚠️ Requires PgBouncer from day one
- **B: MySQL / MariaDB** — simplest ops, aligns with PHP hiring pool; hand-rolled two-stage geo queries, pre-declared JSON indexes
- **C: MongoDB** — best schema flexibility and managed HA; ⚠️ transactions work against the grain of a financial ledger

**My Decision:**
TBD

---

## Payment provider (Q-001)

Do not decide before Q-002 and Q-020.

- **A: Xendit** — ⭐ only documented THB marketplace split + individual drivers onboardable as sub-accounts. ⚠️ Static-token webhook auth (weaker); unpublished platform fees; ฿10 min + ฿7 ≈ 11.3% on a ฿150 order
- **B: Omise / Opn** — best webhook security; PromptPay 1.65% + VAT. ⚠️ KYB has **no natural-person category** — blocks individual drivers
- **C: Beam** — best docs, PromptPay "from Free", T+1 settlement. ⚠️ No marketplace layer at all
- **D: 2C2P** — payout-by-instruction with individual beneficiaries. ⚠️ PromptPay never named in docs; no published pricing
- ~~Stripe~~ — **disqualified**: TH Connect blocks separate charges and transfers, and restricts Food + Transportation

**My Decision:**
TBD

---

## Platform fee (Q-010)

The fee appears as a real ledger line item throughout `docs/04-payment`, but **no rate or formula is documented anywhere**. The ledger cannot be built to balance to zero (CON-003) without it.

**My Decision:**
TBD

---

## Authentication (Q-014 for authorization granularity)

Research recommends differentiating by role: Phone+OTP for Customer/Driver (already designed), strongest available for Admin, Merchant undetermined.

**My Decision:**
TBD

---

## Maps (Q-018)

⚠️ **Rural Buntharik accuracy is unmeasured and cannot be desk-researched** — recommend field-testing real addresses before choosing.

- **A: Mapbox** — most generous free tier (100k directions/matrix). ⚠️ Permanent geocoding has no free tier
- **B: Longdo** (Thai) — 800k free map transactions; ⚠️ 5,000 req/day cap; plausible local-data advantage, unverified
- **C: Google** — per-SKU free caps; mobile SDK unlimited free
- **D: Self-hosted OSRM** — Thailand extract only 310 MB; fixed cost instead of per-request
- ~~HERE~~ — **disqualified**: Base Plan licence excludes asset tracking

**My Decision:**
TBD

---

## Infrastructure (Q-009)

⭐ **AWS and GCP both now have Bangkok regions, and both are *cheaper* than Singapore** — latency, data residency, and cost align rather than trade off.

- **A: Cloud Run Bangkok** — lowest ops burden, in-country residency, Tier 1 pricing. ⚠️ Needs min-instances for cold starts
- **B: VPS (DigitalOcean / Vultr Singapore)** — lowest cost and lock-in, no cold starts. ⚠️ You operate it; PDPA cross-border needs SCCs
- **C: AWS Bangkok** (ECS/Fargate) — in-country, ~10% cheaper than Singapore
- ⚠️ Avoid: **EKS** (~$73/mo floor), **Render free tier** (15-min spin-down), **Thai enterprise clouds** (no public pricing)

**My Decision:**
TBD

---

## Architecture candidate

- **A: ARCH-A** — modular monolith on Cloud Run Bangkok (lowest ops)
- **B: ARCH-B** — modular monolith on VPS (lowest cost/lock-in)
- **C: ARCH-C** — Go monolith + self-hosted OSRM (most efficient, highest complexity)

**My Decision:**
TBD

---

## Proposals awaiting approval

Each is `PROPOSED` in [`ai/KNOWLEDGE/PROPOSALS.md`](../KNOWLEDGE/PROPOSALS.md) — approve, reject, or modify:

| | Proposal | My Decision |
|---|---|---|
| PROP-001 | Modular Monolith for Stage 1–2 | TBD |
| PROP-002 | Monorepo on this repository | TBD |
| PROP-003 | Layered real-time (WebSocket/SSE + push + polling) | TBD |
| PROP-004 | Database-backed queue, defer a broker | TBD |
| PROP-005 | Role-differentiated authentication | TBD |

---

## Actions with external lead time

These are not technology choices but need starting early:

| Action | Question | Note |
|---|---|---|
| Thai legal/compliance review | Q-002, Q-015, Q-012, Q-017 | **Recommended first action** — depends on a third party's schedule |
| SMS Sender ID registration | Q-019 | ~2-week approval *(unverified)* |
| Field-test map coverage in Buntharik | Q-018 | Cannot be done remotely |
| Confirm Xendit's unpublished platform fees | Q-001 | Requires vendor contact |

**My notes:**
TBD
