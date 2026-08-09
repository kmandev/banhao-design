# Authentication Analysis

## Options considered

- **Phone + OTP** (SMS or LINE-delivered one-time code)
- **Email + password**
- **Social login** (e.g. Google, Facebook, LINE Login)
- **Passkeys** (WebAuthn/FIDO2 — passwordless, device-bound credentials)

## Comparison

| Criteria | Phone + OTP | Email + Password | Social Login | Passkeys |
|---|---|---|---|---|
| Security | Good if OTP delivery is secured (rate-limited, short expiry); vulnerable to SIM-swap in theory | Weak by default (depends entirely on password hygiene + whether the app enforces hashing/rate-limiting correctly) | Delegates security to the provider (generally strong) but creates a dependency on that provider's account security | Strongest — phishing-resistant, no shared secret |
| UX | Familiar in Thailand; no password to remember; small delay waiting for SMS | Requires remembering a password; password reset flow adds complexity | Fastest for users who already have the social account logged in on-device | Newest, least familiar to typical Thai consumers; requires compatible device/browser |
| Cost | Per-SMS cost (see `ai/RESEARCH/NOTIFICATIONS.md` for provider pricing) or LINE Messaging API cost | Free (no per-user delivery cost) | Free (provider-hosted) but may have API usage limits | Free, no delivery cost |
| Implementation effort | Low-medium (needs an SMS/OTP provider integration + rate limiting/abuse prevention) | Low (well-trodden pattern) but needs careful security implementation (hashing, reset flow, breach response) | Medium (OAuth flow integration per provider) | Medium-high (newer standard, less mature tooling in some backend ecosystems) |
| Recovery | Re-send OTP to the same phone number; breaks if the user loses phone number access | Password reset via email | Tied to the social account's own recovery | Device-bound; needs a secondary recovery method (e.g. fallback OTP) if the device is lost |
| Fraud risk | SIM-swap fraud is a known attack vector globally; mitigated by rate-limiting and monitoring, not eliminated | Credential-stuffing/reused-password risk, independent of BANHAO's own security | Inherits whatever fraud protections the social provider has | Lowest fraud risk of the four (no shared secret to steal) |
| Suitability for Thailand | High — phone-number-centric identity is the dominant pattern for Thai consumer apps (matches existing regional food-delivery/ride-hailing apps' typical approach); LINE is near-ubiquitous, so LINE Login is a strong social-login candidate specifically for this market | Medium — works everywhere but less idiomatic for a mobile-first Thai consumer app | High if LINE Login specifically is used (LINE's dominance in Thailand is a documented market reality, not this document's opinion, though no specific market-share citation was verified as part of this research) | Low near-term — device/browser support is still uneven and passwordless UX is unfamiliar to most Thai consumers today |

## Per-role recommendation basis (analysis, not a decision)

- **Customer:** The existing design already shows a login + OTP flow (`design/customer/`, screens `03`/`04` — FACT-observed, see `ai/RESEARCH/CURRENT_ARCHITECTURE_ANALYSIS.md`), so Phone + OTP is already the *designed* UX, not something this document is newly proposing. LINE Login could be evaluated as a secondary/faster option given Thailand's LINE usage, but that would be a design change beyond this research's scope.
- **Driver:** Phone + OTP fits the same reasoning as Customer — drivers are individuals signing up on mobile, and phone-number identity doubles as a practical way to verify a real person during onboarding (relevant to KYC-adjacent concerns noted in `ai/RESEARCH/MARKETPLACE_PAYMENT_MODEL.md` and `ai/RESEARCH/THAILAND_COMPLIANCE.md`).
- **Merchant:** Merchant accounts are business accounts, typically fewer in number and higher-trust than Customer/Driver signups; Email + Password (with strong hashing and optional 2FA) or Phone + OTP are both reasonable — no design evidence favors one over the other yet, since no Merchant login screen exists in the current design (`ai/RESEARCH/CURRENT_ARCHITECTURE_ANALYSIS.md`).
- **Admin:** Internal/operational users, small in number, highest trust required. This is the strongest candidate for Passkeys or at minimum Email + Password with mandatory 2FA — internal tools are exactly the context where passkey UX unfamiliarity matters least (a small, trainable user base) and security matters most (access to reconciliation, approval queue, live map with all driver/order data — see the Admin wireframes in `docs/05-architecture`).

## What is not addressed here

Specific OTP/SMS delivery providers and their Thailand pricing are researched in `ai/RESEARCH/NOTIFICATIONS.md`, not duplicated here. Session/token management (JWT vs. session cookies, refresh-token strategy) is an implementation detail that depends on the backend framework choice (Q-006) and is not analyzed further in this document.
