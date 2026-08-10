# Architecture Decision Records

Technical decisions for BANHAO. Written 2026-08-11 (EVENT-015) alongside
[`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md).

## How this file relates to `DECISIONS.md`

**They are deliberately separate namespaces and must not be mixed.**

| | `docs/DECISIONS.md` | this file |
|---|---|---|
| Series | `DEC-NNN` | `ADR-NNN` |
| Subject | **What the business does** | **How it is built** |
| Owner | Product Owner | Architecture review |
| Precedence | **Wins** | Yields to any `DEC` |

If an ADR ever appears to contradict a `DEC`, **the `DEC` is correct and the ADR
is a bug.** Report it; do not resolve it by changing the business rule.

Field structure matches `docs/DECISIONS.md` so the two read the same way.

## Status values

| Status | Meaning |
|---|---|
| `PROPOSED` | Argued here, **not approved**. Needs architecture review before implementation |
| `ACCEPTED` | Approved. **No ADR below is ACCEPTED yet** — this is v1 of the architecture |
| `SUPERSEDED` | Replaced by a later ADR |

> **Every ADR below is `PROPOSED`.** Per `ai/DEVELOPMENT_RULES.md`, an agent may
> not mark a decision `ACCEPTED` without human approval.

## Decisions inherited from the product record — *not* re-recorded here

These are already approved as product/stack decisions. They constrain the
architecture but are **not** ADRs, because duplicating them would create two
homes for one decision:

| Already decided | Where |
|---|---|
| Modular monolith, no microservices | DEC-009 |
| Supabase (PostgreSQL + PostGIS + Auth + Storage + Realtime) | DEC-010 |
| NestJS + TypeScript, REST + OpenAPI | DEC-011 |
| Monorepo, pnpm + Turborepo | DEC-013 |
| PostgreSQL is the financial system of record | DEC-014 |
| Payment provider via abstraction only; none selected | DEC-015 |
| Order / Payment / Delivery / Settlement are four separate state domains | **DEC-018** |
| Broadcast → first accept dispatch | **DEC-020** |
| Payment operations must be idempotent | **DEC-028** |
| Duplicate payment must never increase order value | **DEC-030** |

The ADRs below record the **technical mechanisms** that implement them, which is
a different question from whether to do them.

## Index

| ID | Decision | Status | Date |
|---|---|---|---|
| ADR-001 | NestJS is the only trusted writer of domain state | PROPOSED | 2026-08-11 |
| ADR-002 | RLS is defence in depth; no client write grants on domain tables | PROPOSED | 2026-08-11 |
| ADR-003 | Guarded conditional UPDATE as the universal concurrency primitive | PROPOSED | 2026-08-11 |
| ADR-004 | Natural-key idempotency, records only where no natural key exists | PROPOSED | 2026-08-11 |
| ADR-005 | Transactional outbox; no message broker | PROPOSED | 2026-08-11 |
| ADR-006 | PostgreSQL as the job store for Phase 1, behind a `JobQueue` interface | PROPOSED | 2026-08-11 |
| ADR-007 | Money: `bigint` satang, branded TS type, basis-point rates, residual allocation | PROPOSED | 2026-08-11 |
| ADR-008 | Keep the existing `PaymentProvider` abstraction; split webhook ingest from processing | PROPOSED | 2026-08-11 |
| ADR-009 | State transitions are commands, never `PATCH { state }` | PROPOSED | 2026-08-11 |
| ADR-010 | Worker is a second entrypoint of the same codebase | PROPOSED | 2026-08-11 |
| ADR-011 | Notification channels abstracted like payment providers | PROPOSED | 2026-08-11 |
| ADR-012 | Module ownership contract for AI maintainability | PROPOSED | 2026-08-11 |

---

## ADR-001 — NestJS is the only trusted writer of domain state

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Every mutation of a domain table goes through NestJS, using the service-role
Supabase client, inside a database transaction, guarded by the owning module's
state machine. Clients read; they never write domain state.

### Why

DEC-019 and DEC-020…DEC-022 define state machines with conditions that depend on
actor identity, elapsed time, and the state of *other* aggregates. §4 of the
architecture brief requires that business rules not scatter across layers. A
state machine expressed half in RLS policies and half in TypeScript is
unfindable — and specifically unfindable by an AI agent, which is a stated
project requirement (G5).

### Alternatives

- **Supabase-direct writes with RLS enforcement.** Rejected: RLS cannot express
  "only if payment is `SUCCESS` and the caller owns the restaurant and the
  3-minute window has not expired", and attempting it splits the rule.
- **Postgres functions/RPC as the write layer.** Rejected: moves business logic
  into SQL, where it is harder to test, review and version than TypeScript, and
  splits ownership between `supabase/migrations/` and `apps/api/`.

### Consequences

One findable place per rule. Every write is auditable and transactional. Costs:
NestJS must be available for any mutation (no offline writes), and the client
cannot use Supabase's client SDK for writes — only reads and auth.

### Related

DEC-009, DEC-011, DEC-018, DEC-019, REQ-002, CON-002 · ADR-002, ADR-009

---

## ADR-002 — RLS is defence in depth; no client write grants on domain tables

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Authorization lives in NestJS guards. RLS exists so a **leaked anon key cannot
read another party's data**. Domain tables grant **no `INSERT`/`UPDATE`/`DELETE`
to `authenticated`**. Financial tables (`payment`, `refund`, `ledger_entry`,
`settlement`) and `rider_availability` grant **no client `SELECT` either** — they
are API-only.

### Why

Makes the brief's §17 examples structurally impossible rather than merely
forbidden: a customer cannot modify payment status because **no grant exists**,
not because a policy declined. It also generalises the `profiles` pattern that
is already live and verified 14/14 (column `GRANT` + non-recursive policy +
immutability trigger).

### Alternatives

- **RLS as the authorization system.** Rejected — see ADR-001.
- **No RLS, API-only.** Rejected: CON-005 and the anon key's presence in a
  mobile bundle mean a second line of defence is warranted.

### Consequences

Two mechanisms to keep in step, and a policy must be written for every readable
table. In exchange, no client-side bug can corrupt domain state, and Realtime
inherits RLS so a subscription can never over-expose.

### Related

CON-005, DEC-010 · migration `20260809000003_harden_profiles_rls.sql` · ADR-001

---

## ADR-003 — Guarded conditional UPDATE as the universal concurrency primitive

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Every contested state transition is a single `UPDATE … WHERE id = ? AND state IN
(<legal source states>)`, branching on rows-affected: `1` = won, `0` = lost.
**The guard must be in the `WHERE` clause.** A `SELECT`-then-check-then-`UPDATE`
sequence is prohibited.

Applied to: rider accept (DEC-020), rider cancellation (DEC-021), every order
transition (DEC-019), payment transitions.

### Why

DEC-020's broadcast dispatch makes "two riders accept at once" a routine event,
not an edge case. Under `READ COMMITTED`, a second updater blocks on the row
lock, then re-evaluates its `WHERE` against the newly committed row and matches
nothing — giving exactly-one-winner with no extra machinery. Check-then-act, by
contrast, lets both riders pass the check.

### Alternatives

- **Advisory locks** — extra lock state to reason about and leak.
- **`SELECT … FOR UPDATE` then `UPDATE`** — correct, but an extra round trip for
  no benefit.
- **`SERIALIZABLE`** — pushes retry handling into every call site to solve what
  one `WHERE` clause solves.
- **Single-consumer queue for dispatch** — throughput we do not need, and it
  introduces its own fairness/ordering problem.

### Consequences

Correctness depends on a coding rule that a reviewer must actually enforce, so
concurrency tests are mandatory for guarded transitions (TQ-012). Backstop
unique indexes are added where the cost of failure is highest — notably at most
one `ACCEPTED` `rider_assignment` per delivery. Loser paths must return `409`
with the current state, never a generic error.

⚠️ **A backstop constrains the release path as much as the claim path.** With
`UNIQUE (delivery_id) WHERE outcome = 'ACCEPTED'`, releasing a rider **must**
move the old row out of `ACCEPTED` and null `delivery.rider_id` in the same
transaction — otherwise reassignment (DEC-021) is blocked by the very constraint
meant to protect it, and the delivery becomes permanently unassignable.
Specified in `TECHNICAL_ARCHITECTURE.md` § 8.5; found by the 2026-08-11
architecture review.

### Related

DEC-019, DEC-020, DEC-021, DEC-022 · `TECHNICAL_ARCHITECTURE.md` § 11 · TQ-012

---

## ADR-004 — Natural-key idempotency, records only where no natural key exists

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Prefer a unique constraint on a natural key over a generated idempotency record.
Use an `idempotency_record` table (key + endpoint + user + request hash →
stored response) only where the domain has no natural key — in practice, order
creation.

Natural keys: `UNIQUE (order_id)` on payment · `UNIQUE (payment_id, attempt_no)`
· `UNIQUE (provider, provider_event_id)` on webhook events ·
`UNIQUE (refund_reference)` · `UNIQUE (entry_group_key)` on ledger entries ·
the state guard itself for rider accept and order transitions.

### Why

DEC-028 requires idempotency on `order_id` / `payment_reference` /
`idempotency_key`. Where uniqueness is already a domain truth, the database
constraint *is* the mechanism, and it cannot be forgotten by a caller. DEC-028
also requires a duplicate ledger write to **fail loudly** — a unique violation
does exactly that.

### Alternatives

- **A generated idempotency key for every operation.** Rejected: more moving
  parts, and callers can omit or reuse keys incorrectly.
- **Application-level de-duplication.** Rejected: not safe under concurrency.

### Consequences

Fewer moving parts, but each unique constraint must be identified during design
rather than added reactively. `idempotency_record` must store a **request hash**
so the same key with a different body returns `422` rather than a stale
response.

### Related

DEC-028, DEC-030, REQ-003, CON-003 · ADR-003

---

## ADR-005 — Transactional outbox; no message broker

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Domain events are written to an `outbox` table **in the same transaction** as
the state change that produced them, then dispatched at-least-once by the
worker. No Kafka, no RabbitMQ, no event sourcing, no CQRS.

Anything that changes money or state is synchronous and transactional; anything
that merely informs somebody is asynchronous and retried.

### Why

Avoids the dual-write problem: with an external broker, "update the order" and
"publish OrderPaid" are two systems that can disagree. The outbox makes them one
atomic write. At this volume a broker is cost and operational burden against
DEC-031 (one founder) with no benefit.

### Alternatives

- **Direct in-process side effects after commit.** Rejected: lost on crash, and
  notifications are exactly the thing that must survive a restart.
- **Event sourcing.** Rejected: the order table is the state; events are
  notifications about state. Event sourcing would be a large complexity purchase
  for no current requirement.

### Consequences

Consumers must be idempotent — which they are, since every consumer action is
itself guarded. Dispatch adds latency measured in the poll interval. Outbox rows
need a retention/archival policy (TQ-007).

### Related

DEC-014, DEC-018 · `TECHNICAL_ARCHITECTURE.md` § 19 · ADR-006

---

## ADR-006 — PostgreSQL as the job store for Phase 1, behind a `JobQueue` interface

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Timers, retries and background work use a Postgres `job` table consumed with
`SELECT … FOR UPDATE SKIP LOCKED`, polled by the worker. Access goes through a
`JobQueue` interface so the store is replaceable without touching callers — the
same discipline DEC-015 applies to payment providers.

### Why

The brief asks not to assume a queue technology without justification. The
justification: volume is tens to low hundreds of orders/day (~1 job/minute at
peak), three to four orders of magnitude below where Postgres queues strain.
Postgres already exists, is the system of record, and is already backed up and
monitored. Critically, **a job can be enqueued in the same transaction as the
state change that causes it** — with an external broker it cannot, which
reintroduces the dual-write problem ADR-005 exists to remove.

### Alternatives

- **Redis + BullMQ** — a second stateful service to run, secure, back up and pay
  for; loses transactional enqueue.
- **Supabase pg_cron / Edge Functions** — splits business logic out of NestJS,
  against ADR-001.
- **Cloud queue (SQS et al.)** — vendor coupling and cost before there is a
  scaling problem.

### Consequences

Polling costs a small constant query load. Long-running jobs need visibility
timeouts. **Revisit triggers, stated so review happens on evidence:** sustained
>50 jobs/second, queue latency consistently >5s, or fan-out across multiple
worker hosts → TQ-001. Jobs need `attempts`, `next_run_at`, backoff, and a
**dead-letter state that alerts an operator** — a silently dropped job in a
financial system is unacceptable.

### Related

DEC-009, DEC-014, DEC-031 · TQ-001 · ADR-005, ADR-010

---

## ADR-007 — Money: `bigint` satang, branded TS type, basis-point rates, residual allocation

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

1. Persist money as **`bigint` satang** with an explicit currency column. Never
   `float`, `double`, `real`, or Postgres `money`.
2. Keep `Money { amount: Satang; currency }` in `@banhao/types`, and **brand**
   `Satang` so a baht value cannot type-check as satang.
3. Store rates as **integer basis points**, never decimals.
4. Round in one place, one direction: `floor(amount * bps / 10000)`.
5. **Allocate the rounding residual to one designated component, computed last
   by subtraction** — not as an independent calculation.

### Why

CON-003 requires every order's ledger to sum to exactly zero, and DEC-025 means
commission will be a percentage that does not divide evenly. Computing each
component independently and hoping they sum is how ledgers drift. Deriving the
last component by subtraction makes the sum exact **by construction**, for any
rate and any rounding rule:

```
platform_revenue = total_charged − merchant_payable − rider_payable
```

Branding `Satang` matters because it is currently a bare `number` alias, so
`bahtToSatang`'s output and its input are the same type to the compiler.

### Alternatives

- **`numeric`/`decimal` in Postgres.** Exact, but invites fractional satang the
  domain does not have, and needs a JS decimal library at every boundary.
- **Independent calculation of every component with a reconciliation check.**
  Rejected: detects drift instead of preventing it.

### Consequences

All arithmetic is integer. One module owns pricing and one owns the ledger.
A ledger group that does not sum to zero **fails the transaction** rather than
logging a warning. **No rate, fee or price is set by this ADR** — DEC-023,
DEC-024 and DEC-025 keep every number `OPEN`.

### Related

CON-003, DEC-014, DEC-023, DEC-024, DEC-025 · `packages/types/src/money.ts`

---

## ADR-008 — Keep the existing `PaymentProvider` abstraction; split webhook ingest from processing

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Retain `apps/api/src/modules/payments/payment-provider.interface.ts` **as
written** — `createPayment` / `refund` / `verifyWebhookSignature`, an explicit
`idempotencyKey` on every operation, the `PAYMENT_PROVIDER` DI token, and
`NullPaymentProvider` throwing by design. Provider SDKs stay confined to
`payments/providers/`.

Add one mechanism: webhook handling is **two transactions** — TX1 persists the
raw verified event (`UNIQUE (provider, provider_event_id)`); TX2 applies it
across Payment + Order + Ledger + Outbox. A worker sweeps events left
unprocessed.

### Why

The interface already encodes CON-002, DEC-028 and DEC-018 correctly; rewriting
it would be churn. The ingest/process split exists because an event that arrives
and then fails to process must still be **evidence that it arrived** — otherwise
a crash between receipt and application loses money silently. The sweeper makes
the pipeline self-healing.

### Alternatives

- **Single transaction for receive-and-process.** Rejected: a processing failure
  rolls back the record that the event ever arrived.
- **Fully asynchronous processing.** Rejected for now: adds latency to the
  customer's payment confirmation for no benefit at this volume. Inline
  processing with a sweeper fallback gives both.

### Consequences

`payment_webhook_event` needs `processed_at` and an error column. Duplicates
must return `200` or the provider retries forever. ⚠️ `refund()` remains
declared but unsatisfiable: **Q-020 found no provider supports native PromptPay
refunds**, and DEC-016 removed the cash-refund fallback. The adapter contract
for refunds is incomplete by necessity → TQ-008.

### Related

CON-002, DEC-015, DEC-016, DEC-027, DEC-028, DEC-029, DEC-030, Q-001, Q-020

---

## ADR-009 — State transitions are commands, never `PATCH { state }`

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Expose transitions as intent-named commands — `POST /orders/:id/accept`,
`POST /deliveries/:id/accept` — never a generic update accepting a target state.
On a lost guard, return **`409 Conflict` with the current state in the body**.

### Why

REQ-002 makes the server the single source of order status and CON-002 forbids a
client asserting payment success. A `PATCH { state }` endpoint invites exactly
that: the client naming the state it wants. Commands also give each transition a
place to hang authorization, guards, audit and events.

### Alternatives

- **REST resource updates.** Rejected for the reason above.
- **A single `POST /orders/:id/transitions`.** Rejected: one endpoint with a
  branching body is harder to authorize and to document than named commands.

### Consequences

More endpoints, each trivially small. Clients must handle `409` by re-rendering
from the returned state rather than retrying blindly.

### Related

REQ-002, CON-002, DEC-019 · ADR-003

---

## ADR-010 — Worker is a second entrypoint of the same codebase

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Background processing runs as a second process from the **same** NestJS
application — same modules, same domain services, same transaction code — with a
different bootstrap. Not a separate service, not a separate repository, not a
copy of any business logic.

**The worker never invents a transition**; it calls the same domain service the
API calls, with a system actor.

### Why

DEC-009 chose a monolith. Two deployables sharing one codebase keeps the
timeout, retry and sweep paths using the *same* guarded transitions as the API,
which is what prevents the worker from becoming a back door around the state
machine. Separating API and worker processes still isolates a slow job from
request latency.

### Alternatives

- **Jobs inside the API process.** Rejected: a long job degrades request
  latency, and scaling the two independently becomes impossible.
- **A separate worker service.** Rejected: duplicates domain code or requires an
  internal API, against DEC-009 and DEC-031.

### Consequences

One image, two commands. Deployment must run both (TQ-005). Any job that mutates
state must go through a domain service — a reviewable rule.

### Related

DEC-009, DEC-011, DEC-031 · ADR-006 · TQ-005

---

## ADR-011 — Notification channels abstracted like payment providers

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

A `NotificationChannel` interface with adapters under
`notifications/channels/`, one per channel (push / SMS / email / in-app). No
provider is selected. Sending is **always asynchronous**, via the outbox;
per-recipient, per-channel attempts and outcomes are recorded in
`notification_delivery`.

### Why

Mirrors the shape DEC-015 already proved for payments, so an agent recognises
the pattern. Asynchrony is a correctness requirement, not a performance one: a
notification failure must never fail an order transition.

### Alternatives

- **Direct provider calls from domain services.** Rejected: couples business
  logic to a vendor and makes a vendor outage an order-processing outage.
- **Synchronous send.** Rejected for the reason above.

### Consequences

The event × recipient matrix is `ACCEPTED` (`BUSINESS_RULES.md` § 13); the event
× **channel** matrix is `OPEN` (BQ-035) and must not be guessed. The merchant's
"sound until acknowledged" alert is a **client** requirement, not a channel one.

### Related

BQ-035, Q-019 · TQ-003 · ADR-005

---

## ADR-012 — Module ownership contract for AI maintainability

**Status:** PROPOSED · **Date:** 2026-08-11 · **Owner:** ARCHITECTURE_REVIEW

### Decision

Every module carries a `README.md` with a fixed header: **Owns / State /
Governed by / Must NOT / Depends on / Migrations / Tests / Open**. One module
owns each table; migrations name their owning module; no module reads or writes
another module's tables; state-machine logic lives in exactly one service per
domain.

### Why

G5 makes AI maintainability a first-class requirement. An agent must be able to
determine what a module owns and what it must not touch **without reading the
whole repository**. The `Open:` line is the load-bearing part — it tells an
agent where the map ends, which is what stops it inventing a rate or a timing
that the question register lists as undecided.

### Alternatives

- **Rely on `CLAUDE.md` and `ai/MEMORY.md` alone.** Rejected: they describe the
  project, not per-module boundaries, and they are already long.
- **Enforce boundaries only in review.** Rejected: review is a person, and this
  project's contributor is largely AI.

### Consequences

A small documentation cost per module, and the headers must be kept truthful —
a stale `Governed by:` is worse than none. Extends the existing rules in
`apps/api/src/modules/README.md` rather than replacing them.

### Related

DEC-009 · `apps/api/src/modules/README.md` · `ai/DEVELOPMENT_RULES.md` ·
`TECHNICAL_ARCHITECTURE.md` § 20
