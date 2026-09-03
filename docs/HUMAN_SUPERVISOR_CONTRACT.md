# Human Supervisor — implementation contract

**Phase I, aligned to DEC-040.** Written 2026-09-03, at the start of Phase I
implementation. This document is the *contract* between two design packages
that already exist and the code being built from them. It creates no new
design: where a surface is designed elsewhere, this file points at it.

**Authoritative sources, in order:**

1. [`docs/DECISIONS.md`](DECISIONS.md) — **DEC-040** binds every line below.
2. `docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html`
   — § 09 is the Human Supervisor console design (screens S-01 … S-07).
3. `docs/design/BANHAO ADMIN - Operations - Phase I.dc.html` — the operator
   surface design (screens A-01 … A-22), its permission matrix, its command
   discipline, and its **DO NOT BUILD** list.
4. The deployed schema and the shipped API.

## 1. Why there are two packages, and how they divide

They are not competing designs. They describe the same operator, on two
different days:

| | Admin — Operations (A-xx) | AI Operations § 09 (S-xx) |
|---|---|---|
| Question it answers | "A payment does not match — what happened?" | "Automation could not finish something — what needs a person?" |
| Entry point | Counters and queues over domain tables | Escalations raised by the AI Operations pipeline |
| Bulk of its scope | Payments, refunds, reconciliation, ledger, settlement | Exceptions, approvals, takeover, case closure |
| Blocked by | Q-001, Q-002, Q-010, Q-020, Q-032 (money) | BQ-013, UX-Q-006, OD-04, BQ-015 (operational policy) |

**Phase I's first deliverable is the S-xx half**, for one reason that is
structural rather than preferential: Phase J now writes escalations that
nothing can read. Every AI escalation today is an `audit_logs` row with
`actor_type = 'AI'` and no surface — the design package's own § 09 opens with
"success is an empty inbox", and there is currently no inbox at all. The A-xx
financial half is mostly gated behind the money decisions listed above and
stays designed-not-built.

## 2. What the Human Supervisor is, and is not

**Is:** an exception-handling surface, an approval surface for L4, an
investigation surface, a controlled command surface, an audit-aware decision
surface.

**Is not:** generic admin CRUD, a second domain authority, a financial
operations console, or any path to the database that is not a named endpoint.

The architecture is one direction only:

```
AI / automated operations → escalation → Human Supervisor → typed command
  → existing guarded domain authority → verification → audit
```

## 3. Authorization — reused, not invented

No new role, permission model or table. The model already exists and is
already enforced server-side:

- `platform_staff.staff_role` is CHECK-constrained to `OPERATOR` and `ADMIN`
  (the Admin package § 02 says the same: "There is no third").
- `CapabilitiesService` resolves the grant **per request, uncached**, from
  `platform_staff`, and fails closed.
- `@Roles('OPERATOR', 'ADMIN')` + `RolesGuard` enforce it on the server.
  A hidden or disabled control is presentation, never the boundary.

Anything needing a capability these two roles cannot express is out of scope
until an authorization decision creates one.

## 4. The case projection — no new table, no migration

DEC-040 § 9 forbids an `ai_operations_cases` table, and the AI Operations
package's own **AI-02** designs the V1 console as a *projection* over `jobs`,
`audit_logs` and `reconciliation_cases` precisely so that no migration is
required. That is what is built:

| Concept | Where it actually lives |
|---|---|
| A case | One `audit_logs` row written by AI Operations whose `action` starts `AI_OPS_` and whose `after.escalation` is set. **The case id is that row's id.** |
| Case subject | That row's `entity_type` + `entity_id` (`order` or `delivery`) |
| Why it escalated | `reason` (prefixed with the escalation id) and the `after` payload |
| Case state | **Derived.** `OPEN` unless a later `audit_logs` row resolves it — see below |
| Resolution | A **new append-only** `audit_logs` row, `action = AI_OPS_CASE_RESOLVED`, human `actor_type`, mandatory `reason`, `after.caseId` naming the case |

Nothing is updated and nothing is deleted: `audit_logs_reject_mutation`
refuses both for every role including `service_role`, and Phase I does not
weaken it. A correction is a further row, never an edit.

**Financial reconciliation cases (`reconciliation_cases`) are deliberately not
folded into this projection.** Its `kind` CHECK has no AI-operations value,
widening it is a migration Phase I is not authorized to make, and the Admin
package keeps that queue as its own screen (A-20) for a reason its § 05 states:
two different people may be resolving two different halves.

## 5. Command model

Supervisor actions go through named endpoints under `/api/v1/admin/`, never
through a generic mutation. There is no `executeSql`, no `updateRow`, no
`adminMutation`, and no direct Supabase read from the admin app (DEC-APP-008).

Phase I's first command is **case resolution**, and it is deliberately the
weakest possible one: it writes an audit row and changes no domain state at
all. Every command that *would* change domain state — cancel, release,
redispatch, pause a merchant, refund — is either gated on an open decision
(§ 6) or belongs to the A-xx financial half.

## 6. Blocked, and rendered as blocked

Per the Admin package's interaction rules and DEC-040 § 5, a control whose
policy does not exist is **not** shipped as a hopeful button:

| Surface | Blocked by | How it is presented |
|---|---|---|
| L4 approval of `pause_merchant` | **BQ-013** — no auto-pause threshold exists | Not built. The console states the dependency; no approve control exists to press |
| No-rider terminal outcome (cancel / fail) | **UX-Q-006** | No control. The case can be resolved with a reason; the delivery is untouched |
| Safe drop-off, customer-unavailable resolution | **OD-04**, UX-Q-006 | Not built |
| Failed delivery, cost of wasted food | **BQ-015**, DEC-APP-006 | Not built. `DELIVERY_FAILED` stays unimplemented |
| Repeated rider cancellation consequences | **Q-032** | Not built |
| Refund, settlement, earnings, ledger writes | Q-001, Q-002, Q-010, Q-020 · CON-002 · DEC-034 | Not built, and absent from the command surface entirely — not merely disabled |

## 7. Information principle

The supervisor sees what an operational decision needs and no more: order and
delivery state and history, dispatch and offer counts, merchant acceptance
state, the AI's recommendation and evidence, escalation reason, and relevant
audit history. It does **not** surface payment credentials, provider
references, secrets, unrestricted rows, or financial amounts — the same
projection discipline DEC-040 § 3 imposes on the agent, applied to the console
for the separate reason that Phase I's money surfaces are blocked anyway.

## 8. Acceptance conditions for the Phase I units built here

1. A staff user with an active `platform_staff` grant reaches the console; one
   without reaches a refusal, and the endpoint refuses regardless of the UI.
2. Every AI escalation written by Phase J is listable, with its subject, its
   escalation id, its reason and its age.
3. A case opens onto live authoritative domain state, re-read at render time —
   never the stale copy captured in the audit payload.
4. Resolving a case requires a reason, writes exactly one append-only audit row
   with correct **human** attribution (never `SYSTEM`, never `AI`), and is
   refused if the case is already resolved.
5. No control exists anywhere for an action whose policy is open.
