# Q-002 OWNER DECISION PACK

```
DECISION PREPARATION MATERIAL
ALL ECONOMIC VALUES ARE OWNER CANDIDATES — NOT LOCKED
NO DECISION IS LOCKED BY THIS DOCUMENT
IMPLEMENTATION NOT AUTHORIZED
```

Written 2026-09-09 against HEAD `7988a144` on `feature/g7-driver-availability`.
Companion to [`Q-002-ECONOMICS-ARCHITECTURE-SPEC.md`](Q-002-ECONOMICS-ARCHITECTURE-SPEC.md),
which this pack converts into reviewable business choices.

**Nothing here modifies DEC-035, DEC-036, DEC-043, DEC-044, DEC-045, DEC-046 or
any Q-020 decision. Every one of them remains locked and authoritative.**

---

## 0. How to read this document

Every number that is **not** a restatement of an existing locked decision is
labelled `OWNER CANDIDATE — NOT LOCKED` or `ILLUSTRATIVE ONLY — NOT LOCKED`.
A recommendation in this pack is an argued starting point for the owner to
accept, reject or replace — **it is never a decision**, and no candidate becomes
locked because it is recommended here.

**The central distinction, preserved throughout:**

> **`Order-level contribution protection`** means BANHAO will not *accept* an
> order whose projected contribution is below the configured floor.
> **It is not a guarantee that BANHAO can never lose money.** Refunds,
> chargebacks, distance overruns, failed deliveries, fee divergence and fraud
> all remain possible *after* acceptance. See §6.

---

## 1. Recon — what is actually true today

Verified against the repository and the live `banhao-dev` catalog.

| Item | Current state | Source |
|---|---|---|
| Delivery fee | Flat ฿10 (1000 satang), no distance/bands/zones | **DEC-035 — LOCKED** |
| Service fee | Fixed ฿5 (500 satang), explicitly not a percentage | **DEC-036 — LOCKED** |
| Commission | 8% of food subtotal, round-half-up to whole baht | **DEC-043 — LOCKED** |
| Rider earning | Flat ฿12 (1200 satang) | **DEC-044 — LOCKED** |
| Delivery funding gap | ฿2 as `PLATFORM_WRITE_OFF` | **DEC-045 — LOCKED** |
| Promotion funder | `PLATFORM` or `MERCHANT` per promotion, **no split** | **DEC-046 — LOCKED** |
| Stripe PromptPay rate | **1.65%** per successful payment, recorded as an *external provider-cost assumption only*, sourced from Stripe's published Thailand pricing | **DEC-055 clause 3** |
| Refund fee recoverability | **Stripe's processing fee is not returned when a payment is refunded** under standard pricing — already recorded | **DEC-055 clause 3** |
| Phase 1 cash waterfall | `Customer → BANHAO Stripe account → BANHAO internal ledger → future settlement/payout`; no Connect, no connected accounts, no transfers | **DEC-055 clause 4** |
| Q-002 itself | `OPEN` / `LEGAL_REVIEW_REQUIRED` | `OPEN_BUSINESS_QUESTIONS.md` |
| Discount | `orders.discount_satang` defaults 0; **no code path ever sets it non-zero** | Verified |
| Merchant food payable | **Never posted to the ledger** | Verified |
| Delivery-fee revenue | **Never recognized** in any ledger group | Verified |
| Distance | `addresses.lat`/`lng` NULL in practice; `orders.distance_m` **never populated** | Verified |
| Client price authority | Client sends `expectedLines` for *validation only*; server is sole pricing authority | DEC-E-01, verified |
| Pricing seam | `OrderPricingService.resolveOrderFees()` — args present, deliberately ignored | Verified |
| Config infrastructure | **None exists** — no config table, no settings table, no feature flags | Verified |

**One correction to earlier Q-002 analysis, worth stating plainly:** the 1.65%
rate and the non-recoverability of the refund fee are **already documented in
DEC-055**, with a cited source. Earlier briefs in this series treated both as
unverified owner assumptions. They are repository-recorded assumptions — still
requiring contractual confirmation for BANHAO's own account, but not invented.

---

## 2. Scenario basis

All scenarios below are `ILLUSTRATIVE ONLY — NOT LOCKED`.

**Food subtotals:** ฿40, ฿60, ฿80, ฿100, ฿150, ฿200, ฿300.

**Distance scenarios** (`ILLUSTRATIVE ONLY — NOT LOCKED`):

| Label | Distance | Rationale |
|---|---:|---|
| Short | 2 km | In-town Buntharik delivery |
| Normal | 5 km | Typical district delivery |
| Long | 10 km | Outlying village |
| Max radius | 15 km | Candidate service boundary |

**Illustrative rider-cost model** (`ILLUSTRATIVE ONLY — NOT LOCKED`) — a
placeholder to be replaced with real rider data once riders operate:

```
Rider Required        = ฿8 base + (฿1.20 × km)
Effective Requirement = MAX(Rider Required, Rider Floor ฿12)
Customer Delivery Fee = Effective Requirement ÷ Rider Share (80%)
```

| Distance | Rider required | Effective (floor ฿12) | Derived delivery fee |
|---|---:|---:|---:|
| Short 2 km | ฿10.40 | ฿12.00 (floor binds) | ฿15.00 |
| Normal 5 km | ฿14.00 | ฿14.00 | ฿17.50 |
| Long 10 km | ฿20.00 | ฿20.00 | ฿25.00 |
| Max 15 km | ฿26.00 | ฿26.00 | ฿32.50 |

**Candidate parameter set used in scenarios** — every value
`OWNER CANDIDATE — NOT LOCKED`: commission 10% · service fee 5% of food ·
rider share 80% · rider floor ฿12 · contribution floor ฿8 · Stripe 1.65%.

---

## 3. Economic simulation

### 3.1 Current locked baseline

Delivery ฿10 (DEC-035), service ฿5 (DEC-036), commission 8% round-half-up
(DEC-043), rider ฿12 (DEC-044). Distance-invariant by design — the fee cannot
move, which is the point of the comparison.

```
Contribution = commission + ฿5 + ฿10 − ฿12 − (1.65% × customer total)
```

| Food | Delivery | Service | Commission | Rider | Customer total | Stripe | **Contribution** | Share |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ฿40 | ฿10 | ฿5 | ฿3 | ฿12 | ฿55 | ฿0.91 | **฿5.09** | 9.3% |
| ฿60 | ฿10 | ฿5 | ฿5 | ฿12 | ฿75 | ฿1.24 | **฿6.76** | 9.0% |
| ฿80 | ฿10 | ฿5 | ฿6 | ฿12 | ฿95 | ฿1.57 | **฿7.43** | 7.8% |
| ฿100 | ฿10 | ฿5 | ฿8 | ฿12 | ฿115 | ฿1.90 | **฿9.10** | 7.9% |
| ฿150 | ฿10 | ฿5 | ฿12 | ฿12 | ฿165 | ฿2.72 | **฿12.28** | 7.4% |
| ฿200 | ฿10 | ฿5 | ฿16 | ฿12 | ฿215 | ฿3.55 | **฿15.45** | 7.2% |
| ฿300 | ฿10 | ฿5 | ฿24 | ฿12 | ฿315 | ฿5.20 | **฿21.80** | 6.9% |

**This table assumes the rider accepts ฿12 for any distance.** That is the
locked model's assumption, not a finding. §4.2 shows what happens when it fails.

### 3.2 Candidate dynamic model

`ILLUSTRATIVE ONLY — NOT LOCKED.` Commission 10%, service 5%, delivery derived
from rider cost, rider share 80%, floor ฿12.

```
Customer total = 1.05 × Food + Delivery
Contribution   = 0.132675 × Food + 0.1835 × Delivery
```

**Contribution (฿) — guardrail check against a candidate ฿8 floor:**

| Food ↓ / Distance → | Short (D ฿15) | Normal (D ฿17.50) | Long (D ฿25) | Max (D ฿32.50) |
|---:|---:|---:|---:|---:|
| ฿40 | 8.06 ✅ | 8.52 ✅ | 9.89 ✅ | 11.27 ✅ |
| ฿60 | 10.71 ✅ | 11.17 ✅ | 12.55 ✅ | 13.92 ✅ |
| ฿80 | 13.37 ✅ | 13.83 ✅ | 15.20 ✅ | 16.58 ✅ |
| ฿100 | 16.02 ✅ | 16.48 ✅ | 17.86 ✅ | 19.23 ✅ |
| ฿150 | 22.65 ✅ | 23.11 ✅ | 24.49 ✅ | 25.87 ✅ |
| ฿200 | 29.29 ✅ | 29.75 ✅ | 31.12 ✅ | 32.50 ✅ |
| ฿300 | 42.56 ✅ | 43.01 ✅ | 44.39 ✅ | 45.77 ✅ |

**Full breakdown at Normal distance (5 km, D = ฿17.50):**

| Food | Delivery | Service | Commission | Rider | Customer total | Stripe | **Contribution** | Share | ฿8 floor |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|
| ฿40 | ฿17.50 | ฿2.00 | ฿4.00 | ฿14 | ฿59.50 | ฿0.98 | **฿8.52** | 14.3% | ✅ |
| ฿60 | ฿17.50 | ฿3.00 | ฿6.00 | ฿14 | ฿80.50 | ฿1.33 | **฿11.17** | 13.9% | ✅ |
| ฿80 | ฿17.50 | ฿4.00 | ฿8.00 | ฿14 | ฿101.50 | ฿1.67 | **฿13.83** | 13.6% | ✅ |
| ฿100 | ฿17.50 | ฿5.00 | ฿10.00 | ฿14 | ฿122.50 | ฿2.02 | **฿16.48** | 13.5% | ✅ |
| ฿150 | ฿17.50 | ฿7.50 | ฿15.00 | ฿14 | ฿175.00 | ฿2.89 | **฿23.11** | 13.2% | ✅ |
| ฿200 | ฿17.50 | ฿10.00 | ฿20.00 | ฿14 | ฿227.50 | ฿3.75 | **฿29.75** | 13.1% | ✅ |
| ฿300 | ฿17.50 | ฿15.00 | ฿30.00 | ฿14 | ฿332.50 | ฿5.49 | **฿43.01** | 12.9% | ✅ |

**Two observations, not recommendations.** The candidate model produces a
**BANHAO contribution share of 12.9–15.1% across the full illustrative
food-value and distance matrix** (28 cells; the low end is ฿300 food at 2 km,
the high end is ฿40 food at 15 km) — 12.9–14.3% on the Normal-distance (5 km)
column shown above — where the locked baseline ranges 6.9–9.3% and collapses
when distance rises. This is BANHAO's own contribution as a share of the
customer total, not a formal marketplace take rate. And contribution
*increases* with distance under the candidate model, because BANHAO
takes a share of a fee that tracks cost — the opposite of the baseline's
behaviour.

**Guardrail biting.** With a candidate floor of **฿10** instead of ฿8, three
cells fail: ฿40 short (฿8.06), ฿40 normal (฿8.52) and ฿40 long (฿9.89). The
engine would mark those `NOT SERVICEABLE (BELOW_CONTRIBUTION_FLOOR)` or require
a higher customer price. **This is what the floor is for**, and it shows the
floor choice directly determines which orders BANHAO will serve.

---

## 4. Delivery economics

### 4.1 Why delivery must cover the rider before acceptance

A ฿40 order and a ฿400 order carried the same 10 km impose the **same** cost on
the rider. Pricing delivery from food value prices the wrong variable. The
architecture therefore derives the delivery fee from rider cost:

```
Effective Rider Required = MAX(Rider Required, Rider Floor)
Customer Delivery Fee    = Effective Rider Required ÷ Rider Share
```

When this holds, the rider's share covers the requirement exactly, BANHAO
retains the remainder, and no top-up arises.

### 4.2 Failure case — delivery fee too low

If the delivery fee is set below `Effective Requirement ÷ Share`, BANHAO must
top up the difference, and that top-up is a direct cost:

```
Rider top-up  = MAX(0, rider payout − (share × delivery fee))
Contribution  = 0.15F + 0.20D − top-up − 1.65% × (1.05F + D)
```

**Case 1 — flat ฿10 delivery, ฿12 floor, short distance.** Rider share pays ฿8;
top-up ฿4.

```
Contribution = 0.132675F − 2.165        → break-even at Food ≈ ฿16.30
```

**Case 2 — flat ฿10 delivery, 10 km trip requiring ฿20.** Rider share pays ฿8;
top-up ฿12.

| Food | Contribution |
|---:|---:|
| ฿40 | **−฿4.86** |
| ฿60 | **−฿2.20** |
| ฿80 | ฿0.45 |
| ฿100 | ฿3.10 |

```
Break-even at Food ≈ ฿76.60
```

**This is the single most important arithmetic in this pack.** A flat delivery
fee on a long trip is loss-making for every order below roughly ฿77 of food, and
the locked model has no mechanism to respond because DEC-035 forbids a distance
component. The candidate model's protection comes from **letting the fee move**,
not from the percentage split itself.

### 4.3 What the customer pays for that protection

| Food | Distance | Baseline total | Candidate total | Difference |
|---:|---|---:|---:|---:|
| ฿60 | Short | ฿75 | ฿78.00 | +฿3.00 (+4.0%) |
| ฿60 | Long | ฿75 | ฿88.00 | +฿13.00 (+17.3%) |
| ฿100 | Short | ฿115 | ฿120.00 | +฿5.00 (+4.3%) |
| ฿100 | Long | ฿115 | ฿130.00 | +฿15.00 (+13.0%) |
| ฿300 | Short | ฿315 | ฿330.00 | +฿15.00 (+4.8%) |
| ฿300 | Long | ฿315 | ฿340.00 | +฿25.00 (+7.9%) |

Nearby customers pay ~4–5% more; distant customers pay materially more. Whether
that demand loss outweighs the margin gain is a commercial judgement no
arithmetic in this pack can settle — it is part of Decisions 5–12.

---

## 5. Service fee analysis

`ILLUSTRATIVE ONLY — NOT LOCKED.` Comparing three models. **5% is not assumed to
be the answer.**

| Food | Fixed ฿5 (locked, DEC-036) | 5% of food | 5% capped at ฿10 | 5% capped at ฿15 |
|---:|---:|---:|---:|---:|
| ฿40 | ฿5.00 | ฿2.00 | ฿2.00 | ฿2.00 |
| ฿60 | ฿5.00 | ฿3.00 | ฿3.00 | ฿3.00 |
| ฿80 | ฿5.00 | ฿4.00 | ฿4.00 | ฿4.00 |
| ฿100 | ฿5.00 | ฿5.00 | ฿5.00 | ฿5.00 |
| ฿150 | ฿5.00 | ฿7.50 | ฿7.50 | ฿7.50 |
| ฿200 | ฿5.00 | ฿10.00 | ฿10.00 | ฿10.00 |
| ฿300 | ฿5.00 | ฿15.00 | **฿10.00** | ฿15.00 |
| ฿500 | ฿5.00 | ฿25.00 | **฿10.00** | **฿15.00** |

**Reading this honestly:** the fixed fee is *better for BANHAO below ฿100* of
food and worse above it. The percentage is regressive in reverse — it charges
large orders more for a service (payment handling, support, platform) whose cost
does not scale with basket size. That is the hardest part to justify to a
customer, and the easiest place for a competitor to undercut.

A cap addresses exactly that objection while preserving small-order economics.
A ฿15 cap only binds above ฿300 of food; a ฿10 cap binds above ฿200.

---

## 6. "Never lose money" test

**The claim under test is NOT "BANHAO can never lose money."** It is the
narrower, testable question:

> Can the pricing engine reject every order whose *expected* contribution is
> below the configured minimum safe contribution?

### 6.1 Mathematical condition

Yes — **if and only if** the delivery fee always covers the rider requirement:

```
Delivery Fee ≥ Effective Rider Requirement ÷ Rider Share
```

When that holds, the top-up term vanishes and:

```
Contribution = 0.132675 × Food + 0.1835 × Delivery
```

Both coefficients are positive, so contribution is positive for every positive
food value and delivery fee, and comparing it to the floor is a simple test the
engine can always evaluate. **This is a pricing rule, not a property of
percentages.**

### 6.2 Operational conditions required

1. Every economic input must be known at evaluation time (food subtotal,
   distance, rider requirement, promotion, fee assumption).
2. The evaluation must be **server-side and authoritative**, never a client
   check — already the established pattern.
3. The engine must **fail closed** on missing distance, missing configuration,
   invalid configuration or calculation error — never fall back to old constants.
4. The order and its pricing snapshot must be written atomically, so no accepted
   order can exist without its economics.
5. Re-validation must occur immediately before order creation, not only at
   checkout display.

### 6.3 Post-acceptance loss sources — outside this guardrail

| Source | Why the guardrail cannot prevent it |
|---|---|
| **Refund** | Returns customer money; **Stripe's processing fee is not returned** (DEC-055 clause 3) |
| **Chargeback** | Full order value plus possible fee, after the fact |
| **Actual distance exceeds estimate** | The fee was fixed from an estimate at pricing time |
| **Failed delivery** | Rider compensation may still be owed (DEC-053) |
| **Merchant failure** | Cooked-food loss allocation (DEC-051/052/053) |
| **Fee divergence** | 1.65% is a recorded *assumption*; actual may differ |
| **Platform-funded promotion applied late** | Only protected if evaluated inside pricing |
| **Fraud** | Outside pricing entirely |
| **Operational cost** | Support, infrastructure, staff — never in per-order contribution |

**Required terminology:** any UI, report or document describing this system must
say **`order-level contribution protection`** and must not claim BANHAO cannot
lose money.

---

## 7. Promotion economics

`ILLUSTRATIVE ONLY — NOT LOCKED.` A ฿10 discount on a ฿100 food order at Normal
distance (D ฿17.50), candidate parameters, ฿8 floor.

| | No promotion | Merchant-funded ฿10 | Platform-funded ฿10 |
|---|---:|---:|---:|
| Customer pays | ฿122.50 | ฿112.50 | ฿112.50 |
| Merchant gross payable | ฿100 | **฿90** | ฿100 |
| Commission (10% of ฿100) | ฿10 | ฿10 | ฿10 |
| Merchant net | ฿90 | **฿80** | ฿90 |
| BANHAO revenue | ฿18.50 | ฿18.50 | **฿8.50** |
| Stripe | ฿2.02 | ฿1.86 | ฿1.86 |
| **BANHAO contribution** | **฿16.48** | **฿16.64** | **฿6.64** |
| Passes ฿8 floor? | ✅ | ✅ | ❌ **BELOW FLOOR** |

**Two findings.** A merchant-funded discount leaves BANHAO's contribution
essentially unchanged — marginally *higher*, because Stripe's fee falls with the
smaller total. A platform-funded discount reduces contribution satang for satang
and, at ฿10, **breaches the ฿8 floor**.

**Maximum platform-funded discount that preserves the floor**, solved for this
order:

```
18.50 − P − 0.0165 × (122.50 − P) ≥ 8    →    P ≤ ฿8.62
```

**Required engine behaviour:** the promotion must be evaluated *inside* the
pricing calculation, before the serviceability verdict. When a platform-funded
promotion would push contribution below the floor, the engine must either reject
the promotion/order combination or require a higher customer price. **It must
never silently absorb the loss.** Which of the two behaviours applies is
Decision 14.

**Current state note:** `discount_satang` is always 0 today and the
`PROMOTION_FUNDING` ledger account has never been written to, so this section is
forward-looking. DEC-046 locks funders to `PLATFORM` or `MERCHANT` with **no
split**; enabling `SHARED` would require a superseding decision.

---

## 8. Owner decision matrix

Nineteen decisions. The architecture spec grouped distance source and accuracy
as one item (its #16); this pack separates them per the owner's list, so the
numbering runs to 19 with no item omitted.

**Every decision below carries status `OWNER DECISION REQUIRED`.**

---

### D-01 — Merchant commission rate

**Current locked state:** 8% of food subtotal (DEC-043).
**Why it matters:** BANHAO's largest revenue line and the main lever on merchant willingness to join.

| Option | Description |
|---|---|
| **A** | Keep 8% |
| **B** | Raise to 10% — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | Tiered by food subtotal or merchant agreement |

**Recommended candidate:** Option B (10%), *if* merchant recruitment can absorb it — but see the effect column: the real cost to a merchant is ฿1–3 per order.
**Economic effect:** +฿2 per ฿100 of food. **Customer effect:** none (commission is invisible to the customer). **Merchant effect:** ฿100 order → net falls ฿92 → ฿90 (−2.2%). Note DEC-043's rounding makes the effective rate vary by basket size — **8.33% on a ฿60 order**, but **7.50% on a ฿40 or ฿80 order** — so the size of the step to 10% depends on which basket the rounding lands closest to, not on a single fixed comparison. **Rider effect:** none. **Engineering effect:** LOW — a parameter. **Operational risk:** merchant churn in a district with few restaurants; merchant supply is the scarce resource in Buntharik.
**Before activation:** merchant agreement terms confirmed; fee disclosure reviewed.
**Superseding DEC required:** **Yes — DEC-043.**
`OWNER DECISION REQUIRED`

---

### D-02 — Commission rounding rule

**Current locked state:** round-half-up to whole baht, `floor((subtotal × 8 + 5000) / 10000) × 100` satang (DEC-043).
**Why it matters:** determines whether merchant statements are round baht amounts and whether the effective rate drifts from the nominal one.

| Option | Description |
|---|---|
| **A** | Keep round-half-up to whole baht |
| **B** | Round down to whole baht (merchant-favourable) |
| **C** | Exact satang, no rounding |

**Recommended candidate:** Option A — it is already implemented, already tested, and produces clean baht amounts on statements.
**Economic effect:** at most ฿0.50 per order either way. **Customer effect:** none. **Merchant effect:** Option C removes the small effective-rate drift; Option B is a modest giveaway. **Rider effect:** none. **Engineering effect:** LOW. **Operational risk:** minimal; but changing it changes historical comparability.
**Before activation:** if any option other than A, the initial config must be proven to reproduce current behaviour before values change (see §11).
**Superseding DEC required:** Only if changed from A — then **DEC-043**.
`OWNER DECISION REQUIRED`

---

### D-03 — Service fee model

**Current locked state:** fixed ฿5, explicitly "not a percentage, not a percentage with a cap or a minimum, not tiered" (DEC-036).
**Why it matters:** the most customer-visible fee and the one most likely to attract complaint.

| Option | Description |
|---|---|
| **A** | Keep fixed ฿5 |
| **B** | Percentage of food subtotal — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | Percentage with a cap |

**Recommended candidate:** Option C. It captures the upside on mid-size orders that Option A forgoes, while removing Option B's hardest-to-defend outcome — a ฿300 order paying ฿15 for a service identical to a ฿60 order's.
**Economic effect:** see §5. Fixed favours BANHAO below ฿100 of food; percentage above it. **Customer effect:** small orders pay *less* under a percentage (฿2 on ฿40 vs ฿5); large orders pay materially more. **Merchant effect:** none directly, but a high customer-facing fee suppresses order volume, which merchants feel. **Rider effect:** none. **Engineering effect:** LOW–MEDIUM (cap logic plus rounding). **Operational risk:** customer perception; fee-disclosure obligations.
**Before activation:** fee disclosure reviewed (§10).
**Superseding DEC required:** **Yes — DEC-036** for B or C.
`OWNER DECISION REQUIRED`

---

### D-04 — Service fee cap

**Current locked state:** none — DEC-036 rules out a cap because it rules out percentages.
**Why it matters:** the specific protection against the large-order objection in §5.

| Option | Description |
|---|---|
| **A** | No cap (only coherent with a fixed fee) |
| **B** | Cap at ฿10 — `OWNER CANDIDATE — NOT LOCKED` (binds above ฿200 food) |
| **C** | Cap at ฿15 — `OWNER CANDIDATE — NOT LOCKED` (binds above ฿300 food) |

**Recommended candidate:** Option C, as the least intrusive cap that still bounds the worst case — but this depends entirely on how common large orders turn out to be, which BANHAO cannot yet know.
**Economic effect:** a ฿15 cap forgoes ฿10 on a ฿500 order. **Customer effect:** protects large-basket customers, likely the most valuable ones. **Merchant effect:** favourable — large baskets stay competitive. **Rider effect:** none. **Engineering effect:** LOW. **Operational risk:** low.
**Before activation:** decide D-03 first; a cap is meaningless with a fixed fee.
**Superseding DEC required:** **Yes — DEC-036.**
`OWNER DECISION REQUIRED`

---

### D-05 — Rider share of delivery fee

**Current locked state:** none — DEC-044 sets a flat ฿12 earning, not a share.
**Why it matters:** together with D-06 it determines both rider supply and BANHAO's delivery margin.

| Option | Description |
|---|---|
| **A** | 80% — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | 85% (rider-favourable) — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | Keep a flat rider amount; no share at all |

**Recommended candidate:** Option A (80%), which yields a delivery margin of `0.25 × rider requirement` and produced every positive figure in §3.2.
**Economic effect:** at 80%, BANHAO nets `0.1835 × D` after Stripe. At 85%, roughly `0.1335 × D` — about a quarter less delivery margin. **Customer effect:** a higher share means a higher delivery fee for the same rider pay. **Merchant effect:** none. **Rider effect:** substantial — this is the rider's entire compensation model. **Engineering effect:** LOW. **Operational risk:** set too low and riders decline; in a district with few riders, supply is fragile.
**Before activation:** real rider-cost data; rider agreement reviewed (§10).
**Superseding DEC required:** **Yes — DEC-044.**
`OWNER DECISION REQUIRED`

---

### D-06 — Rider floor (minimum per delivery)

**Current locked state:** effectively ฿12 flat (DEC-044).
**Why it matters:** answers "what is the minimum a rider can expect for accepting an order?" — the question the percentage model alone cannot answer.

| Option | Description |
|---|---|
| **A** | ฿12, preserving parity with DEC-044 — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | Lower floor (e.g. ฿10) — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | No floor — pure percentage |

**Recommended candidate:** Option A. It preserves what riders already receive and avoids a launch in which the new model pays *less* than the old one.
**Economic effect:** the floor forces a minimum delivery fee of `floor ÷ share` — ฿15 at 80%/฿12. Below that, BANHAO tops up and contribution falls (§4.2). **Customer effect:** sets the minimum delivery price. **Merchant effect:** none. **Rider effect:** decisive — under Option C, an 80% share of a ฿10 fee pays just ฿8, ฿4 below today. **Engineering effect:** LOW, but the top-up term **must** be implemented; omitting it systematically overstates margin on short trips. **Operational risk:** rider attrition if set too low.
**Before activation:** rider agreement reviewed; D-05 decided.
**Superseding DEC required:** **Yes — DEC-044** (and **DEC-045**, since the structural ฿2 gap ceases to exist).
`OWNER DECISION REQUIRED`

---

### D-07 — Rider base component

**Current locked state:** none — no distance-based rider model exists.
**Why it matters:** the fixed part of rider cost, covering pickup, waiting and handover regardless of distance.

| Option | Description |
|---|---|
| **A** | ฿8 base — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | Lower base with a higher per-km rate |
| **C** | No base; pure per-km |

**Recommended candidate:** Option A, pending real data. Option C is unrealistic — a 0.5 km delivery still costs the rider real time.
**Economic effect:** raises the derived delivery fee at every distance. **Customer effect:** raises short-trip delivery prices. **Rider effect:** protects short-hop economics for riders. **Merchant effect:** none. **Engineering effect:** LOW. **Operational risk:** guessing this without rider data is the largest source of error in the whole model.
**Before activation:** **real rider-cost observation.** Everything in §2 is a placeholder.
**Superseding DEC required:** **Yes — DEC-044.**
`OWNER DECISION REQUIRED`

---

### D-08 — Rider per-km component

**Current locked state:** none.
**Why it matters:** the variable part; determines how quickly delivery price rises with distance.

| Option | Description |
|---|---|
| **A** | ฿1.20/km — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | ฿1.50/km — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | Banded (flat within distance bands) |

**Recommended candidate:** Option A pending data; Option C is worth considering because bands are far easier to explain to both riders and customers than a continuous rate.
**Economic effect:** at ฿1.20/km and 80% share, each extra km adds ฿1.50 to the customer fee and ฿0.30 to BANHAO. **Customer effect:** the entire long-distance price increase. **Rider effect:** must genuinely cover fuel and time. **Merchant effect:** outlying merchants become less competitive. **Engineering effect:** LOW (A/B), MEDIUM (C). **Operational risk:** underestimating means riders decline long trips.
**Before activation:** real rider-cost data; **distance must be computable (D-16)**.
**Superseding DEC required:** **Yes — DEC-044**, and **DEC-035** for any distance component.
`OWNER DECISION REQUIRED`

---

### D-09 — Minimum delivery fee

**Current locked state:** flat ฿10 is simultaneously the minimum and maximum (DEC-035).
**Why it matters:** the hard floor protecting very short deliveries.

| Option | Description |
|---|---|
| **A** | ฿15, derived from a ฿12 rider floor at 80% — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | ฿12 — `OWNER CANDIDATE — NOT LOCKED` (requires a top-up; see §4.2) |
| **C** | No explicit minimum; rely on the derived formula |

**Recommended candidate:** Option A. It makes the rider floor and the delivery minimum mutually consistent, so no top-up ever arises from the short-distance case.
**Economic effect:** Option B guarantees a ฿1.60 top-up on every floor-bound order. **Customer effect:** raises the cheapest possible delivery from ฿10 to ฿15 (+50%) — the most visible single change in the whole package. **Rider effect:** guarantees the floor is fundable. **Merchant effect:** may suppress small nearby orders. **Engineering effect:** LOW. **Operational risk:** a 50% rise in the entry-level delivery price is a real adoption risk in a price-sensitive rural market.
**Before activation:** D-05 and D-06 decided.
**Superseding DEC required:** **Yes — DEC-035.**
`OWNER DECISION REQUIRED`

---

### D-10 — Maximum delivery fee

**Current locked state:** effectively ฿10 (flat).
**Why it matters:** a ceiling above which an order becomes `NOT SERVICEABLE` rather than absurdly priced.

| Option | Description |
|---|---|
| **A** | ฿35 — `OWNER CANDIDATE — NOT LOCKED` (covers the 15 km candidate radius at ฿32.50) |
| **B** | ฿25 — `OWNER CANDIDATE — NOT LOCKED` (effectively caps service near 10 km) |
| **C** | No maximum; rely on the radius limit instead |

**Recommended candidate:** Option A, set just above the derived fee at the maximum radius so the two limits agree rather than contradict.
**Economic effect:** none directly; it bounds the tail. **Customer effect:** beyond it, no service is offered at all. **Rider effect:** none. **Merchant effect:** shrinks the effective catchment. **Engineering effect:** LOW. **Operational risk:** if set below the fee derived at the maximum radius, orders inside the radius become unserviceable — a contradictory configuration that validation rule V7 must catch.
**Before activation:** must be consistent with D-12.
**Superseding DEC required:** **Yes — DEC-035.**
`OWNER DECISION REQUIRED`

---

### D-11 — Minimum contribution per order

**Current locked state:** none. **No contribution floor exists anywhere today** — the concept is new.
**Why it matters:** **this is the decision that defines the guardrail.** Everything in §6 depends on it.

| Option | Description |
|---|---|
| **A** | ฿0 — reject only genuinely loss-making orders |
| **B** | ฿5 — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | ฿8 — `OWNER CANDIDATE — NOT LOCKED` |

**Recommended candidate:** Option B (฿5) for launch, raised deliberately once real contribution data exists. **Corrected rationale (this line previously stated, incorrectly, that Option C rejected several ฿40 orders — it does not; see §3.2, where every one of the 28 illustrative cells clears a ฿8 floor):** under the §2/§3 illustrative assumptions, a ฿5 floor and an ฿8 floor both pass all 28 scenario cells, and a ฿10 floor is the one that fails three of them (all ฿40, at 2/5/10 km). The real distinction between B and C is **headroom, not volume**. The worst-case ฿8-floor cell (฿40 food, 2 km) clears by only **฿0.0595** — under 6 satang — and that pass flips to a fail if the assumed 1.65% Stripe rate (itself an `ILLUSTRATIVE ONLY — NOT LOCKED` figure attributed to DEC-055) rises to **1.7544% or higher**, or if any other assumed cost is even slightly understated. Option B (฿5) is recommended for launch **because it is economically robust against assumption error while real data is still being gathered**, not because Option C would turn away orders it would not in fact turn away.
**Economic effect:** directly determines which orders are served. **Customer effect:** a higher floor means more refusals, concentrated on small and distant orders. **Merchant effect:** small merchants lose orders first. **Rider effect:** fewer low-value trips. **Engineering effect:** LOW as a parameter; the enforcement path is the substantial work. **Operational risk:** set too high at launch and BANHAO suppresses the volume it needs to learn from; set at ฿0 and it accepts orders that merely break even.
**Before activation:** the engine and its enforcement path must exist; contribution must be observable (§9).
**Superseding DEC required:** **No** — new decision, no existing lock to supersede.
`OWNER DECISION REQUIRED`

---

### D-12 — Maximum delivery radius

**Current locked state:** none. No radius, no zones (DEC-035 rules out zones).
**Why it matters:** the simplest bound on unbounded rider cost.

| Option | Description |
|---|---|
| **A** | 15 km — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | 10 km — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | No radius; rely on the delivery-fee maximum |

**Recommended candidate:** Option A or B — but **the choice should follow from Buntharik's actual geography**, which this pack cannot assess. A radius that excludes the villages BANHAO intends to serve defeats the purpose.
**Economic effect:** bounds the worst-case rider cost. **Customer effect:** outside the radius, no service exists. **Merchant effect:** determines each restaurant's catchment. **Rider effect:** bounds trip length. **Engineering effect:** LOW as a check — **but it requires distance (D-16)**. **Operational risk:** Option C leaves rider cost unbounded in principle.
**Before activation:** **distance must be computable.** Without it this decision cannot be enforced at all.
**Superseding DEC required:** **Yes — DEC-035** (which rules out zones and distance).
`OWNER DECISION REQUIRED`

---

### D-13 — Minimum order value

**Current locked state:** none.
**Why it matters:** an alternative to the contribution floor for excluding uneconomic small orders — blunter, but far easier to explain to a customer.

| Option | Description |
|---|---|
| **A** | No minimum — rely on the contribution floor (D-11) |
| **B** | ฿40 minimum — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | ฿60 minimum — `OWNER CANDIDATE — NOT LOCKED` |

**Recommended candidate:** Option A. The contribution floor is the more precise instrument — it rejects exactly the uneconomic orders rather than a whole price band, and §3.2 shows ฿40 orders can be perfectly viable at the right delivery fee.
**Economic effect:** overlaps D-11; using both risks rejecting viable orders twice. **Customer effect:** "minimum order ฿60" is far easier to communicate than a contribution refusal. **Merchant effect:** may raise average basket, or lose the customer. **Rider effect:** fewer small trips. **Engineering effect:** LOW. **Operational risk:** double-gating with D-11 without intending to.
**Before activation:** decide interaction with D-11 explicitly.
**Superseding DEC required:** **No** — new decision.
`OWNER DECISION REQUIRED`

---

### D-14 — Promotion policy

**Current locked state:** DEC-046 — `PLATFORM` or `MERCHANT` per promotion, **no split**. `discount_satang` is always 0 today.
**Why it matters:** a platform-funded promotion is the one routine way an order can breach the floor (§7).

| Option | Description |
|---|---|
| **A** | Merchant-funded only — BANHAO contribution never affected |
| **B** | Allow platform-funded, capped so the floor always holds — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | Allow platform-funded to breach the floor under an explicit, separately-approved campaign policy |

**Recommended candidate:** Option B. It preserves marketing capability while keeping the guardrail structurally intact. Option C should require its own decision and its own budget, never a configuration toggle.
**Economic effect:** §7 — a ฿10 platform-funded discount cut contribution from ฿16.48 to ฿6.64, breaching a ฿8 floor; the maximum that preserves it was ฿8.62. **Customer effect:** promotions drive adoption, which matters at launch. **Merchant effect:** Option A shifts all promotional cost to merchants. **Rider effect:** none. **Engineering effect:** MEDIUM — promotion must be evaluated *inside* pricing, plus a ledger posting for `PROMOTION_FUNDING` (an account that exists and has never been written). **Operational risk:** an uncapped platform promotion is the fastest way to make the guardrail meaningless.
**Before activation:** promotion ledger accounting decided; BQ-030 stacking is separate and remains open.
**Superseding DEC required:** **Only for Option C**, or if `SHARED` funding is enabled — then **DEC-046**.
`OWNER DECISION REQUIRED`

---

### D-15 — Settlement cadence

**Current locked state:** none. **No settlement or payout exists in any form** — no table, no service, no code.
**Why it matters:** determines working capital, refund-netting ability, and merchant/rider trust.

| Option | Description |
|---|---|
| **A** | Weekly — `OWNER CANDIDATE — NOT LOCKED` |
| **B** | Daily — `OWNER CANDIDATE — NOT LOCKED` |
| **C** | On-demand with a minimum threshold |

**Recommended candidate:** Option A for launch. Weekly gives the widest refund-netting window while BANHAO's refund rate is unknown, and is the simplest to operate manually at low volume.
**Economic effect:** at ~100 orders/day, weekly settlement means roughly **฿70,000–73,000** of third-party money held at any time — working capital BANHAO did not raise, and an obligation it must always be able to meet. **Customer effect:** none. **Merchant effect:** significant — small restaurants may need faster cash. **Rider effect:** significant — riders typically expect fast payment; weekly may be unacceptable. **Engineering effect:** HIGH — the entire settlement domain is unbuilt. **Operational risk:** holding funds is exactly the activity Q-002's custody question covers.
**Before activation:** **Q-002 locked; legal review of fund custody and settlement obligations complete.**
**Superseding DEC required:** **No** — new decision, but **gated on Q-002**.
`OWNER DECISION REQUIRED`

---

### D-16 — Distance source

**Current locked state:** none. `addresses.lat`/`lng` are NULL in practice; `orders.distance_m` is never populated. **Distance is not computable today.**
**Why it matters:** **this is the hard blocker.** Decisions D-07, D-08, D-10 and D-12 are all unenforceable without it.

| Option | Description |
|---|---|
| **A** | Geocode addresses via an external provider, compute road or straight-line distance |
| **B** | Merchant/customer-declared distance bands |
| **C** | Operator-assigned zones |

**Recommended candidate:** Option A if a provider with adequate Thai rural coverage can be found; **Option B or C is a legitimate fallback** and should not be dismissed — prior BANHAO research recorded that no provider publishes district-level accuracy for Thailand, which is precisely why DEC-035 chose a flat fee in the first place.
**Economic effect:** without distance, only flat delivery pricing is possible. **Customer effect:** address capture becomes more demanding. **Merchant effect:** none. **Rider effect:** determines whether pay reflects real effort. **Engineering effect:** **HIGH** — geocoding, `distance_m` population, and address-capture UI all new. **Operational risk:** a wrong distance produces a wrong price and a wrong rider payment.
**Before activation:** provider evaluated against **Buntharik** addresses specifically, not national averages.
**Superseding DEC required:** **Yes — DEC-035.**
`OWNER DECISION REQUIRED`

---

### D-17 — Distance accuracy policy

**Current locked state:** none.
**Why it matters:** an estimate at pricing time will sometimes be wrong; somebody must absorb the difference.

| Option | Description |
|---|---|
| **A** | BANHAO absorbs the variance; the customer price is fixed at checkout |
| **B** | Rider is paid on actual distance; BANHAO absorbs only the delta |
| **C** | Re-price before acceptance if actual differs beyond a tolerance |

**Recommended candidate:** Option A for launch — a fixed quoted price is far better for customer trust — with the variance measured (§9) so the base and per-km parameters can be corrected from evidence rather than argument.
**Economic effect:** Option A puts estimation error entirely on BANHAO; this is a genuine post-acceptance loss source (§6.3). **Customer effect:** Option A gives price certainty; Option C creates confusing re-quotes. **Rider effect:** Option B is fairest to riders. **Merchant effect:** none. **Engineering effect:** LOW (A), MEDIUM (B), HIGH (C). **Operational risk:** without measurement, systematic underestimation would silently erode margin.
**Before activation:** D-16 decided; variance must be observable.
**Superseding DEC required:** **No** — new decision.
`OWNER DECISION REQUIRED`

---

### D-18 — Configuration activation authority

**Current locked state:** none. `platform_staff.staff_role` ∈ {`OPERATOR`, `ADMIN`}. No configuration system exists.
**Why it matters:** whoever activates a pricing configuration can change BANHAO's economics without a deployment.

| Option | Description |
|---|---|
| **A** | `ADMIN` only, with a mandatory reason |
| **B** | `OPERATOR` may draft; `ADMIN` validates and activates |
| **C** | Any staff member may activate |

**Recommended candidate:** Option B. It separates authorship from authorization — the same two-person discipline DEC-058 applies to refunds — while letting operators prepare changes.
**Economic effect:** none directly; it governs who can change everything else. **Customer/Merchant/Rider effect:** indirect but total. **Engineering effect:** LOW — reuses `@Roles`, `CapabilitiesService`, `audit_logs`. **Operational risk:** Option C is unacceptable for a financial control; a mis-activated configuration changes every subsequent order's economics.
**Before activation:** validation rules and the scenario grid (§9) must exist first — activation authority is meaningless without something that can refuse a bad configuration.
**Superseding DEC required:** **No** — new decision. **AI has no authority here under any option** (DEC-040).
`OWNER DECISION REQUIRED`

---

### D-19 — Mid-checkout configuration-version behaviour

**Current locked state:** none — the situation cannot arise today because pricing is constant.
**Why it matters:** a customer must not see one price and be charged another.

| Option | Description |
|---|---|
| **A** | Honour the pinned version for a bounded window (e.g. checkout TTL) |
| **B** | Re-price under the new version; require re-confirmation if the total changed |
| **C** | Reject the checkout and force a restart |

**Recommended candidate:** Option A. Pricing configuration changes will be rare; honouring a quoted price for a short window is both the best customer experience and the easiest behaviour to explain.
**Economic effect:** negligible — a bounded window on rare events. **Customer effect:** Option A is honest and predictable; Option C is hostile. **Merchant/Rider effect:** none. **Engineering effect:** MEDIUM — version pinning plus mandatory server-side revalidation before order creation. **Operational risk:** without pinning, a customer could be charged a price they never saw.
**Before activation:** the version pin must be carried through checkout and the snapshot written atomically with the order.
**Superseding DEC required:** **No** — new decision.
`OWNER DECISION REQUIRED`

---

## 8A. Decision Preparation Analysis — D-03 / D-04 (Service Fee)

```
DECISION PREPARATION / ANALYSIS ONLY
D-03 AND D-04 ARE NOT LOCKED BY THIS SECTION
ALL VALUES ILLUSTRATIVE ONLY — NOT LOCKED
```

Expands D-03 and D-04 above with full arithmetic. It supersedes nothing, decides
nothing, and does not alter the D-03/D-04 entries in §8 — those remain
`OWNER DECISION REQUIRED`.

### 8A.1 Candidate definitions

| ID | Model | Definition |
|---|---|---|
| **A** | Fixed | ฿5 per order — **the current locked behaviour (DEC-036)** |
| **B** | Percentage | 5% of food subtotal, uncapped |
| **C** | Percentage with cap | 5% of food subtotal, capped at ฿10 / ฿15 / ฿20 (D-04) |
| **D** | **Collar — percentage with floor *and* cap** | 5% of food subtotal, floor ฿5, cap ฿15 |

**Option D is not invented for this analysis.** The architecture spec's §4.2
already carries `service_fee_floor_satang` alongside `service_fee_cap_satang`,
so a floor-and-cap collar is an expressible configuration of the parameter
model as specified. It is included because the arithmetic below shows it
materially changes the guardrail outcome.

### 8A.2 Calculation assumptions

`ILLUSTRATIVE ONLY — NOT LOCKED` throughout.

| Input | Value | Status |
|---|---|---|
| Merchant commission | 10% of food subtotal | **Approved owner direction (D-01)** — analysis context only, not an implemented or newly locked value |
| Commission rounding | Existing whole-baht behaviour preserved | **Approved owner direction (D-02)** |
| Delivery fee | ฿17.50 (Normal, 5 km) unless a distance is named | Candidate, per §2 |
| Rider payout | ฿14 (= 80% of ฿17.50) | Candidate |
| Retained delivery margin | ฿3.50 (= 20% of ฿17.50) | Candidate |
| Payment processing cost | 1.65% of customer total | **DEC-055 clause 3 assumption** — not a contracted rate |

```
Customer total  = Food + Delivery + Service
BANHAO revenue  = 0.10 × Food + Service + 0.20 × Delivery
Contribution    = revenue − 0.0165 × customer total
```

**Terminology, used strictly below.** *Service fee revenue* is the service-fee
component alone. *Total BANHAO contribution* is revenue minus all BANHAO costs.
*Contribution share* is contribution ÷ customer total. **None of these is a
marketplace take rate**, which would measure BANHAO's cut of gross merchandise
value under a defined marketplace structure — a structure Q-002 has not yet
settled. The term "take rate" is deliberately not used in this section.

### 8A.3 Comparison matrix

Delivery held at ฿17.50 to isolate the service-fee variable.

| Food | A svc | **A contrib** | B svc | **B contrib** | C฿15 svc | **C฿15 contrib** | C฿20 svc | **C฿20 contrib** |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ฿40 | ฿5.00 | **฿11.47** | ฿2.00 | **฿8.52** | ฿2.00 | **฿8.52** | ฿2.00 | **฿8.52** |
| ฿60 | ฿5.00 | **฿13.14** | ฿3.00 | **฿11.17** | ฿3.00 | **฿11.17** | ฿3.00 | **฿11.17** |
| ฿80 | ฿5.00 | **฿14.81** | ฿4.00 | **฿13.83** | ฿4.00 | **฿13.83** | ฿4.00 | **฿13.83** |
| ฿100 | ฿5.00 | **฿16.48** | ฿5.00 | **฿16.48** | ฿5.00 | **฿16.48** | ฿5.00 | **฿16.48** |
| ฿150 | ฿5.00 | **฿20.65** | ฿7.50 | **฿23.11** | ฿7.50 | **฿23.11** | ฿7.50 | **฿23.11** |
| ฿200 | ฿5.00 | **฿24.83** | ฿10.00 | **฿29.75** | ฿10.00 | **฿29.75** | ฿10.00 | **฿29.75** |
| ฿300 | ฿5.00 | **฿33.18** | ฿15.00 | **฿43.01** | ฿15.00 | **฿43.01** | ฿15.00 | **฿43.01** |
| ฿500 | ฿5.00 | **฿49.88** | ฿25.00 | **฿69.55** | ฿15.00 | **฿59.71** | ฿20.00 | **฿64.63** |

**Option D (collar, floor ฿5 / cap ฿15):**

| Food | ฿40 | ฿60 | ฿80 | ฿100 | ฿150 | ฿200 | ฿300 | ฿500 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Service fee | ฿5.00 | ฿5.00 | ฿5.00 | ฿5.00 | ฿7.50 | ฿10.00 | ฿15.00 | ฿15.00 |
| **Contribution** | **฿11.47** | **฿13.14** | **฿14.81** | **฿16.48** | **฿23.11** | **฿29.75** | **฿43.01** | **฿59.71** |

**Cap binding thresholds:** ฿10 binds above ฿200 food · ฿15 binds above ฿300 ·
฿20 binds above ฿400. Below the threshold a cap is inert, so C is identical to
B for every basket in the ฿40–฿300 range at ฿15 or ฿20.

### 8A.4 Economic sensitivity

**The crossover is exactly ฿100 of food** — where 5% equals ฿5 by construction.

| Food | B minus A, contribution | B minus A, customer pays |
|---:|---:|---:|
| ฿40 | **−฿2.95** | −฿3.00 |
| ฿60 | **−฿1.97** | −฿2.00 |
| ฿80 | **−฿0.98** | −฿1.00 |
| ฿100 | ฿0.00 | ฿0.00 |
| ฿150 | +฿2.46 | +฿2.50 |
| ฿200 | +฿4.92 | +฿5.00 |
| ฿300 | +฿9.84 | +฿10.00 |
| ฿500 | +฿19.67 | +฿20.00 |

**This is the finding that matters most, and it runs against the intuition
elsewhere in this pack.** A percentage service fee is **worse** for BANHAO on
every basket under ฿100 — by ฿2.95 on a ฿40 order — and better only above it.
The earlier framing in §5 ("fixed favours BANHAO below ฿100") was directionally
right but its consequence for the guardrail was not drawn out.

**Contribution share by basket:**

| Food | A | B | C฿15 |
|---:|---:|---:|---:|
| ฿40 | 18.35% | 14.32% | 14.32% |
| ฿100 | 13.45% | 13.45% | 13.45% |
| ฿300 | 10.29% | 12.94% | 12.94% |
| ฿500 | 9.55% | 12.82% | 11.21% |

Fixed produces a *declining* share as baskets grow; percentage produces a
near-flat one. Flatness is the percentage model's genuine structural argument —
but flatness alone does not protect the small-basket floor.

### 8A.5 Customer impact

| Basket class | A (fixed ฿5) | B / C (5%) | D (collar) |
|---|---|---|---|
| **Low — ฿40, ฿60** | Heaviest: ฿5 on a ฿40 order is **12.5% of the food value**; the most visible fee in the basket | Lightest: ฿2 on ฿40 | Same as today (฿5) — no change from the customer's current experience |
| **Normal — ฿80–฿150** | ฿5, familiar | ฿4–฿7.50 | ฿5–฿7.50 |
| **Larger — ฿200–฿300** | ฿5, cheap | ฿10–฿15 | ฿10–฿15 |
| **Very large — ฿500** | ฿5 | **฿25 — the poor-perception case** | ฿15 (capped) |

**The poor-perception case is Option B, uncapped, on large baskets.** A ฿500
family order paying ฿25 for the same payment handling and support a ฿60 order
receives for ฿3 is the hardest fee in this analysis to defend, and the easiest
place for a competitor to undercut. **Any cap removes it**; ฿15 removes it from
฿300 upward.

The mirror-image objection applies to Option A: ฿5 on a ฿40 basket is 12.5% of
the food value, which is the heaviest *relative* fee any customer in this
analysis pays. Neither fixed nor percentage is uniformly fairer — they are
regressive in opposite directions.

### 8A.6 Refund and accounting impact (Q-020 / DEC-048 / DEC-059)

**No candidate model creates a new refund or accounting concern.** Verified
against the implementation:

- `orders.service_fee_satang` stores an **amount, never a rate**, and is
  protected by the live `orders_enforce_immutable_columns` trigger.
- `PaymentEventProcessingService` posts `SERVICE_FEE_REVENUE` by reading
  `orders.service_fee_satang` (`+fee` to `PLATFORM_REVENUE`, DEC-047).
- `RefundLedgerReversalService` reverses by reading **the same stored column**
  (`−fee`), never a configuration value and never a recomputation — asserted by
  the existing test *"uses the exact original `orders.service_fee_satang`,
  negated, never recalculated"* and by *"original `SERVICE_FEE_REVENUE` (+fee)
  plus this reversal (−fee) sums to zero"*.
- `RefundReconciliationDetectorService` independently verifies the same
  expected entry from the same column.

**Therefore the historical-economics invariant holds identically under A, B, C
and D.** An order priced under a fixed-฿5 configuration reverses ฿5 forever,
even after a percentage configuration is activated; an order priced at 5%
reverses its own stored amount. DEC-048 (service fee included in an eligible
full refund) and DEC-059 clause B (reverse the original snapshot) are satisfied
without modification by every candidate.

**One second-order difference worth recording — refund exposure scales:**

| Food | A reverses | B reverses | C฿15 / D reverses |
|---:|---:|---:|---:|
| ฿40 | ฿5.00 | ฿2.00 | ฿5.00 (D) / ฿2.00 (C) |
| ฿100 | ฿5.00 | ฿5.00 | ฿5.00 |
| ฿300 | ฿5.00 | ฿15.00 | ฿15.00 |
| ฿500 | ฿5.00 | ฿25.00 | ฿15.00 |

A refunded large order returns more recognized revenue under a percentage
model. This is correct accounting, not a defect — but it means **a cap also
bounds refund exposure**, which is a modest additional argument for one.

**Rounding:** percentage models produce fractional satang at non-round
subtotals (5% of ฿60.50 = 302.5 satang). A rounding rule is required — already
specified as a configuration parameter in the architecture spec (§12 R8, and
`service_fee_rounding_rule` in §4.2). Option A never encounters this. This is a
known prerequisite, not a new problem.

### 8A.7 Promotion impact

Platform-funded ฿10 discount, delivery ฿17.50:

| Food | A contribution | B contribution |
|---:|---:|---:|
| ฿40 | **+฿1.63** | **−฿1.32** ⚠️ |
| ฿100 | +฿6.64 | +฿6.64 |
| ฿300 | +฿23.34 | +฿33.18 |

**A ฿40 basket with a ฿10 platform-funded promotion goes negative under the
pure percentage model and stays positive under fixed ฿5.** This is the same
small-basket weakness as §8A.4, amplified: the percentage model collects ฿3
less fee exactly where a platform-funded discount is most likely to be offered
(customer acquisition on small first orders).

Under the guardrail this order would be **refused**, not silently absorbed
(§7's required behaviour) — so it is not a loss, but it *is* a lost order. The
service-fee model therefore directly determines how much promotional headroom
BANHAO has on small baskets.

### 8A.8 Interaction with the minimum-safe-contribution guardrail

This is the decisive dimension. Headroom at the tightest cells (smallest
basket, each candidate distance), against a candidate ฿8 floor:

| Food | Distance | A headroom | B headroom | D headroom |
|---:|---|---:|---:|---:|
| ฿40 | 2 km | **+฿3.01** | **+฿0.06** ⚠️ | **+฿3.01** |
| ฿40 | 5 km | +฿3.47 | +฿0.52 | +฿3.47 |
| ฿40 | 10 km | +฿4.84 | +฿1.89 | +฿4.84 |
| ฿40 | 15 km | +฿6.22 | +฿3.27 | +฿6.22 |
| ฿60 | 2 km | +฿4.68 | +฿2.71 | +฿4.68 |

**Under Option B the ฿8 floor's worst-case headroom is ฿0.0595** — the same
razor-thin margin the arithmetic audit flagged in D-11, and it is *caused by*
the percentage service fee. Under A or D the same cell clears by ฿3.01, roughly
fifty times the margin.

Against D-11's recommended ฿5 floor, Option B's worst cell clears by ฿3.06 and
A/D by ฿6.01 — comfortable under either, but the ordering is unchanged.

**The interaction, stated plainly:** the service-fee model does not change the
guardrail, but it changes how often the guardrail fires. A percentage fee makes
small-basket orders marginal; a floor (fixed ฿5 or a collar) keeps them clear.
**This does not redesign the guardrail** — it is an input to choosing D-11's
floor sensibly alongside D-03.

### 8A.9 Recommended option

**D-03 recommended candidate: Option D — 5% of food subtotal with a ฿5 floor
and a ฿15 cap.** `OWNER CANDIDATE — NOT LOCKED`

**D-04 recommended cap: ฿15.** `OWNER CANDIDATE — NOT LOCKED`

Reasoning against each required criterion:

| Criterion | Why Option D |
|---|---|
| **Contribution protection** | Matches fixed ฿5 exactly below ฿100 — the region where the guardrail is tightest — preserving ฿3.01 headroom at the worst cell instead of ฿0.06 |
| **Customer price fairness** | Small baskets pay no more than today (฿5, unchanged); large baskets are capped at ฿15, removing the ฿25-on-฿500 perception problem |
| **Scalability with order value** | Scales with basket between ฿100 and ฿300, capturing the ฿9.84 gain on a ฿300 order that fixed ฿5 forgoes |
| **Dynamic delivery compatibility** | Fully independent — service fee is computed from food subtotal, delivery from rider cost; no coupling in either direction |
| **Promotion economics** | Preserves positive contribution on the ฿40 + ฿10-promotion case that pure percentage turns negative |
| **Refund simplicity** | Identical to every other model — reverses the stored `service_fee_satang`; the cap additionally bounds refund exposure at ฿15 |
| **Implementation simplicity** | Uses parameters the architecture spec §4.2 already defines (`service_fee_mode`, `_rate_basis_points`, `_floor_satang`, `_cap_satang`); no new concept |
| **Auditability** | A single stored satang amount per order, snapshot-recorded and immutable — unchanged from today |

**Honest cost of this recommendation:** Option D is the most complex to explain
— "5%, minimum ฿5, maximum ฿15" is three numbers where today there is one. If
the owner values a fee a customer can state from memory, **Option A (keep fixed
฿5) is entirely defensible**: it is the strongest small-basket performer, needs
no supersession, needs no rounding rule, and forgoes only the large-basket
upside. Option D is recommended on economics; Option A wins on simplicity.

**Option B (uncapped percentage) is not recommended** on any reading: it is
weakest exactly where the guardrail is tightest, and worst on customer
perception at the top of the range.

### 8A.10 Owner decision statement

> **D-03 — Service fee model.** Choose one: **A** keep fixed ฿5 (no
> supersession, simplest) · **B** 5% uncapped (not recommended) · **C** 5%
> capped · **D** 5% with ฿5 floor and ฿15 cap (recommended on economics).
>
> **D-04 — Service fee cap.** Applicable only if B, C or D is chosen. Candidate
> values: none / ฿10 / **฿15 (recommended)** / ฿20.
>
> Both remain `OWNER DECISION REQUIRED`. Neither is locked by this analysis.

### 8A.11 Required supersession note

**Reported for the later Decision Lock step only. `docs/DECISIONS.md` and
DEC-036 are NOT edited by this analysis.**

**If the owner selects Option A (keep fixed ฿5):** **no supersession is
required** for D-03 or D-04. DEC-036 stands unchanged, and D-04 is moot.

**If the owner selects B, C or D:** **DEC-036 must be superseded.** Its current
text rules out precisely these models by name — a fixed ฿5 service fee, "not a
percentage, not a percentage with a cap or a minimum, not tiered". A superseding
decision would need to state, at minimum:

1. The new service-fee model (percentage, and whether a floor and/or cap apply).
2. The rate in basis points, and the floor/cap amounts in integer satang.
3. The rounding rule for the percentage calculation, since a fixed fee never
   required one (consistent with DEC-043's own rounding precedent).
4. That **DEC-047** (recognition timing at payment success) and **DEC-048**
   (service fee included in an eligible full refund) are **applied unchanged** —
   this decision changes the *amount*, never the recognition point or the
   refundability.
5. That **DEC-059 clause B** is **unaffected**: reversal continues to read the
   original `orders.service_fee_satang` snapshot, so historical orders keep
   their original economics permanently.
6. That the value is thereafter carried in versioned pricing configuration
   rather than as a code constant, per the architecture spec.

**Also affected, and to be noted in the same lock:** `SAMPLE_SERVICE_FEE_SATANG
= 500` in `apps/customer/src/mocks/pricing.ts` currently matches DEC-036 and
would diverge under B, C or D.

---

## 8B. Decision Preparation Analysis — D-05 to D-10 + D-12 (Rider / Delivery Economics)

```
DECISION PREPARATION / ANALYSIS ONLY
D-05, D-06, D-07, D-08, D-09, D-10 AND D-12 ARE NOT LOCKED BY THIS SECTION
ALL VALUES ILLUSTRATIVE ONLY — NOT LOCKED
```

Expands the rider and delivery decisions in §8 with full arithmetic. It
supersedes nothing, decides nothing, and does not alter the §8 entries — those
remain `OWNER DECISION REQUIRED`.

### 8B.1 Model and calculation assumptions

```
R(km)          = base + per_km × km
EffectiveRider = MAX(R(km), RiderFloor)
RawFee         = EffectiveRider ÷ RiderShare
DeliveryFee    = CLAMP(RawFee, DeliveryMin, DeliveryMax)
RiderTopUp     = MAX(0, EffectiveRider − RiderShare × DeliveryFee)
DeliveryMargin = DeliveryFee − EffectiveRider
```

Revenue context, **owner-approved direction and owner candidates only — not
implementation locks**: commission **10%** (D-01), service fee **5% with ฿5
floor and ฿15 cap** (D-03/D-04 candidate, `NOT LOCKED`), payment cost **1.65%**
(DEC-055 clause 3 assumption).

```
Contribution = 0.10×Food + ServiceFee + DeliveryMargin − Promotion − 0.0165×CustomerTotal
```

**Consistency note against earlier arithmetic in this pack.** §3.2's matrix was
computed with a *pure* 5% service fee (no floor). §8B uses the §8A collar
candidate, which pays ฿5 on baskets below ฿100. The ฿40/2 km cell therefore
reads **฿11.01 here versus ฿8.06 in §3.2**. This is a **change of input, not a
contradiction** — §3.2 remains arithmetically correct for the model it states.
Reported explicitly rather than silently reconciled.

### 8B.2 D-05 — Rider share

Base ฿8, ฿1.20/km, floor ฿12, min ฿15, max ฿35. Customer fee / BANHAO margin:

| Share | 2 km | 5 km | 10 km | 15 km | Margin as multiple of rider pay |
|---|---|---|---|---|---|
| 70% | ฿17.14 / ฿5.14 | ฿20.00 / ฿6.00 | ฿28.57 / ฿8.57 | ฿35.00 / ฿9.00 | 0.4286× |
| 75% | ฿16.00 / ฿4.00 | ฿18.67 / ฿4.67 | ฿26.67 / ฿6.67 | ฿34.67 / ฿8.67 | 0.3333× |
| **80%** | **฿15.00 / ฿3.00** | **฿17.50 / ฿3.50** | **฿25.00 / ฿5.00** | **฿32.50 / ฿6.50** | **0.2500×** |
| 85% | ฿15.00 / ฿3.00 | ฿16.47 / ฿2.47 | ฿23.53 / ฿3.53 | ฿30.59 / ฿4.59 | 0.1765× |
| 90% | ฿15.00 / ฿3.00 | ฿15.56 / ฿1.56 | ฿22.22 / ฿2.22 | ฿28.89 / ฿2.89 | 0.1111× |

**Where the margin becomes too thin — the decisive test.** Delivery margin net
of the payment cost it itself generates, at 10 km:

| Share | Gross margin | Payment cost on fee | **Net delivery margin** |
|---|---:|---:|---:|
| 70% | ฿8.57 | ฿0.47 | ฿8.10 |
| 75% | ฿6.67 | ฿0.44 | ฿6.23 |
| **80%** | ฿5.00 | ฿0.41 | **฿4.59** |
| 85% | ฿3.53 | ฿0.39 | ฿3.14 |
| 90% | ฿2.22 | ฿0.37 | **฿1.86** |

**At 90% the delivery leg nets ฿1.86 on a 10 km trip** — less than a single ฿2
operational leakage event, and far less than any platform-funded promotion. At
85% it nets ฿3.14, which survives normal operation but not a ฿5 promotion. **80%
is the last share at which the delivery leg alone can absorb a modest promotion
or a small operational cost without going negative.** Below 80%, the customer
fee rises sharply for no rider benefit — 70% charges ฿17.14 at 2 km where 80%
charges ฿15.00.

**Recommended: 80%.** `OWNER CANDIDATE — NOT LOCKED`

### 8B.3 D-06 — Rider floor

Base ฿8, ฿1.20/km, share 80%:

| Floor | Binds below | Implied minimum customer fee | Rider at 0–2 km | vs DEC-044's ฿12 |
|---|---|---:|---:|---|
| ฿10 | 1.67 km | ฿12.50 | ฿10.00 | **฿2 less than today** |
| **฿12** | 3.33 km | **฿15.00** | **฿12.00** | **parity** |
| ฿15 | 5.83 km | ฿18.75 | ฿15.00 | ฿3 more |

**฿10 pays riders less than the currently locked DEC-044 amount** for every
short trip — launching a new model that cuts short-hop pay is the fastest way
to lose rider supply in a district with few riders. **฿15 forces every delivery
fee to at least ฿18.75**, an 87.5% jump over today's ฿10 flat fee, which lands
hardest on exactly the short in-town orders that should be cheapest.

**฿12 is the only candidate that changes nothing for riders while the rest of
the model changes around them** — a genuine advantage when introducing a new
compensation formula.

**Recommended: ฿12.** `OWNER CANDIDATE — NOT LOCKED`

### 8B.4 D-07 — Rider base

฿1.20/km, floor ฿12, share 80%. Effective rider / customer fee:

| Base | 0 km | 1 km | 2 km | 5 km | 10 km | 15 km | Floor binds below |
|---|---|---|---|---|---|---|---|
| ฿6 | ฿12 / ฿15.00 | ฿12 / ฿15.00 | ฿12 / ฿15.00 | ฿12 / ฿15.00 | ฿18 / ฿22.50 | ฿24 / ฿30.00 | 5.00 km |
| **฿8** | ฿12 / ฿15.00 | ฿12 / ฿15.00 | ฿12 / ฿15.00 | **฿14 / ฿17.50** | ฿20 / ฿25.00 | ฿26 / ฿32.50 | **3.33 km** |
| ฿10 | ฿12 / ฿15.00 | ฿12 / ฿15.00 | ฿12.40 / ฿15.50 | ฿16 / ฿20.00 | ฿22 / ฿27.50 | ฿28 / ฿35.00 | 1.67 km |

0 km is an economic reference point only, not a routing claim.

**The base determines where the floor stops binding**, which is the real
decision. At ฿6 the floor absorbs everything under 5 km — meaning distance is
uncompensated across most in-town deliveries, and a 4.9 km trip pays the same
as a 0.5 km trip. At ฿10 the floor barely functions (1.67 km) and the fee at
15 km hits ฿35, exactly the candidate maximum, leaving no headroom.

**฿8 places the transition at 3.33 km** — short in-town trips are floor-protected,
and distance compensation begins where distance genuinely starts costing the
rider.

**Recommended: ฿8.** `OWNER CANDIDATE — NOT LOCKED`

### 8B.5 D-08 — Rider per-kilometre

Base ฿8, floor ฿12, share 80%, max ฿35. Customer fee, `*` = clamp binding,
`tu` = rider top-up BANHAO absorbs:

| Per-km | 1 km | 2 km | 5 km | 10 km | 15 km | 18 km | 20 km | Clamp at |
|---|---|---|---|---|---|---|---|---|
| ฿0.80 | ฿15.00 | ฿15.00 | ฿15.00 | ฿20.00 | ฿25.00 | ฿28.00 | ฿30.00 | 25.00 km |
| ฿1.00 | ฿15.00 | ฿15.00 | ฿16.25 | ฿22.50 | ฿28.75 | ฿32.50 | ฿35.00 | 20.00 km |
| **฿1.20** | ฿15.00 | ฿15.00 | ฿17.50 | ฿25.00 | ฿32.50 | ฿35.00\* tu฿1.60 | ฿35.00\* tu฿4.00 | **16.67 km** |
| ฿1.50 | ฿15.00 | ฿15.00 | ฿19.38 | ฿28.75 | ฿35.00\* **tu฿2.50** | ฿35.00\* tu฿7.00 | ฿35.00\* tu฿10.00 | 13.33 km |
| ฿2.00 | ฿15.00 | ฿15.00 | ฿22.50 | ฿35.00 | ฿35.00\* **tu฿10.00** | ฿35.00\* tu฿16.00 | ฿35.00\* tu฿20.00 | 10.00 km |

**The governing constraint is that the clamp distance must exceed the service
radius.** At ฿1.50/km the ฿35 maximum binds at 13.33 km — **inside a 15 km
radius**, so every 13.3–15 km order carries a guaranteed top-up (฿2.50 at the
edge). At ฿2.00/km it binds at 10 km, producing a ฿10 top-up at the radius edge.
**Both are structurally broken configurations**, and are exactly what the
architecture spec's validation rule V7 exists to reject.

฿0.80/km leaves distance materially under-compensated: a 10 km trip pays the
rider ฿16 against ฿20 at ฿1.20/km. **฿1.20/km clamps at 16.67 km, safely beyond
a 15 km radius**, and pays ฿20 at 10 km — the same amount the illustrative
MEDIUM rider model in §2 assumes a 10 km trip actually costs.

**Recommended: ฿1.20/km.** `OWNER CANDIDATE — NOT LOCKED`

### 8B.6 D-09 — Minimum customer delivery fee

Base ฿8, floor ฿12, share 80% → the raw fee at short distance is
`฿12 ÷ 0.80 = ฿15.00`. Tested at ฿40 food, 2 km:

| Min | Fee charged | Rider needs | Share pays | Top-up | Margin | Contribution |
|---|---:|---:|---:|---:|---:|---:|
| ฿10 | ฿15.00 | ฿12.00 | ฿12.00 | ฿0 | ฿3.00 | ฿11.01 |
| ฿12 | ฿15.00 | ฿12.00 | ฿12.00 | ฿0 | ฿3.00 | ฿11.01 |
| **฿15** | **฿15.00** | ฿12.00 | ฿12.00 | ฿0 | ฿3.00 | **฿11.01** |
| ฿18 | ฿18.00 | ฿12.00 | ฿14.40 | ฿0 | ฿6.00 | ฿13.96 |

**฿10 and ฿12 are inert** — the derived fee already exceeds them, so they never
bind and provide no protection. **฿18 binds upward**, charging the customer ฿3
more than the rider requirement justifies; it improves contribution but is a
price increase disguised as a safety rail.

**฿15 is the only value that is exactly consistent with D-05 and D-06 by
construction** (`floor ÷ share`). It guarantees no top-up can ever arise from
the short-distance case, without ever inflating the fee above what the formula
already produces. If D-05 or D-06 change, this value must be recomputed as
`RiderFloor ÷ RiderShare` — it is a **derived** parameter, not an independent one.

**Recommended: ฿15.** `OWNER CANDIDATE — NOT LOCKED`

### 8B.7 D-10 — Maximum customer delivery fee

Base ฿8, ฿1.20/km, floor ฿12, share 80%:

| Max | Clamps at | 15 km | 18 km | 20 km |
|---|---|---|---|---|
| ฿30 | **13.33 km** | ฿30.00, **top-up ฿2.00** | ฿30.00, top-up ฿5.60 | ฿30.00, top-up ฿8.00 |
| **฿35** | **16.67 km** | ฿32.50, no top-up | ฿35.00, top-up ฿1.60 | ฿35.00, top-up ฿4.00 |
| ฿40 | 20.00 km | ฿32.50, no top-up | ฿37.00, no top-up | ฿40.00, no top-up |
| ฿50 | 26.67 km | ฿32.50, no top-up | ฿37.00, no top-up | ฿40.00, no top-up |

**฿30 clamps at 13.33 km, inside the candidate 15 km radius** — a structurally
inconsistent pairing that guarantees a top-up on every long order. **฿35 clamps
at 16.67 km, just beyond a 15 km radius**, so the maximum never binds inside the
service area while still capping the customer's worst case. ฿40 and ฿50 give
more headroom but permit customer-visible fees the market is unlikely to accept
— ฿40 on a ฿60 basket is two-thirds of the food value.

**The maximum's real job is to bound customer price, not to protect BANHAO** —
BANHAO is protected by the radius. It should therefore be set just above the fee
derived at the radius edge (฿32.50), not far above it.

**Recommended: ฿35.** `OWNER CANDIDATE — NOT LOCKED` — and it **must be
re-derived** if D-08 or D-12 change.

### 8B.8 D-12 — Maximum delivery radius

Base ฿8, ฿1.20/km, floor ฿12, share 80%, max ฿35. Conditions at the radius edge:

| Radius | Edge fee | Rider needs | Top-up | Margin | Contribution (฿100 food) | Status |
|---|---:|---:|---:|---:|---:|---|
| 10 km | ฿25.00 | ฿20.00 | ฿0 | ฿5.00 | ฿17.86 | OK |
| 12 km | ฿28.00 | ฿22.40 | ฿0 | ฿5.60 | ฿18.41 | OK |
| **15 km** | **฿32.50** | ฿26.00 | **฿0** | ฿6.50 | **฿19.23** | **OK** |
| 18 km | ฿35.00 | ฿29.60 | **฿1.60** | ฿5.40 | ฿18.09 | **TOP-UP** |
| 20 km | ฿35.00 | ฿32.00 | **฿4.00** | ฿3.00 | ฿15.69 | **TOP-UP** |

**15 km is the largest radius at which the ฿35 maximum never binds** — the exact
boundary of the configuration's internal consistency. Beyond it BANHAO begins
subsidising riders on every edge delivery.

The radius is not only an economic decision: it also drives ETA, cancellation and
failure exposure, and customer willingness to pay. §8B.11 shows the customer-side
limit arrives *earlier* than the economic one.

**Recommended: 15 km.** `OWNER CANDIDATE — NOT LOCKED` — **subject to
Buntharik's actual geography**, which this analysis cannot assess. If the
villages BANHAO intends to serve sit beyond 15 km, the correct response is to
raise D-08's clamp headroom and D-10 together, not to raise the radius alone.

### 8B.9 Interaction matrix — four complete models

| | **A Conservative** | **B Balanced** | **C Rider-forward** | **D Customer-price** |
|---|---|---|---|---|
| Rider share | 75% | **80%** | 85% | 80% |
| Rider floor | ฿12 | **฿12** | ฿15 | ฿10 |
| Rider base | ฿8 | **฿8** | ฿10 | ฿6 |
| Rider per-km | ฿1.20 | **฿1.20** | ฿1.50 | ฿1.00 |
| Delivery min | ฿15 | **฿15** | ฿18 | ฿12 |
| Delivery max | ฿40 | **฿35** | ฿45 | ฿30 |
| Radius | 12 km | **15 km** | 15 km | 12 km |
| Clamp distance | 18.33 km | **16.67 km** | 18.83 km | 18.00 km |
| Internally consistent? | ✅ SAFE | ✅ **SAFE** | ✅ SAFE | ✅ SAFE |

Customer fee / rider payout / BANHAO margin / contribution at ฿100 food:

| Model | 2 km | 5 km | 10 km | Radius edge |
|---|---|---|---|---|
| **A** | ฿16.00 / ฿12 / ฿4.00 / ฿17.00 | ฿18.67 / ฿14 / ฿4.67 / ฿17.63 | ฿26.67 / ฿20 / ฿6.67 / ฿19.49 | ฿29.87 / ฿22.40 / ฿7.47 / ฿20.24 |
| **B** | ฿15.00 / ฿12 / ฿3.00 / ฿16.02 | ฿17.50 / ฿14 / ฿3.50 / ฿16.48 | ฿25.00 / ฿20 / ฿5.00 / ฿17.86 | ฿32.50 / ฿26 / ฿6.50 / ฿19.23 |
| **C** | ฿18.00 / ฿15 / ฿3.00 / ฿15.97 | ฿20.59 / ฿17.50 / ฿3.09 / ฿16.02 | ฿29.41 / ฿25 / ฿4.41 / ฿17.19 | ฿38.24 / ฿32.50 / ฿5.74 / ฿18.37 |
| **D** | ฿12.50 / ฿10 / ฿2.50 / ฿15.56 | ฿13.75 / ฿11 / ฿2.75 / ฿15.79 | ฿20.00 / ฿16 / ฿4.00 / ฿16.94 | ฿22.50 / ฿18 / ฿4.50 / ฿17.40 |

**All four are internally consistent** (clamp beyond radius) — the differences
are distributional, not structural.

- **A** earns BANHAO the most (75% share) but charges ฿16 at 2 km where B charges ฿15, and its 12 km radius forgoes reach.
- **C** pays riders best (฿15 floor, ฿32.50 at the edge) but charges the customer ฿18 minimum — an 80% rise over today's ฿10 — and thins BANHAO's margin to ฿3.09 at 5 km.
- **D** is genuinely cheaper for customers (฿12.50 at 2 km, ฿2.50–฿3.75 saving) but **pays riders ฿10 at short range, ฿2 below DEC-044's current ฿12**, and leaves only ฿2.50 margin.
- **B** sits between them: rider parity with today, the widest safe radius, and a margin that survives promotions.

### 8B.10 Order value × distance matrix — Model B

Commission 10%, service fee 5% collar (฿5 floor / ฿15 cap), payment 1.65%.
Pass/fail shown against the three D-11 floor candidates — **D-11 is not decided
here.**

| Food | km | Comm | Svc | Fee | Total | Rider | Top-up | Payment | **Contribution** | ฿5 | ฿8 | ฿10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|:-:|:-:|
| ฿40 | 2 | ฿4.00 | ฿5.00 | ฿15.00 | ฿60.00 | ฿12 | ฿0 | ฿0.99 | **฿11.01** | ✅ | ✅ | ✅ |
| ฿40 | 5 | ฿4.00 | ฿5.00 | ฿17.50 | ฿62.50 | ฿14 | ฿0 | ฿1.03 | **฿11.47** | ✅ | ✅ | ✅ |
| ฿40 | 10 | ฿4.00 | ฿5.00 | ฿25.00 | ฿70.00 | ฿20 | ฿0 | ฿1.16 | **฿12.85** | ✅ | ✅ | ✅ |
| ฿40 | 15 | ฿4.00 | ฿5.00 | ฿32.50 | ฿77.50 | ฿26 | ฿0 | ฿1.28 | **฿14.22** | ✅ | ✅ | ✅ |
| ฿60 | 2 | ฿6.00 | ฿5.00 | ฿15.00 | ฿80.00 | ฿12 | ฿0 | ฿1.32 | **฿12.68** | ✅ | ✅ | ✅ |
| ฿60 | 5 | ฿6.00 | ฿5.00 | ฿17.50 | ฿82.50 | ฿14 | ฿0 | ฿1.36 | **฿13.14** | ✅ | ✅ | ✅ |
| ฿60 | 10 | ฿6.00 | ฿5.00 | ฿25.00 | ฿90.00 | ฿20 | ฿0 | ฿1.49 | **฿14.52** | ✅ | ✅ | ✅ |
| ฿60 | 15 | ฿6.00 | ฿5.00 | ฿32.50 | ฿97.50 | ฿26 | ฿0 | ฿1.61 | **฿15.89** | ✅ | ✅ | ✅ |
| ฿80 | 2 | ฿8.00 | ฿5.00 | ฿15.00 | ฿100.00 | ฿12 | ฿0 | ฿1.65 | **฿14.35** | ✅ | ✅ | ✅ |
| ฿80 | 5 | ฿8.00 | ฿5.00 | ฿17.50 | ฿102.50 | ฿14 | ฿0 | ฿1.69 | **฿14.81** | ✅ | ✅ | ✅ |
| ฿80 | 10 | ฿8.00 | ฿5.00 | ฿25.00 | ฿110.00 | ฿20 | ฿0 | ฿1.82 | **฿16.19** | ✅ | ✅ | ✅ |
| ฿80 | 15 | ฿8.00 | ฿5.00 | ฿32.50 | ฿117.50 | ฿26 | ฿0 | ฿1.94 | **฿17.56** | ✅ | ✅ | ✅ |
| ฿100 | 2 | ฿10.00 | ฿5.00 | ฿15.00 | ฿120.00 | ฿12 | ฿0 | ฿1.98 | **฿16.02** | ✅ | ✅ | ✅ |
| ฿100 | 5 | ฿10.00 | ฿5.00 | ฿17.50 | ฿122.50 | ฿14 | ฿0 | ฿2.02 | **฿16.48** | ✅ | ✅ | ✅ |
| ฿100 | 10 | ฿10.00 | ฿5.00 | ฿25.00 | ฿130.00 | ฿20 | ฿0 | ฿2.15 | **฿17.86** | ✅ | ✅ | ✅ |
| ฿100 | 15 | ฿10.00 | ฿5.00 | ฿32.50 | ฿137.50 | ฿26 | ฿0 | ฿2.27 | **฿19.23** | ✅ | ✅ | ✅ |
| ฿150 | 2 | ฿15.00 | ฿7.50 | ฿15.00 | ฿172.50 | ฿12 | ฿0 | ฿2.85 | **฿22.65** | ✅ | ✅ | ✅ |
| ฿150 | 5 | ฿15.00 | ฿7.50 | ฿17.50 | ฿175.00 | ฿14 | ฿0 | ฿2.89 | **฿23.11** | ✅ | ✅ | ✅ |
| ฿150 | 10 | ฿15.00 | ฿7.50 | ฿25.00 | ฿182.50 | ฿20 | ฿0 | ฿3.01 | **฿24.49** | ✅ | ✅ | ✅ |
| ฿150 | 15 | ฿15.00 | ฿7.50 | ฿32.50 | ฿190.00 | ฿26 | ฿0 | ฿3.14 | **฿25.87** | ✅ | ✅ | ✅ |
| ฿200 | 2 | ฿20.00 | ฿10.00 | ฿15.00 | ฿225.00 | ฿12 | ฿0 | ฿3.71 | **฿29.29** | ✅ | ✅ | ✅ |
| ฿200 | 5 | ฿20.00 | ฿10.00 | ฿17.50 | ฿227.50 | ฿14 | ฿0 | ฿3.75 | **฿29.75** | ✅ | ✅ | ✅ |
| ฿200 | 10 | ฿20.00 | ฿10.00 | ฿25.00 | ฿235.00 | ฿20 | ฿0 | ฿3.88 | **฿31.12** | ✅ | ✅ | ✅ |
| ฿200 | 15 | ฿20.00 | ฿10.00 | ฿32.50 | ฿242.50 | ฿26 | ฿0 | ฿4.00 | **฿32.50** | ✅ | ✅ | ✅ |
| ฿300 | 2 | ฿30.00 | ฿15.00 | ฿15.00 | ฿330.00 | ฿12 | ฿0 | ฿5.45 | **฿42.56** | ✅ | ✅ | ✅ |
| ฿300 | 5 | ฿30.00 | ฿15.00 | ฿17.50 | ฿332.50 | ฿14 | ฿0 | ฿5.49 | **฿43.01** | ✅ | ✅ | ✅ |
| ฿300 | 10 | ฿30.00 | ฿15.00 | ฿25.00 | ฿340.00 | ฿20 | ฿0 | ฿5.61 | **฿44.39** | ✅ | ✅ | ✅ |
| ฿300 | 15 | ฿30.00 | ฿15.00 | ฿32.50 | ฿347.50 | ฿26 | ฿0 | ฿5.73 | **฿45.77** | ✅ | ✅ | ✅ |

**All 28 cells pass all three floor candidates.** Worst cell: **฿40 at 2 km,
contribution ฿11.01** — ฿1.01 of headroom even against the strictest ฿10
candidate. **No cell produces a rider top-up.** Contribution rises with both
food value and distance.

### 8B.11 Customer price test

Delivery fee as a proportion of food value, Model B:

| Food | 2 km | 5 km | 10 km | 15 km |
|---:|---|---|---|---|
| ฿40 | ฿15.00 (37.5%) | ฿17.50 (43.8%) | ฿25.00 (62.5%) | **฿32.50 (81.2%)** ⚠️ |
| ฿60 | ฿15.00 (25.0%) | ฿17.50 (29.2%) | ฿25.00 (41.7%) | ฿32.50 (54.2%) ⚠️ |
| ฿100 | ฿15.00 (15.0%) | ฿17.50 (17.5%) | ฿25.00 (25.0%) | ฿32.50 (32.5%) |
| ฿300 | ฿15.00 (5.0%) | ฿17.50 (5.8%) | ฿25.00 (8.3%) | ฿32.50 (10.8%) |

Total fees (delivery + service) as a share of the customer bill: **฿40 at 15 km
= 48.4% of a ฿77.50 bill**; ฿100 at 15 km = 27.3%; ฿300 at 15 km = 13.7%.

**The binding constraint on this model is customer plausibility, not BANHAO
economics.** A ฿40 basket 15 km away is economically excellent for BANHAO
(฿14.22 contribution — the *second-best* ฿40 cell in the matrix) and almost
certainly unsellable: the customer pays ฿32.50 to deliver ฿40 of food, and
nearly half the bill is fees. Those orders will abandon at checkout rather than
be refused by the guardrail.

**This is a real limitation of a contribution-only guardrail, stated plainly:**
protecting contribution does not protect conversion. If the owner wants those
customers served, the lever is a **distance-scaled minimum order value** (an
additional parameter — see §8B.15), not a lower delivery fee, which would only
move the loss onto BANHAO or the rider.

Model D charges ฿2.50–฿3.75 less at short range and is the honest alternative if
conversion proves to be the binding problem — at the cost of paying riders ฿10.

### 8B.12 Rider economics test

| Property | Model B result |
|---|---|
| Minimum guaranteed payout | **฿12** — parity with DEC-044, floor-protected below 3.33 km |
| Distance compensation | ฿1.20/km above the floor; ฿20 at 10 km, ฿26 at 15 km |
| Accidental zero/near-zero payout | **None possible** — the floor binds before the formula can fall low |
| Uncovered distance band | **None inside the 15 km radius** — the fee covers the requirement exactly at every distance |
| Hidden BANHAO subsidy | **None inside the radius.** Top-up is ฿0 in all 28 matrix cells |
| Where top-up appears | Only beyond **16.67 km**, i.e. outside the recommended radius: ฿1.60 at 18 km, ฿4.00 at 20 km |

The rider is paid `EffectiveRider` in every case; the 80% share is the funding
mechanism, not a cap on what the rider receives.

### 8B.13 Extended distance test and recommended policy

Model B, ฿35 maximum, 15 km radius:

| Distance | Raw fee | Charged | Rider needs | Share pays | **Top-up** | Contribution (฿100) |
|---|---:|---:|---:|---:|---:|---:|
| 15 km | ฿32.50 | ฿32.50 | ฿26.00 | ฿26.00 | **฿0** | ฿19.23 |
| 16 km | ฿34.00 | ฿34.00 | ฿27.20 | ฿27.20 | **฿0** | ฿19.51 |
| 18 km | ฿37.00 | **฿35.00** | ฿29.60 | ฿28.00 | **฿1.60** | ฿18.09 |
| 20 km | ฿40.00 | **฿35.00** | ฿32.00 | ฿28.00 | **฿4.00** | ฿15.69 |

At ฿40 food the same distances give ฿14.22 / ฿14.50 / ฿13.08 / ฿10.68 — **still
positive**, because commission and service fee carry the order.

**Recommended policy: (A) reject the order beyond the configured maximum radius
— `NOT SERVICEABLE (OUT_OF_RADIUS)`.** `OWNER CANDIDATE — NOT LOCKED`

Reasoning, stated honestly: **this is not a solvency decision.** Contribution
stays positive at 18 and 20 km, so BANHAO would not lose money on these orders.
Rejection is recommended because (i) the top-up is a silent rider subsidy that
grows without bound as distance grows, (ii) the rider receives strictly less
than the formula says the trip costs them, which is a fairness problem before it
is an economic one, and (iii) ETA and failure exposure rise with distance in ways
this arithmetic does not capture.

Option **B** (let the fee keep rising) is defensible but means abandoning D-10's
cap entirely. Option **C** (absorb the top-up) is the worst of the three — it
hides a growing subsidy inside a configuration that appears healthy. If the owner
wants to serve beyond 15 km, the correct route is to raise D-08's clamp headroom
and D-10 together and move the radius deliberately, not to permit clamping.

### 8B.14 Promotion stress test

Model B contribution under platform-funded promotions:

| Food | km | No promo | ฿5 promo | ฿8 promo | ฿10 promo |
|---:|---:|---:|---:|---:|---:|
| ฿40 | 2 | ฿11.01 | ฿6.09 | **฿3.14** | **฿1.18** |
| ฿40 | 5 | ฿11.47 | ฿6.55 | **฿3.60** | **฿1.63** |
| ฿40 | 10 | ฿12.85 | ฿7.93 | **฿4.98** | **฿3.01** |
| ฿40 | 15 | ฿14.22 | ฿9.30 | ฿6.35 | **฿4.39** |
| ฿60 | 2 | ฿12.68 | ฿7.76 | **฿4.81** | **฿2.85** |
| ฿60 | 5 | ฿13.14 | ฿8.22 | ฿5.27 | **฿3.30** |
| ฿60 | 10 | ฿14.52 | ฿9.60 | ฿6.65 | **฿4.68** |
| ฿60 | 15 | ฿15.89 | ฿10.97 | ฿8.02 | ฿6.06 |
| ฿100 | 2 | ฿16.02 | ฿11.10 | ฿8.15 | ฿6.19 |
| ฿100 | 5 | ฿16.48 | ฿11.56 | ฿8.61 | ฿6.64 |
| ฿100 | 10 | ฿17.86 | ฿12.94 | ฿9.99 | ฿8.02 |
| ฿100 | 15 | ฿19.23 | ฿14.31 | ฿11.36 | ฿9.40 |
| ฿150 | all | ฿22.65–฿25.87 | ฿17.74–฿20.95 | ฿14.79–฿18.00 | ฿12.82–฿16.03 |

**Bold = below a ฿5 contribution floor.** Against a ฿8 floor the failing set is
much larger, including every ฿40 cell at ฿5 promotion and ฿100 at 2/5 km with a
฿10 promotion.

**No combination goes negative** — the worst is ฿40 at 2 km with a ฿10 promotion
at **฿1.18**. But **the model looks materially healthier at full price than under
promotion**, which is exactly what this test exists to expose.

**Consequence for D-14:** a platform-funded promotion cap expressed as a flat
baht amount will behave very differently across baskets. A ฿5 promotion is
comfortable at ฿100 food and marginal at ฿40. The engine must evaluate the
promotion *inside* pricing and refuse the combination (§7's required behaviour)
rather than absorb it — and the cap should probably scale with basket, which is
a D-14 question this section does not decide.

### 8B.15 Configuration parameters required

Must become Admin-configurable, versioned, auditable and snapshotted:

| Parameter | Spec §4.3 field | Note |
|---|---|---|
| Rider share | `rider_share_basis_points` | |
| Rider floor | `rider_floor_satang` | |
| Rider base | `rider_base_satang` | |
| Rider per-km | `rider_per_km_satang` | |
| Delivery minimum | `delivery_fee_min_satang` | **Derived** = floor ÷ share; validation must enforce consistency |
| Delivery maximum | `delivery_fee_max_satang` | Validation must enforce clamp distance ≥ radius (**V7**) |
| Maximum radius | `max_service_radius_m` | |

**Additional parameters required to prevent hidden loss**, beyond those already
named in the spec:

1. **Distance-scaled minimum order value** — the only lever that addresses
   §8B.11's abandonment zone without shifting cost to BANHAO or the rider. The
   spec carries a flat `min_order_value_satang`; a distance-aware variant does
   not exist and would be new.
2. **Rider top-up ceiling / policy flag** — an explicit switch for what happens
   when the clamp binds (reject / raise fee / absorb), so the §8B.13 choice is a
   configured decision rather than emergent behaviour.
3. **Distance estimation variance allowance** — D-17's accuracy policy needs a
   configured tolerance; otherwise systematic underestimation silently erodes
   margin with nothing measuring it.

### 8B.16 Accounting and refund impact

Verified against the implementation. **No accounting behaviour is modified by
this analysis.**

**What already protects history.** `deliveries.rider_earning_satang` is written
once by `DeliveryCompletionService.claimCompletion` in the same guarded UPDATE
that completes the delivery, and is never re-read from the pricing function
afterwards — the rider-side equivalent of `orders.service_fee_satang`.
`resolveRiderEarningSatang()` documents this seam explicitly. **A future
configuration change therefore cannot alter what an already-`DELIVERED` delivery
earned.** DEC-059's discipline holds on the rider side by the same mechanism it
holds on the service-fee side.

**Compatibility with DEC-053:** rider compensation is `Eligible` in every failure
cause, with the amount still open as **BQ-024**. Nothing in this analysis
resolves BQ-024 or changes DEC-053's cause table. A dynamic rider requirement
makes the BQ-024 question *more* pointed — compensation for a failed 15 km trip
is plainly not the same as for a failed 2 km trip — but that remains a separate
decision.

**Compatibility with DEC-059:** delivery fee refund treatment is cause-dependent
and unchanged. **However, the pre-existing gap noted in §10 becomes more
visible:** delivery-fee revenue is still never posted to the ledger, so a refund
has no delivery-revenue entry to reverse. A dynamic model makes that revenue
materially larger (฿3.00–฿6.50 per order rather than a fixed −฿2), which raises
the priority of closing the gap — it does not create it.

**The one genuine accounting conflict this analysis surfaces.**
`PLATFORM_WRITE_OFF_SATANG = 200` is a **fixed constant, deliberately not
derived** from `delivery_fee − rider_earning` — `rider-earning-pricing.ts` states
this explicitly, because DEC-045 defines a fixed Phase 1 gap rather than a
formula. Under any dynamic model in this section **BANHAO's delivery margin is
positive** (฿3.00–฿6.50), so there is no write-off at all. The current
`RIDER_EARNING` ledger group — `RIDER_PAYABLE −1200` / `PLATFORM_WRITE_OFF +200`
— would post a **fictional ฿2 loss on every delivery that actually earned a
positive margin.**

**This is reported, not fixed.** It means adopting any D-05…D-12 candidate
requires a superseding decision for **DEC-045** and a corresponding change to the
`RIDER_EARNING` group's shape — plausibly `RIDER_PAYABLE −rider_earning` against
a delivery-revenue account rather than `PLATFORM_WRITE_OFF`. That is ledger
design work, gated on a decision, and outside this analysis.

**Implementation prerequisites identified:**

| Prerequisite | Status |
|---|---|
| Distance availability | **HARD BLOCKER** — `addresses.lat`/`lng` NULL in practice; `orders.distance_m` and `deliveries.distance_m` exist but are **never populated** by any code path |
| Superseding decisions | **DEC-044** (rider amount → formula), **DEC-045** (write-off constant), **DEC-035** (any distance component) |
| New ledger treatment | Delivery-fee revenue posting; revised `RIDER_EARNING` group; rider top-up representation if the absorb policy is ever chosen |
| New snapshot fields | Rider requirement, rider payout, top-up, distance, pricing config version — per spec §11 |
| Configuration versioning | The whole §10 lifecycle; no configuration infrastructure exists today |
| Validation rule V7 | Must enforce clamp distance ≥ radius — the failure mode found in §8B.5 and §8B.7 |

### 8B.17 Recommended balanced model and owner decision statement

> **Recommended: Model B (Balanced).** All values `OWNER CANDIDATE — NOT LOCKED`.
>
> | Decision | Recommendation |
> |---|---|
> | **D-05** Rider share | **80%** |
> | **D-06** Rider floor | **฿12** |
> | **D-07** Rider base | **฿8** |
> | **D-08** Rider per-km | **฿1.20/km** |
> | **D-09** Delivery minimum | **฿15** (derived: floor ÷ share) |
> | **D-10** Delivery maximum | **฿35** (derived: just above the fee at the radius edge) |
> | **D-12** Maximum radius | **15 km**, subject to Buntharik geography |
> | Beyond-radius policy | **Reject — `NOT SERVICEABLE (OUT_OF_RADIUS)`** |
>
> **Three of these seven are derived, not independent.** D-09 = D-06 ÷ D-05;
> D-10 must exceed the fee at D-12's edge; D-08's clamp distance must exceed
> D-12. Changing any of D-05, D-06, D-08 or D-12 requires recomputing the
> others. They should be decided as a **set**, not individually.
>
> All remain `OWNER DECISION REQUIRED`. Nothing is locked by this analysis.

**Why Model B, against the nine stated objectives:** rider parity with DEC-044
(no rider is worse off at launch); no rider top-up anywhere inside the radius; a
delivery margin of 0.25× rider pay that survives a modest promotion; all 28
matrix cells clearing even the strictest ฿10 floor candidate with ฿11.01 worst
case; distance compensation that scales without clamping; internally consistent
minimum, maximum and radius; no change to refund or historical accounting; and a
parameter set that maps directly onto the architecture spec's existing fields.

**Its honest weakness** is §8B.11: at ฿40 food and 15 km the customer pays ฿32.50
to deliver ฿40 of food. That order is profitable and probably unsellable, and no
contribution guardrail addresses it.

**Order-level contribution protection remains what it is** — a guarantee about
*acceptance*, not a guarantee that BANHAO cannot lose money afterwards. Refunds,
chargebacks, distance overruns, failed deliveries and fee divergence all remain
outside it (§6.3).

---

## 8C. Decision Preparation Analysis — D-13 + D-14 (Loss Protection & Promotions)

```
DECISION PREPARATION / ANALYSIS ONLY
D-13 AND D-14 ARE NOT LOCKED BY THIS SECTION
ALL VALUES ILLUSTRATIVE ONLY — NOT LOCKED
```

Expands D-13 and D-14 in §8. Supersedes nothing, decides nothing, and does not
alter the §8 entries — those remain `OWNER DECISION REQUIRED`.

### 8C.1 Assumptions

Analysis inputs only, carried forward from §8A/§8B. Commission **10%** and
rounding preservation are **approved owner direction**; everything else is
`OWNER CANDIDATE — NOT LOCKED`: service fee 5% with ฿5 floor / ฿15 cap; rider
share 80%, floor ฿12, base ฿8, ฿1.20/km; delivery min ฿15, max ฿35; radius
15 km; payment cost 1.65% (DEC-055 clause 3 assumption).

```
Contribution = 0.10×Food + ServiceFee + DeliveryMargin − PlatformPromotion − 0.0165×CustomerTotal
```

Evaluated **after** commission, service fee, delivery fee, rider payout, payment
cost and platform-funded promotion — as the governing rule requires.

### 8C.2 D-13 — Contribution matrix including ฿50

Model B economics, no promotion. Pass/fail against the three D-11 floor
candidates — **D-11 is not decided here.**

| Food | km | Total | Comm | Svc | Fee | Rider | Payment | **Contribution** | Share | ฿5 | ฿8 | ฿10 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|:-:|:-:|
| ฿40 | 2 | ฿60.00 | ฿4.00 | ฿5.00 | ฿15.00 | ฿12 | ฿0.99 | **฿11.01** | 18.4% | ✅ | ✅ | ✅ |
| ฿40 | 5 | ฿62.50 | ฿4.00 | ฿5.00 | ฿17.50 | ฿14 | ฿1.03 | **฿11.47** | 18.4% | ✅ | ✅ | ✅ |
| ฿40 | 10 | ฿70.00 | ฿4.00 | ฿5.00 | ฿25.00 | ฿20 | ฿1.16 | **฿12.85** | 18.4% | ✅ | ✅ | ✅ |
| ฿40 | 15 | ฿77.50 | ฿4.00 | ฿5.00 | ฿32.50 | ฿26 | ฿1.28 | **฿14.22** | 18.4% | ✅ | ✅ | ✅ |
| ฿50 | 2 | ฿70.00 | ฿5.00 | ฿5.00 | ฿15.00 | ฿12 | ฿1.16 | **฿11.85** | 16.9% | ✅ | ✅ | ✅ |
| ฿50 | 5 | ฿72.50 | ฿5.00 | ฿5.00 | ฿17.50 | ฿14 | ฿1.20 | **฿12.30** | 17.0% | ✅ | ✅ | ✅ |
| ฿50 | 10 | ฿80.00 | ฿5.00 | ฿5.00 | ฿25.00 | ฿20 | ฿1.32 | **฿13.68** | 17.1% | ✅ | ✅ | ✅ |
| ฿50 | 15 | ฿87.50 | ฿5.00 | ฿5.00 | ฿32.50 | ฿26 | ฿1.44 | **฿15.06** | 17.2% | ✅ | ✅ | ✅ |
| ฿60 | 2–15 | ฿80.00–฿97.50 | ฿6.00 | ฿5.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿12.68–฿15.89** | 15.8–16.3% | ✅ | ✅ | ✅ |
| ฿80 | 2–15 | ฿100.00–฿117.50 | ฿8.00 | ฿5.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿14.35–฿17.56** | 14.4–14.9% | ✅ | ✅ | ✅ |
| ฿100 | 2–15 | ฿120.00–฿137.50 | ฿10.00 | ฿5.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿16.02–฿19.23** | 13.4–14.0% | ✅ | ✅ | ✅ |
| ฿150 | 2–15 | ฿172.50–฿190.00 | ฿15.00 | ฿7.50 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿22.65–฿25.87** | 13.1–13.6% | ✅ | ✅ | ✅ |
| ฿200 | 2–15 | ฿225.00–฿242.50 | ฿20.00 | ฿10.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿29.29–฿32.50** | 13.0–13.4% | ✅ | ✅ | ✅ |
| ฿300 | 2–15 | ฿330.00–฿347.50 | ฿30.00 | ฿15.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿42.56–฿45.77** | 12.9–13.2% | ✅ | ✅ | ✅ |

**All 32 cells pass all three floor candidates.** Worst: **฿40 at 2 km, ฿11.01.**

### 8C.3 Is a minimum order value actually necessary?

Extending below the tested range, at the worst distance (2 km):

| Food | Contribution | Clears |
|---:|---:|---|
| ฿0 (reference point only) | ฿7.67 | ฿5 |
| ฿10 | ฿8.51 | ฿8 |
| ฿20 | ฿9.34 | ฿8 |
| ฿30 | ฿10.18 | ฿10 |
| ฿40 | ฿11.01 | ฿10 |

**Why:** at 2 km the service-fee floor (฿5) plus the delivery margin (฿3.00)
already yield **฿8.00 of BANHAO revenue before a single satang of commission**,
against a payment cost of ฿0.33 on an empty basket. **The fee structure alone
satisfies the contribution floor; commission is upside on top.**

> **Answer: no. A minimum order value is not necessary for solvency under these
> candidate economics.** The contribution guardrail never fires on basket size —
> it cannot, because the fixed fee components dominate at low basket values. A
> minimum order value would reject orders that are demonstrably profitable.

**Strategy comparison:**

| Dimension | **A — No minimum, guardrail only** | **B — Flat minimum food subtotal** | **C — Distance-scaled minimum** |
|---|---|---|---|
| Economic solvency | ✅ Fully protected — guardrail is exact and per-order | ✅ Protected, but redundantly | ✅ Protected, redundantly |
| Customer UX | ✅ No arbitrary barrier; refusals are rare and explainable | ⚠️ "Minimum ฿60" is easy to state but turns away viable orders | ❌ "Minimum varies by distance" is hard to explain and feels arbitrary |
| Restaurant viability | ✅ Small restaurants keep small orders | ❌ Cheapest menus lose the most orders | ❌ Outlying restaurants penalised twice |
| Rider viability | ✅ Rider is fully funded at every basket (§8B.12) | Neutral | Neutral |
| Order density | ✅ Best — density matters most at launch in a small district | ❌ Directly suppresses volume | ❌ Suppresses volume where density is already thinnest |
| Operational efficiency | ✅ One rule to reason about | ⚠️ Two overlapping rules | ❌ Three interacting rules |
| Payment economics | ✅ Payment cost is proportional, never fixed-fee dominated | Neutral | Neutral |
| Delivery economics | ✅ Delivery is self-funding by construction | Neutral | Neutral |

**Recommended: Strategy A — no minimum order value.**
`OWNER CANDIDATE — NOT LOCKED`

A minimum order value would be adopted for *commercial* reasons (basket-size
strategy, merchant preference, kitchen efficiency) — not for loss protection.
Those are legitimate reasons, but they are a different decision from this one,
and this analysis finds no economic case for one.

### 8C.4 Is a distance-scaled minimum order necessary?

**No — and this refines the framing in §8B.15.** Contribution at ฿40 food
*rises* with distance:

| Distance | Delivery fee | Fee as % of food | Contribution |
|---|---:|---:|---:|
| 2 km | ฿15.00 | 38% | ฿11.01 |
| 5 km | ฿17.50 | 44% | ฿11.47 |
| 10 km | ฿25.00 | 62% | ฿12.85 |
| 15 km | ฿32.50 | 81% | ฿14.22 |

The longest, smallest order is the **second most profitable** ฿40 cell. There is
therefore **no solvency justification whatsoever** for a distance-scaled minimum.

**Clarifying §8B.15, which listed a distance-scaled minimum order value under
"parameters required to prevent hidden loss".** That heading was too strong. The
parameter was proposed to address §8B.11's *abandonment zone* — a **conversion**
problem, not a loss problem — and §8C confirms it has no loss-protection role.
Recorded as a refinement of framing; §8B's arithmetic is unaffected and remains
correct.

**Recommendation:** rely on the maximum radius (D-12) plus the contribution
guardrail. If the ฿40-at-15 km customer experience proves damaging, the honest
levers are a radius reduction or a *commercial* minimum — not a loss rule
dressed up as one. `OWNER CANDIDATE — NOT LOCKED`

### 8C.5 D-14 — Promotion funding

**Merchant-funded and platform-funded promotions are not economically
symmetrical.** ฿10 discount, 5 km:

| Food | No promo | **Merchant-funded ฿10** | **Platform-funded ฿10** |
|---:|---:|---:|---:|
| ฿40 | ฿11.47 | **฿11.63** (+฿0.16) | **฿1.63** (−฿9.84) |
| ฿100 | ฿16.48 | **฿16.64** (+฿0.16) | **฿6.64** (−฿9.84) |
| ฿300 | ฿43.01 | **฿43.18** (+฿0.16) | **฿33.18** (−฿9.84) |

A merchant-funded discount leaves BANHAO's contribution **marginally better**,
because the payment fee falls on the smaller customer total. A platform-funded
discount costs BANHAO the full promotion less the payment saving — ฿9.84 of every
฿10.

| Option | Assessment |
|---|---|
| **A — Platform-funded** | The only mechanism that can make an order lose money. Powerful for acquisition, dangerous unguarded. |
| **B — Merchant-funded** | Contribution-neutral for BANHAO. Requires merchant willingness — the constraint is commercial, not economic. |
| **C — Configurable per promotion** | **Already the locked model.** DEC-046 fixes the funder as `PLATFORM` or `MERCHANT` per promotion, with **no split**. |

**Recommended: Option C as the mechanism — which DEC-046 already locks — with
`MERCHANT` as the Phase 1 default funder, and platform-funded promotions
permitted only under the guardrail in §8C.7.**
`OWNER CANDIDATE — NOT LOCKED`

Note that "hybrid" must not be read as *shared* funding of a single promotion:
DEC-046 explicitly permits no split, and enabling `SHARED` would require
superseding it.

### 8C.6 Promotion economics — worked examples

Platform-funded, 5 km:

**Small order — ฿40 food** (no promo: ฿11.47)

| Promotion | % of food | Customer pays | Contribution |
|---:|---:|---:|---:|
| ฿5 | 12.5% | ฿57.50 | ฿6.55 |
| ฿8 | 20.0% | ฿54.50 | ฿3.60 |
| ฿10 | 25.0% | ฿52.50 | ฿1.63 |
| ฿15 | 37.5% | ฿47.50 | **−฿3.28** ⚠️ |

**Medium order — ฿100 food** (no promo: ฿16.48)

| Promotion | % of food | Customer pays | Contribution |
|---:|---:|---:|---:|
| ฿5 | 5.0% | ฿117.50 | ฿11.56 |
| ฿10 | 10.0% | ฿112.50 | ฿6.64 |
| ฿15 | 15.0% | ฿107.50 | ฿1.73 |

**Large order — ฿300 food** (no promo: ฿43.01)

| Promotion | % of food | Customer pays | Contribution |
|---:|---:|---:|---:|
| ฿10 | 3.3% | ฿322.50 | ฿33.18 |
| ฿15 | 5.0% | ฿317.50 | ฿28.26 |

**Why a flat-baht promotion is dangerous on small baskets and harmless on large
ones.** The promotion is a **fixed** subtraction from contribution (฿9.84 per
฿10, regardless of basket), while contribution itself **grows with basket
size** — ฿11.47 at ฿40 food versus ฿43.01 at ฿300. The same ฿15 promotion is
131% of the ฿40 order's contribution and 35% of the ฿300 order's. A flat cap
therefore expresses completely different risk at different baskets.

### 8C.7 Promotion guardrail — recommended mechanism

Worst-case contribution by promotion level, across all 32 cells:

| Promotion | Worst contribution | Where | Cells < ฿5 | < ฿8 | < ฿10 | **Negative** |
|---:|---:|---|---:|---:|---:|---:|
| ฿0 | ฿11.01 | ฿40 / 2 km | 0 | 0 | 0 | **0** |
| ฿5 | ฿6.09 | ฿40 / 2 km | 0 | 6 | 12 | **0** |
| ฿8 | ฿3.14 | ฿40 / 2 km | 6 | 13 | 19 | **0** |
| ฿10 | ฿1.18 | ฿40 / 2 km | 12 | 18 | 20 | **0** |
| ฿15 | **−฿3.74** | ฿40 / 2 km | 20 | 21 | 23 | **11** |

Assessing the five candidate mechanisms:

| Mechanism | Verdict |
|---|---|
| **1. Absolute baht cap** | ❌ **Unsafe.** A ฿15 cap produces 11 negative cells; any cap safe at ฿40 food is needlessly restrictive at ฿300. |
| **2. Percentage-of-food cap** | ❌ **Also unsafe — and this is not obvious.** A 15% cap allows ฿45 on a ฿300 order → **−฿1.70**. A 20% cap → **−฿16.46**. Contribution is not proportional to food alone, so a percentage of food does not track it. Only a 10% cap survives (worst ฿6.19), and only by accident. |
| **3. Contribution-preserving calculation** | ✅ **Exact and simple.** |
| **4. Minimum-safe-contribution guardrail** | ✅ Necessary as the final backstop, but reactive — it refuses the order rather than sizing the promotion. |
| **5. Combination** | ✅ **Recommended: 3 + 4.** |

**The contribution-preserving cap is a one-line closed form** — no iteration:

```
contribution(P) = C₀ − P × (1 − payment_rate)

therefore   P_max = (C₀ − contribution_floor) ÷ (1 − payment_rate)
```

where `C₀` is the order's contribution with no promotion. Verified exact against
direct calculation. Maximum platform-funded promotion preserving each floor
(2 km, the worst distance):

| Food | C₀ | Floor ฿5 | Floor ฿8 | Floor ฿10 | ฿8-floor cap as % of food |
|---:|---:|---:|---:|---:|---:|
| ฿40 | ฿11.01 | ฿6.11 | ฿3.06 | ฿1.03 | 7.7% |
| ฿50 | ฿11.85 | ฿6.96 | ฿3.91 | ฿1.88 | 7.8% |
| ฿60 | ฿12.68 | ฿7.81 | ฿4.76 | ฿2.72 | 7.9% |
| ฿80 | ฿14.35 | ฿9.51 | ฿6.46 | ฿4.42 | 8.1% |
| ฿100 | ฿16.02 | ฿11.20 | ฿8.15 | ฿6.12 | 8.2% |
| ฿150 | ฿22.65 | ฿17.95 | ฿14.90 | ฿12.87 | 9.9% |
| ฿200 | ฿29.29 | ฿24.69 | ฿21.64 | ฿19.61 | 10.8% |
| ฿300 | ฿42.56 | ฿38.19 | ฿35.13 | ฿33.10 | 11.7% |

**Recommended: mechanism 3 + 4 — size the promotion from the contribution
floor, and let the existing guardrail refuse anything that still fails.**
`OWNER CANDIDATE — NOT LOCKED`

This satisfies the stated objective — *a platform-funded promotion must never
cause the order to violate the minimum-safe-contribution threshold* — by
construction rather than by tuning, needs no new cap parameter to keep in sync,
and automatically adapts when any other economic parameter changes. An absolute
cap may still be layered on top as a **budget** control (limiting marketing
spend per order), which is a different purpose from loss protection and should
not be confused with it.

### 8C.8 Customer UX

| Question | Assessment |
|---|---|
| Does a minimum order feel reasonable? | It is a familiar convention and easy to state — but under Strategy A none is needed, which is strictly better for the customer. |
| Can a customer understand a rejection? | **Only partially, and this is a genuine concern.** "Below minimum order" is understandable; "below minimum contribution" is not something a customer can be shown. Under Strategy A rejections on economics are essentially absent (0 of 32 cells), so the problem largely does not arise — but the reason codes in the spec (§7) are internal, and customer-facing wording is undesigned. |
| Do promotions create misleading discount economics? | Risk exists: a ฿15 "discount" on a ฿40 order that BANHAO refuses, or silently declines to offer, reads as a broken promise. Sizing promotions by the contribution-preserving cap keeps offers honest — the customer is only ever shown a discount the order can actually carry. |
| Is there too much checkout friction? | **This is the real friction, and it is not promotions.** At ฿40 food and 2 km the customer pays ฿15 delivery + ฿5 service on ฿40 of food — **fees are 33% of a ฿60 bill**, rising to 48% at 15 km (§8B.11). Adding a minimum order value on top of that would compound a friction problem that already exists. |

**Conclusion: do not add a minimum order value on conversion grounds — it makes
the checkout worse, not better.** The fee weight on small baskets is the
conversion issue worth attention, and it belongs to D-03/D-09, not D-13.

### 8C.9 Merchant economics

**Does a merchant-funded discount reduce the commission base?** In the current
implementation, **no** — and this is structural, not a policy choice yet:
`create_order()` computes `subtotal_satang` from cart items and applies
`discount_satang` only to `grand_total_satang`. Commission is calculated on
`subtotal_satang`, i.e. **pre-discount** (documented in
`commission-pricing.ts`).

Consequence at ฿100 food with a ฿10 merchant-funded discount: commission is ฿10
(on ฿100), not ฿9 (on ฿90). **The merchant funds the discount and pays
commission on the pre-discount amount** — worth ฿1.00 to BANHAO per ฿10
discounted.

> **This is a policy decision that has never been taken.** The current behaviour
> is a consequence of how `create_order()` was written, not of any locked
> decision. A merchant may reasonably argue the commission should follow the
> revenue they actually received. **`OWNER DECISION REQUIRED` — not decided
> here.**

**Should a platform-funded discount reduce the commission base?** Economically
no — the merchant receives the full food amount, so the pre-discount base is the
amount the merchant was actually paid on. Current behaviour is already correct
for this case.

**Snapshot and immutability requirements** (implementation prerequisites, no
schema change proposed):

- Promotion **amount** and **funder** must both be recorded in the order pricing
  snapshot. `orders.discount_satang` stores the amount; **the funder is stored
  nowhere today.**
- The funder must be **immutable after checkout**, exactly as
  `service_fee_satang` is — otherwise a refund cannot know who funded what.
- The commission base actually used should be snapshotted, so a later policy
  change cannot make a historical order's commission unexplainable.

### 8C.10 Q-020 / refund compatibility

**No refund behaviour is modified or redesigned by this analysis.** Verified
against DEC-047, DEC-048, DEC-049 and DEC-059:

| Component | Refund treatment on an eligible full refund | Source |
|---|---|---|
| Original food subtotal | Not reversed directly; reversal is of `CUSTOMER_PAYMENT` at `payments.amount_satang` | DEC-059 clause A |
| Original service fee | Reversed at the stored `orders.service_fee_satang` | DEC-048 + DEC-059 clause B |
| Original merchant commission | Reversed at the **original posted ledger entry**, never recomputed | DEC-059 clause C |
| Original delivery fee | Cause-dependent (DEC-059 clause D / DEC-053) — **and still unposted as revenue**, so nothing exists to reverse |
| Original rider compensation | Eligible per DEC-053; amount is **BQ-024, open** |
| **Original promotion** | **No treatment exists.** `PROMOTION_FUNDING` is a legal ledger account that **has never been written to.** |

**The critical invariant holds:** because `CUSTOMER_PAYMENT` reverses
`payments.amount_satang` — the amount actually charged, already net of any
discount — **the refund automatically returns exactly what the customer paid**,
whatever promotion applied and whoever funded it. Current configuration is never
consulted. A promotion model therefore introduces **no new risk** to this
invariant.

**But two gaps become material** (reported, not resolved):

1. **A platform-funded promotion is a real BANHAO cost with no ledger entry.**
   Contribution arithmetic subtracts it; the ledger does not record it. Until
   `PROMOTION_FUNDING` is posted, the ledger understates BANHAO's promotional
   spend and §17's realized-versus-projected contribution metric cannot
   reconcile.
2. **A merchant-funded promotion reduces merchant payable — which is itself
   unposted.** Reversal of a merchant-funded discount has no representation at
   all today.

Both are consequences of the pre-existing ledger incompleteness (§9), not of
any promotion model. Each needs its own decision before promotions carry real
money.

### 8C.11 `PLATFORM_WRITE_OFF_SATANG` dependency

Set B surfaced that `PLATFORM_WRITE_OFF_SATANG = 200` is a **fixed constant**,
deliberately not derived, posted in the `RIDER_EARNING` group. **This task does
not fix it.** Determining whether the D-13/D-14 candidates interact with it:

| Candidate mechanism | Interaction |
|---|---|
| **Platform-funded promotion** | ⚠️ **Yes.** It is a genuine platform cost needing a ledger home. `PROMOTION_FUNDING` exists and is the correct account — but if promotion cost were instead posted to `PLATFORM_WRITE_OFF`, it would become **indistinguishable from the DEC-045 delivery gap and from delivery-failure write-offs**, making "what did BANHAO absorb, and why" unanswerable from the ledger. |
| **Minimum order rules** | ✅ None. A rejected order posts nothing. |
| **Rider top-up** | ⚠️ **Yes.** A top-up is a platform cost with no account of its own; posting it to `PLATFORM_WRITE_OFF` would collide with the same constant. Under Model B no top-up arises inside the radius (§8B.12), so this is latent, not active. |
| **Delivery-failure write-off** | ⚠️ **Yes.** DEC-051/052/053 already direct cooked-food loss to `PLATFORM_WRITE_OFF`, so that account **already carries at least two distinct meanings** — the DEC-045 fixed gap and cause-based food loss. |

> **Unresolved dependency, flagged not fixed:** `PLATFORM_WRITE_OFF` is
> accumulating multiple unrelated economic meanings — the DEC-045 fixed delivery
> gap, cause-based food loss, and potentially promotion funding and rider
> top-up. **A separate decision is required** on account taxonomy (which costs
> get their own accounts, and what `PLATFORM_WRITE_OFF` is reserved for) before
> any of these post real money. This is in addition to the DEC-045 supersession
> Set B already identified, and does not reinterpret the ledger here.

### 8C.12 Recommendations and owner decision statement

> | Decision | Recommendation | Status |
> |---|---|---|
> | **D-13** Minimum order value | **Strategy A — none.** Rely on the contribution guardrail | `OWNER CANDIDATE — NOT LOCKED` |
> | Distance-scaled minimum | **Not adopted** — no solvency justification | `OWNER CANDIDATE — NOT LOCKED` |
> | **D-14** Promotion funding | **Configurable per promotion (DEC-046's existing model), `MERCHANT` as the Phase 1 default** | `OWNER CANDIDATE — NOT LOCKED` |
> | **Promotion guardrail** | **Contribution-preserving cap + minimum-safe-contribution backstop** (mechanisms 3 + 4) | `OWNER CANDIDATE — NOT LOCKED` |
>
> All remain `OWNER DECISION REQUIRED`. Nothing is locked by this analysis.

**Trade-offs, stated honestly:**

- **BANHAO solvency** — fully protected without a minimum order value; the fee
  structure alone clears ฿8 before commission. Platform-funded promotions are
  the *only* mechanism found that can drive an order negative, and the
  contribution-preserving cap closes that by construction.
- **Customer conversion** — no minimum is strictly better; the real friction is
  fee weight on small baskets (33–48% of the bill), which belongs to D-03/D-09.
- **Rider viability** — untouched by both decisions. The rider is fully funded
  at every basket, and a promotion never reduces rider payout.
- **Merchant attractiveness** — a `MERCHANT` default shifts promotional cost to
  merchants, which is the honest trade for BANHAO's neutrality and may meet
  resistance in a district with few restaurants. The unresolved commission-base
  question (§8C.9) compounds it: a merchant funding a discount *and* paying
  commission on the pre-discount amount may reasonably object.
- **Promotion usability** — a contribution-derived cap is less intuitive for a
  marketer than "฿10 off". Mitigation: the simulator (spec §15) can show the
  maximum safe promotion per basket before a campaign launches.
- **Operational simplicity** — Strategy A leaves exactly one rule to reason
  about, which is the strongest simplicity argument available.

**Order-level contribution protection remains a guarantee about acceptance
only** — it does not make BANHAO immune to post-acceptance loss (§6.3, §8B.17).

### 8C.13 Implementation prerequisites and future supersessions

**Prerequisites** (analysis only — nothing authorized):

- Promotion **funder** field in the order pricing snapshot; not stored today.
- Snapshot of the **commission base actually used**.
- `PROMOTION_FUNDING` ledger posting for platform-funded promotions; the account
  exists and has never been written.
- Merchant payable posting, without which merchant-funded discounts cannot be
  represented at all.
- Account-taxonomy decision for `PLATFORM_WRITE_OFF` (§8C.11).
- Contribution-preserving cap requires `C₀` to be computable inside the pricing
  engine before the promotion is applied — an ordering requirement on the engine
  (spec §5), not new data.

**Future supersessions:** **none required by D-13** (no locked decision governs
minimum order value). **D-14 requires superseding DEC-046 only if `SHARED`
funding is enabled** — the recommended per-promotion `PLATFORM`/`MERCHANT` model
is what DEC-046 already locks. The commission-base question (§8C.9) is a **new
decision**, not a supersession, since no decision currently addresses it. BQ-030
(promotion stacking) remains open and is untouched.

---

## 8D. Decision Preparation Analysis — D-11 Minimum Safe Contribution

```
DECISION PREPARATION / ANALYSIS ONLY
D-11 IS NOT LOCKED BY THIS SECTION
ALL VALUES ILLUSTRATIVE ONLY — NOT LOCKED
```

D-11 is the **central economic safety decision** — the threshold the acceptance
guardrail enforces. Expands D-11 in §8; supersedes nothing and decides nothing.

**The governing rule, and its exact limit:**

> BANHAO must not accept an order whose expected contribution is below the
> configured minimum safe contribution.
>
> **An order-level contribution guardrail does NOT guarantee BANHAO can never
> lose money after acceptance.** Refunds, delivery failures, rider compensation
> changes (BQ-024 open), operational write-offs, fraud, and payment or
> reconciliation issues all sit outside the pre-acceptance model. D-11 governs
> **acceptance**, nothing more.

### 8D.1 Assumptions

Analysis inputs only. Commission **10%** and whole-baht rounding are **approved
owner direction**; everything else is `OWNER CANDIDATE — NOT LOCKED`: service
fee 5% with ฿5 floor / ฿15 cap (§8A); rider share 80%, floor ฿12, base ฿8,
฿1.20/km, delivery ฿15–฿35, radius 15 km (§8B); no minimum order value, promotion
funder configurable with contribution-preserving cap (§8C); payment 1.65%
(DEC-055 clause 3 assumption).

**Commission rounding check.** Applying DEC-043's convention at 10% —
`floor((subtotal_satang × 10 + 5000) ÷ 10000)` — the rounding **never bites at
any tested basket** (10% of ฿40/฿60/฿80/฿100/฿150/฿200/฿300 is always a whole
baht). It would bite at, for example, ฿25 food (฿2.50 → ฿3). Every figure below
is therefore identical whether commission is rounded or not, which removes one
source of doubt from the comparison.

### 8D.2 Base matrix

| Food | km | Comm | Svc | Fee | Rider | Payment | **Contribution** | Share | ฿3 | ฿5 | ฿8 | ฿10 | ฿12 | ฿15 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|:-:|:-:|:-:|:-:|:-:|
| ฿40 | 2 | ฿4 | ฿5.00 | ฿15.00 | ฿12 | ฿0.99 | **฿11.01** | 18.4% | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| ฿40 | 5 | ฿4 | ฿5.00 | ฿17.50 | ฿14 | ฿1.03 | **฿11.47** | 18.4% | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| ฿40 | 10 | ฿4 | ฿5.00 | ฿25.00 | ฿20 | ฿1.16 | **฿12.85** | 18.4% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿40 | 15 | ฿4 | ฿5.00 | ฿32.50 | ฿26 | ฿1.28 | **฿14.22** | 18.4% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿60 | 2 | ฿6 | ฿5.00 | ฿15.00 | ฿12 | ฿1.32 | **฿12.68** | 15.8% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿60 | 5 | ฿6 | ฿5.00 | ฿17.50 | ฿14 | ฿1.36 | **฿13.14** | 15.9% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿60 | 10 | ฿6 | ฿5.00 | ฿25.00 | ฿20 | ฿1.49 | **฿14.52** | 16.1% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿60 | 15 | ฿6 | ฿5.00 | ฿32.50 | ฿26 | ฿1.61 | **฿15.89** | 16.3% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿80 | 2 | ฿8 | ฿5.00 | ฿15.00 | ฿12 | ฿1.65 | **฿14.35** | 14.4% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿80 | 5 | ฿8 | ฿5.00 | ฿17.50 | ฿14 | ฿1.69 | **฿14.81** | 14.4% | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ฿80 | 10 | ฿8 | ฿5.00 | ฿25.00 | ฿20 | ฿1.82 | **฿16.19** | 14.7% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿80 | 15 | ฿8 | ฿5.00 | ฿32.50 | ฿26 | ฿1.94 | **฿17.56** | 14.9% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿100 | 2–15 | ฿10 | ฿5.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿16.02–฿19.23** | 13.4–14.0% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿150 | 2–15 | ฿15 | ฿7.50 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿22.65–฿25.87** | 13.1–13.6% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿200 | 2–15 | ฿20 | ฿10.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿29.29–฿32.50** | 13.0–13.4% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ฿300 | 2–15 | ฿30 | ฿15.00 | ฿15.00–฿32.50 | ฿12–฿26 | — | **฿42.56–฿45.77** | 12.9–13.2% | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Worst deterministic contribution: ฿11.01 — ฿40 food at 2 km.** No rounding
hides a negative anywhere: the minimum across all 28 cells is comfortably
positive.

| Threshold | Pass | Fail | Headroom at worst cell | % above threshold |
|---:|---:|---:|---:|---:|
| ฿3 | 28 | 0 | **+฿8.01** | 267% |
| ฿5 | 28 | 0 | **+฿6.01** | 120% |
| ฿8 | 28 | 0 | **+฿3.01** | 38% |
| ฿10 | 28 | 0 | **+฿1.01** | 10% |
| ฿12 | 26 | 2 | −฿0.99 | −8% |
| ฿15 | 19 | 9 | −฿3.99 | −27% |

### 8D.3 Extreme small-basket test

**No minimum order value is introduced.** The question is whether D-11 itself
filters weak baskets.

| Food | 2 km | 5 km | 10 km | 15 km |
|---:|---:|---:|---:|---:|
| ฿10 | ฿8.51 | ฿8.96 | ฿10.34 | ฿11.72 |
| ฿20 | ฿9.34 | ฿9.80 | ฿11.18 | ฿12.55 |
| ฿30 | ฿10.18 | ฿10.63 | ฿12.01 | ฿13.39 |
| ฿40 | ฿11.01 | ฿11.47 | ฿12.85 | ฿14.22 |

Smallest food subtotal that passes each threshold, at the worst distance (2 km):

| Threshold | Smallest viable basket |
|---:|---:|
| ฿3 | ฿0 — nothing is ever rejected |
| ฿5 | ฿0 — nothing is ever rejected |
| ฿8 | **฿5** |
| ฿10 | **฿25** |
| ฿12 | **฿55** |
| ฿15 | **฿85** |

**This is where the thresholds genuinely differ.** ฿3 and ฿5 never reject on
basket size. ฿8 rejects only implausibly tiny baskets. **฿10 begins rejecting
real orders** — a ฿20 single-dish order fails. ฿12 and ฿15 reject a large part of
a rural district's natural basket range.

### 8D.4 Extreme distance test

฿40 food, the worst basket:

| Distance | Fee | Rider | Margin | Contribution |
|---|---:|---:|---:|---:|
| 2 km | ฿15.00 | ฿12.00 | ฿3.00 | ฿11.01 |
| 5 km | ฿17.50 | ฿14.00 | ฿3.50 | ฿11.47 |
| 10 km | ฿25.00 | ฿20.00 | ฿5.00 | ฿12.85 |
| 15 km | ฿32.50 | ฿26.00 | ฿6.50 | ฿14.22 |

**Contribution rises with distance**, so distance is never what makes an order
fail D-11 inside the radius. **The worst cell is always the shortest trip on the
smallest basket.**

**Why out-of-radius orders should still be rejected** (reference only — the
radius rule is D-12, not D-11):

| Distance | Raw fee | Charged | Rider needs | **Top-up** | Contribution (฿40) |
|---|---:|---:|---:|---:|---:|
| 18 km | ฿37.00 | ฿35.00 | ฿29.60 | **฿1.60** | ฿13.08 |
| 20 km | ฿40.00 | ฿35.00 | ฿32.00 | **฿4.00** | ฿10.68 |

Contribution stays positive, so **D-11 would happily accept these orders** — the
guardrail cannot see the problem, because the harm falls on the *rider*, not on
BANHAO. This is a concrete demonstration that D-11 is not a general safety net:
it protects one party's economics only. The radius rule (D-12) is what protects
the rider.

### 8D.5 Promotion stress test

Platform-funded promotions, all 28 cells:

| Promotion | Worst contribution | Where | Negative cells | Viable at ฿3 | ฿5 | ฿8 | ฿10 | ฿12 | ฿15 |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ฿0 | ฿11.01 | ฿40 / 2 km | 0 | 28 | 28 | 28 | 28 | 26 | 19 |
| ฿5 | ฿6.09 | ฿40 / 2 km | 0 | 28 | 28 | 24 | 19 | 15 | 12 |
| ฿8 | ฿3.14 | ฿40 / 2 km | 0 | 28 | 24 | 19 | 13 | 12 | 11 |
| ฿10 | ฿1.18 | ฿40 / 2 km | 0 | 25 | 19 | 14 | 12 | 12 | 9 |
| ฿15 | **−฿3.74** | ฿40 / 2 km | **8** | 14 | 12 | 11 | 9 | 8 | 6 |

Previously flagged cells confirmed: **฿40 / 2 km with ฿10 promotion = ฿1.18**;
**with ฿15 promotion = −฿3.74**. Also ฿40 / 5 km at ฿15 = −฿3.28, ฿60 / 2 km at
฿15 = −฿2.07.

**Does the contribution-preserving cap prevent every failure?** Testing §8C's
formula `P_max = (C₀ − floor) ÷ (1 − payment_rate)` across all cells:

| Threshold | Cells where the cap cannot hold the floor |
|---:|---:|
| ฿3 | **0** |
| ฿5 | **0** |
| ฿8 | **0** |
| ฿10 | **0** |
| ฿12 | 2 |
| ฿15 | 9 |

**For every threshold up to ฿10 the cap holds by construction** — it simply
sizes the promotion down, to zero if necessary. At ฿12 and ฿15 some cells cannot
carry any promotion at all, because their unpromoted contribution is already
below the floor.

**Reconciliation with §8C — reported, not a contradiction.** §8C recorded **11**
negative cells at a ฿15 promotion; this section records **8**. §8C's grid
included a ฿50 basket row (32 cells); §8D's grid follows the D-11 brief's basket
list (28 cells). The ฿50 row contributes exactly 3 negative cells (−฿2.91,
−฿2.45, −฿1.07 at 2/5/10 km), and 8 + 3 = 11. **Both figures are correct for
their own grids.**

### 8D.6 Model-error and robustness analysis

**This is the decisive section.** A threshold chosen from deterministic
arithmetic alone would be fitted to assumptions that will not hold exactly.

**Single-factor sensitivity, worst cell (฿40 / 2 km), no promotion:**

| Deviation | Worst contribution | Erosion |
|---|---:|---:|
| Baseline | ฿11.01 | — |
| Payment rate +0.25pp | ฿10.86 | −฿0.15 |
| Payment rate +0.50pp | ฿10.71 | −฿0.30 |
| Rider cost +5% | ฿10.41 | −฿0.60 |
| Rider cost +10% | ฿9.81 | −฿1.20 |
| Rider cost +15% | ฿9.21 | −฿1.80 |
| Operational leakage −฿0.50 | ฿10.51 | −฿0.50 |
| Operational leakage −฿1.00 | ฿10.01 | −฿1.00 |
| Operational leakage −฿2.00 | ฿9.01 | −฿2.00 |

**Payment-rate error is the least dangerous factor** (−฿0.30 for a large
+0.50pp move) because it applies to a customer total that is small in absolute
terms on the worst cell. **Rider cost is the most dangerous**, because rider
payout is the largest single cost on a small basket.

**Combined stress — +0.50pp payment, +10% rider, −฿1 leakage:**

```
Worst contribution falls from ฿11.01 to ฿8.51 — erosion of ฿2.50
```

| Threshold | Cells passing | Headroom at worst cell | Verdict |
|---:|---:|---:|---|
| ฿3 | 28/28 | +฿5.51 | ✅ |
| **฿5** | **28/28** | **+฿3.51** | ✅ |
| ฿8 | 28/28 | **+฿0.51** | ✅ but razor-thin |
| ฿10 | 25/28 | −฿1.49 | ❌ **breached** |
| ฿12 | 18/28 | −฿3.49 | ❌ breached |
| ฿15 | 12/28 | −฿6.49 | ❌ breached |

**Severe stress — +0.50pp payment, +15% rider, −฿2 leakage:**

```
Worst contribution falls to ฿6.91
```

| Threshold | Headroom | Verdict |
|---:|---:|---|
| ฿3 | +฿3.91 | ✅ |
| **฿5** | **+฿1.91** | ✅ |
| ฿8 | −฿1.09 | ❌ **breached** |
| ฿10 | −฿3.09 | ❌ breached |
| ฿12 | −฿5.09 | ❌ breached |
| ฿15 | −฿8.09 | ❌ breached |

**Combined stress plus a ฿5 platform promotion:** worst falls to **฿3.62**. Only
฿3 keeps all 28 cells; ฿5 loses 3. This is precisely the regime the
contribution-preserving cap exists to handle — under that cap the promotion is
sized down rather than the order refused.

**Conclusion of the robustness analysis:** **฿5 is the highest threshold that
survives every single-factor deviation, the combined stress, and the severe
stress with positive headroom.** ฿8 survives combined stress by ฿0.51 and
**fails severe stress**. ฿10 fails combined stress outright.

### 8D.7 Future-cost sensitivity

Controlled sensitivity only — **no forecasts, and no conversion-rate claims, are
made anywhere in this section.**

| If this rises | Effect on the worst cell | Which thresholds survive |
|---|---|---|
| Payment processing cost | Mild — ฿0.30 per +0.50pp | All up to ฿10 |
| Rider compensation | **Strongest single factor** — ฿1.20 per +10% | ฿8 survives +10%, fails around +15% combined |
| Support/ops cost added | Direct, satang for satang | ฿5 absorbs ฿2/order; ฿8 absorbs about ฿1 before the severe case bites |
| Refunds / write-offs | **Outside the model entirely** — post-acceptance (§6.3) | None; D-11 cannot protect against these |
| Promotional intensity | Fully absorbed by the §8C cap, at the price of smaller promotions | All, by construction |

Two of these — refunds/write-offs and BQ-024 rider compensation on failure — are
**structurally invisible** to D-11. That is an argument for keeping deliberate
headroom rather than fitting the threshold tightly to today's arithmetic.

### 8D.8 Commercial classification

**No conversion percentages are used or invented.** Classification is derived
from tested economic baskets only.

| Threshold | Smallest viable basket | Base-matrix rejects | Classification |
|---:|---:|---:|---|
| ฿3 | ฿0 | 0/28 | **very permissive** |
| ฿5 | ฿0 | 0/28 | **permissive** |
| ฿8 | ฿5 | 0/28 | **balanced** |
| ฿10 | ฿25 | 0/28 | **restrictive** |
| ฿12 | ฿55 | 2/28 | **very restrictive** |
| ฿15 | ฿85 | 9/28 | **very restrictive** |

**Where legitimate small orders start being rejected: ฿10.** A ฿20 single-dish
order — an entirely normal rural order — fails a ฿10 floor at short distance
while being economically sound (฿9.34 contribution). ฿12 rejects everything under
฿55; ฿15 under ฿85.

### 8D.9 Commercial interpretation of each candidate

**฿3.** Protects only against genuinely negative orders and near-zero cases. It
would catch a ฿15 platform promotion on a small basket, and little else. Under
the candidate economics **no order is ever rejected** by it — the guardrail
becomes a formality that fires only in genuine model breakdown. **Not
meaningless — it is the last line of defence — but too weak to be the primary
control.**

**฿5.** Rejects nothing in the base matrix, survives combined and severe stress
with positive headroom, and leaves a ฿6.01 buffer deterministically. **A
reasonable launch threshold**: it constrains nothing commercially while retaining
real protection against the cost movements most likely to occur.

**฿8.** Deterministically attractive — ฿3.01 headroom, 38% above the worst cell —
and it rejects no realistic basket. **But the §8A service-fee collar changed the
picture materially, and this must be stated precisely.** The corrected D-11
rationale in §8 records that the ฿8 floor's worst-case headroom was **฿0.0595**
and that it failed at a payment rate of 1.7544%. **That was computed under a
*pure* 5% service fee with no floor**, and remains correct for those inputs.
Under the current collar candidate the same cell yields **฿11.01**, and ฿8 would
only break at a payment rate of **6.67%**. The earlier concern was real and has
been substantially addressed by the collar — a change of input, not an error.
**What still argues against ฿8 is not deterministic fragility but stress
fragility: it fails the severe scenario by ฿1.09.**

**฿10.** Rejects no cell in the base matrix, but **breaches under combined
stress** (−฿1.49, 3 cells failing) and lifts the smallest viable basket to ฿25.
It constrains legitimate volume while providing protection that does not survive
the stress case it is meant to guard against — the worst of both.

**฿12 and ฿15.** Both reject cells in the base matrix itself (2 and 9
respectively), require a ฿55 or ฿85 minimum basket by implication, and still fail
every stress scenario. **Commercially restrictive without being economically
safer.**

### 8D.10 Required comparison

| D-11 | Cells pass | Cells fail | Min contribution | Min headroom | Smallest passing basket | Promotion robustness | Stress robustness | Commercial classification |
|---:|---:|---:|---:|---:|---:|---|---|---|
| **฿3** | 28 | 0 | ฿11.01 | +฿8.01 (267%) | ฿0 | Cap holds all cells | ✅ survives all, +฿3.91 severe | very permissive |
| **฿5** | 28 | 0 | ฿11.01 | **+฿6.01 (120%)** | ฿0 | Cap holds all cells | ✅ **survives all, +฿1.91 severe** | permissive |
| **฿8** | 28 | 0 | ฿11.01 | +฿3.01 (38%) | ฿5 | Cap holds all cells | ⚠️ combined +฿0.51, **severe −฿1.09** | balanced |
| **฿10** | 28 | 0 | ฿11.01 | +฿1.01 (10%) | ฿25 | Cap holds all cells | ❌ combined −฿1.49 | restrictive |
| **฿12** | 26 | 2 | ฿11.01 | −฿0.99 | ฿55 | Cap fails 2 cells | ❌ combined −฿3.49 | very restrictive |
| **฿15** | 19 | 9 | ฿11.01 | −฿3.99 | ฿85 | Cap fails 9 cells | ❌ combined −฿6.49 | very restrictive |

### 8D.11 Recommendation

> **Recommended D-11: ฿5 (500 satang) minimum safe contribution.**
> `OWNER CANDIDATE — NOT LOCKED`

**Why ฿5 rather than ฿8 (the next higher candidate).** ฿8 is the better-looking
number deterministically — ฿3.01 of headroom, and it rejects nothing real. But
it **fails the severe stress scenario by ฿1.09**, and clears the combined stress
by only ฿0.51. A threshold whose purpose is to absorb model error should not
itself be the thing that breaks when the model errs. ฿5 clears combined stress by
฿3.51 and severe stress by ฿1.91. Choosing ฿8 buys ฿3 of nominal protection on
paper and loses the protection precisely when it would be needed.

**Why ฿5 rather than ฿3 (the next lower candidate).** ฿3 never rejects anything
under any tested scenario, which makes it a formality rather than a control. ฿5
costs nothing commercially — it also rejects nothing in the base matrix, and its
smallest viable basket is ฿0 — while retaining a meaningful signal: it fires
under combined stress plus promotion, which is exactly the regime where an
operator should want to know. **฿5 is the highest threshold that is free of
commercial cost and still meaningful.**

**Against the ten stated objectives:** contribution protection ✅ (survives every
stress case with headroom) · order acceptance ✅ (rejects 0/28) · customer
conversion ✅ (no basket-size barrier; the real friction is fee weight, §8C.8) ·
small-basket viability ✅ (smallest viable basket ฿0) · rider viability ✅
(unaffected — rider is fully funded at every basket) · promotion flexibility ✅
(cap holds every cell) · payment cost ✅ (absorbs +0.50pp with ฿3.51 to spare) ·
operational uncertainty ✅ (absorbs ฿2/order leakage) · future cost growth ✅
(absorbs +15% rider cost) · margin robustness ✅ (the only candidate above ฿3 to
survive severe stress).

**Deliberately raise it later, from evidence.** ฿5 is a launch threshold. Once
real contribution data exists (§17's realized-versus-projected metric), the owner
can raise it knowing what it actually rejects — a decision that cannot be made
responsibly today, because no production data exists.

### 8D.12 `PLATFORM_WRITE_OFF_SATANG` treatment — recommended architecture

Set B surfaced the fixed `PLATFORM_WRITE_OFF_SATANG = 200` conflict with dynamic
rider economics; Set C found platform-funded promotions and delivery-failure
write-offs can collide in the same account. **Neither is fixed here.**

The question for D-11 is whether these costs belong *inside* its pre-acceptance
contribution model:

| Option | Assessment |
|---|---|
| **A — Include them in the contribution model** | ❌ Rejected. Refunds, delivery failures and write-offs are **probabilistic post-acceptance events**, not per-order costs knowable at acceptance. Including an expected value would require a loss-rate estimate BANHAO does not have, and would make every order's decision depend on an invented number. |
| **B — Strictly an order-level expected contribution floor** | ✅ **Recommended.** D-11 answers exactly one question: *given what is knowable now, does this order clear the floor?* Everything probabilistic stays out. |
| **C — Separate risk buffer parameter** | ⚠️ Deferred, not rejected. A distinct `risk_buffer_satang` — conceptually the expected post-acceptance loss per order — is the correct home for refund/write-off exposure **once measured**. Adding it now would mean guessing. |
| **D — Other** | Not needed. |

> **Recommended treatment: B now, with C as the named successor.**
> `OWNER CANDIDATE — NOT LOCKED`
>
> D-11 remains a strictly deterministic, order-level, pre-acceptance floor.
> Post-acceptance loss is measured (§17), not modelled, and when the data exists
> the owner may add a separate risk buffer rather than inflating D-11 to cover
> risks it cannot see. **Choosing ฿5 over ฿3 already leaves the headroom that
> would otherwise tempt an unmeasured buffer.**
>
> **Unresolved dependency, restated not reinterpreted:** `PLATFORM_WRITE_OFF`
> is accumulating several distinct meanings (DEC-045's fixed gap, cause-based
> food loss, potentially promotion funding and rider top-up). The account
> taxonomy decision flagged in §8C.11 remains required, and is independent of
> D-11.

### 8D.13 Historical and refund safety

**D-11 is an acceptance-time decision and has no historical effect whatsoever.**

- It is evaluated **once, before an order exists**, and determines only whether
  the order is created. It writes no ledger entry and reverses nothing.
- **DEC-047** (service fee recognised at payment success) — unaffected; D-11
  runs before payment.
- **DEC-048** (service fee included in an eligible full refund) — unaffected.
- **DEC-049 / DEC-059** (independent reversal groups, sourced from original
  records) — unaffected. Reversal reads `payments.amount_satang`,
  `orders.service_fee_satang` and the original posted commission ledger entry.
  **None of these is the contribution figure**, and none is recomputed.
- Changing D-11 later changes which *future* orders are accepted. It cannot
  alter, revalue, or retroactively reject an order already placed.

**Refunds continue to reverse original recorded economics, never current
configuration.** D-11 introduces no new path that could violate this.

### 8D.14 Configuration requirements

Semantics required (specification only — nothing authorized):

| Requirement | Detail |
|---|---|
| Parameter | `min_contribution_satang` — a single integer |
| Precision | **Integer satang** (CON-003); never a float, never a percentage |
| Effective-from | Carried by the pricing configuration version, not a per-parameter timestamp |
| Version | Resolved once per evaluation and **snapshotted onto the order**, so any accepted order can prove which floor it cleared |
| Audit trail | Every change through `audit_logs` with actor, before/after and **mandatory reason** (DEC-032 precedent) |
| Authorization | Draft/activate split per D-18; **AI has no authority** (DEC-040) |
| Fail-closed | Missing, invalid, negative or non-integer → **refuse new orders** (`CONFIG_MISSING` / `CONFIG_INVALID`). **Never fall back to an implicit floor of zero** — that would silently disable the guardrail, the single most dangerous failure mode in this architecture |
| Validation | `min_contribution_satang ≥ 0`; the scenario grid must clear it before a configuration can reach `VALIDATED` (spec V3, V8) |
| Mid-checkout | Version pinned at quote, revalidated server-side before order creation (D-19) |

**One point deserves emphasis:** the floor must also be enforceable when it is
zero-by-configuration. `0` is a legitimate value meaning "accept anything
non-negative"; *absent* configuration is not, and must fail closed.

### 8D.15 Owner decision statement

> **D-11 — Minimum safe contribution.** Candidates: ฿3 (very permissive) · **฿5
> (recommended)** · ฿8 (balanced, fails severe stress) · ฿10 (restrictive,
> fails combined stress) · ฿12 / ฿15 (very restrictive, reject base-matrix
> cells).
>
> **Recommended: ฿5.** `OWNER CANDIDATE — NOT LOCKED`
>
> Architecture treatment: **strictly an order-level pre-acceptance floor
> (Option B)**, with a separate risk-buffer parameter deferred until
> post-acceptance loss is measured.
>
> `OWNER DECISION REQUIRED` — nothing is locked by this analysis.

---

## 9. Configuration safety — owner decisions required

| Area | What the owner must decide | Recommended candidate |
|---|---|---|
| **Who activates** | D-18 | Draft by `OPERATOR`, activate by `ADMIN` |
| **Validation requirements** | Which checks block `VALIDATED` | All of V1–V12 in the architecture spec, especially **V7** (delivery formula covers rider payout across the full radius) and **V8** (scenario grid clears the floor) |
| **Scenario grid** | Which food × distance combinations must pass | The §2/§3 grid at minimum; add the lowest food value and the maximum radius as mandatory cells |
| **Version lifecycle** | Whether `DRAFT → VALIDATED → ACTIVE → RETIRED` is enforced | Yes; at most one `ACTIVE`, enforced by a database partial unique index, not application logic |
| **Audit trail** | What is recorded | Reuse `audit_logs` (`entity_type = 'pricing_config'`, before/after, **mandatory reason** per DEC-032) |
| **Effective time** | Immediate vs scheduled activation | Immediate for launch; scheduled adds complexity without a current need |
| **Rollback / retirement** | How to revert | Re-activate a prior version as a **new** version — never mutate or "un-retire" a historical one |
| **Concurrent checkout** | D-19 | Pin the version; revalidate server-side before order creation |
| **Order pricing snapshot** | What is stored per order | Config version, engine version, every component, rounding outcomes, contribution, floor, and reason codes — **immutable after creation** |

**Fail-closed is not optional.** Missing configuration, invalid configuration,
missing distance, or any calculation error must produce *"do not accept order"*
— never a silent fallback to the old flat constants, which would price orders
under rules nobody chose.

---

## 10. Q-020 compatibility

**Q-020 is not modified, redesigned or reopened by anything in this pack.**

**The invariant that must hold:** changing future economics must never rewrite
historical order economics.

**Why it already holds.** Refund reversal sources its amounts from **original
records**, never from current configuration and never by recomputation:

| Reversal component | Amount source | Effect of a future config change |
|---|---|---|
| `CUSTOMER_PAYMENT_REFUND` | `payments.amount_satang` | **None** — historical record |
| `SERVICE_FEE_REVENUE_REFUND` | `orders.service_fee_satang` snapshot | **None** — immutable column |
| `MERCHANT_COMMISSION_REFUND` | The **original posted `PLATFORM_REVENUE` ledger entry** | **None** — DEC-059 clause C forbids recomputation, and a structural test asserts the commission function is never even imported |

**Worked demonstration.** An order priced under Pricing Config v17 (commission
8%, service ฿5) is refunded after v18 activates (commission 10%, service 5%).
The reversal reads v17's own recorded amounts — ฿8 commission, ฿5 service fee —
because it reads the original ledger entry and the original order column, not
the configuration. **v18 has no effect on it whatever.**

The pricing snapshot strengthens the evidence trail *additively*; it does not
change the reversal mechanism. `orders_enforce_immutable_columns` already
prevents the underlying money columns from drifting.

**Gaps surfaced but not resolved** (each needs a future decision question):
delivery-fee revenue is unrecognized, so a refund has nothing to reverse for it;
platform-funded promotion has no ledger posting; rider top-up has no
representation distinct from `PLATFORM_WRITE_OFF`.

---

## 11. Sequencing recommendation

**Mechanism and values should be changed in two separate, separately-approved
steps.**

1. **Step 1 — mechanism only.** Build the configuration system and author the
   initial `ACTIVE` configuration to reproduce DEC-035/036/043/044/045
   **byte-for-byte**, proven by test. Nothing about BANHAO's economics changes;
   nothing needs superseding.
2. **Step 2 — values.** Only after the supersessions in §12 are formally locked
   does any number change.

This keeps a pricing-engine defect from being confused with a pricing-policy
change, and it lets the mechanism be validated against known-good outputs before
it is trusted with new ones.

---

## 12. Legal / tax boundary

**No legal advice is given here, and none should be inferred.**

**Requires Thai legal review:** merchant-of-record model and the cash waterfall
(**Q-002 itself, still `OPEN` / `LEGAL_REVIEW_REQUIRED`**) · **holding customer
funds** between collection and settlement, and any licensing implication ·
merchant settlement obligations and permissible cadence (D-15) · rider payout
obligations and rider engagement classification (D-05, D-06) · refund
responsibility · chargeback responsibility · consumer-protection obligations ·
**fee presentation and disclosure**, which directly constrains D-03, D-04, D-09
and how a configurable fee may be shown to customers.

**Requires Thai tax/accounting review:** gross versus net revenue recognition ·
VAT treatment of commission, service fee and delivery fee · invoicing
obligations · whether a versioned, configurable fee structure creates additional
record-keeping obligations.

**Requires confirmation against Stripe's Thailand terms for BANHAO's own
account:** the 1.65% rate (recorded in DEC-055 as an *external assumption* from
published pricing) · that the processing fee is not returned on refund (also
recorded in DEC-055) · whether the intended structure is permitted.

**A configurable pricing system does not make any pricing lawful.**
Configuration freedom operates inside whatever limits legal review establishes.

---

## 13. Final owner decision summary

| # | Decision | Recommended candidate | Status | Needs superseding DEC? |
|---:|---|---|---|---|
| D-01 | Commission rate | 10% — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-043** |
| D-02 | Commission rounding | Keep round-half-up to baht | `OWNER DECISION REQUIRED` | Only if changed — DEC-043 |
| D-03 | Service fee model | Percentage with cap — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-036** |
| D-04 | Service fee cap | ฿15 — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-036** |
| D-05 | Rider share | 80% — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-044** |
| D-06 | Rider floor | ฿12 — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-044, DEC-045** |
| D-07 | Rider base | ฿8 — `OWNER CANDIDATE — NOT LOCKED`, pending real data | `OWNER DECISION REQUIRED` | **Yes — DEC-044** |
| D-08 | Rider per-km | ฿1.20/km — `OWNER CANDIDATE — NOT LOCKED`, pending real data | `OWNER DECISION REQUIRED` | **Yes — DEC-044, DEC-035** |
| D-09 | Minimum delivery fee | ฿15 — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-035** |
| D-10 | Maximum delivery fee | ฿35 — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | **Yes — DEC-035** |
| D-11 | Minimum contribution | ฿5 at launch — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | No — new decision |
| D-12 | Maximum radius | 15 km — `OWNER CANDIDATE — NOT LOCKED`, subject to geography | `OWNER DECISION REQUIRED` | **Yes — DEC-035** |
| D-13 | Minimum order value | None; rely on D-11 | `OWNER DECISION REQUIRED` | No — new decision |
| D-14 | Promotion policy | Platform-funded allowed but capped to preserve the floor | `OWNER DECISION REQUIRED` | Only for uncapped/`SHARED` — DEC-046 |
| D-15 | Settlement cadence | Weekly at launch — `OWNER CANDIDATE — NOT LOCKED` | `OWNER DECISION REQUIRED` | No — but **gated on Q-002** |
| D-16 | Distance source | Geocoding if Thai rural coverage is adequate; bands/zones a legitimate fallback | `OWNER DECISION REQUIRED` | **Yes — DEC-035** |
| D-17 | Distance accuracy policy | BANHAO absorbs variance; measure it | `OWNER DECISION REQUIRED` | No — new decision |
| D-18 | Activation authority | Draft `OPERATOR`, activate `ADMIN` | `OWNER DECISION REQUIRED` | No — new decision |
| D-19 | Mid-checkout version behaviour | Pin the version for a bounded window | `OWNER DECISION REQUIRED` | No — new decision |

**No candidate in this table is locked. No recommendation constitutes a
decision. Every row requires the owner's answer, and several additionally
require legal or accounting review before they can be acted on.**

---

## 14. Prerequisites and blockers

| Severity | Item |
|---|---|
| **HARD BLOCKER** | Address geocoding — `lat`/`lng` NULL, `distance_m` never populated. Blocks D-07, D-08, D-10, D-12, D-16, D-17 |
| **HARD BLOCKER** | A distance source with acceptable Buntharik-area accuracy |
| **BLOCKER** | Superseding decisions (§12 column above) before any value changes |
| **BLOCKER** | Schema authorization for configuration tables and snapshot storage |
| **BLOCKER (settlement only)** | Q-002 lock — does **not** block the pricing engine, which is model-independent |
| **HIGH** | Ledger incompleteness — merchant payable and delivery-fee revenue unposted, so computed contribution cannot yet reconcile to the ledger |
| **HIGH** | No observability or alerting exists — contribution cannot currently be measured in production |
| **HIGH** | Real rider-cost data — every rider figure in this pack is a placeholder |
| MEDIUM | Admin Economics Control Center is new construction |

**Practical note:** the configuration system, versioning, snapshot, guardrail and
simulator are all buildable under a **flat** delivery mode with a configurable
amount, *before* geocoding exists. That path delivers most of the owner's stated
direction without waiting on the hard blockers.

---

## Document status

```
DECISION PREPARATION MATERIAL
ALL ECONOMIC VALUES ARE OWNER CANDIDATES — NOT LOCKED
NO DECISION IS LOCKED BY THIS DOCUMENT
IMPLEMENTATION NOT AUTHORIZED
```

DEC-035, DEC-036, DEC-043, DEC-044, DEC-045 and DEC-046 remain unchanged and
authoritative. Q-020 (DEC-057/058/059/060) is unchanged. Q-002 remains `OPEN` /
`LEGAL_REVIEW_REQUIRED`.
