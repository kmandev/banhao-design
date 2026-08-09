# Maps / Location Analysis

All pricing checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a provider.**

## Capabilities BANHAO needs

Map display, geocoding + reverse geocoding, routing/directions (driver navigation, TR-008), distance matrix (delivery time/fee estimation), live driver location tracking (TR-009), and ideally geofencing.

## ⚠️ Two findings that should shape the decision

**1. HERE's Base Plan licence excludes exactly what BANHAO needs.** HERE explicitly lists **Asset Management** — "locating, tracking and/or displaying on a map" — among its Base Plan excluded use cases. Live driver tracking is precisely that. This likely forces an Enterprise contract, negating the cheap Base Plan rates quoted below. HERE's pricing page also carries a disclaimer that prices are "indicative estimates only and should not be considered final price quotes."

**2. Google's pricing model changed materially in March 2025.** The familiar flat **$200/month credit is gone**, replaced by per-SKU free caps. This is better than it sounds for a multi-API app: the caps are **per SKU**, so a delivery app touching Maps + Geocoding + Routes + Route Matrix gets 10,000 free calls on *each* independently, not 10,000 shared.

## Options compared

### Google Maps Platform

Covers all six needed capabilities.

- Free per SKU per month: **Essentials 10,000 / Pro 5,000 / Enterprise 1,000**. Essentials Map Tiles: up to 100,000 free per SKU. New customers get a $300 trial credit.
- **Mobile Maps SDK (SKU 6DE1-4D9C-5B67) is unlimited free** — no per-1,000 charge. Notable for the Customer and Driver apps.
- Dynamic Maps (Essentials): 10,000 free, then $7.00 → $0.53 per 1,000 by volume.
- Geocoding (Essentials — forward *and* reverse on one SKU): 10,000 free, then $5.00 → $0.38 per 1,000.
- Compute Routes (Essentials): 10,000 free, then $5.00 → $0.38 per 1,000. Pro tier: 5,000 free, then $10.00 → $0.75.
- Compute Route Matrix (Essentials): 10,000 free, then $5.00 → $0.38 per 1,000.
- Subscription alternative to pay-as-you-go: Starter $100/mo (50,000 calls), Essentials $275/mo (100,000), Pro $1,200/mo (250,000).
- **Geofencing is not a billed Maps Platform SKU** — on Android it comes from Google Play services Location (`getGeofencingClient`), free, limited to 100 geofences per app per device user.

### Mapbox

Free tiers are substantially more generous than Google's at BANHAO's likely volumes — 100,000 free directions/matrix requests vs Google's 10,000.

- Map Loads (Web): 50,000/mo free, then $5.00 → $3.00 per 1,000. Mobile Maps SDK: 25,000 MAU free, then $4.00 → $2.40 per 1,000 MAU.
- Geocoding (temporary): **100,000/mo free**, then $0.75 → $0.45 per 1,000.
- ⚠️ Geocoding (**permanent** — i.e. storing results, which BANHAO would do for saved delivery addresses): **no free tier**, $5.00 per 1,000 up to 500k. This distinction matters and is easy to miss.
- Directions API: **100,000/mo free**, then $2.00 → $1.20 per 1,000.
- Matrix API: **100,000 elements/mo free**, then $2.00 → $1.20 per 1,000.
- Navigation SDK (metered trips): 100 MAU + 1,000 trips/mo free, then $0.30/user and $0.08/trip.
- Geofencing exists for iOS/Android (enter/exit/dwell) — **specific SKU price not found**.

### HERE Technologies

Rates below are from the official pricing calculator, but read the Base Plan restriction above first — it likely makes these inapplicable to BANHAO.

- Map Rendering (Vector Tile): 30,000/mo free, then $0.088 per 1,000.
- Geocode and Reverse Geocode: 30,000/mo free, then $0.88 per 1,000. **Permanent geocoding is not included in the Base Plan** (contact sales).
- Routing (Car/Bicycle/Pedestrian): 30,000/mo free, then $0.88 per 1,000 — but requires `departureTime=any` or traffic disabled, otherwise billed as Time-Aware Routing (5,000 free, then $2.92 per 1,000).
- **Routing Scooter / Two Wheel: 5,000 free, then $2.92 per 1,000** — relevant since Thai delivery is motorcycle-based (the design's own driver wireframes say "ไรเดอร์มอเตอร์ไซค์").
- Matrix Routing: 2,500 free, then $5.83 per 1,000 (supports up to 10,000 origins/destinations).

### OpenStreetMap self-hosted (OSRM / GraphHopper)

Trades per-request fees for infrastructure and operations cost.

- **Thailand's OSM extract is only 310 MB** (file dated 2026-08-06) — small enough that self-hosting is genuinely viable on a modest VPS, unlike the multi-GB continental extracts that make this painful elsewhere.
- **OSRM** (BSD-2-Clause) provides Route, **Table** (distance/duration matrix), **Match** (GPS trace snapping — directly useful for driver tracking), Trip, and Nearest services.
- **GraphHopper** (Apache 2.0) — explicitly "easy for you to embed... even closed source"; provides routing, map matching, and isochrones as a Java library or standalone server.
- GraphHopper also sells a hosted API: Free €0/mo at 500 credits/day is **non-commercial only**; Basic €69/mo (5,000 credits/day); Standard €199/mo; Premium €479/mo.
- ⚠️ **You cannot use OSM's own tile server.** The OSMF tile policy prohibits bulk downloading and heavy use, blocks offenders without notice, and states commercial access can be revoked at any time. Self-hosted tiles or a commercial tile provider are required. Managed option: **MapTiler Cloud** — Free $0 (5,000 map sessions, non-commercial), Flex $30/mo (25,000 sessions, 500,000 API requests).
- ⚠️ OSRM publishes **no official RAM requirements**. A widely-cited community rule of thumb is ~5× the PBF size (so ~1.5 GB for Thailand), but this is third-party and unofficial — do not budget on it alone.

### Longdo Map (Thai provider)

**Confirmed alive and actively sold in 2026** — Thai-operated (Metamedia Technology, Bangkok). The free tier is enormous compared to Western providers.

- **Free plan: <800,000 map transactions/month and <100,000 service transactions/month at ฿0** — rate-limited to 60 req/min and **5,000 req/day**. That daily rate limit, not the monthly volume, is the real ceiling.
- Paid tiers jump steeply: Starter ฿8,250/mo, Basic ฿13,750/mo, Standard ฿22,917/mo, Premium ฿27,500/mo.
- Transaction weighting matters: map load, search, reverse geocoding, route calculation = 1 transaction each; autocomplete = 0.1; smart search / geocoding = 3–5; **route matrix = m × n** (so matrix queries are expensive here).
- Map transactions are tile image loads; browser-cached tiles are not re-charged.
- Products include Map API3 (vector tiles, 3D, clustering, heatmaps), place search, and Forecast Routing.
- **Geofencing and live tracking are not found as named products** on the public pages.

## Rural Thailand coverage — the question that matters most, and can't be desk-researched

BANHAO launches in **อำเภอบุณฑริก**, a rural district. Map data quality there is more consequential than pricing, and:

**No provider publishes district-level coverage or accuracy data for Thailand.** Google, Mapbox, HERE, and Longdo all publish nothing verifiable at this granularity, and no independent measurement for Buntharik was found.

What *is* verifiable: a live Nominatim query for "บุณฑริก อุบลราชธานี" returns **อำเภอบุณฑริก as an administrative boundary relation (postcode 34230)** plus บุณฑริก as a place/town node in ตำบลคอแลน. So OSM has the district and town.

⚠️ **But administrative boundaries existing does not imply house-number-level address coverage.** Thai rural addressing (บ้านเลขที่ / หมู่ / ตำบล) is poorly represented in OSM generally, and no completeness measurement exists for this district. Note the design's own address example — "88 หมู่ 4 บ้านบุณฑริก ต.บุณฑริก อ.บุณฑริก" — is exactly the format most likely to geocode poorly.

**This needs field spot-checking against real Buntharik addresses, not more desk research.** Longdo's Thai-local POI/address data is the plausible advantage over Google/Mapbox in a district like this, but that is a hypothesis to test, not a finding. See Q-018.

## Trade-off summary

| Priority | Strongest options |
|---|---|
| Most generous free tier at BANHAO's volume | **Mapbox** (100k free directions/matrix) or **Longdo** (800k map transactions) |
| Best-known data quality globally | **Google** (but rural Thai accuracy unverified) |
| Best potential Thai-local data | **Longdo** (unverified — needs field testing) |
| Lowest marginal cost at scale | **Self-hosted OSM** (310 MB extract makes this viable) — trades per-request fees for ops burden |
| Avoid | **HERE** — Base Plan licence excludes asset tracking, the core use case |

A plausible hybrid worth evaluating: self-hosted OSRM for routing/matrix (the highest-volume, highest-cost calls) with a commercial provider for tiles and geocoding. Not proposed as a decision — noted because the 310 MB extract size makes it more practical than usual.

**Cost driver to watch:** per-request maps pricing scales with driver-location update frequency, which is an engineering choice. An aggressive polling design can multiply this bill — see `ai/RESEARCH/RISK_MATRIX.md`.
