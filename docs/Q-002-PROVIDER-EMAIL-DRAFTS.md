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

- **Stripe:** the Thailand sales form at https://stripe.com/en-th/contact/sales.
  Quote the **main** Stripe account ID, not the sandbox's `acct_1UDFhGARZ0Fu9Rq0`
  (the owner's Dashboard JSON suggests the main account is
  `acct_1UDFh7A6rkFXxa6U`; confirm before sending).
- **Opn Payments:** the contact form or sales email on https://www.opn.ooo.
- **2C2P:** the sales enquiry form on https://2c2p.com.

---

## 1. Stripe Thailand

**Subject:** Connect for a Thai food-delivery marketplace — onboarding restaurants with PromptPay

Hello Stripe team,

I run BANHAO, a local food-delivery app in Buntharik district, Ubon
Ratchathani, Thailand. BANHAO is operated by me as an individual; it is not a
registered company yet. We already use Stripe (account `[main account ID —
confirm]`) for PromptPay payments in test mode, and we want to move to Stripe
Connect so that each restaurant receives payment for its own orders directly
and BANHAO receives only its fee.

From your Thailand marketplace guidance, we understand Thai platforms can use
direct charges with an application fee, with Stripe-liable connected
accounts. Before we build, could you confirm the following?

1. Can a platform operated by an **individual** (not a registered company) be
   approved for Connect in Thailand? If not, what is required?
2. Can we onboard Thai **restaurants** (food-delivery merchants) as connected
   accounts where Stripe, not the platform, bears losses? Does the "Food"
   restriction listed for Connect in Thailand apply to them?
3. Most of our restaurants are small sole traders in a rural district, with a
   Thai ID card and a personal bank account but no company registration. Can
   they complete Stripe's hosted onboarding? We see that liveness verification
   is required: can a restaurant owner who is not comfortable with technology
   complete it remotely, and is onboarding available in Thai?
4. On a direct charge paid with PromptPay, does `application_fee_amount` work,
   and is there a minimum? Our fee is about ฿21 on a ฿75 order.
5. In our testing, a PromptPay refund asked the customer for bank details by
   email, and Stripe could only send that email to the account's own verified
   address until the account application was submitted. For a direct charge on
   a connected account: who must have submitted the application, who sends the
   email to the customer, and can the platform initiate the refund on the
   restaurant's behalf?
6. Who pays Stripe's processing fee on a direct charge, what is the PromptPay
   rate, and is there a per-account Connect fee?
7. Are payouts to Thai connected accounts fixed daily, or can they be weekly?
8. Does Stripe have guidance on whether a platform using direct charges in
   Thailand needs its own payment licence? (We are not asking for legal advice.)
9. Is any review needed before live mode, and how long does it usually take?
   Expected volume at launch: about `[N]` restaurants and `[N]` orders per
   day, average order about ฿`[75]`.

We would appreciate written answers, and an estimate of when we can expect
them, since our architecture depends on them. A Thai-speaking contact would
help if you have one.

Thank you,
`[Name]`
BANHAO | บ้านเฮา
`[Phone / email]`

---

## 2. Opn Payments (Omise)

**Subject:** Split settlement for a Thai food-delivery marketplace with PromptPay

Hello Opn team,

I run BANHAO, a local food-delivery app in Ubon Ratchathani. BANHAO is
operated by me as an individual; it is not a registered company yet. We are
choosing a payment provider and want a model where the customer's payment
settles **directly to the restaurant**, and only the platform's fee settles to
us, so that we do not hold restaurants' money.

1. Do you offer true split settlement like this with PromptPay, not
   collect-then-payout through the Recipients / Send Payouts API? If you have a
   sub-merchant or payment-facilitator model for marketplaces, please describe
   it.
2. Can a platform operated by an individual be onboarded? If not, what is
   required?
3. Can small sole-trader restaurants (Thai ID, personal bank account, no
   company) be onboarded as sub-merchants, and what documents do they need?
4. Under which Bank of Thailand licence would the flow run, yours or ours?
5. Can PromptPay charges be refunded through your API, and how is the customer
   asked for bank details?
6. Pricing for PromptPay and for payouts to vendors?

Expected volume: about `[N]` restaurants and `[N]` orders per day. Please also
let us know roughly when we can expect an answer.

Thank you,
`[Name]`, BANHAO | บ้านเฮา, `[Phone / email]`

---

## 3. 2C2P

**Subject:** Split settlement for a Thai food-delivery marketplace with PromptPay

Hello 2C2P team,

I run BANHAO, a local food-delivery app in Ubon Ratchathani. BANHAO is
operated by me as an individual; it is not a registered company yet. We are
looking for a payment provider where the customer's PromptPay payment settles
**directly to the restaurant's account**, and only the platform's fee settles
to us, so that we do not hold restaurants' money.

1. Do you offer split settlement like this in Thailand, with PromptPay?
2. Can a platform operated by an individual be onboarded? If not, what is
   required?
3. Can small sole-trader restaurants be onboarded as sub-merchants, and what
   documents do they need?
4. Under which Bank of Thailand licence would the flow run?
5. How are PromptPay refunds handled, including how the customer is asked for
   bank details?
6. Pricing and minimum volume?

Expected volume: about `[N]` restaurants and `[N]` orders per day. Please also
let us know roughly when we can expect an answer.

Thank you,
`[Name]`, BANHAO | บ้านเฮา, `[Phone / email]`
