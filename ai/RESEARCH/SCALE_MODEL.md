# Scale Model

No user, order, or transaction volume figures exist anywhere in the repository — every number below is explicitly an `ASSUMPTION` for planning purposes, not a target or a fact. Where there is genuinely not enough basis to even assume, this file says `TBD` instead of inventing a number. Do not treat any figure here as a requirement or a commitment.

## Stage 1 — อำเภอบุณฑริก (initial launch area)

```
ASSUMPTION
```

อำเภอบุณฑริก is one district (อำเภอ) of จังหวัดอุบลราชธานี. Its total population is a publicly-knowable census figure, but no source has been checked as part of this research task, and population is a weak proxy for addressable users on a new app in any case — so even a population-based estimate is not offered here. Instead:

| Metric | Estimate | Basis |
|---|---|---|
| Users | TBD | No basis to assume |
| Orders/day | ASSUMPTION: low tens to low hundreds | Typical for a single-district food-delivery launch with a handful of participating restaurants; a rough planning floor, not a target |
| Concurrent users (peak) | ASSUMPTION: low tens | Follows from low order volume; most traffic will be browsing, not just ordering |
| Restaurants (merchants) | TBD | Depends entirely on merchant acquisition, unknown |
| Drivers | ASSUMPTION: single digits to low tens | Needs to roughly track order volume; exact ratio unknown |
| API requests/day | TBD | Depends on client polling vs. real-time design (see `ai/RESEARCH/REALTIME.md`) — could vary by 10-100x depending on that undecided choice |
| Storage | ASSUMPTION: low single-digit GB | A few hundred product/shop images at this scale is not storage-intensive |
| Database size | ASSUMPTION: low single-digit GB in year one | Order/user/ledger row counts implied by the order-volume assumption above |
| Notifications/day | TBD | Tied directly to order volume, same uncertainty |
| Maps usage | TBD | Depends entirely on which maps API is chosen and how often driver location updates — see `ai/RESEARCH/MAPS_LOCATION.md` for per-request cost implications |
| Payment transactions/day | ASSUMPTION: tracks order volume roughly 1:1 (cash + PromptPay combined) | Directly implied by order count |

**Planning implication:** Stage 1 volume is low enough that almost any reasonable technology choice can handle the raw throughput — the harder constraints at this stage are correctness (payment/ledger integrity) and low operating cost, not scale.

## Stage 2 — ขยายระดับอำเภอ/จังหวัด (district/province-level expansion)

```
ASSUMPTION
```

If BANHAO expands to cover more of จังหวัดอุบลราชธานี (multiple districts) while still within Phase 1's Food Delivery scope:

| Metric | Estimate | Basis |
|---|---|---|
| Users | TBD | No basis to assume a multiplier without real Stage 1 data |
| Orders/day | ASSUMPTION: roughly 10x Stage 1, low order of magnitude | A province has many districts; even partial coverage plausibly moves from "tens/hundreds" to "hundreds/low thousands" — this is a rough planning multiplier, not a forecast |
| Concurrent users (peak) | ASSUMPTION: low hundreds | Follows the order-volume assumption |
| Restaurants | TBD | Depends on merchant acquisition pace, unknown |
| Drivers | ASSUMPTION: tens to low hundreds | Tracks order volume |
| Database size | ASSUMPTION: tens of GB | Order history accumulation over 1-2 years at this volume |

**Planning implication:** Still within reach of a single well-provisioned server/managed database for most reasonable stack choices; this is the stage where real-time architecture choices (see `ai/RESEARCH/REALTIME.md`) start to matter more for user experience than for raw capacity.

## Stage 3 — ขยายหลายจังหวัด (multi-province expansion)

```
ASSUMPTION
```

| Metric | Estimate | Basis |
|---|---|---|
| Users | TBD | No basis |
| Orders/day | ASSUMPTION: low thousands to tens of thousands | Order-of-magnitude jump consistent with multi-province coverage, not a forecast |
| Concurrent users (peak) | ASSUMPTION: low thousands | Follows order volume |
| Database size | ASSUMPTION: low hundreds of GB after a couple of years | Order/ledger history accumulation |
| API requests/day | TBD | Still depends on the undecided real-time mechanism |

**Planning implication:** This is roughly where horizontal scaling considerations (read replicas, caching, background job scaling, possibly splitting services) start to become a real design question rather than a hypothetical one — see `ai/RESEARCH/ARCHITECTURE_PATTERN.md`.

## Stage 4 — National scale

```
ASSUMPTION
```

| Metric | Estimate | Basis |
|---|---|---|
| Users | TBD | No basis; national food-delivery platforms in comparable markets range enormously and citing a specific figure without a named comparable and source would be fabrication |
| Orders/day | TBD | Same reasoning — genuinely no basis to assume a number responsibly at this range |
| Everything else | TBD | Same reasoning |

**Planning implication:** At this stage, technology decisions made for Stage 1 may need to be revisited entirely — this scale model deliberately does not extrapolate a specific number here, because doing so would be fabrication rather than assumption. What can be said without a number: a modular/monolith-first approach (see `ai/RESEARCH/ARCHITECTURE_PATTERN.md`) should be evaluated for how cleanly it can be split into services *if* Stage 4 is ever reached, even though it should not be over-engineered for that outcome from day one.

## Cross-cutting note

No committed timeline exists for reaching any of these stages (Q-005, `docs/TODO.md`). This scale model should be re-checked against real usage data as soon as Stage 1 actually launches — every `ASSUMPTION` here should be replaced with a `FACT` (with evidence) the moment real data exists, per the confidence-upgrade rule in `ai/README.md`.
