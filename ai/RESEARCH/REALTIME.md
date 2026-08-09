# Real-time Architecture Analysis

## Why this matters

REQ-002 requires all four client surfaces to read order status from one shared backend state, with no client computing its own status. The Order State Machine has 12 states that can change quickly during active delivery (`DRIVER_ASSIGNED → PICKED_UP → DELIVERING → COMPLETED`, per `docs/ARCHITECTURE.md`), and the Admin wireframe (`A-03 Live Map`) and tracking prototype both imply live driver-location updates. How state changes reach clients is a real architectural question, not a minor detail.

## Options considered

### WebSocket

Persistent, bidirectional connection between client and server; server can push updates the instant something changes.

**Pros:** Lowest latency, most "live" feeling — matches the Merchant Web requirement that new orders be visible "from 2 meters away" (i.e., immediately, glanceably) and the Admin Live Map's implied continuous driver-position updates. Bidirectional, so a Driver App could also push location updates over the same connection.

**Cons:** Requires the backend to maintain persistent connection state, which complicates horizontal scaling (needs a shared pub/sub layer — e.g. Redis — across backend instances so a message published by one instance reaches a client connected to another). More operationally complex than request/response.

### Server-Sent Events (SSE)

One-way, server-to-client push over a long-lived HTTP connection.

**Pros:** Simpler than WebSocket (plain HTTP, no separate protocol), works well for "client just needs to receive updates" cases (e.g. Customer watching order status), auto-reconnect is built into the browser EventSource API.

**Cons:** One-directional only — a Driver App sending location updates would still need a separate mechanism (e.g. regular HTTP POST) for the upload direction. Less universally supported in some non-browser mobile contexts than WebSocket.

### Polling (client repeatedly requests latest state)

Client calls the API on an interval (e.g. every few seconds) to check for changes.

**Pros:** Simplest possible implementation — plain HTTP, no persistent connections, trivial to scale (every request is stateless and can hit any backend instance). Works everywhere, no special client capability needed.

**Cons:** Either wastes requests (polling faster than needed) or feels laggy (polling too slow) — hard to get right for all screens at once. At Stage 1 scale (`ai/RESEARCH/SCALE_MODEL.md`) the request volume is trivial, but polling that assumption doesn't hold as order volume grows, and it's the weakest option for "feels real-time" UX on the Live Map / new-order-alert use cases specifically.

### Push Notification (mobile OS-level, e.g. via Firebase Cloud Messaging)

Server sends a notification through the OS's push service; delivered even if the app isn't open.

**Pros:** Only mechanism that reaches a user when the app is closed/backgrounded — necessary for things like "your order is out for delivery" alerts regardless of the in-app real-time mechanism chosen. Not a substitute for in-app live updates (e.g. a live-updating map while the app is open), but a necessary complement.

**Cons:** Not suitable as the *primary* mechanism for in-app live state (e.g. a Merchant's Kanban board updating instantly needs something in-app, not a background notification tap).

### Managed real-time services (e.g. a hosted pub/sub or real-time database service)

Third-party services that handle the WebSocket/connection-scaling problem for you.

**Pros:** Removes the "how do I scale WebSocket connections across backend instances" operational problem entirely — the vendor handles it.

**Cons:** Adds a vendor dependency and recurring cost; specific providers and their current pricing were not part of this research pass (out of scope for this document; would need dedicated research if seriously considered) — flagged as a gap rather than guessed at.

### Redis Pub/Sub (self-managed)

Backend instances publish state-change events to Redis channels; any backend instance holding a relevant WebSocket/SSE connection subscribes and forwards to its connected clients.

**Pros:** Solves exactly the "scale WebSocket across multiple backend instances" problem noted above, using infrastructure (Redis) that's also useful for other purposes (caching, queue — see `ai/RESEARCH/QUEUE_ARCHITECTURE.md`). Self-hosted, so no new vendor dependency beyond Redis itself.

**Cons:** Redis Pub/Sub messages are fire-and-forget (no delivery guarantee if a subscriber is briefly disconnected) — acceptable for "live" UI updates (the client can always re-fetch current state on reconnect) but not appropriate as the system of record; the database remains the source of truth regardless.

### Message broker (e.g. a dedicated queue/broker product)

A more heavyweight, durable alternative to Redis Pub/Sub for event distribution.

**Pros:** Durable delivery guarantees.

**Cons:** Likely more operational complexity than this specific use case needs — durability matters for payment/order processing (see `ai/RESEARCH/QUEUE_ARCHITECTURE.md`, where a broker/queue is genuinely justified), but for "tell connected clients the map pin moved," losing an occasional update is recoverable (client re-fetches) and doesn't need broker-grade durability.

## Analysis (not a decision)

A **hybrid** shape is what the requirements actually point to, not a single mechanism:

1. **In-app live updates** (Merchant Kanban, Admin Live Map, Customer order tracking while the app is open): WebSocket or SSE, backed by Redis Pub/Sub if the backend runs as more than one instance (ties into `ai/RESEARCH/ARCHITECTURE_PATTERN.md`'s modular-monolith recommendation — a monolith could still run multiple instances behind a load balancer, so this isn't avoidable just by choosing a monolith).
2. **Background/closed-app alerts**: Push notification (FCM or similar — see `ai/RESEARCH/NOTIFICATIONS.md`), because in-app mechanisms don't reach a closed app.
3. **Fallback**: Polling remains a reasonable fallback for any client/context where WebSocket/SSE isn't available or reliable (e.g. restrictive network environments), and is trivial to implement as a baseline before investing in the live mechanisms above — some teams ship polling first and upgrade later, which is a legitimate staged approach given Stage 1's low volume (`ai/RESEARCH/SCALE_MODEL.md`).

No specific technology (a specific WebSocket library, a specific managed service) is selected here — that depends on the backend framework choice (Q-006) still pending.
