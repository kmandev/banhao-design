# Executive Summary — Architecture & Technology Research

**Date:** 2026-08-09 · **Status:** Research complete, awaiting Product Owner decisions
**No technology has been selected. Q-001, Q-006, and Q-007 remain `OPEN`.**

---

## 1. What BANHAO needs

A three-sided marketplace backend that connects customers, merchants, and drivers, with three non-negotiable properties already fixed by the existing design:

- **Order State and Payment State as separate, consistent state machines** (CON-001) — 12 states each
- **Payment confirmed only by verified provider webhook**, never client state (CON-002)
- **Every order's ledger balancing to exactly zero** (CON-003), including driver-held cash as a platform liability

Plus: real-time order status across four surfaces, geospatial driver matching, PromptPay + cash payments, and a domain model generic enough to carry Food → Parcel → Ride → Shopping without a rewrite.

## 2. Technology categories that matter

Twelve categories were researched: backend, database, payment, authentication, real-time, queue, maps, storage, notifications, infrastructure, observability, repository strategy. **They are not equally consequential.** Payment and database carry the constraints that are hardest to reverse; observability and storage are close to solved problems at this scale.

## 3. Best options

| Category | Recommendation | Confidence |
|---|---|---|
| **Database** | **PostgreSQL** — only option best-in-class on ACID (SSI), geospatial (PostGIS indexed KNN, pgRouting, H3), *and* flexible JSON (GIN-indexed `jsonb`) | **HIGH** |
| **Storage** | **Cloudflare R2** — $0 egress at any volume vs ~$120/TB on S3/GCS | **HIGH** |
| **Observability** | **OpenTelemetry + Sentry + Grafana Cloud Free** — $0–26/mo | **HIGH** |
| **Notifications** | **FCM + Thai SMS gateway + LINE (reply-based)** | **HIGH** |
| **Payment** | **Xendit** is the only structural fit — but see §5 | **MEDIUM** |
| **Infrastructure** | **Cloud Run Bangkok** or a **$5–10 VPS** | **MEDIUM** |
| **Real-time** | Layered: WebSocket/SSE + FCM push + polling fallback | **MEDIUM** |
| **Queue** | Database-backed (transactional enqueue) | **MEDIUM** |
| **Repository** | Monorepo on this repository | **MEDIUM** |
| **Backend** | **No single recommendation** — genuine three-way trade | **LOW** |
| **Maps** | **Field-test required before choosing** | **LOW** |

## 4. Main trade-offs

- **Backend is a real three-way trade, not a ranking.** NestJS/TypeScript maximizes AI-assisted-coding leverage and enforces structure. Laravel has the deepest Thai hiring pool (127 Laravel + 318 PHP listings) and the best queue tooling in the industry (Horizon) — but no LTS since 2019, meaning a permanent ~2-year upgrade treadmill on a payments system. Go is most efficient for real-time and is what Grab runs, but has the weakest hiring-cost profile. **The deciding input is team capability (Q-016), which only the Product Owner has.**
- **Managed convenience vs. cost and control** — the difference between ARCH-A and ARCH-B is mostly who operates the servers.
- **Marketplace capability vs. per-transaction cost** — see below.

## 5. Biggest risks

Three findings materially change the picture and none was known to the repository before this research:

**🚨 PromptPay refunds are not natively supported by any provider examined.** Omise states they are impossible; Beam excludes the method; Xendit's matrix marks it unsupported; Stripe requires emailing the customer for bank details. **This contradicts BANHAO's documented refund design** (`REFUND_PENDING → REFUND_PROCESSING → REFUNDED`, and automatic refund on cancel-before-`PREPARING`). An off-rail mechanism — most likely wallet credit — must be designed. This is a product decision, not just engineering, and a stored-value wallet may itself carry regulatory implications. **Q-020.**

**🚨 The payment-facilitation licensing boundary is unresolved.** BANHAO's own design has the platform calculating splits, running transfer rounds, and holding driver cash as a liability. Whether that constitutes regulated payment facilitation under the Payment Systems Act — **even when routing through a licensed PSP** — is not resolvable from public sources. Answered late, it could invalidate payment architecture work. **Q-002.**

**⚠️ ETDA notification may already be required.** The Royal Decree on Digital Platform Services (effective Aug 2023) requires notification for intermediary services connecting business users and consumers. Full-form applies above THB 50M revenue or 5,000 MAU; short-form appears to apply *otherwise* — i.e. possibly at Stage 1. ETDA announced stepped-up enforcement in 2025 including criminal penalties. **Q-015.**

Also material: **Stripe is disqualified** (TH Connect blocks separate charges and transfers, *and* restricts Food and Transportation). **HERE is disqualified** (Base Plan licence excludes asset tracking — the core use case). **Rural map accuracy in Buntharik is unmeasured** and cannot be resolved by desk research (Q-018).

## 6. Estimated complexity

**Moderate, and lower than it might appear.** The domain is well-specified — the state machines, ledger rules, and entity model are already documented to an unusual level of detail, which removes most design ambiguity from implementation. A modular monolith (PROP-001) keeps the transactional guarantees that CON-001/CON-003 need available "for free" from the database rather than requiring distributed-transaction patterns.

The genuine complexity sits in three places: reconciliation and settlement logic, the cash-collection liability flow, and whatever refund mechanism replaces native PromptPay refunds.

## 7. Estimated cost ranges

| Stage | Infrastructure/month |
|---|---|
| 1 — Buntharik | **$0–30** |
| 2 — district/province | **$100–270** |
| 3 — multi-province | **$600–3,000** |
| 4 — national | **TBD** (no volume basis; not estimated) |

**Infrastructure is close to free at launch.** The real Stage 1 costs are payment processing fees and legal/compliance review.

⚠️ **A finding that affects unit economics:** Xendit's PromptPay fee is 2.50% with a **฿10 minimum plus ฿7 fixed processing charge** — on a ฿150 order that is ~11.3%, versus ~1.8% for Omise. Since BANHAO's own ledger examples show ฿50–130 orders, the minimum-fee floor may bind on most transactions. **The best structural fit may also be the most expensive per small order** — and Xendit's platform fees are unpublished, so this cannot be fully modelled yet.

## 8. Recommended architecture candidates

Three coherent end-to-end candidates in [`ARCHITECTURE_CANDIDATES.md`](ARCHITECTURE_CANDIDATES.md), all sharing PostgreSQL, R2, OTel/Sentry/Grafana, and a modular monolith:

- **ARCH-A** — Modular monolith on **Cloud Run Bangkok**. Lowest ops burden, in-country data residency, ~$0–30/mo.
- **ARCH-B** — Same application on a **plain VPS**. Lowest cost and lock-in, no cold starts, but you operate it.
- **ARCH-C** — **Go** monolith with **self-hosted OSRM routing**. Most efficient and converts volatile maps cost into fixed cost; highest operational complexity.

## 9. Decisions required from Product Owner

**Blocking implementation:**

| | Question | Why it blocks |
|---|---|---|
| **Q-002** | Legal/marketplace settlement model | Payment provider choice is downstream of this |
| **Q-020** | 🚨 PromptPay refund mechanism | Contradicts documented design; affects Customer App UX |
| **Q-001** | Payment provider | Cannot resolve before Q-002 and Q-020 |
| **Q-006** | Backend stack | Needs Q-016 (team capability) first |
| **Q-007** | Database | Recommendation is HIGH confidence — needs approval only |
| **Q-010** | Platform fee percentage/formula | Ledger cannot balance without it |

**Needed soon, with lead time:**

| | Question |
|---|---|
| **Q-015** | ETDA notification — legal review |
| **Q-016** | Team skill constraints; does DEC-006's Flutter intention still hold? |
| **Q-009** | Infrastructure budget and hosting preference |
| **Q-018** | Field-test map coverage in Buntharik |
| **Q-019** | SMS Sender ID registration (~2-week lead time) |
| **Q-012** | PDPA review of driver location data |

Full list including lower-priority items: [`ai/KNOWLEDGE/QUESTIONS.md`](../KNOWLEDGE/QUESTIONS.md).

## 10. Recommended next step

**Commission the Thai legal/compliance review first (Q-002, Q-015, Q-012, Q-017) — before selecting a payment provider or writing any code.**

The reasoning: the payment-facilitation boundary determines what money-flow structures are permissible, which determines which provider model fits, which in turn shapes the ledger and settlement implementation. It has external lead time (it depends on a third party's schedule, not BANHAO's), and it is the one open question with the power to invalidate work already done rather than merely delay work not yet started.

Database (Q-007) can be approved in parallel — the evidence there is HIGH confidence and independent of the legal question. Backend (Q-006) can be decided as soon as Q-016 is answered.

---

*This research selected no technology, closed no question, and created no `ACCEPTED` decision. Five proposals (PROP-001…005) are recorded as `PROPOSED` in [`ai/KNOWLEDGE/PROPOSALS.md`](../KNOWLEDGE/PROPOSALS.md). Use [`HUMAN_DECISION_SHEET.md`](HUMAN_DECISION_SHEET.md) to record decisions.*
