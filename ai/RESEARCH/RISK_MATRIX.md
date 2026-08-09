# Risk Matrix

Risks identified from BANHAO's documented design and this research pass. Probability and Impact are **assessments, not measurements** — no incident data exists (nothing is built). Severity = rough combination of the two. "Owner" indicates who must act; "Decision Required" flags risks that can't be mitigated without a Product Owner decision first.

Scale: Probability = Low/Medium/High. Impact = Low/Medium/High/Critical. Severity = Low/Medium/High/Critical.

---

## Payment & financial integrity

| Risk | Prob. | Impact | Severity | Mitigation | Owner | Decision Required |
|---|---|---|---|---|---|---|
| **Payment marked successful without provider confirmation** (client-trusted payment state) | Low | Critical | **High** | Already structurally prevented by CON-002/DEC-003 — webhook-only confirmation with signature verification. Risk is implementation drift, not design gap. Mitigate with tests asserting no non-webhook code path can set `SUCCESS`. | Engineering | No — constraint already accepted |
| **Duplicate webhook processed twice → double ledger entry** | Medium | Critical | **Critical** | REQ-003 requires idempotency keyed on payment reference. Enforce at the database level (unique constraint), not only in application code. See `ai/RESEARCH/QUEUE_ARCHITECTURE.md` on why DB-backed queueing helps here. | Engineering | No — requirement already accepted |
| **Ledger fails to balance to zero** (money unaccounted) | Medium | Critical | **Critical** | CON-003 requires zero-balance per order; the Admin reconciliation screen already designs for detecting this. Needs transactional writes (ACID) — a direct input to the database decision (Q-007). | Engineering | **Yes — Q-007** |
| **Platform-facilitation licensing breach** (BOT) | Unknown | Critical | **Critical** | BANHAO's design has the platform calculating splits, running transfer rounds, and holding driver-cash liability — which may itself constitute regulated payment facilitation even when using a licensed PSP. See `ai/RESEARCH/THAILAND_COMPLIANCE.md` §2. | Product Owner + Thai counsel | **Yes — Q-002, and legal review** |
| **Chargeback handling undefined** | Medium | High | **High** | No chargeback flow exists anywhere in the design (`ai/RESEARCH/MARKETPLACE_PAYMENT_MODEL.md`). Money can be reversed by a bank after BANHAO has already paid out merchant and driver. | Product Owner | **Yes — Q-011** |
| **Payment provider outage blocks all digital orders** | Medium | High | **High** | Cash remains available as a fallback (already a Phase 1 method), which materially softens this. Consider provider-status monitoring and graceful degradation to cash-only. | Engineering | Partially — depends on Q-001 |

## Fraud

| Risk | Prob. | Impact | Severity | Mitigation | Owner | Decision Required |
|---|---|---|---|---|---|---|
| **Driver under-reports or absconds with collected cash** | Medium | High | **High** | Partially mitigated by the documented cash-remittance limit that auto-suspends job assignment — but the limit's actual value is undecided (Q-004). Ledger tracks the liability (DEC-004), so detection exists; prevention is the gap. | Product Owner | **Yes — Q-004** |
| **Driver falsifies delivery status or GPS location** | Medium | Medium | **Medium** | No anti-spoofing mechanism designed (`ai/RESEARCH/SECURITY_ARCHITECTURE.md`). Options (photo proof, customer confirmation, GPS plausibility checks) all require product design work. | Product Owner | **Yes — Q-013** |
| **Merchant manipulates prices after order placed** | Low | Medium | **Medium** | Price should be captured immutably at order creation — a modeling requirement worth stating explicitly before implementation. | Engineering | No |
| **Customer falsely claims non-delivery to trigger refund** | Medium | Medium | **Medium** | Refund rules exist (auto before `PREPARING`, support-center after `PICKED_UP`) which limits blast radius, but no abuse-detection is designed. | Product Owner | **Yes — Q-013** |

## Operational & technical

| Risk | Prob. | Impact | Severity | Mitigation | Owner | Decision Required |
|---|---|---|---|---|---|---|
| **Duplicate order created** (double-tap, retry) | Medium | Medium | **Medium** | Idempotency on order creation, same pattern as payment (REQ-003) but not currently stated as a requirement for orders. | Engineering | No |
| **Database failure / data loss** | Low | Critical | **High** | Managed database with automated backups + tested restore procedure. Backup strategy is an input to Q-007. | Engineering | **Yes — Q-007** |
| **Infrastructure outage** | Medium | High | **High** | Depends entirely on hosting choice — see `ai/RESEARCH/INFRASTRUCTURE.md`. Single-VPS deployments carry materially higher risk than managed/multi-AZ options. | Product Owner | **Yes — Q-009 (hosting)** |
| **Maps API cost escalation** | Medium | Medium | **Medium** | Per-request maps pricing scales with driver-location update frequency, which is an engineering choice — a design that polls location aggressively can multiply cost. Self-hosted OSM routing trades this for ops cost. See `ai/RESEARCH/MAPS_LOCATION.md`. | Engineering + Product Owner | Partially |
| **Real-time mechanism doesn't scale past Stage 2** | Low | Medium | **Medium** | Polling-first then upgrading is a legitimate staged path (`ai/RESEARCH/REALTIME.md`); risk is low because the scale ramp is gradual and the fix is well-understood. | Engineering | No |
| **Vendor lock-in constrains later migration** | Medium | Medium | **Medium** | Favor portable choices where cost is comparable (see lock-in column in `ai/RESEARCH/DECISION_MATRIX.md`). Payment provider lock-in is the hardest to reverse, since it touches money movement and merchant onboarding. | Product Owner | **Yes — Q-001** |
| **Scaling beyond Stage 2 requires architecture rework** | Low | Medium | **Medium** | Modular-monolith-with-clean-boundaries keeps the split-later path open (`ai/RESEARCH/ARCHITECTURE_PATTERN.md`). | Engineering | **Yes — Q-006 (indirectly)** |

## Compliance & legal

| Risk | Prob. | Impact | Severity | Mitigation | Owner | Decision Required |
|---|---|---|---|---|---|---|
| **ETDA Digital Platform notification not filed** | Medium | High | **High** | Newly surfaced in this research (`ai/RESEARCH/THAILAND_COMPLIANCE.md`). ETDA has announced increased enforcement including criminal penalties for non-notification. Even sub-threshold platforms may owe a short-form filing. | Product Owner + Thai counsel | **Yes — Q-015** |
| **PDPA non-compliance on driver location data** | Medium | High | **High** | Continuous GPS tracking is among the most sensitive flows in the design; no retention/access policy exists. | Product Owner + Thai counsel | **Yes — Q-012** |
| **Driver reclassified as employee** | Unknown | High | **High** | Unsettled area in Thailand; BANHAO's dispatch mechanics (12-second accept window, cash-limit auto-suspension) touch the factors reclassification arguments typically turn on. | Product Owner + Thai labor counsel | **Yes — legal review** |
| **OCPB "Dee-Delivery" cash-on-delivery rules apply** | Medium | Medium | **Medium** | Directly relevant to Phase 1's cash flow; requirements not yet assessed. | Product Owner + Thai counsel | **Yes — Q-017** |
| **VAT/withholding treatment wrong on splits** | Medium | High | **High** | Commission revenue, cash-vs-digital invoicing differences, and merchant/driver withholding are all unassessed. | Product Owner + Thai tax advisor | **Yes — legal/tax review** |

---

## Highest-severity risks (Critical)

1. **Duplicate webhook → double ledger entry** — mitigation already specified (REQ-003); needs disciplined implementation.
2. **Ledger fails to balance** — mitigation specified (CON-003); depends on database choice (Q-007).
3. **Payment-facilitation licensing breach** — genuinely unresolved, needs legal review before any payment implementation. This is the single risk most likely to invalidate architectural work if answered late.

## Note on probability estimates

Every probability above is a judgment made without incident data, because BANHAO has no running system. These should be revisited once real operational data exists — the same rule that applies to `ai/RESEARCH/SCALE_MODEL.md`'s assumptions.
