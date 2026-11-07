# Q-002 ECONOMICS ARCHITECTURE SPECIFICATION

```
OWNER DIRECTION APPROVED
NUMERIC ECONOMIC VALUES NOT LOCKED
IMPLEMENTATION NOT AUTHORIZED
```

Written 2026-09-09 against HEAD `7988a144` on `feature/g7-driver-availability`.
Read-only architecture specification. **No code, schema, migration or decision
document is changed by this file, and none is authorized by it.**

Every numeric value in this document is labelled `INITIAL CANDIDATE — NOT
LOCKED` or is a restatement of an already-locked decision, clearly attributed.
Where a number is restated from DEC-035/036/043/044/045, it is quoted as
*current locked state*, never as a proposal.

---

## 1. Executive Summary

The owner has approved a direction: **BANHAO must not hard-code economic
parameters.** Pricing must be Admin-configurable, versioned, auditable, and the
pricing engine must refuse an order whose projected contribution falls below a
configured floor.

This specification designs that system. It does not build it, and it does not
choose any of its numbers.

Three findings shape the whole design:

1. **The seam already exists and is clean.**
   `OrderPricingService.resolveOrderFees(restaurantId, subtotalSatang)` already
   accepts exactly the inputs a configurable engine needs and deliberately
   ignores them, returning two private constants. Its own doc comment states
   that a future pricing model would use this call site. Replacing the constants
   with a resolved configuration is a contained change at one location.

2. **No configuration infrastructure exists anywhere in the repository.**
   There is no settings table, no config table, no feature-flag mechanism, and
   no versioned-parameter pattern in any of the 30 migrations. Everything in
   sections 3–8 below is new construction, not an extension.

3. **Dynamic delivery pricing is blocked by a data gap, not by design.**
   `addresses.lat` and `addresses.lng` are nullable and are NULL in practice
   (DQ-04-07, recorded in `OrderPricingService`'s own header).
   `orders.distance_m` exists as a `create_order()` parameter that **no
   application code has ever passed** — it is always NULL. Distance-based
   delivery pricing cannot be computed until address geocoding exists. This is
   the single largest implementation prerequisite in this document.

The architecture below is therefore best understood as three separable pieces:
a configuration system (buildable now), a contribution guardrail (buildable now,
using a flat or non-distance delivery model), and dynamic distance-based
delivery pricing (blocked on geocoding).

---

## 2. Owner-Approved Principles

Restated as received, and treated as binding direction for this design:

1. Economic parameters must not be hard-coded.
2. Parameters must be configurable from Admin.
3. Configuration must be versioned.
4. Configuration changes must be auditable.
5. The pricing engine must prevent acceptance of an order whose calculated
   BANHAO contribution is below the configured minimum safe contribution.

**What this approval does not include:** any numeric value, any commission rate,
any fee, any rider share or floor, any contribution floor, any radius, and any
authorization to write code, migrations or schema.

---

## 3. Current-State Constraints

Verified against the repository and the live `banhao-dev` catalog at the time of
writing. These are facts the design must respect, not proposals.

| Area | Current state |
|---|---|
| Delivery fee | `DELIVERY_FEE_SATANG = 1000`, private constant, DEC-035 (flat ฿10, no distance, no bands, no zones) |
| Service fee | `SERVICE_FEE_SATANG = 500`, private constant, DEC-036 (fixed ฿5) |
| Commission | `floor((subtotal_satang × 8 + 5000) / 10000) × 100` satang — DEC-043, 8% of food subtotal, round-half-up to whole baht |
| Rider earning | `RIDER_EARNING_SATANG = 1200`, DEC-044 (฿12 flat) |
| Platform write-off | `PLATFORM_WRITE_OFF_SATANG = 200`, DEC-045 (the ฿2 funding gap) |
| Pricing seam | `OrderPricingService.resolveOrderFees()` — args present, deliberately unused |
| Configuration infrastructure | **None.** No config table, no settings table, no feature flags |
| Distance | `addresses.lat`/`lng` nullable and NULL in practice; `orders.distance_m` never populated by any code path |
| Money representation | Integer satang throughout (CON-003); no floating point permitted for monetary values |
| Order immutability | `orders_enforce_immutable_columns` trigger protects money columns after creation |
| Pricing authority | Server-only (DEC-E-01); no client-supplied amount is ever accepted or merged |
| Ledger accounts (live CHECK) | `CUSTOMER_PAYMENT`, `MERCHANT_PAYABLE`, `RIDER_PAYABLE`, `PLATFORM_REVENUE`, `REFUND_PAYABLE`, `PROMOTION_FUNDING`, `RIDER_COMPENSATION`, `PLATFORM_WRITE_OFF`, `RIDER_CASH_HELD` |
| Accounts never written | `REFUND_PAYABLE`, `PROMOTION_FUNDING`, `RIDER_COMPENSATION`, `RIDER_CASH_HELD` |
| Discount | `orders.discount_satang` defaults to 0 and **no code path ever sets it non-zero** |
| Merchant payable | **Not posted at all** — the ledger records commission but never gross merchant food payable |
| Staff roles | `platform_staff.staff_role` ∈ {`OPERATOR`, `ADMIN`} |
| Audit pattern | `audit_logs(actor_type, actor_id, action, entity_type, entity_id, before, after, reason, correlation_id, source, created_at)` — append-only, reusable |
| Admin app | Next.js App Router; `app/cases`, `app/login`, `app/unauthorized`; repositories/hooks/lib present |

**Two constraints deserve emphasis.** First, the ledger's incompleteness
(merchant payable unposted, delivery-fee revenue unrecognized) means
"contribution" as computed by a pricing engine will not yet reconcile to the
ledger. Second, `orders_enforce_immutable_columns` is an asset for this design:
a pricing snapshot written at order creation cannot later drift.

---

## 4. Economic Parameter Model

A single versioned configuration document. Every field below is a parameter,
not a value. **No default is proposed as correct.**

### 4.1 Merchant economics

| Parameter | Type | Notes |
|---|---|---|
| `commission_mode` | enum `PERCENT_OF_FOOD_SUBTOTAL` \| `FIXED` \| `PERCENT_WITH_FLOOR_CAP` | Current locked behaviour is percent-of-food-subtotal |
| `commission_rate_basis_points` | integer | Basis points to avoid decimals — 800 bp = 8%, the current locked DEC-043 rate |
| `commission_rounding_rule` | enum `ROUND_HALF_UP_TO_BAHT` \| `ROUND_DOWN_TO_BAHT` \| `EXACT_SATANG` | Current locked rule is round-half-up to whole baht |
| `commission_min_satang` | integer, nullable | Optional floor |
| `commission_max_satang` | integer, nullable | Optional cap |

### 4.2 Customer service fee

| Parameter | Type |
|---|---|
| `service_fee_mode` | enum `FIXED` \| `PERCENT_OF_FOOD_SUBTOTAL` \| `PERCENT_WITH_CAP` |
| `service_fee_fixed_satang` | integer, nullable |
| `service_fee_rate_basis_points` | integer, nullable |
| `service_fee_cap_satang` | integer, nullable |
| `service_fee_floor_satang` | integer, nullable |
| `service_fee_rounding_rule` | enum, as above |

### 4.3 Delivery economics

| Parameter | Type | Notes |
|---|---|---|
| `delivery_pricing_mode` | enum `FLAT` \| `DISTANCE_DERIVED` | `DISTANCE_DERIVED` is unusable until geocoding exists (§23) |
| `delivery_flat_fee_satang` | integer, nullable | Used in `FLAT` mode |
| `rider_share_basis_points` | integer | e.g. 8000 bp = 80% — **candidate only** |
| `rider_floor_satang` | integer | Policy minimum per delivery |
| `rider_base_satang` | integer | Base component of the rider cost model |
| `rider_per_km_satang` | integer | Per-kilometre component |
| `rider_additional_components` | array of `{name, satang, condition}` | e.g. waiting time, night surcharge |
| `delivery_fee_min_satang` | integer | Hard floor on customer delivery fee |
| `delivery_fee_max_satang` | integer | Hard ceiling; exceeding it makes an order `NOT_SERVICEABLE` |
| `max_service_radius_m` | integer | Beyond this, `NOT_SERVICEABLE` |
| `distance_surcharge_bands` | array of `{from_m, to_m, satang}` | Optional step surcharges |
| `delivery_fee_rounding_rule` | enum, as above |

### 4.4 BANHAO margin

| Parameter | Type |
|---|---|
| `min_contribution_satang` | integer — the contribution floor the engine enforces |
| `safety_margin_satang` | integer, nullable — optional buffer above the floor |
| `min_contribution_after_platform_promotion_satang` | integer — floor applied *after* platform-funded discount |
| `min_order_value_satang` | integer, nullable |

### 4.5 Payment economics

| Parameter | Type | Notes |
|---|---|---|
| `payment_percent_fee_basis_points` | integer | Assumed provider rate — an **assumption**, not a measured cost |
| `payment_fixed_fee_satang` | integer | Provider per-transaction fixed component, if any |
| `refund_fee_satang` | integer, nullable | Cost assumed retained by the provider on a refund |
| `refund_fee_is_recoverable` | boolean | Whether the original processing fee returns on refund — **must be confirmed against Stripe's Thailand terms (§20)** |

These are *assumptions used for pricing decisions*, never a substitute for the
actual fee the provider charges. Actual cost must be reconciled from provider
records; the divergence is an observability metric (§17).

### 4.6 Promotion economics

| Parameter | Type |
|---|---|
| `promotion_funding_modes_allowed` | set ⊆ {`PLATFORM`, `MERCHANT`, `SHARED`} |
| `platform_funded_max_discount_satang` | integer |
| `platform_funded_max_discount_basis_points` | integer |
| `shared_funding_platform_share_basis_points` | integer, nullable |
| `enforce_contribution_floor_after_promotion` | boolean — **should be structurally true**, see §9 |

**Note on DEC-046:** the funder model is already locked to `PLATFORM` or
`MERCHANT` per promotion with **no split**. `SHARED` is listed here only as a
parameter the schema could carry; **using it would require a superseding
decision** (§21). It must not be enabled by configuration alone.

---

## 5. Pricing Engine

A pure, deterministic, server-side function. Given `(pricing_config, order
inputs)` it returns a complete economic breakdown and a serviceability verdict.
It performs no I/O, reads no clock, and has no hidden state — which makes it
exhaustively testable and makes the snapshot in §11 a faithful record.

```
PricingEngine.evaluate(config, input) -> PricingResult

input:  restaurantId, foodSubtotalSatang, distanceM | null,
        promotionCandidate | null, paymentMethod

result: every field in the canonical order below, plus
        serviceable: boolean, reasons: NotServiceableReason[]
```

**Canonical calculation order** — fixed, because later steps depend on earlier
ones and a different order produces different rounding:

| # | Step | Notes |
|---:|---|---|
| 1 | `food_subtotal_satang` | From the validated cart; server-computed, never client-supplied |
| 2 | `merchant_commission_satang` | Per §4.1, rounded per configured rule |
| 3 | `service_fee_satang` | Per §4.2 |
| 4 | `rider_required_earning_satang` | Per §6 |
| 5 | `effective_rider_requirement_satang` | `MAX(required_earning, rider_floor)` |
| 6 | `rider_payout_satang` | What the rider will actually be paid |
| 7 | `delivery_fee_satang` | Derived per §6/§7 |
| 8 | `promotion_satang` + `promotion_funder` | Per §9 |
| 9 | `customer_grand_total_satang` | `subtotal + delivery + service − discount` (matches `create_order()`'s existing formula) |
| 10 | `payment_cost_satang` | `pct × grand_total + fixed`, per §4.5 |
| 11 | `banhao_revenue_satang` | `commission + service_fee + (delivery_fee − rider_payout)` |
| 12 | `banhao_cost_satang` | `payment_cost + platform_funded_promotion + rider_topup` |
| 13 | `banhao_contribution_satang` | `revenue − cost` |
| 14 | `min_contribution_satang` | From config; the applicable floor |
| 15 | `serviceable` | `contribution ≥ floor` **and** every hard constraint satisfied |

**Explicitly excluded from `banhao_revenue`:** merchant payable and rider
payable. They are liabilities, never revenue — a rule this engine must enforce
structurally, not by convention.

**Minimum safe customer price.** The engine must answer *"what is the minimum
customer price that satisfies the floor?"* by solving step 13 for the
customer-facing total:

```
required_total = smallest T such that
    revenue(T) − cost(T) ≥ min_contribution
```

Because `payment_cost` is itself a function of the total, this is solved
directly rather than iteratively:

```
contribution = commission + service_fee + (delivery_fee − rider_payout)
             − pct × total − fixed − platform_promotion
```

with `total = subtotal + delivery_fee + service_fee − discount`. Given fixed
subtotal and rider requirement, the only free lever is `delivery_fee` (and
`service_fee` where the mode allows), so the engine solves for the minimum
`delivery_fee` satisfying the floor, then re-runs the **complete** calculation
with that value and re-checks every constraint. **The answer is never accepted
from the solve step alone** — it is always revalidated by a full recomputation.

---

## 6. Dynamic Delivery Pricing

Delivery is priced from **delivery cost, not food value**. A ฿40 order and a
฿400 order carried the same distance impose the same cost.

```
rider_required_earning
    = rider_base
    + (distance_km × rider_per_km)
    + Σ(additional configured components)

effective_rider_requirement
    = MAX(rider_required_earning, rider_floor)

delivery_fee_from_rider
    = effective_rider_requirement ÷ rider_share      (rider_share as a fraction)

delivery_fee
    = CLAMP(
        MAX(delivery_fee_from_rider, delivery_fee_min),
        delivery_fee_min,
        delivery_fee_max
      )
    + applicable distance surcharge
```

**Nothing here is hard-coded.** The 80% share and the ฿12 floor discussed in
prior Q-002 analysis are `INITIAL CANDIDATE — NOT LOCKED` values for
`rider_share_basis_points` and `rider_floor_satang`, nothing more.

**The floor-override case must be handled explicitly.** When
`rider_floor > rider_share × delivery_fee`, BANHAO tops up the difference:

```
rider_topup = MAX(0, rider_payout − (rider_share × delivery_fee))
```

That top-up is a **BANHAO cost** (step 12) and must reduce contribution. A
design that computes the rider share but forgets the top-up will systematically
overstate margin on short deliveries — this is the most likely arithmetic error
in the whole system and must be covered by tests.

**Serviceability constraints in this stage:**

- `distance_m > max_service_radius_m` → `NOT_SERVICEABLE(OUT_OF_RADIUS)`
- `delivery_fee_from_rider > delivery_fee_max` → `NOT_SERVICEABLE(DELIVERY_COST_EXCEEDS_CAP)`
- `distance_m` is NULL while mode is `DISTANCE_DERIVED` → `NOT_SERVICEABLE(DISTANCE_UNAVAILABLE)` — **fail closed, never assume a distance** (§14)

---

## 7. Minimum Safe Price

Two distinct questions the engine must answer separately:

1. **"Is this order serviceable at the configured prices?"** — evaluate and
   compare against the floor.
2. **"What is the minimum customer price that would make it serviceable?"** —
   solve, then fully re-evaluate.

The second is what allows an operator or a future UI to explain *why* an order
was refused and what would change the answer. It is also what makes the
simulator (§15) genuinely useful.

**A refusal must always carry a machine-readable reason.** Candidate reason
codes (`INITIAL CANDIDATE — NOT LOCKED`): `BELOW_CONTRIBUTION_FLOOR`,
`OUT_OF_RADIUS`, `DELIVERY_COST_EXCEEDS_CAP`, `BELOW_MIN_ORDER_VALUE`,
`DISTANCE_UNAVAILABLE`, `PROMOTION_BREACHES_FLOOR`, `CONFIG_INVALID`,
`CONFIG_MISSING`, `CALCULATION_ERROR`.

---

## 8. Contribution Protection

### 8.1 The guardrail

```
IF projected_contribution < configured_minimum_contribution
THEN  DO NOT ACCEPT ORDER
```

Enforced sequence, exactly as the owner specified:

```
Calculate
    ↓
Check constraints
    ↓
Calculate minimum safe price
    ↓
Recalculate complete order economics
    ↓
Contribution >= floor?
    ├── YES → serviceable
    └── NO  → NOT SERVICEABLE (with reason)
```

The authoritative evaluation happens **server-side, inside `create_order()`'s
caller path**, before any order row exists. A client-side check may exist for
presentation, but it is never the boundary — consistent with DEC-E-01 and
ADR-001 ("NestJS writes, clients read"), and with the existing rule that no
client-supplied amount is ever accepted.

### 8.2 What this protection is, and is not

This must be stated precisely, because overstating it would be dangerous.

**`Order-level contribution protection`** — at the moment of acceptance, using
the configured parameters and the estimated inputs available at that moment,
BANHAO will not accept an order whose projected contribution is below the
configured floor.

**It is not a guarantee that BANHAO can never lose money.** Losses remain
possible after acceptance, from at least:

| Post-acceptance loss source | Why it escapes order-level protection |
|---|---|
| Refund | Returns customer money; the processing fee may not be recoverable |
| Chargeback | Full order value plus possible fee, after the fact |
| Actual rider distance exceeding estimate | The fee was fixed from an estimate |
| Failed delivery | Rider compensation may still be owed (DEC-053) |
| Merchant failure | Cooked-food loss allocation (DEC-051/052/053) |
| Platform-funded promotion applied late | If not included in the pricing evaluation |
| Payment/refund fees diverging from assumption | §4.5 holds assumptions, not actuals |
| Fraud | Outside pricing entirely |
| Operational costs | Support, infrastructure, staff — never in per-order contribution |

**Any UI, document or report describing this system must use the term
`order-level contribution protection` and must not claim BANHAO "cannot lose
money".** That distinction is a requirement of this specification, not a
stylistic preference.

---

## 9. Promotion

Promotion must be evaluated **inside** the pricing engine, before the
serviceability verdict — never applied afterwards to an already-accepted price.

| Funder | Economic effect |
|---|---|
| `MERCHANT` | Reduces merchant proceeds; BANHAO contribution unaffected |
| `PLATFORM` | Reduces BANHAO contribution directly, satang for satang |
| `SHARED` | Split per configured ratio — **requires a superseding decision; DEC-046 currently locks no-split** |

**Required invariant:**

```
contribution_after_promotion
    = revenue
    − payment_cost
    − rider_topup
    − platform_funded_portion_of_discount

IF contribution_after_promotion < min_contribution_after_platform_promotion
THEN reject the promotion/order combination,
     OR require a higher customer price
NEVER silently absorb the loss
```

Rejecting the *promotion* while still accepting the order at full price is
likely the better customer outcome, but which of the two behaviours applies is
an **owner decision**, not a technical one.

**Note on current state:** `orders.discount_satang` is always 0 today and the
`PROMOTION_FUNDING` ledger account exists but has never been written. This
section is therefore forward-looking design; it changes nothing that currently
runs. BQ-030's stacking half remains open and is not solved here.

---

## 10. Config Versioning

**A pricing configuration is immutable once activated.** Editing produces a new
version; it never mutates an active one.

```
DRAFT  →  VALIDATED  →  ACTIVE  →  RETIRED
```

| Transition | Rule |
|---|---|
| `DRAFT → VALIDATED` | Must pass every validation rule in §14.2 plus a simulation suite |
| `VALIDATED → ACTIVE` | Explicit activation by an authorized actor, with a mandatory reason |
| `ACTIVE → RETIRED` | Automatic when a successor becomes `ACTIVE` |
| Any → edit | **Not permitted on `ACTIVE` or `RETIRED`.** Clone to a new `DRAFT` instead |

**Identity and metadata** (conceptual — no schema is created by this document):

| Field | Purpose |
|---|---|
| `id` | Surrogate identity |
| `version` | Monotonic integer, human-facing (`Pricing Config v17`) |
| `status` | `DRAFT` \| `VALIDATED` \| `ACTIVE` \| `RETIRED` |
| `parameters` | The full §4 parameter document |
| `effective_from` / `effective_to` | Activation window |
| `created_by` / `created_at` | Authorship |
| `validated_by` / `validated_at` | Who cleared validation |
| `activated_by` / `activated_at` | Who took responsibility for going live |
| `retired_at` | When superseded |
| `change_reason` | **Mandatory free text** — follows DEC-032's operator-reason precedent |

**At most one `ACTIVE` configuration may exist at a time.** This should be
enforced by a partial unique index in the database — the same
insert-first/DB-is-the-authority discipline ADR-003 and
`reconciliation_cases_refund_open_key` already establish — never by an
application-level check.

**Audit trail.** Reuse the existing `audit_logs` table rather than inventing a
parallel mechanism: `entity_type = 'pricing_config'`, `entity_id = <config id>`,
`before`/`after` carrying the parameter documents, `reason` mandatory,
`actor_type`/`actor_id` from the verified staff identity. The table is already
append-only and already accepts `OPERATOR`/`ADMIN` actors.

**Historical orders are never recalculated.** An order priced under v17 remains
economically described by v17 forever, regardless of how many versions follow.

---

## 11. Order Pricing Snapshot

Every accepted order must retain enough to reconstruct *why it was priced that
way and why it was accepted* — without consulting current configuration.

Required snapshot content:

| Field | Why it is needed |
|---|---|
| `pricing_config_version` | Which rules applied |
| `pricing_engine_version` | Which formula implementation applied |
| `food_subtotal_satang` | Already on `orders` |
| `merchant_commission_satang` | Currently derived at payment time, not stored on the order |
| `service_fee_satang` | Already on `orders` |
| `delivery_fee_satang` | Already on `orders` |
| `discount_satang` + `promotion_funder` | Funder is **not** currently stored |
| `distance_m` | Column exists; **never populated today** |
| `rider_required_earning_satang` | Not currently stored |
| `rider_payout_satang` | Not currently stored |
| `rider_topup_satang` | Not currently stored |
| `payment_fee_assumption_satang` | Assumption used at pricing time |
| `banhao_revenue_satang` / `banhao_cost_satang` | The two sides of contribution |
| `projected_contribution_satang` | What the engine computed |
| `contribution_floor_satang` | The floor that applied |
| `rounding_applied` | Per-component record of rounding outcomes |
| `serviceability_reasons` | Empty when accepted; retained for rejected evaluations |

**Storage shape is deliberately left open** — additional `orders` columns, a
separate `order_pricing_snapshots` table, or a JSONB document — because the
choice requires a schema decision this specification is not authorized to make.
Whichever is chosen must be **immutable after creation**, in the manner
`orders_enforce_immutable_columns` already achieves for the existing money
columns.

**Q-020 compatibility is a hard requirement.** Refund reversal currently sources
its amounts from `payments.amount_satang`, `orders.service_fee_satang`, and the
**original posted `MERCHANT_COMMISSION` ledger entry** — never a recomputation.
The snapshot must not change those sources; it should be additive. See §13.

---

## 12. Rounding

Single canonical approach. Ambiguity here produces money that does not
reconcile.

| Rule | Statement |
|---|---|
| R1 | All monetary values are **integer satang**. No floating-point value ever represents money (CON-003) |
| R2 | Rates are stored as **basis points** (integers), never decimals |
| R3 | Percentage application uses integer arithmetic: `value × bp` computed first, division last |
| R4 | Rounding happens **once per component**, at the point the component is finalized — never twice, never on an already-rounded value |
| R5 | Distance is integer metres; kilometre conversion happens inside the rider formula, with a single rounding at the end |
| R6 | The customer-visible total is the **sum of already-rounded components**, never a re-rounding of a running total |
| R7 | Every rounding outcome is recorded in the snapshot (§11) |
| R8 | The rounding rule for each component is a **configuration parameter**, so a change is a versioned config change, not a code change |

### 12.1 Payment processing cost — rounding rule

```
IMPLEMENTATION PREREQUISITE / OWNER-CONTRACT CONFIRMATION REQUIRED
```

The payment-fee component (§4.5) is singled out here because, unlike every
other component in the R1–R8 table, its exact real-world value is not
determined by BANHAO's own configuration at all — it is set by Stripe's own
billing, which this specification cannot observe. **The 1.65% PromptPay rate
itself is not newly verified by this rule; it remains attributed exactly as
DEC-055 clause 3 records it — an external provider-cost assumption, sourced
from Stripe's published Thailand pricing, not a contracted or confirmed figure
for BANHAO's own account.** This rule only specifies how that assumption is
computed and rounded for BANHAO's own internal purposes; it does not touch the
rate's status.

**Three distinct precisions must not be confused, and this specification keeps
them separate:**

| Layer | Purpose | Precision | Where it is used |
|---|---|---|---|
| **1. Economic simulation** | Scenario tables, the simulator (§15), owner decision material | Exact decimal — no rounding applied, values shown to 2 decimal places for readability only | Illustrative documents such as the Owner Decision Pack; never a system of record |
| **2. Internal integer-satang accounting** | What the pricing engine actually computes and stores | Integer satang only (CON-003) — a rounding rule is required and specified below | `PricingResult.payment_cost_satang`, the order pricing snapshot (§11), the contribution guardrail (§8) |
| **3. Provider-reported actual cost** | What Stripe actually charges BANHAO's account for a given payment | Whatever precision and billing cycle Stripe's own systems use — not observable from this specification | Later reconciliation (§17's *"assumed vs actual payment cost divergence"* metric) — never the acceptance-time guardrail |

**The engine's contribution guardrail (§8) uses Layer 2 — the rounded,
calculated cost — never Layer 3.** Layer 3 does not exist at the moment an
order is evaluated; Stripe's actual per-transaction billing is not available
synchronously at pricing time, and DEC-055 clause 3 already establishes that
provider fees must not be hard-coded into payment state, order, ledger,
commission or delivery logic — the same principle applies to *when* they may
gate acceptance. Using Layer 3 for acceptance would make order serviceability
depend on a value the engine cannot read before the order exists.

**Calculation and rounding, Layer 2:**

```
raw_fee_satang    = customer_total_satang × payment_percent_fee_basis_points ÷ 10000
                    + payment_fixed_fee_satang
payment_cost_satang = ROUND_HALF_UP(raw_fee_satang)      -- rounds to the nearest satang
```

- **Precision before rounding:** the multiplication is performed in integer
  satang × integer basis points (no intermediate decimal or floating-point
  representation, per R1), so `raw_fee_satang` carries no fractional satang of
  its own — the division by `10000` is the only point a fraction can appear,
  exactly the same shape DEC-043's own commission arithmetic already uses.
- **Conversion into integer satang:** the division result is rounded **once**
  — per R4, never re-rounded later in the pipeline.
- **Rounding mode:** round-half-up, for consistency with `commission_rounding_rule`'s
  default and DEC-043's own convention — but, per R8, this is itself a
  configuration parameter, not a hard-coded mode. A configuration may choose
  `ROUND_DOWN_TO_SATANG` instead if a future owner decision prefers a
  conservative (BANHAO-favourable) bias.
- **Whether rounding occurs once or at intermediate steps:** **once**, at the
  point `payment_cost_satang` is finalized — consistent with R4 and R6. It is
  never re-derived from an already-rounded customer total component by
  component.
- **Fractional satang:** cannot survive past this single rounding step; the
  stored and snapshotted value is always a whole-satang integer.
- **Used for contribution protection:** **yes** — `payment_cost_satang` (Layer
  2) is exactly what step 10/12 of the pricing engine (§5) subtracts when
  computing `banhao_contribution_satang` and comparing it to the configured
  floor. The guardrail's serviceability verdict is therefore always evaluated
  against the *calculated* cost, never a provider-confirmed actual.
- **Reconciliation:** Layer 3 (the provider-reported actual fee, once it
  becomes available from Stripe's own records) is compared against Layer 2's
  stored assumption *after the fact*, as an observability metric (§17) — never
  as an input to the original acceptance decision, which has already been made
  and recorded immutably in the order pricing snapshot (§11).

**What remains genuinely unknown and requires confirmation before
implementation:** the exact billing precision Stripe uses internally, whether
Stripe's fee is computed per-transaction or aggregated over a settlement
period, and whether BANHAO's actual contracted rate for its own account
matches the 1.65% published-pricing assumption at all. **This specification
does not invent an answer to any of those — it marks them explicitly as
prerequisites**, consistent with §20's existing requirement to confirm the
rate against Stripe's Thailand terms before real-money operation.

**DEC-043 is not changed by this document.** Its rule —
`floor((subtotal_satang × 8 + 5000) / 10000) × 100`, i.e. round-half-up to whole
baht on 8% of food subtotal — remains the locked and implemented behaviour.

**How a configurable system would supersede it, in future:** the initial
`ACTIVE` configuration would be authored to reproduce DEC-043 exactly
(`commission_mode = PERCENT_OF_FOOD_SUBTOTAL`,
`commission_rate_basis_points = 800`,
`commission_rounding_rule = ROUND_HALF_UP_TO_BAHT`), producing **byte-identical
output** to the current constant for every input. Only after that equivalence is
proven by test would a superseding decision (§21) authorize changing the values.
**Migrating the mechanism and changing the numbers must be two separate,
separately-approved steps.**

---

## 13. Refund Compatibility

Q-020 is **not** redesigned, modified or reopened by this specification.

**What must remain true:**

1. Refund reversal continues to source amounts from **original records** —
   `payments.amount_satang`, `orders.service_fee_satang`, and the original
   `MERCHANT_COMMISSION` ledger entry — never from current configuration and
   never recomputed (DEC-059 clause C is explicit).
2. A refund on an order priced under v17 uses **v17 economics**, permanently.
   Because reversal already reads historical records rather than recomputing,
   this property holds automatically — the pricing snapshot strengthens the
   evidence trail without changing the mechanism.
3. The three reversal groups (`CUSTOMER_PAYMENT_REFUND`,
   `SERVICE_FEE_REVENUE_REFUND`, `MERCHANT_COMMISSION_REFUND`) and their
   `group_key` idempotency are untouched.
4. DEC-057's finality rules, DEC-058's authority boundaries and DEC-060's
   reconciliation kinds are untouched.

**Gaps this specification surfaces but does not resolve** — each needs a future
decision question:

| Gap | Nature |
|---|---|
| Delivery-fee revenue is unrecognized, so a refund has nothing to reverse for it | Pre-existing ledger gap; a configurable delivery margin makes it more visible, not worse |
| Platform-funded promotion has no ledger posting (`PROMOTION_FUNDING` unused), so it cannot be reversed | Requires a decision on promotion accounting |
| Rider top-up has no ledger representation distinct from `PLATFORM_WRITE_OFF` | Requires a decision |
| Whether the processing fee is recoverable on refund | Must be confirmed against Stripe's Thailand terms (§20) |
| Whether a refund should reverse the *projected* contribution or only actual postings | Accounting decision |

---

## 14. Admin Economics Control Center

### 14.1 Capabilities

A new authenticated Admin section allowing an authorized operator to view the
`ACTIVE` configuration, create a `DRAFT`, edit a `DRAFT`, run validation, run
the simulator (§15), activate a `VALIDATED` configuration with a mandatory
reason, and read the full version history with its audit trail.

**Configurability must not mean the ability to create an economically unsafe
configuration.** Validation is the point of the design, not a formality.

### 14.2 Validation rules

Candidate rules — every one `INITIAL CANDIDATE — NOT LOCKED` as to its
threshold, though the *existence* of each check is part of this design:

| # | Rule |
|---|---|
| V1 | No fee, rate, floor or cap may be negative |
| V2 | `rider_share_basis_points` within a valid range (0 < share ≤ 10000) |
| V3 | `min_contribution_satang ≥ 0` |
| V4 | `delivery_fee_max_satang > delivery_fee_min_satang` |
| V5 | `max_service_radius_m > 0` |
| V6 | Where a cap and floor both exist, `cap ≥ floor` |
| V7 | The delivery formula must cover the rider payout across the full configured radius — i.e. for every distance up to the maximum, the derived fee (after clamping) must satisfy the rider requirement, or the configuration is rejected |
| V8 | The configuration must produce a contribution ≥ floor across a **standard scenario grid** (food subtotals × distances) before it can be `VALIDATED` |
| V9 | Every parameter the active `delivery_pricing_mode` requires must be present |
| V10 | `DISTANCE_DERIVED` mode cannot be validated while distance is unavailable (§23) |
| V11 | Promotion caps cannot exceed what the contribution floor tolerates |
| V12 | Rounding rules must be specified for every component |

**V7 and V8 are the substantive ones.** They convert "the operator typed
numbers" into "the numbers were proven to hold across the intended operating
envelope." A configuration that fails either must not reach `VALIDATED`.

### 14.3 Authorization

Reuse the existing model without inventing a new one: `@Roles('ADMIN')` — or
`ADMIN` only rather than `OPERATOR`, which is an **owner decision** — resolved
through `platform_staff` via `CapabilitiesService`, per request and uncached
(DEC-033 / DEC-APP-004), behind the existing global `RolesGuard`. Activation
carries a mandatory reason, following DEC-032. No customer, merchant or rider
may read or write pricing configuration. **AI has no authority over pricing
configuration of any kind** — consistent with DEC-040 and DEC-058's restatement
of it for financial domains.

---

## 15. Simulator

An Admin tool answering *"what would this configuration do?"* before it is
activated, and *"why did this order price that way?"* afterwards.

**Inputs** (all overridable): food subtotal, distance, rider base, rider per-km,
rider floor, rider share, commission rate and rounding, service fee mode and
value and cap, payment fee assumption, promotion amount and funder,
contribution floor.

**Outputs:** customer pays · merchant receives · rider receives · payment cost ·
BANHAO revenue · BANHAO cost · BANHAO contribution · contribution as a
percentage of customer payment · minimum safe customer price · serviceable
yes/no · reason codes if not.

**Provenance labelling is mandatory.** Every output must state whether its
inputs came from:

- `ACTIVE CONFIGURATION` — what production is doing right now
- `DRAFT CONFIGURATION vN` — what a proposed version would do
- `MANUAL SIMULATION OVERRIDE` — hypothetical values not tied to any configuration

An unlabelled simulator result is a source of expensive misunderstanding; the
labelling requirement is part of the specification.

**Batch mode** should evaluate a grid (food subtotals × distances) and surface
minimum, median and negative-contribution counts — the same evidence V8
requires, presented for a human.

---

## 16. Kill Switch

The engine **fails closed**. Preferring *"do not accept a new order"* over
*"accept an order with unknown economics"* is the governing rule.

| Condition | Behaviour |
|---|---|
| No `ACTIVE` configuration exists | Refuse new orders — `CONFIG_MISSING` |
| `ACTIVE` configuration fails runtime validation | Refuse — `CONFIG_INVALID` |
| A required parameter is missing for the active mode | Refuse — `CONFIG_INVALID` |
| Calculation throws, overflows, or produces a non-integer satang value | Refuse — `CALCULATION_ERROR` |
| `distance_m` unavailable while mode is `DISTANCE_DERIVED` | Refuse — `DISTANCE_UNAVAILABLE` |
| Version inconsistency between evaluation and order creation | Refuse — re-evaluate (§18) |

**Never fall back to the old flat constants automatically.** A silent fallback
would produce orders priced under rules nobody chose, which is precisely the
failure this architecture exists to prevent.

**Operator visibility.** A refusal of this class is an operational incident, not
a customer-facing pricing outcome: it must be logged with its reason code,
surfaced prominently in the Economics Control Center, and counted in the
observability metrics (§17). The existing `reconciliation_cases` pattern is a
reasonable model for making such a condition durable and operator-resolvable,
though whether to reuse that table or add another is a schema decision outside
this document.

---

## 17. Economic Observability

The system must be able to answer: **"Are we actually making money per order in
the real world?"**

**Counters:** orders evaluated · orders accepted · orders rejected for
contribution floor · rejected for radius · rejected for minimum order value ·
rejected for `CONFIG_INVALID`/`CONFIG_MISSING`/`CALCULATION_ERROR` ·
`DISTANCE_UNAVAILABLE` refusals · promotion/order combinations rejected.

**Distributions:** average, median and minimum contribution · **count of
negative-contribution orders (should be zero at acceptance; any non-zero value
is a defect)** · contribution by distance band · contribution by food-subtotal
band · contribution by `pricing_config_version`.

**Money:** platform-funded promotion spend · refund loss · actual payment cost ·
**assumed vs actual payment cost divergence** · rider payout total · rider
top-up total · delivery revenue vs rider cost.

**Two metrics matter more than the rest.** First, *projected contribution versus
realized contribution* — the gap between what the engine promised at acceptance
and what the ledger shows after refunds, top-ups and fee divergence. That gap is
the honest measure of whether the model works. Second, *contribution by config
version*, which is what makes a pricing change evaluable rather than merely
deployed.

**Prerequisite, stated plainly:** the repository currently has **no Sentry
integration and no alerting of any kind**. This section describes new
capability, not configuration of something existing.

---

## 18. Concurrency

The dangerous case: an Admin activates v18 while a customer is mid-checkout
under v17.

**Design:**

1. **Checkout pins a version.** When the customer is shown a price, the
   evaluation records `pricing_config_version` alongside the quoted amounts.
2. **Server revalidation immediately before order creation is mandatory.** The
   authoritative evaluation runs again, server-side, at order creation — never
   trusting the earlier quote.
3. **Version-change handling on revalidation** is an owner decision between two
   defensible behaviours: *honour the pinned version* for a bounded window (best
   customer experience), or *re-price under the new version and require
   re-confirmation if the total changed* (strictest economics). The engine must
   support whichever is chosen; this document does not choose.
4. **Read consistency.** The evaluation resolves the active configuration
   **once** per evaluation and uses that snapshot throughout, so a mid-calculation
   activation cannot produce a hybrid result.
5. **The snapshot is written atomically with the order**, in the same
   transaction as `create_order()`, so an accepted order can never exist without
   its economics.
6. **No client-supplied price is ever accepted.** The existing contract already
   sends `expectedLines` for validation rather than authoritative amounts, and
   that property must be preserved: a mismatch is a rejection, never a
   negotiation.

---

## 19. Security / Authorization

| Concern | Requirement |
|---|---|
| Who may read configuration | `OPERATOR`/`ADMIN` via `platform_staff` — owner decides whether `OPERATOR` sees it |
| Who may create/edit a `DRAFT` | Restricted staff role — **owner decision** |
| Who may activate | Should be the narrowest role, with mandatory reason (DEC-032 precedent) |
| Customers / merchants / riders | **No read, no write, ever** |
| AI | **No authority of any kind** over pricing configuration (DEC-040) |
| RLS | Configuration tables must follow the established pattern: `revoke ... from anon, authenticated` **first**, RLS enabled, service-role only |
| Client bundles | No rate, fee or formula may reach any client bundle — preserving the current property that pricing constants are private and unexported |
| Audit | Every create, validate, activate and retire logged to `audit_logs` with actor, before/after and reason |
| Immutability | An `ACTIVE` or `RETIRED` configuration must be unmodifiable, enforced by trigger in the manner of `orders_enforce_immutable_columns` |

---

## 20. Legal / Tax Boundaries

**No legal advice is given in this document, and none should be inferred.**
Engineering specification is kept strictly separate from legal conclusion.

**Requires Thai legal review:** seller-of-record model (Q-002 itself, still
`OPEN` / `LEGAL_REVIEW_REQUIRED`) · custody of customer funds between collection
and settlement · merchant and rider settlement obligations · refund
responsibility · chargeback responsibility · rider engagement classification ·
consumer-protection obligations · **fee disclosure requirements, which directly
constrain how configurable pricing may be presented to customers**.

**Requires Thai tax/accounting review:** gross versus net revenue recognition ·
VAT treatment of commission, service fee and delivery fee · invoicing
obligations · whether a configurable, versioned fee structure creates any
additional record-keeping obligation.

**Requires confirmation against Stripe's Thailand terms:** the actual
PromptPay processing rate (all rates in this document are assumptions) ·
**whether the processing fee is returned on a refund** — which directly
determines the `refund_fee_is_recoverable` parameter · whether the intended
structure is permitted under Stripe's own terms.

**A configurable pricing system does not make any pricing lawful.** Configuration
freedom must operate inside whatever disclosure and consumer-protection limits
legal review establishes.

---

## 21. Required Future DEC Supersessions

**No decision is modified by this document.** Listed for planning only.

| Decision | Current lock | Would need superseding if… |
|---|---|---|
| **DEC-035** | Delivery fee flat ฿10, explicitly **no distance, no bands, no zones** in Phase 1 | …any distance-derived or configurable delivery pricing is adopted. This is the **most direct conflict** in this specification — DEC-035 rules out by name what §6 designs |
| **DEC-036** | Service fee fixed ฿5 — "not a percentage, not a percentage with a cap or a minimum, not tiered" | …a percentage or capped service fee mode is adopted |
| **DEC-043** | Commission 8% of food subtotal, round-half-up to whole baht | …the rate or rounding becomes configurable, or the value changes. Note §12: reproducing DEC-043 exactly through configuration is mechanism-migration; changing the number is a separate decision |
| **DEC-044** | Rider earning flat ฿12 | …the rider share/floor/base/per-km model replaces the flat amount |
| **DEC-045** | The ฿2 delivery funding gap is a `PLATFORM_WRITE_OFF` | …delivery pricing covers rider cost, since the structural ฿2 gap would no longer exist as a constant |
| **DEC-046** | Promotion funder `PLATFORM` or `MERCHANT`, **no split** | …`SHARED` funding is enabled |
| **DEC-E-01** | Server is the sole pricing authority | Not superseded — **reinforced** by this design |
| **Q-002** | `OPEN` / `LEGAL_REVIEW_REQUIRED` | Must be locked before settlement architecture; this specification is deliberately independent of which model is chosen |

**Sequencing note:** the configuration *mechanism* can be specified and even
built to reproduce current locked values byte-for-byte without superseding
anything. Only *changing the values* requires the supersessions above. Keeping
those two steps separate is strongly advisable and is a recommendation of this
document.

---

## 22. Open Owner Decisions

Every item below is `OWNER DECISION REQUIRED`. None is decided here.

| # | Decision | Status |
|---:|---|---|
| 1 | Commission rate | `OWNER DECISION REQUIRED` |
| 2 | Commission rounding rule | `OWNER DECISION REQUIRED` |
| 3 | Service fee model — fixed, percentage, or percentage with cap | `OWNER DECISION REQUIRED` |
| 4 | Service fee cap | `OWNER DECISION REQUIRED` |
| 5 | Rider share | `OWNER DECISION REQUIRED` |
| 6 | Rider floor | `OWNER DECISION REQUIRED` |
| 7 | Rider base component | `OWNER DECISION REQUIRED` |
| 8 | Rider per-km component | `OWNER DECISION REQUIRED` |
| 9 | Minimum delivery fee | `OWNER DECISION REQUIRED` |
| 10 | Maximum delivery fee | `OWNER DECISION REQUIRED` |
| 11 | Minimum contribution per order | `OWNER DECISION REQUIRED` |
| 12 | Maximum service radius | `OWNER DECISION REQUIRED` |
| 13 | Minimum order value | `OWNER DECISION REQUIRED` |
| 14 | Promotion policy — funders allowed, caps, reject-promotion vs reject-order | `OWNER DECISION REQUIRED` |
| 15 | Settlement cadence for merchants and riders | `OWNER DECISION REQUIRED` |
| 16 | Distance source and accuracy policy — geocoding provider, estimate vs actual, who absorbs the variance | `OWNER DECISION REQUIRED` |
| 17 | Which staff role may activate a configuration | `OWNER DECISION REQUIRED` |
| 18 | Version-change behaviour mid-checkout (§18.3) | `OWNER DECISION REQUIRED` |

---

## 23. Implementation Prerequisites

Ordered by how hard they block.

| # | Prerequisite | Severity |
|---:|---|---|
| 1 | **Address geocoding.** `addresses.lat`/`lng` are NULL in practice and `orders.distance_m` is never populated. Without distance, `DISTANCE_DERIVED` mode cannot function at all | **HARD BLOCKER** for dynamic delivery |
| 2 | **A distance/routing source**, plus a documented accuracy policy. Prior research recorded that no provider publishes district-level accuracy for Thailand — the reason DEC-035 chose a flat fee | **HARD BLOCKER** for dynamic delivery |
| 3 | **Superseding decisions** for DEC-035/036 (and others per §21) before any value changes | **BLOCKER** for changing values |
| 4 | **Schema authorization.** Configuration tables and snapshot storage require migrations; the schema currently requires explicit instruction for any change | **BLOCKER** for implementation |
| 5 | **Q-002 lock** for settlement, though **not** for the pricing engine itself — the engine is model-independent | Blocker for settlement only |
| 6 | **Ledger completion** — merchant payable and delivery-fee revenue are unposted, so computed contribution will not reconcile to the ledger until they exist | **HIGH** — undermines §17's realized-contribution metric |
| 7 | **Observability foundation** — no Sentry, no alerting exists today | **HIGH** |
| 8 | **Admin app surface** — the Economics Control Center is new construction | MEDIUM |

**A practical consequence worth stating:** items 1 and 2 mean the configuration
system, the contribution guardrail, the versioning, the snapshot and the
simulator are all buildable **before** dynamic distance pricing is possible.
`FLAT` delivery mode with a configurable amount and a contribution floor
delivers most of the owner's stated intent without waiting for geocoding.

---

## 24. Explicit Non-Goals

This specification does **not**:

- authorize any implementation, migration, schema change or deployment;
- lock, propose or endorse any numeric economic value;
- modify DEC-035, DEC-036, DEC-043, DEC-044, DEC-045, DEC-046 or any other decision;
- redesign, modify or reopen Q-020 (DEC-057/058/059/060) in any respect;
- decide Q-002's merchant-of-record model — the engine is deliberately independent of it;
- resolve BQ-030 (promotion stacking) or BQ-024 (rider compensation amount);
- design settlement or payout, which remain unbuilt and gated on Q-002;
- provide legal, tax or accounting advice or conclusions;
- claim that BANHAO cannot lose money — only **order-level contribution protection** is designed here (§8.2);
- assert any Stripe fee, term or behaviour as established fact.

---

## Document Status

```
Q-002 ECONOMICS ARCHITECTURE SPECIFICATION
OWNER DIRECTION APPROVED
NUMERIC ECONOMIC VALUES NOT LOCKED
IMPLEMENTATION NOT AUTHORIZED
```

Nothing in this document is a decision. It becomes actionable only after the
owner answers §22, qualified review clears §20, and the supersessions in §21 are
formally locked.
