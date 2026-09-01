# 06 — API

**Status: IMPLEMENTED (Phase A–H surface). The machine-readable contract is
[`openapi.json`](openapi.json), generated from the code.**

Written 2026-09-01, replacing the 2026-08-09 placeholder that said no backend
existed. It does: `apps/api` is a NestJS modular monolith (DEC-009, DEC-011)
with 30 routed operations.

---

## 1. The contract

[`openapi.json`](openapi.json) is generated from the running `AppModule`, not
written by hand:

```bash
pnpm --filter @banhao/api openapi
```

`apps/api/test/openapi.contract.spec.ts` regenerates the document on every test
run and fails when the committed file no longer matches the code. **A route
added, renamed or removed without re-running the generator fails the suite** —
that guard is the only reason this file can be trusted.

The same document is served at `http://localhost:3000/docs` by a running API.

**Known limitation:** `components.schemas` is empty. The controllers annotate
operations (`@ApiTags`, `@ApiOkResponse`, `@ApiBearerAuth`) but not request and
response *shapes*, so the contract currently describes the surface — paths,
methods, auth, status codes — and not the payloads. The payload contract lives
in `@banhao/types` and is enforced at compile time across the monorepo. Filling
`components.schemas` in is additive work, not a redesign.

## 2. Base path and versioning

Every client-facing route is under `/api/v1/`. The single exception is
`GET /health`, which is unversioned on purpose — it is a platform liveness
probe, not part of the product API, and Cloud Run must be able to call it
without knowing the API version. The contract test asserts this rule.

## 3. Response envelope

Every response, success or failure, uses one envelope (V1.1 §11).

Success — `ResponseInterceptor`:

```json
{ "success": true, "data": { } }
```

Failure — `HttpExceptionFilter`:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "…",
    "details": { },
    "correlationId": "…"
  }
}
```

`correlationId` is present on every error and echoed in the
`X-Request-Id` response header, so an id a user reads off a screen finds
the request in the logs.

`code` is the contract; the HTTP status is transport classification. Clients
branch on `code`, never on the status. The catalogue is `ErrorCode` in
`@banhao/types`, and `apps/api/src/common/errors/domain-error.ts` maps each
code to exactly one status as a **total** `Record<ErrorCode, HttpStatus>` — a
new code without a decided status is a compile error.

| Class | Codes | Status |
|---|---|---|
| Authentication | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `PROFILE_NOT_FOUND` | 401 |
| Authorization | `FORBIDDEN`, `NOT_RESTAURANT_MEMBER`, `NOT_ASSIGNED_RIDER` | 403 |
| Validation | `VALIDATION_FAILED` | 400 |
| Business rule | `INVALID_TRANSITION`, `RESTAURANT_CLOSED`, `ITEM_UNAVAILABLE`, `ACCEPT_WINDOW_EXPIRED`, `PRICE_CHANGED`, `MIXED_RESTAURANT`, `CART_EMPTY`, `ORDER_NOT_PAYABLE` | 409 |
| Concurrency | `OFFER_TAKEN`, `NOT_RELEASABLE`, `OFFER_EXPIRED`, `RIDER_HAS_ACTIVE_DELIVERY` | 409 |
| Payment | `PAYMENT_ALREADY_SUCCEEDED` (409), `PROVIDER_UNAVAILABLE`, `MECHANISM_UNAVAILABLE` (402) | — |
| Transport fallback | `NOT_FOUND` (404), `CONFLICT` (409), `NOT_IMPLEMENTED` (501) | — |
| Unexpected | `INTERNAL_ERROR` | 500 |

`INVALID_RESPONSE` (502) is client-generated only: `@banhao/api-client` raises
it when a response cannot be parsed. The API never throws it.

Authorization is never downgraded to authentication. A signed-in actor who
lacks a capability gets 403, not 401 — collapsing the two would make "log in
again" the client's advice for a problem logging in again cannot fix.

## 4. Authentication and authorization

`Authorization: Bearer <Supabase access token>`. Three guards run globally, in
this order (`apps/api/src/app.module.ts`):

1. **`SupabaseAuthGuard`** — verifies the token's signature, algorithm, issuer
   and audience via JWKS, then populates `request.user` with capabilities
   resolved from **domain membership** (`restaurant_members`, `riders`,
   `platform_staff`) per DEC-033 / DEC-APP-004. `profiles.role` is read by no
   guard and no policy.
2. **`RolesGuard`** — "does this actor hold the required capability at all?"
3. **`RestaurantScopeGuard`** — "is this actor a member of *this* restaurant?"

The last two are separate deliberately: collapsing them would make every
merchant a merchant everywhere.

Routes are protected by default and must opt out explicitly with `@Public()`.

## 5. Operation surface

Generated from `openapi.json`; regenerate the file rather than editing this
table by hand.

### Public

| Method | Path |
|---|---|
| `GET` | `/health` |

### Customer — identity and addresses

| Method | Path |
|---|---|
| `GET` `PATCH` | `/api/v1/me` |
| `GET` `POST` | `/api/v1/me/addresses` |
| `PATCH` `DELETE` | `/api/v1/me/addresses/{id}` |
| `GET` | `/api/v1/me/notifications` |
| `PATCH` | `/api/v1/me/notifications/{id}` |

### Customer — cart, order, payment

| Method | Path |
|---|---|
| `POST` | `/api/v1/cart/validate` |
| `POST` | `/api/v1/orders` |
| `POST` | `/api/v1/orders/{id}/payment` |
| `POST` | `/api/v1/orders/{id}/cancel` (also `OPERATOR`) |
| `GET` | `/api/v1/orders/{id}/delivery-proof` |

### Merchant

| Method | Path |
|---|---|
| `POST` | `/api/v1/orders/{id}/accept` |
| `POST` | `/api/v1/orders/{id}/start-preparing` |
| `POST` | `/api/v1/orders/{id}/mark-ready` |
| `POST` | `/api/v1/merchant/menu-items/{menuItemId}/image/upload-url` |
| `POST` | `/api/v1/merchant/menu-items/{menuItemId}/image/complete` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/cover/upload-url` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/cover/complete` |

### Rider

| Method | Path |
|---|---|
| `POST` | `/api/v1/rider/location` |
| `POST` | `/api/v1/rider/offers/{id}/accept` |
| `POST` | `/api/v1/rider/offers/{id}/decline` |
| `POST` | `/api/v1/rider/deliveries/{id}/picked-up` |
| `POST` | `/api/v1/rider/deliveries/{id}/en-route` |
| `POST` | `/api/v1/rider/deliveries/{id}/arrived` |
| `POST` | `/api/v1/rider/deliveries/{id}/delivered` |
| `POST` | `/api/v1/rider/deliveries/{id}/cancel` |
| `POST` | `/api/v1/rider/deliveries/{id}/proof/upload-url` |
| `POST` | `/api/v1/orders/{id}/pickup` |
| `POST` | `/api/v1/orders/{id}/start-delivery` |
| `POST` | `/api/v1/orders/{id}/complete` |

## 6. Deliberately excluded from the contract

Two endpoints exist and are `@ApiExcludeEndpoint()`. Neither is called by a
BANHAO client, and publishing them would invite exactly the direct calls their
guards exist to reject. The contract test asserts both stay out.

| Method | Path | Authentication |
|---|---|---|
| `POST` | `/internal/tick` | HMAC-SHA256 over the raw body, `X-Tick-Signature`, `INTERNAL_TICK_SECRET` (DEC-APP-010). Called by the Cloudflare Worker cron |
| `POST` | `/webhooks/payments/{provider}` | Provider signature over the **raw** request bytes (CON-002, DEC-APP-005). The app is created with `rawBody: true` because a JSON-parsed-and-reserialised body will not verify |

**CON-002 is absolute: only a signature-verified provider webhook may confirm a
payment.** No client screen and no client call decides that a payment
succeeded.

## 7. What clients read directly

Not every read goes through this API. Per the V1.1 spine — *NestJS writes,
clients read, Postgres decides* — catalog and order reads are Supabase queries
under RLS from the client, while **every state-changing operation is an API
call**. That is why the surface above is almost entirely `POST`: the reads are
not missing, they are somewhere else on purpose.

## 8. Related documents

| Document | What it settles |
|---|---|
| [`../BANHAO-APP-ARCHITECTURE-V1.md`](../BANHAO-APP-ARCHITECTURE-V1.md) | Authoritative. `DEC-APP-001…012`, phases |
| [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md) | How the decisions get built |
| [`../ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md) | `ADR-001…012` |
| [`../ORDER_LIFECYCLE.md`](../ORDER_LIFECYCLE.md) | The states these commands move between |
| [`../PAYMENT_LIFECYCLE.md`](../PAYMENT_LIFECYCLE.md) | Payment states, idempotency, CON-002 |
| [`../RIDER_LIFECYCLE.md`](../RIDER_LIFECYCLE.md) | Dispatch and the no-rider ladder |
