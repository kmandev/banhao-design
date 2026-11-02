# Q-002 — Marketplace payment provider research (DEC-067 S1)

```
DECISION PREPARATION — NOTHING LOCKED — NOT LEGAL ADVICE
```

Written 2026-11-02 for DEC-067 S1. The owner wants a payment provider that
supports a marketplace model in Thailand, so each restaurant receives the money
from its own orders and BANHAO receives its commission, without BANHAO holding
restaurants' money. This document reports what public sources and a Stripe
test-mode spike show. It is not legal advice: the licensing section summarises
public material, and the owner has chosen not to commission a legal review.

## 1. Short answer

- **Stripe Connect can do this in Thailand, but only one way:** a *direct
  charge* on the restaurant's own Stripe account, with BANHAO taking an
  *application fee*. PromptPay works on that path.
- **Three things must be confirmed with Stripe sales before building:**
  whether restaurants ("Food") are accepted as connected accounts, whether
  small rural restaurants can pass Stripe's onboarding, and how PromptPay
  refunds behave on connected accounts.
- **No Thai provider was confirmed to offer true split settlement** from public
  documentation. Opn (Omise) documents payouts to vendors, which is still
  BANHAO collecting and then paying out.
- **The model BANHAO has built today (collect, then pay out) is the one most
  likely to fall under the Bank of Thailand's "receiving payment on behalf"
  licence.** That matches the owner's reason for wanting a marketplace provider.

Recommendation in §7.

## 2. Stripe Connect in Thailand — what the sources say

| Topic | Finding | Source |
|---|---|---|
| Charge types for a Thai platform with Thai connected accounts | **Direct charges only.** Cards and **PromptPay** supported | [Stripe: Thailand support for marketplaces](https://support.stripe.com/questions/stripe-thailand-support-for-marketplaces) |
| Not supported | **Separate charges and transfers**, top-ups to the platform account, connected accounts in industries where the platform bears losses | same |
| Application fee | Allowed when platform and connected account are both in Thailand; not allowed cross-border | same |
| Restricted industries for "some connected accounts" | Includes **"Food"**, hotels, transportation services and others; list is non-exhaustive | [Stripe: businesses Stripe can't support on Connect in Thailand](https://support.stripe.com/questions/are-there-any-businesses-that-stripe-cant-support-on-connect-in-thailand) |
| Express accounts | Not self-serve for Thai platforms; contact sales | [Stripe: Express accounts](https://docs.stripe.com/connect/express-accounts) |
| Verification | Selfie verification not possible through the API; restaurants go through Stripe's hosted onboarding | Thailand marketplace page above |
| Payouts | Thai accounts default to **daily automatic payouts**, by local regulation | [Stripe: payouts](https://docs.stripe.com/payouts) |
| Cross-border payouts | Not available to or from Thailand | [Stripe: cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts) |
| Pricing | Stripe-handled pricing: no Connect fee for the platform. Platform-handled: ฿60 per monthly active account + 0.25% + ฿15 per payout | [Stripe Connect pricing (TH)](https://stripe.com/en-th/connect/pricing) |

## 3. Stripe test-mode spike (BANHAO's own account, 2026-11-02)

Run against BANHAO's Stripe test account (`acct_1UDFhGARZ0Fu9Rq0`):

1. **Accounts v1 is refused for new Connect integrations.** The API asks for
   Accounts v2 (`POST /v2/core/accounts`).
2. **A Thai connected account where Stripe bears losses was created**
   (`acct_1UXI4cARZ0W0vm9Y`, full dashboard). It requests `card_payments` and
   `promptpay_payments`, both `restricted` until onboarding is complete. Its
   requirements include Thai ID (`th_pin`), date of birth, address, a bank
   account and an MCC.
3. **A Thai connected account where BANHAO bears losses was refused:**
   *"Platforms in TH cannot create accounts where the platform is loss-liable,
   due to risk control measures."* So Express- or Custom-style accounts are
   out.
4. **BANHAO cannot fill in onboarding for the restaurant.** Stripe refused to
   accept the Terms of Service on the account's behalf because Stripe owns
   requirement collection. Each restaurant completes Stripe's hosted onboarding
   itself.

A direct charge was not run, because the test account was not onboarded.

## 4. Thai providers

| Provider | Finding | Gap |
|---|---|---|
| **Opn Payments (Omise)** | Thai PSP. PromptPay 1.65% per transaction ([pricing](https://www.omise.co/en/pricing/thailand)). "Send payouts" pays vendors and marketplace sellers by API ([product page](https://www.opn.ooo/products/send-payouts)); the Recipients API supports `Vendor` relationships with documents ([docs](https://docs.omise.co/recipients-api)) | That is **collect, then pay out**, so BANHAO still holds the money. A 2023 press report mentions a planned "PayFac-as-a-Service" product; not confirmed. An older Opn page says PromptPay charges cannot be refunded through Omise; check whether still true |
| **2C2P** | Regional PSP with strong Thailand coverage | No public split-settlement documentation found; needs a sales enquiry |
| **Thai banks (KBank, SCB, others)** | Acquire cards and PromptPay | No public marketplace or split documentation found |

## 5. Licensing — what public sources say

- The Payment Systems Act B.E. 2560 requires an e-payment licence for
  "receiving payment on behalf of" sellers or service providers, alongside
  payment facilitating
  ([BOT stipulation](https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2561/EngPDF/25610195.pdf);
  [Lexology overview](https://www.lexology.com/library/detail.aspx?g=9d1ee4d3-455a-4e9a-b80a-901711269b92)).
- Secondary sources cite THB 10 million minimum capital for that category, at
  least one Thai director resident in Thailand, and client funds held in a
  separate account
  ([Belaws](https://belaws.com/thailand/e-payment-licences/);
  [IncFine](https://incfine.com/en/obtain-a-payment-processor-license-in-thailand/)).
  These are law-firm and consultancy pages, not BOT rulings.
- No source found says how a food-delivery platform is classified.
- **Reading, not advice:** with direct charges the restaurant is the merchant
  of record and Stripe (a licensed provider) moves the money, so BANHAO does
  not receive the customer's money for the restaurant. With collect-and-remit,
  BANHAO does. Only a regulator or a lawyer can confirm either.

## 6. What direct charges would change in BANHAO

**Money per ฿75 order** (today's fees):

| | Collect-and-remit (built) | Stripe Connect direct charge |
|---|---|---|
| Customer pays | BANHAO's Stripe account | The restaurant's Stripe account |
| BANHAO keeps | ฿21 after paying the restaurant ฿54 | ฿21 as the application fee (commission ฿6 + service ฿5 + delivery ฿10) |
| Stripe fee paid by | BANHAO | The restaurant by default, under Stripe-handled pricing. An owner decision |
| Restaurant paid | By BANHAO, weekly (DEC-067 S2) | **By Stripe, daily**, automatically |
| Rider ฿12 paid by | BANHAO | BANHAO, outside Stripe: separate charges and transfers are not supported in Thailand |
| Refund money comes from | BANHAO's balance | The restaurant's balance; BANHAO decides whether to return the application fee |

**Engineering impact** (estimate, 3–5 weeks):

- Accounts v2 onboarding: create the account, hosted onboarding link, status
  webhooks, a merchant-app screen, a column on `restaurants` for the Stripe
  account id (a migration).
- Payments: create the PaymentIntent on the restaurant's account with
  `application_fee_amount`. A Connect webhook endpoint for connected-account
  events.
- Ledger and decisions: `CUSTOMER_PAYMENT` stops being platform cash; revenue
  becomes the application fee. DEC-055 (no Connect), DEC-057/059 (refund
  ledger) and the settlement model need revising.
- Settlement shrinks to **riders only**. DEC-067 S2–S4 then apply to riders.

## 7. Recommendation

1. **Primary path: Stripe Connect direct charges**, with Stripe-liable,
   full-dashboard accounts. It is the only option found that keeps BANHAO from
   holding restaurants' money, works with PromptPay, and reuses the Stripe
   integration already built.
2. **Before building, get written answers from Stripe Thailand sales** (§8).
   If restaurants are refused, or onboarding is impractical for them, this path
   is closed.
3. **In parallel, send the same core questions to Opn and 2C2P** as a fallback.
4. **Do not lock DEC-067 S1 until those answers arrive.** Building settlement
   for collect-and-remit now would be the rebuild the owner wants to avoid.

## 8. Questions to send

**Stripe Thailand sales:**

1. Can a Thai platform onboard Thai **restaurants** (food delivery merchants) as
   Connect accounts with Stripe-handled losses? Does the "Food" restriction
   apply?
2. Can restaurants without a company registration, such as sole traders with a
   Thai ID and a personal bank account, complete onboarding? Is selfie
   verification required?
3. On a direct charge with PromptPay, does the application fee work? How are
   PromptPay **refunds** handled on a connected account, including the
   email-based bank-detail collection?
4. Can payouts to Thai connected accounts be weekly, or are they fixed daily?
5. Is Connect enabled for our account (`acct_1UDFhGARZ0Fu9Rq0`), and is any
   review needed before live mode?

**Opn / 2C2P:** do you offer split settlement, where the customer's payment
settles directly to the restaurant's account and the platform fee to the
platform, with PromptPay? Under which licence, and at what cost?

## 9. Found while testing refunds

**PromptPay refunds require Stripe to email the customer for bank details.** A
staff-initiated refund on staging (order `BH-20261102-0003`, cancelled after
payment) failed with Stripe's *"Cannot send email … verify the email address
first"*. The refund row is `REFUND_FAILED`; the order is `CANCELLED` and paid.

- To unblock: verify the email on BANHAO's Stripe account (or submit the
  account application), then retry the refund from the supervisor endpoint.
  Stripe may replay the cached error for the same idempotency key for up to
  24 hours.
- Product consequence: a PromptPay refund depends on the customer answering a
  Stripe email. The customer email (DEC-056) is therefore load-bearing for
  refunds, not only for payment.
