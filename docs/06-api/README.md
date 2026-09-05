# 06 — API

**Status: IMPLEMENTED (Phase A–H surface plus the merchant M-11/M-12 writes).
The machine-readable contract is [`openapi.json`](openapi.json), generated from
the code.**

Written 2026-09-01, replacing the 2026-08-09 placeholder that said no backend
existed. It does: `apps/api` is a NestJS modular monolith (DEC-009, DEC-011)
serving 49 client-facing operations across 46 paths.

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

**`components.schemas` is empty — a structural property of the current
Zod-first payload architecture, not an unfinished piece of this contract.**
`@nestjs/swagger` remains responsible for exactly what it does above: operation
metadata (`@ApiTags`, `@ApiOkResponse`, `@ApiBearerAuth`), paths, methods, auth,
status codes. It cannot additionally derive a reusable schema from request and
response *shapes* here, because every one of them is a TypeScript `type`/`interface`
— `@banhao/types` / `z.infer<typeof …>` — and both `@ApiProperty()` and the
Swagger CLI plugin need a class to attach decorator metadata to; a TS type is
erased at compile time and has nothing to introspect. The payload contract
itself is unaffected and still lives in `@banhao/types`, enforced at compile
time across the monorepo. Populating `components.schemas` would need a
class-based DTO strategy or a Zod/OpenAPI bridge (`zod-to-openapi`, `nestjs-zod`)
— a new dependency, **not additive work** — which is a future Architecture
Decision and is explicitly out of scope for the current V1.1 architecture.

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

### Merchant — orders

| Method | Path |
|---|---|
| `POST` | `/api/v1/orders/{id}/accept` |
| `POST` | `/api/v1/orders/{id}/start-preparing` |
| `POST` | `/api/v1/orders/{id}/mark-ready` |

### Merchant — images

| Method | Path |
|---|---|
| `POST` | `/api/v1/merchant/menu-items/{menuItemId}/image/upload-url` |
| `POST` | `/api/v1/merchant/menu-items/{menuItemId}/image/complete` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/cover/upload-url` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/cover/complete` |

### Merchant — menu (M-11)

Writes only. The overview reads client-to-Supabase under
`menu_categories_select_member` / `menu_items_select_member`, so no read
endpoint exists here and none should be added.

| Method | Path |
|---|---|
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/menu-categories` |
| `PATCH` | `/api/v1/merchant/menu-categories/{categoryId}` |
| `POST` | `/api/v1/merchant/menu-categories/{categoryId}/archive` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/menu-categories/reorder` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/menu-items` |
| `PATCH` | `/api/v1/merchant/menu-items/{menuItemId}` |
| `PATCH` | `/api/v1/merchant/menu-items/{menuItemId}/availability` |
| `POST` | `/api/v1/merchant/menu-items/{menuItemId}/archive` |
| `POST` | `/api/v1/merchant/restaurants/{restaurantId}/menu-items/reorder` |
| `PUT` | `/api/v1/merchant/menu-items/{menuItemId}/option-groups` |

**There is no `DELETE` anywhere on this surface.** `menu_items` and
`menu_categories` both carry a `reject_delete` trigger and
`order_items.menu_item_id` is `ON DELETE SET NULL`, so removal is
`archived_at` and the copy says so.

`…/availability` is its own single-field route on purpose: it is the most
frequent merchant action after accepting an order, and routing it through the
full item payload would make the fast path the heaviest request on the screen.

### Merchant — opening hours (M-12)

| Method | Path |
|---|---|
| `PUT` | `/api/v1/merchant/restaurants/{restaurantId}/hours` |

`PUT`, and the whole week in one request: `restaurant_hours` is replaced
wholesale on edit, so a per-day route would silently rewrite the other six
days. The write runs inside one database transaction
(`replace_restaurant_hours`) because a failure between the delete and the
insert would otherwise leave a restaurant with no hours at all, which the
derived open/closed reads as permanently closed.

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
