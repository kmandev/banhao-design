# Stripe Payment Presentation Contract — Recon & Proposal

**Status:** RECON + PROPOSAL ONLY. No production code, schema, or behavior changed.
**Starting HEAD:** `1e4c1b19` (`docs: record Stripe PromptPay sandbox spike`)
**Depends on:** `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` (2026-09-08, live Stripe test-mode evidence), DEC-055 (Stripe locked as Q-001 provider, clause 12 `OPEN / SANDBOX SPIKE REQUIRED`).
**Author's scope discipline:** this document proposes; it does not implement. No interface, DTO, screen, or migration is touched by this task.

---

## 1. Executive summary

The sandbox spike proved BANHAO's current payment-presentation contract is **factually wrong** about Stripe: `CreatePaymentResult.presentation` assumes a raw QR string (`{ type: 'QR_STRING', value, expiresAt }`), but Stripe PromptPay never returns one — only a hosted URL, two image URLs, and no expiry field at all.

The good news, found during this recon: **nothing in the customer app currently consumes this contract.** `apps/customer/src/screens/payment.tsx` renders a static placeholder emoji and runs its own local 600-second countdown; it never calls `POST /api/v1/orders/:id/payment` and never reads `qr.value` or `qr.expiresAt` from any API response. The only real consumers of the contract today are the API's own service/test code and the (fake) `NullPaymentProvider`. This makes the redesign **low-risk and additive** — there is no live customer-facing behavior to break.

**Recommended contract:** Option C (provider-neutral, minimal customer-facing shape) implemented as a **tagged union with the two currently-justified variants** — effectively Option B narrowed to what BANHAO's architecture actually needs today, not the abstract Option A shape. See §6.

**Expiry:** the `payment_attempts.expires_at` database column and BANHAO's own 10-minute policy timer are **already BANHAO-owned, not Stripe-derived** — `NullPaymentProvider` invents this value itself today. The sandbox spike changes nothing about who owns expiry; it only proves BANHAO can never source it from Stripe. Recommendation: **Option C-equivalent for expiry** — remove `expiresAt` from `CreatePaymentResult.presentation` (the provider-facing type), and keep `payment_attempts.expires_at` as a BANHAO-set database column populated by the adapter layer's *own* policy constant, not copied from any provider field. See §5.

**Database schema change: NOT REQUIRED.** `payment_attempts.qr_payload text` and `expires_at timestamptz` are both loose enough to hold a URL string and a BANHAO-computed timestamp respectively. No migration is proposed.

**READY FOR DECISION LOCK:** yes — see §13.

---

## 2. Current contract (as implemented today, HEAD `1e4c1b19`)

### A. `PaymentProvider` abstraction — `apps/api/src/modules/payments/payment-provider.interface.ts`

```ts
export type PaymentMethod = 'PROMPTPAY_QR' | 'CASH';

export interface CreatePaymentInput {
  idempotencyKey: string;
  orderId: string;
  amount: Money;
  method: PaymentMethod;
  webhookUrl: string;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  presentation?: { type: 'QR_STRING'; value: string; expiresAt: string };
}

export interface RefundInput { idempotencyKey: string; providerPaymentId: string; amount: Money; reason: string; }
export interface RefundResult { providerRefundId: string; }

export type WebhookVerification =
  | { verified: true; providerPaymentId: string; providerEventId: string; providerEvent: string; rawPayload: unknown }
  | { verified: false; reason: string };

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  verifyWebhookSignature(rawBody: string, headers: Record<string, string>): WebhookVerification;
}
```

There is **no** `initializePayment`, `resumePayment`, or `regenerateAttempt` on the interface itself — those three names are private methods of `PaymentsService` (`apps/api/src/modules/payments/payments.service.ts`), not part of `PaymentProvider`. Only `createPayment`, `refund`, and `verifyWebhookSignature` are provider-facing.

### B. `PaymentInitiationResponse` DTO — `packages/validation/src/payment.ts`

```ts
export interface PaymentInitiationResponse {
  paymentId: string;
  paymentReference: string;
  state: string;
  amountSatang: Satang;
  currency: string;
  qr?: { value: string; expiresAt: string };
}
```

This is the actual **API response shape** the customer app would consume — distinct from, but currently shaped identically to, `CreatePaymentResult.presentation` (minus the `type` tag). `PaymentsService.toResponse()` (payments.service.ts:496) is the single mapping point: it reads `attempt.qr_payload` / `attempt.expires_at` off the DB row and only emits `qr` when **both** are truthy.

### C. `NullPaymentProvider.createPayment()` — the only implementation that exists

```ts
async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const providerPaymentId = `NULL-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + SIMULATED_QR_TTL_MS).toISOString(); // 10 min, its own constant
  return {
    providerPaymentId,
    presentation: { type: 'QR_STRING', value: `NULL-QR:${input.orderId}:${providerPaymentId}`, expiresAt },
  };
}
```

`SIMULATED_QR_TTL_MS = 10 * 60 * 1000` is a constant **inside the null provider itself** — it is not read from anywhere Stripe-shaped, confirming `expiresAt` was already a BANHAO/provider-adapter invention, never a real provider field, even before Stripe was chosen.

---

## 3. Full consumption trace: `POST /orders/:id/payment` → customer-facing model

Traced end to end, file by file:

1. **`PaymentsController.createPayment`** (`payments.controller.ts:36`) — no request body; calls `PaymentsService.createPayment(user, orderId)`.
2. **`PaymentsService.createPayment`** (`payments.service.ts:121`) — guarded `UPDATE orders SET state='PENDING_PAYMENT' WHERE state='CREATED'`; on success calls `initializePayment`; on 0 rows, falls into `recoverOrRejectInitiation` (idempotent retry / crash-recovery / reject).
3. **`initializePayment`** (line 416) calls `provider.createPayment({...})`, inserts a `payments` row (`state: 'PENDING'`), inserts the first `payment_attempts` row with `qr_payload: result.presentation?.value ?? null` and `expires_at: result.presentation?.expiresAt ?? null`, then calls `toResponse`.
4. **`toResponse`** (line 496) — the one and only place `CreatePaymentResult.presentation` gets flattened into the API's `qr` field:
   ```ts
   qr: attempt?.qr_payload && attempt.expires_at
     ? { value: attempt.qr_payload, expiresAt: attempt.expires_at }
     : undefined,
   ```
   Note this reads back **from the database row**, not from the provider result directly — the DB is the intermediate hop even within one request.
5. **`regenerateAttempt`** (line 331) — same shape, same field names, for the `EXPIRED`/`FAILED → PENDING` regeneration path (a new `payment_attempts` row, `attempt_no + 1`).
6. **API response** — `PaymentInitiationResponse` (packages/validation/src/payment.ts), serialized as JSON by Nest's default pipeline. No custom serializer, no mapper class, no `class-transformer` decorators — the interface *is* the wire shape.
7. **API client / customer repositories** — **no consumer exists.** `apps/customer/src/repositories/index.ts` has no payment-related binding (grep for `payment`/`Payment` in that file returns nothing). No hook (`useCart`, `useAsyncData`, etc.) calls this endpoint. No API client method for it was found under `packages/api-client`.
8. **Customer-facing model** — none. The chain terminates at step 6; nothing in the app ingests it. See §4.

**Conclusion: the trace from provider to wire format is real and correct as designed; the trace from wire format to UI does not exist yet.** This is the single most consequential recon finding for scoping the redesign.

---

## 4. Customer UI consumption — `apps/customer/src/screens/payment.tsx`

Traced directly against the file, not against type definitions:

| Question | Finding |
|---|---|
| Does UI expect `QR_STRING`? | **No.** No field named `value`, `qr`, or `QR_STRING` appears anywhere in the file. |
| Does UI render a QR code locally? | **No.** `PromptPayQrScreen` (line 72) renders a static `📱` emoji (`styles.qrGlyph`) inside a placeholder box, with an explicit code comment: *"Placeholder rather than a real QR: generating one requires a payment provider (Q-001, OPEN)."* |
| Does UI expect `expiresAt`? | **No.** The countdown is driven by a **local, hardcoded constant** `QR_TTL_SECONDS = 600` (line 69) and a `useState`/`setTimeout` loop (lines 77–91) — never a server-supplied timestamp. |
| Does UI show a countdown? | **Yes**, but entirely client-side, decrementing from the hardcoded constant, with no network call backing it. |
| Does UI use `value` directly? | **No** — there is no `value` field consumption anywhere in this file. |
| Does UI support external/hosted URLs? | **No.** No `Linking.openURL`, no `WebView`, no `<a href>` equivalent exists in `payment.tsx`. |
| Is there already an image/remote-image component for a Stripe PNG/SVG? | **Not in this file.** A repo-wide check (`packages/ui/src/components`) would be needed before implementation to confirm whether a generic remote-image component exists elsewhere in `packages/ui`; none is imported here. Treat this as **unconfirmed, not "no"** — out of scope to verify further under this recon-only task, but flagged as an open item for the implementation task (§12). |
| Is there browser/webview/deep-link handling? | **No**, not in this screen. |
| What happens if presentation is absent? | **Nothing breaks, because nothing reads it.** The screen renders its placeholder unconditionally regardless of any API state. |
| What happens on retry/regeneration? | `PayExpiredScreen` (line 270) offers **"ขอ QR ใหม่"**, which does `navigation.navigate('PromptPayQr')` — a pure client-side re-entry into the same screen with **no API call**. The `PromptPayQr` route does accept optional `{ orderId, orderNumber }` params (used to route the eventual `OrderConfirmed`/tracking flow, per `navigation/types.ts:65` and the `useOrderReference` helper), but retry does not pass them through or use them to re-fetch anything. |

**This confirms**: the entire `12`–`12h` payment screen group (`PromptPayQr`, `PayChecking`, `PaySuccess`, `PayFailed`, `PayExpired`, `PayDuplicate`, `PayDetail`, `Refund`) is a **navigation-state simulation**, explicitly documented as such in the file's own header comment (line 56–66): *"⚠️ NO PAYMENT PROVIDER IS INTEGRATED... Every screen here renders a payment STATE from local navigation only."* `PayDetailScreen` (line 333) even hardcodes literal sample values (`PAY-BH000125`, `····8F2A`). This is intentional, documented Phase F-UI-not-yet-wired state, not a bug — but it means **redesigning the presentation contract requires zero customer-app code changes today**, because there is no customer-app code consuming it.

---

## 5. Stripe verified behavior — implications (Phase 2)

All facts below are restated from `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md`, not re-derived or guessed.

**Verified Stripe `next_action` shape** (real, captured, §2 of the spike):

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

No `expires_at` anywhere in the object graph (exhaustive `jq 'paths'` search, spike §2).

### 5.1 Should BANHAO expose Stripe's `data`?

**No — internal only.** `data` is `https://payments.stripe.com/payment_methods/test_payment?payment_attempt=payatt_...` — a Stripe-hosted diagnostic/test-mode URL, not documented as a stable customer-facing artifact (Stripe's own docs describe it as primarily relevant to the Stripe.js client confirm flow, which BANHAO's server-confirm design does not use — spike §7, `client_secret` row). Treat it as **provider-internal metadata**, stored (if at all) only in provider-adapter-internal state for debugging/reconciliation, never surfaced through `CreatePaymentResult` or the API response. This is not equivalent to the old `QR_STRING.value` — it is not a payload BANHAO renders into a scannable code, and assuming so would misrepresent what Stripe actually returns.

### 5.2 Should BANHAO expose Stripe image URLs?

**Yes, exactly one of `image_url_png` / `image_url_svg`, exposed as a generic `imageUrl` field — not a Stripe-specific name.**

- **Mobile rendering:** React Native has first-class remote-image support (`<Image source={{ uri }} />`); a PNG URL is directly renderable with no new dependency. SVG is not natively renderable by RN's `Image` without an added SVG library — **prefer `image_url_png`** for the mobile customer app; SVG has no clear use case here.
- **Reliability:** the URL is served from `qr.stripe.com`, Stripe's own CDN. No BANHAO-controlled reliability lever exists (no caching mandate, no fallback documented) — this is an accepted external dependency, the same class of dependency the app already has on Supabase Storage.
- **Security:** the URL is unauthenticated to open (it is meant to be shown to the customer's bank app), but it does encode a specific `payment_attempt`/PaymentIntent identifier. Standard practice — no BANHAO secret is exposed by forwarding it.
- **URL lifetime:** **NOT VERIFIED** by the sandbox spike — the spike did not test how long `qr.stripe.com` URLs remain resolvable after PromptPay-attempt failure/expiry. Do not assume permanence; do not assume expiry either. This is a genuine open question for implementation, not something this recon can resolve without a further live test (out of scope here).
- **Provider coupling / future-provider fit:** exposing a **generic** `imageUrl` field (not literally named `stripeImageUrl`) keeps the contract provider-neutral even though only Stripe backs it today — see §6.

### 5.3 Should BANHAO expose `hosted_instructions_url`?

**Supplementary, not primary.** It is a Stripe-hosted page with human-readable instructions — useful as a "having trouble scanning?" fallback link, not as the primary render target (the image is). Recommendation: include it as an **optional secondary field**, not the field the UI's main render path depends on. This mirrors how `hostedInstructionsUrl` is already scoped as a distinct, lower-priority field in the sandbox spike's own proposed shape (spike §7).

### 5.4 Expiration semantics — the critical question

Tracing the actual code (not assumption): `payment_attempts.expires_at` is populated **exclusively** from `CreatePaymentResult.presentation.expiresAt`, which today is generated **entirely inside `NullPaymentProvider`** (`new Date(Date.now() + SIMULATED_QR_TTL_MS)`), never derived from any provider field, because no real provider has ever been wired. In other words: **`expiresAt` was already BANHAO-owned policy before this recon, wearing a provider-shaped costume.** The sandbox spike does not change who owns it — it proves that costume can never be filled in by Stripe, because Stripe has no such field to copy from (spike §2, confirmed absent).

Given that, evaluating the four options against what the code actually does today:

- **Option A (keep `expiresAt` on the generic `presentation` type, BANHAO-owned):** Technically works — the adapter would just compute its own timestamp exactly as `NullPaymentProvider` does today, ignoring Stripe entirely for this one field. **Downside:** leaving `expiresAt` on the same interface shape as `imageUrl`/`hostedInstructionsUrl` implies to a future reader that it is provider data like the others, when it is not — a latent correctness trap for the next person who wires a second provider and assumes every field on `presentation` came from the provider.
- **Option B (`expiresAt: null` for Stripe):** Actively worse than Option A — it makes the field look Stripe-native and permanently absent, when in fact BANHAO *does* have an expiry policy (10 minutes) it wants to enforce and display; `null` would suppress the customer-facing countdown entirely for no reason, since `toResponse`'s existing `attempt?.qr_payload && attempt.expires_at` guard would then hide `qr` whenever `expires_at` is null.
- **Option C (remove `expiresAt` from the generic presentation type; move expiry to its own lifecycle field, computed by BANHAO, not the provider):** **Recommended.** This makes the ownership explicit in the type system itself: `CreatePaymentResult` stops claiming a provider-sourced expiry exists at all, and the **adapter layer** (not the generic `PaymentProvider` interface) is responsible for writing `payment_attempts.expires_at` from a BANHAO policy constant (a `PAYMENT_ATTEMPT_TTL_MS`-style value, the direct descendant of today's `SIMULATED_QR_TTL_MS`), independent of whatever `createPayment()` returns. The `PaymentInitiationResponse.qr.expiresAt` field the API returns to the client **can be retained unchanged** — it is already reading from `payment_attempts.expires_at` (a BANHAO DB column), not from the provider result, so nothing about the outward API contract needs to change for this. Only `CreatePaymentResult.presentation.expiresAt` (the provider-facing type) needs to go.
- **Option D:** No better design was found. Option C is the direct, minimal-churn conclusion of tracing what the code already does.

**Recommendation: Option C.** Concretely: `PaymentsService.initializePayment`/`regenerateAttempt` compute `expiresAt` themselves (a `PaymentsService`-level or shared policy constant), independent of `result.presentation`, and write it to `payment_attempts.expires_at` directly — never reading an `expiresAt` field off `CreatePaymentResult` at all, because that field would no longer exist. This is a **`PaymentsService` change**, not a `PaymentProvider` interface change beyond removing the field.

---

## 6. Contract options

### Option A — Generic QR presentation (as briefed)

```ts
type PaymentPresentation =
  | { type: 'QR_CODE'; imageUrlPng?: string; imageUrlSvg?: string; hostedInstructionsUrl?: string; data?: string };
```

- **Advantages:** single variant, minimal type surface, easy to reason about.
- **Disadvantages:** conflates "the thing that is provider-internal" (`data`) with "the thing the customer sees" (image/hosted URL) in one object with no visibility boundary — a future engineer could wire `data` straight to the client by mistake, exactly the leak §5.1 warns against. Also carries `imageUrlSvg`, unneeded on RN mobile (§5.2).
- **Stripe fit:** adequate for PromptPay; says nothing about what a card-based or bank-redirect method (should one ever be added) would need.
- **Future-provider fit:** weak — the single `QR_CODE` type name presumes every future provider issues a QR. A card 3-D-Secure redirect (a different but plausible future method) does not fit this shape at all.
- **Customer UI impact:** low, since nothing consumes the contract today (§4) — but the shape itself is the least clean of the three.
- **Does `data` belong here?** No — see §5.1. Including it invites exactly the leak this option's own disadvantage names.

### Option B — Broader payment presentation union

```ts
type PaymentPresentation =
  | { type: 'QR_CODE'; imageUrl?: string; hostedInstructionsUrl?: string }
  | { type: 'REDIRECT'; url: string };
```

- Only `QR_CODE` is justified by anything BANHAO has built or decided today (PromptPay only, DEC-016). **`REDIRECT` is not justified** — no BANHAO decision names a redirect-based payment method, Phase 1 is PromptPay-only, and DEC-055 explicitly declines even Stripe.js/Elements client-side flows (spike §7: "not needed... never uses a publishable key or client-side Stripe.js"). Adding `REDIRECT` now would be inventing a future-provider variant with no current justification — exactly what the brief's own Option B instructions warn against ("do not over-engineer for hypothetical providers").
- **Recommendation within this option:** if a union is wanted, it should have **exactly one variant today** (`QR_CODE`), which makes it structurally identical to Option A minus the `data` leak — see Option C below, which is this narrowed version.

### Option C — Provider-neutral contract, provider-specific internals kept out

```ts
// Customer-facing (CreatePaymentResult.presentation / PaymentInitiationResponse.qr):
export interface CreatePaymentResult {
  providerPaymentId: string;
  presentation?: {
    type: 'QR_CODE';
    imageUrl: string;              // renderable image (PNG preferred for RN — §5.2)
    hostedInstructionsUrl?: string; // supplementary fallback link — §5.3
    // no `expiresAt` — BANHAO-owned, lives in payment_attempts.expires_at (§5.4)
    // no `data` — Stripe-internal, never crosses this boundary (§5.1)
  };
}
```

Provider-internal detail (Stripe's `data`, the PaymentIntent id beyond what `providerPaymentId` already carries, raw event objects) stays inside `payments/providers/stripe/*` and in `payment_events.raw_payload` (already the documented mechanism for preserving the full original event, per DEC-055 clause 5's "embed the original Stripe event object" requirement) — never promoted into `CreatePaymentResult` or the API's customer-facing DTO.

- **Advantages:** the type system enforces the exact boundary §5.1–§5.4 argue for. `imageUrl` and `hostedInstructionsUrl` are provider-neutral names — a future non-QR provider would need a genuinely new variant, which is honest (Option B's problem, avoided). No leaked field, no unjustified speculative variant.
- **Disadvantages:** slightly more restrictive than Option A if BANHAO ever wants to show *both* PNG and SVG (unlikely on mobile — §5.2) or wants `data` for logging (still achievable by logging it at the adapter layer, just not through this type).
- **Stripe fit:** exact match to verified reality (spike §2, §7).
- **Future-provider fit:** good — the field names (`imageUrl`, `hostedInstructionsUrl`) describe *customer-facing artifacts*, not Stripe concepts, so a second QR-based provider (any future PromptPay-alternative) fits without change. A genuinely different presentation (say, a redirect) is a new variant added **when a provider that needs it is actually selected**, not speculatively now.
- **Customer UI impact:** none today (§4); when Phase F′ implementation eventually wires the screen, it becomes a straightforward `<Image source={{uri: presentation.imageUrl}} />` plus a countdown driven by the *existing* `qr.expiresAt` API field (already BANHAO-owned, unchanged by this option).

---

## 7. Comparison table

| Criterion | Option A (generic QR) | Option B (broad union) | Option C (neutral + internal split) |
|---|---|---|---|
| Matches verified Stripe shape | Partial (unused SVG field, leaks `data`) | Partial (same QR issues; unjustified `REDIRECT`) | **Yes, exactly** |
| Leaks provider-internal data (`data`) | Risk (field present) | Risk (field present) | **No — excluded by design** |
| Speculative/unused variants | `imageUrlSvg` (RN doesn't need it) | `REDIRECT` (no BANHAO justification) | **None** |
| Future-provider extensibility | Weak (assumes every provider is QR) | Nominally strong, but the concrete variant offered isn't earned yet | Correctly strong — new variant added only when a real need exists |
| Expiry handling | Not addressed by the option itself | Not addressed by the option itself | Addressed explicitly — moved off this type, see §5.4 |
| Code churn to implement | Low | Low–Medium (dead variant to write and maintain) | Low |
| DB migration required | No | No | No |
| Customer UI change required today | None (nothing consumes it) | None | None |

---

## 8. Recommended option

```
RECOMMENDED OPTION: C — provider-neutral customer-facing contract
(imageUrl + optional hostedInstructionsUrl), with expiry moved out of
CreatePaymentResult entirely and left where it already, correctly, lives:
payment_attempts.expires_at, computed by BANHAO policy.
```

**Why**, against the brief's own nine criteria:

1. **Current BANHAO architecture** — matches the existing `payments/providers/` SDK-confinement rule (DEC-015) and DEC-055 clause 1 (no domain service may depend on Stripe types) by keeping `data` and any Stripe-specific field entirely inside the adapter.
2. **Actual Stripe PromptPay sandbox behavior** — an exact structural match to the verified `promptpay_display_qr_code` shape (§5), unlike Option A/B which retain fields (`data`, `imageUrlSvg`, `REDIRECT`) not earned by evidence.
3. **Current customer UI implementation** — irrelevant to the choice, since no UI consumes any option today (§4); Option C is simply the cleanest shape to eventually wire.
4. **Current payment-attempt lifecycle** — `payment_attempts.expires_at`/`qr_payload` (DB columns) need no change under any option; Option C is the only one that also fixes the *interface-level* mislabeling of expiry as provider data.
5. **Future provider abstraction** — Option C's field names are outcome-based (`imageUrl`), not Stripe-based, so they survive a hypothetical second QR provider unchanged; unlike Option B, it does not pre-commit to an unneeded `REDIRECT` variant.
6. **Minimum required code churn** — one interface (`CreatePaymentResult.presentation`), one service (`PaymentsService`'s two call sites building the DB insert payload), zero DTO/UI change today. Identical churn to Option A; strictly less risky than Option B (nothing to delete later).
7. **Avoiding provider leakage into generic payment processing** — `PaymentEventProcessingService` is untouched by any option (it never reads `presentation` at all — confirmed by trace, §3/§Phase2 code read); Option C additionally prevents leakage at the `CreatePaymentResult` boundary itself, which A and B do not.
8. **Avoiding unnecessary database migration** — all three options require **NOT REQUIRED**, confirmed in §9.
9. **Correct handling of payment expiry semantics** — Option C is the only option that explicitly resolves this; A and B leave it implicit and continue to risk the "looks like provider data, isn't" trap identified in §5.4.

---

## 9. Exact implementation delta (for the next task, NOT done here)

### Interface changes

- `apps/api/src/modules/payments/payment-provider.interface.ts` — `CreatePaymentResult.presentation`:
  - **Remove:** `type: 'QR_STRING'`, `value: string`, `expiresAt: string`.
  - **Add:** `type: 'QR_CODE'`, `imageUrl: string`, `hostedInstructionsUrl?: string`.

### API contract changes

- `packages/validation/src/payment.ts` — `PaymentInitiationResponse.qr`: **field name only**, `value` → `imageUrl` (or a deliberately chosen name at lock time — not decided by this recon), to stop implying a raw scannable string exists. `expiresAt` **stays** on this DTO unchanged — it is the already-BANHAO-owned expiry, sourced from `payment_attempts.expires_at`, not from the provider (§5.4). This is the one field where the *outward* API shape does NOT need to change, only its *internal source* (computed by `PaymentsService`, never copied from `CreatePaymentResult`).
- `apps/api/src/modules/payments/payments.service.ts` — `toResponse()`, `initializePayment()`, `regenerateAttempt()`: change the three call sites that currently read `result.presentation?.value` / `result.presentation?.expiresAt` to read `result.presentation?.imageUrl` and a locally-computed expiry constant respectively. No change to the guarded-`UPDATE`/idempotency/regeneration logic itself.
- `apps/api/src/modules/payments/providers/null-payment.provider.ts` — update to emit the new shape so the dev/test provider stays a faithful stand-in (see §10, Regression analysis).

### Customer UI changes

- **None required today**, confirmed by §4. When the Phase F′ screen is eventually wired to the real API (separate, future task, not this one): `apps/customer/src/screens/payment.tsx`'s `PromptPayQrScreen` would replace its static `📱` placeholder with `<Image source={{ uri: presentation.imageUrl }} />` and replace its hardcoded `QR_TTL_SECONDS = 600` local timer with the API's `qr.expiresAt` value. That wiring is out of scope for this recon and for the Decision Lock this document feeds.

### Database changes

```
REQUIRED: NOT REQUIRED
```

`payment_attempts.qr_payload text` already accepts any string, including a URL. `expires_at timestamptz` already accepts a BANHAO-computed timestamp and requires no reinterpretation — it was never populated from a provider field to begin with (§5.4). No column rename, no new column, no constraint change.

### Payment lifecycle documentation — wording that must be corrected

`docs/PAYMENT_LIFECYCLE.md`:
- Nothing in the reviewed sections (§0–§4, checked for `expires_at`/`EXPIRED`/`QR`) asserts a *Stripe-sourced* expiry — the existing "10 minutes" language already reads as a BANHAO/system policy (`| EXPIRED | ACCEPTED | PENDING_PAYMENT | System (10 min) |`, line 118), which is **already correct** and needs no wording change.
- No wording currently claims Stripe returns a raw QR string, a distinct `EXPIRED` PaymentIntent status, or that `payment.failed`/`payment_intent.failed` (vs. the verified `payment_intent.payment_failed`) is the failure event name — because this document predates any Stripe-specific claim being written into `PAYMENT_LIFECYCLE.md` at all. **No correction needed there**; the corrections belong in DEC-055 itself (§10 below), which is where the Stripe-specific claims actually live.

---

## 10. DEC-055 / Q-001 documentation delta

DEC-055 clause 12 currently reads (verbatim, `docs/DECISIONS.md:5759-5770`):

> **12. PromptPay QR presentation — NOT LOCKED.**
> ```
> PromptPay QR presentation mapping = OPEN / SANDBOX SPIKE REQUIRED
> ```
> Stripe's Direct API guide documents the Stripe.js client path (`stripe.confirmPromptPayPayment`) and only alludes to a non-Stripe.js path. The exact server-side `next_action` shape for PromptPay is **not confirmed**. Until a sandbox spike settles it, do **not** add the Stripe React Native SDK, add a publishable key, change customer UI, or assume either a QR image URL or a QR payload field.

**This clause is now answered by the sandbox spike and should be amended, not silently changed** (per this task's own instruction). Proposed addendum text for the Decision Lock to adopt or reject:

> **12. PromptPay QR presentation — RESOLVED by sandbox spike, 2026-09-08** (`docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md`).
> Verified live: `next_action.promptpay_display_qr_code` = `{ data, hosted_instructions_url, image_url_png, image_url_svg }`. No raw QR/EMV string exists; no `expires_at` exists anywhere in the PaymentIntent object graph. The customer-facing artifact is `image_url_png` (or `_svg`); `hosted_instructions_url` is a supplementary fallback; `data` is a Stripe-internal test-mode URL and must not be exposed to the customer app. Expiry remains entirely BANHAO-owned policy (unchanged from today's `NullPaymentProvider` behavior — see `docs/STRIPE_PRESENTATION_CONTRACT_RECON.md` §5.4). The Stripe React Native SDK and publishable key remain **not needed** — confirmed, not merely still-undecided — because BANHAO's flow never reaches a client-side Stripe.js/Elements confirm step (spike §7). Customer UI change is **still not authorized by this clause** — it authorizes only the presentation *contract* proposal in `docs/STRIPE_PRESENTATION_CONTRACT_RECON.md`, pending its own Decision Lock.

Also flagged, a refinement the brief specifically asked to surface rather than silently fold in: the earlier planning language elsewhere (none found verbatim inside DEC-055 itself, but implicit in any prior assumption of a Stripe-native "expired" concept) should be read against §5 of the sandbox spike: **Stripe has no distinct EXPIRED PaymentIntent status.** `payment_intent.payment_failed` (not `payment_intent.failed`) represents a failed/retryable PromptPay attempt (non-terminal — same PaymentIntent, retryable); `payment_intent.canceled` is the only true terminal non-success outcome, produced only by BANHAO explicitly calling `/cancel` on its own timeout policy — never by Stripe unilaterally. This is **consistent with, and does not require changing,** DEC-055 clause 7's existing event list (`payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` — already the correct three, already named correctly). No amendment needed there; clause 7 was already right. The only clause needing a documented amendment is **clause 12**, above.

---

## 11. Regression / compatibility analysis (Phase 6)

### `NullPaymentProvider`

**Would it still satisfy the proposed contract? No, not without a small, mechanical update — but this is expected and cheap.** `NullPaymentProvider.createPayment()` currently returns `{ type: 'QR_STRING', value: ..., expiresAt: ... }`; under Option C it would need to return `{ type: 'QR_CODE', imageUrl: ..., hostedInstructionsUrl: undefined }` and stop returning `expiresAt` at all (moving that computation to `PaymentsService`, per §5.4/§9). This is a **one-file, mechanical, same-shape-of-change** update — no behavioral change to what the null provider is *for* (a fake, clearly-labelled placeholder). Not implemented here per this task's scope.

### Existing tests

Classified by what they actually assert (grep-verified against real file contents, not inferred):

| Test file | What it encodes | Classification |
|---|---|---|
| `apps/api/src/modules/payments/payments.service.spec.ts` | Extensive direct assertions on `presentation.type === 'QR_STRING'`, `presentation.value`, `presentation.expiresAt`, and the resulting `qr: { value, expiresAt }` response shape (≈30+ matching lines) | **Must change** — every literal `QR_STRING`/`.value`/`presentation!.expiresAt` reference needs updating to the new field names once the interface changes |
| `apps/api/src/modules/payments/providers/null-payment.provider.ts`'s own describe blocks (inside `payments.service.spec.ts`'s fixtures, e.g. line 57-66 `'returns a QR_STRING presentation with an expiry roughly 10 minutes out'`) | Asserts the null provider's own `presentation.type`/`expiresAt` shape | **Must change**, same file as above |
| `apps/api/src/modules/payments/payments.controller.spec.ts` | No `QR_STRING`/`expiresAt`/`qr:` references found by grep — tests controller delegation to the service, not response shape | **Can remain** |
| `apps/api/src/modules/payments/payment-attempt-expiry.service.spec.ts` | Only asserts the DB query filters on `expires_at` (the column, unchanged) — no reference to `QR_STRING`/`presentation` | **Can remain** — this test is about `payment_attempts.expires_at` as a database column, which Option C does not touch |
| `apps/api/src/modules/payments/payment-event-processing.service.spec.ts` | No `QR_STRING`/`presentation` references found; this service never reads `presentation` in production code either (confirmed by reading `payment-event-processing.service.ts` in full — it only reads `raw_payload`, `amountSatang`, event types) | **Can remain** |
| `apps/api/src/modules/webhooks/webhooks.controller.spec.ts` | No `QR_STRING`/`expiresAt`/`CreatePaymentResult` references found | **Can remain** |
| `apps/customer/src/__tests__/payment-expiry.test.tsx` | Tests the screen's own **local** `QR_TTL_SECONDS = 600` countdown-to-`PayExpired` navigation — entirely client-side simulation, no API shape asserted | **Can remain unchanged** — this test exercises UI behavior that has no dependency on the provider contract at all (confirms §4's finding) |
| Rider/orders/dispatch specs matching `payment_attempts` | Grep hits are all incidental table-name references in unrelated fixtures (e.g. table lists), not shape assertions | **Can remain** |

**No test should be silently deleted.** The one file requiring real rewrites (`payments.service.spec.ts`) has its assertions tied directly to field names, not to business behavior — a mechanical find-and-replace-plus-review, not a redesign of the test's intent.

### Existing API consumers

Traced exhaustively in §3: **zero customer-app consumers**. The only "consumer" beyond the API's own test suite is `NullPaymentProvider` itself (a provider, not a consumer of the response) and any e2e test that calls the endpoint and inspects the JSON body directly — none was found asserting the customer-facing `qr.value` field outside `payments.service.spec.ts` (which tests the service layer directly, not the HTTP boundary — `payments.controller.spec.ts` does not assert response shape, per the table above).

### Backward compatibility

```
Recommended transition style: ADDITIVE / STAGED, not a hard breaking cutover in one commit.
```

Because there are no live consumers, a **breaking** rename (`value` → `imageUrl`, `type: 'QR_STRING'` → `type: 'QR_CODE'`) is safe to make directly — there is no external client depending on the old field name. However, staging it as its own isolated commit (interface + `NullPaymentProvider` + the one heavy test file, together, atomically) rather than bundling it with the eventual Stripe adapter itself is recommended, so the contract change and the Stripe integration can each be reviewed on their own terms — consistent with `NullPaymentProvider`'s existing role as "what Phases E through I are built and shipped against" (its own doc comment, `null-payment.provider.ts:48`). This is a recommendation for sequencing the **next** task, not something this recon performs.

---

## 12. Risks and unresolved questions

1. **`qr.stripe.com` image URL lifetime is NOT VERIFIED.** The sandbox spike did not test how long a PromptPay image URL remains resolvable after the underlying attempt fails or a new one is regenerated. This should be tested (or found in Stripe's own docs and cited) before the Stripe adapter implementation task, not assumed either way.
2. **Whether a remote-image component already exists in `packages/ui`** was not exhaustively confirmed in this recon (§4) — a quick check before implementation avoids either duplicating one or assuming RN's bare `<Image>` is sufficient without checking existing UI conventions (loading/error states, etc.).
3. **`billing_details[email]` requirement** (sandbox spike §2) needs a BANHAO-side decision on what email value the adapter supplies for a PromptPay confirm call (a synthetic/platform address, per the spike's own suggestion) — not decided by this recon, and not part of the presentation-contract question, but a real adjacent open item for the Stripe adapter task.
4. **DEC-055's own explicit non-decisions remain non-decisions**: Q-020 (refund mechanism), Q-002 (legal/settlement), and clause 9's `RefundResult.status`/`getRefundStatus` additions are untouched by this recon and must not be inferred as resolved by anything here.
5. **The payment-event starvation fix (DEC-055 clause 11)** and the **PromptPay sandbox spike (clause 12)** were both listed as prerequisites before Stripe production events are enabled. Git history (`4bd16189 fix: prevent payment event starvation`, `1e4c1b19 docs: record Stripe PromptPay sandbox spike`) shows **both appear to have already landed** as of this HEAD — but this recon does not re-verify the starvation fix's correctness or completeness, since it is outside this task's scope (presentation contract only). Flag for whoever runs the Decision Lock: confirm clause 11's fix is itself considered complete before treating both prerequisites as closed.

---

## 13. Conclusion

```
READY FOR DECISION LOCK: YES
```

This recon found:
- The current `CreatePaymentResult.presentation` contract is provably incompatible with real Stripe PromptPay behavior (sandbox-verified, not assumed).
- No live code path — customer app included — currently depends on the existing contract, so the redesign carries no customer-facing regression risk today.
- A concrete, minimal-churn replacement (Option C) that fixes the incompatibility, keeps expiry correctly BANHAO-owned (a `PaymentsService`-level policy value, not a provider-copied field), requires **no database migration**, and confines every genuinely Stripe-specific field to the provider adapter layer, consistent with DEC-015/DEC-055's unweakened abstraction requirement.
- An exact, file-level implementation delta (§9) and a precise DEC-055 documentation amendment (§10, clause 12 only) ready for Product Owner review at the next Decision Lock.

**Nothing in this document has been implemented.** `PaymentProvider`, `CreatePaymentResult`, `PaymentInitiationResponse`, `payments.service.ts`, `NullPaymentProvider`, the customer app, and the database schema are all exactly as they were at HEAD `1e4c1b19`. This is a proposal only.
