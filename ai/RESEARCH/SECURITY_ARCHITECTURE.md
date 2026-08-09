# Security Architecture Analysis

This is analysis of what security *concerns* apply to BANHAO, grounded in the already-accepted constraints in `AGENTS.md` and `ai/KNOWLEDGE/CONSTRAINTS.md`. It does not select specific tools/products for any of these — those depend on the backend/infrastructure choices still open (Q-006, Q-007).

## Authentication & Authorization

Covered in depth in `ai/RESEARCH/AUTHENTICATION.md` for the authentication side. Authorization (what an authenticated user is allowed to do) needs at minimum role separation across the four surfaces (Customer, Merchant, Driver, Admin) plus finer-grained checks within each (e.g. a Merchant user should only see/manage their own shop's orders, never another shop's — this is implied by REQ-002/CON-001 but not explicitly spelled out anywhere in the current design docs, and is flagged here as a gap).

## RBAC (Role-Based Access Control)

At minimum, four roles map directly to the four client surfaces. Admin likely needs sub-roles eventually (e.g. the "คิวอนุมัติ" / approval queue wireframe implies someone approves things — is that every Admin user or a restricted subset?) — not specified anywhere in the repository. Flagged as a design gap, not resolved here.

## API Security

Whatever API is eventually built (Q-006-dependent) needs: authenticated requests (tied to Authentication above), input validation at the boundary (per this project's own working principle in the system-level instructions this task operates under: "Only validate at system boundaries"), and protection against common API abuse (see Rate Limiting below).

## Rate Limiting

Directly relevant to two already-documented mechanics: OTP request abuse (a classic SMS-cost-draining attack — send OTP requests in bulk to run up a victim's or the platform's SMS bill) and the driver-job "รับงาน · 12 วิ" (12-second accept window, from the Driver App wireframe) which implies the dispatch/assignment endpoint needs abuse protection too. No specific rate-limiting technology is chosen here.

## Secret Management

CON-005 (`AGENTS.md`, `ai/KNOWLEDGE/CONSTRAINTS.md`) already establishes: no secrets in Git, no hardcoded payment credentials. The technical mechanism (environment variables, a secrets manager, a cloud provider's built-in secret store) depends on the infrastructure choice (`ai/RESEARCH/INFRASTRUCTURE.md`) — every infrastructure option researched there supports *some* form of environment-based secret injection, so this constraint is satisfiable regardless of which infra option is eventually chosen.

## Webhook Verification

Directly required by CON-002/DEC-003: payment confirmation must come only from a verified provider webhook. "Verified" specifically means signature verification (checking the webhook payload against a cryptographic signature the provider includes, using a shared secret or public key, so an attacker can't simply POST a fake "payment succeeded" event to the endpoint). This is a hard requirement regardless of which payment provider is chosen (`ai/RESEARCH/PAYMENT_RESEARCH.md`) — every credible payment provider supports webhook signature verification; a provider that didn't would itself be a disqualifying finding.

## Encryption

Two distinct concerns: **in transit** (HTTPS everywhere — standard, not specific to BANHAO) and **at rest** for genuinely sensitive fields (e.g. partial bank account references shown in the Admin payment-transaction-detail wireframe, which the design itself already redacts: "แสดงเฉพาะเลขอ้างอิงบางส่วน ไม่แสดงเลขบัญชีเต็ม" — "show only a partial reference number, never the full account number" — this is an existing design-level privacy decision worth preserving in implementation, not a new recommendation).

## Audit Logs

CON-003 (ledger must balance to zero) and the reconciliation workflow (`ai/RESEARCH/MARKETPLACE_PAYMENT_MODEL.md`) both imply that every financial state change needs an immutable trail — who/what changed a Payment or Order state, and when. This overlaps with the "auditable ledger concepts" rule already in `AGENTS.md`. Beyond finance, the Admin "force-release a driver" action (`A-03` wireframe: "ปุ่มบังคับปลดงาน" — force-unassign button) is exactly the kind of privileged action that should be audit-logged, since it's a manual override of automated dispatch.

## Fraud Prevention

Several fraud vectors are implied by the domain, none currently mitigated in design (all are gaps, flagged honestly rather than assumed solved):

- **Driver fraud**: false "picked up"/"delivered" status claims, fake GPS location. No anti-spoofing mechanism is documented.
- **Merchant fraud**: false "order ready" claims, or manipulating menu prices after an order is placed. No mechanism documented.
- **Customer fraud**: false "never received" claims to trigger refunds; promo/referral abuse (no promo system exists yet in the design, so this is speculative).
- **Cash reconciliation fraud**: a driver under-reporting cash collected. Partially mitigated structurally by the existing cash-remittance-limit mechanism (Q-004), but the limit's actual value is still undecided.

These are listed as **open design gaps requiring product/security design work**, not solved by this document.

## Data Privacy

Overlaps with `ai/RESEARCH/THAILAND_COMPLIANCE.md` (PDPA). From a pure security-architecture lens: location data (customer delivery address, live driver position), phone numbers, and partial payment references are the most sensitive data categories evident in the current design — each needs an explicit retention/access policy, none of which exists yet.

## Summary of gaps this document surfaces (not resolved here)

1. Fine-grained authorization rules beyond role-level separation — undocumented.
2. Admin sub-roles for approval actions — undocumented.
3. Anti-fraud mechanisms for driver/merchant/customer fraud vectors — undocumented, no mitigation designed.
4. Data retention/access policy for sensitive fields — undocumented (ties into `ai/RESEARCH/THAILAND_COMPLIANCE.md`).

These are candidates for new open questions — see Q-012 through Q-014 added in `ai/KNOWLEDGE/QUESTIONS.md` by this research task.
