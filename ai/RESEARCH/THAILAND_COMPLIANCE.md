# Thailand Compliance Landscape

**This document is not legal advice and draws no legal conclusions.** It gathers publicly-findable background so the Product Owner knows which areas need professional review and roughly what those areas involve. Every item is classified:

- **Confirmed** — a general public fact traceable to a primary/authoritative source (e.g. the law exists, this agency regulates it).
- **Needs Professional Review** — anything specific to BANHAO's actual implementation. Err toward this category.
- **Unknown** — not resolvable from public sources in this research pass.

All sources checked 2026-08-09. Full source list: `ai/RESEARCH/SOURCES.md`.

---

## ⚠️ Priority finding: Digital Platform Services Royal Decree

This was not on the original research list but applies squarely to BANHAO's business model, and appears to be the most directly applicable regulation found in this entire research pass.

**Royal Decree on the Operation of Digital Platform Service Businesses B.E. 2565 (2022)** — adopted 22 December 2022, effective 21 August 2023, administered by **ETDA** (Electronic Transactions Development Agency).

- Defines "digital platform service" as an intermediary service connecting business users and consumers for electronic transactions — a direct structural match for a marketplace connecting customers, restaurants, and drivers.
- Requires **notification to ETDA** (a mandatory filing, not a license): "full-form" notification if gross annual income exceeds THB 50 million **or** more than 5,000 monthly active users in Thailand; "short-form" notification otherwise.
- ETDA has publicly announced (2025) increased enforcement, including formal correction orders and potential criminal penalties for failure to notify.

**Status: Confirmed** that the decree, the regulator, and the two-tier thresholds exist. **Needs Professional Review** for whether BANHAO must file now (a Stage 1 single-district launch is likely under both thresholds — but "short-form notification otherwise" suggests a filing obligation may exist *regardless* of size, which is exactly the kind of distinction that needs a lawyer, not an AI research pass).

---

## 1. PDPA — Personal Data Protection Act

**Confirmed:** Personal Data Protection Act B.E. 2562 (2019), in full effect since 1 June 2022, enforced by the **Personal Data Protection Committee (PDPC)**. General obligations relevant to a platform collecting customer/merchant/driver data include: a lawful basis for collection/use/disclosure (consent is one basis among several); notice/transparency requirements (purpose, controller details, third-party sharing, data-subject rights); controller–processor contracts when processing is outsourced; cross-border transfer restrictions; and security standards. PDPC guidance indicates tracking/behavioral data can qualify as personal data where it can reasonably identify a person. Penalties include administrative fines reported up to ~THB 5 million plus potential criminal liability for certain violations.

**Needs Professional Review:** Everything BANHAO-specific — particularly (a) real-time driver GPS tracking, which is among the most sensitive data flows in the design (`design/tracking/`, Admin Live Map wireframe), (b) whether a DPO appointment is required, (c) lawful basis per data flow, and (d) cross-border transfer implications if any chosen infrastructure or vendor sits outside Thailand (directly relevant to the hosting decision in `ai/RESEARCH/INFRASTRUCTURE.md` — a Singapore-region cloud deployment is a cross-border transfer).

**Cross-reference:** `ai/RESEARCH/SECURITY_ARCHITECTURE.md` § Data Privacy flags that no retention/access policy exists yet for location data, phone numbers, or payment references.

---

## 2. Bank of Thailand — payment services regulation

**Confirmed:** The **Payment Systems Act B.E. 2560 (2017)** (effective 16 April 2018) is the core framework; BOT is the primary regulator, with the Ministry of Finance issuing certain licenses on BOT's recommendation. BOT's own site documents five categories of **Designated Payment Services** requiring licensing/registration: card services; **electronic money (e-money)**; **payment facilitation** ("accepting electronic payment for and on behalf of others"); electronic money transfer; and a catch-all category. E-money issuers must fully reserve issued float in bank accounts. Payment service providers are subject to AML/CFT obligations (KYC, transaction monitoring, suspicious transaction reporting).

**Confirmed (industry pattern):** Routing payments through a BOT-licensed PSP/gateway — rather than the platform holding its own license — is a common, documented pattern among Thai marketplaces; this is essentially the market that the PSPs in `ai/RESEARCH/PAYMENT_RESEARCH.md` serve.

**Needs Professional Review — and this is the single most important compliance question for BANHAO:** where the line falls between "using a licensed PSP's rails" and BANHAO itself performing a licensable **payment facilitation** activity. This matters enormously because of BANHAO's own documented design: `docs/04-payment` specifies that BANHAO calculates splits, runs merchant/driver transfer rounds ("รอบโอน"), and tracks driver-held cash as a platform liability (DEC-004). If the platform ever holds, nets, or custodies merchant/driver funds outside the PSP's own settlement flow — even briefly — that may implicate the payment-facilitation category regardless of using a licensed PSP. Public sources do not resolve this boundary; it is fact-specific and requires Thai counsel plus the chosen PSP's compliance team.

**Also Needs Professional Review:** current capital/threshold figures verified against primary BOT notification documents (a secondary source reported an e-money capital requirement in the THB 100 million range; this was **not** independently verified against a primary BOT capital table and should not be relied on), and whether AML/CFT obligations attach to BANHAO directly.

---

## 3. Marketplace / split-payment / sub-merchant structuring

**Confirmed:** Thailand has an active market of BOT-licensed payment gateways that market to marketplaces. PromptPay QR is Thailand's national real-time payment rail (via National ITMX), accessed through a bank or licensed PSP integration rather than being a payment facilitator itself.

**Unknown:** Public search did not surface a primary BOT document defining "marketplace" or "sub-merchant" as a formal legal category the way card-network rules do in other jurisdictions. This may mean such guidance exists in BOT circulars or PSP contractual terms that aren't publicly indexed, or that Thailand relies on the general "payment facilitation" category above instead of a marketplace-specific regime. Either way, the specific compliant structuring (merchant-of-record designation, whether restaurants and drivers must be onboarded as sub-merchants with their own KYC, settlement timing rules) is **not** resolvable from public sources.

**Needs Professional Review:** This should come directly from the chosen PSP's compliance team plus Thai counsel — it is a direct input to Q-002 (settlement/legal model), which remains open.

---

## 4. Tax / VAT

**Confirmed:** Thailand has a standard VAT regime; a Thai-incorporated marketplace operator registers for VAT under the Revenue Code once turnover thresholds are met, in the ordinary course. Separately, the Act Amending the Revenue Code (No. 53) B.E. 2564 (2021), effective 1 September 2021, introduced VAT rules for "e-Services" and "e-Platforms" — but that regime explicitly targets **foreign (non-resident)** providers earning over THB 1.8 million/year from non-VAT-registered Thai customers, registering via the Revenue Department's Simplified VAT for e-Service (SVE) system. Where a foreign e-service provider sells through a platform, the platform operator can become liable to remit VAT on that provider's behalf.

**Relevance:** As a local Thai platform, BANHAO is likely governed by ordinary domestic VAT/corporate tax rules rather than the foreign e-service regime — but "likely" is doing real work in that sentence and is exactly why this needs review.

**Unknown:** No specific Thai statute or Revenue Department guidance dedicated to gig-economy/platform-driver income tax was found in this pass. Drivers as independent earners would presumably fall under general personal income tax self-assessment, but this was not confirmed.

**Needs Professional Review:** How domestic VAT applies to BANHAO's commission/fee revenue; whether cash vs. PromptPay flows change invoicing/VAT documentation obligations (relevant because `docs/04-payment` already treats the two flows differently — cash orders skip transfer rounds entirely); and any withholding-tax obligations on payments to restaurants and drivers (a distinct question from VAT, not investigated in depth here).

---

## 5. Gig worker / driver employment classification

**Confirmed:** Delivery riders in Thailand are currently generally treated by platforms as freelancers/independent contractors, placing them outside Labor Protection Act (1988) coverage and the Workmen's Compensation Act (1994) — meaning no automatic injury/illness income protection. There is active public and academic discussion about this; a 2022 Thailand Development Research Institute (TDRI) study reportedly found many riders work under employment-like conditions (set hours, pay scales, penalties) despite formal contractor status.

**Unknown:** No confirmed Thai court ruling or new legislation reclassifying delivery riders was located.

**Research caveat worth recording:** an initially-promising search result about a "gig delivery worker employment status ruling" turned out to be a **Hong Kong** case (Deliveroo Hong Kong), not Thai precedent. It is not applicable and must not be cited as such. This is a concrete illustration of why each citation needs a jurisdiction check before use.

**Needs Professional Review:** BANHAO's driver-partner agreements, working-condition rules (algorithmic dispatch, the documented 12-second accept window, the cash-remittance limit that auto-suspends job assignment per `docs/04-payment`), and payment structure all touch the factors that reclassification arguments typically turn on. Thai labor counsel should assess this rather than the project relying on the current contractor assumption.

---

## 6. Consumer protection (OCPB)

**Confirmed:** The **Consumer Protection Act B.E. 2522 (1979)**, last amended 2019, administered by the **Office of the Consumer Protection Board (OCPB / สคบ)**, is Thailand's principal consumer protection law and complaint/redress mechanism. OCPB has increased scrutiny of e-marketplace platforms generally.

**Confirmed and directly relevant:** OCPB has an initiative referred to as **"Dee-Delivery"** imposing requirements on logistics/delivery providers offering **cash-on-delivery** services, reportedly being formalized into regulation. This is directly on-point for BANHAO's Phase 1 cash payment flow.

**Needs Professional Review:** Whether and how the Dee-Delivery cash-on-delivery requirements apply to BANHAO's specific cash flow, and whether any Direct Sales and Direct Marketing Act licensing obligations attach to a food-delivery marketplace (applicability unclear from general sources).

---

## Summary

| Area | Confirmed | Needs Professional Review | Unknown |
|---|---|---|---|
| ETDA Digital Platform Decree | Decree, regulator, thresholds exist | Whether BANHAO must file, and in which form | — |
| PDPA | Law, regulator, general obligations | GPS tracking, DPO, lawful basis, cross-border transfer | — |
| BOT payment regulation | Act, licence categories, PSP-intermediary pattern | **Whether BANHAO's split/transfer-round/cash-liability design itself triggers payment-facilitation licensing** | Verified capital thresholds |
| Marketplace/sub-merchant structuring | PSP market exists; PromptPay is a national rail | Compliant structuring, merchant-of-record, sub-merchant KYC | No public Thai marketplace-specific regime found |
| Tax/VAT | Domestic VAT regime; foreign e-service regime | Commission VAT treatment, cash vs. digital invoicing, withholding tax | Gig-driver-specific tax rules |
| Driver classification | Current contractor treatment; exclusion from labor protections | Reclassification risk given BANHAO's dispatch/penalty mechanics | No confirmed Thai ruling/statute |
| Consumer protection | CPA 1979, OCPB, Dee-Delivery initiative | Dee-Delivery applicability to BANHAO's cash flow; Direct Marketing licensing | — |

**Nothing in this table should be treated as settled or compliant on the basis of this research.** Every row has at least one item requiring professional review. The three highest-stakes items, in order: the BOT payment-facilitation boundary question (§2), ETDA notification (§ priority finding), and PDPA treatment of driver location data (§1).

This research adds no new `DECISION` and closes no open question. It does add new open questions — see Q-015 through Q-017 in `ai/KNOWLEDGE/QUESTIONS.md`.
