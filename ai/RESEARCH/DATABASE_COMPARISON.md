# Database Comparison

All data checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a database** — Q-007 remains `OPEN`.

Unlike the backend question (`ai/RESEARCH/BACKEND_COMPARISON.md`), the evidence here points fairly clearly in one direction. That still requires Product Owner approval to become a decision.

## Why this decision is unusually consequential for BANHAO

Three of BANHAO's non-negotiable constraints are database-shaped:

- **CON-001** — Order State and Payment State must be separately persisted yet consistent.
- **CON-003** — every order's ledger must balance to exactly zero, with no unaccounted remainder.
- **REQ-004** — five generic entities must carry phase-specific meaning without a schema rewrite (Food → Parcel → Ride → Shopping).

Plus a heavy geospatial workload implied by the design: "find the nearest available riders," delivery-distance/fee calculation, and the Admin Live Map.

So the evaluation weights **transactional integrity**, **geospatial capability**, and **JSON flexibility** above raw throughput.

## Comparison matrix

| Criteria | PostgreSQL | MySQL / MariaDB | MongoDB |
|---|---|---|---|
| Relational integrity | ●●● | ●●● | ●○○ |
| Transactions / ACID | ●●● | ●●○ | ●○○ |
| Order state modeling | ●●● | ●●● | ●●○ |
| Payment ledger | ●●● | ●●○ | ●○○ |
| Settlement / reporting | ●●● | ●●● | ●●○ |
| Geospatial queries | ●●● | ●●○ | ●●● |
| Indexing | ●●● | ●●○ | ●●● |
| Concurrency | ●●○ | ●●● | ●●● |
| JSON support | ●●● | ●●○ | ●●● |
| Scalability | ●●○ | ●●○ | ●●● |
| Backup / HA | ●●● | ●●● | ●●● |
| Managed hosting | ●●● | ●●○ | ●●● |
| Cost | ●●● | ●●● | ●●○ |
| Developer availability | ●●● | ●●● | ●●○ |
| Operational complexity | ●●○ | ●●● | ●●○ |

## Reasoning per criterion

**Transactions / ACID — the deciding criterion.**

*PostgreSQL:* Full MVCC where "reading never blocks writing and writing never blocks reading," with true **Serializable Snapshot Isolation (SSI)**. For a ledger this is the key property: you can express double-entry invariants and let the database reject anomalies, rather than hand-rolling optimistic locking. Also fully transactional DDL — a failed migration rolls back cleanly.

*MySQL/MariaDB:* InnoDB is genuinely ACID-compliant with MVCC and sufficient for orders and payments. Two real caveats: default Repeatable Read has well-known anomalies that differ from PostgreSQL's, and **DDL is not transactional** — a failed migration can leave the schema half-applied, a real hazard on a payments schema.

*MongoDB:* Multi-document ACID transactions exist (replica sets since 4.0, sharded since 4.2), but MongoDB's own documentation states they "incur a greater performance cost over single document writes," with additional cost across shards, and that the denormalized model remains optimal in many cases. Isolation is snapshot with **optimistic concurrency control**, so write conflicts surface as errors the application must catch and retry. **For BANHAO's order → payment → ledger → payout chain, the database is working against the grain**: MongoDB's design assumes you avoid multi-document transactions, while a financial ledger requires them constantly. This is the single clearest disqualifier in this comparison.
*(Note: a "1,000 document modifications per transaction" limit appears in secondary sources but was removed in MongoDB 4.2 — **not cited as current**. Exact current runtime/oplog limits were **not verified**.)*

**Geospatial — PostgreSQL's decisive advantage.**

*PostgreSQL + PostGIS:* The reference implementation of open-source geospatial. The `<->` KNN operator performs **index-assisted nearest-neighbour search** and is "dramatically faster than computing all distances and sorting" — precisely the "find the 10 nearest available riders" query BANHAO will run constantly. `geography` gives true geodetic distance; `ST_DWithin` gives indexed radius search; **pgRouting adds real road-network routing** (not just straight-line distance), and **H3** gives hex-grid bucketing usable for demand heatmaps and dispatch zones. Both pgRouting and H3 are available on Neon and Supabase.

*MySQL:* Real spatial support exists (SRID 4326, `ST_Distance_Sphere`), but documented best practice requires **combining an `MBRContains` bounding-box query against the spatial index with `ST_Distance_Sphere` for accuracy** — never relying on the latter alone for indexed queries. There is no equivalent of PostGIS's single-operator indexed KNN; you hand-roll a two-stage query. `ST_Distance_Sphere` is also limited to points/multipoints. No routing, no H3.

*MongoDB:* Genuinely good and its strongest card — 2dsphere indexes over GeoJSON with `$near`, `$geoWithin`, and the `$geoNear` aggregation stage that fuses match + sort + limit and returns a computed `distanceField` (a clean fit for "nearest riders with distance attached"). But no routing, no PostGIS-grade function library, no pgRouting/H3 equivalent. Gotchas: coordinates are **longitude-first**, and `2d` indexes give wrong results near the poles.

**JSON support — matters for REQ-004.**

*PostgreSQL:* `jsonb` is binary, needs no reparsing, and critically supports **GIN indexes on arbitrary paths** — you can query inside JSON without predeclaring which keys you'll need. Directly serves REQ-004's "phase-specific attributes without a rewrite."

*MySQL:* JSON is stored in optimized binary form, but **you cannot index JSON directly** — you must create a generated/virtual column extracting a specific path and index that. For an evolving menu schema where tomorrow's query keys are unknown, that's a structural constraint. MySQL's cheaper partial in-place JSON updates are its one advantage here.

*MongoDB:* Best in class by definition — the document model *is* the evolving-menu use case; any field is indexable without generated columns. If schema evolution were the only requirement, MongoDB would win outright.

**Concurrency — PostgreSQL's known weakness.** PostgreSQL forks an OS process per connection (~5 MB each), with default `max_connections` of 100 and guidance to stay under ~10–20 per CPU core. **PgBouncer in transaction mode must be planned from day one** — a known, solved problem, but an operational requirement rather than an option. (PgBouncer is single-threaded and tops out around 15,000 queries/sec per instance.) MySQL's thread-per-connection model and MongoDB's WiredTiger document-level concurrency both tolerate high connection counts without a pooler — a genuine operational simplification for them.

**Scalability.** MongoDB's native sharding is the most mature horizontal-scale story of the three — a real advantage *if* a single write primary ever becomes the bottleneck. Note the tension: sharding is precisely where MongoDB's transaction guarantees degrade further. PostgreSQL and MySQL both scale vertically plus read replicas comfortably through Stage 3 (`ai/RESEARCH/SCALE_MODEL.md`).

**Backup / HA.** All three are strong on managed platforms. MongoDB Atlas has the most polished story: minimum three-node replica set across AZs, **RPO = 0, RTO in seconds, 99.995% uptime SLA**, backups **immutable by default** with a Backup Compliance Policy preventing even admins from deleting them — a meaningful control for a payments business facing Thai regulatory scrutiny (`ai/RESEARCH/THAILAND_COMPLIANCE.md`). AWS RDS offers Multi-AZ DB *instance* (standby, failover only) vs Multi-AZ DB *cluster* (two standbys across 3 zones that also serve reads) for both PostgreSQL and MySQL.

**Recent version notes.** PostgreSQL 18 (25 Sep 2025) added asynchronous I/O (io_uring on Linux, reported up to 3× read improvements) and native **`uuidv7()`** — timestamp-ordered UUIDs that fix the index-locality problem UUIDv4 causes on high-insert tables like `orders`. Both directly relevant. MySQL 8.4 LTS has the longest support runway of any option here (Premier to April 2029, Extended to April 2032); MariaDB 11.8 LTS runs to June 2028.

**Adoption / developer availability.** Stack Overflow 2025: PostgreSQL **55.6%** overall (58.2% among professional developers), MySQL **40.5%**, MariaDB **22.5%**, MongoDB **24%**. PostgreSQL's lead over MySQL is wider than in any prior year. Locally, MySQL is the default in Thai SME/agency shops — **relevant if BANHAO hires from the Laravel/PHP pool** (`ai/RESEARCH/BACKEND_COMPARISON.md`), since those candidates will already know MySQL.

## Managed hosting pricing (all retrieved 2026-08-09)

**PostgreSQL:**

| Provider | Entry | Next tier |
|---|---|---|
| DigitalOcean | $15.15/mo (1 GiB, 1 vCPU, 10–30 GiB) | $60.90/mo (4 GiB, 2 vCPU) → $122.10/mo (8 GiB, 4 vCPU) |
| Supabase | Free ($0, 500 MB DB, 5 GB egress) | Pro $25/mo (8 GB disk incl., then $0.125/GB; 250 GB egress then $0.09/GB) |
| Neon | Free ($0, 0.5 GB, 100 CU-hours) | Launch $0.106/CU-hour + $0.35/GB-mo storage |

Supabase compute add-ons range Micro ~$10/mo to 16XL ~$3,730/mo; Team plan $599/mo. Neon extras: $1.50/branch-month, $0.10/GB egress beyond 500 GB, $0.20/GB-mo instant restore.

**MySQL:** DigitalOcean prices identically to PostgreSQL — $15.15/mo (1 GiB) → $30.45 (2 GiB) → $60.90 (4 GiB) → $122.10/mo (8 GiB); extra storage $0.215/GiB/mo. Supabase and Neon are PostgreSQL-only.

**MongoDB Atlas:** M0 free forever (512 MB shared); Flex $0.011/hour capped at $30/month (5 GB, priced by ops/sec — $8/mo at 0–100 ops/sec rising to $30/mo at 400–500); dedicated **M10 $0.08/hr** (2 GB RAM, 2 vCPU), **M20 $0.20/hr** (4 GB), **M30 $0.54/hr** (8 GB). DigitalOcean managed MongoDB: $15.23/mo (1 GiB) → $121.80/mo (8 GiB). Note M10 at ~$58/mo is roughly 4× DigitalOcean's 1 GiB tier for broadly comparable specs — Atlas charges a premium for its tooling.

⚠️ **AWS RDS pricing could not be verified for Singapore.** The RDS pricing page renders via JavaScript; the region-scoped JSON endpoints for ap-southeast-1 returned 404. Only **db.t4g.micro at $0.016/hour Single-AZ, US West (Oregon)** was consistently reliable — other extracted values were inconsistent between fetches and are deliberately **not quoted**. Use the AWS Pricing Calculator directly before any cost modeling. Two AWS figures that are clean: cross-AZ transfer between EC2 and RDS is **$0.01/GB**, and the free tier changed on **15 July 2025** (new signups get a Free Plan or a Paid Plan with $100 credits + up to $100 more, valid 12 months, replacing the old 750 hours + 20 GB offer).

## Trade-off summary

**PostgreSQL is the only option that is simultaneously best-in-class on all three criteria BANHAO's constraints actually weight:** ACID/ledger integrity (SSI), geospatial (PostGIS indexed KNN, pgRouting, H3), and flexible JSON (GIN-indexed `jsonb`). Its one real weakness — connection scaling — is a well-understood problem with a standard solution (PgBouncer) that must simply be planned for.

**MongoDB** wins on schema flexibility and managed-HA polish, and loses precisely where a payment ledger cannot afford to lose (CON-003). **MySQL** is a defensible second choice, strongest on operational simplicity and Thai hiring-pool alignment, but forces hand-rolled two-stage geospatial queries and pre-declared JSON indexes.

This is a **recommendation for Product Owner evaluation, not a decision.** Q-007 remains `OPEN`. See `ai/RESEARCH/HUMAN_DECISION_SHEET.md`.
