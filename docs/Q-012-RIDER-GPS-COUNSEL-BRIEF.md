# Q-012 / TQ-016 / BQ-022 — Thai Counsel Brief: Rider Location During Active Delivery

```
COUNSEL-HANDOFF PREPARATION MATERIAL
NOT LEGAL ADVICE · NO PDPA COMPLIANCE CLAIM IS MADE
NO DECISION IS LOCKED BY THIS DOCUMENT
RIDER GPS COLLECTION IS NOT AUTHORIZED (DEC-062 OD-6, preserved by DEC-063)
```

Written 2026-09-14 against HEAD `4d386316` on `feature/g7-driver-availability`.
Companion to [`Q-012-RIDER-GPS-OWNER-DECISION-PACK.md`](Q-012-RIDER-GPS-OWNER-DECISION-PACK.md).

This brief is written in English. **A Thai translation has not yet been
prepared.**

---

## 0. How to read this document

Every statement in this brief carries one of the following meanings. Where a
section mixes them, each item is labelled.

| Label | Meaning |
|---|---|
| `CURRENT DEVELOPMENT STATE` | Implemented in code and/or present in the BANHAO development environment. **BANHAO is pre-launch; no real rider data is collected or processed.** |
| `FUTURE PROPOSED PROCESSING` | Does not exist. Would only be built after the gate in §15 is passed |
| `OWNER INTENT` | The Product Owner's stated intention. **Not locked**, and may change after counsel's advice |
| `LOCKED DECISION` | An accepted BANHAO decision, cited by its identifier |
| `OPEN QUESTION` | An internal business or technical question not yet decided |
| `LEGAL QUESTION` | A question BANHAO asks counsel to answer (Q1–Q24, D-1–D-3) |

---

## 1. BANHAO context

BANHAO | บ้านเฮา is a hyper-local food-delivery platform for อำเภอบุณฑริก,
จังหวัดอุบลราชธานี. It is a three-sided marketplace: customers order, restaurants
prepare, and riders perform the customer deliveries. The district is small and
the rider pool will be small, which is relevant to re-identification (§12).

**Pre-launch status — `CURRENT DEVELOPMENT STATE`.**

- BANHAO has **not launched**. No application is deployed to any production
  environment, and no external production infrastructure exists yet.
- The only database is the development project `banhao-dev`, which contains
  **development and test data only**.
- **No real rider data has been collected**, and **production rider GPS tracking
  does not exist.**
- **No timestamped rider GPS trace exists anywhere** — in development or
  otherwise.

**Routing.** BANHAO will use road distance from a routing provider for pricing
and serviceability. The owner's intended Phase 1 direction is **Google Routes**
(Compute Routes), recorded as an owner-approved direction pending field
validation. **No routing provider is selected** — the provider/distance-source
decision, **D-16, is `OPEN`**, and no routing provider is integrated.

**Why this brief exists.** BANHAO wants, in the future, to compare a routing
provider's route output against the route a rider actually rode on a real
delivery, to learn whether the provider is accurate in a rural district. BANHAO
has **not** built this capability and has **not** authorized building it.

---

## 2. The legal question, precisely

BANHAO is **not** asking whether it may track riders.

BANHAO is asking:

> **Can BANHAO collect the minimum location data required to reconstruct the
> actual route of an assigned food-delivery order, only from pickup until
> customer arrival, for routing-quality measurement and future operational
> routing intelligence?**

The same engagement also covers the **rider operational feedback** described in
§3.4, which is a separate data flow with its own legal question (D-1).

Where it helps, please contrast your answers with continuous tracking of an
online rider (Q2, Q12). **BANHAO is not seeking approval for continuous
tracking.**

**Out of scope for this engagement:** continuous rider tracking; customer-facing
live rider tracking; rider onboarding and approval rules; payment licensing;
proof-of-delivery photos; any use of GPS to calculate rider pay.

---

## 3. Proposed future processing — `FUTURE PROPOSED PROCESSING` / `OWNER INTENT`

### 3.1 The intended window

`OWNER INTENT — NOT LOCKED`. The intended interval is `picked_up_at → arrived_at`.

```text
Order assigned
   ↓
Rider travels to restaurant               ← not intended to be traced
   ↓
Rider confirms pickup (picked_up_at)      ← trace ON
   ↓
Rider travels to customer                 ← traced
   ↓
Rider confirms arrival (arrived_at)       ← intended trace OFF (see §3.2)
   ↓
Handover to customer                      ← not intended to be traced
```

As a data flow:

```text
Restaurant → Order → Rider pickup → GPS trace during transit
          → Customer arrival → Quality control → Validated operational ground truth
```

**Not intended to be collected:** rider idle time; online/offline time with no
delivery in transit; the approach to the restaurant before pickup; movement
between orders; any location while no delivery is in transit.

**What the window would nevertheless capture.** Any movement that occurs
**during** the tracking window — including an unintended personal stop or
detour — would technically be captured if the future trace capability were
implemented. Such segments may later be rejected during quality control; they
are **not** "never collected."

### 3.2 The trace-stop rule is NOT LOCKED

`CURRENT DEVELOPMENT STATE`:

- Arrival confirmation is currently **optional**. The existing delivery
  completion step accepts a delivery in either `EN_ROUTE` or `ARRIVED`, so a
  delivery can be completed without `arrived_at` ever being recorded.
- The `arrived_at` capability (LOCKED DECISION **DEC-054**) was added to the
  repository schema on **7 September 2026**. It is **not deployed to any
  production system**.

Consequently a future system **cannot currently rely on the arrival tap as an
unconditional trace stop**. If arrival were skipped, a trace would continue
into the handover unless another stop rule applied.

**The final trace-stop rule is `NOT LOCKED`** — a future Product and Technical
decision. Options under consideration, none chosen:

- mandatory arrival confirmation before completion;
- a technical timeout;
- stopping on reassignment, failure or abandonment;
- another explicit transit-exit event.

Counsel's view on whether any of these is legally necessary is invited (Q1, Q11).

### 3.3 One trace, one delivery

`LOCKED DECISION` — **DEC-037** fixes **one active delivery per rider** for
Phase 1 (resolving BQ-021). The intended trace therefore maps to exactly one
delivery and one order. Any future decision to permit batching (concurrent
deliveries) would require a new decision superseding DEC-037 and would require
revisiting this one-trace-per-order assumption.

### 3.4 Rider operational feedback

`FUTURE PROPOSED PROCESSING` · `OWNER INTENT — NOT LOCKED`. After the delivery,
the rider could report a routing problem using closed codes, for example: road
not rideable; road unsuitable for a motorcycle; road closed or blocked;
destination inaccessible; obvious detour; customer pin incorrect; provider
route differed materially from the practical route; other routing issue. The
intended design is minimal data, **no free text by default**, prompted only
after arrival — never while riding. Whether feedback is optional or mandatory is
`OPEN`. No feedback mechanism exists.

### 3.5 Separate existing capability — not part of this proposal

`CURRENT DEVELOPMENT STATE`. The code contains a **latest-position** mechanism
for dispatch eligibility (LOCKED DECISION **DEC-037**: a rider is eligible if
approved, online and with a valid recorded location). It stores **one** latest
position per rider, overwritten on each update, captured in the foreground only
when the rider taps "go online" or "refresh". **It keeps no history and is not
the proposed historical GPS trace.** It runs in development only, on test data.
It is disclosed so that counsel's advice is given with full knowledge; if
counsel's view on its lawful basis differs from the proposal, please say so.

---

## 4. Data categories

`CURRENT DEVELOPMENT STATE` = implemented in code and/or present in `banhao-dev`
(test data only). `FUTURE PROPOSED PROCESSING` = does not exist.

### 4.1 Rider data

| Item | Status | Detail |
|---|---|---|
| Rider identifier | `CURRENT DEVELOPMENT STATE` | Internal rider id, linked to the rider's name and account phone number |
| Latest rider position | `CURRENT DEVELOPMENT STATE` | See §3.5. Single overwritten point; no history; not the proposed trace |
| Timestamped GPS trace, pickup → arrival | `FUTURE PROPOSED PROCESSING` | Does not exist |
| GPS accuracy metadata (e.g. accuracy radius per sample) | `FUTURE PROPOSED PROCESSING`, if technically available | The current position payload holds latitude and longitude only |
| Delivery timestamps | `CURRENT DEVELOPMENT STATE` | Assignment, pickup (`picked_up_at`), customer arrival (`arrived_at`, optional — §3.2), completion |
| Rider operational feedback | `FUTURE PROPOSED PROCESSING` | Does not exist (§3.4) |

### 4.2 Customer-related data

| Item | Status | Detail |
|---|---|---|
| Destination coordinate | `CURRENT DEVELOPMENT STATE`, partial | Copied into the order from the customer's saved address **only if** that address has coordinates; coordinates are optional and not geocoded |
| Delivery address snapshot | `CURRENT DEVELOPMENT STATE` | Free-text address copied into the order at creation |
| Order linkage | `CURRENT DEVELOPMENT STATE` | Delivery → order → customer account |
| Customer name and phone | `CURRENT DEVELOPMENT STATE` (account data) | **Not proposed** for any ground-truth or benchmark dataset |

### 4.3 Restaurant data

| Item | Status | Detail |
|---|---|---|
| Restaurant coordinate | `CURRENT DEVELOPMENT STATE` | Stored restaurant location (optional field) |
| Provider route origin and output (distance, duration, route) | `FUTURE PROPOSED PROCESSING` | No routing provider is integrated (D-16 `OPEN`); the order distance fields exist but are never populated |

---

## 5. Purpose — `OWNER INTENT — NOT LOCKED`

To measure the actual route taken during a real BANHAO delivery so that BANHAO
can later build validated routing ground truth, evaluate routing-provider
accuracy (particularly on rural and small roads), and improve operational
routing intelligence — problem roads, aggregate address and pin quality, and
service-area design.

**"Address and pin quality" means aggregate analysis only** — for example,
identifying areas where delivery pins are systematically inaccurate. **Changing
an individual customer's saved address or pin** using trace or feedback data is
a different use of customer data; it is **not** part of this purpose and is
`OPEN` (see Q5, Q21, D-1).

**Aggregate economic calibration — `OPEN`.** Whether aggregated,
non-rider-specific ground-truth evidence may be used to calibrate or validate
BANHAO's rider compensation parameters (§7) is an open owner decision, and
counsel's view is requested in Q5.

---

## 6. Prohibited uses — `OWNER INTENT — NOT LOCKED`

The owner intends that ground-truth data must **not** be used for:

1. rider performance scoring;
2. productivity scoring;
3. disciplinary action;
4. route-deviation penalties;
5. dispatch ranking or prioritisation;
6. automated suspension;
7. worker surveillance or behavioural analytics;
8. continuous monitoring;
9. **determining an individual rider's pay** for a delivery, or any
   rider-specific compensation.

Ground-truth GPS must not silently become a rider compensation input. Item 9
concerns per-delivery and per-rider pay only; aggregate calibration is the
separate open question in §5. **D-17 (distance accuracy policy, including
whether riders might ever be paid on actual distance) is `OPEN`** and is not
resolved by this brief.

---

## 7. Rider compensation context — `LOCKED DECISION` (runtime not built)

Relevant to Q5, Q11 and Q15. **DEC-061** locked BANHAO's Phase 1 rider
compensation policy on 2026-09-09:

| | |
|---|---|
| D-05 | Rider receives **80%** of the calculated customer delivery fee |
| D-06 | Minimum rider earning **฿12** per completed eligible delivery |
| D-07 | Rider required earning base **฿8** |
| D-08 | Rider required earning increases by **฿1.20 per operational road kilometre** |

- This is a **locked economic policy**; the **runtime pay implementation is not
  yet built**.
- By the intended architecture, operational road distance is **provider-derived**
  (a routing provider's road distance), not measured by GPS. The provider and
  distance source (D-16) remain `OPEN`.
- **D-17 remains `OPEN`** regarding any future actual-distance pay or economic
  treatment.
- Rider accept window for a delivery offer: **60 seconds** (LOCKED DECISION
  DEC-037).

---

## 8. Legal questions — PDPA and lawful basis

Question numbers are stable references.

- **Q1.** What lawful basis can BANHAO rely on to collect rider GPS **only during
  active delivery (pickup → arrival)** for the purpose in §5? Does the
  trace-stop rule (§3.2) affect the answer?
- **Q2.** Would the answer differ for **continuous** tracking of an online rider?
  Please state the difference explicitly.
- **Q3.** Is consent appropriate or inappropriate in BANHAO's rider relationship?
- **Q4.** If consent is not the basis, what balancing assessment or documentation
  must BANHAO prepare and keep? **Is a data protection impact assessment (DPIA),
  a record of processing activities, or equivalent documentation required**
  before collection begins?
- **Q5.** Is routing-quality measurement compatible with the original delivery
  purpose, or is it a separate purpose requiring its own basis and notice? Is
  the purpose in §5 legally supportable as written? Specifically:
  (a) Would using **aggregated, non-rider-specific** ground-truth evidence to
  calibrate or validate the DEC-061 rider compensation parameters (D-07/D-08) be
  compatible with that purpose, or would it create a new purpose?
  (b) Would using trace or feedback data to change an **individual customer's**
  saved address or pin create a new purpose?
- **Q6.** What rider notice is required — content, form and timing (onboarding,
  before the first traced delivery, per delivery)?
- **Q7.** Must the **customer** notice disclose that rider location is processed
  during their delivery, including near their delivery address?
- **Q8.** Which data-subject rights apply to riders' raw traces and to derived
  records, and how must BANHAO support them?
- **Q9.** What deletion and erasure obligations apply, and how do they interact
  with (a) records that are **pseudonymised or aggregated**, (b) BANHAO's
  append-only audit and financial records, and (c) **backup copies** held after
  primary deletion? (BANHAO's backup/restore retention, TQ-007, is `OPEN`.)
- **Q10.** Does this processing, alone or with BANHAO's other processing, trigger
  a Data Protection Officer requirement?

---

## 9. Cross-border, hosting and third-party processing

### 9.1 Approved hosting architecture — `LOCKED DECISION` (not yet deployed)

BANHAO's approved Application Architecture V1.1 specifies:

| Component | Provider and region | Status |
|---|---|---|
| API / compute | Google Cloud Run, `asia-southeast3` (Bangkok) — **DEC-APP-009** | Approved target; not deployed |
| Database | Supabase (PostgreSQL + PostGIS), `ap-southeast-1` (Singapore) | The development project `banhao-dev` exists in this region; no production data |
| Edge and scheduling | Cloudflare — Pages (merchant and admin web apps) and a Worker cron that triggers BANHAO's scheduled jobs | Approved target; not deployed |
| Object storage (proof-of-delivery photos, not traces) | Cloudflare R2 | Not proposed for traces |
| Routing provider | Intended Google Routes; **D-16 `OPEN`** | Not integrated |

**Engineering assertion requiring counsel review.** DEC-APP-009 contains the
statement *"PDPA: in-country residency with no cross-border transfer analysis
needed."* This is an **engineering assertion** made when choosing the Bangkok
compute region. It covers compute only — not the Singapore database, Cloudflare,
or any routing provider — and **it does not itself establish legal
compliance.** BANHAO asks counsel to confirm or reject it.

### 9.2 Provider and ground-truth roles

- **Google Routes** is the routing provider being evaluated or used. It is never
  ground truth.
- **Google Maps** is a visual reference only; it shares Google Routes'
  underlying data and is never ground truth (LOCKED DECISION DEC-063; DEC-062
  OD-5).
- **The rider's actual delivery trace**, once validated, would be BANHAO's
  future ground truth.

**Stored provider output — engineering preference, not a decision.** Where
BANHAO already holds the provider's route output captured at pricing time,
future benchmark processing should reuse that stored output rather than send
the customer's real destination to a provider again. Any additional disclosure
of customer destinations to a provider is `LEGAL REVIEW REQUIRED`. (No such
stored output exists today, because no provider is integrated.)

**Third-party processing of traces — no decision exists.** No decision has yet
authorized or prohibited third-party processing of future rider traces for
quality control, map matching, analytics, or related purposes. See D-2.

### 9.3 Questions

- **Q22.** Does storing raw traces and derived records in BANHAO's approved
  topology create a cross-border transfer under PDPA? Please assess separately:
  the Supabase database in Singapore; Google Cloud processing in Bangkok;
  Cloudflare processing where applicable; and any future routing-provider
  processing.
- **Q23.** What safeguards and contractual terms are required? Please cover
  controller/processor roles and the processor or other agreements needed with
  **Supabase, Google Cloud, Cloudflare, and any future routing provider**, plus
  any transfer safeguards (for example standard contractual clauses).
- **Q24.** Does sending customer destination coordinates to a routing provider
  require its own lawful basis, contract terms or notice — (a) at pricing time
  and (b) in any later benchmark re-query?

---

## 10. Worker-classification questions

**Context.** BANHAO's **working assumption** is an independent-contractor model.
The contractual relationship remains **`OPEN` / `LEGAL_REVIEW_REQUIRED`**
(BQ-022), and **no rider agreement currently exists**. This is an assumption,
not a legal conclusion. BANHAO's internal notes assert that granular tracking is
a factor in worker-classification arguments; **no Thai legal source for that
assertion is recorded** — please confirm or correct it. The rider pay model is
in §7.

- **Q11.** Does active-delivery-only GPS collection (pickup → arrival, the §5
  purpose, the §6 uses prohibited) affect contractor classification?
- **Q12.** How does that compare with continuous tracking of an online rider?
- **Q13.** May tracking be required as a condition of accepting a specific
  delivery?
- **Q14.** If a rider refuses tracking, may any consequence attach, including not
  offering deliveries? What participation/refusal model do you advise?
- **Q15.** Would **mandatory** post-delivery feedback affect classification or
  raise an unpaid-work concern? Would **optional** feedback avoid that?
- **Q16.** Must tracking and feedback terms appear in a written rider agreement
  before collection begins, and what must they cover?

---

## 11. Retention and data architecture

### 11.1 Conceptual layers — no schema exists or is proposed

No retention period, lawful basis or access policy is chosen by this brief.

```text
Operational Raw Data
        ↓
Quality Control
        ↓
Validated Ground Truth
        ↓
Aggregated Benchmark Dataset
```

| Layer | May contain | Design preference (not a decision) |
|---|---|---|
| Operational raw data | Identified trace samples, rider id, delivery/order id, timestamps | Minimum raw retention; minimum identity linkage |
| Quality control | Rejection of poor traces (GPS jumps, gaps, drift, in-window personal stops or detours) with the rejection reason recorded | Geometry deletion for rejected traces is a design preference under consideration, subject to legal and owner decision |
| Validated ground truth | See §11.2 | Scalar metrics where geometry is unnecessary; minimum customer exposure |
| Aggregated benchmark dataset | Statistics per stratum, distance band or road segment | Aggregated data where individual trace geometry is unnecessary |

### 11.2 What a validated record may still contain

Unless a later approved privacy transformation removes or aggregates them, a
validated ground-truth record **may still contain or reference**:

- origin coordinates (restaurant);
- **destination coordinates (the customer's delivery point)**;
- a delivery/order reference;
- provider route output;
- route-quality metrics (actual distance, transit time, a deviation summary);
- a rider pseudonymous identifier;
- a feedback code.

**Pseudonymisation does not make this data anonymous.** Any "deviation summary"
is a **routing-quality metric** comparing provider route and ridden route; it
must not be used for rider-level route-deviation penalties (§6).

### 11.3 Questions

- **Q17.** How long may **raw** GPS traces be retained, including in backups?
- **Q18.** How long may **derived** ground-truth records be retained, including
  in backups?
- **Q19.** May BANHAO delete raw traces after validation while retaining derived
  benchmark metrics? How must backup copies of deleted raw traces be handled
  (TQ-007, `OPEN`)? Does this change the answers to Q8, Q9, Q17 and Q18?
- **Q20.** What degree of pseudonymisation or aggregation, if any, would be
  sufficient for derived records to fall outside PDPA obligations, or to reduce
  them?

---

## 12. Customer privacy

**The key fact.** A trace ends at or near the customer's delivery location, and
every validated record may contain or reference that location (§11.2).
**Pseudonymising `rider_id` alone may therefore not be sufficient.** In a small
district, a trace endpoint plus a timestamp may identify a household.

**The tension.** The final approach — down a ซอย, through a gate, along a
private lane — is where routing providers are most likely to be wrong and where
measurement is most valuable. It is also the part that reveals most about the
customer.

- **Q21.** How should customer destination coordinates and trace endpoints be
  treated? Specifically: (a) is a trace endpoint the customer's personal data?
  (b) is pseudonymising the rider identifier alone insufficient? (c) are any of
  **endpoint trimming, spatial aggregation, route segmentation, scalar-only
  benchmark records**, or another technique necessary, or sufficient on its own?
  BANHAO has **not** selected a technique.

Q7 (customer notice) also belongs to this section.

---

## 13. Additional legal questions

- **D-1 — Rider operational feedback.** What lawful basis, notice and retention
  apply to the future rider operational feedback in §3.4, including closed codes
  such as *road not rideable*, *road closed*, *destination inaccessible* and
  *customer pin incorrect*? BANHAO does **not** assume feedback is covered by the
  GPS lawful basis. Codes such as *customer pin incorrect* describe the
  customer's location; please address that specifically.
- **D-2 — Third-party processing of rider traces.** If a vendor processes raw or
  derived rider traces for quality control, map matching, analytics, storage or
  other processing: what lawful basis applies; what notice is required; what
  processor/controller terms are required; what transfer safeguards are
  required; and does this create a separate purpose? BANHAO does **not** assume
  that Google, Cloudflare, Supabase or any other provider will process traces
  for this purpose.
- **D-3 — Secondary use and compelled disclosure.** May or must BANHAO use or
  disclose raw or derived traces for delivery disputes, fraud investigations,
  safety incidents, legal claims, or lawful requests from authorities? How does
  each affect purpose limitation, retention, access, and deletion/erasure?
  BANHAO has not decided any of these uses.

---

## 14. Requested counsel deliverables

Please provide a written answer to each item below, stating (i) the answer,
(ii) any conditions, and (iii) whether it differs between active-delivery-only
and continuous tracking.

1. Lawful basis (Q1–Q4)
2. Rider notice requirements (Q6)
3. Rider agreement requirements (Q16)
4. Customer disclosure requirements (Q7, Q24)
5. Retention requirements, including backups (Q17–Q19)
6. Access restrictions — who within BANHAO may access raw traces and who may
   access derived data
7. Deletion and erasure requirements (Q8, Q9)
8. Cross-border and processor/contract requirements (Q22–Q24)
9. Worker-classification implications (Q11, Q12, Q15)
10. Participation and refusal model (Q13, Q14)
11. Whether active-delivery-only tracking is materially safer than, or legally
    different from, continuous tracking
12. Whether the proposed purpose is legally supportable, including aggregate
    calibration and individual address correction (Q5)

Also answer D-1, D-2 and D-3, and identify any issue relevant to this processing
that BANHAO has not asked about.

---

## 15. Implementation gate

Counsel's advice is the first step of five, not an authorization:

```text
LEGAL REVIEW
  → OWNER DECISION LOCK
  → IMPLEMENTATION AUTHORIZATION
  → EXPLICIT MIGRATION AUTHORIZATION
  → IMPLEMENTATION
```

Rider GPS collection remains prohibited until **every** step before
implementation is complete. Receiving counsel's answers does not by itself
authorize any collection.

---

## Annex — background notes (not legal authority)

1. **Internal research is background only.** BANHAO's repository contains
   internal compliance research that describes itself as "not legal advice".
   None of it is settled law, and every BANHAO-specific point requires counsel's
   confirmation. **Known stale statement:** that research refers to a
   **12-second** rider accept window; the current LOCKED DECISION (DEC-037) is
   **60 seconds**.
2. **Proof-of-delivery photo retention.** BANHAO has set retention for delivery
   proof photos (90 days referenced / 7 days orphaned, DEC-039) as a **product**
   decision whose lawful basis is itself still pending review. It is **not**
   proposed as a model for GPS traces.
3. **Engineering residency statement.** See §9.1 — DEC-APP-009's PDPA sentence
   is an engineering assertion, not a legal finding.
