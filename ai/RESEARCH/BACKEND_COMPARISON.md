# Backend Comparison

All data checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select a backend** — Q-006 remains `OPEN`.

Ratings below use ●●● (strong) / ●●○ (adequate) / ●○○ (weak). **Every rating has a stated reason.** Where a rating rests on inference rather than measurement, it says so.

## Options

- **A — Node.js + TypeScript** (Express or Fastify)
- **B — NestJS** (TypeScript, opinionated framework over Express/Fastify)
- **C — Laravel** (PHP)
- **D — Go**
- **E — Python** (FastAPI or Django)

## Comparison matrix

| Criteria | A: Node+TS | B: NestJS | C: Laravel | D: Go | E: Python |
|---|---|---|---|---|---|
| Development speed | ●●○ | ●●● | ●●● | ●●○ | ●●● |
| Thai developer availability | ●●○ | ●●○ | ●●● | ●●● | ●●● |
| Ecosystem | ●●● | ●●● | ●●● | ●●○ | ●●● |
| Performance | ●●○ | ●●○ | ●●○ | ●●● | ●●○ |
| Real-time | ●●● | ●●● | ●●● | ●●● | ●●○ |
| Payment integration | ●●● | ●●● | ●●● | ●●○ | ●●● |
| Maps integration | ●●● | ●●● | ●●● | ●●● | ●●● |
| Queue / jobs | ●●○ | ●●● | ●●● | ●●○ | ●●● |
| Testing | ●●● | ●●● | ●●● | ●●● | ●●● |
| Security | ●●○ | ●●● | ●●● | ●●○ | ●●○ |
| Maintainability | ●●○ | ●●● | ●●● | ●●● | ●●○ |
| Scalability | ●●● | ●●● | ●●○ | ●●● | ●●○ |
| Hosting cost | ●●○ | ●●○ | ●●○ | ●●● | ●●○ |
| Hiring cost | ●●○ | ●●○ | ●●● | ●○○ | ●●○ |
| AI coding support | ●●● | ●●● | ●●○ | ●●○ | ●●● |
| Operational complexity | ●●○ | ●●○ | ●●● | ●●○ | ●●○ |
| Lock-in | ●●● | ●●● | ●●● | ●●● | ●●● |

## Reasoning per criterion

**Development speed.** Laravel, NestJS, and Python (FastAPI/Django) score highest because each ships conventions and scaffolding that remove decisions — Laravel's Artisan/Eloquent, NestJS's CLI-prescribed module layout, Django's batteries-included admin. Plain Node+TS and Go score lower not on capability but because both require assembling structure by hand, which costs time on a project with as many domains as BANHAO (Order, Payment, Merchant, Driver, Dispatch, Settlement).

**Thai developer availability.** The strongest differentiator found, and the one most specific to BANHAO's context. JobsDB Thailand keyword counts on 2026-08-09: Python 961, PHP 318, Go 255, Backend Developer (generic) 222, Laravel 127, Node.js 137. **Important caveats the research flagged:** the Python figure is heavily inflated by data-science/ML/analytics roles and is *not* 961 backend-web positions; the Node figure is understated because many Node roles post as "Backend Developer" or "Full Stack." Laravel's 127 *framework-specific* listings alongside 318 PHP listings is the most unambiguous signal of a deep local hiring pool. Go's 255 is higher than expected — likely driven by fintech and SEA super-app engineering presence in Bangkok. Treat all counts as indicative, not measurements.

**Ecosystem.** Node/TypeScript is the largest by raw volume (express 514.9M monthly npm downloads; Node used by 48.7% of Stack Overflow 2025 respondents). Python is comparable (57.9% of respondents, #2 language). Laravel is smaller in absolute terms but exceptionally complete for web-app needs. Go rates lower only because its *web framework and background-job* ecosystem is more fragmented than the others — the language ecosystem itself is excellent.

**Performance.** Go is materially ahead: compiled, goroutine concurrency, and Go 1.26 (10 Feb 2026) made the Green Tea GC default with a stated 10–40% reduction in GC overhead. The others are adequate for BANHAO's Stage 1–3 volumes (`ai/RESEARCH/SCALE_MODEL.md`) — this criterion does not discriminate at the scale BANHAO is actually at, and should be weighted accordingly.

**Real-time.** Directly relevant to REQ-002 and `ai/RESEARCH/REALTIME.md`. Node/NestJS: `ws`/Socket.IO are the industry reference; the event loop holds many idle connections cheaply. NestJS additionally has first-class `@nestjs/websockets` with built-in adapters. Go: goroutines make each WebSocket cost a few KB of stack — the most resource-efficient option for driver-location fan-out. Laravel: **Reverb** (first-party WebSocket server, stable since Laravel 11) closed Laravel's historic gap and scales horizontally via Redis pub/sub with IP-hash load balancing. Python scores lower: FastAPI has native ASGI WebSockets, but Django requires the separate Channels package plus a Redis channel layer — real added complexity. *(A widely-circulated FastAPI-vs-Django-Channels concurrent-connection benchmark was found but is **unverified** — marketing-blog sourcing, not reproducible — and is deliberately not cited as evidence here.)*

**Payment integration.** Effectively a non-differentiator: every option can make HTTPS calls and verify webhook signatures (CON-002). Go rates marginally lower only because Thai payment providers' official SDKs, where they exist, more commonly target PHP/Node/Python than Go — this should be verified against whichever provider is chosen (Q-001) rather than assumed.

**Maps integration.** Non-differentiator — all are REST API calls. Rated equal deliberately rather than manufacturing distinctions.

**Queue / jobs.** A genuine differentiator, and directly relevant to `ai/RESEARCH/QUEUE_ARCHITECTURE.md` and PROP-004. **Laravel is the standout**: queues are framework-native and **Horizon** is a first-party supervisor *and* dashboard (process management, auto-balancing, failed-job retry, metrics) — nothing in the Node, Go, or Python ecosystems is as batteries-included. NestJS closes most of the gap via the official `@nestjs/bullmq` package plus `@nestjs/schedule`. Python's Celery is the most battle-tested distributed task queue in any language, though Flower's UI is dated and configuration has a real learning curve. Plain Node scores lower: BullMQ is a producer/worker SDK, **not** a supervisor — there is no Node equivalent of Horizon, so process supervision and dashboards are yours to assemble. Go is weakest relative to its other strengths: Asynq is the mainstream pick but has low recent commit activity; **River** is notable for BANHAO specifically because it is Postgres-backed and enqueues jobs *in the same transaction* as the data write — exactly the property PROP-004 argues for on money-related jobs.

**Testing.** All five are strong; this criterion does not discriminate. Node/TS testing is the most actively evolving (Vitest grew from <4M to >40M weekly downloads between early 2023 and early 2026, overtaking Jest). NestJS is arguably best-in-class for Node because dependency injection makes mocking trivial and `@nestjs/testing` ships a harness. Go's `go test` is standard-library with no dependency choice, and `testing/synctest` (Go 1.25) makes concurrent code deterministically testable — genuinely useful for testing dispatch logic. Laravel ships HTTP testing, DB factories, and queue/event faking. pytest is arguably the best-designed framework of the five.

**Security.** NestJS and Laravel rate highest because both ship opinionated defaults (guards/interceptors; CSRF protection, auth scaffolding, ORM-level SQL-injection resistance) rather than leaving them to assembly. The others are entirely capable of being secure but place more responsibility on the developer — a meaningful distinction for a payments system where `ai/RESEARCH/SECURITY_ARCHITECTURE.md` already lists several unmitigated concerns.

**Maintainability.** NestJS, Laravel, and Go rate highest for different reasons: the first two impose structure (an unfamiliar developer can find things), Go through language simplicity and a small surface area. Plain Node+TS and Python rate lower because both permit many valid structures — fine with discipline, risky without, especially given PROP-001's warning that an undisciplined modular monolith degrades.

**Scalability.** Node, NestJS, and Go scale well horizontally. Laravel and Python rate slightly lower on raw efficiency per instance, but note this is **almost certainly irrelevant at BANHAO's Stage 1–2 scale** — this criterion only matters if Stage 3/4 arrives (`ai/RESEARCH/SCALE_MODEL.md`).

**Hosting cost.** Follows performance: Go's lower memory/CPU footprint means smaller instances. Differences are small in absolute terms at Stage 1 (see `ai/RESEARCH/COST_MODEL.md`).

**Hiring cost.** Laravel/PHP is the cheapest to hire for in Thailand given the depth of the local SME/agency pool. Go rates worst (●○○) because Go developers command a premium globally and the Thai listings skew toward fintech/enterprise employers who pay above local market — meaning the 255 listings represent competition for talent, not necessarily availability to a small startup.

**AI coding support — inference, not measurement.** No one publishes "how well an LLM writes framework X," so this row is explicitly judgment. TypeScript and Python rate highest: both have enormous public corpora, and TypeScript specifically gives the model a compile-time feedback loop. GitHub Octoverse 2025 reported TypeScript became the #1 language on GitHub in August 2025 (~2.64M monthly contributors, +66% YoY), explicitly attributing the shift to AI-assisted coding since type information makes generated code verifiable. NestJS benefits further from being highly conventional — CLI-prescribed layout means there is essentially one right shape for a module. Laravel rates slightly lower than TS/Python despite excellent documentation because PHP lacks comparable static-type feedback. Go rates lower on this dimension despite a large corpus: verbose error handling means more code per feature, and framework fragmentation gives generated code less canonical shape to conform to. **Relevant because BANHAO's stated development approach is heavily AI-assisted** (`ai/RESEARCH/AI_DEVELOPMENT_WORKFLOW.md`).

**Operational complexity.** Laravel rates best — the PHP deployment story is mature and forgiving, and Horizon removes the "how do I supervise workers" question. Others require more assembly.

**Lock-in.** All five rate equally strong (i.e. low lock-in): every option is open-source with no vendor dependency. Included for completeness rather than to discriminate.

## Notable production users

| Option | Users | Sourcing quality |
|---|---|---|
| Node+TS | Netflix, PayPal, Uber, LinkedIn | Widely cited, standard references |
| NestJS | Adidas, Roche, Decathlon, Capgemini | ⚠️ **UNVERIFIED** — traced only to vendor/SEO blogs, not company engineering blogs or NestJS's own site. Do not present as fact. |
| Laravel | Barchart, Alison.com, 9GAG, Invoice Ninja | Secondary sourcing; indicative only |
| Go | **Grab** (SEA super-app: food delivery + ride-hailing, Go+Java microservices on AWS with Kafka/Redis/PostgreSQL/MongoDB), Uber (PGO saved ~24,000 CPU cores), Twitch, Cloudflare, Monzo, Dropbox | Go's case-studies page is primary; the Grab stack breakdown is secondary |
| Python | Microsoft, Uber, Netflix (Dispatch), Cisco — **with attributed first-person engineer quotes on FastAPI's own site**; Instagram/Pinterest historically on Django | FastAPI testimonials are primary-source and unusually well-sourced |

**Grab is the most directly comparable reference point in this table** — a Southeast Asian food-delivery/ride-hailing super-app, i.e. exactly BANHAO's eventual shape (Phases 1–3), running predominantly Go.

## Trade-off summary

The research does **not** point to a single answer here — unlike the database question, this is a genuine three-way trade:

- **NestJS/TypeScript** — maximizes AI-assisted-coding leverage and imposes structural discipline that PROP-001's modular monolith depends on. Weaker local hiring signal.
- **Laravel** — maximizes Thai hiring depth (127 Laravel + 318 PHP listings, the clearest local signal found) and ships the best queue tooling in the industry (Horizon), which matters given how much of BANHAO's design is async (timeouts, dispatch, settlement, notifications). Caveat: **no LTS since Laravel 6 (2019)** — 18-month bugfix / 2-year security windows mean a permanent ~2-year upgrade treadmill on a payments system.
- **Go** — best real-time efficiency and performance, matches what Grab actually runs, and River offers transactional job enqueue that suits money-related work. Weakest hiring cost profile and weakest queue-ecosystem maturity.

**Decision inputs only the Product Owner has:** team skill constraints and mobile-framework preference (Q-016), and hiring budget/strategy. These likely matter more than any rating above.
