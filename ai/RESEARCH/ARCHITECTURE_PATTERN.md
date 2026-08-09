# Architecture Pattern Analysis

Comparing candidate architecture *patterns* (not specific technologies) for BANHAO's backend. This is analysis to inform a Product Owner decision — it does not select one. See `ai/RESEARCH/ARCHITECTURE_CANDIDATE_*.md` for how a pattern combines with specific technology choices into a full candidate.

## Options considered

### Modular Monolith

A single deployable backend service, internally organized into clear modules/domains (e.g. Order, Payment, Merchant, Driver, Notification) with enforced boundaries between them (e.g. via folder structure, internal interfaces, or a module system) but no network calls between modules.

**Pros for BANHAO:** One codebase, one deployment, one database connection pool — matches Stage 1/2 scale (`ai/RESEARCH/SCALE_MODEL.md`) with minimal operational overhead. Order and Payment state (CON-001) can be enforced with a single database transaction across module boundaries, which is much harder once they're separate services. Easiest pattern for a small or AI-assisted team to reason about, since there's one place to look for "how does an order actually work."

**Cons for BANHAO:** If one module has a bug or resource spike, it can affect the whole service (no isolation). Requires deliberate discipline to keep module boundaries clean — an undisciplined monolith becomes a "big ball of mud." Scaling is all-or-nothing (you scale the whole service, not just the hot module) until it's explicitly split later.

### Microservices

Each domain (Order, Payment, Merchant, Driver, Notification, etc.) is its own independently deployable service, communicating over the network (REST/gRPC/message queue).

**Pros for BANHAO:** Independent scaling and deployment per service; clearer ownership boundaries if the team grows; a service can be rewritten/replaced without touching others.

**Cons for BANHAO:** CON-001 (Order State and Payment State must stay separate but consistent) becomes materially harder — a single ACID transaction across two services isn't possible, so this requires distributed-transaction patterns (e.g. sagas, outbox pattern) from day one, which is significant engineering overhead. Operational complexity (multiple deployments, service discovery, network failure handling, distributed tracing) is high relative to the Stage 1/2 scale this project is actually at (`ai/RESEARCH/SCALE_MODEL.md`). Historically, a common failure mode for early-stage products is adopting microservices before there's a team or scale that needs them, paying the complexity tax without the benefit.

### Serverless (functions-as-a-service for business logic)

Backend logic implemented as individual cloud functions (e.g. AWS Lambda, GCP Cloud Functions), typically paired with a managed database.

**Pros for BANHAO:** No server management; scales to zero when idle (relevant for a low-traffic Stage 1 launch); pay-per-use can be cheap at low volume.

**Cons for BANHAO:** Cold-start latency can hurt a real-time-feeling order-status experience (TR-001, TR-009). Long-lived connections (WebSocket-style real-time, if chosen — see `ai/RESEARCH/REALTIME.md`) are awkward or unsupported in many serverless models. Transactional consistency across functions has the same fundamental challenge as microservices. Debugging and local development are often harder than a monolith for a small/AI-assisted team.

### Event-driven

Services/modules communicate primarily by publishing and reacting to events (e.g. "OrderCreated", "PaymentConfirmed") via a message broker, rather than direct calls.

**Pros for BANHAO:** Naturally fits the Order State Machine's step-by-step nature (`docs/ARCHITECTURE.md`), and fits webhook-driven payment confirmation (CON-002) well — a webhook can simply publish an event. Good decoupling if multiple things need to react to the same state change (e.g. notify customer + update driver app + log to analytics, all reacting to "OrderCompleted").

**Cons for BANHAO:** Can be adopted as a *style within* a monolith (e.g. an in-process event bus) or as a *distributed pattern* (a real message broker across services) — these are very different complexity levels. Full distributed event-driven architecture has the same operational overhead concerns as microservices, and adds eventual-consistency reasoning that must be handled carefully around CON-001/CON-003 (money must never be "eventually" balanced — it must be correct).

### Hybrid: Modular Monolith + internal event bus, with a queue for external-facing async work

Not a separate top-level option so much as a specific combination: keep the deployable unit as one modular monolith (for transactional integrity and operational simplicity), but use an in-process or lightweight event mechanism internally for decoupling notification/analytics concerns from the core order/payment path, and a real queue (see `ai/RESEARCH/QUEUE_ARCHITECTURE.md`) for genuinely async external work (webhook retries, SMS/push sending, report generation).

## Is a Modular Monolith more appropriate than starting with Microservices?

Based on the evidence gathered in this research (not a decision):

- **Scale** (`ai/RESEARCH/SCALE_MODEL.md`): Stage 1 and Stage 2 volumes are low enough that a single well-run service comfortably handles them. Microservices' main benefit — independent scaling — has no scale problem to solve yet.
- **Correctness constraints** (CON-001, CON-003): The two hardest, most non-negotiable rules in this entire project are about transactional correctness between Order and Payment, and a ledger that must balance to zero. A modular monolith can enforce these with a single database transaction. A microservices split of Order and Payment services would require solving distributed transactions (sagas/outbox) just to satisfy a rule that a monolith gets "for free" from the database.
- **Team/tooling reality**: The repository's own stated approach relies heavily on AI-assisted development (`ai/RESEARCH/AI_DEVELOPMENT_WORKFLOW.md`) with what appears to be a small team. Microservices' organizational benefit (independent teams owning independent services) doesn't apply when there isn't yet a large, multi-team organization.
- **Reversibility**: A well-modularized monolith (clear module boundaries, no cross-module database queries) can be split into services later, module by module, if and when a specific module (e.g. Notification, or a future Ride-matching engine) genuinely needs independent scaling. The reverse — collapsing microservices back into a monolith — is significantly more painful in practice.

This reasoning **favors evaluating a Modular Monolith as the primary candidate for Stage 1/2**, with Event-driven concepts used internally rather than as a full distributed architecture, and specific modules split out later only if a concrete scaling or organizational need demonstrates it (Stage 3/4 consideration). This is a recommendation for the Product Owner to evaluate, not a decision — see `ai/RESEARCH/ARCHITECTURE_CANDIDATE_A.md` through `_C.md` for how this plays out as full candidates, and `ai/KNOWLEDGE/PROPOSALS.md` for the formal proposal record.
