# Stripe Customer Email Source — RECON

**Status:** RECON ONLY. No source, schema, migration, auth, DTO, UI or decision document changed.
**Starting HEAD:** `88cb4750d10ec5fca89c8a863f35b9785567ae82`
**Blocks:** the Stripe `PaymentProvider` adapter — `STRIPE ADAPTER STATUS: NOT IMPLEMENTED`.
**Relates to:** DEC-055 Addendum A-9 (`docs/DECISIONS.md`), which recorded this as an open implementation dependency and deliberately refused to settle it.

Every finding below is proven from the repository at this HEAD, with file and line. Nothing is inferred from the earlier recons without re-verification, and nothing is inferred from Stripe behaviour that the committed sandbox evidence does not actually show.

---

## 1. Executive summary

BANHAO has **no customer email anywhere** — not empty, not nullable, **absent by construction**. Authentication is phone-OTP (`signInWithOtp({ phone })`), the `on_auth_user_created` trigger copies only `phone`, `profiles` has no `email` column, `AuthenticatedUser` carries none, and the one place an email is parsed (the JWT claim) discards it before any service can see it. No application table in any of the 26 migrations has an email address column.

Stripe PromptPay confirmation requires `billing_details[email]` server-side — proven by a real HTTP 400 captured in the sandbox spike, not by documentation.

Four of the five candidate architectures fail on evidence:

- **Option A (read the authenticated email)** is technically reachable but reads an **empty well**: `auth.users.email` is NULL for every real BANHAO customer, because nothing in this repository ever writes it.
- **Option C (client sends it on the payment request)** contradicts the payment endpoint's own documented design (`POST /api/v1/orders/:id/payment` deliberately has *no request body*), and puts an unvalidated, unpersisted value on the money path.
- **Option D (synthetic address)** satisfies confirmation and **breaks refunds silently** — Stripe uses the confirmation-time email to ask the customer for their refund bank account, so a platform-owned placeholder means refund requests reach BANHAO instead of the customer, forever.
- **Option E (an email-free PromptPay flow)** is **not supported by any evidence in this repository**. The requirement sits on the confirm call itself; Stripe's client-side flows relocate *who collects* the email, they do not remove it — and DEC-055 clause 12 forbids adding the RN SDK or a publishable key anyway.

**Recommended: Option B, narrowly scoped** — collect a real customer email into BANHAO's own schema, validate it, read it **server-side** at payment time, and **fail closed** (a domain error) when it is absent rather than substituting anything. The critical scoping choice, and the reason this is small rather than large: the email is collected **at the point of payment, not at signup**, so no existing customer is retroactively gated and phone-first onboarding is untouched.

A **new Decision Lock is required** — recommended as **DEC-056**, not another DEC-055 addendum, because it introduces a migration, new personal-data collection (PDPA — Q-012), and a mandatory/optional product rule that DEC-055 has no authority over.

---

## 2. Current-state evidence

Every claim in this section is a direct repository citation.

### 2.1 There is no email column anywhere in the application schema

A repository-wide search across `apps/*/src`, `packages/*/src`, `supabase/migrations` and `supabase/seed-dev` returns exactly **three** categories of `email` hit, and none of them is a customer email address:

| Occurrence | File:line | What it actually is |
|---|---|---|
| `channel text not null check (channel in ('PUSH', 'SMS', 'EMAIL', 'IN_APP'))` | `supabase/migrations/20260811000010_audit_notification_infra_domain.sql:199` | A **channel label** on `notification_deliveries`, not an address. That table has **no recipient-address column at all** — its own comment says "No provider is named (TQ-003) — channel is a label" |
| `'PUSH' \| 'SMS' \| 'EMAIL' \| 'IN_APP'` | `apps/api/src/modules/notifications/notification-channel.interface.ts:22` | The same channel enum in TypeScript |
| `email?: string` / `payload.email` | `apps/api/src/supabase/supabase.service.ts:10,112` | A parsed JWT claim — **discarded**, see § 2.4 |
| *(comment only)* "shaped so email/password and social login can be added later" | `packages/validation/src/auth.ts:6` | A forward-looking note. No email schema exists — `packages/validation/src/common.ts` has none |

`profiles` (`supabase/migrations/20260809000002_profiles_and_roles.sql:12-19`) is `id, role, phone, display_name, created_at, updated_at`. **No email column.**

### 2.2 Phone is the primary identity, and email is never captured at signup

- The customer app signs in with **phone only**: `supabase.auth.signInWithOtp({ phone })` (`apps/customer/src/hooks/useAuth.tsx:100`) and `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` (`:105`).
- The provisioning trigger copies **only** the phone:
  ```sql
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  ```
  `supabase/migrations/20260809000002_profiles_and_roles.sql:61-63`. `email` is not read, not copied, not mentioned.
- `docs/SUPABASE_DEVELOPMENT.md:18` records the live project's auth configuration as phone with `SMS provider | none — Supabase Test OTP`. No email provider.

**Therefore `auth.users.email` is NULL for every real BANHAO customer.** This is not a probabilistic claim: no code path in this repository writes that column for a customer. The single exception proves it — `supabase/seed-dev/catalog_dev_seed.sql:62` writes `dev-seed-merchant@banhao.invalid` for a **synthetic merchant FK anchor** that, by its own comment, "never signs in", and it deliberately uses a `.invalid` TLD annotated *"cannot be a real address"*.

`auth.users.email` does exist as a **column** (the local test shim mirrors the real platform: `email text unique`, `supabase/tests/00_shim_supabase_auth.sql:22`) — it is simply always empty here.

### 2.3 Email is not mandatory anywhere, not collected by the customer app, and not in any API DTO

- **Collected:** no. `AddressFormScreen` collects `recipientName`, `recipientPhone`, `addressLine`, `label`, `instructions` (`apps/customer/src/screens/AddressFormScreen.tsx:40-57`) — no email field. `ProfileScreen` renders `displayName` and `phone` only, with a single editable `Input` for the name (`apps/customer/src/screens/ProfileScreen.tsx:41-43, 85`).
- **In a DTO:** no. Zero occurrences in `packages/validation/src`, other than the aspirational comment above.
- **Mandatory:** nowhere — the field does not exist to be required.
- **Writable if it did exist:** not by the client. The deployed grant is `grant update (display_name) on public.profiles to authenticated` (`supabase/migrations/20260809000003_harden_profiles_rls.sql:59`), and `updateProfileSchema` is `.strict()` with `displayName` as its only key (`packages/validation/src/auth.ts`). A new column would need an explicit new grant — the default is closed.

### 2.4 The one email the system does see is deliberately thrown away

`SupabaseService.verifyAccessToken` parses the claim:

```ts
email: typeof payload.email === 'string' ? payload.email : undefined,
```
`apps/api/src/supabase/supabase.service.ts:112`

But `SupabaseAuthGuard` builds the request principal from the **`profiles` row**, not the claims object:

```ts
request.user = {
  id: profile.id,
  phone: profile.phone,
  capabilities,
};
```
`apps/api/src/common/guards/supabase-auth.guard.ts:82-86`

`AuthenticatedUser` (`apps/api/src/common/types.ts:66-70`) is `{ id, phone, capabilities }` — **no email field**. So `claims.email` is computed and immediately discarded, and would be `undefined` regardless (§ 2.2).

### 2.5 Can the backend retrieve an Auth email server-side?

**Technically yes; practically there is nothing to retrieve.** `SupabaseService.admin` is a service-role client (`apps/api/src/supabase/supabase.service.ts:78-80`), which exposes the GoTrue admin API, so `admin.auth.admin.getUserById(id)` is reachable. But:

- A repository-wide search for `auth.admin` / `getUserById` / `admin.auth` across `apps/api/src` returns **zero** occurrences. No server-side Auth user lookup exists anywhere in this codebase today.
- Per § 2.2 the value returned would be `null`.

### 2.6 The contact-data pattern this repository already uses

Relevant because it is the precedent any email design should follow rather than invent around:

- `addresses` carries `recipient_name text not null` and `recipient_phone text not null` (`supabase/migrations/20260811000001_identity_domain.sql:121-122`) — customer-supplied contact data, persisted and validated **before** it is needed.
- `create_order()` reads that address **server-side** and snapshots it onto the order (`supabase/migrations/20260819000001_order_creation_function.sql:214, 320, 326`), producing the immutable `orders.recipient_name_snapshot` / `recipient_phone_snapshot` (`supabase/migrations/20260811000005_order_domain.sql:46-47`), protected by `orders_enforce_immutable_columns` (`:127-128`).

**The established shape is: collect from the customer → persist → validate → read server-side → snapshot.** Contact data is never passed through the operation that consumes it.

---

## 3. The exact Stripe dependency

From `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md` § 2 — a real captured HTTP 400, not documentation:

```
code: "parameter_missing"
message: "Missing required param: billing_details[email]."
param: "billing_details[email]"
```

The spike's own finding (`:63-67`): *"PromptPay confirmation requires a billing email server-side, even with no publishable key / client-side Elements involved."* Adding `payment_method_data[billing_details][email]=<email>` to the confirm call returned HTTP 200 / `requires_action`.

Two structural facts follow, both from the same spike:

1. **The requirement is on `POST /v1/payment_intents/{id}/confirm`.** PaymentIntent *creation* alone never reaches `next_action` (§ 2 of the spike) — confirmation is mandatory to obtain a QR, so the email is mandatory to obtain a QR. It is not an optional receipt nicety.
2. **The spike explicitly did not verify live-mode strictness.** Its own adapter table (`:303`) says a synthetic email is sufficient "*— Stripe does not validate deliverability in test mode; **NOT VERIFIED** whether live mode enforces anything stricter*". That caveat is load-bearing for Option D and is not treated here as permission.

---

## 4. Where an email could technically enter the payment flow

Traced end to end at this HEAD:

| Layer | File | Does it carry an email? | Could it? |
|---|---|---|---|
| Customer payment screen | `apps/customer/src/screens/payment.tsx` | No — and it makes **no API call at all**; it renders navigation state with a local timer | Only if the screen were wired to the endpoint, which is separate, deliberate work |
| Customer repositories | `apps/customer/src/repositories/index.ts` | **No payment binding exists** (grep: zero `payment` hits) | — |
| API client | — | No payment client method exists | — |
| Controller | `apps/api/src/modules/payments/payments.controller.ts:36-41` | No. Takes `@CurrentUser()` and `@Param('id')` only; **no `@Body()`** | Only by adding a request body — see Option C |
| DTO | `packages/validation/src/payment.ts:4` | No. Documented: *"`POST /api/v1/orders/:id/payment` (Phase F-1) **has no request body**"* because everything is server-derived | Same |
| Service | `apps/api/src/modules/payments/payments.service.ts` | No. Receives `AuthenticatedUser` (`{id, phone, capabilities}`) and reads `orders`; both provider call sites pass `idempotencyKey, orderId, amount, method, webhookUrl` (`:370-375`, `:472-484`) | **Yes — this is the correct insertion point.** The service already reads server-side state (`orders`, `payments`, `payment_attempts`) and could read one more column |
| Provider input | `apps/api/src/modules/payments/payment-provider.interface.ts:28-36` | No. `CreatePaymentInput` has no customer/contact field | **Yes — additively**, e.g. a `customerEmail` field |

**Conclusion: exactly one insertion point respects the current architecture** — `PaymentsService` reads the email from BANHAO's own database server-side and passes it to the provider through an additive `CreatePaymentInput` field. Ownership checks are unaffected: the service already proves order ownership via the guarded `UPDATE … .eq('customer_id', user.id)` (`payments.service.ts:122-129`) and the `NOT_FOUND` fallback (`:162-164`), so the customer whose email would be read is already the authenticated owner of the order.

---

## 5. Candidate architecture comparison

### Option A — use the authenticated customer email (Supabase Auth)

| Aspect | Finding |
|---|---|
| Correctness | **Fails.** The source is structurally empty (§ 2.2). Not "sometimes missing" — always |
| Guaranteed to exist? | **No.** Zero customers have one |
| Retrievable server-side? | Technically yes via `admin.auth.admin.getUserById` (§ 2.5), never used today |
| Security | Acceptable in principle (server-side, service-role), but puts an **identity credential** on the payment path |
| Complexity | Low to call, but adds a **network round trip to the Auth API on the critical payment path**, with its own failure modes, to read BANHAO's own customer's data — strictly worse than a column read |
| Changes auth architecture? | **Yes, if made viable.** Populating it means writing `auth.users.email` (`updateUserById`), which in Supabase is a login credential (unique, confirmation semantics) — conflating "how you sign in" with "where we email you about a refund" |
| Appropriate for Stripe refund comms? | Only if real and current; nothing here makes it either |

**Verdict: rejected as a source.** It is an empty well, and filling it is an authentication change this task is explicitly forbidden to make and that would be architecturally wrong anyway.

### Option B — collect a customer email into BANHAO's own profile/schema

| Aspect | Finding |
|---|---|
| Correctness | **The only option that yields a real, contactable address**, which § 6 shows the refund path requires |
| Schema change | **Required** — one additive nullable column. No existing data is invalidated; every current row is simply NULL |
| API change | A read (service-side) plus a write path for collection. `updateProfileSchema` is `.strict()` and the grant is `display_name`-only (§ 2.3), so both must be extended **deliberately** — the default stays closed |
| Validation | Needs an `emailSchema`; none exists (`packages/validation/src/common.ts`) |
| Can existing customers pay without one? | **Not once Stripe is live** — this is the crux, and why *when* it is collected is the real decision (see the recommendation) |
| Blocks Phase 1? | **No**, provided collection is gated at the payment step rather than at signup |
| New product/business decision? | **Yes** — mandatory/optional, wording, and PDPA purpose (Q-012). It is new personal data |
| UX | One field, at a moment where the reason is visible to the customer |

**Verdict: recommended, narrowly scoped.** See § 7.

### Option C — pass the email on the checkout/payment request

| Aspect | Finding |
|---|---|
| Trust boundary | **Contradicts a documented architectural stance.** The payment endpoint has *no request body* precisely because "There is nothing left for a client to legitimately choose" (`packages/validation/src/payment.ts:4-12`) |
| Should the server trust it? | Not unvalidated and unpersisted at the moment of money movement. Note the nuance: BANHAO *does* accept client-supplied **contact** data elsewhere (`addresses.recipient_phone`) — but it is persisted and validated **first**, then read server-side (§ 2.6). Client-supplied contact data has precedent; client-supplied data *on the payment call* does not |
| Persisted? | If not persisted, the refund address exists only inside Stripe and BANHAO cannot audit what it sent |
| Refund implications | A typo entered at payment time silently becomes the permanent refund address for that PaymentIntent (§ 6) |
| API contract impact | Reintroduces a request body to an endpoint deliberately defined without one |

**Verdict: rejected in its literal form.** Its underlying insight is correct and is preserved by the recommendation — only the customer knows their email — but it is satisfied by collecting *before* payment through the existing pattern, not by widening the payment call.

### Option D — synthetic / platform email (`customer-{id}@banhao.local` or similar)

| Aspect | Finding |
|---|---|
| Stripe confirmation | Would satisfy it in test mode; **live-mode strictness is NOT VERIFIED** (§ 3) |
| Stripe refund communication | **Fatal.** Stripe *"automatically contacts the customer at the email address provided at time of PaymentIntent confirmation and requests refund account information from them"* — recorded at `docs/DECISIONS.md:5953` (DEC-055 A-9). A platform address means **every refund request reaches BANHAO instead of the customer**, and the customer is never asked for the bank account the refund needs |
| Ability to contact the customer | Zero, by construction |
| Compliance/audit | Injects **knowingly false personal data** into a financial system and into a third-party processor's records |
| Misleading data | Yes — and unlike the repo's one existing synthetic address, it would attach to real people. The dev seed's `@banhao.invalid` is a non-signing-in FK anchor, explicitly commented as unusable (§ 2.2); that is a categorically different use |

**Verdict: rejected for any customer-facing or production use.** One narrow carve-out worth recording so the rejection is not over-read: a clearly-labelled placeholder remains legitimate **inside dev/test-only surfaces** (`NullPaymentProvider`, a Stripe *test-mode* harness) where no real customer and no real refund exist — consistent with how the repo already labels fake data. It must never reach a live PaymentIntent.

### Option E — a PromptPay flow that avoids the email

| Aspect | Finding |
|---|---|
| Evidence for an email-free path | **None in this repository.** The spike proves the requirement sits on the confirm call itself (§ 3) |
| Stripe.js / Elements | Would collect billing details in Stripe's own client UI — relocating *who* collects the email, not removing it. Also forbidden: DEC-055 clause 12 says do not add the Stripe React Native SDK or a publishable key |
| Stripe Checkout (hosted) | Collects the email itself, but is a different integration shape that would replace the locked server-confirm + rendered-QR contract (DEC-055 Addendum A) — a new architecture decision, not an escape hatch |

**Verdict: rejected — not supported by authoritative existing evidence.** Recorded finding: **no Stripe PromptPay flow removes the email; they only move who collects it.**

### Ranking against the stated criteria

Scored 1 (worst) – 5 (best). "B (scoped)" is the recommendation in § 7.

| Criterion | A (auth email) | **B (scoped)** | C (client-sent) | D (synthetic) | E (other flow) |
|---|---|---|---|---|---|
| 1. Correctness for real money | 1 — empty source | **5** | 3 | 1 — breaks refunds | 1 — unevidenced |
| 2. Security / trust boundary | 3 | **5** — server-side read | 2 — client on money path | 2 | 2 |
| 3. Compatibility with BANHAO architecture | 2 — auth change | **5** — matches § 2.6 pattern | 1 — contradicts DTO design | 3 | 1 — contradicts DEC-055 cl. 12 |
| 4. Minimal Phase 1 scope | 3 | **4** — one column, one field, one read | 4 | 5 — but wrong | 1 |
| 5. Customer UX impact | 5 — none | **3** — one new field at payment | 3 | 5 — none | 2 |
| 6. Refund compatibility (Q-020) | 2 | **5** | 3 | 1 — structurally broken | 3 |
| 7. Migration / data-quality risk | 5 — none | **4** — additive, all-NULL start | 4 | 1 — false data | 5 |
| 8. Operational complexity | 2 — Auth call on payment path | **4** | 4 | 4 | 2 |
| 9. Future extensibility | 2 | **5** — email login/receipts later | 2 | 1 | 2 |
| **Total** | **25** | **40** | **26** | **23** | **19** |

---

## 6. Q-020 dependency analysis

**Q-020 is not resolved, touched, or prejudged here.** What follows is dependency identification only.

1. **The confirmation email *is* the refund-contact email.** `docs/DECISIONS.md:5953` (DEC-055 A-9) records Stripe's own statement that it contacts the customer at the address given at confirmation time to request refund bank details. The value chosen for `billing_details[email]` therefore has a **refund consequence**, not merely a payment one. This is the single most important dependency, and it is what disqualifies Option D.
2. **Does Stripe's refund *API* itself require an email?** **NOT VERIFIED — and deliberately not tested.** The sandbox spike never called `POST /v1/refunds` (`docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md:342`, and again at `:211`). Documentation indicates Stripe reuses the PaymentIntent's own email rather than taking one per refund, but this recon does not treat that as established. Whoever implements refunds must verify it rather than assume it.
3. **The email is effectively immutable per payment attempt.** It is supplied at confirm time and lives on that PaymentIntent. Combined with DEC-055 clause 8 — a regenerated attempt uses `orderId:attemptNo` and so produces a **new** PaymentIntent — this means: a corrected email applies only to *future* attempts, never to an already-confirmed one. A refund on an older payment goes to the address captured then. **Consequence to weigh at the Decision Lock:** this argues for capturing the email BANHAO sent per order/attempt for audit, so "which address did we hand Stripe for this payment?" is answerable from BANHAO's own records rather than only from Stripe's.
4. **Refund idempotency is unaffected.** It is keyed on a refund reference (`RefundInput.idempotencyKey`, `payment-provider.interface.ts`), never on customer identity. **No dependency.**
5. **Lifecycle scope:** the email is required at **confirmation** (proven, § 3) and is *used by Stripe* at **refund** (documented, point 1). No evidence in this repository shows it is required for capture, cancellation, or webhook processing — `payment_intent.canceled` was exercised in the spike with no email involvement.

---

## 7. Recommended option

**Recommendation: Option B, narrowly scoped.**

```
Collect a real customer email into BANHAO's own schema.
Validate it. Read it SERVER-SIDE at payment time.
Fail closed when it is absent — never substitute, never synthesise.
Collect it at the point of payment, not at signup.
```

Five properties make this the right answer rather than merely the least-bad one:

1. **It is the only option that produces a real, contactable address**, which § 6.1 shows the refund path structurally requires. Every other option either has no address (A), an untrustworthy one (C), or a knowingly false one (D).
2. **It matches the pattern this repository already proved** (§ 2.6): collect from the customer → persist → validate → read server-side. It invents no new data-flow shape.
3. **It respects the trust boundary.** The payment endpoint keeps its no-request-body design; `PaymentsService` reads the value from BANHAO's own database, exactly as it already reads `orders.grand_total_satang` rather than accepting a client amount.
4. **Fail-closed is the safety property that makes it small.** When no email exists, the payment must raise a domain error — the same discipline the codebase already applies everywhere else a required input is missing (`NullPaymentProvider` refuses to verify without a secret; AI-ops escalates on `MISSING` policy rather than inventing a threshold). Fail-closed means a missing email can never silently become a synthetic one.
5. **Collecting at the payment step, not at signup, is what keeps Phase 1 unblocked.** No existing customer is retroactively gated, phone-first onboarding is untouched, no backfill is needed, and the customer is asked at the one moment the reason is self-evident — which is also the defensible PDPA framing (collected for a stated, necessary purpose) rather than speculative collection at registration.

**On placement** (recommended, but a Decision Lock question): a durable `profiles.email` as the collected value — collect once, reuse across orders, and it is the natural home if email ever becomes a login method, which `packages/validation/src/auth.ts:6` already anticipates. Additionally **capturing what was sent per order** (in the manner of `recipient_phone_snapshot`) is worth considering for the audit reason in § 6.3, but it is **secondary and separable** — the minimum correct implementation does not require it, and this recon does not recommend building both at once.

---

## 8. Why the alternatives are rejected

| Option | Rejected because |
|---|---|
| **A — auth email** | The source is empty by construction for every real customer (§ 2.2), and making it non-empty requires an authentication change that would conflate a login credential with a payment contact field. Also adds an Auth API round trip to the payment path to read BANHAO's own customer's data |
| **C — client sends it at payment** | Contradicts the payment endpoint's documented no-request-body design (`packages/validation/src/payment.ts:4-12`), and places an unvalidated, unpersisted value on the money path. Its valid insight is preserved by collecting earlier through the existing pattern |
| **D — synthetic address** | Satisfies confirmation while **silently breaking refunds** — Stripe would email BANHAO, never the customer, so the customer is never asked for the bank account a PromptPay refund requires (§ 6.1). Injects knowingly false personal data into a financial system. Live-mode acceptance is unverified anyway. *Narrow carve-out:* still fine in dev/test-only surfaces where no real customer or refund exists |
| **E — email-free flow** | No evidence in this repository supports one. The requirement is on the confirm call; Stripe's client-side flows relocate collection rather than remove it, and DEC-055 clause 12 forbids the SDK/publishable key that would be needed to attempt that route |

---

## 9. Exact implementation boundary for the next step

This recon authorises nothing. For whoever picks up the next task, the boundary that follows from § 7:

**The Stripe adapter does not have to wait for the collection UX.** The email question can be closed *architecturally* first, in this order:

1. **Decision Lock** (§ 10) settles: placement, mandatory-vs-optional, collection moment, and the PDPA purpose statement.
2. **Contract slice** — `CreatePaymentInput` gains a customer-email field (additive), `PaymentsService` reads it server-side and **fails closed** with a clear domain error when absent. `NullPaymentProvider` ignores it, as it ignores every other input today. This slice needs **no migration and no UI**.
3. **Collection slice** — the migration (one additive nullable column), the `emailSchema`, the explicit column grant, the `updateProfileSchema` extension, and the UI field.
4. **Stripe adapter** — can be written against the typed input from step 2 at any point after it, and remains unusable end-to-end until step 3 lands. That is correct and honest: Stripe is not being enabled yet regardless, since `NullPaymentProvider` is still the bound provider and DEC-055 clause 11 (starvation fix) plus Q-020 gate enablement independently.

Explicitly **out of** that boundary: any synthetic email; any change to `auth.users`; any refund implementation; any Q-020 resolution; any change to the locked presentation contract.

---

## 10. Is a new Decision Lock required?

**Yes.**

**Recommended form: a new decision — DEC-056 — not a further DEC-055 addendum.** DEC-055 is currently the highest number in `docs/DECISIONS.md`, so `DEC-056` is the next free identifier.

Reasoning: DEC-055 Addendum A closed a question DEC-055 itself opened about its *own* presentation contract, which is what made an addendum right. This is materially different — it introduces a **schema migration**, **new personal-data collection** (PDPA, Q-012), and a **product rule** about when a customer is required to supply an email. Those are not within DEC-055's subject matter; DEC-055 only recorded that the dependency exists (A-9) and explicitly disclaimed deciding it.

The lock must settle, at minimum:

1. Placement — `profiles.email` (recommended), and whether a per-order snapshot is also captured.
2. Mandatory or optional, and **at which moment** it becomes required (recommended: at payment, not at signup).
3. The behaviour when it is absent — recommended: **fail closed**, an explicit domain error, never a substitute value.
4. The customer-facing purpose statement and PDPA basis (cross-reference **Q-012**).
5. An explicit restatement that this does **not** resolve **Q-020**, and that the confirmation email is also the refund-contact address (§ 6.1).
6. A cross-reference from DEC-055 Addendum A-9 to the new decision, so A-9 stops reading as open.

---

## 11. Open questions

1. **Does Stripe's refund API require or accept its own email?** NOT VERIFIED — `POST /v1/refunds` was never called by the spike (`docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md:342`). Belongs to Q-020's own work, not here.
2. **Does Stripe live mode enforce stricter email validation than test mode?** NOT VERIFIED, flagged by the spike itself (`:303`). Relevant only as further evidence against Option D; it does not change the recommendation.
3. **Should the email BANHAO sent be snapshotted per order/attempt for audit?** Raised by § 6.3, recommended as a Decision Lock question, deliberately not answered here.
4. **What happens to a customer who refuses to supply an email?** A product question — under DEC-016 (online payment only) there is no cash fallback, so "no email" would mean "cannot order". The Decision Lock owns this, and it is the strongest argument for asking at the payment step where the trade-off is visible.
5. **Is an email the right channel at all for Thai customers?** Out of scope, but noted: BANHAO's customer base is phone-first by design, and an email may be unfamiliar friction. Stripe's PromptPay refund mechanism nonetheless requires one — which is a fact about the rail, not a BANHAO preference.

---

## 12. Files inspected

**Schema / migrations:** `supabase/migrations/20260809000002_profiles_and_roles.sql` (profiles, `handle_new_user`), `20260809000003_harden_profiles_rls.sql` (column grants), `20260811000001_identity_domain.sql` (addresses), `20260811000005_order_domain.sql` (order snapshots, immutability), `20260811000006_payment_domain.sql`, `20260811000010_audit_notification_infra_domain.sql` (notification channels), `20260819000001_order_creation_function.sql` (`create_order()` snapshotting), plus a full `email` scan of all 26 migrations. `supabase/tests/00_shim_supabase_auth.sql`, `supabase/seed-dev/catalog_dev_seed.sql`.

**API:** `apps/api/src/supabase/supabase.service.ts`, `apps/api/src/common/guards/supabase-auth.guard.ts`, `apps/api/src/common/types.ts`, `apps/api/src/modules/users/users.service.ts`, `apps/api/src/modules/payments/payments.controller.ts`, `payments.service.ts`, `payment-provider.interface.ts`, `providers/null-payment.provider.ts`, `apps/api/src/modules/notifications/notification-channel.interface.ts`.

**Packages:** `packages/validation/src/payment.ts`, `packages/validation/src/auth.ts`, `packages/validation/src/common.ts`.

**Customer app:** `apps/customer/src/hooks/useAuth.tsx`, `screens/payment.tsx`, `screens/CheckoutScreen.tsx`, `screens/AddressFormScreen.tsx`, `screens/ProfileScreen.tsx`, `screens/auth/OtpScreen.tsx`, `repositories/index.ts`.

**Docs:** `docs/STRIPE_PROMPTPAY_SANDBOX_SPIKE.md`, `docs/STRIPE_PRESENTATION_CONTRACT_RECON.md`, `docs/STRIPE_PRESENTATION_CONTRACT_FOLLOWUP_RECON.md`, `docs/DECISIONS.md` (DEC-055 and Addendum A-9), `docs/SUPABASE_DEVELOPMENT.md`.

---

**Nothing in this document has been implemented.** The schema, authentication, `PaymentProvider`, DTOs, payment lifecycle, customer UI, and every decision document are exactly as they were at HEAD `88cb4750d10ec5fca89c8a863f35b9785567ae82`.

`STRIPE ADAPTER STATUS: NOT IMPLEMENTED`
