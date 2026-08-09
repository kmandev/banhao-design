# Customer App — Implementation Map

Design audit of `design/customer/BANHAO Customer App.dc.html`, which is the
**source of truth** for Customer App UI/UX. Nothing here is invented; every row
traces to the design artifact.

Audited 2026-08-09 against the screen registry at lines 999–1005 of the canvas.

---

## ⚠️ Discrepancy: 18 numbered screens, but 31 addressable states

The brief specifies **18 screens**, and that is correct — the design registers
exactly 18 *numbered* screens (`01`–`18`). But the same registry contains
**13 further addressable states** that are not numbered:

| Group (design's own label) | Count | Screens |
|---|---|---|
| `เข้าใช้งาน` | 4 | 01 Splash, 02 Onboarding, 03 เข้าสู่ระบบ, 04 ยืนยัน OTP |
| `ค้นหา & สั่ง` | 9 | 05 หน้าแรก, 06 ค้นหา, 07 หน้าร้าน, 08 เลือกตัวเลือกอาหาร, 09 ตะกร้า, 10 ยืนยันการสั่ง, 11 ที่อยู่จัดส่ง, 12 พร้อมเพย์ QR, 13 สั่งสำเร็จ |
| `การชำระเงิน` | **7** | 12b กำลังตรวจสอบ, 12c ชำระสำเร็จ, 12d ยืนยันไม่ได้, 12e QR หมดอายุ, 12f จ่ายซ้ำ/จ่ายแล้ว, 12g รายละเอียดการจ่าย, 12h การคืนเงิน |
| `หลังสั่ง` | 5 | 14 ติดตามออเดอร์, 15 ให้คะแนน, 16 ออเดอร์ของฉัน, 17 แจ้งเตือน, 18 บัญชีของฉัน |
| `States` | **6** | ⏳ กำลังโหลด, 📡 เน็ตมีปัญหา, 🌙 ร้านปิด, 🧺 ตะกร้าว่าง, 🛵 ไม่มีไรเดอร์, 🚫 ออเดอร์ถูกยกเลิก |

**18 numbered + 7 payment sub-states + 6 state variants = 31 total.**

**Resolution:** all 31 are implemented. The 18 numbered screens are the primary
routes; the 13 others are states of those routes, not separate destinations.
Dropping them would violate the instruction not to remove screens, and the
payment sub-states in particular map directly onto the Payment State Machine in
`docs/ARCHITECTURE.md` (`PENDING → PROCESSING → SUCCESS / FAILED / EXPIRED`,
plus refund states) — they are product behaviour, not decoration.

No document needed correcting: `README.md`, `docs/ARCHITECTURE.md`,
`docs/CURRENT_STATUS.md`, and `ai/KNOWLEDGE/FACTS.md` already state 18, which
matches the numbered count.

---

## Design tokens extracted (measured by frequency in the artifact)

| Token | Value | Evidence |
|---|---|---|
| Primary | `#E4572E` | 58 occurrences; active nav, CTAs, brand |
| Primary pressed | `#C2431F` | 8; `a:hover` |
| Text primary | `#1F1A16` | 27 |
| Text muted | `#7A6E64` | 96 — the most used colour in the file |
| Text subtle | `#9A8C7E` / `#A2968A` | 12 / 4 |
| Border | `#E9E0D5` | 65 |
| Surface | `#FBF7F1` | 11 |
| Surface alt | `#EFE7DC`, `#F3EDE4`, `#F0E8DD` | 11 / 8 / 6 |
| Success | `#0F8B5F` | 16; discounts, success states |
| Success bg | `#E7F4EE` | 8 |
| Warning bg | `#FDF3E6` | 4 |
| Accent bg | `#F3E7D6` | 14 |
| Radius | 12, 14, 16, 18, 20, 22, 28 px | 16px most common (41×) |
| Font sizes | 11–26 px; 13px most common (51×) | — |
| Font | IBM Plex Sans Thai, weights 400/500/600/700 | Google Fonts link in `<head>` |
| Shadow (bottom bar) | `0 -6px 20px rgba(31,26,22,.06)` | — |
| Shadow (sheet) | `0 -8px 30px rgba(31,26,22,.16)` | — |
| Focus ring | `0 0 0 3px rgba(228,87,46,.14)` | — |

Implemented in `packages/ui/src/theme/`.

## Pricing model (from the design's own `total()`)

```js
total() { return Math.max(0, this.subtotal() + 15 + 5 - 10); }
```

Delivery ฿15, service ฿5, `BANHAO7` discount −฿10. These are **design sample
values**, not agreed business rules — the real platform fee is Q-010 (`OPEN`).
Held in `apps/customer/src/mocks/pricing.ts` and labelled as such.

---

## Screen map

Status: `DONE` = implemented this step. Route = React Navigation route name.

### Auth stack

| # | Screen | Route | Purpose | Key components | Interactions | State | Data | API | Status |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Splash | `Splash` | Brand + session bootstrap | `BrandMark` | auto-advance on session resolve | auth loading | — | Supabase session | DONE |
| 02 | Onboarding | `Onboarding` | Value prop | `Button` | continue | — | static copy | — | DONE |
| 03 | เข้าสู่ระบบ | `Login` | Phone entry | `Input`, `Button` | submit phone | phone, validation | — | Supabase OTP (foundation) | DONE |
| 04 | ยืนยัน OTP | `Otp` | 6-digit OTP | `OtpInput`, `Button` | verify, resend | code, countdown | — | Supabase verify | DONE |

### Main tabs (`showTabs` in design: home, orders, notif, profile)

| # | Screen | Route | Purpose | Key components | Interactions | State | Data | API | Status |
|---|---|---|---|---|---|---|---|---|---|
| 05 | หน้าแรก | `Home` | Discovery | `CategoryChip`, `ShopCard`, `SearchBar` | open shop, category filter | list, refresh | shops, categories | Mock repo | DONE |
| 06 | ค้นหา | `Search` | Search shops + menu | `SearchBar`, `ResultRow` | query, open result | query, results | shops, menu | Mock repo | DONE |
| 16 | ออเดอร์ของฉัน | `Orders` | Order history | `OrderCard`, `EmptyState` | open order | list | orders | Mock repo | DONE |
| 17 | แจ้งเตือน | `Notifications` | Notification list | `NotificationRow` | mark read | list | notifications | Mock repo | DONE |
| 18 | บัญชีของฉัน | `Profile` | Profile + logout | `Avatar`, `ListRow`, `Button` | edit display name, logout | profile | `profiles` | **Supabase (real)** | DONE |

### Ordering flow

| # | Screen | Route | Purpose | Key components | Interactions | State | Data | API | Status |
|---|---|---|---|---|---|---|---|---|---|
| 07 | หน้าร้าน | `Shop` | Shop + menu | `ShopHeader`, `MenuRow`, `Tabs` | add item | menu tab | shop, menu | Mock repo | DONE |
| 08 | เลือกตัวเลือกอาหาร | `ItemOptions` | Options + qty | `OptionGroup`, `Stepper`, `Textarea` | choose options, qty, note | meat/spicy/egg/qty/note | product | Mock repo | DONE |
| 09 | ตะกร้า | `Cart` | Cart lines | `CartLine`, `Stepper`, `EmptyState` | inc/dec/remove | cart | cart | Local (Zustand-free context) | DONE |
| 10 | ยืนยันการสั่ง | `Checkout` | Summary + payment | `PriceRow`, `PaymentOption` | choose PromptPay/cash | payment method | cart, pricing | Mock repo | DONE |
| 11 | ที่อยู่จัดส่ง | `Address` | Address select | `AddressOption` | choose address | address | addresses | Mock repo | DONE |
| 12 | พร้อมเพย์ QR | `PromptPayQr` | QR + countdown | `QrPlaceholder`, `Countdown` | — (no real payment) | countdown | order ref | **None — Q-001 OPEN** | DONE |
| 13 | สั่งสำเร็จ | `OrderConfirmed` | Success | `SuccessMark`, `Button` | go to tracking | — | order | Mock repo | DONE |

### Payment sub-states (design group `การชำระเงิน`)

These mirror the Payment State Machine. **No payment provider is integrated
(Q-001 `OPEN`, DEC-015)** — each is a UI state driven by mock state only.

| # | Screen | Route | Payment state | Status |
|---|---|---|---|---|
| 12b | กำลังตรวจสอบ | `PayChecking` | `PROCESSING` | DONE |
| 12c | ชำระสำเร็จ | `PaySuccess` | `SUCCESS` | DONE |
| 12d | ยืนยันไม่ได้ | `PayFailed` | `FAILED` | DONE |
| 12e | QR หมดอายุ | `PayExpired` | `EXPIRED` | DONE |
| 12f | จ่ายซ้ำ / จ่ายแล้ว | `PayDuplicate` | idempotency (REQ-003) | DONE |
| 12g | รายละเอียดการจ่าย | `PayDetail` | transaction detail | DONE |
| 12h | การคืนเงิน | `Refund` | `REFUND_*` | DONE |

### Post-order

| # | Screen | Route | Purpose | Status |
|---|---|---|---|---|
| 14 | ติดตามออเดอร์ | `OrderTracking` | Status timeline | DONE |
| 15 | ให้คะแนน | `Rating` | Rate order | DONE |

### State variants (design group `States`)

| State | Applies to | Route/param | Status |
|---|---|---|---|
| ⏳ กำลังโหลด | Home | `Home` (loading) | DONE |
| 📡 เน็ตมีปัญหา | Home | `Home` (error) | DONE |
| 🌙 ร้านปิด | Shop | `Shop` (closed) | DONE |
| 🧺 ตะกร้าว่าง | Cart | `Cart` (empty) | DONE |
| 🛵 ไม่มีไรเดอร์ | Tracking | `OrderTracking` (`NO_DRIVER`) | DONE |
| 🚫 ออเดอร์ถูกยกเลิก | Tracking | `OrderTracking` (`CANCELLED`) | DONE |

---

## Navigation (as the design actually behaves)

The design's `showTabs` array is `['home','orders','notif','profile', …]` and
its tab bar is `[หน้าแรก 🏠, ออเดอร์ 🧾, แจ้งเตือน 🔔, บัญชี 👤]`. So the tab
bar has **4 tabs**, not the 7-item structure sketched in the brief — the brief
explicitly defers to the design artifact, so 4 tabs it is.

```
RootNavigator
├── AuthStack        (unauthenticated)
│   ├── Splash → Onboarding → Login → Otp
└── CustomerStack    (authenticated)
    ├── Tabs
    │   ├── Home · Orders · Notifications · Profile
    └── modal/pushed screens
        ├── Search, Shop, ItemOptions, Cart, Checkout, Address
        ├── PromptPayQr, PayChecking, PaySuccess, PayFailed,
        │   PayExpired, PayDuplicate, PayDetail, Refund
        └── OrderConfirmed, OrderTracking, Rating
```

---

## `DESIGN_QUESTION` items

Recorded rather than guessed, per the brief.

**DQ-01 — Cash payment path after checkout.** The design has `isCash` and a CTA
`ยืนยันสั่ง ฿N (เงินสด)`, but no cash-specific confirmation screen; PromptPay
goes to `12 QR`. Implemented as: cash → `13 สั่งสำเร็จ` directly. Needs
confirmation.

**DQ-02 — `12f จ่ายซ้ำ / จ่ายแล้ว` trigger.** The screen exists but the design
does not show what navigates to it. Implemented as reachable from `PayChecking`
only, as a demonstrable state. Real trigger depends on webhook idempotency
(REQ-003) and is backend behaviour.

**DQ-03 — Refund entry point.** `12h การคืนเงิน` has no inbound navigation in
the design. Reachable from `PayDetail`. Note this interacts with **Q-020** —
no provider supports native PromptPay refunds, so the real flow is undecided.

**DQ-04 — Address editing.** `11 ที่อยู่จัดส่ง` shows selectable addresses but
no add/edit form. Implemented as selection only.

**DQ-05 — Search scope.** `06 ค้นหา` returns both shops and menu items in one
list. Ranking/ordering rules are not specified; implemented as shops first,
then menu items, in mock order.

---

## Explicitly NOT implemented (per brief §7)

Payment integration, order creation, restaurant backend, driver dispatch,
settlement, promotion engine, real-time delivery. All data outside
authentication and `profiles` comes from `apps/customer/src/mocks/`.
