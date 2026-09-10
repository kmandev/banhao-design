# Q-018 / TQ-004 — Routing, Geocoding and Distance Provider

**Status:** `OPEN` · **Priority:** T1 · **Type:** research + decision preparation
**Related decision:** **D-16 (distance provider/source) — `OPEN`**
**Last updated:** 2026-09-10

> **This document decides nothing.** It is the authoritative research and
> decision-preparation record for **Q-018** (map/address accuracy) and
> **TQ-004** (map, routing and geocoding provider). It prepares **D-16** for a
> future owner lock. **D-16 remains `OPEN`.**
>
> **No production routing exists in this repository**, no routing provider is
> integrated, no credential is configured, and no external routing API was
> called while producing this document.

---

## 0. Evidence classification

Every claim in this document carries one of the following labels. Nothing is
presented as a fact unless it was verified against this repository or against a
cited source.

| Label | Meaning |
|---|---|
| `VERIFIED` | Checked directly against this repository at the stated path, or against a cited primary source on the stated date. |
| `RESEARCHED` | Recorded from prior desk research already in this repository. Correct as of its own recorded date; not re-verified here. |
| `OWNER-APPROVED DIRECTION` | The Product Owner has approved this as the intended direction. **It is not a locked decision.** |
| `ASSUMED` | A working assumption. Not measured, not sourced. Must not be used as a basis for a lock. |
| `PENDING FIELD TEST` | Cannot be settled by desk research. Requires measurement against real Buntharik routes. |
| `OPEN DECISION` | Awaits an owner decision. |

---

## 1. Owner-approved direction — Phase 1 is Google-first

`OWNER-APPROVED DIRECTION — PENDING FIELD VALIDATION`

The Product Owner has approved the following direction for BANHAO Phase 1. It is
a direction, **not** a D-16 lock.

1. **Google Routes "Compute Routes" is the intended Phase 1 authoritative
   road-routing engine.**
2. **PostGIS service-zone polygon membership remains the first, free
   pre-check** and the primary routing cost-control layer.
3. **BANHAO progressively captures real delivery and rider route intelligence**
   from completed deliveries, so that actual local delivery behaviour can
   eventually improve routing economics and routing quality.
4. **OSRM is a future cost-optimization candidate only**, to be reconsidered
   when order volume and total cost of ownership justify operating it.
5. **TomTom, HERE and Mapbox are not added to the Phase 1 production
   architecture** unless later evidence demonstrates a concrete advantage.

**D-16 remains `OPEN` pending field-test evidence.** This document must not be
read as, quoted as, or converted into a locked decision.

---

## 2. Phase 1 target architecture

`OWNER-APPROVED DIRECTION`

```text
Customer / Restaurant coordinates
        ↓
PostGIS Service-Zone Polygon
        ↓
inside service zone?
   NO → NOT_SERVICEABLE
   YES
        ↓
Google Compute Routes
        ↓
road distance + duration
        ↓
BANHAO Pricing Engine
        ↓
D-11 contribution guardrail
        ↓
ACCEPT / REJECT
```

The ordering is deliberate and is itself a cost control: the free local
polygon test runs first and rejects out-of-area requests before any billable
routing call is made.

### Why Google is preferred for Phase 1

The preference reflects what BANHAO currently values, not a claim that Google is
universally superior:

- detailed road routing;
- rural and semi-urban coverage;
- operational simplicity;
- predictable integration;
- **no self-hosted routing infrastructure**;
- **no OSM preprocessing pipeline**;
- **no routing-server maintenance**;
- strong route and duration data suitable as an input to economic calculation.

> **No Buntharik field evidence exists.** `PENDING FIELD TEST`
> This repository contains **no measured comparison** of any provider against
> real Buntharik addresses or routes. Nothing in this document may be read as a
> claim that Google has been field-tested in อำเภอบุณฑริก. Prior research
> (`ai/RESEARCH/MAPS_LOCATION.md`, 2026-08-09) records the opposite: **no
> provider publishes district-level geocoding accuracy for Thailand**, and the
> design's own sample address format is exactly the rural Thai format most
> likely to geocode poorly.

---

## 3. Architectural role of PostGIS

`VERIFIED` — PostGIS is enabled in the deployed schema by
`supabase/migrations/20260809000001_enable_extensions.sql`, and generated
`geography(Point, 4326)` columns already exist (§7).

**PostGIS is not the routing engine.** It computes no road distance and no route.
Its responsibilities are:

- **service-zone polygon membership** — is this coordinate inside a BANHAO
  service polygon?
- **business boundary enforcement** — a commercial statement of where BANHAO
  operates;
- **preventing unnecessary routing API calls** — the free pre-check that runs
  before any billable request;
- **geographic validation** — coordinates present, plausible, inside Thailand,
  inside the operating district;
- **future zone versioning** — polygons change over time and historical orders
  must remain reproducible against the polygon version that priced them (§12).

**The service zone is a business boundary, not a circular radius.** A polygon can
follow roads, rivers, district boundaries and commercial judgement; a radius
cannot.

### D-12 remains authoritative and unchanged

`VERIFIED` — `docs/DECISIONS.md`, DEC-061, D-12.

- **Maximum operational road distance = 15 km.**
- **NOT** a circular radius.
- **NOT** straight-line distance.
- **NOT** geodesic distance.
- Service zones **may** be polygonal.

**This document does not change D-12**, and no PostGIS distance function
(`ST_Distance`, `ST_DWithin`) may be substituted for the road distance D-12
requires. PostGIS answers *"inside the polygon?"*; Google answers *"how far by
road?"*.

---

## 4. Role of Google Compute Routes

`OWNER-APPROVED DIRECTION` — none of the following is implemented.

The research deliberately separates three concerns that are often conflated:

### 4.1 Address / location resolution

Used to obtain trustworthy coordinates for a customer address and a restaurant.
Its quality determines whether everything downstream is meaningful; a confidently
wrong coordinate produces a confidently wrong price.

### 4.2 Road routing

Used to calculate, per priced order:

- road distance;
- route duration;
- the route result itself;
- the timestamp at which the route was computed;
- the identity of the provider that computed it.

### 4.3 Economic calculation

The resulting **road distance** becomes an input to the BANHAO pricing and
economic engine (§10).

### 4.4 Routing is an economic dependency

**Routing is not merely a map-display feature.** Under DEC-061 the road distance
feeds rider compensation (D-08), the customer delivery fee (D-05, D-09, D-10),
serviceability (D-12) and therefore the D-11 contribution guardrail.

**Therefore routing MUST fail closed** whenever routing is required for pricing
or serviceability and a valid route is unavailable. The system must **never
silently**:

- assume 0 km;
- substitute straight-line or geodesic distance for road distance;
- apply a flat fallback distance or a flat fallback fee;
- accept an order without a valid route distance;
- hide the routing cost from the economic model.

This mirrors DEC-061's configuration principles 8, 9 and 10 — invalid
configuration fails closed, missing configuration fails closed, and a configured
zero is valid only when explicitly configured.

---

## 5. BANHAO Local Routing Intelligence (future direction)

`OWNER-APPROVED DIRECTION` — **no implementation work is created by this
document.**

Large delivery platforms improve routing economics over time because they
observe what riders actually do, not only what a routing provider predicts.
BANHAO should progressively build the same capability at its own scale.

> **BANHAO does not have comparable data volume**, and this document makes no
> claim that it does. This is a direction for accumulation over time, not a
> present capability. `ASSUMED` — that useful signal will emerge at BANHAO's
> volume is a hypothesis, not a measured finding.

### Data that a completed delivery could contribute

Subject to PDPA lawful basis and retention (**Q-012**, still `OPEN`, and
**DBQ-005**), and only where legally and operationally appropriate:

- planned route distance;
- planned route duration;
- actual rider GPS trace, where legally and operationally appropriate;
- actual travel distance;
- actual travel duration;
- route deviation between planned and actual;
- pickup location;
- drop-off location;
- road and accessibility issues encountered;
- customer pin accuracy;
- recurring local-road anomalies;
- roads and small alleys (ซอย) where actual rider behaviour differs from
  provider routing.

### Objective — `BANHAO Local Routing Intelligence`

Accumulated over time, this data can later be used to:

- evaluate Google route quality against observed reality;
- identify problematic local roads;
- improve address quality;
- improve service-zone polygon design;
- detect systematic route-distance errors;
- determine whether a self-hosted routing engine becomes economically
  justified;
- eventually reduce routing cost, if an alternative provider or engine can meet
  the required quality.

### Explicit non-goals

- **BANHAO does not build a proprietary routing engine in Phase 1.**
- **This document creates no implementation task.** Nothing here authorizes a
  trace table, a retention policy, a schema change or a migration. Location
  *history* is gated on Q-012 and DBQ-005, and the current location endpoint
  deliberately creates none (§7).

---

## 6. Position of OSRM

`RESEARCHED` + `OWNER-APPROVED DIRECTION`

**OSRM is not the Phase 1 primary provider.** It is a future candidate for one
purpose: **routing-cost optimization at scale.**

Prior research (`ai/RESEARCH/MAPS_LOCATION.md`, 2026-08-09) established what
makes it plausible later: Thailand's OSM extract was **310 MB** (file dated
2026-08-06), small enough to self-host on a modest VPS; OSRM (BSD-2-Clause)
provides Route, Table, Match, Trip and Nearest services. The same research
recorded the counterweights: **OSRM publishes no official RAM requirements** (the
widely-cited ~5× PBF rule of thumb is third-party and unofficial), and **OSM's
own tile server may not be used** under the OSMF tile policy.

### Conditions that must all hold before OSRM is considered

Switching to, or adding, OSRM should only be considered when:

1. BANHAO order volume is sufficiently high;
2. Google routing cost has become economically meaningful;
3. OSRM total infrastructure + operations + OSM-update TCO is genuinely lower;
4. Buntharik route quality passes the required benchmark (§8);
5. rural and small-road coverage is acceptable;
6. latency and availability are acceptable;
7. historical and economic snapshot requirements remain satisfied (§12);
8. failover behaviour is safe;
9. the switch does not weaken D-11 economics (§10).

> **"OSRM is not cheaper merely because the software is open source."**
> The decision must use **total cost of ownership** — server, memory, storage,
> OSM extract updates, preprocessing time, monitoring, on-call, and the
> engineering hours to build and keep it correct — **not API list price alone.**

---

## 7. Repository state — what exists today

`VERIFIED` at commit `897c8b69` on branch `feature/g7-driver-availability`,
2026-09-10.

### 7.1 Geospatial infrastructure that exists

| Item | Path | State |
|---|---|---|
| PostGIS extension | `supabase/migrations/20260809000001_enable_extensions.sql` | Enabled |
| `addresses.lat` / `lng` (`numeric(9,6)`, nullable) + generated `location geography(Point,4326)` | `supabase/migrations/20260811000001_identity_domain.sql:125` | Exists, optional |
| `restaurants.lat` / `lng` + generated `location` | `supabase/migrations/20260811000002_merchant_domain.sql:108` | Exists; **no API write path** (`packages/validation/src/restaurant-profile.ts` rejects `lat`/`lng` in the profile body) |
| `orders.delivery_lat` / `delivery_lng`, `orders.distance_m`, `orders.quoted_eta_minutes` | `supabase/migrations/20260811000005_order_domain.sql:43,63` | Columns exist |
| `deliveries.pickup_lat/lng`, `dropoff_lat/lng`, `distance_m` | `supabase/migrations/20260811000009_delivery_domain.sql:23` | Columns exist |
| `rider_availability.last_lat` / `last_lng` / `location_updated_at` + generated `location` | `supabase/migrations/20260811000008_rider_domain.sql:94` | Exists and is populated in production code |
| `POST /api/v1/rider/location` | `apps/api/src/modules/rider/rider-location.service.ts` | Implemented — **latest position only**: no history table, no append log, no retention or purge mechanism, no staleness rule |

### 7.2 What does not exist

| Absent | Evidence |
|---|---|
| Any routing provider integration | No Google, OSRM, TomTom, HERE or Mapbox client anywhere in `apps/` or `packages/` |
| Any geocoding provider integration | Same |
| Any routing/geocoding **provider abstraction** | No interface exists; the payments `PaymentProvider` abstraction has **no geospatial counterpart** |
| `service_areas`, `zones`, `delivery_fee_bands` tables | Deferred by design — `supabase/migrations/20260811000001_identity_domain.sql:112` and `20260811000008_rider_domain.sql:9` note the geo domain is deferred; `addresses.zone_id` and `rider_availability.service_area_id` are **bare `uuid` columns with no foreign key** |
| Any service-zone **polygon** | No polygon column, table or seed exists |
| Populated `orders.distance_m` | `create_order()` accepts `p_distance_m` (default `null`) but `apps/api/src/modules/orders/orders.service.ts:196` **never passes it** — the column is always `NULL` |
| Distance in pricing | `apps/api/src/modules/orders/order-pricing.service.ts:49` states explicitly that no distance, coordinates, routing, geocoding, zones or restaurant location participate |
| Distance in dispatch | `apps/api/src/modules/rider/broadcast-dispatch.strategy.ts:24` — "No radius. No `ST_DWithin`. No distance." (DEC-037) |
| Route **snapshot** fields | None. There is no provider, road-distance, duration, route-timestamp, geocoding-confidence, pricing-config-version or service-zone-version column on `orders` or `deliveries` |
| Address geocoding | `packages/validation/src/address.ts:37` accepts an **optional, client-supplied** `lat`/`lng` pair (both or neither). Nothing geocodes text |
| Routing credentials | None configured anywhere. None introduced by this document |

**Consequence, restated plainly:** `VERIFIED` — **distance is not computable
today.** This is the same hard blocker DEC-061 records in its *Implementation
status*, and it gates D-07, D-08, D-10 and D-12.

---

## 8. Field-test requirement — what must happen before Q-018 closes

`PENDING FIELD TEST`

**Q-018 must not be closed from documentation research.** Desk research has
already reached its limit: no provider publishes district-level accuracy for
Thailand, and no independent measurement for Buntharik exists.

The field test must eventually compare **actual Buntharik routes** and assess:

| Metric | Why it matters |
|---|---|
| Route success rate | A provider that fails to route is unusable regardless of accuracy |
| Rural-road coverage | อำเภอบุณฑริก is rural; national averages do not apply |
| Small-road / access-road (ซอย) behaviour | Determines whether riders can actually follow the route |
| Median distance difference | Central tendency of pricing error |
| p95 distance difference | Tail error is what breaks rider pay and the D-11 guardrail |
| Duration difference | Feeds ETA and rider expectation |
| Impossible / unusable route rate | Routes that exist but cannot be ridden |
| Latency | Sits on the pre-acceptance path |
| Consistency | Same origin/destination pair must not drift between calls |
| Representative terrain / locality classes | Town centre, หมู่บ้าน, farm access road, cross-ตำบล |

> **No benchmark number appears in this document, and none may be invented.**
> Every value above is `PENDING FIELD TEST` until real tests are performed and
> their results recorded here with their date and method.

The test must be run against **real Buntharik addresses**, not national
averages, exactly as D-16's *Before activation* condition requires.

---

## 9. D-16 status

**D-16 — distance provider/source — remains `OPEN`.** `OPEN DECISION`

`VERIFIED` — DEC-061's *Open items* lists D-16 among the decisions it explicitly
does **not** lock, and states that routing/geocoding provider selection,
including Google, remains OPEN pending the Buntharik geocoding field evaluation,
current provider-pricing verification, and Q-018 / TQ-004.

**Recommended direction for the eventual D-16 lock:** Google Compute Routes as
the Phase 1 authoritative routing provider, with a PostGIS service-zone polygon
as the free pre-check.

**The final decision remains pending field validation.** D-16 should be locked
only after the §8 evidence is produced and reviewed. This document creates no
locked decision, and no agent or engineer may treat §1 or §9 as one.

---

## 10. Economic connection

`VERIFIED` — DEC-061 (`docs/DECISIONS.md`).

Routing output is an input to the locked economic architecture. It affects:

- **delivery pricing** — D-05 (rider receives 80% of the customer delivery
  fee), D-09 (minimum ฿15, derived), D-10 (maximum ฿35);
- **rider compensation** — D-07 (base ฿8) and **D-08 (+฿1.20 per operational
  road kilometre — the metric MUST be road distance, never straight-line or
  geodesic)**;
- **BANHAO contribution** — the residual after commission, service fee,
  delivery economics, promotion funding and payment processing cost;
- **D-11 minimum safe contribution.**

**D-11 remains ฿5** and remains a **strict pre-acceptance, order-level economic
guardrail**: if expected contribution is below ฿5, the order is rejected before
acceptance. **This document does not change D-11.**

> **Preserved architectural distinction — binding.**
> **D-11 protects order-level contribution *before* acceptance. It is NOT a
> guarantee that BANHAO can never lose money after acceptance.** It does not
> eliminate post-acceptance delivery variance, refunds, chargebacks, fraud,
> delivery failures, rider-cost variance, provider fee divergence or
> operational write-offs. **D-11 must never be described as a solvency
> guarantee.**

A wrong road distance therefore produces a wrong customer price, a wrong rider
payment and a wrong contribution — which is why §4.4 requires routing to fail
closed rather than degrade silently.

**Related open item:** **D-17 (distance accuracy policy) is also `OPEN`** — who
absorbs the difference when the quoted distance differs from the actual one.
D-17 depends on D-16 and is out of scope here.

---

## 11. Cost control

### 11.1 Existing pricing evidence — preserved, not restated as new

`RESEARCHED` — all figures below were checked **2026-08-09** and are recorded in
`ai/RESEARCH/MAPS_LOCATION.md`, with citations in `ai/RESEARCH/SOURCES.md`.
**No price in this document is new, and no price was invented.**

- Google's familiar flat **$200/month credit ended in March 2025**, replaced by
  **per-SKU free caps**. The caps being *per SKU* matters for a delivery app:
  Maps, Geocoding, Routes and Route Matrix each get their own allowance rather
  than sharing one.
- **Compute Routes (Essentials): 10,000 free per month, then $5.00 → $0.38 per
  1,000** by volume. Pro tier: 5,000 free, then $10.00 → $0.75.
- **Geocoding (Essentials, forward and reverse on one SKU): 10,000 free, then
  $5.00 → $0.38 per 1,000.**
- **Mobile Maps SDK (SKU 6DE1-4D9C-5B67) is unlimited free.**
- Subscription alternatives to pay-as-you-go: Starter $100/mo (50,000 calls),
  Essentials $275/mo (100,000), Pro $1,200/mo (250,000).

> **`PENDING FIELD TEST` / re-verification:** these prices are over a year old
> relative to any future D-16 lock. DEC-061's *Open items* explicitly requires
> **current provider-pricing verification** and **Google Maps billing
> verification** before the provider question closes. Do not lock D-16 on
> 2026-08-09 pricing without re-checking it.

### 11.2 Why Google may be economically preferable at BANHAO's current scale

`ASSUMED`

At early BANHAO order volume, the **operational simplicity** of a hosted routing
API can outweigh the **total cost of ownership** of self-hosting OSRM — server,
memory, storage, OSM extract updates, preprocessing, monitoring, on-call and the
engineering hours to keep it correct. The PostGIS polygon pre-check further
suppresses billable calls by rejecting out-of-area requests for free.

> **No universal crossover point is claimed.** No order volume at which OSRM
> becomes cheaper than Google is stated in this document, because no such
> calculation has been performed against **measured BANHAO infrastructure
> costs**. Any crossover estimate produced later must be marked **`ASSUMED`**
> until it rests on measured figures.

### 11.3 Cost drivers to watch

`RESEARCHED` — `ai/RESEARCH/MAPS_LOCATION.md` and `ai/RESEARCH/RISK_MATRIX.md`.

- **Rider-location polling frequency** is an engineering choice and is the most
  volatile line in the maps cost model. An aggressive polling design multiplies
  the bill.
- **Route Matrix** calls are billed per element; a matrix over many candidates
  is not a routing call, it is many.
- **Permanent (stored) geocoding** is priced differently from temporary
  geocoding at some providers — a distinction that is easy to miss and that
  applies directly to BANHAO, which would store saved delivery addresses.

---

## 12. Snapshot and audit requirements

`OWNER-APPROVED DIRECTION` — **not implemented, and this document implements
nothing.**

The eventual routing architecture must support **historical reproducibility**.
When routing and pricing are built, an order's pricing/routing snapshot should
preserve, as appropriate:

- pricing configuration version;
- service-zone (polygon) version;
- origin coordinates;
- destination coordinates;
- routing provider identity;
- road distance;
- route duration;
- route timestamp;
- geocoding confidence;
- the economic pricing inputs and results.

**Historical orders MUST NOT silently change economics because a provider,
polygon or configuration changed later.** This restates, for the routing domain,
DEC-061's *Historical order immutability* rule and preserves Q-020: historical
refunds must continue to reverse the **original recorded economics**.

> **None of these fields exists today** (§7.2), and **none is created by this
> document.** This task is documentation and decision preparation only. Adding
> any of them is a future migration requiring an explicit instruction.

---

## 13. Reconciliation — existing text that this direction supersedes

Per the project's own rule that a conflict must be reconciled explicitly rather
than silently overwritten, the following existing statements predate the
owner-approved direction in §1. **None of them is a locked decision**, and none
is rewritten here.

| Location | Existing text | Reconciliation |
|---|---|---|
| `docs/BANHAO-APP-ARCHITECTURE-V1.md` §risk 11 | "MapLibre + OSM at Stage 1; **self-hosted OSRM is the Stage 3 answer**" | **Superseded in direction, not in force.** Under §1 and §6, OSRM is a *future cost-optimization candidate* evaluated on TCO and field-tested quality, not a scheduled Stage 3 answer. This row is a risk-register mitigation note, not a `DEC-APP` decision, and V1.1's decisions are untouched. The row's remaining advice — *never poll aggressively* — **still stands** (§11.3). Formally changing V1.1 requires a new Architecture Decision, which this document does not make. |
| `docs/ARCHITECTURE.md` § "Maps — MapLibre GL + OSM tiles — Prototype only (Q-018)" | Names MapLibre + OSM tiles | **Still accurate as a description of the prototype**, which is all that exists. Map *display* and *road routing* are separate concerns: the owner-approved direction in §1 governs routing, and selects no tile or display library. |
| `docs/OPEN_TECHNICAL_QUESTIONS.md` §TQ-004 | "Field-test before selecting… prefer banded pricing (BQ-026's recommendation) precisely because it tolerates geocoding error" | **"Field-test before selecting" still stands** (§8) and is the reason D-16 stays `OPEN`. The **banded-pricing preference is superseded** by DEC-061, which locked dynamic distance-based delivery economics (D-05…D-10, D-12). Banding is no longer the target model. |
| `docs/OPEN_BUSINESS_QUESTIONS.md` §BQ-026 | Flat fee per DEC-035; distance-banded recommended | **Superseded by DEC-061**, which supersedes DEC-035's flat ฿10 model. Retained there as history, as that entry itself states. |
| `docs/BUSINESS_RULES.md` §"Base + per-km … Risky while Q-018 is open" | Warns against per-km while Q-018 is open | **The risk assessment was correct and remains correct** — which is exactly why routing must fail closed (§4.4), why D-17 exists, and why D-16 is not locked on desk research. DEC-061 accepted the per-km model (D-08) as *policy*; it did not resolve the measurement problem this line describes. |
| `ai/RESEARCH/MAPS_LOCATION.md` | Trade-off table favouring Mapbox/Longdo free tiers; "plausible hybrid: self-hosted OSRM + commercial geocoding" | **Retained as research evidence and still cited (§11.1).** Its explicit non-selection statement — *"This document does not select a provider"* — is unchanged. The owner-approved direction in §1 narrows Phase 1 to Google + PostGIS; **Mapbox, HERE, TomTom and Longdo remain research alternatives only.** |

**No locked historical decision is modified by this document.** DEC-061
(D-01…D-14) is unchanged. DEC-035 and DEC-036 remain superseded by DEC-061, as
DEC-061 itself records.

---

## 14. Decision summary for the next owner review

| Item | Position |
|---|---|
| **Phase 1 routing provider** | **Google Compute Routes** — `OWNER-APPROVED DIRECTION` |
| **Pre-routing geo control** | **PostGIS service-zone polygon** — a business boundary, not a radius |
| **Routing metric** | **Road distance + duration** |
| **Maximum operational road distance** | **15 km** (D-12, locked, unchanged) |
| **Phase 1 routing fallback** | **No automatic cheaper-provider fallback merely for price differences.** Provider fallback may only be introduced later for **verified operational failure modes**, and only after an explicit architecture decision |
| **Future optimization candidate** | **OSRM** |
| **Optimization trigger** | Measured order volume + Google routing cost + **OSRM full TCO** + field-tested route quality (all nine conditions in §6) |
| **Local intelligence** | Collect actual delivery/rider route data progressively — `BANHAO Local Routing Intelligence` (§5), gated on Q-012/DBQ-005, no implementation authorized |
| **Excluded from Phase 1 production** | TomTom, HERE, Mapbox — research alternatives only |
| **D-16** | **`OPEN` — pending field validation** |
| **D-17** (distance accuracy policy) | **`OPEN`** — depends on D-16 |
| **Q-018 / TQ-004** | **`OPEN`** |

---

## 15. Scope of this document

**Documentation and decision preparation only.** While producing it, none of the
following occurred and none is authorized by it:

- no production routing code;
- no Google API integration;
- no OSRM deployment;
- no TomTom, HERE or Mapbox integration;
- no database migration;
- no pricing logic change;
- no change to DEC-061;
- no D-16 lock;
- no credential introduced;
- no external routing API called.

---

## 16. Sources

- `ai/RESEARCH/MAPS_LOCATION.md` — provider capability and pricing research,
  checked 2026-08-09.
- `ai/RESEARCH/SOURCES.md` — primary citations for the above.
- `ai/RESEARCH/RISK_MATRIX.md` — maps cost volatility.
- `docs/DECISIONS.md` — **DEC-061** (D-01…D-14, and the *Open items* list that
  keeps D-16 open), DEC-037, DEC-040.
- `docs/OPEN_TECHNICAL_QUESTIONS.md` — **TQ-004**.
- `docs/OPEN_BUSINESS_QUESTIONS.md` — **Q-018**, BQ-001, BQ-026.
- `docs/Q-002-OWNER-DECISION-PACK.md` — **D-16**, D-17 (decision preparation).
- `docs/Q-002-ECONOMICS-ARCHITECTURE-SPEC.md` — geocoding recorded as a hard
  blocker for dynamic delivery pricing.
- Repository state cited inline in §7, verified at `897c8b69`.
