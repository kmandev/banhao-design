# Notifications Analysis

All pricing checked **2026-08-09**. Full citations in `ai/RESEARCH/SOURCES.md`. **This document does not select providers.**

## Use cases

Order accepted / status changes / driver assigned / delivery (push + in-app), payment confirmations, **OTP** (TR-010), and promotions.

## Push — Firebase Cloud Messaging

**Still free, with no volume-based charge** — listed as "No-cost" on both the Spark and Blaze plans with no usage threshold. Constraints are rate quotas, not money:

- Default project quota: **600,000 messages/minute** (HTTP v1 API); exceeding returns HTTP 429. Quota increases are capped at +25% and require meeting usage/error-ratio thresholds.
- Per-device limits on Android: up to **240 messages/minute and 5,000/hour** to a single device.
- Collapsible messages: burst of 20 per app per device, refilling 1 every 3 minutes.
- iOS delivery is additionally bounded by APNs limits.

At BANHAO's Stage 1–3 volumes (`ai/RESEARCH/SCALE_MODEL.md`) these limits are not a practical concern. *(Topic rate limits, subscription limits, payload size, and max TTL were not found on the quotas page.)*

## LINE Messaging API

LINE is the dominant messaging platform in Thailand, making this the most locally-relevant channel.

**The single most important architectural fact:** **reply messages do not count against quota; push, multicast, broadcast, and narrowcast messages do.** An order-status flow designed to *respond* to user actions is dramatically cheaper than one that pushes unprompted. Messages are counted **per recipient**, not per API call. Messages to blocked users or non-existent IDs are not counted.

⚠️ **Exceeding the free limit without configured paid capacity returns an error and the message is *not sent*** — it does not silently overage. This is a real failure mode to design around.

**Thailand pricing** (official announcement, effective 1 Aug 2024 — note Thailand has its own plan structure, *not* Japan's Light/Standard/Premium):

- **Free package: ฿0** with **300 broadcast messages/month** (reduced from 500)
- **Pro package: ฿1,780/month** with **35,000 messages**, including MyCustomer CRM (valued ฿369/mo)
- Overage rose from ฿0.04 to **฿0.06 per extra message**, effective from the 10 Sep 2024 billing cycle
- ⚠️ A Basic tier at ฿1,280/mo for 15,000 messages is widely reported but **could not be confirmed on an official LINE page** — treat as unverified.

⚠️ **LINE Notify was shut down on 31 March 2025.** LINE officially directs users to the Messaging API instead. Do not design around Notify — it appears in many older Thai integration tutorials.

## SMS for OTP

⚠️ **A regulatory change makes foreign SMS providers actively harmful for OTP in Thailand.** From **21 October 2025**, NBTC required operators to deploy SMS firewalls screening international traffic and **prepend an alert symbol to messages originating overseas**. For an OTP — where the entire purpose is establishing trust — arriving with a warning marker attached is a meaningful UX and conversion problem, not a cosmetic one.

Combined with a ~5–7× price difference, this is a strong argument for a Thai domestic gateway.

| Provider | Price per message to Thailand |
|---|---|
| **Twilio** | **$0.0305** outbound (≈฿1.05 at rough parity) + $0.001 failed-message processing fee |
| **ThaiBulkSMS** | **฿0.15/credit** standard, ฿0.20/credit corporate |

**Credit counting matters for Thai-language OTP:** Thai ≤70 characters = 1 credit, 71–134 = 2, 135–201 = 3; English 160 characters = 1 credit. A Thai-language OTP message should fit in 1 credit if kept short.

Other notes:
- ThaiBulkSMS offers an "OTP Ready To Use" product with configurable PIN length, templates, expiry, and **automatic channel fallback across SMS / Email / LINE** — directly relevant to TR-010 and worth evaluating as a build-vs-buy decision.
- ThaiBulkSMS first purchase includes +20% bonus credits.
- **Sender ID registration is required either way.** NBTC requires Sender ID registration and KYC for domestic A2P senders (a whitelist separate from foreign senders). Twilio's Alphanumeric Sender ID in Thailand requires pre-registration with documents. Approval reportedly takes **~2 weeks** — *(third-party source, unverified)* — so this needs to start well before launch, not during it.
- ⚠️ ThaiBulkSMS package tables, VAT treatment, credit expiry, and Sender Name registration fee were **not found** (JavaScript-rendered pricing table).

## Email

| Provider | Price |
|---|---|
| **AWS SES** | **$0.10 per 1,000 emails** à la carte. Essentials plan $0.16/1,000 (0–10M). Attachments $0.12/GB |
| **Twilio SendGrid** | Essentials from **$19.95/month** (50,000–100,000 emails); Pro from $89.95/month. Overage $0.0013 → $0.0005 per email |

**SES is roughly 100× cheaper per email than SendGrid's entry plan at low volume.** SendGrid's free plan is now effectively a trial — **100 emails/day for 60 days only**, not an ongoing allowance.

Two changes worth noting: SES's old **62,000 free emails/month from EC2 is no longer listed** — new customers instead get up to $200 in Free Tier credits usable on SES, with a free plan lasting 6 months. And sendgrid.com now redirects to twilio.com.

Email is the lowest-priority channel for BANHAO regardless — the design has no email-centric flow, and Thai consumer apps lean on LINE and SMS.

## Trade-off summary

| Channel | Strongest option | Cost at Stage 1 |
|---|---|---|
| Push (order status) | **FCM** — free, no volume charge | $0 |
| OTP | **Thai domestic gateway** (e.g. ThaiBulkSMS at ฿0.15/credit) — avoids the NBTC foreign-SMS alert symbol and is ~5–7× cheaper | ~฿0.15 per OTP |
| Rich messaging / marketing | **LINE Messaging API** — design around *reply* messages, which are free | ฿0 free tier (300 broadcasts/mo) → ฿1,780/mo Pro |
| Email | **AWS SES** | ~$0.10 per 1,000 |

**Design implication worth carrying into implementation:** structure LINE interactions as replies wherever possible rather than pushes, and reserve push/broadcast for genuinely unprompted events. The cost difference between those two designs is large and compounds with order volume.

**Action item with lead time:** Sender ID registration (~2 weeks, unverified) must start well before launch. See Q-019.
