# Q-002 — Provider enquiry email drafts (DEC-068 B1)

```
DRAFTS — NOT SENT
These are drafts for the owner's review and sending. They have NOT been sent
to Stripe, Opn or 2C2P. They do not represent provider confirmation, an
existing provider relationship, or any commitment by any provider.
```

Drafted 2026-11-02 for the owner to send. Claude does not send them. Fill in
the bracketed fields. Questions come from
`Q-002-MARKETPLACE-PAYMENT-PROVIDER-RESEARCH.md` §8.

Where to send:

- **Stripe:** the Thailand sales form at https://stripe.com/en-th/contact/sales,
  or Dashboard → Help → Contact support while signed in to
  `acct_1UDFhGARZ0Fu9Rq0`.
- **Opn Payments:** the contact form or sales email on https://www.opn.ooo.
- **2C2P:** the sales enquiry form on https://2c2p.com.

---

## 1. Stripe Thailand

**Subject:** Connect for a Thai food-delivery marketplace — onboarding restaurants with PromptPay

Hello Stripe team,

I run BANHAO, a local food-delivery app in Buntharik district, Ubon
Ratchathani, Thailand. We already use Stripe (account `acct_1UDFhGARZ0Fu9Rq0`)
for PromptPay payments in test mode, and we want to move to Stripe Connect so
that each restaurant receives payment for its own orders directly and BANHAO
receives only its fee.

From your Thailand marketplace guidance, we understand Thai platforms can use
direct charges with an application fee, with Stripe-liable connected
accounts. Before we build, could you confirm the following?

1. Can we onboard Thai **restaurants** (food-delivery merchants) as connected
   accounts where Stripe handles losses? Does the "Food" restriction listed for
   Connect in Thailand apply to them?
2. Most of our restaurants are small sole traders in a rural district, with a
   Thai ID card and a personal bank account but no company registration. Can
   they complete Stripe's hosted onboarding? Is selfie verification required?
3. On a direct charge paid with PromptPay, does `application_fee_amount` work?
   How are PromptPay refunds handled on a connected account, including the
   email-based collection of the customer's bank details, and can the platform
   initiate them?
4. Are payouts to Thai connected accounts fixed daily, or can they be weekly?
5. Is Connect enabled for our account, and is any review needed before live
   mode? Expected volume at launch: about `[N]` restaurants and `[N]` orders
   per day, average order about ฿`[75]`.

We would appreciate written answers, since our architecture depends on them.

Thank you,
`[Name]`
BANHAO | บ้านเฮา
`[Phone / email]`

---

## 2. Opn Payments (Omise)

**Subject:** Split settlement for a Thai food-delivery marketplace with PromptPay

Hello Opn team,

I run BANHAO, a local food-delivery app in Ubon Ratchathani. We are choosing a
payment provider and want a model where the customer's payment settles
**directly to the restaurant**, and only the platform's fee settles to us, so
that our company does not hold restaurants' money.

1. Do you offer true split settlement like this with PromptPay, not
   collect-then-payout through the Recipients / Send Payouts API?
2. If not, is the "PayFac-as-a-Service" product mentioned in 2023 available?
3. Under which Bank of Thailand licence would the flow run, yours or ours?
4. Can PromptPay charges be refunded through your API?
5. Pricing for PromptPay and for payouts to vendors?

Expected volume: about `[N]` restaurants and `[N]` orders per day.

Thank you,
`[Name]`, BANHAO | บ้านเฮา, `[Phone / email]`

---

## 3. 2C2P

**Subject:** Split settlement for a Thai food-delivery marketplace with PromptPay

Hello 2C2P team,

I run BANHAO, a local food-delivery app in Ubon Ratchathani. We are looking
for a payment provider where the customer's PromptPay payment settles
**directly to the restaurant's account**, and only the platform's fee settles
to us, so that our company does not hold restaurants' money.

1. Do you offer split settlement like this in Thailand, with PromptPay?
2. Can small sole-trader restaurants be onboarded as sub-merchants, and what
   documents do they need?
3. Under which Bank of Thailand licence would the flow run?
4. How are PromptPay refunds handled?
5. Pricing and minimum volume?

Expected volume: about `[N]` restaurants and `[N]` orders per day.

Thank you,
`[Name]`, BANHAO | บ้านเฮา, `[Phone / email]`
