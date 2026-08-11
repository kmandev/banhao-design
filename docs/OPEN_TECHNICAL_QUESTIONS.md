# Open Technical Questions

Technical choices that are **not decided**. Produced by EVENT-015 (Technical
Architecture v1, 2026-08-11) alongside
[`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md) and
[`ARCHITECTURE_DECISIONS.md`](ARCHITECTURE_DECISIONS.md).

**Nothing here is an assumption.** Where a recommendation appears it is an
argued suggestion, not a decision. An agent may not close any of these — see
`ai/DEVELOPMENT_RULES.md`.

## Namespaces

Four registers, no overlap. Cross-reference; never duplicate.

| Series | Subject | Home | Owner |
|---|---|---|---|
| `Q-NNN` | Original open questions | `ai/KNOWLEDGE/QUESTIONS.md` | Product Owner |
| `BQ-NNN` | Business questions | `docs/OPEN_BUSINESS_QUESTIONS.md` | Product Owner |
| **`TQ-NNN`** | **Technical questions** | **this file** | Architecture review |
| `DQ-NN` | Customer App design questions | `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md` | Product Owner |

Several `TQ` entries are **gated on a `Q`** — the technical choice cannot be made
until a product or legal answer lands. Those say so.

## Priority

| Priority | Meaning |
|---|---|
| **T0** | Blocks writing backend code at all |
| **T1** | Blocks production launch, not development |
| **T2** | Refinement; decide with real data |

## Summary

| ID | Question | Priority | Gated on |
|---|---|---|---|
| TQ-001 | Queue technology at scale | T2 | — |
| TQ-002 | Realtime vs polling, per surface | T1 | — |
| TQ-003 | Notification providers per channel | T1 | BQ-035, Q-019 |
| TQ-004 | Map / routing / geocoding provider | T1 | Q-018, BQ-026 |
| TQ-005 | Production deployment topology and hosting | T1 | Q-009 |
| TQ-006 | Observability stack | T1 | — |
| TQ-007 | Backup, restore and retention | T1 | Q-012 |
| TQ-008 | Payment provider adapter contract | **T0** | **Q-001, Q-020** |
| TQ-009 | Secrets management | T1 | TQ-005 |
| TQ-010 | Rate limiting and abuse protection | T1 | — |
| TQ-011 | Migration workflow and ownership | **T0** | — |
| TQ-012 | How concurrency correctness is tested | **T0** | — |
| TQ-013 | Clock, timezone and timer reliability | T1 | — |
| TQ-014 | Rider app offline behaviour | T1 | — |
| TQ-015 | API versioning and client compatibility | T2 | — |
| TQ-016 | Rider location retention and access | T1 | **Q-012** |

---

## TQ-001 — Queue technology at scale

**Priority:** T2 · **Status:** OPEN

**Question:** When, if ever, does BANHAO move off a Postgres job table?

**Context:** ADR-006 proposes Postgres + `FOR UPDATE SKIP LOCKED` for Phase 1,
behind a `JobQueue` interface. That is a justified Phase 1 choice, not a
permanent one.

**Revisit triggers, so review happens on evidence:** sustained throughput above
~50 jobs/second · queue latency consistently above 5 seconds · a need to fan out
across multiple worker hosts · a job type needing delivery guarantees Postgres
cannot give.

**Recommendation:** Do not pre-emptively adopt a broker. Instrument queue depth
and job latency from day one (TQ-006) so the trigger is observable rather than
guessed.

---

## TQ-002 — Realtime vs polling, per surface

**Priority:** T1 · **Status:** OPEN

**Question:** Which surfaces use Supabase Realtime, and which poll?

**Context:** DEC-010 includes Realtime, but DEC-014 forbids it as financial
truth. Realtime is a *change signal*; the client must re-read authoritative data.
Candidate surfaces: customer order tracking, merchant new-order board, rider
job offers, operator live map.

**Considerations:** rider offers must reach a backgrounded app, which is a push
notification problem, not a Realtime one. Merchant boards run on a tablet that
stays open — Realtime fits. Order tracking is the one screen where polling is
visibly wasteful. Realtime subscriptions inherit RLS (ADR-002), so a feed can
never over-expose, but each subscribed table needs a read policy.

**Recommendation:** Realtime for customer tracking and the merchant board; push
for rider offers; polling elsewhere until measured. Decide per surface, not
globally.

---

## TQ-003 — Notification providers per channel

**Priority:** T1 · **Status:** OPEN · **Gated on:** BQ-035, Q-019

**Question:** Which provider backs push, SMS, email, and is LINE a channel?

**Context:** ADR-011 defines the abstraction; no provider is selected. Q-019
already covers NBTC sender-ID registration for SMS (~2 weeks lead time). BQ-035
(the event × channel matrix) is a **business** question and must be answered
first — there is no point selecting an SMS vendor before knowing which events
use SMS.

**Considerations:** SMS has a real per-message cost across a dozen events per
order. LINE is how much of rural Thailand actually communicates and may reach
merchants better than a merchant app. Expo push is already available given
DEC-012.

**Recommendation:** Do not select anything until BQ-035 lands. Start the Q-019
sender-ID registration early regardless — it has external lead time and OTP
needs it either way.

---

## TQ-004 — Map, routing and geocoding provider

**Priority:** T1 · **Status:** OPEN · **Gated on:** Q-018, BQ-026

**Question:** Which provider supplies geocoding, distance and rider navigation?

**Context:** Q-018 records that no provider publishes district-level geocoding
accuracy for Thailand, and the design's own sample address is exactly the rural
format most likely to geocode poorly. BQ-026 (delivery fee model) depends on
whether distance can be measured reliably at all.

**Considerations:** the customer tracking map is a labelled placeholder today.
Distance for pricing and navigation for riders may not need the same provider.
Field testing in Buntharik cannot be done remotely.

**Recommendation:** Field-test before selecting. Keep distance calculation behind
an interface so the provider is swappable, and prefer banded pricing (BQ-026's
recommendation) precisely because it tolerates geocoding error.

---

## TQ-005 — Production deployment topology and hosting

**Priority:** T1 · **Status:** OPEN · **Gated on:** Q-009

**Question:** Where do the API and worker run, and how are they deployed?

**Context:** Nothing is hosted. A Dockerfile and GitHub Actions CI exist.
ADR-010 requires **two processes from one image**. Supabase is already in
`ap-southeast-1` (Singapore). Research found Bangkok regions on AWS and GCP that
are both closer and cheaper than Singapore.

**Considerations:** the worker must not be scaled to zero — timers would stop.
Webhook endpoints need a stable public URL and TLS. PDPA data residency
interacts with region choice (Q-012). Cost matters (DEC-031).

**Recommendation:** None yet — this is Q-009's budget decision as much as a
technical one. Whatever is chosen must run a long-lived worker process, not only
request-scoped functions.

---

## TQ-006 — Observability stack

**Priority:** T1 · **Status:** OPEN

**Question:** What are the logging, metrics, tracing and alerting tools?

**Context:** A solo operator cannot watch dashboards. Alerting matters more than
dashboards.

**The alerts that must exist**, whatever the tool:

- **A ledger group that does not sum to zero** — should be impossible; the most
  important alert in the system (CON-003).
- A job in the dead-letter state (ADR-006).
- Webhook events unprocessed beyond the sweep window (ADR-008).
- An order in `RIDER_SEARCHING` beyond the operator-alert threshold (DEC-022).
- Payment reconciliation mismatches.
- A settlement transfer failure.

**Recommendation:** Start with structured logs plus a `correlation_id` threaded
through request → transition → ledger → outbox → notification, so one identifier
reconstructs a whole operation. Choose the vendor with TQ-005.

---

## TQ-007 — Backup, restore and retention

**Priority:** T1 · **Status:** OPEN · **Gated on:** Q-012

**Question:** What are the backup cadence, retention windows, and the tested
restore procedure?

**Context:** DEC-014 makes PostgreSQL the sole financial system of record, so
its backup policy *is* the company's financial-records policy. Supabase provides
backups by plan tier; PITR is a paid feature.

**Considerations:** an untested restore is not a backup. Retention pulls two
ways — CON-003 needs history, PDPA needs erasure (Q-012, BQ-004). Ledger entries
must never be deleted; outbox, job and audit rows need an archival policy.

**Recommendation:** Decide with TQ-005. Whatever is chosen, **schedule a restore
rehearsal** — restoring is the part that fails.

---

## TQ-008 — Payment provider adapter contract

**Priority:** **T0** · **Status:** OPEN · **Gated on:** **Q-001, Q-020**

**Question:** What does a concrete `PaymentProvider` adapter actually implement,
given that refunds may not be possible on the rail?

**Context:** ADR-008 keeps the existing interface. But **Q-020 found no examined
provider supports native PromptPay refunds**, and **DEC-016 deleted the
cash-refund fallback** by disabling COD. So `refund()` is declared and currently
unsatisfiable.

**What must be answered before any adapter is written:** which provider (Q-001)
· what the refund mechanism actually is (Q-020) · whether refunds run through
the adapter at all or through an out-of-band operator workflow · webhook
signature scheme, retry behaviour and event vocabulary · whether the provider
exposes a settlement report for reconciliation.

**Recommendation:** If Q-020 resolves to an out-of-band mechanism, **`refund()`
should not stay on `PaymentProvider`** — it would be a lie in the interface. Move
it to a separate `RefundMechanism` abstraction. Do not decide this until Q-020
lands.

---

## TQ-009 — Secrets management

**Priority:** T1 · **Status:** OPEN · **Gated on:** TQ-005

**Question:** How are the service-role key, JWT secret, provider keys and
webhook signing secrets stored and rotated?

**Context:** CON-005 forbids secrets in Git and is currently satisfied —
`apps/customer/.env` is gitignored, the mobile app holds only the anon key, and
the service-role key exists only in backend context.

**Must be answered:** where production secrets live · rotation procedure for the
service-role key · how the worker gets credentials · how webhook signing secrets
are rolled without downtime.

**Recommendation:** Decide with TQ-005; most hosts provide a secret store.
Rotation must be a documented procedure, not an improvisation, because rotating
the Supabase service-role key affects every backend process at once.

---

## TQ-010 — Rate limiting and abuse protection

**Priority:** T1 · **Status:** OPEN

**Question:** What limits protect OTP requests, order creation, and the webhook
endpoint?

**Context:** OTP costs money per SMS once a real provider exists (Q-019). Order
creation is unauthenticated-adjacent in the sense that any signed-up user can
call it. The webhook endpoint is public by necessity.

**Considerations:** the webhook endpoint is protected by signature verification
(CON-002), but an unsigned flood is still a denial-of-service surface. Q-013
(anti-fraud) is a related but distinct product question.

**Recommendation:** At minimum, per-user and per-IP limits on OTP requests
before real SMS is enabled — that is the one with a direct financial cost.

---

## TQ-011 — Migration workflow and ownership

**Priority:** **T0** · **Status:** OPEN

**Question:** How are migrations authored, reviewed, ordered and applied, given
that AI agents write most of them?

**Context:** Three migrations exist and are applied live. ADR-012 proposes that
migration filenames carry their owning module. The domain schema — the large
part — is still unwritten and deliberately blocked on the P0 business questions.

**Must be answered:** naming and ordering convention across parallel work ·
whether migrations are ever edited after being applied (they must not be) ·
how RLS policies are reviewed as security-sensitive changes · rollback strategy
· how a migration is tested before production · who may apply to production.

**Recommendation:** Resolve **before** the first domain migration. Retrofitting
a convention across a schema written by several agents is far more expensive
than agreeing it now.

---

## TQ-012 — How concurrency correctness is tested

**Priority:** **T0** · **Status:** OPEN

**Question:** How does the project *prove* that two riders cannot both win?

**Context:** ADR-003's guard is correct but depends on a coding rule a reviewer
must actually enforce. A `SELECT`-then-`UPDATE` refactor would silently
reintroduce the race, and a normal unit test with mocks would not catch it —
this is a property of the database, not of the TypeScript.

**Options:** integration tests against real Postgres with genuinely concurrent
transactions · a deterministic barrier that holds transaction A open while B
attempts the same update · property/fuzz testing with N concurrent claimants ·
a lint rule banning `SELECT`-then-`UPDATE` on guarded tables.

**Recommendation:** Real-Postgres integration tests with concurrent
transactions, and treat them as **mandatory** for every guarded transition. The
project already has the right precedent: EVENT-007 verified RLS **by execution
against real PostgreSQL** rather than by reasoning, and that is exactly the
standard this needs.

**Invariants the suite must assert** — the 2026-08-11 architecture review found
two of these unstated in the design, and both would have failed silently:

1. N concurrent accepts on one delivery → **exactly one** winner; every loser
   gets `409`; exactly one `rider_assignment` is `ACCEPTED`.
2. The same rider re-accepting → idempotent `200`, not `409`.
3. **After any release: `delivery.rider_id IS NULL` and zero `rider_assignment`
   rows are `ACCEPTED`** — otherwise the delivery is permanently unassignable.
4. Accept → release → accept by a *different* rider **succeeds**, proving the
   backstop index does not block reassignment (DEC-021).
5. Duplicate webhook → **one** ledger group. Duplicate *payment* → **two**
   groups with distinct `entry_group_key`s. The two cases must not be conflated.
6. Concurrent merchant-accept and operator-cancel → one deterministic outcome;
   the loser sees the true current state.
7. Every order's ledger group sums to zero after any sequence of the above.

---

## TQ-013 — Clock, timezone and timer reliability

**Priority:** T1 · **Status:** OPEN

**Question:** Which clock is authoritative, and what happens to timers when the
worker is down?

**Context:** `BUSINESS_RULES.md` § 15 proposes Asia/Bangkok for business-day
logic with instants stored in UTC. Several accepted timers exist: 3-minute
merchant accept, 10-minute QR expiry, 5-minute no-rider notification, settlement
round cutoffs.

**Must be answered:** database clock vs application clock as authoritative ·
whether a timer that fires late still applies or is skipped · catch-up behaviour
after a worker outage — a 3-minute accept window that expires while the worker
is down must resolve deterministically · whether business-day boundaries are
computed in SQL or TypeScript.

**Recommendation:** Database clock (`now()`) as authoritative — one clock, and
it is the same one the transaction sees. Timers should be **evaluated by
deadline comparison, not by "the job fired"**, so a late sweep still reaches the
right answer.

---

## TQ-014 — Rider app offline behaviour

**Priority:** T1 · **Status:** OPEN

**Question:** What can the rider app do with no connectivity?

**Context:** ADR-001 means clients cannot write domain state, so every rider
action needs the network. Rural Thai coverage is uneven, and the rider is the
actor most likely to be moving through bad signal.

**Must be answered:** whether "delivered" can be recorded offline and synced ·
what the app shows when accept fails on a timeout — critically, a rider must
never see a failure for a job they actually won, nor a success for one they
lost · how proof-of-delivery photos (BQ-018) queue for upload · how location
gaps are handled.

**Recommendation:** Do not permit offline state writes; they conflict with the
guarded-transition model and could produce two riders each believing they won.
Prefer explicit retry with a clear pending state. Revisit if field testing shows
coverage is worse than assumed.

---

## TQ-015 — API versioning and client compatibility

**Priority:** T2 · **Status:** OPEN

**Question:** How do API changes ship without breaking an installed app?

**Context:** Routes are already under `/api/v1`. Mobile apps update on the
user's schedule, so an old client will exist in the wild.

**Must be answered:** whether to add `/v2` or evolve additively · minimum
supported client version and how it is enforced · whether the server can force
an upgrade · how a state-name change reaches installed clients — **directly
relevant**, since DEC-019 renamed the order states and the shipped Customer App
still encodes the old ones.

**Recommendation:** Additive evolution; reserve `/v2` for a genuine break. Add a
minimum-client-version check before real users exist, because it cannot be
retrofitted onto already-installed apps.

---

## TQ-016 — Rider location retention and access

**Priority:** T1 · **Status:** OPEN · **Gated on:** **Q-012**

**Question:** How long is rider location kept, at what resolution, and who may
read it?

**Context:** 🔴 The most privacy-sensitive data in the system. Continuous
tracking of identifiable workers. Q-012 (PDPA) is `LEGAL_REVIEW_REQUIRED`, and
BQ-022 flags that granular tracking is a factor in worker-classification
arguments.

**Must be answered:** sampling frequency and retention window · whether history
is kept at all or only the latest position · aggregation/anonymisation after
delivery · who may read historical location · whether the same rules cover
proof-of-delivery photos (BQ-018).

**Recommendation:** **Store the minimum that works** — arguably only the current
position plus a coarse delivery track, discarded shortly after completion. This
is one where the cheapest engineering choice and the lowest legal risk point the
same way. **No location schema should be written before Q-012 is answered.**
