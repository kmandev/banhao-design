# Stripe Payment Presentation Contract — Follow-up Recon

**Status:** RECON ONLY. No production code, schema, DTO, or UI changed.
**Starting HEAD:** `e19cf40a1a445b19a9d66a0fae6c8e9b824b94aa`
**Continues:** `docs/STRIPE_PRESENTATION_CONTRACT_RECON.md` (previous recon, this branch), `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` (live Stripe test-mode evidence).
**New evidence source this round:** official Stripe API documentation (`docs.stripe.com/api/payment_intents/object`, `docs.stripe.com/payments/promptpay`), fetched read-only via web search/fetch — **no Stripe API call was made**, no secret was used, nothing was executed against `api.stripe.com`.

---

## 1. Executive summary

All three items the previous recon left open are now resolved by evidence, and the previous recommendation **stands, strengthened**:

1. **QR URL lifetime:** Stripe's own API reference **does not document an `expires_at` field for `promptpay_display_qr_code`** — confirmed twice now, independently: once by the sandbox spike's exhaustive live-object key search, and now again by the official schema documentation itself. Tellingly, Stripe's schema **does** document `expires_at` for structurally similar QR objects (`pix_display_qr_code.expires_at`, `cashapp_...qr_code.expires_at`, `upi_...qr_code.expires_at`) — so PromptPay's omission is a **deliberate absence in the API design**, not a documentation gap. No TTL is documented or inferable. Per the brief's own instruction: **Stripe does not provide a documented durability guarantee that BANHAO can rely upon.**
2. **UI capability:** BANHAO does **not** have a dedicated reusable remote-image/QR component in `packages/ui`, but it does have **working, tested, production prior art** one screen away: `apps/customer/src/screens/OrderDetailScreen.tsx` already renders a provider-hosted remote image (a proof-of-delivery photo from private R2 storage) via React Native's plain `<Image source={{uri}}>`, with an `onError` fallback state and a full-screen modal viewer. No SVG rendering library, no WebView, and no deep-link/browser-opening capability (`expo-web-browser`, `react-native-webview`, `expo-linking`) exist anywhere in the repo.
3. **`billing_details[email]` source:** **Confirmed — BANHAO has no customer email anywhere in its runtime today**, not a partial or nullable one. Auth is phone-OTP only; `profiles` has no `email` column; `AuthenticatedUser` (every service's view of the caller) carries only `id`/`phone`/`capabilities`; even the raw JWT `email` claim, parsed once at the token-verification layer, is discarded before it reaches any request-scoped object. A **new finding** sharpens this considerably: official Stripe docs state refunds are requested by **emailing the customer at the address given at PaymentIntent confirmation** — meaning whatever email BANHAO supplies for `billing_details[email]` today is the *same* field Stripe will later use to contact the customer for refund bank details (Q-020). A synthetic/platform placeholder satisfies confirmation now, but would silently misdirect refund correspondence later — see §7.3 and §11.

**Presentation contract: CONFIRMED, unchanged from the previous recon.** `{ type: 'QR_CODE', imageUrl, hostedInstructionsUrl? }`, PNG preferred, `data` kept adapter-internal, `expiresAt` kept off this type. See §4/§8.

**Expiry ownership: RECONFIRMED.** `qr.expiresAt` in `PaymentInitiationResponse` is, today, a value computed and written entirely by BANHAO's own code (`PaymentsService`, sourced from `NullPaymentProvider`'s own constant) into `payment_attempts.expires_at` — never copied from any provider field. See §9.

**READY FOR DECISION LOCK: YES.** See §12.

---

## 2. Stripe QR URL findings

Re-verified against both evidence sources, cross-checked against each other:

| Field | Sandbox spike (live test-mode capture) | Official API reference (`docs.stripe.com/api/payment_intents/object`) | Agreement |
|---|---|---|---|
| `data` | `"https://payments.stripe.com/payment_methods/test_payment?payment_attempt=payatt_..."` (a URL, in test mode) | *"The raw data string used to generate QR code, it should be used together with QR code library."* | **Partial — see §2.1, a genuine open nuance** |
| `hosted_instructions_url` | `"https://payments.stripe.com/promptpay/instructions/..."` | *"The URL to the hosted PromptPay instructions page, which allows customers to view the PromptPay QR code."* | Agree |
| `image_url_png` | `"https://qr.stripe.com/test_....png"` | *"The PNG path used to render the QR code, can be used as the source in an HTML img tag"* | Agree |
| `image_url_svg` | `"https://qr.stripe.com/test_....svg"` | *"The SVG path used to render the QR code, can be used as the source in an HTML img tag"* | Agree |
| `expires_at` | **Absent** — exhaustive `jq 'paths'` search found zero matches on the whole PaymentIntent object graph | **Not a documented field of `promptpay_display_qr_code`** (absent from the schema entirely — contrast with `pix_display_qr_code.expires_at`, `cashapp_...qr_code.expires_at`, `upi_...qr_code.expires_at`, all of which the same schema *does* document) | **Agree, and now doubly confirmed** |

### 2.1 A genuine nuance on `data` — flagged, not resolved

The official schema's generic description of `data` ("raw data string used to generate QR code... together with QR code library") is the **same wording Stripe uses for `paynow_display_qr_code.data` and `pix_display_qr_code.data`** — payment methods where `data` plausibly *is* a real scannable payload (e.g. an EMV QR string) that a client-side QR-rendering library could turn into a code. The sandbox spike's live **test-mode** capture, however, showed `data` as a `payments.stripe.com` diagnostic/test-payment URL, not an EMV-style payload.

**This is not resolved by either evidence source alone**, and this recon does not resolve it either — it is flagged, not guessed at, per the brief's own instruction not to assume anything unsupported by evidence:

- It is plausible that Stripe substitutes a test-mode-only diagnostic URL for `data` where live mode would return a genuine raw payload string, consistent with how Stripe's test-mode PromptPay flow generally substitutes a simulation page for real bank interaction.
- It is equally possible `data` is *always* a Stripe-hosted URL for PromptPay specifically (unlike PayNow/Pix), and the generic per-field description is simply reused boilerplate across all `*_display_qr_code` types regardless of what each actually returns.
- **No live-mode PromptPay PaymentIntent was created by this recon or the prior sandbox spike** (per the hard "no production Stripe calls" constraint, correctly respected in both), so this cannot be settled without either a live-mode-adjacent test or a more specific Stripe documentation page than what was found.

**This does not change the recommendation** (§8): whether or not `data` is a real EMV payload in live mode, exposing it would require BANHAO to adopt a client-side QR-rendering library it does not have (§6), for zero benefit over simply displaying `image_url_png`, which Stripe has already rendered. It remains adapter-internal-only, unless a concrete future reason emerges — logged here as a risk to revisit once live mode is exercised (§11), not as something blocking this Decision Lock.

### A. URL lifetime

**Stripe does not provide a documented durability guarantee that BANHAO can rely upon.** No TTL is documented for `image_url_png`/`image_url_svg`/`hosted_instructions_url`, and no field ties their validity to PaymentIntent state transitions. The sandbox spike additionally established (§4-5 of the spike) that a failed PromptPay *attempt* does **not** cancel or invalidate the parent PaymentIntent — it returns to `requires_payment_method` and is retryable — which independently suggests Stripe has no reason to invalidate a previously-issued QR image on attempt failure either, but **this is inference, not a documented guarantee, and must not be treated as one.**

**A separate, directly relevant finding** from `docs.stripe.com/payments/promptpay` (official docs, "Repeated payments" section), quoted verbatim:

> "After a customer successfully completes a transaction, any attempt to use the same QR code again can result in having the funds deducted from their bank account."

This is significant: it confirms Stripe's PromptPay QR **is not automatically invalidated even after a successful payment** — reusability is a known risk Stripe itself documents, and the *customer-facing* protection against a duplicate charge is explicitly BANHAO's own responsibility (stop showing the QR once payment succeeds or the attempt window elapses), not something Stripe's URL lifetime does for BANHAO. This directly reinforces — with new, independent evidence — why `payment_attempts.expires_at` must remain a real, BANHAO-enforced, UI-facing timeout (§9), not a cosmetic countdown: the QR image itself may remain live-linkable well past the point BANHAO wants it acted on.

### B. URL accessibility

The official field descriptions for `image_url_png`/`image_url_svg` state explicitly: *"can be used as the source in an HTML img tag."* This is web/browser-oriented wording, and Stripe's documentation does not separately confirm mobile-native rendering. However, this is not a meaningful barrier: both fields are plain `https://` URLs serving a standard image content type — React Native's `<Image source={{ uri }} />` fetches and renders any such URL, exactly as `OrderDetailScreen.tsx`'s existing proof-of-delivery viewer already does today against a different (R2) HTTPS image URL (§6). **Not separately Stripe-verified for RN specifically, but not a cross-platform assumption either** — it follows from RN's own documented `Image` behavior (any HTTP(S) URI) plus the general web-image nature of the URL, not from anything Stripe-specific.

`hosted_instructions_url` is explicitly a **page** ("hosted PromptPay instructions page, which allows customers to view the PromptPay QR code") — meant to be opened in a browser/webview, not embedded as an image source. BANHAO has no browser/webview/deep-link capability today (§6), so this field cannot currently be *rendered in-app* even as a fallback — only opened externally, which itself requires a capability BANHAO does not yet have.

### C. PNG vs SVG

**Recommend PNG (`image_url_png`).** Grounded in concrete, evidence-checked constraints, not general preference:

- **React Native compatibility:** RN's built-in `<Image>` component renders raster formats (PNG, JPEG, WebP, GIF) natively. It does **not** render SVG without an additional library.
- **Existing dependency check (this recon):** `packages/ui/package.json` and `apps/customer/package.json` were checked directly — **no SVG rendering library (`react-native-svg` or equivalent) is a dependency anywhere in this repo.** Choosing SVG would require adding a new dependency; choosing PNG requires none.
- **Reliability/simplicity:** PNG is a fixed raster image — no client-side parsing or rendering-engine variance. SVG, while theoretically sharper at scale, buys BANHAO nothing here: a QR code is inherently a fixed-size grid of squares, not typography or vector art that benefits from infinite scaling.
- **Security:** no material difference between the two — both are Stripe-hosted, unauthenticated-to-view URLs.
- **Stripe support:** both are equally supported and equally documented by Stripe; this is purely a BANHAO-side rendering-capability decision, not a Stripe limitation.

### D. Hosted instructions URL — role

**Supplementary/fallback, not primary, and not currently renderable in-app at all.** Its official description ("allows customers to view the PromptPay QR code") means it is a **complete alternative display surface** for the same QR (a full page, not merely text instructions) — so conceptually it is a legitimate fallback if image rendering fails. But practically, today, BANHAO has **no mechanism to open it** (§6: no WebView, no `expo-web-browser`, no `Linking`/`expo-linking` dependency exists in the app). Recommendation: keep `hostedInstructionsUrl` as an **optional field on the contract** (cheap to carry, zero cost if unused) but do not treat it as an implementable fallback path in the *current* app without first adding a browser-opening capability — a separate, small, future decision, not something this contract change should quietly presume is already possible.

---

## 3. Existing BANHAO UI capability (Phase 2)

Full inspection of `packages/ui` and `apps/customer`, reported per component/library as instructed:

| Path | Component/library | Capability | Limitations | Reusable as-is? |
|---|---|---|---|---|
| `apps/customer/src/screens/OrderDetailScreen.tsx:249-256, 303-310` | React Native's built-in `Image`, used inline (not wrapped) | Renders a remote HTTPS image (`source={{ uri: proof.photoUrl }}`) as a thumbnail (`Pressable` → opens) and again full-screen in a `Modal`; has an `onError` handler flipping local `photoLoadFailed` state to a text fallback (`"โหลดรูปไม่สำเร็จ"`) | **Not extracted into `packages/ui`** — it is screen-local code, would need copying or extraction to reuse for the QR image directly; RN's `Image`, not `Image` from `expo-image` (no `expo-image` dependency found) | **Pattern reusable, code is not yet a shared component** |
| `packages/ui/src/components/primitives.tsx` | `Card`, `Badge`, `Avatar`, `Input`, `Stepper`, `SectionHeader`, `PriceRow`, `BottomBar` | General-purpose layout/typography primitives, already used by `payment.tsx`'s existing screens (`Card`, `PriceRow`, `BottomBar`, `SectionHeader`) | No image, no remote-content, no loading/error-state component among them | N/A — none of these render images |
| `packages/ui/src/components/domain.tsx` | `ShopCard`, `MenuRow`, `CategoryChip`, `ListRow`, `CheckMark`, `StateView`, `StatusTimeline` | `StateView` (already used by `payment.tsx` for `loading`/`error`/`success`/`info` states) is the closest existing "state" abstraction, but is text/glyph-based (`kind`, `glyph`, `title`, `message`), not image-based | No remote-image variant of `StateView`; would need a new prop or a new component to show an image inside this pattern | Its state-kind *pattern* is reusable conceptually; the component itself does not render images |
| `packages/ui/package.json` | (dependencies) | — | **No** `react-native-svg`, **no** `expo-image`, **no** QR-rendering library (`qrcode`, `react-native-qrcode-svg`, or similar) declared anywhere | N/A — confirmed absent |
| `apps/customer/package.json` | (dependencies) | — | **No** `react-native-webview`, **no** `expo-web-browser`, **no** `expo-linking` declared anywhere (grep-confirmed) | N/A — confirmed absent |
| *(repo-wide grep)* | `WebView`, `Linking` | — | Zero matches anywhere in `packages/ui/src` or `apps/customer/src` | N/A — no capability exists |
| *(repo-wide grep)* | any QR-code library import/reference | — | Zero matches | N/A — no capability exists |

**Direct answer to the phase's question:** *Does BANHAO already have everything required to display a provider-hosted QR image URL?*

**Mostly yes, for the PNG-image path specifically — no, for the hosted-URL fallback path.** Rendering `image_url_png` requires nothing BANHAO doesn't already have: RN's built-in `Image` component, and a proven, working, tested pattern for exactly this shape of problem (remote-URI image + `onError` fallback + full-screen viewer) already exists in production code (`OrderDetailScreen.tsx`). It is not packaged as a reusable `packages/ui` component today, so implementation would either copy the pattern or take the (small, one-time) step of extracting it — a decision for the implementation task, not this recon. Rendering `hosted_instructions_url` as an actual fallback UI, by contrast, would require adding a genuinely new capability (WebView or an external-browser opener) that does not exist in this repo at all today. **No capability gap blocks the recommended contract** (§4/§8) — the gap only exists for a fallback path this recon does not recommend building yet.

---

## 4. Customer email trace (Phase 3)

Traced exhaustively, file and column level, per the brief's explicit instruction not to assume auth-layer availability implies service-layer availability.

### A. Is email already available? — **No.**

The full chain:

1. **Supabase Auth (`auth.users`)** — Supabase's built-in table *has* an `email` column, but BANHAO's signup path is **phone-OTP only** (CLAUDE.md §5, confirmed by the live-verified flow in EVENT-011/§8). Nothing in this repository ever writes `auth.users.email` — there is no email/password or social-login signup path implemented (packages/validation/src/auth.ts's own comment: *"These schemas are shaped so email/password and social login can be added [later]"* — i.e., not today).
2. **`handle_new_user()` trigger** (`supabase/migrations/20260809000002_profiles_and_roles.sql:56-68`) — copies **only** `new.phone` from `auth.users` into `public.profiles` on signup:
   ```sql
   insert into public.profiles (id, phone)
   values (new.id, new.phone)
   on conflict (id) do nothing;
   ```
   `email` is not read, not copied, not mentioned. This is a **deliberate, structural** absence, not an oversight — the trigger explicitly names the one field (`phone`) it propagates.
3. **`profiles` table schema** (`supabase/migrations/20260809000002_profiles_and_roles.sql:12-19`) — columns are `id`, `role`, `phone`, `display_name`, `created_at`, `updated_at`. **No `email` column exists.**
4. **JWT verification layer** (`apps/api/src/supabase/supabase.service.ts:6-11, 96-120`) — `SupabaseJwtClaims` **does** parse an `email` field off the verified access token (`payload.email`), because Supabase's JWT format always carries that claim key when `auth.users.email` is set. **But `auth.users.email` is never set by anything in this codebase (point 1)**, so in practice this claim would be `undefined` for every real BANHAO user today.
5. **`SupabaseAuthGuard`** (`apps/api/src/common/guards/supabase-auth.guard.ts:60-84`) — builds the request-scoped `AuthenticatedUser` from the **`profiles` row**, not from the JWT claims object at all: `phone: profile.phone`. **The parsed `claims.email` value is never read here or anywhere else — it is computed and immediately discarded.**
6. **`AuthenticatedUser`** (`apps/api/src/common/types.ts:66-70`) — the type every controller/service receives for "who is calling":
   ```ts
   export interface AuthenticatedUser {
     id: string;
     phone: string | null;
     capabilities: ActorCapabilities;
   }
   ```
   **No `email` field exists on this type at all.**
7. **Order creation / checkout DTOs, `packages/validation/src/payment.ts`, customer-app checkout screens** — repo-wide grep for `email` across `apps/api/src`, `apps/customer/src`, `supabase/migrations`, `packages/validation/src`, and `packages/types` (if present) returns exactly **three** files, all already accounted for above (`supabase.service.ts`, its own spec, and `auth.ts`'s comment about a *future* email/password path) — **zero** hits in any order, checkout, or payment DTO/screen.

**Conclusion: BANHAO holds no customer email anywhere in its runtime, authoritative or otherwise, today.** This is stronger than "not yet wired to payments" — it does not exist in the identity model at all.

### B. Is email persisted in customer profile? — **No — the column does not exist.**

Not "nullable-but-unpopulated" — there is no `profiles.email` column in the schema (§4.A.3). Nullability, verification status, and default-availability questions are moot because the field itself was never added.

### C. Is email available during payment confirmation? — **No**, confirmed by tracing the actual runtime path, not assumed from the auth layer.

`PaymentsService.createPayment(user: AuthenticatedUser, orderId: string)` (`payments.service.ts:121`) receives exactly the `AuthenticatedUser` shape from §4.A.6 — `id`, `phone`, `capabilities`. There is no code path, in this service or anywhere upstream of it (`PaymentsController`, `SupabaseAuthGuard`, `orders` table reads), by which an email value could reach the point where a Stripe adapter's `confirm` call would need to supply `billing_details[email]`. This directly validates the brief's own caution: **the auth layer touching `email` at all (point 4 above) does not mean the payment service can access it** — it provably cannot, today.

### D. If email is missing — classification

```
Small API/domain change required — for confirmation only, under a synthetic/platform email.
Larger identity/profile change required — if a real customer email is ever needed
  for anything beyond confirmation (see the refund linkage below).
```

**For PromptPay confirmation alone** (the only thing DEC-055/Q-001 currently authorizes — refunds are explicitly out of scope, Q-020 `OPEN`): a **synthetic/platform-owned email** (e.g., a fixed `payments@banhao...`-style address, or one deterministically derived from the order/payment reference) is sufficient. The sandbox spike already confirmed Stripe test mode does not validate deliverability (spike §7); this recon did not re-verify that for live mode (correctly, since doing so would require a production-adjacent call outside this task's scope) — **NOT VERIFIED for live mode**, carried forward unchanged from the prior recon. Supplying this is entirely **adapter-internal** work (`payments/providers/stripe/*`), touching no identity model, no `profiles` schema, no `AuthenticatedUser` type. This is why the classification is "small" and confined to the adapter layer, not the domain.

**A new, more consequential finding changes the shape of what "larger" would mean, though — see §7.3 and §11**: official Stripe documentation (`docs.stripe.com/payments/promptpay`, "Refunds" section) states verbatim:

> "Stripe automatically contacts the customer at the email address provided at time of PaymentIntent confirmation and requests refund account information from them."

This means **the `billing_details[email]` value supplied for confirmation is not a throwaway parameter — it is the exact address Stripe will later use to ask the customer for refund bank details**, if/when Q-020 resolves toward using Stripe's own refund flow. Using a synthetic/platform email today would work for confirmation, but would mean **Stripe's refund-request emails go to BANHAO, never to the customer** — silently breaking that specific refund mechanism, not merely leaving it undecided. This is a genuine forward-looking risk this recon surfaces but does not resolve (Q-020 remains `OPEN`, untouched by this task) — flagged explicitly so the eventual Q-020 Decision Lock is made with this linkage known, rather than discovered later.

---

## 5. Re-evaluation of the presentation contract (Phase 4)

### Does the previous recommendation remain valid? — **Yes, unchanged.**

```ts
{
  type: 'QR_CODE';
  imageUrl: string;
  hostedInstructionsUrl?: string;
}
```

Re-evaluated against the three options the brief specifies:

**Option 1** (as above) — **confirmed as the recommendation.** Everything newly verified this round reinforces it: `expires_at`'s absence is now doubly confirmed (not just observed once, but structurally absent from Stripe's own schema, in deliberate contrast to sibling QR types that do have it); PNG-over-SVG is now backed by a concrete dependency check (§3), not just general RN knowledge; `data` remains excluded, now with an explicitly named open nuance (§2.1) rather than a flat assumption.

**Option 2** (`imageUrlPng?` + `imageUrlSvg?` both optional) — **still not recommended.** No SVG rendering capability exists anywhere in the repo (§3), so carrying an `imageUrlSvg` field the app cannot render is dead weight — exactly the "unused field" criticism the first recon already leveled at Option A there. Nothing discovered this round creates a reason to carry both.

**Option 3** (fully provider-neutral, Stripe URLs converted into a BANHAO-owned representation — e.g., BANHAO downloading/re-hosting the QR image itself) — **not recommended; no concrete architectural benefit found.** This would mean BANHAO fetching Stripe's image server-side and re-serving it (through Supabase Storage/R2, the existing pattern `OrderDetailScreen.tsx`'s POD flow already uses for a *different* asset) — solving a durability problem that is not confirmed to exist for the length of time it would matter (§5.1 below) at the cost of a new server-side fetch-and-store step, a new storage cost, and new latency on every QR issuance/regeneration. The brief's own instruction — "Only propose this if there is a concrete architectural benefit... Do not over-engineer" — is decisive here: no such benefit was found.

### Important question — URL durability vs. the short-lived payment-attempt lifecycle

Directly addressed, using BANHAO's actual lifecycle (`PENDING_PAYMENT → payment attempt created → customer displays QR → customer completes payment → payment succeeds/fails`, traced against `payments.service.ts` and `payment-attempt-expiry.service.ts`):

- A `payment_attempts` row's `qr_payload`/image reference is only ever **displayed** during the active 10-minute window BANHAO itself enforces (`SIMULATED_QR_TTL_MS`, soon a Stripe-adapter equivalent constant) — after that, `PaymentAttemptExpiryService`'s tick-driven expiry moves the attempt to `EXPIRED` and `PaymentsService.regenerateAttempt` (on the next customer-initiated retry) creates a **new** attempt with a **new** `imageUrl` from a **fresh** Stripe `confirm` call. The **old** URL is never read again by BANHAO's own code once an attempt is superseded — `resumePayment`'s `PENDING`/`PROCESSING` branch returns the *current* attempt's stored URL; `regenerateAttempt` never re-reads an old one.
- **Conclusion, stated as the brief requires: `imageUrl` does not need to be a permanent asset URL.** It only needs to remain valid for the duration BANHAO itself controls and enforces (the active attempt's window) — a window measured in minutes, decided entirely by BANHAO's own policy, independent of whatever Stripe's actual (undocumented) URL lifetime turns out to be.
- **This must be documented as an explicit assumption/constraint**, per the brief's own instruction, precisely because §2/§2.A found no Stripe-side guarantee to lean on instead: *BANHAO's short display window is the only reason a possibly-ephemeral Stripe URL is safe to use directly — if that window is ever lengthened materially (e.g., a "resume this payment tomorrow" feature), this assumption would need re-verification, not just re-assertion.*
- **Not a storage/CDN problem**, consistent with the brief's explicit instruction not to turn this into one: no evidence found in either sandbox spike or official docs suggests the URL is unavailable within a short window, and manufacturing a re-hosting pipeline (Option 3) to guard against an undocumented, unconfirmed, and — given the short display window — probably irrelevant risk would be speculative engineering the evidence does not support.

---

## 6. Expiry ownership confirmation (Phase 5)

Re-inspected directly (not re-derived from memory of the previous recon):

- **`payment-attempt-expiry.service.ts`** — its own class doc comment states plainly: *"A `payment_attempts` row carries its own `expires_at` (set at creation — 10 minutes, `payments.service.ts`)"* — i.e., the service's own documentation already names `payments.service.ts` as the place `expires_at` is set, not any provider.
- **`payments.service.ts`** — `initializePayment` (line 476-487) and `regenerateAttempt` (line 354-364) both write `expires_at: result.presentation?.expiresAt ?? null` into the `payment_attempts` insert — today reading that value from `CreatePaymentResult.presentation.expiresAt`, which (per the prior recon's §5.4, re-confirmed here) is itself computed **inside `NullPaymentProvider`** from a hardcoded `SIMULATED_QR_TTL_MS = 10 * 60 * 1000` constant — never from any external/provider-reported field, because no real provider is wired yet.
- **`payment_attempts` schema** (`supabase/migrations/20260811000006_payment_domain.sql:109`) — `expires_at timestamptz` is a plain, unconstrained nullable timestamp column. Nothing in the schema itself asserts where the value comes from; that is entirely an application-layer decision, confirmed to currently be BANHAO's own.
- **API response** — `PaymentsService.toResponse()` (line 496-508) reads `attempt.expires_at` straight off the `payment_attempts` row into `PaymentInitiationResponse.qr.expiresAt`. This is a **database-column-to-API-field** mapping, not a **provider-field-to-API-field** mapping.

**Direct answer: yes — `qr.expiresAt` is, today, actually a BANHAO-owned timer, stated clearly as instructed.** The separation the previous recon recommended (drop `expiresAt` from `CreatePaymentResult.presentation`, keep `payment_attempts.expires_at`/`PaymentInitiationResponse.qr.expiresAt` computed by `PaymentsService` itself rather than copied from the provider) **remains correct after this follow-up** — nothing newly found contradicts it, and §2.A's new evidence (Stripe's own QR-reusability warning) actively reinforces why BANHAO must keep enforcing this window itself rather than relying on any provider signal. Nothing was modified to arrive at this conclusion.

---

## 7. DEC-055 impact (Phase 6)

Reviewed against all four named documents. No document was edited — findings only, per this phase's explicit instruction.

### 7.1 Confirms the previously-identified clause 12 amendment (no change to that proposal)

The previous recon's proposed clause 12 addendum (`docs/STRIPE_PRESENTATION_CONTRACT_RECON.md` §10) remains accurate and is **further corroborated**, not superseded, by this round's official-documentation evidence. No revision to that proposed text is needed.

### 7.2 The five/six numbered points, re-checked against this round's evidence

1. *"Stripe PromptPay has no distinct EXPIRED state."* — unchanged; not re-tested this round (would require a live call), but nothing found contradicts it, and the schema-level absence of `promptpay_display_qr_code.expires_at` (§2) is independently consistent with Stripe not modeling PromptPay expiry as PaymentIntent-level state.
2. *"`payment_intent.payment_failed` is a failed attempt."* — unchanged, sandbox-verified previously, not re-tested this round (no new evidence needed or sought).
3. *"`payment_intent.canceled` represents explicit cancellation."* — unchanged, same basis.
4. *"BANHAO owns its own payment-attempt expiry semantics."* — **reconfirmed directly by code re-inspection this round** (§6), and additionally reinforced by the new "repeated payments" evidence (§2.A) showing Stripe does not protect against QR reuse either — strengthening, not just repeating, the case for this ownership.
5. *"Stripe PromptPay presentation is image/hosted-URL based, not raw QR-string based."* — **reconfirmed by official schema documentation**, independent of the sandbox spike's live capture — two independent sources now agree.
6. *"Stripe `data` should remain adapter-internal unless a concrete reason emerges."* — **reconfirmed, with a new, explicitly-flagged nuance** (§2.1): the field's generic schema description leaves open whether `data` might be a genuine QR payload in live mode (unlike the test-mode URL observed), which is exactly the kind of "concrete reason" clause 6 anticipates might someday emerge — but has **not** emerged yet, since live mode has not been (and per scope, could not be) exercised. Recommend this specific nuance be carried into the eventual Decision Lock discussion as a named follow-up item, not silently dropped.

### 7.3 A new item this round surfaces for the Decision Lock's attention

DEC-055's own "Explicit non-decisions" section already states: *"Stripe's PromptPay refunds require the customer to supply bank details by email, which is a product decision that remains open."* This round's official-documentation research **sharpens, without contradicting,** that existing flag: it identifies the *exact mechanism* — Stripe emails the customer at **the same address given for `billing_details[email]` at confirmation time** (§4.D). This is not a new open question and does not require a new DEC-055 clause; it is evidence that would usefully sharpen the *existing* Q-020 non-decision's own eventual write-up, connecting it explicitly to whatever confirmation-time email value the Stripe adapter ends up using. Recommend surfacing this connection explicitly whenever Q-020 itself reaches its own Decision Lock — not something this presentation-contract recon should resolve or force a decision on now.

---

## 8. Final recommendation (Phase 7)

### 1. QR image source

```
RECOMMENDATION: PNG (image_url_png)
```

Because BANHAO's app has zero SVG-rendering capability and would need a new dependency to gain one (§3), while RN's built-in `Image` already renders PNG with no new dependency and an already-proven working pattern exists for exactly this shape of problem (`OrderDetailScreen.tsx`'s POD viewer). `hosted_instructions_url` is recommended only as an optional, carried-but-not-yet-implementable fallback field (§2.D) — not as the primary source, since BANHAO cannot currently render or open it.

### 2. URL durability

**Known:** Stripe documents no TTL/expiration for `promptpay_display_qr_code`'s image or hosted-instructions URLs (confirmed by two independent evidence sources — live sandbox capture and official schema documentation). Stripe explicitly warns the same QR can be reused even after a successful payment, meaning Stripe itself does not treat these URLs (or the underlying QR) as single-use or short-lived by design.
**Unknown:** any actual expiration timeline, whether tied to PaymentIntent status changes, and whether `data` behaves identically in live mode to the test-mode diagnostic URL observed.
**Practical conclusion:** none of this is a blocker, because BANHAO's own short (10-minute-class) display window, which BANHAO already enforces independently of Stripe (§6), is the operative constraint — not Stripe's undocumented URL lifetime. This must remain a documented assumption, not a forgotten implementation detail, should the display window ever be lengthened.

### 3. Customer email

**Authoritative source: none exists today.** BANHAO's identity model (phone-OTP auth, `profiles` schema, `AuthenticatedUser` type) carries no email anywhere, at any layer, confirmed by full trace (§4). **Change needed: a small, adapter-internal one** — a synthetic/platform email supplied only inside the future Stripe adapter, sufficient for PromptPay confirmation and not requiring any identity/profile/schema change. **Separately flagged, not decided:** if Stripe-mediated refunds (Q-020) are ever adopted, the *same* email field becomes load-bearing for reaching the actual customer, which a synthetic address would defeat — a larger identity/profile question for that future decision, explicitly not this one.

### 4. Presentation contract

```
CONFIRMED, UNCHANGED:
{ type: 'QR_CODE'; imageUrl: string; hostedInstructionsUrl?: string }
```

### 5. Expiry

```
CONFIRMED:
Provider presentation (CreatePaymentResult.presentation) = no expiresAt.
BANHAO payment_attempts.expires_at = BANHAO-owned, already true today
  (NullPaymentProvider's own constant, not a copied provider field),
  and now additionally reinforced by Stripe's own "QR is reusable,
  not self-expiring" documentation.
```

No reason found to change this.

---

## 9. Files inspected this round (in addition to those already listed in the previous recon report)

`apps/customer/src/screens/OrderDetailScreen.tsx` (full remote-image/POD-viewer pattern), `packages/ui/package.json`, `apps/customer/package.json` (dependency checks), `packages/ui/src/components/primitives.tsx`, `packages/ui/src/components/domain.tsx` (export lists), `supabase/migrations/20260809000002_profiles_and_roles.sql` (profiles schema + `handle_new_user()` trigger, full), `apps/api/src/common/types.ts` (`AuthenticatedUser`, `ActorCapabilities`), `apps/api/src/supabase/supabase.service.ts` (JWT claims parsing), `apps/api/src/common/guards/supabase-auth.guard.ts` (claims → `AuthenticatedUser` construction), `packages/validation/src/auth.ts` (comment only), plus official Stripe documentation: `docs.stripe.com/api/payment_intents/object` (full `next_action` schema, all `*_display_qr_code` variants), `docs.stripe.com/payments/promptpay` (payment flow, refunds, repeated-payments sections).

---

## 10. Risks and unresolved questions

Carried forward from the previous recon, updated with this round's findings:

1. **`data`'s live-mode shape is genuinely unresolved** (§2.1) — new this round, not previously flagged. Not a blocker; flagged for whenever live mode is first exercised.
2. **`qr.stripe.com`/`payments.stripe.com` URL lifetime remains formally unverified** (§2, §5) — downgraded from "open question" to "documented non-issue given BANHAO's own short display window," but the underlying fact (no Stripe guarantee exists) is unchanged from the previous recon.
3. **A reusable `packages/ui` image/QR component does not exist** — a proven pattern does (§3), so this is an implementation-task item (extract or duplicate), not a recon blocker.
4. **No browser/WebView/deep-link capability exists** — `hostedInstructionsUrl` can be carried in the contract today but cannot be rendered as a working fallback until a separate, small capability is added; this recon does not recommend adding it now, only naming the gap.
5. **The refund-email linkage (§4.D, §7.3) is new and consequential** — not a blocker for *this* Decision Lock (which is about the presentation contract, not refunds), but should be carried explicitly into whichever future Decision Lock resolves Q-020, so a synthetic confirmation-time email doesn't quietly become the reason Stripe-mediated refunds don't reach real customers.
6. **`billing_details[email]`'s exact supplied value (which synthetic/platform address, if any) is not decided by this recon** — correctly, since deciding it is an implementation detail of the (not-yet-authorized) Stripe adapter, not a presentation-contract question.

---

## 11. Decision Lock readiness

```
READY FOR DECISION LOCK: YES
```

Every item the previous recon left open — QR URL lifetime/reliability, existing UI capability, and the source of `billing_details[email]` — has now been investigated with concrete evidence (official Stripe documentation cross-checked against the sandbox spike's live capture, and a full code-level trace of BANHAO's identity model) rather than left as an assumption. None of the findings change the previously recommended contract; all of them either confirm it more strongly or add a clearly-labeled, non-blocking nuance for a future task to pick up (§10). Nothing in this document has been implemented — `PaymentProvider`, `CreatePaymentResult`, `PaymentInitiationResponse`, `payments.service.ts`, `profiles`, `AuthenticatedUser`, the customer app, and the database schema are all exactly as they were at HEAD `e19cf40a1a445b19a9d66a0fae6c8e9b824b94aa`.
