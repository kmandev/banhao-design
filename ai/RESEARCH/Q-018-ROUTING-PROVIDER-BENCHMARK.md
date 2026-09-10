# Q-018 / TQ-004 — Routing, Geocoding and Distance Provider

**Status:** `OPEN` · **Priority:** T1 · **Type:** research + decision preparation
**Related decision:** **D-16 (distance provider/source) — `OPEN`**
**Last updated:** 2026-09-10 (field benchmark design §17–§33; Buntharik fixture acquisition plan §35–§49)

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
| **Field benchmark** | **Designed, not executed** — §17–§33. Objective, fixture matrix, ground-truth tiers, metric formulas, proposed thresholds, D-12 matrix, execution stages and cost controls |
| **Benchmark blocker** | **Real Buntharik coordinate fixtures and a service-zone polygon do not exist** (§20, §32). The repository holds four synthetic dev points inside ~1 km; none is benchmark-eligible |
| **Fixture acquisition** | **Planned, not started** — §35–§49. Target ~20–30 public coordinates supporting ~20–40 routes. **`FIXTURE ACQUISITION REQUIRED` for the entire population** (§46): no real coordinate could be safely established from existing material, and none was fabricated |
| **Fixture privacy rule** | **No customer address, name or phone number is a fixture.** Public POIs only; real customer routing data waits on Q-012, TQ-016 and BQ-022 (§36.2) |
| **Owner decisions pending** | OD-1…OD-8 (§48) — sample size, thresholds, local reviewer, POI sufficiency, web-research follow-up, delivery-GPS use, fixture separation, service polygon |

---

## 15. Scope of this document

**Documentation, decision preparation, benchmark design and fixture-acquisition
planning only.** This applies to every revision of this document, including the
§17–§33 field-benchmark design and the §35–§49 fixture acquisition plan, both
added 2026-09-10. While producing it, none of the following occurred and none is
authorized by it:

- no production routing code;
- no Google API integration;
- no OSRM deployment;
- no TomTom, HERE or Mapbox integration;
- no database migration;
- no pricing logic change;
- no change to DEC-061;
- no D-16 lock;
- no credential introduced;
- no external routing API called;
- no API credit spent;
- no geocoding or map lookup performed;
- no fixture, seed or database row created, mutated or deleted;
- no coordinate fabricated;
- no customer address, name, phone number or other personal data used;
- no change to D-17.

---

## 16. Part II — Field routing benchmark design

Sections 0–15 above are the **research and decision-preparation** half of this
document: what is known, what the owner has approved as a direction, and why
D-16 is not yet lockable.

Sections 17–33 are the **benchmark design** half, added 2026-09-10. They
specify the field test §8 requires — its population, fixtures, ground truth,
metrics, proposed thresholds, economic simulation, execution stages and cost
controls — so that a later, separately authorized task can execute it safely.

Sections 35–49 are **Part III — Buntharik real-world fixture acquisition**, added
the same day. Part II found that the benchmark cannot run at all on the
geography this repository holds; Part III is the acquisition and validation plan
for the real public fixtures it needs, and the privacy rule that bounds them.

**All three parts are documentation.** None implements routing, and none locks
D-16.

---

## 17. Field benchmark — objective and scope

`PENDING FIELD TEST` — this section and everything below it is **benchmark
design and test preparation only.** Nothing here was executed.

### 17.1 The question the benchmark must answer

> **Is Google Compute Routes sufficiently accurate and operationally reliable
> for BANHAO's Buntharik delivery area to become the Phase 1 authoritative
> routing provider?**

A secondary question, deliberately subordinate:

> Does any evidence emerge that a future OSRM deployment would deliver enough
> quality or cost benefit to justify its total cost of ownership?

**The benchmark is not intended to prove OSRM is cheaper.** It is designed so
that "Google remains primary" is a fully supportable outcome (§28).

### 17.2 What was NOT done

No external routing API was called. No Google, OSRM, TomTom, HERE or Mapbox
request was issued, no credential was introduced, no API credit was spent, no
production routing service was created, no migration was written, no pricing
logic was changed, no fixture or database row was mutated. **DEC-061 is
untouched, D-16 and D-17 both remain `OPEN`.**

---

## 18. Benchmark population design

`PROPOSED` — the shape of the population. `FIXTURE REQUIRED` — almost all of
its content (§20).

Every route in the population is a directed pair with a purpose. Aggregate
results alone are not acceptable: the population is stratified so that results
can be read per stratum (§24.9).

### 18.1 Distance bands

Bands are defined on **road distance**, not straight-line distance. A fixture's
band is therefore provisional until a route has been computed for it; the
straight-line estimate is used only to *propose* a band and must be recorded as
such.

| Band | Road distance | Purpose |
|---|---|---|
| **A. Near** | 0–2 km | Baseline. Dominant real order geometry in a district town |
| **B. Local town** | 2–5 km | Baseline. Ordinary in-town delivery |
| **C. Medium** | 5–10 km | Where per-km rider economics start to bind |
| **D. Outer operating area** | 10–15 km | Where D-10's ฿35 fee cap is closest to binding |
| **E. Boundary** | around the service-zone edge and around 15 km | D-12 correctness (§26) |
| **F. Rural / small road** | any band | Coverage, not distance — see below |
| **G. Difficult road network** | any band | Where routing is most likely to fail |

### 18.2 Band F — rural and small-road cases

Band F is a **road-class** stratum, not a distance stratum, and must be sampled
across bands A–D. It must include:

- village roads (ถนนในหมู่บ้าน);
- narrow roads unsuitable for four wheels but normal for a motorcycle;
- small alleys (ซอย);
- roads that may be missing from, or differently represented in, the provider's
  map;
- routes that require turning through local roads rather than staying on a
  numbered highway.

Band F matters more than band C or D: the design's own sample address format is
exactly the rural Thai format prior research flags as most likely to geocode
poorly, and BANHAO's riders are motorcycle riders (มอเตอร์ไซค์), for whom a
route a car cannot take may still be correct — and vice versa.

### 18.3 Band G — difficult cases

Include **where such cases actually exist in Buntharik**:

- road-network detours (the road does not go where the map suggests);
- bridges, and their absence;
- rivers and other uncrossable features;
- road segments that look disconnected in the map data;
- unusual road geometry;
- routes where **straight-line distance differs materially from road distance** —
  the single most economically dangerous class, because it is exactly where a
  geodesic shortcut would misprice an order.

> **Do not manufacture difficult cases.** A synthetic "difficult" pair proves
> nothing about Buntharik. Where a category cannot be populated from real local
> geography, it is recorded as `FIXTURE REQUIRED` (§20) and the benchmark
> reports that stratum as **not evaluated**, never as passed.

### 18.4 Target population size

`PROPOSED — REQUIRES OWNER APPROVAL`

A population large enough for a p95 to mean anything, and small enough to run
under a controlled request budget (§31):

| Stratum | Proposed routes |
|---|---|
| A. Near (0–2 km) | 12 |
| B. Local town (2–5 km) | 12 |
| C. Medium (5–10 km) | 10 |
| D. Outer (10–15 km) | 10 |
| E. Boundary | 8 |
| F. Rural / small road | 16 (sampled across A–D) |
| G. Difficult | 8 |
| **Total distinct routes** | **~76** |

With the §24.8 consistency repeats (3 requests for a 12-route subset) and one
re-run pass, this stays well under 300 Compute Routes requests — inside the
free per-SKU monthly allowance recorded in §11.1, before any paid usage
begins.

---

## 19. Origin / destination record — required fields per fixture

`PROPOSED`

Every benchmark route must carry all of the following. A route missing any
field is not eligible for the accuracy metrics; it may still count toward
route-success reporting if that is explicitly stated.

| Field | Notes |
|---|---|
| `case_id` | Stable identifier, e.g. `B-001` |
| `origin_lat`, `origin_lng` | Decimal degrees, WGS84 |
| `destination_lat`, `destination_lng` | Decimal degrees, WGS84 |
| `semantic_label` | What this pair means in plain language |
| `locality_label` | Town / ตำบล / หมู่บ้าน / outer area |
| `expected_terrain_road_class` | Town road, village road, ซอย, highway, mixed |
| `coordinate_source` | Where each coordinate came from — see §19.2 |
| `coordinate_confidence` | See §19.3 |
| `pair_type` | `RESTAURANT_TO_CUSTOMER` or `POINT_TO_POINT` |
| `proposed_band` | A–G, provisional until routed (§18.1) |
| `service_zone_expectation` | Expected inside/outside, once a polygon exists |
| `d12_expectation` | Expected ≤15 km / >15 km, if known |

### 19.1 `RESTAURANT_TO_CUSTOMER` versus `POINT_TO_POINT`

These must be reported separately.

- **`RESTAURANT_TO_CUSTOMER`** is the shape BANHAO actually prices: a real
  restaurant position to a real delivery address. Its origin is a commercial
  premises on a road; its destination is frequently a house down a ซอย. This is
  the only pair type whose result may be used to argue about pricing accuracy.
- **`POINT_TO_POINT`** is a diagnostic shape used to probe the road network
  (bridges, detours, disconnected segments) without needing a real restaurant at
  one end. Useful for band G; **not** evidence about pricing.

Where realistic BANHAO geography is available, prefer
`RESTAURANT_TO_CUSTOMER`.

### 19.2 `coordinate_source` — permitted values

| Value | Meaning |
|---|---|
| `FIELD_GPS` | Captured on site with a GPS device or phone at the actual location |
| `OWNER_LOCAL_KNOWLEDGE` | Placed by a person who knows the location personally |
| `MERCHANT_SUPPLIED` | Given by the merchant for their own premises |
| `CUSTOMER_PIN` | A real customer-placed pin |
| `PROVIDER_GEOCODED` | Returned by a geocoding provider — **must not be used as ground truth** |
| `SYNTHETIC_DEV_FIXTURE` | Existing dev seed data — **not benchmark-eligible** (§20) |

### 19.3 `coordinate_confidence`

`PROPOSED`

| Level | Meaning | Benchmark eligibility |
|---|---|---|
| `HIGH` | Field-captured or personally known; believed within a few metres | Eligible for all metrics |
| `MEDIUM` | Locally placed from knowledge but not visited | Eligible; flagged in reporting |
| `LOW` | Derived or inferred | Diagnostic only |
| `SYNTHETIC` | Invented test data | **Never eligible** |

> **A benchmark cannot be more accurate than its coordinates.** Distance-delta
> metrics computed against `LOW` or `SYNTHETIC` coordinates measure the fixture,
> not the provider, and must not be reported as provider accuracy.

---

## 20. Fixture availability — what the repository actually has

`VERIFIED` at `25e22b28`, 2026-09-10.

### 20.1 Every persisted coordinate in the repository

| Coordinates | Where | What it is |
|---|---|---|
| `14.780000, 105.420000` | `supabase/seed-dev/catalog_dev_seed.sql:105` | Restaurant R1 `ร้านส้มตำป้าทองดี (dev)`. Address line ends `(ที่อยู่ทดสอบ)`; description reads `ไม่ใช่ร้านจริง` |
| `14.781000, 105.421000` | `supabase/seed-dev/catalog_dev_seed.sql:114` | Restaurant R2 `ก๋วยเตี๋ยวลุงหนวด (dev)`, `(ที่อยู่ทดสอบ)` |
| *(none)* | `supabase/seed-dev/catalog_dev_seed.sql` R3 | SUSPENDED restaurant — `lat`/`lng` explicitly NULL |
| `14.780000, 105.420000` | `supabase/seed-dev/g71_offer_fixture.sql:122` | `deliveries.pickup_lat/lng` — reuses R1, not an independent point |
| `14.775000, 105.415000` | `supabase/seed-dev/g71_offer_fixture.sql:272` | `deliveries.dropoff_lat/lng`, G7.1 baseline #1 |
| `14.776000, 105.416000` | `supabase/seed-dev/g71_offer_fixture.sql:309` | `deliveries.dropoff_lat/lng`, G7.1 baseline #2 |
| `14.31, 105.21` | `supabase/tests/restaurant_availability_test.sql:84` | An `addresses` row created **inside a transactional domain test**. Never present in `banhao-dev` |

Coordinate literals also appear in unit tests (`apps/api/.../addresses.controller.spec.ts`,
`apps/driver/src/lib/deviceLocation.test.ts`, and others). **None is persisted
anywhere**; they are in-memory test doubles.

### 20.2 What that means for the benchmark

`VERIFIED`

- **Four distinct persisted points exist**, all inside roughly one square
  kilometre. The widest separation between any two is under 1 km.
- **All four are self-declared synthetic dev data.** The seed file states in its
  own header that it "is NOT product content and must never be presented as a
  real restaurant, menu, or price", and every address line is marked
  `(ที่อยู่ทดสอบ)`.
- **No coordinate in this repository carries a recorded source or confidence.**
  There is no evidence any of them corresponds to a real building.
- **No `addresses` row with coordinates exists in `banhao-dev`.** The customer
  address API accepts an optional client-supplied `lat`/`lng` pair
  (`packages/validation/src/address.ts:37`) and nothing geocodes text, so no
  real customer coordinate has ever been produced by the system.

> **Conclusion — the repository does NOT contain enough geographic data to
> construct a meaningful benchmark.** `VERIFIED`
> Four synthetic points within 1 km can populate no distance band above A, and
> even band A only as `SYNTHETIC`, which §19.3 rules ineligible. **No coordinate
> was fabricated to close this gap**, and none may be.

### 20.3 Fixture matrix

Real repository data is used where it exists. Everything else is
`FIXTURE REQUIRED` and must be produced by field capture or owner local
knowledge before Stage C (§30) may run.

| Case | Area type | Distance band | Road type | Pair type | Purpose | Status |
|---|---|---|---|---|---|---|
| B-001 | Town | 0–2 km | Town road | Restaurant→Customer | Baseline | **FIXTURE REQUIRED** — R1 exists only as `SYNTHETIC`; a real restaurant coordinate and a real nearby address are both needed |
| B-002 | Town | 0–2 km | ซอย off a town road | Restaurant→Customer | Small-road baseline | **FIXTURE REQUIRED** |
| B-003 | Town | 2–5 km | Town + local road | Restaurant→Customer | Baseline | **FIXTURE REQUIRED** |
| B-004 | Village | 2–5 km | Village road | Restaurant→Customer | Rural coverage | **FIXTURE REQUIRED** |
| B-005 | Village | 2–5 km | Narrow / unpaved | Restaurant→Customer | Small-road behaviour | **FIXTURE REQUIRED** |
| B-006 | Rural | 5–10 km | Local road | Restaurant→Customer | Rural coverage | **FIXTURE REQUIRED** |
| B-007 | Rural | 5–10 km | Mixed highway + village | Restaurant→Customer | Mixed routing | **FIXTURE REQUIRED** |
| B-008 | Outer | 10–15 km | Mixed | Restaurant→Customer | Outer economics, D-10 headroom | **FIXTURE REQUIRED** |
| B-009 | Outer | 10–15 km | Village terminus | Restaurant→Customer | Outer + small road | **FIXTURE REQUIRED** |
| B-010 | Boundary | just under 15 km | Mixed | Restaurant→Customer | D-12 accept side | **FIXTURE REQUIRED** |
| B-011 | Boundary | just over 15 km | Mixed | Restaurant→Customer | D-12 reject side (`ROUTE_OVER_15KM`) | **FIXTURE REQUIRED** |
| B-012 | Boundary | any | any | Restaurant→Customer | Inside polygon, outside 15 km — the case that proves polygon and D-12 are independent | **FIXTURE REQUIRED** |
| B-013 | Boundary | any | any | Restaurant→Customer | Outside polygon — must reject before any routing call | **FIXTURE REQUIRED** |
| B-014 | Difficult | any | River / bridge | Point→Point | Detour vs straight line | **FIXTURE REQUIRED** — only if such a case genuinely exists locally |
| B-015 | Difficult | any | Apparent disconnection | Point→Point | Map-data gap | **FIXTURE REQUIRED** — only if genuine |
| B-016 | Difficult | any | Large detour | Restaurant→Customer | Straight-line ≪ road distance | **FIXTURE REQUIRED** — only if genuine |
| B-017 | Ambiguous | n/a | n/a | Restaurant→Customer | Address that cannot be resolved to a trustworthy coordinate — the `UNVERIFIED_LOCATION` path (§26) | **FIXTURE REQUIRED** |
| *(existing)* | Town | <1 km | Unknown | Point→Point | **Smoke test only.** The four synthetic dev points may be used to prove the harness runs. Their results are `SYNTHETIC` and **must be excluded from every accuracy metric** | Available |

**Required additional test points, stated exactly:** at least **17 route
fixtures**, requiring roughly **20–30 distinct real coordinates** (restaurants
may be reused as origins), each with a recorded `coordinate_source` of
`FIELD_GPS`, `OWNER_LOCAL_KNOWLEDGE`, `MERCHANT_SUPPLIED` or `CUSTOMER_PIN`, and
a `coordinate_confidence` of `HIGH` or `MEDIUM`. Producing them is field work in
อำเภอบุณฑริก and **cannot be done from this repository.**

---

## 21. Ground-truth strategy

`PROPOSED`

**No routing API is automatic ground truth.** A second provider agreeing with
Google proves only that two map datasets share an error, and both are derived
from the same kind of source. The benchmark therefore uses a tiered strategy in
which each tier's authority and limitations are stated explicitly.

### Tier 1 — actual rider-delivered route / GPS trace

**Highest-value operational evidence.** What a rider actually rode, measured.

**Limitations.** A rider's actual path is not necessarily the optimal path: it
includes personal route preference, wrong turns, refuelling and errands. GPS
traces suffer multipath error near buildings, drift when stationary, and gaps
under poor signal. A trace measures *what happened*, which is the right target
for rider compensation fairness but not automatically the right target for
"what should the route have been".

> **Tier 1 is NOT AVAILABLE today.** `VERIFIED`
> `apps/driver/src/lib/deviceLocation.ts` captures **one foreground reading per
> call** — no `watchPositionAsync`, no interval, no background task, no queue,
> and the only two callers are "rider tapped go online" and "rider tapped
> refresh". `riderLocationRequestSchema`
> (`packages/validation/src/rider.ts:26`) is `.strict()` and accepts **`lat` and
> `lng` only** — no accuracy, no device timestamp, no speed, no heading. The
> server writes **latest position only**, with no history table, no append log
> and no retention rule. There is therefore **no GPS trace anywhere in the
> system**, and creating one is gated on **Q-012** (PDPA lawful basis,
> `LEGAL_REVIEW_REQUIRED`) and **TQ-016** (rider location retention and access),
> both `OPEN`, with **BQ-022** flagging granular worker tracking as a
> worker-classification factor. **This benchmark does not authorize building
> it.**

### Tier 2 — human-verified route using actual local road knowledge

A person who knows the roads states the route a rider would actually take, and
its approximate distance — ideally confirmed by riding it with an odometer or a
one-off GPS capture.

**Limitations.** Slow, does not scale, subject to the verifier's own preference,
and distance is only as good as the measuring method. Odometer readings vary
with tyre size and calibration.

**This is the highest tier currently achievable**, and it is the practical
ground truth for the first benchmark run.

### Tier 3 — independent provider comparison

Route the same pair through a second provider and compare.

**Limitations.** **A comparison signal, not ground truth.** Agreement may be
shared error; disagreement identifies a case worth Tier 1 or Tier 2 attention
but says nothing about which provider is right. Using a second provider also
means integrating one, which §3 of this document and the Phase 1 direction
(§1) both exclude — so Tier 3 is available only in a later, explicitly
authorized comparison run (§28).

### Tier 4 — straight-line / geodesic distance

Computable today with PostGIS, at zero cost, for any coordinate pair.

**Limitations — and a hard prohibition.** Straight-line distance is
**diagnostic only**. It is useful for exactly two things: proposing a band
before routing (§18.1), and flagging cases where road distance greatly exceeds
it (a band G signal, and a detour indicator). **It MUST NOT be used as delivery
ground truth, MUST NOT be substituted for road distance, and MUST NOT feed
pricing** — §4.4 and D-08 both forbid it.

### 21.1 Tier assignment rule

`PROPOSED — REQUIRES OWNER APPROVAL`

- A **distance-delta metric** (§24.4) may only be computed against **Tier 1 or
  Tier 2** ground truth.
- **Tier 3** results are reported in a separate comparison table and never
  merged into the accuracy figures.
- **Tier 4** appears only as a diagnostic column (`straight_line_m`,
  `detour_ratio`).
- Every reported metric must state **which tier and how many routes** it rests
  on. A p95 over five Tier-2 routes must say so.

---

## 22. Google test-data capture record

`PROPOSED` — the record shape. **No Google request was made.**

For every route eventually tested, capture and store immutably:

| Field | Notes |
|---|---|
| `case_id` | Links to the §19 fixture |
| `provider` | `GOOGLE_ROUTES` |
| `api_sku` | The billed SKU, e.g. Compute Routes (Essentials) — needed to tie results to cost |
| `request_timestamp` | UTC, ISO-8601 |
| `origin_lat`, `origin_lng`, `destination_lat`, `destination_lng` | As sent, not as intended |
| `road_distance_m` | The provider's road distance |
| `duration_s` | The provider's duration |
| `route_status` | Success, no route, error, quota, timeout |
| `route_geometry` | Only if permitted by the provider's terms and needed for §24.3 — otherwise omitted deliberately |
| `response_metadata` | Whatever the audit needs: travel mode, routing preference, units, any warning or advisory the response carries |
| `request_identifier` | The provider's own request/trace id, if one is returned |
| `latency_ms` | Measured client-side, for §24.7 |
| `benchmark_run_id` | Which run this belongs to |

**Rules.**

- **No secret, key or credential is stored in the record or committed to Git**
  (CON-005).
- Records are **append-only**. A re-run creates a new `benchmark_run_id`; it
  never overwrites an earlier result.
- Provider terms govern whether route geometry may be stored or cached. **Verify
  the terms before storing geometry** — this document does not assert what they
  permit.

---

## 23. Actual-delivery comparison and time attribution

`PROPOSED` — future comparison design. Not implemented.

### 23.1 Fields to compare

| Planned (provider) | Actual (observed) |
|---|---|
| `road_distance_m` | Actual ridden distance |
| `duration_s` | Actual transit duration |
| — | Route deviation between planned and ridden path |
| — | Pickup wait time |
| — | Delivery (customer) wait time |
| — | GPS quality, missing GPS periods, stale GPS |
| — | Abnormal route behaviour |

### 23.2 The attribution rule — the part that is easy to get wrong

**Total delivery time is not routing error.** Any comparison must decompose the
elapsed time before attributing any of it to the provider:

| Component | Interval | What it measures |
|---|---|---|
| Merchant preparation | `orders.accepted_at` → `orders.ready_at` | Merchant delay. **Not routing.** |
| Rider approach to merchant | `deliveries.assigned_at` → `deliveries.picked_up_at` | Rider travel to pickup, plus any wait at the shop |
| Pickup wait | rider at merchant (state `AT_MERCHANT`) → `deliveries.picked_up_at` | Merchant/handover delay. **Not routing.** |
| **Transit** | `deliveries.picked_up_at` → `deliveries.arrived_at` | **The only interval comparable to the provider's `duration_s`** |
| Customer wait | `deliveries.arrived_at` → `deliveries.delivered_at` | Customer availability, handover, contact attempts. **Not routing.** |

`VERIFIED` — every timestamp named above exists in the deployed schema:
`orders.placed_at/paid_at/accepted_at/ready_at/picked_up_at/delivered_at`
(`20260811000005_order_domain.sql:67`), `deliveries.assigned_at/picked_up_at/
delivered_at/failed_at` (`20260811000009_delivery_domain.sql`),
`deliveries.arrived_at` (`20260907000001`, DEC-054 — explicitly the customer
arrival anchor, not merchant arrival), and `delivery_contact_attempts`
(`20260907000002`) for the customer-unavailable case.

> **`deliveries.arrived_at` is what makes honest duration comparison possible at
> all.** Without it, customer wait is indistinguishable from transit. It is
> `NULL` for every delivery created before 2026-09-07, so those deliveries
> **cannot** contribute a duration-delta figure.

Five distinct causes must never be collapsed into one number:

1. **routing error** — the provider's distance or duration was wrong;
2. **rider behaviour** — a different, slower or longer path was ridden by
   choice;
3. **pickup / merchant delay** — the food was not ready;
4. **customer delay** — nobody answered at the door;
5. **GPS measurement error** — the trace is wrong, not the route.

A comparison that cannot separate these must report the delta as
**unattributed**, not as routing error.

### 23.3 Current feasibility

`VERIFIED` — **distance comparison against actual deliveries is not possible
today.** There is no GPS trace (§21 Tier 1), and `orders.distance_m` /
`deliveries.distance_m` are never written — `create_order()` accepts
`p_distance_m` (default `null`) and `apps/api/src/modules/orders/orders.service.ts:196`
never passes it. **Duration** comparison is possible in principle for deliveries
that have both `picked_up_at` and `arrived_at`, but there is nothing to compare
it *to* until a planned duration is captured and stored.

---

## 24. Metrics — definitions and formulas

`PROPOSED`

Let `N` be the routes in a reported stratum, `g` a Google result and `t` its
ground-truth counterpart.

### 24.1 Route success rate

```text
route_success_rate = usable_routes / attempted_routes
```

`usable_route` = the provider returned a route with a status indicating success
**and** a finite positive distance and duration. A returned-but-implausible
route counts as a success here and is caught by §24.6 — the two metrics are
deliberately independent.

### 24.2 Rural coverage

```text
rural_coverage = usable_routes_in_band_F / attempted_routes_in_band_F
```

Reported separately from the aggregate. An aggregate success rate carried by
town routes hides exactly the failure BANHAO cares about.

### 24.3 Small-road / alley behaviour

Both quantitative and qualitative; no single number is sufficient.

- **Quantitative:** proportion of band F routes whose final approach reaches the
  destination rather than stopping on a nearby larger road; proportion whose
  distance delta exceeds the §24.4 threshold.
- **Qualitative:** for each band F route, a recorded verdict from a person with
  local knowledge — `RIDEABLE_AS_ROUTED`, `RIDEABLE_BUT_NOT_OPTIMAL`,
  `NOT_RIDEABLE`, `WRONG_DESTINATION_APPROACH` — with a one-line reason.

Motorcycle-relevant: a route a car cannot take may be correct for BANHAO. The
verdict must be given for a มอเตอร์ไซค์, not a car.

### 24.4 Distance delta

Only against Tier 1 or Tier 2 ground truth (§21.1).

```text
abs_delta_m_i   = | google_distance_m_i − ground_truth_distance_m_i |
pct_delta_i     = abs_delta_m_i / ground_truth_distance_m_i
```

Report, per stratum and overall:

- `median_abs_delta_m` — median of `abs_delta_m`
- `p95_abs_delta_m` — 95th percentile of `abs_delta_m`
- `median_pct_delta` — median of `pct_delta`
- `p95_pct_delta` — 95th percentile of `pct_delta`

Also report **signed** median delta separately. A systematic bias (Google
consistently short or consistently long) is a different and more dangerous
finding than symmetric noise, because it compounds across every order.

> **p95 over a small `N` is unstable.** Every percentile must be published with
> its `N` and its ground-truth tier. With `N < 20` in a stratum, report the
> maximum alongside the p95 and state that the percentile is indicative.

### 24.5 Duration delta

Same formulas, substituting duration, and **only where ground truth is
sufficiently reliable** — meaning a transit interval
(`picked_up_at` → `arrived_at`, §23.2) that is not contaminated by a recorded
pickup or customer wait, or a Tier 2 timed ride.

Duration ground truth is materially weaker than distance ground truth: traffic,
weather, rider speed and time of day all move it. Duration deltas are reported
as **secondary evidence** and must not be the basis for rejecting a provider on
their own.

### 24.6 Impossible / unusable route rate

```text
impossible_route_rate = impossible_routes / attempted_routes
```

A route is `impossible` if any of the following holds, and the reason is
recorded per case:

- no route returned for a pair that is genuinely reachable;
- obviously wrong route (wrong direction, wrong destination area);
- route through a road that is inaccessible — closed, non-existent, or
  impassable by motorcycle;
- implausible distance (for example a multiple of the Tier 4 straight-line
  distance with no geographic reason);
- route inconsistent with local reality as judged by §24.3's qualitative
  verdict.

**This is the most safety-relevant metric.** A wrong route that a rider follows
is an operational and safety event, not a pricing inconvenience.

### 24.7 Latency

```text
median_latency_ms, p95_latency_ms
```

Measured client-side, from request dispatch to response received, excluding
local processing. Reported per stratum only if a difference is observed;
otherwise aggregate. Latency matters because routing sits on the
**pre-acceptance** path: it is inside the customer's checkout wait.

### 24.8 Consistency

For a subset of routes (§18.4 proposes 12), issue the **identical** request 3
times, spaced across the run.

```text
distance_spread_i = max(distance) − min(distance)   over repeats of route i
duration_spread_i = max(duration) − min(duration)   over repeats of route i
```

Report the maximum and median spread. **Material instability** is a spread large
enough to change a pricing outcome — that is, large enough to move the D-08
per-km rider component by ≥฿1, or to move a route across the D-12 boundary, or
to flip the D-11 verdict. Traffic-dependent duration variation is expected and
is not instability; **distance** variation for an identical request is.

### 24.9 Terrain / locality slices

**Aggregate results alone are not an acceptable report.** Every metric in §24.1,
§24.4, §24.6 and §24.7 must be reported separately for:

- **town**
- **village**
- **rural**
- **boundary**
- **difficult road network**

A provider that is excellent in town and unusable in villages must be visible as
exactly that.

### 24.10 Economic impact

For every route, compute what the routing distance would do to the economics,
using **only the locked DEC-061 values** and changing no formula.

```text
km                 = road_distance_m / 1000
rider_required     = max( D-07 + D-08 × km , D-06 )          # ฿8 + ฿1.20/km, floor ฿12
delivery_fee_raw   = rider_required / D-05                   # ÷ 0.80
delivery_fee       = min( max( delivery_fee_raw , D-09 ) , D-10 )   # floor ฿15, cap ฿35
commission         = round_whole_baht( D-01 × food_subtotal )       # 10%
service_fee        = min( max( D-03pct × food_subtotal , D-03min ) , D-04 )  # 5%, floor ฿5, cap ฿15
rider_payable      = max( D-05 × delivery_fee , D-06 )       # 80% of the fee, floor ฿12
delivery_margin    = delivery_fee − rider_payable
contribution       = commission + service_fee + delivery_margin − other_costs
d11_verdict        = contribution ≥ D-11 ? PASS : REJECT     # ฿5
d12_verdict        = km ≤ 15 ? SERVICEABLE : ROUTE_OVER_15KM
```

Report per route: `km`, `rider_required`, `delivery_fee`, `rider_payable`,
`delivery_margin`, `contribution`, `d11_verdict`, `d12_verdict`, and the
**contribution sensitivity** — how much the contribution moves per 500 m of
distance error at that point on the curve.

`rider_required` is what D-06/D-07/D-08 say the rider must earn at that
distance; `rider_payable` is what D-05's 80% share of the *final* fee actually
pays. They diverge exactly where D-09's floor or D-10's cap binds, and reporting
both is how the benchmark surfaces a D-10 cap that would underfund a rider —
the failure mode D-10 is written to prevent.

> **This is simulation only.** It changes no locked formula, writes no order, and
> must never be executed against a real order. **DEC-061 is not modified.**

> **Two inputs are not locked and must not be invented.** `VERIFIED`
> 1. **Payment processing cost.** D-11 requires it in the contribution, and **no
>    rate is locked anywhere in `docs/DECISIONS.md`.** The benchmark must
>    therefore report **contribution before payment processing cost** as the
>    primary figure, plus a sensitivity band across a stated range marked
>    **`ASSUMED`**, and must never present a single contribution number as
>    final.
> 2. **`food_subtotal`.** Contribution depends on basket size, which routing
>    does not determine. Use a small set of stated basket values as scenarios
>    (marked `ASSUMED`) rather than one invented "typical" order.
>
> The exact evaluation ordering of the service-fee percentage, floor and cap is
> noted by D-04 itself as finalizable during implementation; the benchmark uses
> the ordering above and states that it did.

---

## 25. Acceptance framework

`PROPOSED — REQUIRES OWNER APPROVAL`

### 25.1 Required for D-16 to be considered at all

These are qualitative gates, not numbers. If any fails, D-16 should not be
locked regardless of how good the other figures look:

1. **Route success** — Google returns usable routes for the ordinary BANHAO
   delivery shape, not only for highway pairs.
2. **Rural usability** — band F routes succeed *and* are judged rideable by a
   person with local knowledge.
3. **Boundary correctness** — the §26 matrix behaves as specified; in particular
   `ROUTE_OVER_15KM` is reached by road distance and by nothing else.
4. **No systematic dangerous or invalid route behaviour** — no repeated pattern
   of routing riders onto impassable or unsafe roads.
5. **Economically safe distance output** — no systematic bias that would
   consistently underpay riders or consistently breach D-11.

### 25.2 Candidate numeric thresholds

**`PROPOSED — REQUIRES OWNER APPROVAL`. These are not decisions, they are
starting points for the owner to accept, change or reject.** None of them is
derived from measurement, because no measurement exists.

| Metric | Proposed threshold | Rationale |
|---|---|---|
| Minimum route success rate (aggregate) | **≥ 98%** | Routing sits on the pre-acceptance path; a failure is a lost order |
| Minimum route success rate (band F, rural) | **≥ 95%** | Deliberately lower than aggregate — rural is harder and still must work |
| Maximum p95 absolute distance error | **≤ 800 m** | At D-08's ฿1.20/km, 800 m is under ฿1 of rider compensation error |
| Maximum p95 percentage distance error | **≤ 15%** | Guards the short routes where an absolute bound is too generous |
| Maximum impossible/unusable route rate | **≤ 2%**, and **0%** for the dangerous subcategory (inaccessible or unsafe road) | A dangerous route is a safety event, not a statistic |
| Maximum p95 latency | **≤ 1500 ms** | Inside a checkout wait a customer will tolerate |
| Maximum distance spread on identical repeats | **≤ 100 m** | Below the point where D-08 or D-12 outcomes move |

> **Do not treat this table as locked.** No threshold here has owner approval,
> and none may be cited as a requirement until it does. If measurement later
> shows a threshold is unachievable *and* the shortfall is economically
> tolerable, the correct response is an owner decision, not a silently relaxed
> number.

### 25.3 What a "pass" does and does not mean

A pass means the evidence required for a **D-16 owner review** exists. **It does
not lock D-16**, does not authorize a production integration, and does not by
itself resolve D-17 (distance accuracy policy), which asks a different question:
who absorbs the error that this benchmark measures.

---

## 26. D-12 and the 15 km rule — serviceability test matrix

`VERIFIED` (D-12 text) + `PROPOSED` (the matrix).

**D-12: maximum operational ROAD DISTANCE = 15 km.** Not a circular radius, not
straight-line distance, not geodesic distance. The benchmark must demonstrate
that the future architecture distinguishes all five outcomes below, and must
never conflate the polygon with the distance limit — they are independent tests
that can disagree.

| # | Condition | Required outcome | Notes |
|---|---|---|---|
| 1 | Inside polygon **and** road distance ≤ 15 km | **SERVICEABLE** — proceed to pricing | The normal path |
| 2 | Inside polygon **and** road distance > 15 km | **`ROUTE_OVER_15KM`** — serviceability rejection | Being inside the business boundary does not make a long road trip serviceable |
| 3 | Outside polygon | **`NOT_SERVICEABLE`** — rejected **before any routing call** | The free pre-check; no billable request is made |
| 4 | Route unavailable | **Fail closed** — reject, never assume, never substitute | §4.4 |
| 5 | Ambiguous / unverified location | **`UNVERIFIED_LOCATION`** — reject or require correction | A coordinate nobody trusts must not silently price an order |

> **`ROUTE_OVER_15KM` is a serviceability rejection, NOT a provider fallback
> trigger.** Retrying a >15 km route against a second provider hoping for a
> shorter answer is provider-shopping against a business limit, and is
> forbidden. Case 2 must be **stable**: the same pair must reject consistently,
> which is why §24.8 measures distance spread against the D-12 boundary.

Case 2 versus case 3 is the reason case **B-012** exists in §20.3: without a
fixture that is inside the polygon and beyond 15 km, nothing proves the two
checks are independent.

---

## 27. PostGIS test layer, and what is missing

The benchmark exercises the future architecture end to end **as a test harness**,
not as a production service:

```text
coordinates
   ↓
PostGIS service-zone check
   ↓
Google routing
   ↓
road distance
   ↓
15 km check
   ↓
pricing engine
   ↓
D-11
```

**Do not implement this production flow.** What each stage needs, and what
exists:

| Stage | Required | Current state |
|---|---|---|
| Coordinates | Real, sourced, confidence-rated fixtures | **MISSING** — only four synthetic points (§20) `VERIFIED` |
| PostGIS service-zone check | A service-zone **polygon** and a membership function | **MISSING** — PostGIS is enabled (`20260809000001`) and generated `geography(Point,4326)` columns exist, but there is **no polygon column, table or seed**, and `service_areas` / `zones` / `delivery_fee_bands` are deferred: `addresses.zone_id` and `rider_availability.service_area_id` are bare `uuid` with **no foreign key** `VERIFIED` |
| Google routing | A routing client and a credential | **MISSING** — no provider client anywhere, and **no routing/geocoding provider abstraction exists**; the payments `PaymentProvider` abstraction has no geospatial counterpart `VERIFIED` |
| Road distance | A place to record it | Columns `orders.distance_m` and `deliveries.distance_m` exist but are **never written** `VERIFIED` |
| 15 km check | Serviceability evaluation | **MISSING** — no code path evaluates D-12 |
| Pricing engine | Distance-aware pricing | **MISSING** — `apps/api/src/modules/orders/order-pricing.service.ts:49` states explicitly that no distance, coordinates, routing, geocoding, zones or restaurant location participate `VERIFIED` |
| D-11 guardrail | Contribution evaluation before acceptance | **MISSING** — no configuration infrastructure exists (DEC-061, *Implementation status*) |
| Route snapshot | Provider, distance, duration, timestamp, geocoding confidence, config version, zone version | **MISSING** — none of these columns exists (§12) `VERIFIED` |

**The benchmark harness must therefore live outside the production code path**:
its own throwaway script or test-only module, reading fixtures from a file,
writing results to a file, touching no production service and no production
table. **No migration, and no mutation of any existing fixture or database
row.**

---

## 28. Google versus a future OSRM — controlled comparison protocol

`PROPOSED` — for a **later, separately authorized** run. OSRM is not deployed and
is not deployed by this document.

### 28.1 Protocol

Run the **identical fixture set** (§20.3) through both engines in the same
window, and compare:

| Dimension | Measurement |
|---|---|
| Route availability | §24.1 and §24.2, per engine |
| Distance | §24.4 against the same Tier 1/Tier 2 ground truth — **not against each other** |
| Duration | §24.5, same caveats |
| Rural road behaviour | §24.3 qualitative verdicts, same local judge, blind to which engine produced the route where practical |
| Latency | §24.7, noting that a local OSRM will look faster and that this is not by itself a quality signal |
| Operational reliability | Availability, error rate, and for OSRM the behaviour during an OSM extract update |
| Infrastructure cost | Measured host, memory and storage cost — not estimated |
| Maintenance cost | Engineering hours for deployment, updates, monitoring and on-call |
| Data update burden | Frequency and cost of OSM extract refresh, and the risk of a bad refresh |

### 28.2 Rules that keep the comparison honest

- **Neither engine is the other's ground truth** (§21 Tier 3).
- **OSRM does not win by being self-hosted.** §6 states it directly: *"OSRM is
  not cheaper merely because the software is open source."* The comparison is
  decided on **TCO**, not API list price.
- **Google remains primary if its quality is materially better and its TCO is
  acceptable.** This outcome must be reachable by the protocol, and the protocol
  must not be designed to make it unreachable.
- OSRM's rural quality is a genuine open question in both directions: OSM
  sometimes has village roads a commercial dataset lacks, and sometimes lacks
  roads a commercial dataset has. §24.3's per-engine verdicts are the evidence.
- Any OSRM infrastructure figure that is not measured must be marked
  **`ASSUMED`** (§11.2).

---

## 29. BANHAO Local Routing Intelligence — conceptual data model

`OWNER-APPROVED DIRECTION` (§5) · **documentation only.** **No table, column,
RLS policy, RPC or migration is created by this document**, and none may be
created without an explicit instruction. Everything below is additionally gated
on **Q-012** (PDPA lawful basis, `LEGAL_REVIEW_REQUIRED`), **TQ-016** (rider
location retention and access) and **BQ-022**.

Conceptual records — names are illustrative, not a schema proposal:

**Per priced order — the planned side**

| Concept | Purpose |
|---|---|
| Route planned (provider, geometry or reference) | What the provider said to do |
| Distance planned | Feeds pricing; must be snapshotted (§12) |
| Duration planned | Feeds the customer estimate |
| Coordinate quality (origin, destination) | Whether the planned side deserves trust |

**Per completed delivery — the actual side**

| Concept | Purpose |
|---|---|
| Route actual | What was ridden |
| Distance actual | Rider fairness, and the distance-delta signal |
| Duration actual | Transit only, per §23.2's decomposition |
| Route deviation | Planned versus actual divergence |
| Problematic road | A recurring segment where actual behaviour differs from provider routing |
| Customer pin correction | Where the rider had to go versus where the pin was |
| Rider feedback | A structured, low-friction report — "this road does not exist", "gate on the other side" |

**What it eventually enables** (restating §5): evaluating Google route quality
against observed reality, finding problematic local roads, improving address
quality and service-zone design, detecting systematic distance error, and
deciding on evidence whether a self-hosted engine is justified.

> **BANHAO has no comparable data volume today**, and this document claims none.
> It is an accumulation direction, not a present capability — and the first
> prerequisite, a GPS trace, does not exist and is not authorized here (§21
> Tier 1).

---

## 30. Execution plan

`PROPOSED` — **do not execute any stage now.**

| Stage | What happens | Gate to the next stage |
|---|---|---|
| **A. Collect and validate coordinate fixtures** | Field capture in อำเภอบุณฑริก; record `coordinate_source` and `coordinate_confidence` for every point; populate §20.3's `FIXTURE REQUIRED` rows | Every stratum either populated with `HIGH`/`MEDIUM` coordinates or explicitly recorded as not evaluated |
| **B. Validate service-zone membership** | Define the service polygon; evaluate each fixture's inside/outside status in PostGIS; confirm the expected values in §19 | Case 3 in §26 provably rejects **before** any routing call |
| **C. Execute Google route requests** | Run the fixture set under the §31 cost controls; capture the §22 record for every request | All requests captured; budget not exceeded |
| **D. Capture immutable benchmark results** | Persist results append-only under a `benchmark_run_id`; no overwrite, no in-place edit | Results reproducible and attributable to a run |
| **E. Collect and associate actual rider delivery evidence** | Where available, attach Tier 1/Tier 2 evidence and the §23.2 time decomposition | Every accuracy metric can name its ground-truth tier and `N` |
| **F. Calculate metrics** | Compute §24 per stratum and overall; publish `N` and tier with every figure | No metric published without its `N` and tier |
| **G. Review economic impact** | Run §24.10 simulation; report contribution before payment cost, plus the `ASSUMED` sensitivity band | Economic risk stated, not implied |
| **H. Owner review** | Present evidence against §25; the owner accepts, changes or rejects the §25.2 thresholds | Thresholds become owner-approved, or the benchmark is revised |
| **I. D-16 decision** | The owner locks or declines to lock D-16 | — |

Stages A and B are the long poles: A is field work, B needs a service polygon
that does not exist. **Stage C must not begin before A and B complete** — routing
synthetic or unvalidated coordinates spends money to measure nothing.

---

## 31. Cost safety for the future execution

`PROPOSED` — mandatory controls on any later run.

- **Small controlled request count.** The fixture set is bounded (§18.4, ~76
  routes; under 300 requests including repeats and one re-run) and enumerated in
  advance. The harness must refuse to route a pair not in the fixture file.
- **Daily quota.** A hard per-day request ceiling enforced in the harness, plus
  the provider's own quota/budget cap configured on the account.
- **Budget protection.** A billing alert and a spend cap set **before** the first
  request. §11.1 records a 10,000/month free Compute Routes allowance for the
  Essentials tier as of 2026-08-09 — **re-verify current pricing and free-tier
  terms before Stage C**, per DEC-061's own *current provider-pricing
  verification* item.
- **No uncontrolled loops.** No retry-until-success, no unbounded pagination, no
  recursive expansion. Retries are bounded, counted and logged.
- **No production customer traffic.** The harness is never on a customer,
  merchant or rider request path.
- **No production order routing.** No order is priced, created or modified by the
  benchmark.
- **No production credentials committed to Git** (CON-005). A benchmark-scoped,
  restricted key held outside the repository, revocable independently.
- **Kill switch.** A single configuration value that stops the harness, and a
  documented way to revoke the key.

---

## 32. Missing prerequisites — consolidated

`VERIFIED` unless marked otherwise. Nothing below is created by this document.

| # | Missing | Blocks | Severity |
|---|---|---|---|
| 1 | **Real Buntharik coordinate fixtures** — ~20–30 sourced points for ~17 routes | Every accuracy metric; Stage A | **HARD BLOCKER** |
| 2 | **Service-zone polygon** — no polygon column, table or seed; `service_areas`/`zones` deferred, `zone_id` has no FK | §26 cases 2/3; Stage B | **HARD BLOCKER** |
| 3 | **Routing provider client and abstraction** — none exists | Stage C | **HARD BLOCKER** for execution |
| 4 | **Benchmark credential and budget controls** | Stage C | **HARD BLOCKER** for execution |
| 5 | **GPS trace capability** — no trace exists; foreground single-reading capture only, `{lat,lng}` payload with no accuracy field, latest-position-only storage | Tier 1 ground truth; distance comparison against actual deliveries | **BLOCKED on Q-012 / TQ-016** — not authorized here |
| 6 | **`orders.distance_m` / `deliveries.distance_m` population** — `p_distance_m` is never passed | Any planned-versus-actual comparison | Blocker for §23 |
| 7 | **Route snapshot fields** — provider, distance, duration, route timestamp, geocoding confidence, pricing config version, zone version | §12 historical reproducibility | Blocker for production, not for the benchmark |
| 8 | **Payment processing cost** — no rate locked anywhere in `docs/DECISIONS.md` | Complete D-11 contribution simulation | Report as sensitivity band, `ASSUMED` |
| 9 | **Local road judge** — a person with Buntharik road knowledge available for §24.3 verdicts | Qualitative metrics | Operational prerequisite |
| 10 | **Owner approval of §25.2 thresholds** | Turning measurements into a verdict | `OPEN DECISION` |
| 11 | **Current Google pricing re-verification** — §11.1 figures are dated 2026-08-09 | Any cost argument at D-16 | Required by DEC-061's own open items |

---

## 33. Benchmark-design conflicts with existing documents

**No conflict was found between this benchmark design and any approved
document.** The reconciliations already recorded in §13 stand unchanged, and no
approved architecture document was modified.

Two adjacent constraints are **reinforced**, not contradicted, by this design:

- **TQ-016 and Q-012** restrict rider location history. This design treats Tier 1
  GPS ground truth as **unavailable and unauthorized** rather than proposing to
  build it (§21, §29), which is consistent with `RiderLocationService`'s and
  `deviceLocation.ts`'s stated positions.
- **DEC-037** keeps distance out of dispatch entirely
  (`broadcast-dispatch.strategy.ts:24` — "No radius. No `ST_DWithin`. No
  distance."). Nothing in this benchmark introduces distance into dispatch;
  routing here serves pricing and serviceability only.

---

## 34. Part II closing — the blocker Part III addresses

Part II's design is complete and executable **except for its inputs.** Of the
eleven prerequisites in §32, the two that gate everything else are geographic:
**real Buntharik coordinate fixtures**, and a **service-zone polygon**. Neither
exists, and no amount of further benchmark design produces either.

The polygon is a business-boundary decision (§3) and is tracked as **OD-8**
(§48). The fixtures are field work, and Part III below is their acquisition and
validation plan.

---

## 35. Part III — Buntharik real-world fixture acquisition

Added 2026-09-10. Part II (§16–§33) designed the benchmark and identified its
hard blocker: **the repository contains no real Buntharik geography.** Part III
is the acquisition and validation plan for the fixtures that blocker needs.

**This part acquires nothing.** It defines what must be collected, from what
sources, to what quality standard, how it is validated, and what it is rejected
for. **No coordinate is invented anywhere in it.**

**Nothing in this part was executed.** No routing API was called, no Google,
TomTom, HERE, Mapbox or OSRM request was issued, no geocoding lookup was
performed, no credential was introduced, no migration was written, no database
row was created or mutated, no pricing logic was touched. **DEC-061 is
unchanged; D-16 and D-17 both remain `OPEN`.**

---

## 36. Acquisition objective, and the privacy rule that bounds it

### 36.1 Objective

`PROPOSED`

Acquire approximately **20–30 real public geographic coordinates** in
อำเภอบุณฑริก, sufficient to build approximately **15–20 representative
origin/destination routes** covering every benchmark stratum (§18).

### 36.2 Privacy rule — binding, not advisory

**No customer data enters this benchmark.** The following must never be used as
a fixture:

- real customer addresses;
- private residential addresses;
- customer names;
- phone numbers;
- order addresses or any `orders.delivery_address_snapshot` value;
- any personally identifiable delivery information.

**Public benchmark fixtures are preferred over customer addresses for Q-018
Phase 1 validation.** Real customer routing data may be introduced **only after
the applicable legal and privacy decisions are resolved** — **Q-012** (PDPA
lawful basis and retention, `LEGAL_REVIEW_REQUIRED`), **TQ-016** (rider location
retention and access) and, for anything involving rider movement, **BQ-022**.
Until then, a customer address is not a fixture, however convenient.

Permitted fixture subjects — public, non-sensitive locations only:

- restaurants, cafés and food shops that trade publicly;
- markets and food centres;
- schools, where used as a public POI rather than to reach a person;
- government offices;
- hospitals and health stations;
- petrol stations;
- temples (วัด);
- public facilities and community buildings;
- road intersections;
- public landmarks;
- publicly listed commercial locations.

> **The benchmark measures routing quality, not customer data.** A public
> petrol station at the end of a village road tests exactly the same road
> network as the house next to it, and carries none of the risk.

### 36.3 One consequence worth stating plainly

A public POI is typically **on** a road; a customer's house is often **down** a
ซอย or behind a gate. Public fixtures therefore systematically **understate**
the hardest part of BANHAO's real routing problem — the final approach. The
benchmark must record this as a known limitation of its own population, and
band F (§18.2) partially compensates by deliberately selecting POIs that sit on
village and narrow roads rather than on highways. It does not fully compensate,
and the report must say so rather than imply the population is representative
of real deliveries.

---

## 37. Existing fixture inventory — the complete picture

`VERIFIED` at `a0ac526c`, 2026-09-10.

The repository contains **three mutually inconsistent clusters of invented
coordinates and no real ones.**

| # | Cluster | Where | Values | Self-declared status |
|---|---|---|---|---|
| 1 | Dev catalog seed | `supabase/seed-dev/catalog_dev_seed.sql:105,114` | `14.780000,105.420000` (R1) · `14.781000,105.421000` (R2) | Address lines end `(ที่อยู่ทดสอบ)`; description reads `ไม่ใช่ร้านจริง`; the file header states it "is NOT product content and must never be presented as a real restaurant, menu, or price" |
| 2 | G-7.1 delivery fixture | `supabase/seed-dev/g71_offer_fixture.sql:122,272,309` | pickup reuses R1 · dropoffs `14.775000,105.415000` and `14.776000,105.416000` | `(g71 fixture)` markers throughout; addresses read `บ้านทดสอบ G7.1` |
| 3 | Tracking map prototype | `design/tracking/tracking-map.html:22,34` and its duplicate `docs/design/tracking-map.html` | `14.3735,105.4090` (shop) · `14.3689,105.4165` (customer) · `14.3712,105.4128` (rider) · a 5-point polyline between them | Inline comment: `// ตัวอย่าง: อ.บุณฑริก จ.อุบลราชธานี (พิกัดโดยประมาณ, ข้อมูลจำลอง)` — *approximate coordinates, simulated data*. Tooltips read `ร้านตัวอย่าง`, `(ข้อมูลจำลอง)` |

Also present, and **not** a coordinate source: `supabase/tests/restaurant_availability_test.sql:84`
creates an `addresses` row at `14.31, 105.21` **inside a transactional domain
test**; it never reaches `banhao-dev`. Coordinate literals in `apps/**` unit
tests are in-memory doubles.

### 37.1 The clusters disagree with each other

`VERIFIED`

Cluster 1/2 sits near latitude **14.78**; cluster 3 sits near latitude
**14.37**. These are roughly **45 km apart** — they cannot both be the same
town, and neither carries a source. `docs/TODO.md:99` already records the
tracking prototype's data as simulated and flags replacing it "with a real
geocoding/location source before any real use".

> **This is the finding, not a curiosity.** Nothing in this repository has ever
> been anchored to real Buntharik geography, and two independent invented
> anchors have drifted 45 km apart without anyone noticing — because nothing
> ever consumed them geographically. **No attempt was made to decide which
> cluster is "closer to right".** Both are `SYNTHETIC`, and a guess between two
> unsourced values is still a guess.

### 37.2 Status of the synthetic fixtures — preserved, and quarantined

**All three clusters are preserved.** Nothing is deleted, renamed or moved: they
serve their original purposes (catalog browsing, offer-inbox testing, a design
prototype) and those purposes are unaffected by routing.

They are hereby classified **`SYNTHETIC — SMOKE TEST ONLY`**. They may be used
for exactly one thing: proving the benchmark harness mechanically runs — that it
reads a fixture file, issues a request, parses a response and writes a result.

**They must never enter:**

- accuracy metrics (§24.4, §24.5);
- rural coverage metrics (§24.2);
- distance error metrics of any kind;
- D-12 acceptance metrics (§26);
- the qualitative small-road verdicts (§24.3);
- **any evidence presented for a D-16 decision.**

A benchmark report that includes a synthetic point in any accuracy figure is
invalid and must be rerun.

### 37.3 Real geographic facts the repository does hold

Two, and only two — both without coordinates:

| Fact | Source | Confidence |
|---|---|---|
| **อำเภอบุณฑริก exists in OpenStreetMap as an administrative boundary relation, postcode 34230**, and บุณฑริก exists as a place/town node in ตำบลคอแลน | `ai/RESEARCH/SOURCES.md:212–216`, from a live Nominatim query recorded 2026-08-09 | `RESEARCHED`. **No coordinate was recorded from that query**, and an admin boundary implies nothing about house-number coverage |
| **ตลาดสดบุณฑริก is BANHAO's own designated launch centre** — "20–30 restaurants within a **3 km radius of ตลาดสดบุณฑริก**", and the customer design uses "ใกล้ตลาดสดบุณฑริก" as its landmark example | `docs/BUSINESS_RULES.md:84,811`, `docs/RIDER_LIFECYCLE.md:30`, `docs/OPEN_BUSINESS_QUESTIONS.md:205` | `VERIFIED` as a **named place**. **Its coordinates appear nowhere in this repository** |

**ตลาดสดบุณฑริก is therefore the natural anchor of the fixture population** —
it is the repository's own stated centre of gravity, it is unambiguously a
public POI, and the 3 km merchant catchment gives band A and B a defensible
shape. **Its coordinate is `FIXTURE ACQUISITION REQUIRED`.**

---

## 38. Fixture categories

`PROPOSED`

### 38.1 Origin fixtures — merchant-like public locations

**Target: 5–10.** These stand in for BANHAO merchants, so they must be the kind
of place a BANHAO merchant actually is: a shop on a road in or near town, not a
landmark on a highway.

Preferred, in order: restaurants · cafés · food shops · markets and food
centres.

Required fields per candidate (a subset of §44's schema):

`fixture_id` · `name` · `latitude` · `longitude` · `locality` ·
`coordinate_source` · source URL or reference where one exists ·
`coordinate_confidence` · public/private classification · intended
`road_class`.

**Distribution requirement.** At least one origin must sit **outside** the 3 km
ตลาดสดบุณฑริก catchment. An all-central origin set makes every band C and D
route share the same starting road, and a single bad road segment would then
contaminate the entire outer-distance result.

### 38.2 Destination fixtures — public, and geographically spread

**Target: 15–20.** These stand in for delivery addresses.

Preferred categories: public facilities · public landmarks · commercial
locations · markets · schools · temples · petrol stations · community
facilities.

**Private homes are excluded** (§36.2).

**Distribution requirement — the point of the whole exercise.** Destinations
must be **spread across the operating area, not clustered in town.** A set of 20
destinations all within the market catchment would produce a benchmark that
measures one square kilometre and says nothing about อำเภอบุณฑริก.

---

## 39. Source hierarchy and coordinate confidence

`PROPOSED — REQUIRES OWNER APPROVAL`

This refines §19.2 and §19.3 for acquisition. **A coordinate with no traceable
source is not a fixture** and must be rejected, however plausible it looks.

| Confidence | Source class | Examples | Benchmark use |
|---|---|---|---|
| **HIGH** | Field-captured, or official/authoritative public record | A GPS reading taken standing at the location · an official government facility register · a coordinate confirmed on site by the local reviewer (§43) | Eligible for every metric, including distance accuracy |
| **MEDIUM** | Reputable public map/POI source, or local knowledge without a site visit | An OpenStreetMap node with a name and a sensible tag set · a public business listing · a place the local reviewer knows personally but has not re-visited | Eligible, **flagged in reporting**. Acceptable for route success, coverage and impossible-route metrics |
| **LOW** | Secondary public source, or derived | A coordinate quoted in an article or directory with no primary reference · a coordinate inferred from a nearby feature | **Diagnostic only.** Never a distance-accuracy input |
| **SYNTHETIC** | Invented test data | The three clusters in §37 | **Smoke test only** (§37.2) |

### 39.1 The provider-geocoded trap

A coordinate obtained by geocoding an address through a routing/mapping provider
is **`PROVIDER_GEOCODED`** and is capped at **LOW** confidence for this
benchmark, because using a provider's own geocode as the input to a test of that
provider's routing measures the provider against itself. It may be used to
*propose* a candidate for field confirmation, never to score one.

**The same applies to any coordinate obtained by public web research.** Web
research may identify *which* public places exist and roughly where they are; it
promotes a candidate to **MEDIUM at best**, and only when the source is a
primary public record or a named, tagged OSM node. Promotion to **HIGH** requires
field capture or the local reviewer's on-site confirmation.

### 39.2 Required provenance record

Every fixture carries: `coordinate_source` (the class above), the concrete
reference (URL, register name, or "field capture by <role>"), the **retrieval or
capture date**, and `coordinate_confidence`. **Anonymous or untraceable
coordinates are rejected** with reason `NO_TRACEABLE_SOURCE` (§41).

**No personal information may be scraped or recorded** in the course of this
research — a business name and its public location, nothing more.

---

## 40. Geographic stratification and coverage

`PROPOSED`

### 40.1 Bands — and the classification rule that must not be broken

The population must eventually cover bands **A–G** as defined in §18.1.

> **A fixture pair's band is `PRELIMINARY GEODESIC CLASSIFICATION` until a route
> has been computed for it.** `VERIFIED` as a D-12 requirement.
>
> Straight-line distance is a **planning aid only**: it is how the acquisition
> team decides which candidate probably lands in band C rather than band D. It
> is **not** the band, and it is **never** the D-12 test — D-12 is a **road
> distance** limit, not a radius and not a geodesic distance (DEC-061 D-12,
> unchanged).
>
> Every fixture and route record therefore carries **three distinct fields**:
> `preliminary_geodesic_band` (planning), `road_distance_m` (populated by the
> benchmark run), and `final_benchmark_stratum` (assigned from road distance
> after the run). A report that presents a geodesic band as a result is invalid.

Practically: road distance in a rural district commonly exceeds straight-line
distance by a wide margin, so a candidate pair whose geodesic separation is
12 km may well be a band E or an over-15 km case. Acquisition should therefore
**over-sample the 8–14 km geodesic range** to be confident of populating bands
D and E after routing.

### 40.2 Coverage targets

| Coverage dimension | Requirement |
|---|---|
| **Central town** | Present, but capped — no more than roughly half the destinations |
| **North / south / east / west** | Each direction from the town centre represented by at least one destination |
| **Village / rural** | At least 5 destinations on village or local roads (band F feeds from here) |
| **Outer area** | At least 3 destinations far enough out to produce band D and E routes after routing |
| **Difficult (band G)** | Only where genuinely present — see §46 |

### 40.3 The service-zone caveat

**The final service zone is not defined.** `VERIFIED` — no polygon column, table
or seed exists, and `service_areas` / `zones` remain deferred with `zone_id`
carrying no foreign key (§27). The repository's only stated geographic scope is
the district (อำเภอบุณฑริก) and the 3 km merchant catchment around
ตลาดสดบุณฑริก.

Acquisition must therefore **not** be scoped to a polygon that does not exist.
Collect across the district as described above; the polygon, when it is defined,
will classify these fixtures rather than the reverse. Fixture B-013 (§20.3, the
outside-polygon case) **cannot be finalised until the polygon exists** — that
remains an open prerequisite (§47), not something acquisition can close.

---

## 41. Quality, duplicate and rejection rules

`PROPOSED`

Every candidate is validated before it becomes a fixture. **Nothing is silently
discarded** — every rejection is recorded with its `rejection_reason` and kept in
the candidate list, so the same bad candidate is not re-proposed later.

| Check | Rule | Rejection reason |
|---|---|---|
| Duplicate coordinate | Identical `latitude`/`longitude` to an existing fixture | `DUPLICATE_COORDINATE` |
| Too close to another fixture | Below a minimum separation — **`PROPOSED`: 150 m** between two fixtures of the same type. Two destinations 20 m apart add a row and no information | `TOO_CLOSE_TO_EXISTING` |
| Invalid latitude/longitude | Outside valid ranges, transposed lat/lng, truncated precision, or a null island value | `INVALID_COORDINATE` |
| Outside the intended operating area | Outside อำเภอบุณฑริก, or so far outside that no plausible service zone reaches it | `OUTSIDE_OPERATING_AREA` |
| Impossible geographic location | In water, in a field with no road access, on a runway, or otherwise not a place a rider can arrive at | `IMPOSSIBLE_LOCATION` |
| Wrong POI category | Categorised as a public POI but actually a private residence, or a category that does not match §38 | `INVALID_CATEGORY` |
| Stale or closed | The business has closed, moved, or the facility no longer operates | `STALE_LOCATION` |
| Ambiguous | The name matches several places, or the source does not identify which one | `AMBIGUOUS_LOCATION` |
| Low confidence | `coordinate_confidence` is `LOW` and the fixture is proposed for an accuracy-bearing route | `CONFIDENCE_TOO_LOW` |
| No traceable source | `coordinate_source` cannot be stated concretely | `NO_TRACEABLE_SOURCE` |

**A rejected candidate may be re-admitted** once its defect is fixed — for
example a `LOW`-confidence candidate promoted to `HIGH` by field capture. The
re-admission and its reason are recorded; the original rejection row is not
deleted.

**Precision hygiene.** Record coordinates at 5–6 decimal places. `numeric(9,6)`
is what the schema stores (§7), and 6 decimal places is roughly 0.1 m —
recording more precision than the source has is a false claim of accuracy, and
recording fewer than 5 introduces error at the same scale as the thing being
measured.

---

## 42. Route matrix design

`PROPOSED`

### 42.1 Why a stratified sample, not a Cartesian product

With 8 origins and 18 destinations, the full matrix is **144 routes**. That is
the wrong design for four independent reasons:

1. **It measures the wrong thing.** 144 routes drawn from 26 points are heavily
   correlated: every route from one origin shares its first road segment, so one
   bad segment contaminates 18 "independent" results and inflates any error rate
   built from them. A stratified sample deliberately spreads across origins so
   that correlated failures are visible rather than multiplied.
2. **It buries the strata that matter.** A Cartesian matrix over a town-centred
   population is dominated by short town routes. Band F and band G — the cases
   most likely to fail, and the ones D-16 actually turns on — would be a handful
   of rows among a hundred, and the aggregate figures would be carried by the
   easy cases (§24.9 exists to prevent exactly this).
3. **Ground truth does not scale.** Tier 2 verification is a person judging a
   route (§43). 144 routes is not reviewable; 20–40 is. An unverified route
   contributes nothing to a distance-accuracy metric, so a matrix larger than
   the ground-truth budget is mostly padding.
4. **Cost and quota.** §31 requires a small, enumerated, budget-capped request
   set. A Cartesian matrix that grows quadratically with fixture count is the
   opposite of a bounded one.

### 42.2 Target size, and the reconciliation it forces

**Target: approximately 20–40 route cases.**

> **Reconciliation — this supersedes §18.4's proposed ~76 routes.** `PROPOSED`
> §18.4 was written before the fixture inventory was known and sized the
> population from statistical comfort alone. With **zero** real fixtures in hand
> (§37) and Tier 2 as the ceiling on ground truth (§21), 20–40 routes built from
> 20–30 acquired coordinates is the achievable and reviewable target. §18.4's
> stratum table remains a useful shape; its totals are superseded by this
> section. **Final sample size is an owner decision** (§48, OD-1), and the
> §24.4 rule stands unchanged: any percentile must be published with its `N`,
> and with `N < 20` in a stratum the maximum is reported alongside the p95.

### 42.3 Route record

| Field | Notes |
|---|---|
| `route_id` | Stable, e.g. `R-001`. Maps onto the `B-0NN` cases in §20.3 where they correspond |
| `origin_fixture_id` | From §38.1 |
| `destination_fixture_id` | From §38.2 |
| `route_type` | `RESTAURANT_TO_CUSTOMER` (a merchant-like origin) or `POINT_TO_POINT` (diagnostic, §19.1) |
| `preliminary_band` | **`PRELIMINARY GEODESIC CLASSIFICATION`** — planning only (§40.1) |
| `preliminary_geodesic_m` | The straight-line separation used to propose that band |
| `ground_truth_tier` | Expected tier: 2 where a reviewer is available, else none |
| `benchmark_stratum` | Required stratum this route is meant to fill (A–G). **Final stratum is assigned from road distance after the run** |
| `purpose` | One line: what this route is for |
| `notes` | Known local context — a bridge, a seasonal road, an access restriction |

### 42.4 Sampling rule

`PROPOSED`

- Every origin appears in **at least 2** and **at most 6** routes — enough to
  see origin-specific behaviour, not enough to let one origin dominate.
- Every required stratum has **at least 3** routes, or is explicitly reported as
  **not evaluated** (§18.3's rule, unchanged).
- Band F is sampled **across** bands A–D, not concentrated at one distance.
- Bands D and E are drawn from the over-sampled 8–14 km geodesic candidates
  (§40.1), accepting that some will land in a different band once routed.
- The §24.8 consistency subset (repeat requests) is chosen to span strata, not
  taken from the shortest routes.

---

## 43. Tier 2 ground truth — the local reviewer process

`PROPOSED`

**Tier 1 (rider GPS trace) is unavailable and is not introduced here.**
`VERIFIED` — location capture is a single foreground reading with a `{lat,lng}`
payload and latest-position-only storage, gated on Q-012 and TQ-016 (§21).
**Tier 2 — human verification using actual local road knowledge — is the highest
achievable ground truth** for the first benchmark run.

### 43.1 What the reviewer is asked

For each route, given the provider's proposed route, the reviewer records:

| Question | Answer form |
|---|---|
| Is the route **physically usable**? | Yes / No / Partly, with a reason |
| Is it passable by **motorcycle** (มอเตอร์ไซค์)? | Yes / No / Seasonally, with a reason |
| Is the **major road choice** what a local rider would take? | Yes / No / Acceptable alternative |
| Is there an **obvious detour** — a materially longer path than the local one? | Yes / No, with the local alternative described |
| Is the destination **actually accessible** by that final approach? | Yes / No — gate, one-way, no through road, wrong side of a canal |
| Is the route **materially unreasonable** overall? | Yes / No — this is the §24.6 `impossible` verdict |

Plus the §24.3 verdict: `RIDEABLE_AS_ROUTED` · `RIDEABLE_BUT_NOT_OPTIMAL` ·
`NOT_RIDEABLE` · `WRONG_DESTINATION_APPROACH`, with a one-line reason.

### 43.2 What Tier 2 does and does not give

**It gives:** a defensible judgement on usability, motorcycle access, road
choice, detours, accessibility and gross unreasonableness — which is exactly
what §25.1's qualitative gates need.

**It does not give distance accuracy at any fine resolution.** A person saying
"about 6 km, that's roughly right" is not a measurement. Where a **distance**
delta is needed, it must come from an odometer reading or a one-off GPS capture
on a ridden route, recorded as such — and even then, odometer readings vary with
tyre size and calibration, and a single GPS ride carries its own error. **Any
distance-accuracy figure must state its measurement method**, and a Tier 2
opinion must never be presented as one.

### 43.3 Process integrity

- **Blind where practical.** In a later Google-versus-OSRM run (§28), the
  reviewer should not know which engine produced a route.
- **One reviewer, recorded.** The reviewer's identity (by role, not personal
  detail) and the review date are part of the record.
- **Disagreement is data.** Where two reviewers differ, both verdicts are kept;
  the route is flagged rather than averaged.
- **Reviewer assignment is an owner decision** (§48, OD-3). No reviewer exists
  today.

---

## 44. Fixture file format

`PROPOSED` — **no fixture file is created by this document, because there is
nothing to put in it** (§46).

### 44.1 Where it belongs, and where it does not

**Recommended location: `ai/RESEARCH/fixtures/` as CSV**, tracked in Git and
reviewed like any other change.

Deliberately **not**:

- **not a migration** — this is research input, not schema;
- **not a database table** — no `benchmark_fixtures` table, no column, no RLS
  policy, no RPC. The database is locked (§10 working rules), and the benchmark
  harness reads a file (§27);
- **not `supabase/seed-dev/`** — that directory's convention is *privileged,
  idempotent, id-namespaced SQL that provisions live rows in `banhao-dev`*
  (`docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md` §1, F19). Benchmark fixtures
  provision nothing and must never be inserted into the live project, where they
  would immediately become indistinguishable from real catalog data.

The repository has **no existing CSV or data-file convention** `VERIFIED`, so
CSV is proposed on its merits: diffable in review, editable by a non-engineer
doing field capture, and trivially readable by a throwaway harness.

### 44.2 Fixture schema

```text
fixture_id
fixture_type              ORIGIN | DESTINATION
name
latitude
longitude
locality
coordinate_source         FIELD_GPS | OFFICIAL_PUBLIC_RECORD | PUBLIC_MAP_POI |
                          LOCAL_KNOWLEDGE | PROVIDER_GEOCODED | SECONDARY_PUBLIC |
                          SYNTHETIC_DEV_FIXTURE
source_reference          URL, register name, or "field capture by <role>"
retrieved_at              ISO-8601 date of retrieval or capture
coordinate_confidence     HIGH | MEDIUM | LOW | SYNTHETIC
public_poi                true | false        (false is only ever a rejection)
poi_category              restaurant | market | school | temple | fuel | ...
preliminary_geodesic_band A | B | C | D | E    — PRELIMINARY, planning only
road_class                town road | village road | soi | highway | mixed
status                    CANDIDATE | ACCEPTED | REJECTED
rejection_reason          one of §41's reasons, or empty
notes
```

### 44.3 Route matrix schema

```text
route_id
origin_fixture_id
destination_fixture_id
route_type                RESTAURANT_TO_CUSTOMER | POINT_TO_POINT
preliminary_band          PRELIMINARY GEODESIC CLASSIFICATION
preliminary_geodesic_m
ground_truth_tier         2 | none        (1 is unavailable — §43)
benchmark_stratum         A | B | C | D | E | F | G
purpose
notes
```

**Road distance, duration and the final stratum are deliberately absent from
both files.** They are outputs of a benchmark run and belong in the §22
append-only result record, keyed by `benchmark_run_id` — never written back into
the fixture file, where they would silently become inputs.

### 44.4 Synthetic quarantine in the file

If the three §37 clusters are ever listed in the fixture file for harness smoke
testing, each row carries `coordinate_confidence = SYNTHETIC` and
`notes = "SYNTHETIC — SMOKE TEST ONLY"`, and the harness must **refuse** to
include a `SYNTHETIC` row in any metric computation. Enforcement in the harness,
not in a comment.

---

## 45. Fixture acceptance rule

`PROPOSED — REQUIRES OWNER APPROVAL`

A fixture is eligible for the benchmark **only if all seven hold**:

1. **Public and non-sensitive** — it is a public POI, not a residence, and
   carries no personal information (§36.2).
2. **Traceable to a source** — `coordinate_source`, `source_reference` and
   `retrieved_at` are all recorded (§39.2).
3. **Confidence acceptable for its intended use** — `HIGH` or `MEDIUM` for any
   accuracy-bearing route; `LOW` is diagnostic only (§39).
4. **Geographically valid** — passes every §41 validity check.
5. **Category valid** — matches a §38 category, and the category matches
   reality.
6. **Contributes to a required stratum** — a fixture that duplicates coverage
   already held adds cost and no evidence.
7. **Not a duplicate** — distinct from every accepted fixture by more than the
   minimum separation (§41).

Failing any of the seven means `status = REJECTED` with the reason recorded, not
deletion.

---

## 46. Missing fixtures — `FIXTURE ACQUISITION REQUIRED`

`VERIFIED`

**No real coordinate could be safely established from existing repository
material.** The repository holds three clusters of self-declared invented
coordinates (§37), one unsourced OSM administrative fact without coordinates,
and one named anchor POI (ตลาดสดบุณฑริก) whose position is recorded nowhere.

**Therefore: `FIXTURE ACQUISITION REQUIRED` for the entire population.**

| Category | Target | Held today | Status |
|---|---|---|---|
| Anchor POI — ตลาดสดบุณฑริก | 1 | 0 (named only, no coordinate) | **FIXTURE ACQUISITION REQUIRED** |
| Merchant-like origins | 5–10 | 0 | **FIXTURE ACQUISITION REQUIRED** |
| Public destinations | 15–20 | 0 | **FIXTURE ACQUISITION REQUIRED** |
| Village / rural destinations (band F feed) | ≥5 | 0 | **FIXTURE ACQUISITION REQUIRED** |
| Outer-area destinations (bands D/E feed) | ≥3 | 0 | **FIXTURE ACQUISITION REQUIRED** |
| Boundary case, inside polygon and >15 km road (B-012) | 1 | 0 | **BLOCKED** — also needs the service polygon (§40.3) |
| Outside-polygon case (B-013) | 1 | 0 | **BLOCKED** — needs the service polygon |
| Difficult / band G | ≤8, only if genuine | 0, and **unknown whether any exist** | **FIXTURE ACQUISITION REQUIRED — existence unverified.** Whether อำเภอบุณฑริก contains bridges, river crossings or disconnected road segments relevant to delivery **is not established anywhere in this repository**, and was not guessed at |
| Ambiguous-location case (B-017) | 1 | 0 | **FIXTURE ACQUISITION REQUIRED** |

> **No coordinate was fabricated to fill any row above, and none may be.** A
> plausible-looking coordinate is worse than an empty cell: an empty cell blocks
> the benchmark honestly, while a fabricated one produces a number that looks
> like evidence.

### 46.1 On using public web research to seed candidates

`OPEN DECISION` — see §48, OD-5.

Public web research (an OSM/Nominatim lookup, a public business listing, a
government facility register) could produce **MEDIUM**-confidence candidate
coordinates without any routing API call, and would shorten field work by
telling the acquisition team where to go.

**This document deliberately did not do that**, for three reasons:

1. Under §39.1 such coordinates are capped at MEDIUM and still require on-site
   confirmation before they can carry a distance-accuracy metric — so they
   change the order of the field work, not its necessity.
2. An unverified coordinate recorded in this document would very likely become
   "the" anchor for everything downstream, and §37.1 shows exactly how an
   unsourced anchor propagates unnoticed.
3. Whether a POI is currently open, correctly categorised and correctly placed
   (§41's `STALE_LOCATION`, `INVALID_CATEGORY`, `AMBIGUOUS_LOCATION` checks)
   cannot be settled from a desk.

**It remains available as an explicitly authorized follow-up.** If the owner
wants a provisional candidate list to plan field work from, that is a separate
task with a stated source policy — and its output would be `CANDIDATE` rows at
`MEDIUM` confidence, never `ACCEPTED` fixtures.

---

## 47. Execution prerequisites

`PROPOSED` — what must be true before Stage A (§30) can start, and before
anything downstream of it can.

| # | Prerequisite | Blocks | Owner or engineering |
|---|---|---|---|
| 1 | **A person on the ground in อำเภอบุณฑริก** with a GPS-capable phone | All acquisition | Operational |
| 2 | **Local reviewer assigned** for Tier 2 verification (§43) | Every qualitative metric and every §25.1 gate | **Owner** (§48, OD-3) |
| 3 | **Anchor coordinate for ตลาดสดบุณฑริก** | Band A/B shape, and the 3 km catchment | Field capture |
| 4 | **Fixture file created and reviewed** at `ai/RESEARCH/fixtures/` | Stage A completion | Engineering |
| 5 | **Service-zone polygon defined** | §26 cases 2 and 3; fixtures B-012 and B-013; Stage B | **Owner + engineering.** Still absent (§27, §40.3) |
| 6 | **Owner approval of sample size and thresholds** | Turning a run into a verdict | **Owner** (§48) |
| 7 | **Routing client, benchmark credential, budget cap and kill switch** | Stage C only | Engineering (§31) |
| 8 | **Current Google pricing re-verified** | Any cost argument at D-16 | Engineering (DEC-061 open item) |

Prerequisites 1–4 are the acquisition critical path and are **field work that
cannot be done from this repository**. Prerequisite 5 is independent of
acquisition and can proceed in parallel.

---

## 48. Owner decision items

**Nothing below is decided here.** These are the items a later owner review must
settle. **D-16 remains `OPEN`. D-17 remains `OPEN`.**

| ID | Item | Notes |
|---|---|---|
| **OD-1** | **Final benchmark sample size** — 20–40 routes (§42.2) versus §18.4's earlier ~76 | §42.2 reconciles the two and proposes 20–40; the owner chooses |
| **OD-2** | **Final acceptance thresholds** — §25.2's proposed numbers | None has approval; none may be cited as a requirement until it does |
| **OD-3** | **Local reviewer assignment** — who performs Tier 2 verification | No reviewer exists. Without one, every qualitative gate in §25.1 is unevaluable |
| **OD-4** | **Are public POIs sufficient?** — given §36.3's limitation that public POIs understate the final-approach problem | If not, the alternative involves customer addresses and is gated on OD-6 |
| **OD-5** | **Public web research for candidate coordinates** — whether to run the §46.1 follow-up | Would produce `CANDIDATE`/`MEDIUM` rows only, never accepted fixtures |
| **OD-6** | **Whether and when real delivery GPS may be used** | Gated on **Q-012**, **TQ-016**, **BQ-022**. Not an engineering call |
| **OD-7** | **Minimum fixture separation** — §41 proposes 150 m | A tuning parameter, stated so it is not invented silently later |
| **OD-8** | **Service-zone polygon definition** — a business boundary decision (§3), not an engineering one | Blocks §26 cases 2 and 3 and fixtures B-012/B-013 |

---

## 49. Part III conflicts with existing documents

**One reconciliation, stated rather than applied silently:**

- **§18.4's proposed ~76-route population is superseded by §42.2's 20–40.**
  §18.4's stratum *shape* is retained; only its totals change, and the change is
  driven by the fixture inventory (§37) and the Tier 2 ground-truth ceiling
  (§43) — neither of which was known when §18.4 was written. **Final size is
  OD-1.** §18.4's text is left in place and this section is the record of why it
  no longer governs.

**No other conflict was found.** `docs/TODO.md:99` already asks for the tracking
prototype's simulated coordinates to be replaced with a real source before any
real use, which this part reinforces rather than contradicts. No approved
architecture document was modified, `docs/DECISIONS.md` is untouched, and the
existing synthetic fixtures are preserved in place and quarantined by
classification (§37.2) rather than deleted.

---

## 50. Sources

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
- Repository state cited inline in §7, verified at `897c8b69`; §20, §21, §23,
  §27 and §32 verified at `25e22b28`.
- `supabase/seed-dev/catalog_dev_seed.sql`, `supabase/seed-dev/g71_offer_fixture.sql` —
  the only persisted coordinates in the project, both self-declared synthetic.
- `apps/driver/src/lib/deviceLocation.ts`, `packages/validation/src/rider.ts`,
  `apps/api/src/modules/rider/rider-location.service.ts` — why no GPS trace
  exists.
- `docs/OPEN_TECHNICAL_QUESTIONS.md` — **TQ-016** (rider location retention and
  access), gating Tier 1 ground truth with **Q-012**.
- `design/tracking/tracking-map.html` (and its duplicate `docs/design/tracking-map.html`),
  `docs/TODO.md:99` — the third synthetic coordinate cluster, self-labelled
  `พิกัดโดยประมาณ, ข้อมูลจำลอง`.
- `docs/BUSINESS_RULES.md:84,811`, `docs/RIDER_LIFECYCLE.md:30` — ตลาดสดบุณฑริก
  as BANHAO's own designated launch centre and 3 km merchant catchment.
- `docs/G7_1_FIXTURE_PROVISIONING_DESIGN.md` §1 (F19, F20) — the repository's
  existing conventions for privileged live fixture data and for read-only live
  verification, and why benchmark fixtures belong in neither.
- Repository state for Part III verified at `a0ac526c`.
