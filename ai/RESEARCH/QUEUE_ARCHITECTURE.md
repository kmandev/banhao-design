# Queue / Background Jobs Analysis

## Why this matters

Several documented requirements need asynchronous, retryable processing rather than being handled inline within a request:

- **Payment webhook processing** (CON-002, REQ-003) — must be idempotent and should not block the provider's webhook call waiting on downstream work (updating Order, recording Ledger, notifying customer); a slow inline handler risks the provider timing out and retrying, which idempotency handles safely, but a queue makes this cleaner and more resilient.
- **Order timeout** (`NEW → REJECTED` if the shop doesn't respond in 3 minutes; `READY → NO_DRIVER` if no rider found in 5 minutes — `docs/ARCHITECTURE.md`) — these are time-delayed, system-triggered transitions, a classic scheduled/delayed-job use case.
- **Restaurant timeout** — same mechanism as order timeout.
- **Driver dispatch** — matching a ready order to an available nearby driver is naturally an asynchronous process, potentially with retry-on-no-response logic.
- **Notifications** (SMS/push/LINE — see `ai/RESEARCH/NOTIFICATIONS.md`) — should not block the request that triggered them, and benefit from retry-on-failure.
- **Settlement/transfer-round processing** (`docs/04-payment`'s merchant/driver transfer rounds) — a scheduled, batch-style job.
- **Reports** (Admin dashboard aggregates) — can be computed asynchronously rather than on every page load.

## Options considered

### Redis-backed queue

Using Redis as the backing store for a job queue (via a queue library in whatever backend framework is chosen).

**Pros:** If Redis is already present for real-time pub/sub (`ai/RESEARCH/REALTIME.md`) or caching, it can serve double duty rather than adding a second piece of infrastructure. Well-supported queue libraries exist for most major backend ecosystems (Node.js, PHP, Python, Go all have mature Redis-backed queue libraries — see `ai/RESEARCH/BACKEND_COMPARISON.md` for ecosystem detail per language).

**Cons:** Redis is in-memory by default (durability requires configuring persistence, e.g. AOF), so a naive setup risks losing queued jobs on a crash unless configured carefully.

### RabbitMQ

A dedicated message-broker product built for durable queuing.

**Pros:** Strong delivery guarantees and mature tooling for complex routing (e.g. retry queues, dead-letter queues) — a good fit specifically for payment webhook processing, where losing a job silently would be a real problem (money-related).

**Cons:** An additional infrastructure component to run and operate beyond the database and (likely) Redis, adding operational surface area that may not be justified at Stage 1 scale (`ai/RESEARCH/SCALE_MODEL.md`).

### Managed cloud queue (e.g. a hosted SQS-style service)

A cloud provider's managed queue product.

**Pros:** No operational burden — the provider runs it. Durable by default.

**Cons:** Ties the architecture to a specific cloud provider (lock-in consideration, relevant to `ai/RESEARCH/INFRASTRUCTURE.md`); specific current pricing was not researched as part of this pass and would need dedicated verification before being relied on.

### Database-backed queue

Using the primary database itself as a simple job queue (a table of pending jobs, polled or locked via `SELECT ... FOR UPDATE SKIP LOCKED`-style patterns where the database supports it).

**Pros:** No new infrastructure component at all — reuses whatever database is already chosen (`ai/RESEARCH/DATABASE_COMPARISON.md`). Jobs live in the same transactional boundary as the data they act on, which can actually *help* correctness for something like "create this ledger entry and enqueue this notification" — both can commit in one transaction, avoiding a class of bugs where the job is enqueued but the related database write fails (or vice versa).

**Cons:** Doesn't scale as well as a dedicated queue at high job-volume/high-concurrency (more lock contention), and lacks some of the routing/retry sophistication of a dedicated broker out of the box (though most frameworks' database-queue libraries implement retry/backoff regardless).

## Analysis (not a decision)

For BANHAO's Stage 1/2 scale (`ai/RESEARCH/SCALE_MODEL.md`) and the modular-monolith direction analyzed in `ai/RESEARCH/ARCHITECTURE_PATTERN.md`, a **database-backed or Redis-backed queue** is proportionate — a dedicated broker like RabbitMQ solves problems (very high throughput, complex multi-service routing) that don't yet exist here, and adds an operational component that isn't justified by the requirements gathered so far. The specific use cases that most need genuine durability (payment webhook processing, settlement) are also the ones where a database-backed queue's "same transaction as the data" property is most valuable — arguably a better fit for money-related jobs than an external broker, not just a cheaper one.

This should be revisited if/when order volume reaches a point where queue throughput genuinely becomes a bottleneck (a Stage 3+ consideration per `ai/RESEARCH/SCALE_MODEL.md`) — not decided now. No specific queue library or managed product is selected here; that depends on the backend framework choice (Q-006).
