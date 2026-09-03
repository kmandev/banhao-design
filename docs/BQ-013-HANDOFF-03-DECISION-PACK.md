# BANHAO — BQ-013 + HANDOFF-03 PRODUCT DECISION PACK

**Status: DECISION PREPARATION ONLY. Nothing in this document is approved, and
nothing in it decides anything.**

Prepared 2026-09-03 by read-only inspection of `feature/g7-driver-availability`
at `67458253`. It selects no policy value, creates no `DEC-` number, changes no
existing decision, and authorizes no implementation. Its single purpose is to
put in front of the Product Owner the exact questions that block the L4
`pause_merchant` command, each one with the evidence that makes it a question.

---

## 1. Executive Summary

The Human Supervisor console is built and shipped on this branch (inbox, case
detail, close-with-reason). The **one** command that would change merchant state
— `pause_merchant` — is designed, not built, and cannot be built, for two
independent reasons:

1. **BQ-013 is `OPEN`.** Six policy values govern the command. The repository
   contains an approved value for **none** of them. One adjacent number (the
   3-minute acceptance *window*) is approved, but the *consequence* at expiry
   is explicitly not.
2. **HANDOFF-03 is unresolved.** Nobody has decided what a pause actually
   writes. `restaurants.status` has no `PAUSED` value; the temporary-closure
   columns exist but their semantics sit behind `BQ-007`, which is also `OPEN`.

These are separate decisions with separate owners' inputs. Answering BQ-013
without HANDOFF-03 yields a policy with no mutation; answering HANDOFF-03
without BQ-013 yields a command whose `until` argument has no value. Both are
required before implementation.

The current codebase already behaves correctly in the face of this: the Phase J
policy source returns `MISSING` and fails closed, and the L4 design renders the
approve control disabled with the blocker named. **Nothing is broken and nothing
is waiting on engineering.** The work is waiting on a business decision.

---

## 2. Authoritative Evidence

Read at `feature/g7-driver-availability@67458253`. Working tree clean apart from
untracked `.claude/`.

| Source | What it establishes |
|---|---|
| `docs/OPEN_BUSINESS_QUESTIONS.md:559` | BQ-013 — `status: OPEN`, `priority: P1`, `owner: PRODUCT_OWNER` |
| `docs/OPEN_BUSINESS_QUESTIONS.md:334` | BQ-007 — `status: OPEN`, `priority: P1`, `owner: PRODUCT_OWNER`, blocks "Catalogue module, order validation" |
| `docs/ORDER_LIFECYCLE.md:201` | Merchant accept window `3 minutes` — "`ACCEPTED` (value) · behaviour at expiry `OPEN` — BQ-013" |
| `docs/ORDER_LIFECYCLE.md:178, 277, 296` | Rejection flow accepted; auto-reject-vs-escalate `OPEN` |
| `docs/DECISIONS.md` DEC-040 §5, §10 | A missing decision is never a licence to choose a default; BQ-013's auto-pause threshold "does not exist, so Phase J may not hard-code one — auto-pause is a supervisor action with a recorded reason until a decision supplies the number" |
| `docs/HUMAN_SUPERVISOR_CONTRACT.md:113` | "L4 approval of `pause_merchant` — blocked by BQ-013 — Not built. The console states the dependency; no approve control exists to press" |
| `docs/design/BANHAO HUMAN SUPERVISOR - L4 PAUSE MERCHANT - FLOW.dc.html` | The L4 flow design; `HANDOFF-01/02/03`; `AC-01`…`AC-14`; renders every BQ-013 value as `[BQ-013 DECISION REQUIRED]` |
| `docs/design/BANHAO AI OPERATIONS - Agent + Human Supervisor - Design Package.dc.html` | § 09 supervisor screens, § 10 playbooks, `AI-02` projection-not-table |
| `supabase/migrations/20260811000002_merchant_domain.sql:117-120` | The `restaurants` status CHECK and the two temporary-closure columns |
| `apps/api/src/modules/ai-ops/merchant-acceptance-policy.ts` | Production policy source returns `MISSING`, dependency `BQ-013` |
| `apps/api/src/modules/ai-ops/command-catalog.ts` | The whole catalog: one L2 notification command, no state-changing entry |

### Known fact vs. existing decision vs. recommendation vs. open policy

This distinction is load-bearing throughout the pack:

| Class | Meaning here | Example in this pack |
|---|---|---|
| **Known fact** | Something the repository or schema demonstrably contains | `restaurants.status` CHECK lists five values, none of them `PAUSED` |
| **Existing decision** | Carries a `DEC-` number or an `ACCEPTED` tag | 3-minute merchant accept **window** (`ACCEPTED` value) |
| **Recommendation** | Written analysis proposing an answer, with no approval | BQ-013's own "Recommendation: A as the system rule, with B as an ops overlay" |
| **Open policy** | Undecided; guessing is forbidden by DEC-040 §5 | Everything in §4 below marked `OPEN` |

**A recommendation is not a decision.** BQ-013 contains a recommendation. It has
never been approved, carries no `DEC-` number, and must not be read as one.

---

## 3. BQ-013 Current State

```yaml
id: BQ-013
title: Merchant accept timeout behaviour
priority: P1
owner: PRODUCT_OWNER
status: OPEN
blocks: Order state machine, merchant SLA
```

What BQ-013 as written **does** contain: the question ("what happens at 3:00
exactly?"), three options, a recommendation, and an impact statement.

What it **does not** contain: any approved number, any approved consequence, and
any mention at all of auto-pause threshold, reliability window, pause duration,
cooldown or resume path. The L4 design states this plainly — that BQ-013
establishes a deadline should be server-side and configurable, and that
"Configurable is not a value."

Downstream effects visible in the code today, all correct and all fail-closed:

- `Bq013MerchantAcceptancePolicySource.resolve()` returns
  `{ status: 'MISSING', dependency: 'BQ-013' }`. The J-01 pipeline therefore
  escalates `ESC-UNKNOWN` **without reaching the agent**. There is no `?? 180`
  and no environment-variable fallback.
- The rider offer window (`DEC-037`, 60 s) is explicitly refused as a
  substitute: different actor, different decision, and reusing it would be
  "inventing the merchant policy by aliasing".
- No approve control exists in the shipped console.

---

## 4. BQ-013 Decision Matrix

| # | Input | Existing authoritative evidence | Current state | Decision required |
|---|---|---|---|---|
| 1 | **Merchant acceptance deadline** | `ORDER_LIFECYCLE.md:201` — 3 minutes, tagged `ACCEPTED` (value). DEC-040 §10 requires it stay server-side and configurable | **Value approved; consequence OPEN.** The window exists; what happens at expiry does not | Confirm 3 minutes is the deadline the pause policy counts against, and decide the expiry consequence (see #2) |
| 2 | **Consequence of non-response** | BQ-013 options A/B/C + recommendation (`OPEN_BUSINESS_QUESTIONS.md:559`); `ORDER_LIFECYCLE.md:178` marks auto-reject-vs-escalate `OPEN` | **OPEN** — recommendation only | Decide A, B, C, or another consequence |
| 3 | **Auto-pause threshold** (how many non-response events) | No value anywhere. DEC-040 §10: "its auto-pause threshold does not exist" | **OPEN** — value absent | Decide the count |
| 4 | **Reliability window** (over what period the threshold is measured) | No value anywhere | **OPEN** — value absent | Decide the window |
| 5 | **Pause duration** (the `until` argument) | No value anywhere. L4 design: `pause_merchant { restaurantId: —, until: [BQ-013 DECISION REQUIRED] }` | **OPEN** — value absent; the command signature is incomplete without it | Decide the duration, or decide that duration is per-case supervisor input |
| 6 | **Cooldown** (before another pause may occur) | No value anywhere | **OPEN** — value absent | Decide the cooldown |
| 7 | **Resume path** (how a paused merchant becomes active again) | No value anywhere. Note this is a *mechanism* question as much as a policy one, and overlaps HANDOFF-03 | **OPEN** — undefined | Decide automatic-on-expiry, supervisor action, merchant self-service, or a combination |

Four of the six inputs the L4 design names (#1 deadline, #3 threshold,
#4 window, #5 duration) are needed **just to make the command signature
complete**. #5 is the `until` argument literally.

---

## 5. Existing BQ-013 Options

Reproduced in summary from `docs/OPEN_BUSINESS_QUESTIONS.md:559`. No option is
added, and no option is endorsed.

These options answer **input #2 only** — the consequence of a single
non-response. They do **not** answer #3–#7, which the source document never
raises. Deciding an option below still leaves the auto-pause half of BQ-013
undecided.

### Option A — Auto-reject at expiry, refund automatically, suggest nearby shops

| Dimension | Consideration |
|---|---|
| Customer impact | Fast, deterministic resolution; customer is not left waiting. But an order they wanted is gone, and the source document notes a rejected order in a 20–30-shop district likely means a lost customer |
| Merchant impact | Loses the order with no human contact; no opportunity to recover a genuinely busy kitchen |
| Operational impact | Lowest ops load — no operator in the loop |
| Safety / reliability | Refund path is invoked automatically. That crosses into the payment domain, which is `CON-002`-governed and gated on money decisions (Q-001, Q-020) |
| Implementation | Needs a refund mechanism and an order-cancellation path; refund mechanism for PromptPay is `Q-020`-open |
| Reversibility | The rejection is not reversible for that order; the refund is a further transaction, not an undo |
| Dependencies | Q-020 (refund mechanism), DEC-027 (refund ≠ cancellation), payment provider (Q-001) |
| Must be explicitly decided | Whether an automatic refund is authorized without a human, and against which provider |

### Option B — Escalate to an operator at expiry

| Dimension | Consideration |
|---|---|
| Customer impact | Order may still be saved by a phone call; but the customer waits longer with an undetermined outcome |
| Merchant impact | Gets a human contact before losing the order |
| Operational impact | Highest — every expiry consumes operator time. The source document calls this "viable at launch volume, not at scale" |
| Safety / reliability | No automatic financial action; nothing irreversible happens without a human. This is the most conservative option financially |
| Implementation | This is what the shipped system already effectively does — J-01 escalates to `audit_logs`, and the Phase I console reads escalations. Closest to current behaviour |
| Reversibility | Fully reversible — escalation changes no domain state |
| Dependencies | Requires the supervisor console (built) and an operator on duty (DEC-031 Buntharik-first manual operations is an accepted capability) |
| Must be explicitly decided | Whether escalation is the terminal rule or an interim overlay, and what the operator is authorized to do next |

### Option C — Keep alerting, no timeout

| Dimension | Consideration |
|---|---|
| Customer impact | Worst case — the source document names "customers waiting indefinitely" as the failure |
| Merchant impact | No forced consequence at all |
| Operational impact | No automatic ops load, but no bounded outcome either |
| Safety / reliability | Unbounded order age; interacts badly with payment attempt expiry and QR validity (10 min) |
| Implementation | Simplest; the timer becomes advisory only |
| Reversibility | N/A — nothing happens |
| Dependencies | Would need a separate abandonment rule to stop orders living forever |
| Must be explicitly decided | What ultimately terminates such an order, if not this timer |

> **RECOMMENDATION ONLY — NOT AN APPROVED DECISION**
>
> `docs/OPEN_BUSINESS_QUESTIONS.md` records: "**A as the system rule, with B as
> an ops overlay** during the first months: auto-reject after 3 minutes, but
> raise an admin alert at ~90 seconds so a phone call can still save the order."
>
> This is analysis awaiting approval. It carries no `DEC-` number, it is not
> tagged `ACCEPTED`, and per `CLAUDE.md` §10 ("Implement only rules tagged
> `ACCEPTED`") it must not be implemented or treated as settled.

---

## 6. HANDOFF-03 Current State

**`pause_merchant` does not exist in any production surface.** Verified by
search across the branch:

| Surface | Result |
|---|---|
| AI Operations command catalog (`command-catalog.ts`) | **Absent.** The catalog holds exactly one entry, `notify_merchant_acceptance_deadline`, `autonomyLevel: 'L2'`, `domain: 'notification'`. The file states there is deliberately no command that moves order, delivery, payment or rider state |
| Domain command types | **Absent** |
| Service layer | **Absent** |
| Controller | **Absent.** `supervisor.controller.ts` exposes `GET me`, `GET cases`, `GET cases/:id`, `POST cases/:id/resolve` — and nothing else |
| Public API contract (`docs/06-api/openapi.json`) | **Absent.** Zero occurrences of the string `pause` |
| Database function | **Absent** |
| Anywhere else in production code | **Absent.** The only occurrences of `pause_merchant` in the repository are inside the L4 design HTML |

### Schema evidence

`supabase/migrations/20260811000002_merchant_domain.sql:117-120`:

```sql
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  temporarily_closed_until timestamptz,
  temporary_close_reason text,
```

- **`restaurants.status` does not contain `PAUSED`.** Five values, none of them a
  pause.
- **`temporarily_closed_until` and `temporary_close_reason` exist**, both
  nullable, neither constrained.
- **Neither column has an authorized writer.** `RestaurantProfileService`
  documents both in its explicit "What this never writes" list, alongside
  `status`. No API endpoint writes either one today.
- **`temporarily_closed_until` does have a live customer-facing reader.**
  `apps/customer/src/repositories/supabaseCatalog.ts:58` passes it into
  `deriveAvailability`, so a value written there would immediately change what
  customers see. `apps/customer/src/lib/openingHours.ts:181` deliberately
  excludes it from `nextOpening` because no copy is defined for that case.

### Existing status consumers — what a status change would move

`status = 'ACTIVE'` is read in six load-bearing places:

| Consumer | Effect of a non-`ACTIVE` status |
|---|---|
| `20260819000001_order_creation_function.sql:203` | Order creation is refused outright |
| `20260817000001_catalog_availability_visibility.sql:67` | `menu_items` become unreadable |
| `20260811000011_rls_policies.sql:205, 224, 245` | `restaurant_hours`, `menu_categories`, `menu_items` become unreadable under RLS |
| `apps/api/src/modules/cart/cart.service.ts:147` | Cart validation fails |
| `apps/merchant/.../restaurantMembershipQueries.ts:51` | Merchant console reads the status for its own display |

---

## 7. Pause Mutation Candidates

Presented as evidence. **None is selected, and none may be built.**

### Candidate A — Add a `PAUSED` value to `restaurants.status`

| | |
|---|---|
| Schema change | Additive widening of the `restaurants_status_check` CHECK constraint — a new migration |
| State machine | Introduces a sixth merchant status. Its transitions (`ACTIVE → PAUSED`, `PAUSED → ACTIVE`, and its relationship to `SUSPENDED`) are currently undefined |
| Authorization | Whatever writes it needs a new named endpoint; `RestaurantProfileService` explicitly never writes `status` |
| Migration | Migration #25. `CLAUDE.md` §10 forbids adding one without explicit instruction, and DEC-040 forbids Phase J making one |
| Impact on existing consumers | **Large and immediate.** All six consumers above key on `= 'ACTIVE'`, so a paused restaurant would lose menu readability under RLS, lose hours readability, fail cart validation, and refuse order creation. Whether all of that is *intended* by "pause" is itself part of the decision |
| Why not implementable now | The database is locked; the semantics of the new value are undefined; and no decision authorizes either |

**Status: NOT APPROVED · NOT IMPLEMENTABLE YET · REQUIRES PRODUCT/ARCHITECTURE DECISION**

### Candidate B — Use the temporary-closure columns

| | |
|---|---|
| Fields | `temporarily_closed_until timestamptz`, `temporary_close_reason text` — both already in the deployed schema |
| Schema change | **None required.** This is the only candidate that needs no migration |
| Why BQ-007 must come first | BQ-007 ("Opening hours, holidays, temporary close, and order cutoff") is `OPEN`. It is the question that would define what temporary closure *means* — its option A describes "a temporary-close flag with a reason and an auto-reopen time", but that is a recommendation, not an approved semantic. Using these columns for a supervisor-initiated punitive pause, when their designed purpose is a merchant-initiated operational closure, is a semantic decision BQ-007 owns |
| Live consumer | The customer app already reads `temporarily_closed_until` for availability. A pause written here would surface to customers through the existing closed state, with no new UI — and, per `openingHours.ts:181`, with **no "reopens at" copy defined**, because that path deliberately ignores the field |
| Merchant-facing consequence | Differs materially from Candidate A: the storefront closes, but menu and hours stay readable and the status pill still says active |
| Authorization | Needs a named endpoint; no writer exists today, and the profile service deliberately excludes both columns |
| Open sub-question | Whether a supervisor pause and a merchant temporary close should be distinguishable at all, given they would share one field |

**Status: NOT APPROVED · NOT IMPLEMENTABLE YET · REQUIRES PRODUCT/ARCHITECTURE DECISION (and BQ-007)**

### Candidate C — Another mechanism

Repository evidence for a third mechanism is thin and is recorded here only
because HANDOFF-03 names three possibilities:

- **`SUSPENDED` already exists** in the status CHECK, and `DEC-032`'s operator
  fallback discussion (`DECISIONS.md:1616`) lists "approve/suspend" among
  operator capabilities. Whether an automated-reliability pause is the same
  thing as an administrative suspension, or must be distinguishable from it, is
  undecided. No code writes `SUSPENDED` today either.
- **A no-mutation outcome** — the pause is recorded as an escalation and handled
  by a phone call, which is what the system does today. This is Option B of
  BQ-013 taken to its conclusion and would mean `pause_merchant` is never built.

No new mechanism is invented here.

**Status: NOT APPROVED · NOT IMPLEMENTABLE YET · REQUIRES PRODUCT/ARCHITECTURE DECISION**

---

## 8. Decision Dependencies

```text
BQ-013
  ├── acceptance deadline (window ACCEPTED; consequence OPEN)
  ├── acceptance consequence
  ├── auto-pause threshold
  ├── reliability window
  ├── pause duration          ← this is the `until` argument
  ├── cooldown
  └── resume path
          │
          ▼
     HANDOFF-02  (all six values present = command signature complete)
          │
          ▼
     HANDOFF-03
          │
          ├── pause mutation semantics
          │
          └── command / service contract
                    │
                    ▼
              implementation  ← BLOCKED
```

```text
BQ-007
   └── required if temporary-closure semantics (Candidate B) are selected
```

Additional dependency edges that exist in the evidence:

- **BQ-013 Option A → Q-020 / Q-001.** An automatic-refund consequence pulls in
  the payment provider and the PromptPay refund mechanism, both open, both
  gating Phase F′.
- **HANDOFF-01 → this whole package.** The L4 design was authored against
  `main` and records that the supervisor implementation is absent there. It is
  present on `feature/g7-driver-availability`. The Product Owner still owes a
  statement of which branch is authoritative; the design's § 14 was written
  against the `main` tree.
- **Candidate A → `CLAUDE.md` §10.** A migration requires explicit instruction.

Implementation is not unblocked by anything in this document.

---

## 9. Product Owner Decisions Required

**These are questions. This document does not answer any of them.**

### BQ-013

1. **Acceptance deadline** — is the approved 3-minute merchant accept window the
   deadline this policy counts against, and does it remain server-side and
   configurable as DEC-040 §10 requires?
2. **Consequence of non-response** — at expiry, does the system auto-reject and
   refund (A), escalate to an operator (B), keep alerting (C), or something
   else? If A, what authorizes the automatic refund while Q-020 is open?
3. **Auto-pause threshold** — how many non-response events trigger a pause
   proposal?
4. **Reliability window** — over what period is that threshold measured?
5. **Pause duration** — how long does a pause last? Is this a fixed policy value
   or per-case supervisor input? (This is the `until` argument; the command
   signature is incomplete without an answer.)
6. **Cooldown** — how long before the same merchant may be paused again?
7. **Resume path** — how does a paused merchant become active again: automatic
   expiry, supervisor action, merchant self-service, or a combination?

### HANDOFF-03

8. **What does `pause_merchant` actually mutate?** Name the table and column(s).
9. **Is the intended semantic a new `PAUSED` restaurant status (A), temporary
   closure (B), or another mechanism (C)?** Note the merchant-facing
   consequences differ materially — see §7.
10. **If temporary closure is intended, what exact BQ-007 semantics authorize
    it?** Specifically: may a supervisor-initiated punitive pause share the
    columns designed for a merchant-initiated operational closure, and must the
    two be distinguishable?
11. **What command / service owns the mutation?** A new named endpoint under
    `/api/v1/admin/`, per the contract's §5 command model?
12. **What state transitions are allowed** into and out of the paused
    condition, and what is its relationship to the existing `SUSPENDED` value?
13. **What verification must prove the pause actually took effect?** The design
    requires a re-read of the domain, not a `200` — `AC-09` states a command
    that returned success but fails verification must never render success.

### Also outstanding, and prior to both

14. **HANDOFF-01 — which branch is authoritative?** The L4 design was written
    against `main`, where none of the supervisor implementation exists. It
    exists on `feature/g7-driver-availability`. Until this is stated, the
    design's § 14 dependency map is measured against the wrong tree.

---

## 10. Implementation Gate

```text
CURRENT STATUS:
DESIGN EXISTS
POLICY NOT APPROVED
MUTATION SEMANTICS NOT APPROVED
IMPLEMENTATION BLOCKED
```

```text
No production implementation should begin until:
1. BQ-013 is decided.
2. HANDOFF-03 mutation semantics are decided.
3. Any BQ-007 dependency is resolved if applicable.
4. Claude Design updates/locks the L4 design.
5. Claude Code implements strictly against the locked design.
```

The one thing the L4 design says *is* buildable ahead of those — the S-04.A
blocked state — is still gated on step 4, because building it early against an
unlocked design is what step 5 exists to prevent. It is not authorized by this
document.

---

## 11. Non-Decisions / Explicitly Not Approved

This document does **not**:

- change BQ-013's `OPEN` status, its wording, or its options;
- change BQ-007 in any respect;
- create, imply, or reserve a `DEC-` number;
- mark anything `ACCEPTED`, `PROPOSED`, or resolved;
- select a BQ-013 option, or endorse the recommendation recorded there;
- select a pause mutation mechanism among Candidates A, B and C;
- authorize a migration, a CHECK widening, a column write, an endpoint, a
  command-catalog entry, or any UI control;
- authorize Phase J to supply a missing policy value — DEC-040 §5 stands
  unchanged;
- modify `CLAUDE.md`, `docs/CURRENT_STATUS.md`, the roadmap,
  `docs/HUMAN_SUPERVISOR_CONTRACT.md`, or either design package;
- resolve HANDOFF-01, which remains a Product Owner statement about branch
  authority.

Every value in §4 that reads `OPEN` is open after this document exactly as it
was before it.
