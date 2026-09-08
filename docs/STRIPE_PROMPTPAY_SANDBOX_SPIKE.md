# Stripe PromptPay Sandbox Spike

**Date:** 2026-09-08
**Status:** Research spike — READ-ONLY. No production code changed.
**Depends on:** DEC-055 (Stripe locked as Q-001's Phase 1 payment provider,
PromptPay/THB, no Connect), which explicitly left the PromptPay QR
presentation mapping `OPEN / SANDBOX SPIKE REQUIRED`. This document closes
that item with real, live Stripe **test-mode** evidence.

**Method:** All findings below come from live calls against the real Stripe
API (`api.stripe.com`) in test mode, using `STRIPE_SECRET_KEY` (confirmed
`sk_test_...`, never printed or committed) loaded transiently from the root
`.env`, plus Stripe's own hosted PromptPay test-payment simulation page. No
field, payload, or event shape below is inferred, guessed, or taken from
documentation alone — every claim traces to an actual captured response.
Where something could not be verified live, it is marked **NOT VERIFIED**
rather than guessed.

Test PaymentIntents created and their final disposition:

| PaymentIntent | Purpose | Final status |
|---|---|---|
| `pi_3UDGcVARZ0Fu9Rq00Icy7PI3` | Create/confirm shape, success path, real `payment_intent.succeeded` webhook | `succeeded` |
| `pi_3UDGdtARZ0Fu9Rq01pbEl4ha` | Idempotency (same-key replay), then failure path, then cancellation path | `canceled` |
| `pi_3UDGe4ARZ0Fu9Rq03iY3mYGj` | Idempotency (different-key regeneration) | `requires_payment_method` (left untouched, no money movement) |

---

## 1. Stripe Sandbox

- Key confirmed `sk_test_...` (test mode) before any call was made. A
  `sk_live_...` key would have stopped this spike immediately — not
  encountered.
- All calls hit the real `https://api.stripe.com` test-mode endpoints.
  No mock, no stub, no Stripe CLI (not installed/available in this
  environment) — the Events API was used as the webhook-payload source of
  truth instead, exactly as it would appear in a real webhook delivery.
- Environment: root `.env`, sourced transiently (`set -a; source .env; set
  +a`) inside single Bash invocations and `unset` immediately after each
  use. Never echoed, never logged, never written to a file.

## 2. PromptPay — PaymentIntent creation & confirmation

**Creation alone does not return `next_action`.** `POST /v1/payment_intents`
with `payment_method_types[]=promptpay`, `amount=6000` (satang), `currency=thb`
returns:

```
status: "requires_payment_method"
next_action: null
```

A second call, `POST /v1/payment_intents/{id}/confirm`, is required to reach
`next_action`. The first confirm attempt (no `payment_method_data`) returned
**HTTP 400**:

```
code: "parameter_missing"
message: "Missing required param: billing_details[email]."
param: "billing_details[email]"
```

**Finding: PromptPay confirmation requires a billing email server-side**,
even with no publishable key / client-side Elements involved. Adding
`payment_method_data[type]=promptpay` and
`payment_method_data[billing_details][email]=<email>` to the confirm call
succeeded (`HTTP 200`, `status: "requires_action"`).

### Exact `next_action` shape (real, captured)

```json
{
  "type": "promptpay_display_qr_code",
  "promptpay_display_qr_code": {
    "data": "https://payments.stripe.com/payment_methods/test_payment?payment_attempt=payatt_...",
    "hosted_instructions_url": "https://payments.stripe.com/promptpay/instructions/...",
    "image_url_png": "https://qr.stripe.com/test_....png",
    "image_url_svg": "https://qr.stripe.com/test_....svg"
  }
}
```

**Finding: there is no raw scannable QR/EMV string field anywhere.** Stripe
never returns a bare payload `value` to build a QR code from — only a hosted
page URL (`data`), a customer-instructions URL (`hosted_instructions_url`),
and two pre-rendered image URLs (PNG/SVG). This directly contradicts
`CreatePaymentResult.presentation`'s current shape (`type: 'QR_STRING', value:
string`), which assumes a raw string BANHAO renders itself.

### `expires_at` — confirmed absent

An exhaustive recursive key search (`jq 'paths'`) across the full PaymentIntent
object graph — creation response, confirm response, and retrieve response —
found **zero** keys named `expires_at` or matching `/expir/i` anywhere except
inside `last_payment_error` text (see §5). **Finding: Stripe supplies no
machine-readable PromptPay QR expiration timestamp.** BANHAO cannot render a
countdown from provider data alone; any expiry UI must be driven by BANHAO's
own policy/timer, not a Stripe field.

### Amount handling (THB/satang)

`amount: 6000` in the request, `amount: 6000` / `amount_received: 6000` in
every response, `currency: "thb"`. **Confirmed: Stripe's PromptPay integer
amount is already in the smallest unit (satang) for THB** — no conversion,
no float, direct match to BANHAO's `CON-003` integer-satang representation.
No `/100` or `*100` transform needed anywhere in an adapter.

## 3. Webhook — `payment_intent.succeeded` (real, captured)

Real webhook event retrieved via `GET /v1/events/evt_3UDGcVARZ0Fu9Rq00jEuCqN9`
after authorizing the test payment through Stripe's hosted simulation page and
independently confirming the state transition via a direct
`GET /v1/payment_intents/{id}` retrieve (`status: "succeeded"`,
`amount_received: 6000` — never inferred from the UI alone).

```json
{
  "id": "evt_3UDGcVARZ0Fu9Rq00jEuCqN9",
  "object": "event",
  "api_version": "2026-08-26.dahlia",
  "created": 1788841777,
  "livemode": false,
  "pending_webhooks": 0,
  "request": { "id": null, "idempotency_key": null },
  "type": "payment_intent.succeeded"
}
```
```json
{
  "id": "pi_3UDGcVARZ0Fu9Rq00Icy7PI3",
  "object": "payment_intent",
  "status": "succeeded",
  "amount": 6000,
  "amount_received": 6000,
  "currency": "thb",
  "metadata": { "orderId": "SPIKE-TEST-001", "paymentReference": "SPIKE-PAY-001" },
  "payment_method": "pm_1UDGdBARZ0Fu9Rq0FIJLhWvo",
  "latest_charge": "py_3UDGcVARZ0Fu9Rq00qe0bLPD"
}
```

**Finding:** `metadata` set at creation survives untouched into the webhook
event — confirms BANHAO's `orderId` (and any correlation field) round-trips
through Stripe with no server-side transformation. This is the intended
BANHAO↔Stripe correlation mechanism and it works exactly as assumed by
DEC-055.

## 4. Webhook — `payment_intent.payment_failed` (real, captured)

The hosted test page's own on-screen copy is ambiguous ("...determine if the
payment was successful" referencing "`payment_intent.succeeded` or
`payment_intent.failed`" events) — this was **not trusted**, and the true
type was resolved via the Events API (source of truth), which is
**`payment_intent.payment_failed`**, not `payment_intent.failed`.

Triggered by clicking "Expire Test Payment" on the hosted simulation page for
`pi_3UDGdtARZ0Fu9Rq01pbEl4ha`, then verified by direct retrieve
(`status: "requires_payment_method"`) before pulling the event.

```json
{
  "id": "evt_3UDGdtARZ0Fu9Rq01j4eYbcO",
  "object": "event",
  "api_version": "2026-08-26.dahlia",
  "created": 1788842071,
  "livemode": false,
  "pending_webhooks": 0,
  "type": "payment_intent.payment_failed"
}
```
```json
{
  "id": "pi_3UDGdtARZ0Fu9Rq01pbEl4ha",
  "status": "requires_payment_method",
  "amount": 7500,
  "amount_received": 0,
  "currency": "thb",
  "cancellation_reason": null,
  "canceled_at": null,
  "metadata": { "orderId": "SPIKE-IDEMP-002" },
  "last_payment_error": {
    "code": "payment_intent_payment_attempt_expired",
    "message": "The PromptPay payment attempt of this PaymentIntent has expired. You can provide payment_method_data or a new PaymentMethod to attempt to fulfill this PaymentIntent again.",
    "type": "card_error"
  }
}
```

**Critical finding — "Expire Test Payment" does NOT cancel the
PaymentIntent.** It only fails the current PromptPay QR *attempt*. The
PaymentIntent itself returns to `requires_payment_method`, stays alive, has
no `canceled_at`/`cancellation_reason`, and is **retryable** with a fresh
`confirm` call (a new QR can be issued against the same PaymentIntent ID).
This is a distinct outcome from true cancellation — see §5.

## 5. Lifecycle — FAILED vs CANCELED vs EXPIRED (real, captured)

**Finding: Stripe's PaymentIntent model has only two relevant terminal/retry
outcomes here — there is no separate "EXPIRED" status.** What BANHAO's own
vocabulary calls "EXPIRED" maps onto Stripe's FAILED outcome (§4), not a
distinct state.

| BANHAO concept | Real Stripe status | Real event | Retryable? | Evidence |
|---|---|---|---|---|
| FAILED (attempt expired) | `requires_payment_method` | `payment_intent.payment_failed` | **Yes** — same PaymentIntent, same ID, new `confirm` possible | §4 |
| CANCELED | `canceled` | `payment_intent.canceled` | **No** — terminal | below |
| EXPIRED (as a distinct third state) | — does not exist — | — | — | confirmed absent by testing both the hosted-page "expire" action (§4, produces FAILED) and an explicit cancel (below, produces CANCELED) |

True cancellation was tested via `POST /v1/payment_intents/{id}/cancel`
(a Stripe API for **abandoning an incomplete PaymentIntent before any charge**
— it moves no money and is unrelated to `POST /v1/refunds`, which was never
called, per the task's hard constraint) on the same
`pi_3UDGdtARZ0Fu9Rq01pbEl4ha`, after it had already failed once (§4):

```json
{
  "id": "pi_3UDGdtARZ0Fu9Rq01pbEl4ha",
  "status": "canceled",
  "cancellation_reason": null,
  "canceled_at": 1788842108,
  "amount": 7500,
  "currency": "thb"
}
```

Real `payment_intent.canceled` event (`evt_3UDGdtARZ0Fu9Rq01EyB2VQs`):

```json
{
  "id": "evt_3UDGdtARZ0Fu9Rq01EyB2VQs",
  "type": "payment_intent.canceled",
  "created": 1788842108
}
```
```json
{
  "id": "pi_3UDGdtARZ0Fu9Rq01pbEl4ha",
  "status": "canceled",
  "amount": 7500,
  "amount_received": 0,
  "currency": "thb",
  "cancellation_reason": null,
  "canceled_at": 1788842108,
  "metadata": { "orderId": "SPIKE-IDEMP-002" }
}
```

**Finding:** `cancellation_reason` is `null` unless a reason string is
explicitly supplied on the `/cancel` call (not tested here — not needed for
BANHAO's flow, which would cancel on its own timeout policy, not a
Stripe-supplied reason). `canceled_at` is a real Unix timestamp, present only
on this path — never on the FAILED path.

**Conclusion for BANHAO:** the FAILED/CANCELED distinction is real and must
be respected by any adapter — a failed QR attempt is not terminal and must
not be treated as a dead order; only an explicit cancel (BANHAO-driven, on
its own expiry policy) or a genuine `succeeded` is terminal. **"EXPIRED" as
a third state is NOT VERIFIED to exist in Stripe's model and should not be
implemented as one** — BANHAO's own timeout policy should decide when a
FAILED/retryable PaymentIntent gets explicitly canceled by BANHAO calling
`/cancel` itself, using DEC-055's/BANHAO's own timer, not a Stripe-native
expiry.

## 6. Idempotency

Tested against `POST /v1/payment_intents` (creation), using an explicit
`Idempotency-Key` header — the mechanism BANHAO's `orderId` /
`orderId:attemptNo` strategy would use.

**Same key, same request body, replayed (Request A then Request B):**
- Both returned identical `id: pi_3UDGdtARZ0Fu9Rq01pbEl4ha`, identical
  `status: "requires_payment_method"`.
- Request B's response carried header **`idempotent-replayed: true`**.
- **Finding:** confirms Stripe genuinely dedupes on the exact key — no
  duplicate PaymentIntent was created. This validates using a stable key
  derived from `orderId` for BANHAO's initial create call.

**Different key, same logical order (regeneration case):**
- A fresh `Idempotency-Key` produced a **new** PaymentIntent
  (`pi_3UDGe4ARZ0Fu9Rq03iY3mYGj`), distinct from the first.
- **Finding:** confirms BANHAO's planned `orderId:attemptNo` key strategy
  works as intended — incrementing `attemptNo` on retry-with-new-attempt
  deliberately produces a new PaymentIntent (e.g. after a genuine cancel),
  while keeping `attemptNo` constant on a pure network-retry safely
  dedupes via `orderId` alone.

## 7. BANHAO Impact — required adapter changes

Comparing the current interface (`apps/api/src/modules/payments/payment-provider.interface.ts`) against verified Stripe behavior:

```ts
export interface CreatePaymentResult {
  providerPaymentId: string;
  presentation?: { type: 'QR_STRING'; value: string; expiresAt: string };
}
```

| Field | Current shape | Verified Stripe reality | Required change |
|---|---|---|---|
| `presentation.value` (raw QR string) | assumed to exist | **does not exist** — only a hosted URL and two image URLs | `presentation` must carry a hosted/image URL, not a raw payload string |
| `presentation.expiresAt` | assumed to exist | **confirmed absent** everywhere in the object graph | must be removed, or sourced entirely from BANHAO's own policy, never from Stripe |
| Terminal/retry distinction | not modeled | FAILED (retryable, same PI) vs CANCELED (terminal, explicit `/cancel`) are genuinely different | adapter's webhook handling must map `payment_intent.payment_failed` → a non-terminal "attempt failed, may retry" state, and `payment_intent.canceled` → BANHAO's terminal cancel state — never conflate them |
| Confirmation requirement | not modeled | `billing_details[email]` is required server-side for PromptPay confirm | adapter must always supply a billing email (a synthetic/platform email is sufficient — Stripe does not validate deliverability in test mode; **NOT VERIFIED** whether live mode enforces anything stricter) |
| Amount/currency | integer satang assumed | **confirmed** — Stripe's THB amount is already in satang, 1:1, no conversion | no change needed — `CON-003` already compatible |
| Idempotency key strategy | `orderId` / `orderId:attemptNo` assumed | **confirmed working exactly as designed** | no change needed |
| `client_secret` | not part of current interface | present in Stripe's response, but exists only to support a client-side Stripe.js/Elements confirm flow | **not needed** — BANHAO's flow (server confirms, renders `image_url_png`/hosted URL) never uses a publishable key or client-side Stripe.js, so `client_secret` should not be exposed through `CreatePaymentResult` at all |

**Proposed revised shape (for a future, separate task — not implemented
here):**

```ts
presentation?: {
  type: 'HOSTED_URL' | 'IMAGE_URL';
  value: string;        // hosted_instructions_url or image_url_png/svg
  // no expiresAt — BANHAO owns its own QR-display timeout policy
}
```

This is a proposal derived from evidence, not an implementation — changing
the interface is explicitly out of scope for this spike.

## 8. Validation

- No production file was modified. `git status` shows the same untracked
  `.claude/` as before this spike, plus this new document.
- No lint/typecheck/test run was required — no application code changed.
- All scratch evidence (raw JSON responses) lives only under this session's
  scratchpad directory, outside the repository, and is not committed.

## 9. Git / Security

- **No live key was used.** `STRIPE_SECRET_KEY` was confirmed `sk_test_...`
  before any call; this was re-confirmed implicitly by every response's
  `"livemode": false`.
- **No secret was exposed.** The key value was never echoed, printed, logged,
  or written to any file — only sourced transiently in-process and `unset`
  immediately after each use.
- **No secret was committed.** `.env` was not touched by any git operation
  and remains gitignored/untracked.
- **No production Stripe binding was changed.** `PaymentsModule` still binds
  `NullPaymentProvider`; no `payments/providers/stripe/*` module was created.
- **No refund runtime was touched.** `POST /v1/refunds` was never called —
  only `payment_intents` create/confirm/retrieve/cancel and `events` list/
  retrieve, all of which move no money and (for `/cancel`) only abandon an
  unfunded PaymentIntent.
- **No economics changed.** No fee, commission, or ledger figure was read or
  written.
- This document itself contains zero secret values — only the bare name
  `STRIPE_SECRET_KEY` is referenced anywhere above.
