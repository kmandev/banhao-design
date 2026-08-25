# BANHAO — Driver App Design Questions

Open UX/product questions surfaced while implementing the Driver App, recorded
rather than answered. Same discipline as `docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md`'s
`DQ-01…DQ-05`: **a `DESIGN_QUESTION` is not permission to make a product
decision.** Where a question is open, the implementation takes the narrowest
behaviour the authoritative documents already fix, and states what it did not
decide.

**Authority order:** `CLAUDE.md` → any `DEC-NNN` → `docs/BANHAO-APP-ARCHITECTURE-V1.md`
(V1.1) → `docs/design/BANHAO-UX-DESIGN-HANDOFF-V1.md`.

Status legend: `OPEN` — undecided · `ANSWERED` — closed by a recorded decision.

---

## DQ-G7-01 — Which strip variant each non-approved rider status wears

```yaml
raised: 2026-08-25 (G7)
status: OPEN
owner: PRODUCT_OWNER / UX
blocks: nothing — G7 ships a stated interim mapping
```

**Question.** DEC-UX-006 gives the rider status strip **four** variants —
offline · online · pending approval · suspended. `riders.status` has **seven**
values, and an eighth case exists that the handoff does not mention at all: a
signed-in user with no `riders` row. Which of the two non-approved variants
does each of `REGISTERED`, `DOCUMENTS_SUBMITTED`, `PENDING_APPROVAL`,
`DOCUMENTS_REJECTED`, `SUSPENDED`, `DEACTIVATED`, and *no rider record* wear?

**Why it matters.** `DOCUMENTS_REJECTED` is the sharp case: nothing is in
flight for that rider, so "รอตรวจสอบ" would be false — but "ยังรับงานไม่ได้"
alongside `SUSPENDED` reads as a sanction, which it is not. A rider who has
been asked for better documents and a rider who has been suspended need
different things, and the strip is the only place either is told anything.

**Relevant authority.**
- `docs/design/BANHAO-UX-DESIGN-HANDOFF-V1.md` §6 — DEC-UX-006, four variants,
  and *"A suspended rider sees no online toggle at all, not a disabled one."*
- `supabase/migrations/20260811000008_rider_domain.sql` — the seven-value CHECK.
- **BQ-022** (`OPEN`, `LEGAL_REVIEW_REQUIRED`) — what a rider submits, who
  approves it, and the contractual relationship. The resolution *path* for a
  rejected rider is BQ-022's to define, not this app's.

**Proposed options.**
- **A.** `REGISTERED` · `DOCUMENTS_SUBMITTED` · `PENDING_APPROVAL` → pending;
  `DOCUMENTS_REJECTED` · `SUSPENDED` · `DEACTIVATED` · no record → blocked.
- **B.** As A, but `DOCUMENTS_REJECTED` → pending, on the grounds that the rider
  can still act on it.
- **C.** A fifth strip variant for "action needed", covering
  `DOCUMENTS_REJECTED` only. Extends DEC-UX-006 and needs UX sign-off.

**What G7 implemented, and did not decide.** Option **A**, in
`statusStripVariant()` (`apps/driver/src/screens/StatusScreen.tsx`), split by
*waiting on someone else* versus *cannot proceed as things stand*. The **copy**
per status is deliberately factual and non-directive — it states what the
server says and stops. No screen says "your documents are being reviewed",
"contact support", or "resubmit", because every one of those describes a
process nobody has decided. **The behaviour is not in question:** DEC-UX-006
fixes it, and every non-approved status renders with no toggle in the tree at
all.

---

## DQ-G7-02 — What a rider is told when an offer never arrives

```yaml
raised: 2026-08-25 (G7)
status: OPEN
owner: PRODUCT_OWNER / UX
blocks: G7.1 (offer inbox), not G7
```

**Question.** With **TQ-002** (`OPEN`, T1 — Realtime vs polling per surface)
undecided, a rider who is online has no mechanism that pushes an offer to them.
What does the home screen say about that, and does it promise anything about
how quickly work will appear?

**Why it matters.** DEC-037 fixes a **60-second** offer window. TQ-002's own
recommendation is *"push for rider offers"*, which is Phase H (depends on F and
G). Supabase Realtime is not available without adding a table to a publication —
a migration, and the schema is locked. So until TQ-002 is answered, a rider must
have the app open and must refresh. Copy that implies otherwise would be a
promise the system cannot keep.

**Relevant authority.** `docs/OPEN_TECHNICAL_QUESTIONS.md` TQ-002 and TQ-014
(rider app offline behaviour, `OPEN`); DEC-037; V1.1 §18 risk 11
(*"Never poll aggressively"*).

**Proposed options.** A. Say nothing about timing. · B. State plainly that the
app must stay open. · C. Answer TQ-002 first and build to it.

**What G7 implemented, and did not decide.** Option **A**, minimally: the online
strip says only *"ระบบจะส่งงานใหม่มาให้เมื่อมีงานเข้า"* — no interval, no ETA,
no "keep the app open" instruction, because the mechanism that would justify
any of those is undecided. **No polling timer exists in this slice.** There is
no offer inbox in G7 at all, so nothing here depends on the answer yet; G7.1
does, and should not begin before TQ-002 is settled.

---

## DQ-G7-03 — Whether a recorded position is allowed to go stale

```yaml
raised: 2026-08-25 (G7)
status: OPEN
owner: PRODUCT_OWNER
blocks: nothing — G7 renders presence, never freshness
```

**Question.** `rider_availability.location_updated_at` records when the server
last received a position. Is a position ever *too old* to make a rider
dispatch-eligible, and if so should the app say so?

**Why it matters.** DEC-037 records the eligibility predicate as **"has a
location"**, not "has a fresh one", and `BroadcastDispatchStrategy` filters on
`location IS NOT NULL` alone. A UI that showed "ตำแหน่งเก่า 3 ชั่วโมง" would
imply a staleness rule the dispatcher does not apply — and a rider acting on
that implication would go offline for no reason.

**Relevant authority.** DEC-037; `apps/api/src/modules/rider/rider-location.service.ts`
(*"no staleness rule (none is decided)"*); **Q-012** and **TQ-016**, both `OPEN`,
which gate location history and retention.

**Proposed options.** A. No staleness rule — presence only. · B. A staleness
threshold in the dispatcher (a new decision, and a server change). · C. Show
age without acting on it.

**What G7 implemented, and did not decide.** Option **A**. The screen states an
**absolute** timestamp, never a relative "N นาทีที่แล้ว", because relative
phrasing reads as a freshness judgement. `isDispatchable()` in
`domain/riderAvailability.ts` tests presence only, and is documented as a
display predicate rather than an authorization one.
