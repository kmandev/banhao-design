# BANHAO — PRODUCT UX SPECIFICATION V1 (STAGE 8A)

Design specification only. No application code, no migration, no database
change, no deployment, and no repository commit was produced by this stage.

| | |
|---|---|
| Stage | 8A — Product UX Foundation |
| Repository | `kmandev/banhao-design`, branch `main` |
| Read at commit | `14289652`; database checkpoint `e471ec1d` — **LOCKED** |
| Authority above this document | `CLAUDE.md` → any `DEC-NNN` business decision → `BANHAO-APP-ARCHITECTURE-V1.md` (V1.1, APPROVED) → this specification |
| Design system in force | BANHAO Design System v1.0 (`design/design-system/`) — extended here, not replaced |
| Date | 2026-08-17 |
| Language policy | This specification is written in English. Every user-facing string it defines is written in Thai, because the product ships in Thai (DEC-APP-012). |

**What this document is.** The UX contract Claude Code implements against:
navigation, screen inventory, per-state wording for four actors, component
scope, non-happy-path behaviour, and an explicit MVP boundary. It invents no
business rule. Where a rule is `OPEN` in the repository, this document designs
the screen so that either answer fits, and records the question in §17 rather
than guessing.

**What this document is not.** It is not a visual redline, not a component
library, and not permission to build. Screens marked LATER are named so they
stay out of the MVP, not so they get built.

---

## 1. Product Vision

BANHAO is the food-delivery service of one district — อำเภอบุณฑริก,
จังหวัดอุบลราชธานี — before it is a platform. Everyone on all four sides of a
transaction may plausibly know each other. That single fact, not a feature
list, sets the UX direction:

- **Local before comprehensive.** A customer opens the app already knowing most
  of the restaurants. Discovery is therefore *confirmation* ("is ป้าสมร open,
  and how long?"), not exploration. Ranking, filtering and recommendation
  machinery earns nothing at a catalogue of a few dozen shops and costs the core
  path steps it cannot afford (CON-004).
- **Trustworthy through legibility, not through polish.** Every actor must be
  able to answer "what is happening to this order right now, and what do I do
  next?" from one glance at one screen. The order state is the product.
- **Simple enough for the least technical participant.** The merchant may be
  running a shop alone at lunchtime; the rider is reading a phone in sunlight
  with a helmet on. Both get large targets, one action, and no vocabulary
  either would have to learn.
- **Own identity.** BANHAO does not imitate the layout, motion, iconography or
  copy of any existing delivery product. Its own established direction — cream
  ground, brick-orange primary, IBM Plex Sans Thai, generous line height — is
  already in the design system and continues here.
- **Practical about money.** Prices, fees and totals are always visible before
  a commitment and never recomputed silently. Fee *numbers* are open business
  questions (BQ-026, BQ-027); the screens show them as data from the server,
  never as a designed-in default.

### Product tone (copywriting rules for all four apps)

| Rule | Yes | No |
|---|---|---|
| Speak plainly, in the second person | `ร้านกำลังทำอาหารของคุณ` | `ออเดอร์อยู่ในสถานะ PREPARING` |
| Never show a technical token to a user | `ยืนยันการชำระเงินไม่ได้` | `PAYMENT_FAILED` |
| Every error says what happened *and* the next action | `เน็ตหลุดชั่วคราว · ลองอีกครั้ง` | `เกิดข้อผิดพลาด` |
| Currency as Thai users read it | `฿130` in dense UI, `130 บาท` in sentences | `130.00 THB` |
| Time in 24-hour; timelines relative | `19:30` · `5 นาทีที่แล้ว` | `7:30 PM` |
| No exclamation stacking, no emoji in production copy | `สั่งสำเร็จ` | `สั่งสำเร็จ!!! 🎉` |

---

## 2. Personas

Four, each written for the constraint it puts on the design. No research
document exists in the repository; these are design personas derived from the
service area and the four capability classes, and are labelled as such.

**นก — customer, 34, teacher, Buntharik.** Orders 2–3 times a week, mostly
lunch, on a mid-range Android phone on 4G. Knows the shops by name. Wants to
know when food will arrive, and dislikes paying before being sure the shop is
open. *Design consequence:* opening hours and "is it open now" are first-class
on every restaurant card; the QR payment step must never feel like a point of
no return without a clear state afterwards.

**ป้าสมร — merchant, 52, owns a single ร้านตามสั่ง.** One phone, one tablet on
the counter, cooking while orders arrive. Cannot watch a screen continuously.
*Design consequence:* order arrival must be audible and unmissable; accepting is
one large button; the whole day's work is one queue, not a dashboard. Never more
than one restaurant in view unless her capability genuinely covers more.

**บอย — rider, 26, motorcycle, works lunch and evening peaks.** Phone mounted,
gloves, sun. Reads at arm's length. Cares about earnings per trip and not
losing a job to a race he did not know he was in. *Design consequence:* one
screen per step with one action; status (online/offline/suspended) is never
ambiguous; a lost offer is a normal outcome shown calmly, not an error.

**ผู้ดูแลระบบ — operator, platform staff, desktop.** Handles the exceptions
customers and merchants cannot: a stuck order, a missing rider, a refund. Works
in a browser with a keyboard. *Design consequence:* dense tables, search by
order reference or phone, every privileged action asks for a mandatory reason
(DEC-032), and nothing is destructive without confirmation.

---

## 3. User Journeys

The MVP is one journey with four viewpoints on the same order. Everything else
is secondary.

### The primary journey (the only one that must be polished)

```
CUSTOMER   home → restaurant → item → cart → checkout → pay → placed → tracking → delivered
                                                    │
MERCHANT                                    new order → accept → preparing → ready → handed off
                                                    │
RIDER                                        offer → accept → to shop → picked up → to customer → delivered
                                                    │
OPERATOR                                    watches, and intervenes only on exception
```

### Journey ownership of order state

The order moves through one state machine (DEC-019). Each transition has exactly
one actor who may cause it, and the other three actors *observe* it. No screen
computes status locally (REQ-002).

| Step | Actor who acts | Others' experience |
|---|---|---|
| Place order | Customer | Nobody else sees the order until `PAID` |
| Confirm payment | **Nobody** — verified webhook only (CON-002) | Customer waits on a state screen; merchant receives at `PAID` |
| Accept / reject | Merchant | Customer sees acceptance; rider search begins (DEC-020) |
| Cook, mark ready | Merchant | Customer sees progress; rider sees when to come |
| Accept the delivery | Rider | Customer sees the rider appear; merchant sees a rider is coming |
| Pick up, deliver | Rider | Customer tracks; merchant is done at handoff |
| Cancel | Customer (early), merchant (rejection), operator (any time) | Never the rider — DEC-021 |

### Secondary journeys, in priority order

1. Merchant manages menu availability (an item sells out mid-service).
2. Rider goes online and offline around a shift.
3. Operator resolves a no-rider order (DEC-022).
4. Customer re-orders from history.
5. Operator onboards a restaurant and approves a rider.

---

## 4. Information Architecture

### 4.1 Customer app — mobile only, 4 tabs (as implemented)

```
หน้าแรก (home)        ออเดอร์ (orders)      แจ้งเตือน (notifications)   บัญชี (profile)
  ├ search              ├ order detail          └ (list only)              ├ addresses
  ├ restaurant          └ tracking (active)                                ├ phone / name
  │   └ item                                                               └ logout
  └ cart → checkout → payment → placed → tracking
```

- **Primary navigation:** the four tabs. Fixed for the life of V1.
- **Secondary navigation:** push within a tab; cart and checkout are a modal-ish
  stack over `หน้าแรก`; tracking is reachable from both `ออเดอร์` and a
  persistent "active order" strip pinned above the tab bar whenever an order is
  live.
- **Hierarchy:** home → restaurant → item is the only three-level path. Nothing
  in V1 goes four deep.
- **Important actions:** `เพิ่มลงตะกร้า`, `สั่งอาหาร ฿NNN`, `ชำระเงิน`,
  `ติดตามออเดอร์`.
- **Destructive actions:** remove cart line (undo toast, no dialog), clear cart
  when switching restaurant (dialog — DEC-017), cancel order (dialog, and
  availability depends on state per §10), delete address (dialog; note the
  database rejects DELETE on `addresses`, so this is an archive, not a delete —
  copy must not promise removal).
- **Empty / loading / error:** every list has all three, specified in §13.

### 4.2 Merchant web — desktop and counter tablet (DEC-APP-003)

```
[ BANHAO ]  ร้าน: ครัวป้าสมร ▾        เปิดรับออเดอร์ ●        ผู้ใช้ ▾
─────────────────────────────────────────────────────────────────────
ออเดอร์วันนี้   ประวัติ   เมนู   ร้านของฉัน   ตั้งค่า
```

- **Primary navigation:** five items, left rail on desktop, top tabs on tablet
  portrait.
- **Restaurant scope is part of the header identity, always visible** — never a
  setting buried in a menu (DEC-UX-005). A merchant with one restaurant sees the
  name as static text with no affordance to change it. A merchant with several
  sees a picker listing *only* the restaurants their `restaurant_members` rows
  cover, and switching reloads the whole surface so nothing from the previous
  restaurant can persist on screen.
- **`ออเดอร์วันนี้` is the home and the product.** Three columns:
  `ใหม่ · รอตอบรับ` / `กำลังทำ` / `พร้อมให้ไรเดอร์รับ`. Completed orders leave
  the board.
- **Important actions:** `รับออเดอร์`, `เริ่มทำอาหาร`, `อาหารพร้อม`.
- **Destructive actions:** `ปฏิเสธออเดอร์` (dialog + reason), `ปิดรับออเดอร์`
  (dialog — it stops all incoming business), item `ปิดขายวันนี้` (inline, no
  dialog, reversible).
- **Empty:** `ยังไม่มีออเดอร์ใหม่` with the open/closed state restated, because
  an empty board is ambiguous between "closed" and "quiet".

### 4.3 Rider app — mobile only, single-task

```
สถานะ: ออนไลน์ / ออฟไลน์ / ระงับการใช้งาน      ← always the top strip
─────────────────────────────────────────────
หน้าหลัก        งานของฉัน        รายได้        บัญชี
```

- **Primary navigation:** four tabs — but **the tab bar is hidden while a
  delivery is active.** During a job the app is one screen with one action; the
  rider can reach nothing that is not the job (DEC-UX-006).
- **Status strip is the app's most important element** and is present on every
  screen including inside a job.
- **Important actions:** `รับงาน`, `ถึงร้านแล้ว`, `รับอาหารแล้ว`, `ส่งสำเร็จ`.
- **Destructive actions:** `ยกเลิกงาน` (dialog + reason; releases the delivery,
  never the order — DEC-021), `ออฟไลน์` while a job is active (blocked, with an
  explanation, not a dialog).
- **Empty:** offline → `เปิดรับงานเพื่อเริ่มรับออเดอร์`; online with nothing →
  `กำลังรอออเดอร์ใหม่` with a live indicator so the rider knows the app is
  awake.

### 4.4 Admin web — desktop first

```
BANHAO ADMIN
  ภาพรวม        Orders        Restaurants        Riders
  Customers     Staff         Alerts             Audit        Settings
```

- **Primary navigation:** persistent left sidebar, nine items, no nesting.
- **Secondary navigation:** every list is a table; every row opens a detail page
  (not a drawer) so it can be linked and refreshed. Detail pages use tabs.
- **`ภาพรวม` is one row of operational counters, not a dashboard**
  (DEC-UX-007): orders in flight, orders waiting for a merchant, deliveries with
  no rider, open reconciliation cases, unprocessed payment events. Each counter
  is a link into a pre-filtered table. No charts in V1.
- **Important actions:** reassign a delivery, cancel an order, initiate a
  refund, approve a rider, activate a restaurant, grant/revoke staff.
- **Destructive actions:** all of the above. Every one opens a confirmation
  dialog with a **mandatory free-text reason** (DEC-032) and states in the
  dialog what the customer, merchant and rider will each see as a result.
- **Empty:** an empty operational table is good news and should say so —
  `ไม่มีรายการค้าง` — never a shrug.

---

## 5. Customer UX

### 5.1 Screen inventory

Numbering follows the **already-implemented** customer app (31 design states,
`apps/customer`), not a new scheme — renumbering live code is a cost with no
benefit (DEC-UX-002). The Stage 8A brief's 18-item list maps onto it below;
three deltas are named explicitly.

| ID | Screen | Brief item | Built? | Scope |
|---|---|---|---|---|
| C-01 | Splash | 1 | ✅ | MUST |
| C-02 | Onboarding (3 cards, skippable) | 2 | ✅ | SHOULD |
| C-03 | Login — phone number | 3 | ✅ | MUST |
| C-04 | OTP verification | 4 | ✅ | MUST |
| C-20 | District / delivery-area selection | 5 | ❌ new | SHOULD |
| C-05 | Home — restaurants near you | 6, 7 | ✅ | MUST |
| C-06 | Search | 7 | ✅ | MUST |
| C-07 | Restaurant — info + full menu | 8, 9 | ✅ | MUST |
| C-08 | Item — options, note, quantity | 10 | ✅ | MUST |
| C-09 | Cart | 11 | ✅ | MUST |
| C-11 | Address selection / entry | 12 | ✅ | MUST |
| C-10 | Checkout — review and pay | 13 | ✅ * | MUST |
| C-12 | PromptPay QR | 13 | ✅ ** | MUST |
| C-12b | Payment being verified | — | ✅ | MUST |
| C-12c | Payment succeeded | — | ✅ | MUST |
| C-12d | Payment could not be confirmed | — | ✅ | SHOULD |
| C-12e | QR expired | — | ✅ | SHOULD |
| C-12f | Paid twice / already paid | — | ✅ | LATER |
| C-12g | Payment detail | — | ✅ | LATER |
| C-12h | Refund status | — | ✅ | LATER |
| C-13 | Order placed | 14 | ✅ | MUST |
| C-14 | Order tracking | 15 | ✅ *** | MUST |
| C-16 | My orders (history) | 16 | ✅ | MUST |
| C-19 | Order detail (from history) | 17 | ❌ new | MUST |
| C-18 | Profile | 18 | ✅ | MUST |
| C-15 | Rating | — | ✅ | LATER |
| C-17 | Notifications | — | ✅ | SHOULD |

\* C-10 still offers a cash option and a cash-prepared-amount selector, which
DEC-016 disabled. **Removing them is a Phase C/E code task already logged in
`CURRENT_STATUS.md`, not a redesign.**
\*\* The QR is a labelled placeholder until a provider exists (Q-001). The
screen design is complete and correct; only the payload is missing.
\*\*\* The map is a labelled placeholder until Q-018 closes.

State variants already built and retained: skeleton loading, network error,
restaurant closed, empty cart, no rider, order cancelled.

### 5.2 Three design deltas, and why

**DEC-UX-003 — Restaurant detail and menu are one screen, not two.** The brief
lists "Restaurant detail" and "Menu" separately; the implemented C-07 is
restaurant identity, hours and open/closed status pinned above a category-ordered
menu list. Splitting them adds a tap to the core path for no information gain,
which CON-004 forbids. Category jump-links inside C-07 cover the navigation the
separate screen would have provided.

**DEC-UX-004 — No location-permission gate at first run.** The brief lists a
location permission screen at position 5. In a single-district service area
there is nothing for GPS to disambiguate at launch, and a permission prompt
before any value is delivered is the highest-abandonment screen a delivery app
can have. Instead: C-20 lets the user confirm the delivery area (defaulting to
บุณฑริก) and is skippable; the OS location prompt is requested **at address
entry** (C-11), where "ใช้ตำแหน่งปัจจุบัน" is a visible, motivated benefit.
GPS denial never blocks ordering — a Thai address plus a `จุดสังเกต` landmark is
sufficient, and the landmark field is first-class, not optional-looking
(V1.1 §20).

**DEC-UX-008 — The customer never sees payment state, only order state plus a
payment outcome.** Every payment table is API-only in RLS; there is no client
read path, and there should not be. C-12b–C-12h render *outcomes* derived from
the order read model and the payment result the API returns — never a payment
state machine. The customer's mental model stays one order with one status.

### 5.3 The core flow, screen by screen

Requirements below are binding for the flow the brief calls the most important
in Stage 8A.

**C-05 Home.** Above the fold: delivery area, search entry, and the first
restaurant cards. Each card carries name, cuisine, open/closed with today's
hours, and delivery estimate. Closed restaurants are visibly dimmed and remain
tappable (a customer may want tomorrow's hours) but cannot be ordered from. An
active order pins a strip above the tab bar with its state and an ETA. No
carousel, no promotional hero, no "recommended for you".

**C-07 Restaurant.** Identity block (name, hours today, open/closed,
estimate), then menu by category. Unavailable items are shown greyed with
`วันนี้หมด` and are not tappable — hiding them makes the menu inconsistent with
what a customer saw yesterday. If the restaurant is closed, one non-dismissable
banner explains it and the primary action becomes `ดูเวลาเปิดร้าน`.

**C-08 Item.** Options (`menu_option_groups` / `menu_options`), a free-text
note, quantity, and one primary action that always shows the running line total:
`เพิ่มลงตะกร้า ฿130`. Required option groups block the primary action with an
inline message on the group, never a toast.

**C-09 Cart.** One restaurant per cart (DEC-017). Lines with options
summarised, quantity steppers, per-line total. Adding an item from a different
restaurant opens a dialog: `ตะกร้ามีอาหารจากร้านอื่นอยู่ · เริ่มตะกร้าใหม่?`.
Fee lines appear here as server-provided amounts; if any fee is not yet
knowable, the row shows `คำนวณเมื่อยืนยัน` rather than a number the app invented.

**C-10 Checkout.** The one screen that must be frictionless: address (with
landmark), the order summary, the fee breakdown, PromptPay as the only method
(DEC-016), and one primary action `ชำระเงิน ฿NNN`. No upsell, no tip prompt, no
promo field in V1 (promotion funding is BQ-030, `OPEN`). Server-side
revalidation runs on press; a price change or unavailable item returns the
customer to a clearly-marked diff, not a generic failure.

**C-12 → C-12b → C-13 Payment.** QR with a visible countdown of the 10-minute
validity. The screen states plainly that BANHAO waits for the bank's
confirmation — `รอธนาคารยืนยัน` — because CON-002 means the app genuinely cannot
know. C-12b is a patient waiting state, not a spinner over a dead screen: it
shows what has happened, what it is waiting for, and a `ตรวจสอบสถานะอีกครั้ง`
action. On success, C-13 confirms with the order reference and a single primary
action into tracking.

**C-14 Tracking.** The customer's home for the next 30 minutes, and the screen
that carries the most product risk. Structure, top to bottom: current state in
plain Thai as the largest text on screen; the ETA; the map surface (placeholder
until Q-018); the rider's name and phone once a rider is assigned; the derived
timeline from `order_status_history` (never a locally-stored copy); the order
summary; and support/cancel actions whose availability follows §10 exactly. The
timeline shows only steps that have happened plus the immediate next one —
never the whole future machine, which reads as a checklist the customer is
waiting on.

---

## 6. Merchant UX

Restaurant-scoped, always. The merchant surface is a work board, not an
analytics product.

| ID | Screen | Built? | Scope |
|---|---|---|---|
| M-01 | Login (phone OTP, same auth as customer) | ❌ | MUST |
| M-02 | Restaurant selection — **only if** membership covers >1 | ❌ | MUST (conditional) |
| M-03 | `ออเดอร์วันนี้` — three-column live board | ❌ | MUST |
| M-04 | Order detail panel | ❌ | MUST |
| M-05 | Accept confirmation (with prep-time entry) | ⚠ wireframe | MUST |
| M-06 | Reject dialog (reason mandatory) | ❌ | SHOULD |
| M-07 | Preparing state on the board | ❌ | MUST |
| M-08 | Ready-for-pickup state on the board | ❌ | MUST |
| M-09 | Order history + daily summary | ❌ | SHOULD |
| M-10 | Restaurant profile (name, photo, contact, address) | ❌ | SHOULD |
| M-11 | Menu management (categories, items, options, availability) | ❌ | MUST |
| M-12 | Operating hours (`restaurant_hours`) | ❌ | MUST |
| M-13 | Earnings (derived from `ledger_entries`) | ❌ | LATER |
| M-14 | Settings / staff / profile | ❌ | LATER |

### Merchant-specific rules

**Scope must be structurally obvious (DEC-UX-005).** The restaurant name sits in
the header on every screen at every moment. There is no "all restaurants" view,
no aggregate order board, and no global merchant setting anywhere in the
product. A merchant belonging to Restaurant A must never see a control that
implies Restaurant B exists. When membership covers several restaurants, the
switcher is explicit, lists only permitted restaurants, and switching is a full
context reload.

**Order arrival is the one thing that cannot be missed.** Web loses push
(DEC-APP-003 accepts this). Compensation, all three together: a Realtime
subscription updating the board with no refresh; a repeating audible alert until
the order is opened; and a browser-tab title/count change for a tablet on
another tab. If the Realtime connection drops, the board shows a persistent
`การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่` bar — silence must never be mistaken for
"no orders".

**The accept window is a countdown, not a surprise.** The 3-minute window
(`ACCEPTED` value, expiry behaviour `OPEN` — BQ-013) renders as a per-card
countdown chip that turns warning-coloured in its final third. Because expiry
behaviour is undecided, the card at zero shows
`หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ` and takes no automatic action. The design
accommodates either eventual answer without change.

**One primary action per card.** `รับออเดอร์` → `เริ่มทำอาหาร` → `อาหารพร้อม`.
Rejection is always secondary, always requires a reason, and always warns that
the customer will be refunded.

**Menu availability is one tap.** `ปิดขายวันนี้` on an item is inline,
immediate and reversible, with no dialog — it is the single most frequent
merchant action during service and must cost nothing.

**Tablet consideration.** M-03 at 768–1024px collapses three columns to two
with `พร้อมให้ไรเดอร์รับ` as a bottom tray; touch targets rise to 56px; no
hover-only affordance exists anywhere on the merchant surface.

---

## 7. Rider UX

| ID | Screen | Built? | Scope |
|---|---|---|---|
| R-01 | Login (phone OTP) | ❌ | MUST |
| R-02 | Verification / approval status | ⚠ wireframe | MUST |
| R-03 | Home — status + earnings today | ⚠ wireframe | MUST |
| R-04 | Online / offline control | ❌ | MUST |
| R-05 | Delivery offer (countdown) | ⚠ wireframe | MUST |
| R-06 | Offer lost / expired | ❌ | MUST |
| R-07 | Job — go to restaurant | ❌ | MUST |
| R-08 | Arrived at restaurant | ❌ | MUST |
| R-09 | Pickup confirmation | ❌ | MUST |
| R-10 | Job — go to customer | ❌ | MUST |
| R-11 | Handoff / delivery completion | ⚠ wireframe | MUST |
| R-12 | Delivery history | ❌ | SHOULD |
| R-13 | Earnings (from `ledger_entries`) | ❌ | SHOULD |
| R-14 | Profile / documents / settings | ❌ | LATER |

### Rider-specific rules

**Operational status is never ambiguous (DEC-UX-006).** The top strip shows
exactly one of four truths, styled distinctly and never collapsible:

| Rider state | Strip | Home content |
|---|---|---|
| Approved, offline | neutral · `ออฟไลน์` | `เปิดรับงาน` primary button, today's earnings |
| Approved, online | success · `ออนไลน์ · กำลังรอออเดอร์` | live waiting state, `ปิดรับงาน` secondary |
| Pending approval | info · `รอตรวจสอบเอกสาร` | what is missing, what happens next, no online toggle **at all** |
| Suspended / deactivated | error · `บัญชีถูกระงับการใช้งาน` | reason if available, how to contact operations, **no online toggle, no offers, no earnings actions** |

A suspended or unapproved rider does not see a disabled toggle — the control is
absent. The capability simply does not exist for them (`riders.approved` is the
source, per DEC-APP-004), and the UI must not imply otherwise.

**An offer is one full screen.** Restaurant name and distance, customer area
(not the full address — the rider has no read path to it before accepting, by
design, H-1), the rider's earning for the job, and a countdown. Two actions:
`รับงาน` (primary, full width, 64px) and `ผ่านงานนี้`. The countdown value comes
from configuration (DEC-031) because the window length is `OPEN` (BQ-020) — the
design must render 12s and 20s equally well, so no layout may depend on the
number of digits or the arc length.

**Losing a race is normal, not an error.** `409 OFFER_TAKEN` renders as
`งานนี้มีไรเดอร์รับไปแล้ว` on a neutral surface, returning automatically to the
waiting state after a beat. No red, no alert sound, no dead end.

**One action per job step, thumb-reachable.** `ถึงร้านแล้ว` → `รับอาหารแล้ว` →
`ถึงที่หมายแล้ว` → `ส่งสำเร็จ`. Each is a 64px bottom-pinned button. The
customer's phone number and the address become visible only from `RIDER_ASSIGNED`
onward, and only through the rider views — the UI must be built against a
distinct `RiderOrderView` type so no money field can appear even by accident.

**Proof of delivery is designed but gated.** BQ-018 is `OPEN`. R-11 reserves a
photo slot with the copy `ถ่ายรูปยืนยันการส่ง` and treats it as optional in V1;
if BQ-018 later makes it mandatory, the same screen enforces it with no
restructuring. Photos, when they exist, go to a **private** bucket with
signed-URL reads (V1.1 §13).

**Cancelling releases the delivery, never the order.** `ยกเลิกงาน` requires a
reason, then says exactly what happens: `ออเดอร์จะถูกส่งต่อให้ไรเดอร์คนอื่น` —
because that is what DEC-021 means, and a rider must not believe they have
cancelled someone's dinner.

---

## 8. Admin UX

Desktop-first, table-first, keyboard-usable. Nine sections, no more.

| ID | Screen | Built? | Scope |
|---|---|---|---|
| A-01 | Login (staff, phone OTP + `platform_staff`) | ❌ | MUST |
| A-02 | `ภาพรวม` — operational counters | ⚠ wireframe | MUST |
| A-03 | Orders — table, filter, search | ⚠ wireframe | MUST |
| A-04 | Order detail — timeline, payment, delivery, actions | ❌ | MUST |
| A-05 | Restaurants — table | ❌ | MUST |
| A-06 | Restaurant detail — status, hours, menu, activate | ❌ | MUST |
| A-07 | Merchant members — grant / revoke `restaurant_members` | ❌ | SHOULD |
| A-08 | Riders — table with approval and status | ❌ | MUST |
| A-09 | Rider detail — documents, approve, suspend | ❌ | MUST |
| A-10 | Customers — lookup by phone, order history | ❌ | SHOULD |
| A-11 | Staff — `platform_staff` list | ❌ | SHOULD |
| A-12 | Staff detail — grant / revoke | ⚠ wireframe | SHOULD |
| A-13 | Alerts — no-rider, stuck orders, unprocessed events, reconciliation | ❌ | MUST |
| A-14 | Audit / activity (`audit_logs`) | ❌ | SHOULD |
| A-15 | Settings — timers and configuration (DEC-031) | ❌ | LATER |

### Admin-specific rules

**A-04 Order detail is the operator's whole job on one page.** Four stacked
regions, in this order: the order state with its timeline from
`order_status_history`; the payment situation (state, attempts, transactions,
refunds — read through the API, since these tables are API-only); the delivery
situation (state, assigned rider, assignment attempts, release history); and the
action bar. Order state and payment state are shown as two separate, explicitly
labelled facts — CON-001 forbids collapsing them, and an operator seeing
`ยกเลิกแล้ว · รอคืนเงิน` must read that as normal (DEC-027), not as a
contradiction.

**Every intervention names its consequence.** The reassign dialog says the
current rider loses the job and a new search starts. The cancel dialog says the
customer is refunded and the merchant is notified. The refund dialog states that
the state advances only when the provider confirms. Reason is mandatory in all
three (DEC-032).

**A-13 Alerts is a queue, not a notification feed.** Each row is something a
human must resolve, with an owner and an age. Four sources, all already in the
schema: deliveries searching too long (DEC-022), orders past the merchant accept
window, `payment_events` unprocessed beyond the reconciliation window, and open
`reconciliation_cases`. An empty queue reads `ไม่มีรายการค้าง`.

**No enterprise scaffolding.** No role-permission matrix editor, no report
builder, no bulk import, no charts, no CSV export in V1. Staff grants are a
list with grant/revoke; that is the entire authorization UI.

---

## 9. Design System

BANHAO Design System **v1.0 is in force and is not redesigned here.** This
section records the tokens Claude Code must use, then names the additions the
three new surfaces require — an extension list, not a new system.

### 9.1 Tokens in force (from `design/design-system/`)

| Token | Value | Use |
|---|---|---|
| Primary | `#E4572E` | primary fill, active state |
| Primary pressed | `#C2431F` | hover / pressed |
| Gold | `#D6A419` | promotion and badge **only**, never a button |
| Ink | `#1F1A16` | body text, live-order cards |
| Cream | `#FBF7F1` | every screen background — never full-bleed white |
| Surface | `#FFFFFF` | cards, sheets, inputs |
| Border | `#E9E0D5` | card and input borders |
| Text muted | `#7A6E64` | descriptions, metadata |
| Success / Warning / Error / Info | `#0F8B5F` / `#D6A419` / `#D93A3A` / `#2E6FB7` | delivered · waiting · failure · system notice |
| Type | IBM Plex Sans Thai (400/500/600/700), IBM Plex Mono for references and amounts in tables | — |
| Line height | 1.55–1.75 for all Thai text | non-negotiable — vowel collision |
| Minimum size | 12px, metadata only; 14px for anything a user must read | — |
| Spacing | 4-base: 2, 4, 8, 12, 16, 20, 24, 32 | — |
| Radius | 10 badge · 14 secondary · 16 primary/input · 20–22 card · 28 sheet | — |
| Elevation | flat (border) · raised (`0 4px 14px rgba(31,26,22,.08)`) · sheet (`0 -8px 30px rgba(31,26,22,.16)`) | — |
| Touch target | ≥44×44px; primary button 56px mobile, 64px rider in-job | — |

Colour discipline stays as v1.0 states it: cream ground always, primary for the
single main action, gold for promotion only, Ink for the live-order card.

### 9.2 Components in force

Buttons (primary / secondary / ghost / danger, with hover, pressed, disabled and
loading), inputs and forms with inline error, cards, badges, order-status chips,
tabs, bottom navigation, modals, bottom sheets, toasts, alerts, skeleton
loaders, empty states, error states, confirmation dialogs. All specified in
v1.0 and reused unchanged by the customer app.

### 9.3 Additions required by Stage 8A

Each is genuinely absent from v1.0 and is needed by a surface that did not exist
when v1.0 was written. Nothing else is added.

| Addition | Needed by | Notes |
|---|---|---|
| **Data table** — header, sortable column, row hover, row link, dense variant, pagination, empty row | Admin, merchant history | Desktop density: 14px body, 44px row height, Mono for references and amounts |
| **Sidebar navigation** (desktop) | Admin | 9 items, active state, collapsible at <1280px |
| **Scope header** — restaurant identity + optional picker | Merchant | Load-bearing for DEC-UX-005 |
| **Order queue card** — column card with countdown chip and one primary action | Merchant | Three visual variants for the three columns |
| **Countdown chip** — mm:ss, warning in final third, expired state | Merchant accept window, rider offer, QR validity | Value from configuration (DEC-031) |
| **Status strip** — full-width persistent operational status | Rider | Four variants (§7) |
| **Offer card** — full-screen job offer with countdown and 64px action | Rider | Must render 12s and 20s identically |
| **Reason dialog** — confirmation with mandatory free-text reason and a stated consequence | Admin, merchant reject, rider cancel | DEC-032 |
| **Map surface** — labelled placeholder with a fixed aspect and a real-data slot | Customer tracking, rider navigation | Placeholder until Q-018 |
| **Connection banner** — persistent "connection lost / reconnecting" | Merchant board, customer tracking | Silence must never look like calm |
| **Timeline** — derived from `order_status_history`, past steps plus the next one | Customer tracking, admin order detail | Never a stored copy |

### 9.4 Thai-first typography rules (binding)

- Every component is laid out against the **longest real Thai string** it will
  carry, not an English placeholder. `พร้อมให้ไรเดอร์รับ` and
  `บัญชีถูกระงับการใช้งาน` are the stress tests for chips and strips.
- Thai does not wrap on spaces. Any single-line element must define its
  overflow behaviour explicitly: chips and buttons grow, table cells truncate
  with a title attribute, status text never truncates.
- No Latin placeholder text anywhere, including in skeletons and empty states.
- Numerals are Arabic (`13:30`, `฿130`), not Thai numerals.
- Android must be verified for per-weight Thai font families before launch — the
  single most likely rendering failure (V1.1 §14, §20).

---

## 10. Order State UX

One state value, four vocabularies (REQ-002 / DEC-UX-001). The table below is
the authoritative mapping. States are the nine ACCEPTED values (DEC-019) plus
`CANCELLED`; nothing else is implemented in V1 (DEC-APP-006).

| State | Customer sees | Merchant sees | Rider sees | Who may act | Next |
|---|---|---|---|---|---|
| `CREATED` | *(transient — no screen)* | — | — | system | `PENDING_PAYMENT` |
| `PENDING_PAYMENT` | `รอชำระเงิน` + QR + countdown | — | — | customer pays; system expires the attempt | `PAID` |
| `PAID` | `ส่งให้ร้านแล้ว · รอร้านรับออเดอร์` | `ออเดอร์ใหม่ · รอตอบรับ` + countdown | — | merchant accepts / rejects | `MERCHANT_ACCEPTED` |
| `MERCHANT_ACCEPTED` | `ร้านรับออเดอร์แล้ว` | `รับแล้ว · เริ่มทำอาหาร` | *(offer broadcast — `งานใหม่`)* | merchant starts cooking; riders may accept | `PREPARING` |
| `PREPARING` | `ร้านกำลังทำอาหาร` | `กำลังทำอาหาร` | `ร้านกำลังทำอาหาร · ไปรับได้` | merchant marks ready | `READY_FOR_PICKUP` |
| `READY_FOR_PICKUP` | `อาหารพร้อมแล้ว` | `รอไรเดอร์มารับ` | `รับอาหารได้เลย` | rider picks up (needs an assigned rider — the join point) | `PICKED_UP` |
| `PICKED_UP` | `ไรเดอร์รับอาหารแล้ว` | `ส่งมอบให้ไรเดอร์แล้ว` | `รับอาหารแล้ว · ไปส่ง` | rider departs | `DELIVERING` |
| `DELIVERING` | `กำลังไปส่ง` + ETA | `กำลังจัดส่ง` | `กำลังไปส่ง` | rider completes | `DELIVERED` |
| `DELIVERED` | `จัดส่งสำเร็จ` | `สำเร็จ` | `ส่งสำเร็จ` | — terminal | — |
| `CANCELLED` | `ออเดอร์ถูกยกเลิก` + reason + refund status | `ออเดอร์ถูกยกเลิก` | `งานนี้ถูกยกเลิก` | operator/customer per matrix | — terminal |

### Delivery state, shown separately (DEC-018)

The delivery machine is a different domain and must never be blended into the
order status text. It surfaces as a *secondary* line under the order state.

| Delivery state | Customer sees | Merchant sees | Rider sees |
|---|---|---|---|
| `RIDER_SEARCHING` | `กำลังหาไรเดอร์` | `กำลังหาไรเดอร์` | offer |
| `RIDER_ASSIGNED` | rider name + phone | `ไรเดอร์กำลังมารับ` | active job |
| `AT_MERCHANT` | `ไรเดอร์ถึงร้านแล้ว` | `ไรเดอร์ถึงร้านแล้ว` | at shop |
| `RIDER_REASSIGNING` | `กำลังหาไรเดอร์คนใหม่` | `กำลังหาไรเดอร์คนใหม่` | *(released)* |
| `EN_ROUTE` / `DELIVERED` | tracking / done | done at handoff | job steps |

**Prolonged `RIDER_SEARCHING` is not an order state (DEC-022).** After 5 minutes
the customer is told — `ยังหาไรเดอร์ไม่ได้ · เรากำลังเร่งหาให้` — with the
3-minute extension offer, and an operator alert opens in A-13. The order stays
in `PREPARING` or `READY_FOR_PICKUP`. Only an operator ends it.

### Exception presentation

| Situation | Where the user meets it | Copy direction | Status |
|---|---|---|---|
| Payment could not be confirmed | C-12d, order stays `PENDING_PAYMENT` | `ยืนยันการชำระเงินไม่ได้ · ลองสร้าง QR ใหม่` — the order is alive | `ACCEPTED` (state exists) |
| QR expired | C-12e | `QR หมดอายุ · สร้างใหม่ได้เลย` — order survives, new attempt | `ACCEPTED` |
| Merchant rejects | order → `CANCELLED` (V1) | `ร้านไม่สามารถรับออเดอร์นี้ได้ · เงินจะถูกคืน` + nearby shops | window `ACCEPTED`; auto-vs-escalate `OPEN` (BQ-013) |
| Customer cancels | dialog on C-14, availability per matrix below | states the refund consequence before confirming | fees `OPEN` (Q-003, BQ-016) |
| Rider cancels | customer sees `กำลังหาไรเดอร์คนใหม่` only | the order never moves (DEC-021) | `ACCEPTED` |
| No rider | §above | notify, extend, escalate — never auto-cancel | `ACCEPTED` (DEC-022) |
| Delivery failure | not designed in V1 | — | `OPEN` (BQ-017) — **no screen, deliberately** |

Cancellation availability, from `ORDER_LIFECYCLE.md` §5 — the UI mirrors this
table exactly and derives nothing:

| Order state | Customer button | Copy |
|---|---|---|
| `PENDING_PAYMENT` | `ยกเลิกออเดอร์` enabled | `ยังไม่มีการตัดเงิน` |
| `PAID`, `MERCHANT_ACCEPTED` | enabled | `เงินจะถูกคืนเต็มจำนวน` |
| `PREPARING`, `READY_FOR_PICKUP` | enabled → requires merchant confirmation | `ร้านเริ่มทำอาหารแล้ว · ต้องขอให้ร้านยืนยันก่อน` |
| `PICKED_UP` onward | **absent**, replaced by `ติดต่อฝ่ายช่วยเหลือ` | — |

**No state name, cause code, or error code is ever rendered to a user.** All
four apps resolve `code` → Thai copy from `copy/th.ts` (DEC-APP-012).

---

## 11. Capability-Aware UX

The UI renders capabilities, never `profiles.role` (DEC-APP-004; DEC-033).

| Capability | Source of truth | Grants which surface | Scope |
|---|---|---|---|
| customer | implicit for any authenticated profile | Customer app | own rows only |
| merchant | `restaurant_members` (with `memberRole`) | Merchant web | **per restaurant** |
| rider | `riders` (with approval + suspension state) | Rider app | own rows + assigned delivery, through the three views only |
| platformStaff | `platform_staff` (with `staffRole`) | Admin web | platform-wide |

### Binding UI rules

1. **The shell is chosen by capability, not by role.** No app asks "what are
   you?" at login. The merchant web app is reachable only with a merchant
   capability; a customer who signs in there sees
   `บัญชีนี้ยังไม่ได้เป็นร้านค้า` and a route back — never an empty merchant
   dashboard.
2. **No in-app capability switcher in V1 (DEC-UX-010).** A person who is both a
   customer and a rider uses two apps. A switcher implies a merged session
   model that does not exist and would encourage exactly the ambiguity
   DEC-APP-004 removes.
3. **Absence, not disablement, for a capability you lack.** A disabled control
   teaches a user that a capability exists and is being withheld. Missing
   capability → the control is not rendered.
4. **Disablement, not absence, for a capability you have but cannot use right
   now.** A rider who is approved but offline sees `เปิดรับงาน`. A rider whose
   account is suspended sees no toggle at all. The distinction is the whole
   point.
5. **Scope is visible wherever it is narrower than the app.** Merchant:
   restaurant name in the header, always. Rider: the current job, and nothing
   about any other delivery. Admin: platform-wide, so nothing to state.
6. **The client never adjudicates.** RLS and the API are the boundary; the UI
   hides what it should not offer, and a `403` is treated as a bug worth
   surfacing plainly (`คุณไม่มีสิทธิ์ทำรายการนี้`) **without logging the user
   out** (V1.1 §5).
7. **Revocation takes effect on the next read.** Suspension, revoked membership
   and staff revocation are read from the database per request — never cached in
   client state across a session, and never carried in a token claim.

---

## 12. Responsive / Device Strategy

| Surface | Primary | Also supported | Not supported in V1 |
|---|---|---|---|
| Customer | Phone (360–430px) | — | tablet layout, web |
| Merchant | Desktop (1280px+) | Counter tablet (768–1024px, portrait and landscape) | phone-optimised layout (usable, not designed) |
| Rider | Phone (360–430px) | — | tablet, web |
| Admin | Desktop (1440px+) | Laptop (1280px), tablet read-only | phone |

**Breakpoints:** 430 (phone max), 768 (tablet), 1024 (tablet landscape / small
laptop), 1280 (desktop), 1440 (admin comfortable).

**Per-device behaviour that matters:**

- *Customer phone:* primary action bottom-pinned above the safe area; the cart
  and checkout summaries stay visible while scrolling; keyboard avoidance is
  explicitly required on C-11 and C-08 (currently UNVERIFIED per
  `CURRENT_STATUS.md`).
- *Merchant tablet:* three columns → two plus a bottom tray; 56px targets; no
  hover-only affordances; the audible alert must survive a backgrounded tab, and
  if the browser blocks autoplay the board shows a one-time
  `กดเพื่อเปิดเสียงแจ้งเตือน` prompt.
- *Rider phone:* one-handed reach — every job action is in the bottom third;
  64px buttons; high-contrast text for sunlight; no gesture-only action anywhere.
- *Admin laptop at 1280px:* the sidebar collapses to icons; tables keep at
  least order reference, state, age and one action visible before horizontal
  scroll.

---

## 13. Empty / Error / Edge States

Designed for every flow, not only the happy path. Each row is a real state with
real copy, an illustration slot, and one action.

| State | Where | Copy (Thai) | Action |
|---|---|---|---|
| Loading, first paint | all lists | *(skeleton — no text)* | — |
| Loading, action in flight | any primary button | in-button spinner + `กำลังดำเนินการ` | disabled |
| Empty — no restaurants | C-05 | `ยังไม่มีร้านในพื้นที่นี้` | `เปลี่ยนพื้นที่จัดส่ง` |
| Empty — no search results | C-06 | `ไม่พบร้านหรืออาหารที่ค้นหา` | `ดูร้านทั้งหมด` |
| Empty — cart | C-09 | `ตะกร้ายังว่างอยู่` | `เลือกอาหาร` |
| Empty — no orders | C-16 | `ยังไม่มีประวัติการสั่ง` | `สั่งอาหาร` |
| Empty — merchant board | M-03 | `ยังไม่มีออเดอร์ใหม่` + open/closed restated | — |
| Empty — rider waiting | R-03 | `กำลังรอออเดอร์ใหม่` + live indicator | `ปิดรับงาน` |
| Empty — admin queue | A-13 | `ไม่มีรายการค้าง` | — |
| Offline / no network | all | `ไม่มีการเชื่อมต่ออินเทอร์เน็ต` | `ลองอีกครั้ง` |
| Connection lost mid-session | C-14, M-03 | persistent banner `การเชื่อมต่อหลุด · กำลังเชื่อมต่อใหม่` | auto-retry |
| Network timeout | any write | `ระบบตอบกลับช้า · ลองอีกครั้ง` | retry — **only** with the same `Idempotency-Key` |
| Unauthorized (401) | any | `เซสชันหมดอายุ · เข้าสู่ระบบอีกครั้ง` | to login, session cleared |
| Forbidden (403) | any | `คุณไม่มีสิทธิ์ทำรายการนี้` | back — **do not log out** |
| Expired session | on resume | same as 401 | to login |
| Restaurant closed | C-07 | `ร้านปิดอยู่ · เปิด 08:00 พรุ่งนี้` | `ดูเวลาเปิดร้าน` |
| Item unavailable | C-07, C-09, checkout revalidation | `วันนี้หมด` inline; at checkout, a marked diff | `นำออกจากตะกร้า` |
| Price changed | checkout revalidation | `ราคามีการเปลี่ยนแปลง` + old → new per line | `รับทราบและไปต่อ` |
| Address out of zone | C-11, checkout | `ที่อยู่นี้อยู่นอกพื้นที่จัดส่ง` | `เลือกที่อยู่อื่น` |
| Order rejected by merchant | C-14 | `ร้านไม่สามารถรับออเดอร์นี้ได้ · เงินจะถูกคืน` | `ดูร้านใกล้เคียง` |
| Order cancelled | C-14 | `ออเดอร์ถูกยกเลิก` + reason + refund status | `สั่งอีกครั้ง` |
| Payment failed | C-12d | `ยืนยันการชำระเงินไม่ได้` | `สร้าง QR ใหม่` |
| QR expired | C-12e | `QR หมดอายุ` | `สร้าง QR ใหม่` |
| Paid twice | C-12f | `ระบบพบการชำระเงินซ้ำ · ทีมงานกำลังตรวจสอบ` | `ติดต่อฝ่ายช่วยเหลือ` |
| No rider yet | C-14 | `ยังหาไรเดอร์ไม่ได้ · เรากำลังเร่งหาให้` | `รอต่อ` / `ติดต่อฝ่ายช่วยเหลือ` |
| Rider cancelled | C-14 | `กำลังหาไรเดอร์คนใหม่` — order unchanged | — |
| Offer lost | R-06 | `งานนี้มีไรเดอร์รับไปแล้ว` | auto-return to waiting |
| Offer expired | R-06 | `หมดเวลารับงาน` | auto-return to waiting |
| Rider not approved | R-02 | `รอตรวจสอบเอกสาร` + what is missing | `ส่งเอกสารเพิ่ม` |
| Rider suspended | R-03 | `บัญชีถูกระงับการใช้งาน` + reason if available | `ติดต่อผู้ดูแลระบบ` |
| Merchant accept window expired | M-03 | `หมดเวลาตอบรับ · ติดต่อผู้ดูแลระบบ` | — (BQ-013 `OPEN`) |
| Server error (500) | any | `ระบบมีปัญหาชั่วคราว` + correlation id the user can quote | `ลองอีกครั้ง` |

Two rules that apply to the whole table: **no technical token, constraint name
or SQLSTATE ever reaches a user** (V1.1 §10), and **an error state always
offers a way forward** — back, retry, or contact — never a dead end.

---

## 14. Accessibility

Design targets WCAG 2.1 AA where it applies to a mobile product, plus the Thai
legibility rules the design system already carries.

**Contrast — measured against the v1.0 palette, with two findings.**

| Pair | Ratio | Verdict |
|---|---|---|
| Ink `#1F1A16` on Cream `#FBF7F1` | ~15.5:1 | pass |
| Muted `#7A6E64` on Cream | ~4.65:1 | pass for ≥14px body |
| `#9A8C7E` on Cream (metadata grey used in the canvases) | ~3.06:1 | **fail** — decorative only |
| White on Primary `#E4572E` | ~3.68:1 | **fail at 16px**, pass as large text (≥18.66px bold / 24px) |
| White on Primary pressed `#C2431F` | ~5.09:1 | pass |
| White on Error `#D93A3A` | ~4.0:1 | pass as large text only |

**UX-FINDING-01.** The primary button label at 16px/600 on `#E4572E` does not
meet AA for normal text. Two remedies, both cheap; this specification does not
choose one, because the primary colour is a brand decision:
(a) raise primary button labels to 17–18px/700, which is defensible on a 56px
button and helps Thai legibility anyway; or (b) use `#C2431F` as the fill for
text-bearing primary buttons and keep `#E4572E` for fills and accents.
**Product Owner decision — recorded in §17 as UX-Q-001.**

**UX-FINDING-02.** `#9A8C7E` must not carry text a user needs to read. Any such
text moves to `#7A6E64` at ≥12px. This is a usage rule, not a token change.

**Other requirements.**

- **Touch targets** ≥44×44px everywhere; 56px primary on mobile; 64px for rider
  in-job actions; ≥8px between adjacent targets.
- **Thai typography** — line height 1.55–1.75 always; no all-caps Thai; no
  letter-spacing on Thai text; never rely on font weight alone to distinguish
  Thai characters at small sizes.
- **Never colour alone.** Every status carries a word; order-state chips pair
  colour with Thai text; the rider status strip states its status in words.
- **Screen reader semantics.** Every button has a Thai accessible label
  (`เพิ่มลงตะกร้า ผัดกะเพราหมูสับ`, not `เพิ่ม`); order state changes announce
  politely on C-14; the merchant board announces a new order; decorative
  illustrations are hidden from the tree; skeletons expose a busy state.
- **Keyboard, admin (required).** Every table is reachable and operable by
  keyboard; focus is always visible (2px `#2E6FB7` ring, never `outline:none`);
  dialogs trap focus and close on Escape; the mandatory-reason field receives
  focus on open; primary submit on Enter, cancel on Escape.
- **Motion.** No animation is required to understand a state; respect
  `prefers-reduced-motion`; nothing flashes faster than 3Hz (relevant to the
  merchant new-order alert).
- **Errors are described in words, next to the field**, not by red border alone.

---

## 15. UX Rules (binding)

1. **One primary action per screen.** If two things look equally primary, one of
   them is not.
2. **The core path never grows.** Any addition to
   open → choose shop → choose food → order → wait → receive is deferred
   (CON-004). This rule outranks feature requests.
3. **Order state is the product.** Every actor sees the same state value in
   their own words, from the server, on the screen they are already looking at
   (REQ-002).
4. **Never hide operational status.** Rider suspension, merchant closed, lost
   connection, and payment-awaiting-confirmation are always visible when true.
5. **Destructive actions confirm, and name their consequence** — who gets
   refunded, who gets notified, what happens to the order.
6. **Privileged actions require a reason** (DEC-032). No exceptions in admin.
7. **Errors state what happened and what to do next.** Never a bare
   `เกิดข้อผิดพลาด`.
8. **No technical vocabulary reaches a user** — no state names, cause codes,
   error codes, table names, or English fallbacks.
9. **Thai-first copy, keyed not stored** (DEC-APP-012). No string lives in the
   database or in an API response; no screen file contains a literal.
10. **Money is never invented by the client.** Amounts come from the server;
    unknown fees display as `คำนวณเมื่อยืนยัน`, never as `฿0`.
11. **Concurrency outcomes are normal outcomes.** A lost race, a duplicate
    submit, a stale screen resolve calmly with a refresh, not an error state.
12. **Design for the longest real Thai string,** and verify on Android before
    launch.
13. **Local context is honoured** — `จุดสังเกต` is a first-class address field;
    shop names appear as their owners write them; 24-hour time; พ.ศ. for full
    dates.
14. **Nothing half-built ships.** A service or feature not in this MVP appears
    as a dimmed, unclickable `เร็ว ๆ นี้` card with no destination, or not at
    all — never as a broken screen.

---

## 16. MVP Scope

The MVP is the smallest product that can complete one real order end to end,
for all four actors, in one district.

### MUST HAVE — launch is not possible without these

| Surface | Screens |
|---|---|
| Customer (18) | C-01 splash · C-03 login · C-04 OTP · C-05 home · C-06 search · C-07 restaurant+menu · C-08 item · C-09 cart · C-11 address · C-10 checkout · C-12 + C-12b + C-12c payment · C-13 placed · C-14 tracking · C-16 history · C-19 order detail · C-18 profile |
| Merchant (9) | M-01 login · M-02 restaurant selection (conditional) · M-03 board · M-04 order detail · M-05 accept · M-07 preparing · M-08 ready · M-11 menu availability · M-12 hours |
| Rider (11) | R-01 login · R-02 status · R-03 home · R-04 online/offline · R-05 offer · R-06 offer lost · R-07 to shop · R-08 arrived · R-09 pickup · R-10 to customer · R-11 completion |
| Admin (9, in 7 groups) | A-01 login · A-02 counters · A-03 orders · A-04 order detail · A-05/A-06 restaurants · A-08/A-09 riders · A-13 alerts |
| Cross-cutting | every state in §13 that belongs to a MUST screen; the §10 state vocabulary in all four apps; the §9.3 component additions |

### SHOULD HAVE — launch is possible without them; add within the first weeks

C-02 onboarding · C-20 area selection · C-12d / C-12e payment failure and expiry
· C-17 notifications · M-06 reject dialog · M-09 merchant history · M-10
restaurant profile · R-12 delivery history · R-13 earnings · A-07 merchant
members · A-10 customers · A-11/A-12 staff · A-14 audit viewer.

### LATER — deliberately out of scope

C-15 rating · C-12f/g/h duplicate-payment, payment detail, refund status ·
M-13 merchant earnings · M-14 merchant settings/staff · R-14 rider profile and
documents · A-15 settings editor · every screen for a `PROPOSED` exception state
(`PAYMENT_FAILED`, `PAYMENT_EXPIRED`, `MERCHANT_REJECTED`, `DELIVERY_FAILED`) ·
promotions, coupons, ratings, chat, favourites, scheduled orders, multi-restaurant
carts, tipping, loyalty, referral, phases 2–4 services.

### The MVP proves

- **Customer:** discover a restaurant → choose food → checkout → place an order
  → track it to delivery.
- **Merchant:** receive → accept → prepare → mark ready → hand off.
- **Rider:** go online → receive → accept → pick up → deliver → complete.
- **Admin:** observe every order, and resolve the ones that stall.

### Explicit anti-scope

No feature that lengthens the core path. No dashboard, chart, report, or export.
No rating or review. No promotion engine. No chat. No in-app capability
switcher. No second language. No second service line.

---

## 17. Open UX Decisions

Each needs a Product Owner answer. None blocks starting on the MUST list; each
blocks one specific screen detail, named here so nobody guesses.

| id | Question | Blocks | Related |
|---|---|---|---|
| UX-Q-001 | Primary-button contrast remedy: larger label, or `#C2431F` fill for text-bearing buttons? | design-system token usage across all four apps | UX-FINDING-01 |
| UX-Q-002 | Rider offer window: 12s or 20s? (contradictory in the repository) | R-05 countdown default; layout already tolerates both | BQ-020 |
| UX-Q-003 | Merchant accept-window expiry: auto-reject, or escalate to an operator? | M-03 expired-card behaviour; A-13 alert row | BQ-013 |
| UX-Q-004 | Is proof-of-delivery mandatory, optional, or absent in V1? | R-11 photo slot enforcement; storage bucket | BQ-018 |
| UX-Q-005 | Cancellation fee policy and its wording | C-14 cancel dialog copy | Q-003, BQ-016 |
| UX-Q-006 | Which operator options are offered on a no-rider order, in what order? | A-13 and A-04 action bars | DEC-022 |
| UX-Q-007 | Maps provider, and whether the customer sees a live rider marker or a coarse ETA in V1 | C-14 map surface; R-07/R-10 navigation | Q-018 |
| UX-Q-008 | Notification channels at launch: push only, or push + SMS + LINE? | C-17; notification copy set | ADR-011 |
| UX-Q-009 | Exception state names (`PAYMENT_FAILED` et al.) | LATER screens; C-12d/e copy keys | ORDER_LIFECYCLE §3 |
| UX-Q-010 | Delivery-fee and service-fee presentation once numbers exist: single `ค่าส่ง` line or itemised? | C-09, C-10 fee block | BQ-026, BQ-027 |
| UX-Q-011 | Does a merchant see rider identity before handoff? | M-03 card, M-04 detail | not decided in repo |
| UX-Q-012 | Order reference format shown to users (`BH000125`-style?) | every surface that shows a reference | not decided in repo |

---

## 18. Design Risks

| # | Risk | Severity | Position |
|---|---|---|---|
| 1 | **Merchant misses an order on web.** No push; a tablet on another tab or with autoplay blocked is silent | **P0** | Three-way mitigation in §6 plus the connection banner. If merchants still miss orders, the answer is a native merchant app — a DEC-APP-003 reversal, not a UX patch |
| 2 | **The customer's wait is the product's weakest moment.** Payment confirmation is asynchronous by law of CON-002, and the map is a placeholder | **P0** | C-12b and C-14 are specified as *informative* waiting states, not spinners. UX-Q-007 decides how much tracking fidelity V1 ships |
| 3 | **Thai string length breaks chips, strips and table cells** | P1 | §9.4 makes longest-string layout a requirement, with explicit overflow rules per component |
| 4 | **Android unverified**, and Thai per-weight font families are the likely failure | P1 | Already a Phase A checklist item (V1.1 §14). No UX change; a verification gate |
| 5 | **Rider one-handed use in traffic.** Any mis-tap on a job action is a real-world consequence | P1 | 64px bottom-third actions, no gestures, destructive actions behind a dialog with a reason |
| 6 | **Operator power without guardrails** — reassign, cancel, refund are all irreversible from a user's point of view | P1 | Mandatory reason (DEC-032), consequence stated in every dialog, `audit_logs` on every action |
| 7 | **Fee numbers are unknown, so checkout cannot be finished visually** | P1 | Fee block designed as server-driven rows; `คำนวณเมื่อยืนยัน` placeholder; no invented default anywhere (V1.1 §18 risk 13) |
| 8 | **Contrast finding on the brand primary** | P2 | UX-Q-001. Cheap either way, but it touches every button in the product, so it should be answered before implementation, not after |
| 9 | **Two apps for one person** who is both customer and rider (DEC-UX-010) | P2 | Accepted. Revisit only if real users complain; a switcher is a session-model change, not a UI change |
| 10 | **Empty merchant board is ambiguous** between "closed" and "quiet" | P2 | Solved by restating open/closed inside the empty state; called out because it is the kind of thing that gets dropped in implementation |
| 11 | **The customer app already encodes 12 superseded order states** and renders its timeline from them | P1 | Not a design risk to fix here: it is the Phase C/E code task in `CURRENT_STATUS.md`. §10 is the target vocabulary |
| 12 | **Scope creep through the admin surface** — it is the easiest place to add "just one report" | P2 | §8 caps admin at nine sections and §16 names the anti-scope explicitly |

---

## 19. Implementation Handoff Requirements

What Claude Code needs in order to implement this specification without
inventing product behaviour.

### Order of work (aligned to V1.1 §15, not a new roadmap)

1. **Phase B/C prerequisites first.** Capability resolution (DEC-APP-004) and
   the Supabase-backed catalog must land before any new screen, or every new
   surface is built against mocks a second time.
2. **Customer MUST-list corrections** on the existing app: remove the cash
   option and prepared-amount selector (DEC-016), replace the 12 mock order
   states with the §10 vocabulary (DEC-019), add C-19 order detail, drop the
   `(ตัวอย่าง)` labels as real data arrives.
3. **Merchant web** — new Next.js app (DEC-APP-003). M-01 → M-03 → M-04/M-05 →
   M-07/M-08 → M-11/M-12. The board and its alerting are the whole risk.
4. **Rider app** — R-01 → R-02/R-03/R-04 → R-05/R-06 → R-07…R-11, built
   exclusively against `RiderOrderView`.
5. **Admin** — A-01 → A-03/A-04 → A-13 → A-08/A-09 → A-05/A-06.

### Non-negotiable implementation constraints

- **Copy lives in `copy/th.ts` per app**, keyed by state, error code, empty
  state, validation and notification (DEC-APP-012). `@banhao/types` owns the key
  unions so a missing Thai string fails typecheck. **No literal string in a
  screen file.**
- **Status text is derived from the server's state value only.** No screen
  computes status (REQ-002). No client-side state machine.
- **Reads direct from Supabase under RLS; writes through the API**
  (DEC-APP-008). Cart and `rider_availability` are the two client-write
  exceptions.
- **Rider screens type against a distinct `RiderOrderView`.** No rider screen
  may reference an order money field, `customer_id`, or `address_id` before
  assignment.
- **Every state change is a command** (`accept`, `ready`, `picked-up`), never a
  state PATCH. A `409` is rendered as a refresh, not a failure.
- **`Idempotency-Key` on every retryable write** initiated from a UI retry
  button.
- **`@banhao/ui` carries tokens and layout only — never copy.** Web apps get
  their own presentational layer sharing tokens (V1.1 DEC-APP-003).
- **Timers come from configuration** (DEC-031): accept window, QR validity,
  offer window, no-rider notice. No hardcoded durations in a component.
- **No screen for a `PROPOSED` state.** If a state name is not ACCEPTED, the
  screen is not built (DEC-APP-006).

### What must exist before an MVP screen is called done

1. All four of loading / empty / error / offline for that screen, from §13.
2. Thai copy keyed, with the longest real string laid out and screenshotted.
3. Contrast and touch targets checked against §14, including the UX-Q-001
   resolution.
4. Capability behaviour verified: the screen is absent without the capability,
   and a `403` does not log the user out.
5. Verified on iOS **and Android** for mobile surfaces; on desktop **and**
   counter tablet for merchant; keyboard-only for admin.

### Design artifacts this stage produced

- `BANHAO-UX-SPEC-V1.md` — this specification (authoritative for UX).
- `BANHAO UX Specification V1.dc.html` — designed reading copy of the same
  content.

Existing design artifacts that remain in force and are **not** superseded:
`BANHAO Design System.dc.html` (v1.0), `BANHAO Customer App.dc.html` (31 states),
`BANHAO Product Architecture.dc.html`, `BANHAO Payment Architecture.dc.html`.

---

## 20. UX Decisions Recorded by This Stage

| id | Decision |
|---|---|
| DEC-UX-001 | One order state value, four actor vocabularies; no screen computes status (implements REQ-002) |
| DEC-UX-002 | Customer screen numbering stays as implemented; the Stage 8A list is mapped onto it, not substituted for it |
| DEC-UX-003 | Restaurant detail and menu are one screen |
| DEC-UX-004 | No location-permission gate at first run; permission is requested at address entry, and denial never blocks ordering |
| DEC-UX-005 | Merchant restaurant scope is persistent header identity; no global merchant view exists |
| DEC-UX-006 | Rider operational status is a persistent strip; unavailable capability is absent, not disabled |
| DEC-UX-007 | Admin overview is a counter row linking into filtered tables; no charts in V1 |
| DEC-UX-008 | The customer sees order state plus a payment outcome, never a payment state machine |
| DEC-UX-009 | No screen is designed or built for a `PROPOSED` exception state |
| DEC-UX-010 | No in-app capability switcher in V1; one capability, one app |
| DEC-UX-011 | One primary action per screen; 56px mobile, 64px rider in-job, bottom-pinned |
| DEC-UX-012 | Skeletons for first paint, in-button spinners for actions; never a full-screen spinner |
| DEC-UX-013 | Thai copy is keyed per app (ratifies DEC-APP-012); no literal in a screen file |

These are UX decisions within the approved architecture. None contradicts an
`ACCEPTED` `DEC-NNN`, an `ADR`, or a `DEC-APP`. Any future deviation needs a new
recorded decision.

---

## 21. Stage 8A Checkpoint

**STATUS** — Complete. Design specification only. No implementation.

**FILES CREATED** — `BANHAO-UX-SPEC-V1.md`,
`BANHAO UX Specification V1.dc.html`. No repository file in
`kmandev/banhao-design` was created, modified, committed, or pushed. No
migration, no schema change, no deployment.

**UX FLOWS COMPLETED** — Customer end-to-end (home → restaurant → menu → cart →
checkout → payment → placed → tracking → delivered) at full detail; merchant
receive → accept → prepare → ready → handoff; rider online → offer → accept →
pickup → deliver → complete; admin observe → intervene. Order-state UX mapped
for all four actors across nine ACCEPTED states plus `CANCELLED`.

**DESIGN SYSTEM STATUS** — v1.0 in force, unchanged. Eleven additions specified
for the three new surfaces (§9.3). Two accessibility findings raised, one
requiring a Product Owner decision (UX-Q-001).

**MVP SCOPE** — MUST: 18 customer, 9 merchant, 11 rider, 9 admin screens (admin in 7 groups).
SHOULD and LATER lists explicit, with a named anti-scope.

**OPEN DECISIONS** — 12 (UX-Q-001…UX-Q-012), each mapped to the repository
question it depends on. None blocks starting the MUST list.

**CONFLICTS WITH REPOSITORY DECISIONS** — None. Three places where this
specification departs from the *brief* rather than the repository are recorded as
DEC-UX-003 (menu merged into restaurant), DEC-UX-004 (no first-run location
gate), and DEC-UX-002 (existing screen numbering retained). Two pre-existing code
divergences are referenced, not re-litigated: the customer app's cash option
(DEC-016) and its 12 superseded order states (DEC-019) — both already logged as
Phase C/E tasks.

**IMPLEMENTATION READINESS** — Ready, after Phase B (capability resolution) and
Phase C (catalog) land, per V1.1 §15. Nothing in this specification requires a
database change, a new service, or a new technology.

*Stage 8A ends here. Do not implement, commit, push, or deploy.*
