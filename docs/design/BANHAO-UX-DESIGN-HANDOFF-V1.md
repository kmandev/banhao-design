# BANHAO UX DESIGN HANDOFF V1

External architectural review package. Self-contained — no access to the
design workspace is required to read it. Design specification only: no code,
no migration, no schema change, no deployment.

**Provenance key**, used throughout:

- **[CONFIRMED]** — stated directly by the repository (`kmandev/banhao-design`,
  branch `main`) or by `CLAUDE.md`: an `ACCEPTED` `DEC-NNN`/`DEC-APP`, an `ADR`,
  a `CON`/`REQ`, or the deployed schema.
- **[UX DECISION]** — a choice this design stage made inside that confirmed
  space, recorded as `DEC-UX-NNN`.
- **[ASSUMPTION]** — filled a gap the repository leaves open, in a way this
  document states explicitly so a reviewer can challenge it.
- **[UNRESOLVED]** — an open repository question (`BQ-`, `Q-`, `TQ-`) or a new
  `UX-Q-` this stage could not close. No screen assumes an answer.

| | |
|---|---|
| Source repository | `kmandev/banhao-design`, branch `main`, read at commit `14289652` |
| Database checkpoint | `e471ec1d` — **[CONFIRMED] LOCKED**, no redesign proposed here |
| Application architecture in force | `BANHAO-APP-ARCHITECTURE-V1.md` — V1.1, **[CONFIRMED] APPROVED / READY FOR IMPLEMENTATION** |
| Design system in force | BANHAO Design System v1.0 — **[CONFIRMED]** existing artifact, extended not replaced |
| This document | Stage 8A UX specification, compiled for external review |
| Date | 2026-08-17 |
| Authority order | `CLAUDE.md` → any `DEC-NNN` → V1.1 → this handoff |

---

## 1. Product Overview

**[CONFIRMED]** BANHAO | บ้านเฮา is a local food-delivery marketplace for one
district — อำเภอบุณฑริก, จังหวัดอุบลราชธานี, Thailand — connecting customers,
merchants (restaurants), and riders, with the platform taking a fee per order.
Phase 1 scope is food delivery only; the data model uses generic entity names
(Merchant, Product, Order, Delivery, Driver) so later phases (parcel, ride,
shopping) can reuse it.

**[CONFIRMED]** Four capability classes, one for each of four client
applications: customer (implicit for any authenticated user), merchant
(scoped to specific restaurants via `restaurant_members`), rider (via
`riders`, gated on approval and suspension state), and platform staff (via
`platform_staff`).

**[UX DECISION]** Product vision for this stage: *local before comprehensive*
— a customer already knows most shops, so discovery is confirmation, not
exploration; *legible over polished* — every actor can answer "what's
happening, what do I do next?" from one glance; *built for the least
technical hand* — a solo merchant cooking, a rider reading a phone in
sunlight; *practical about money* — totals visible before every commitment,
never invented client-side.

---

## 2. Design Principles

1. **[CONFIRMED]** The core path — open app → choose shop → choose food →
   order → wait → receive — never grows. Any addition that lengthens it is
   deferred (CON-004, cited in the app architecture as the reason merchant
   moved to web).
2. **[CONFIRMED]** Order state and payment state are separate machines and
   must never be collapsed into one (CON-001). The app is never the arbiter
   of payment success — only a backend that has verified a provider webhook
   is (CON-002).
3. **[CONFIRMED]** Every client reads the same order state value; only the
   wording differs per actor. No screen computes its own status (REQ-002).
4. **[CONFIRMED]** Thai is the default and only language of V1. Copy is
   client-side and keyed, never stored in the database or returned by the API
   (DEC-APP-012).
5. **[UX DECISION]** One primary action per screen. Destructive actions
   confirm and state their consequence. Privileged admin actions require a
   mandatory reason (DEC-032, confirmed at the business-rule level; applied
   here at the UI level).
6. **[UX DECISION]** No technical vocabulary — state names, cause codes, error
   codes, table names — ever reaches a user.
7. **[UX DECISION]** Money is never invented by the client; unknown fees show
   as "calculate at confirmation," never as ฿0.
8. **[UX DECISION]** BANHAO copies no existing delivery product's layout,
   motion, or iconography. Visual identity is the existing v1.0 design system
   (cream ground, brick-orange primary, IBM Plex Sans Thai).

---

## 3. Information Architecture

### Customer — mobile only, 4 tabs **[CONFIRMED as-built + UX DECISION for structure]**

```
หน้าแรก (home) · ออเดอร์ (orders) · แจ้งเตือน (notifications) · บัญชี (profile)
```
Fixed tab bar (as implemented in the existing customer app). `home → restaurant
→ item` is the only three-level path. A persistent "active order" strip pins
above the tab bar whenever an order is live.

### Merchant web — desktop + counter tablet **[UX DECISION, new surface]**

```
ออเดอร์วันนี้ · ประวัติ · เมนู · ร้านของฉัน · ตั้งค่า
```
Restaurant identity is a persistent header element, not a settings item
(DEC-UX-005) — see §23.

### Rider — mobile only, 4 tabs, hidden during a job **[UX DECISION, new surface]**

```
หน้าหลัก · งานของฉัน · รายได้ · บัญชี
```
The tab bar disappears while a delivery is active; the app becomes one screen
with one action (DEC-UX-006).

### Admin web — desktop, 9-item sidebar **[UX DECISION, new surface]**

```
ภาพรวม · Orders · Restaurants · Riders · Customers · Staff · Alerts · Audit · Settings
```
No nesting; every list is a table; every row opens a linkable detail page.

---

## 4. Customer User Flow

**[CONFIRMED]** The database and API contract determine the sequence; the UX
below is this stage's realization of it.

```
splash → login (phone) → OTP → home → restaurant → item → cart → address
→ checkout → PromptPay QR → payment verifying → order placed → tracking
→ delivered → (rate — post-MVP) → order history
```

- **[CONFIRMED]** PromptPay QR is the only payment method; cash on delivery is
  disabled (DEC-016).
- **[CONFIRMED]** Payment is confirmed only by a verified webhook, never by
  the app (CON-002) — the customer sees a waiting state, not a spinner over
  nothing.
- **[UX DECISION]** Restaurant detail and menu are merged into one screen
  (DEC-UX-003) — the brief's two-screen split adds a tap with no information
  gain.
- **[UX DECISION]** No location-permission screen at first run (DEC-UX-004).
  GPS is requested at address entry; denial never blocks ordering.
- **[UX DECISION]** The customer never sees a payment state machine — only
  order state plus a payment *outcome* rendered from the order read model
  (DEC-UX-008), because every payment table is API-only with no client read
  path.

---

## 5. Merchant User Flow

```
login → (restaurant selection, if >1) → order board (รอตอบรับ)
→ accept → preparing → ready for pickup → handed off → history
```

- **[CONFIRMED]** Merchant authorization is restaurant-scoped via
  `restaurant_members`; there is no global merchant role (DEC-APP-004,
  DEC-033).
- **[CONFIRMED]** Merchant surface is a web app, not native (DEC-APP-003) —
  chosen because a restaurant needs no GPS/camera/background execution and
  benefits from removing app-store review from the launch path.
- **[UX DECISION]** The order board is three columns — new/awaiting ·
  preparing · ready for pickup — and is the merchant's entire home screen; no
  separate dashboard.
- **[UX DECISION]** Menu-item availability toggle is one tap, no dialog — the
  single most frequent merchant action during service.
- **[ASSUMPTION]** Order arrival alerting on web (no push channel exists) is
  covered by Realtime + audible alert + tab-title change, accepted as a
  trade-off in the app architecture (V1.1 §4, DEC-APP-003 impact note) but not
  itself designed there — this stage designs the concrete mitigation. Flagged
  as **P0 design risk** in §29.

---

## 6. Rider User Flow

```
login → verification/approval status → online → offer (countdown)
→ accept → go to restaurant → arrived → picked up → go to customer
→ delivered → (next offer)
```

- **[CONFIRMED]** Suspended/deactivated riders must not appear as active or
  receive offers — enforced by the `riders.approved`/suspension columns and
  the capability model (Stage 7E).
- **[CONFIRMED]** A rider can never cancel an order, only the delivery
  (DEC-021); cancelling reassigns, the order does not move.
- **[CONFIRMED]** Rider read access to order data is exclusively through
  three column-scoped, `security_barrier` views — no rider policy exists on
  base order tables (H-1 fix). The customer's address and phone are visible
  to the rider only from `RIDER_ASSIGNED` onward.
- **[UX DECISION]** Operational status is a persistent, non-collapsible strip
  with four states — offline / online / pending approval / suspended
  (DEC-UX-006). A suspended rider sees no online toggle at all, not a
  disabled one.
- **[UNRESOLVED]** Offer countdown value: the repository states both 12s and
  20s in different places (BQ-020). Both render identically in this design.

---

## 7. Admin User Flow

```
login → overview (counters) → [orders | restaurants | riders | customers | staff]
→ detail page → privileged action (reason required) → resolved
```

- **[CONFIRMED]** Admin has no direct-read path to any table — every admin
  read targets API-only tables (ledger, refunds, audit, reconciliation), by
  design (V1.1 §4).
- **[CONFIRMED]** Privileged operations (refund, reassign, cancel, role grant)
  require a mandatory reason and write to `audit_logs` (DEC-032).
- **[UX DECISION]** Overview is one row of operational counters linking into
  pre-filtered tables — no charts, no report builder (DEC-UX-007).
- **[UNRESOLVED]** Exact set and ordering of operator options on a no-rider
  order (UX-Q-006, tied to DEC-022's "operator decision" wording, which does
  not enumerate the options).

---

## 8. Complete Screen Inventory

See §30 for the final concise list. Full detail with build status:

### Customer — 26 screens, 18 MUST

| ID | Screen | Scope | Built |
|---|---|---|---|
| C-01 | Splash | MUST | ✅ |
| C-02 | Onboarding | SHOULD | ✅ |
| C-03 | Login (phone) | MUST | ✅ |
| C-04 | OTP verification | MUST | ✅ |
| C-20 | Delivery-area selection | SHOULD | ❌ |
| C-05 | Home | MUST | ✅ |
| C-06 | Search | MUST | ✅ |
| C-07 | Restaurant + menu (merged) | MUST | ✅ |
| C-08 | Item options | MUST | ✅ |
| C-09 | Cart | MUST | ✅ |
| C-11 | Address selection | MUST | ✅ |
| C-10 | Checkout | MUST | ✅* |
| C-12 | PromptPay QR | MUST | ✅** |
| C-12b | Payment verifying | MUST | ✅ |
| C-12c | Payment succeeded | MUST | ✅ |
| C-12d | Payment not confirmed | SHOULD | ✅ |
| C-12e | QR expired | SHOULD | ✅ |
| C-12f | Paid twice | LATER | ✅ |
| C-12g | Payment detail | LATER | ✅ |
| C-12h | Refund status | LATER | ✅ |
| C-13 | Order placed | MUST | ✅ |
| C-14 | Order tracking | MUST | ✅*** |
| C-16 | Order history | MUST | ✅ |
| C-19 | Order detail | MUST | ❌ |
| C-18 | Profile | MUST | ✅ |
| C-15 | Rating | LATER | ✅ |
| C-17 | Notifications | SHOULD | ✅ |

\* still shows a cash option DEC-016 disabled — flagged code divergence, not a
design defect. \*\* QR payload is a placeholder pending provider selection
(Q-001). \*\*\* map is a placeholder pending maps provider (Q-018).

### Merchant — 14 screens, 9 MUST (all net-new)

M-01 login · M-02 restaurant selection (conditional) · M-03 order board ·
M-04 order detail · M-05 accept · M-06 reject (SHOULD) · M-07 preparing ·
M-08 ready for pickup · M-09 history (SHOULD) · M-10 restaurant profile
(SHOULD) · M-11 menu management · M-12 operating hours · M-13 earnings
(LATER) · M-14 settings (LATER).

### Rider — 14 screens, 11 MUST (all net-new)

R-01 login · R-02 verification status · R-03 home · R-04 online/offline ·
R-05 offer · R-06 offer lost/expired · R-07 to restaurant · R-08 arrived ·
R-09 pickup confirmation · R-10 to customer · R-11 handoff/completion ·
R-12 history (SHOULD) · R-13 earnings (SHOULD) · R-14 profile (LATER).

### Admin — 15 screens, 9 MUST across 7 groups (all net-new)

A-01 login · A-02 overview · A-03 orders · A-04 order detail · A-05/A-06
restaurants + detail · A-07 merchant members (SHOULD) · A-08/A-09 riders +
detail · A-10 customers (SHOULD) · A-11/A-12 staff + detail (SHOULD) ·
A-13 alerts · A-14 audit (SHOULD) · A-15 settings (LATER).

---

## 9. Navigation Structure

| Surface | Pattern | Depth |
|---|---|---|
| Customer | bottom tab bar, 4 items, modal-ish push stack for cart/checkout | 3 levels max (home→restaurant→item) |
| Merchant | left rail (desktop) / top tabs (tablet), 5 items | 2 levels (list → detail) |
| Rider | bottom tab bar, 4 items, hidden mid-job | 1 level during a job (single-task mode) |
| Admin | left sidebar, 9 items, no nesting | 2 levels (table → detail, tabs within detail) |

**[UX DECISION]** No in-app capability switcher anywhere (DEC-UX-010) — a
person who is both customer and rider uses two separate apps/sessions.

---

## 10. Design System

**[CONFIRMED]** BANHAO Design System v1.0 exists and is authoritative;
nothing here redesigns it. This handoff adds only what three new surfaces
(merchant, rider, admin) require, listed in §13.

## 11. Colors

**[CONFIRMED — pulled verbatim from the design system]**

| Token | Hex | Use |
|---|---|---|
| Primary | `#E4572E` | primary fill, active state |
| Primary pressed | `#C2431F` | hover/pressed |
| Gold | `#D6A419` | promotion/badge only, never a button |
| Ink | `#1F1A16` | body text, live-order card |
| Cream | `#FBF7F1` | every screen background |
| Surface | `#FFFFFF` | cards, sheets, inputs |
| Border | `#E9E0D5` | card/input borders |
| Text muted | `#7A6E64` | descriptions, metadata |
| Success | `#0F8B5F` | delivered, open |
| Warning | `#D6A419` | waiting, near-timeout |
| Error | `#D93A3A` | failure, cancel, delete |
| Info | `#2E6FB7` | system notices |

**[UX DECISION — accessibility finding, not yet resolved]** White text on
Primary `#E4572E` measures ~3.68:1, failing WCAG AA at 16px normal text (needs
≥4.5:1; passes only as large text ≥18.66px bold). White on Primary-pressed
`#C2431F` measures ~5.09:1 and passes. `#9A8C7E` on cream measures ~3.06:1 and
must remain decorative-only, never load-bearing text. See **UX-Q-001** in
§28 — remedy (larger label vs. different button fill) is not chosen here
because it is a brand decision.

## 12. Typography

**[CONFIRMED]** IBM Plex Sans Thai (400/500/600/700) for UI, IBM Plex Mono for
references/amounts in tables. Minimum 12px, metadata only; 14px minimum for
anything a user must read. Line height 1.55–1.75 for all Thai text — vowel
collision prevention, non-negotiable. **[UX DECISION]** Every component must
be laid out against the longest real Thai string it will carry (e.g.
"พร้อมให้ไรเดอร์รับ", "บัญชีถูกระงับการใช้งาน"), never an English placeholder.

## 13. Components

**[CONFIRMED, existing in v1.0]** Buttons (primary/secondary/ghost/danger with
hover/pressed/disabled/loading), inputs and forms with inline error, cards,
badges, order-status chips, tabs, bottom navigation, modals, bottom sheets,
toasts, alerts, skeleton loaders, empty states, error states, confirmation
dialogs.

**[UX DECISION — new, required by merchant/rider/admin]**

| Component | Needed by | Note |
|---|---|---|
| Data table | admin, merchant history | 14px body, 44px rows, dense variant |
| Sidebar navigation | admin | 9 items, collapses to icons <1280px |
| Scope header | merchant | restaurant identity, load-bearing (§23) |
| Order queue card | merchant board | 3 column variants |
| Countdown chip | accept window, rider offer, QR validity | value from config, not hardcoded |
| Status strip | rider | 4 variants, never collapsible |
| Offer card | rider | full-screen, 64px action |
| Reason dialog | admin, merchant reject, rider cancel | mandatory free text + stated consequence |
| Map surface | tracking, rider nav | placeholder until maps provider chosen |
| Connection banner | merchant board, tracking | reconnecting state, not silent |
| Timeline | tracking, admin order detail | derived live, never a stored copy |

## 14. Buttons and Interaction States

**[CONFIRMED, v1.0]** Primary 56px height, hover/pressed/disabled/loading
states defined with exact hex shifts (`#E4572E` → `#C2431F` hover → `#A93818`
pressed → `#EFE7DC`/`#B0A294` disabled). **[UX DECISION]** Rider in-job
actions raised to 64px (one-handed use, moving vehicle context). Touch targets
≥44×44px everywhere; ≥8px between adjacent targets.

## 15. Forms and Validation

**[UX DECISION]** Inline field errors, never toast-only. Required option
groups on the item screen block the primary action with an inline message on
the group itself. Address form treats the "landmark" (จุดสังเกต) field as
first-class, not optional-looking — **[CONFIRMED]** the schema already
prioritizes this via `delivery_landmark` and the V1.1 localisation section.
Validation errors describe what happened and the fix, never a bare "invalid."

## 16. Loading / Empty / Error States

**[UX DECISION]** Every list has all three, designed with real Thai copy (not
lorem/English placeholders). Full table of ~28 states — loading, empty
(per-screen), offline, session expiry, forbidden, restaurant closed, item
unavailable, price changed, payment not confirmed, QR expired, no rider,
offer lost, rider suspended, accept-window expiry, server error — is in the
companion detailed specification (`BANHAO-UX-SPEC-V1.md` §13). Two rules
apply everywhere: no technical token/constraint/SQLSTATE ever reaches a user,
and every error state offers a way forward.

## 17. Order Lifecycle UX

**[CONFIRMED]** Nine ACCEPTED states (DEC-019) plus `CANCELLED`; nothing else
is implemented in V1 (DEC-APP-006):

```
CREATED → PENDING_PAYMENT → PAID → MERCHANT_ACCEPTED → PREPARING
        → READY_FOR_PICKUP → PICKED_UP → DELIVERING → DELIVERED
```

Delivery state is a **separate machine** (DEC-018) and must never be blended
into the order status text — shown as a secondary line.

**[UX DECISION]** Full per-actor Thai wording for every state:

| State | Customer | Merchant | Rider |
|---|---|---|---|
| PENDING_PAYMENT | รอชำระเงิน + QR + countdown | — | — |
| PAID | ส่งให้ร้านแล้ว · รอร้านรับออเดอร์ | ออเดอร์ใหม่ · รอตอบรับ | — |
| MERCHANT_ACCEPTED | ร้านรับออเดอร์แล้ว | รับแล้ว · เริ่มทำอาหาร | งานใหม่ (offer) |
| PREPARING | ร้านกำลังทำอาหาร | กำลังทำอาหาร | ร้านกำลังทำอาหาร · ไปรับได้ |
| READY_FOR_PICKUP | อาหารพร้อมแล้ว | รอไรเดอร์มารับ | รับอาหารได้เลย |
| PICKED_UP | ไรเดอร์รับอาหารแล้ว | ส่งมอบให้ไรเดอร์แล้ว | รับอาหารแล้ว · ไปส่ง |
| DELIVERING | กำลังไปส่ง + ETA | กำลังจัดส่ง | กำลังไปส่ง |
| DELIVERED | จัดส่งสำเร็จ | สำเร็จ | ส่งสำเร็จ |
| CANCELLED | ออเดอร์ถูกยกเลิก + เหตุผล + refund status | ออเดอร์ถูกยกเลิก | งานนี้ถูกยกเลิก |

**[CONFIRMED]** `PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`,
`DELIVERY_FAILED` are `PROPOSED` state *names*, not approved — **[UX
DECISION]** no screen is built for them (DEC-UX-009); their *policies* (order
survives a failed/expired payment attempt) are shown using the existing
`PENDING_PAYMENT` state.

**[CONFIRMED]** Prolonged rider search is not an order state (DEC-022); the
order waits in `PREPARING`/`READY_FOR_PICKUP` and only an operator ends it.
**[UX DECISION]** customer sees a 5-minute notice with a 3-minute extension
offer, both already-approved timer values.

**[UNRESOLVED]** Cancellation fee policy (Q-003, BQ-016); merchant
accept-window expiry behavior (BQ-013); delivery-failure UX (BQ-017, no screen
designed, deliberately).

## 18. Customer Checkout UX

**[CONFIRMED]** One restaurant per cart (DEC-017); PromptPay only, no COD
(DEC-016); server revalidates price/availability on submit. **[UX DECISION]**
Checkout is the single screen this stage treats as launch-critical for polish:
address with landmark, order summary, fee breakdown (server-provided rows,
never invented), one primary action `ชำระเงิน ฿NNN`, no upsell/tip/promo field
in V1. QR screen shows the 10-minute countdown visibly and states plainly that
BANHAO is waiting on the bank, because CON-002 means the app genuinely does
not know yet.

## 19. Merchant Order-Management UX

**[UX DECISION]** Three-column live board (new/awaiting → preparing → ready);
one primary action per card advancing the order; countdown chip on the accept
window; rejection always secondary, always requires a reason, always warns of
refund. **[ASSUMPTION, flagged as risk]** Order-arrival alerting compensates
for the lack of push on web via Realtime + audible alert + tab-title change +
a persistent reconnect banner — this is this stage's proposed mitigation for
an accepted trade-off (DEC-APP-003), not itself a repository-confirmed
mechanism.

## 20. Rider Delivery UX

**[UX DECISION]** One screen per job step, one 64px action:
รับงาน → ถึงร้านแล้ว → รับอาหารแล้ว → ถึงที่หมายแล้ว → ส่งสำเร็จ. Losing a
race for an offer (`409 OFFER_TAKEN`) renders as a calm, expected outcome —
"งานนี้มีไรเดอร์รับไปแล้ว" — never as an error. **[CONFIRMED]** Customer
phone/address surface to the rider only from `RIDER_ASSIGNED` onward, and only
through the `security_barrier` views (H-1). **[UNRESOLVED]** Proof-of-delivery
requirement (BQ-018) — a photo slot is reserved but not enforced as mandatory.

## 21. Admin Operations UX

**[UX DECISION]** A-04 order detail stacks four regions: order state +
timeline, payment situation, delivery situation, action bar — order and
payment state are shown as two separate labelled facts, never merged
(CON-001 applied at the UI level). Every privileged action (reassign, cancel,
refund) states its consequence for the customer/merchant/rider before
confirming, and requires a reason (DEC-032). A-13 alerts is a resolvable
queue (age + owner), not a notification feed, sourced from data already in
the schema (searching-too-long deliveries, accept-window overruns,
unprocessed payment events, open reconciliation cases).

## 22. Capability-Aware UX

**[CONFIRMED]** Capability resolution is domain-membership based
(`restaurant_members` / `riders` / `platform_staff`), never
`profiles.role` (DEC-APP-004, DEC-033; `profiles.role` is legacy and read by
nothing). **[UX DECISION]** rules built on top:

1. App shell is chosen by capability, not by asking the user what they are.
2. Absence, not disablement, for a capability you lack entirely.
3. Disablement, not absence, for a capability you have but can't use *right
   now* (e.g. approved-but-offline rider).
4. No in-app capability switcher (DEC-UX-010).
5. A `403` shows a plain message and does **not** log the user out
   (**[CONFIRMED]** V1.1 §5 session-handling rule).
6. Revocation (suspension, membership removal) takes effect on the next read,
   never cached client-side or carried in a token claim.

## 23. Restaurant-Scoped Merchant UX

**[CONFIRMED]** Merchant capability is scoped per restaurant via
`restaurant_members`; a merchant must never be given the impression they can
operate a restaurant they don't belong to (explicit brief requirement, and
consistent with DEC-APP-004). **[UX DECISION — DEC-UX-005]** Restaurant name
is persistent header identity on every merchant screen. A single-restaurant
merchant sees static, non-interactive text — no picker exists to imply other
restaurants are reachable. A multi-restaurant merchant sees a picker listing
*only* the restaurants their own membership rows cover; switching triggers a
full context reload so no data from the previous restaurant can persist on
screen. No global merchant view, no aggregate cross-restaurant board, exists
anywhere in the product.

## 24. Responsive Behavior

| Surface | Primary | Also supported | Not in V1 |
|---|---|---|---|
| Customer | phone 360–430px | — | tablet, web |
| Merchant | desktop 1280px+ | counter tablet 768–1024px | phone-optimized |
| Rider | phone 360–430px | — | tablet, web |
| Admin | desktop 1440px+ | laptop 1280px, tablet read-only | phone |

**[UX DECISION]** Merchant tablet: 3 columns collapse to 2 + bottom tray, 56px
targets, no hover-only affordances. Admin: sidebar collapses to icons at
<1280px. Rider: strictly one-handed, bottom-third actions.

## 25. Accessibility

**[UX DECISION]** WCAG 2.1 AA target. Findings against the existing palette:
white-on-primary fails at 16px normal text (§11, UX-Q-001, unresolved); a
metadata grey (`#9A8C7E`) fails and must stay decorative-only. Requirements:
≥44×44px touch targets (56px primary, 64px rider in-job); status never
conveyed by colour alone — always paired with Thai text; screen-reader labels
are full Thai phrases, not single words; admin is fully keyboard-operable
with a visible focus ring; motion respects `prefers-reduced-motion` and stays
below 3Hz (relevant to the merchant new-order alert); Thai line-height
1.55–1.75 always.

## 26. Thai-Language UX/Copy Principles

**[CONFIRMED]** Thai is the default and only V1 language; strings are keyed
client-side, never stored in the database or returned by the API
(DEC-APP-012). E.164 storage / `0XX-XXX-XXXX` display for phone; satang
integer storage / ฿ display for money; UTC storage / 24-hour display for
time; `จุดสังเกต` (landmark) as a first-class address field.
**[UX DECISION]** No emoji, no stacked exclamation marks, no English fallback
text anywhere in production copy; every component is laid out against its
longest realistic Thai string; Android is flagged as unverified for per-weight
Thai font rendering and must be checked before launch (**[CONFIRMED]** already
a Phase A checklist item independent of this design stage).

## 27. MVP vs Post-MVP Scope

**MUST HAVE (launch-blocking) — 47 screens**
Customer 18 · Merchant 9 · Rider 11 · Admin 9 (in 7 groups) — full list in §8
and the concise index in §30.

**SHOULD HAVE (add within first weeks)** — Customer: onboarding, area
selection, payment-failure/expiry states, notifications. Merchant: reject
dialog, history, restaurant profile. Rider: history, earnings. Admin:
merchant members, customers, staff + detail, audit viewer.

**LATER (deliberately out of scope)** — rating, duplicate-payment/payment-
detail/refund-status screens, merchant earnings/settings, rider profile/
documents, admin settings editor, any screen for a `PROPOSED` exception
state, and all of: promotions, coupons, chat, favourites, scheduled orders,
multi-restaurant carts, tipping, loyalty, referral, phases 2–4 service lines.

**[UX DECISION]** Explicit anti-scope: no feature that lengthens the core
path; no dashboard/chart/report/export anywhere; no in-app capability
switcher; no second language.

## 28. Open UX Decisions (Unresolved)

| id | Question | Depends on |
|---|---|---|
| UX-Q-001 | Primary-button contrast remedy — larger label or different fill? | design-system brand decision |
| UX-Q-002 | Rider offer window: 12s or 20s? | BQ-020 |
| UX-Q-003 | Merchant accept-window expiry: auto-reject or escalate? | BQ-013 |
| UX-Q-004 | Proof-of-delivery mandatory, optional, or absent? | BQ-018 |
| UX-Q-005 | Cancellation fee policy and wording | Q-003, BQ-016 |
| UX-Q-006 | Operator options on a no-rider order, and their order | DEC-022 |
| UX-Q-007 | Maps provider; live marker vs coarse ETA in V1 | Q-018 |
| UX-Q-008 | Notification channels at launch | ADR-011 |
| UX-Q-009 | Exception state names | ORDER_LIFECYCLE §3 |
| UX-Q-010 | Fee presentation once numbers exist — one line or itemised | BQ-026, BQ-027 |
| UX-Q-011 | Does a merchant see rider identity before handoff? | not in repository |
| UX-Q-012 | Order reference format shown to users | not in repository |

None of these block starting on the MUST-list screens; each blocks one named
detail on one screen.

## 29. Assumptions Made During Design

Listed so a reviewer can accept or reject each independently.

1. **[ASSUMPTION]** Merchant order-arrival alerting (no push on web) is
   solved by Realtime + audible alert + browser tab-title change + a
   reconnect banner. The repository accepts the *trade-off* (DEC-APP-003) but
   does not specify the mechanism — flagged as the top design risk (§30 in
   the companion spec).
2. **[ASSUMPTION]** No location-permission screen at first run, replaced by
   an optional area-confirmation screen and GPS-on-demand at address entry.
   Reasoned from CON-004 (core-path length) and the single-district service
   area, not stated by the repository.
3. **[ASSUMPTION]** Restaurant detail and menu are merged into one screen,
   departing from the Stage 8A brief's two-screen list, for the same
   core-path reason.
4. **[ASSUMPTION]** Existing customer screen numbering (31 states) is kept
   rather than renumbered to match the brief's 18-item list — renumbering
   shipped code was judged higher-cost than remapping the brief onto it.
5. **[ASSUMPTION]** Order reference format shown to end users, and whether a
   merchant sees rider identity pre-handoff, are UX judgment calls with no
   repository source — both are listed as open (UX-Q-011, UX-Q-012) rather
   than decided.
6. **[ASSUMPTION]** Four personas (customer, merchant, rider, operator) were
   authored for this design stage; no user-research document exists in the
   repository to validate them against.

## 30. Areas of Possible Conflict with Existing Architecture

**Result: none found against any `ACCEPTED` decision.** Three places this
design departs from the *Stage 8A brief itself* (not from the repository) are
called out as `DEC-UX` records, not conflicts:

- DEC-UX-002 — kept existing screen numbering instead of the brief's scheme.
- DEC-UX-003 — merged two brief-listed screens (restaurant detail, menu) into
  one.
- DEC-UX-004 — removed the brief-listed location-permission screen from the
  first-run flow.

Two **pre-existing code divergences** are referenced, not re-litigated here,
because they are already tracked as engineering tasks in
`docs/CURRENT_STATUS.md`: the customer app's checkout still offers a cash
option (conflicts with DEC-016, disabling COD) and still encodes twelve
superseded order-state values (conflicts with DEC-019). This design's §17
vocabulary is the target state for both; fixing the code is Phase C/E work,
not a design change.

No screen in this handoff assumes a database change, a new table, a new RLS
policy, or a new backend service. No screen is designed for a state whose
name is not `ACCEPTED` (DEC-APP-006).

---

# BANHAO UX DESIGN HANDOFF V1 — SCREEN INDEX

### Customer (26 screens · 18 MUST)
| ID | Purpose |
|---|---|
| C-01 | App launch splash |
| C-02 | First-run onboarding (skippable) |
| C-03 | Phone-number login |
| C-04 | OTP verification |
| C-20 | Confirm/change delivery district |
| C-05 | Home — nearby restaurants, active-order strip |
| C-06 | Search restaurants/items |
| C-07 | Restaurant identity, hours, and full menu |
| C-08 | Item options, note, quantity |
| C-09 | Cart — single restaurant, line edits |
| C-11 | Address selection/entry with landmark |
| C-10 | Checkout — summary, fees, pay action |
| C-12 | PromptPay QR with countdown |
| C-12b | Waiting on bank confirmation |
| C-12c | Payment confirmed |
| C-12d | Payment could not be confirmed |
| C-12e | QR expired, regenerate |
| C-12f | Duplicate-payment notice |
| C-12g | Payment detail |
| C-12h | Refund status |
| C-13 | Order placed confirmation |
| C-14 | Live order tracking |
| C-16 | Order history list |
| C-19 | Past order detail |
| C-18 | Profile — addresses, phone, logout |
| C-15 | Post-delivery rating |
| C-17 | Notification list |

### Merchant (14 screens · 9 MUST)
| ID | Purpose |
|---|---|
| M-01 | Merchant login |
| M-02 | Choose active restaurant (multi-restaurant only) |
| M-03 | Live order board — three columns |
| M-04 | Single order detail panel |
| M-05 | Accept order + set prep time |
| M-06 | Reject order with mandatory reason |
| M-07 | Mark order preparing |
| M-08 | Mark order ready for pickup |
| M-09 | Order history + daily summary |
| M-10 | Restaurant profile (name, contact, address) |
| M-11 | Menu management — items, options, availability |
| M-12 | Operating hours |
| M-13 | Earnings (from ledger) |
| M-14 | Settings / staff |

### Rider (14 screens · 11 MUST)
| ID | Purpose |
|---|---|
| R-01 | Rider login |
| R-02 | Document/approval status |
| R-03 | Home — status + today's earnings |
| R-04 | Online/offline toggle |
| R-05 | Incoming delivery offer with countdown |
| R-06 | Offer lost or expired |
| R-07 | Navigate to restaurant |
| R-08 | Arrived at restaurant |
| R-09 | Pickup confirmation |
| R-10 | Navigate to customer |
| R-11 | Delivery handoff/completion |
| R-12 | Delivery history |
| R-13 | Earnings |
| R-14 | Profile / documents / settings |

### Admin (15 screens · 9 MUST, 7 groups)
| ID | Purpose |
|---|---|
| A-01 | Staff login |
| A-02 | Operational overview counters |
| A-03 | All-orders table with filters |
| A-04 | Order detail — state, payment, delivery, actions |
| A-05 | Restaurants table |
| A-06 | Restaurant detail — status, hours, menu, activation |
| A-07 | Restaurant staff (merchant members) management |
| A-08 | Riders table |
| A-09 | Rider detail — documents, approve, suspend |
| A-10 | Customer lookup and history |
| A-11 | Platform staff list |
| A-12 | Staff detail — grant/revoke |
| A-13 | Operational alerts queue |
| A-14 | Audit/activity log |
| A-15 | Configuration settings |

**Total: 69 screens across four surfaces; 47 are MUST for MVP launch.**

*End of handoff. Design specification only — no implementation, commit, push,
or deployment performed.*
