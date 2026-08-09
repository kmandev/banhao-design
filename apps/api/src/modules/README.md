# API Modules

Modular monolith (DEC-009, PROP-001). One deployable service, internally split
into modules with clear boundaries so a module can be extracted later if a real
scaling need appears — not before.

## Implemented in this foundation

| Module | Status |
|---|---|
| `health` | `GET /health` |
| `auth` | `GET /api/v1/me` — Supabase JWT verification |
| `users` | Profile lookup, role resolution |
| `payments` | **Abstraction only** — `PaymentProvider` interface, no real provider (Q-001 OPEN) |

## Planned, not yet created

`merchants`, `restaurants`, `catalog`, `orders`, `refunds`, `ledger`,
`settlements`, `drivers`, `delivery`, `notifications`, `admin`.

Deliberately not scaffolded as empty folders — an empty module is noise that
implies work exists where none does. Create each when it gets real behaviour.

## Rules for adding a module

1. Modules must not read another module's database tables directly — go through
   that module's service.
2. Anything touching money must satisfy CON-001 (Order and Payment state stay
   separate), CON-003 (ledger balances to zero), and REQ-003 (idempotency).
3. Payment provider SDKs may only be imported inside
   `payments/providers/` — never in business logic.
