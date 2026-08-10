# Customer App — Visual QA

Date: 2026-08-10 · Expo SDK 52 · Expo Go
Devices: **iPhone 16 Pro** (402×874 pt) and **iPhone SE 3rd gen** (375×667 pt)
Backend: **live `banhao-dev` Supabase project** (see
[`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md))

Everything below was executed — the app was built, launched, signed in with a
**real Supabase session**, and driven on a simulator. Screens that could not be
reached are labelled `UNVERIFIED`, not inferred from source. No fake session was
created at any point.

Artifacts in [`docs/qa/customer-app/`](qa/customer-app/).

---

## Authentication — now verified against a real backend

Sign-in used Supabase **Test OTP** (fixed phone/code pairs configured on the dev
project — no SMS provider, no custom OTP backend, no OTP stored by us). Every
request below is a real request to `banhao-dev`, confirmed both in the app and
in the request log.

| Case | Result | Evidence |
|---|---|---|
| Environment loaded | **PASS** | dev-mode notice absent on screen 03 |
| Request OTP (`signInWithOtp`) | **PASS** | `200 POST /auth/v1/otp`, navigates to 04 |
| **Wrong** OTP | **PASS** | server rejects; screen 04 shows red border + `Token has expired or is invalid` — [`04-otp-invalid-token.png`](qa/customer-app/04-otp-invalid-token.png) |
| Correct OTP (`verifyOtp`) | **PASS** | `200 POST /auth/v1/verify`; `RootNavigator` swaps to the customer tree |
| Profile read under RLS | **PASS** | `200 GET /rest/v1/profiles`; screen 18 shows the row's real `display_name` and `phone` |
| Update own `display_name` | **PASS** | `204 PATCH /rest/v1/profiles`, re-read reflects it — [`18-profile-name-updated.png`](qa/customer-app/18-profile-name-updated.png) |
| Session persists across a full app restart | **PASS** | terminated Expo Go and relaunched → app opens on screen 05, re-fetches the profile, no login screen — [`05-home-session-restored.png`](qa/customer-app/05-home-session-restored.png) |
| Logout | **PASS** | confirmation dialog → auth stack — [`18-after-logout.png`](qa/customer-app/18-after-logout.png) |
| Logout **persists** across restart | **PASS** | relaunch after logout returns to onboarding, not the tab tree |

RLS was additionally verified by execution against the same live project —
**14 / 14 checks passed** (`supabase/tests/live-rls-check.mjs`). Details in
[`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

## Screens verified by screenshot

| # | Screen | Result | Notes |
|---|---|---|---|
| 01 | Splash | **MATCH** | brand tile `#E4572E`, centred, spinner |
| 02 | Onboarding | **MATCH** | design copy verbatim, CTA above home indicator |
| 03 | เข้าสู่ระบบ | **MATCH** | `+66` prefix, CTA disabled until the number validates (16 Pro **and** SE) |
| 04 | ยืนยัน OTP | **MATCH** | 6-digit field, real server error state, resend countdown elapsing to an enabled "ขอรหัสใหม่" |
| 05 | หน้าแรก | **MATCH** | location line, search, category rail, shop cards with `ส่งฟรี` / `ขายดี` / `ปิดอยู่` badges |
| 06 | ค้นหา | **MATCH** (2 of 3 states) | empty prompt and "ไม่พบผลลัพธ์" verified; **results list UNVERIFIED** — see limitation below |
| 07 | หน้าร้าน | **MATCH** | hero, rating, distance/time/fee row, hours, address, section chips, menu rows, cart bar |
| 08 | เลือกตัวเลือกอาหาร | **MATCH** | required-group badge `ต้องเลือก`, selection state, `+฿10` deltas, note field, quantity stepper |
| 09 | ตะกร้า | **MATCH** | line options and note echoed; totals correct (see arithmetic check) |
| 10 | ยืนยันการสั่ง | **MATCH** | address card, item list, PromptPay / cash selection |
| 11 | ที่อยู่จัดส่ง | **MATCH** | two addresses, selected state |
| 12 | พร้อมเพย์ QR | **MATCH** | QR is a **labelled placeholder**, amount, 10-minute countdown |
| 12b | กำลังตรวจสอบ | **MATCH** | spinner + "ไม่ต้องปิดหน้านี้"; simulation controls explicitly prefixed `จำลอง:` |
| 12c | ชำระสำเร็จ | **MATCH** | |
| 12d | ยืนยันไม่ได้ | **MATCH** | reassurance copy + "เปลี่ยนเป็นเงินสด" |
| 12f | จ่ายซ้ำ / จ่ายแล้ว | **MATCH** | idempotency message (REQ-003) |
| 12g | รายละเอียดการจ่าย | **MATCH** | payment id, order, amount, method, status, **masked** provider ref |
| 12h | การคืนเงิน | **MATCH** | three-step refund progress |
| 13 | สั่งสำเร็จ | **MATCH** | |
| 14 | ติดตามออเดอร์ | **MATCH** | map is a **labelled placeholder**; status timeline with done / current / pending |
| 15 | ให้คะแนน | **MATCH** | two star rows, comment box, CTA disabled until rated |
| 16 | ออเดอร์ของฉัน | **MATCH** | includes the **cancelled** variant (`ออเดอร์ถูกยกเลิก`) |
| 17 | แจ้งเตือน | **MATCH** | unread rows tinted with a dot; read row plain |
| 18 | บัญชีของฉัน | **MATCH** | real profile data, inline name editor, logout |

**Verified by screenshot: 29 of 31 states.**

### State variants

| Variant | Result |
|---|---|
| Shop closed | **MATCH** — `ปิดอยู่` badge on screen 05 |
| Cancelled order | **MATCH** — screen 16 |
| Search no-results | **MATCH** — screen 06 |
| Empty cart · loading · network error · no driver | **UNVERIFIED** — no trigger reachable from the UI in this pass |

## Screens NOT verified

| # | Screen | Why |
|---|---|---|
| 12e | QR หมดอายุ | **Unreachable — see DEF-01.** Registered in the navigator but nothing navigates to it. |
| 06 | Search **results** list | Simulator text entry cannot produce Thai characters, and `simctl pbcopy` / `pbsync` mangle Thai on paste. The mock catalogue is Thai-only, so no query can match. Not a defect in the app. |

## Defects found

| ID | Severity | Finding |
|---|---|---|
| **DEF-01** | **MAJOR** | **`PayExpired` (12e) is unreachable.** `PromptPayQrScreen` counts `QR_TTL_SECONDS` down to zero but never navigates anywhere; nothing else in the app navigates to `PayExpired` either. A documented payment state has no path to it. `apps/customer/src/screens/payment.tsx` |
| **DEF-02** | MINOR | **`ขอรหัสใหม่` does not resend the OTP.** On screen 04 it only resets the local countdown — no `signInWithOtp` call. A user whose code expired cannot get a new one without going back. `apps/customer/src/screens/auth/OtpScreen.tsx` |
| **DEF-03** | MINOR | **Untranslated back-button labels.** Screens pushed from the tab navigator show **"Tabs"**, and `Refund` shows **"Back"**. Every other back label is correct Thai. |
| **DEF-04** | MINOR | **`✓` renders as `√`.** `packages/ui/src/components/domain.tsx:142` uses U+2713, which IBM Plex Sans Thai does not contain; iOS substitutes a glyph that reads as a square-root sign. Affects the selected state on 08, 10 and 11. |
| **DEF-05** | MINOR | **Profile phone shows `66812345678`** — no `+`, unformatted. It is rendered straight from the Auth identity. |

None of these are BLOCKER. DEF-01 is MAJOR because a documented state cannot be
reached at all; the rest are cosmetic or recoverable.

## Money arithmetic — checked, not assumed

Screen 09 with three lines: `ราคาอาหาร ฿170` + `ค่าส่ง ฿15` + `ค่าบริการ ฿5`
− `ส่วนลด BANHAO7 ฿10` = **`รวมทั้งหมด ฿180`**. Correct, and the same ฿180 is
carried through 10 → 12 → 12g without drift. Integer satang throughout.

## Difference classification

| Difference | Class | Status |
|---|---|---|
| Thai tone-mark stacking | **MATCH** | Verified three ways previously. Not a defect. Do not re-raise. |
| IBM Plex Sans Thai applied | **MATCH** | Bundled, loaded at startup, all four weights |
| Emoji used for shop/product imagery | **MATCH** | The design artifact itself uses emoji placeholders |
| PromptPay QR is a labelled placeholder | **MINOR (intentional)** | Needs a provider; Q-001 `OPEN`. A scannable code that could take real money would be actively dangerous |
| Tracking map is a labelled placeholder | **MINOR (intentional)** | Needs a maps provider; Q-018 unverified |
| Payment simulation buttons on 12b | **MINOR (intentional)** | Prefixed `จำลอง:`; CON-002 means only a verified webhook may confirm a payment, so these can never become real client-side |
| App icon / splash image not configured | **MINOR** | Expo defaults; needs brand assets that don't exist |
| DEF-01 … DEF-05 | see table above | |

**BLOCKER: none. MAJOR: one (DEF-01).**

## Device checks

| Device | Result | Notes |
|---|---|---|
| iPhone 16 Pro (402×874) | **PASS** | Dynamic Island inset and home indicator respected; bottom CTA never overlaps content |
| iPhone SE 3rd gen (375×667) | **PASS** | Login renders without clipping at the smallest current iPhone width (previous pass) |
| Android | **UNVERIFIED** | No Android SDK or emulator on this machine. ⚠️ Android is the platform most likely to differ: it ignores `fontWeight` with a custom `fontFamily`, which is why weights are selected by family name — that mapping has never run there. |

Keyboard avoidance is implemented via `KeyboardAvoidingView` and is still **not
visually confirmed** — the simulator software keyboard was not raised during
this pass.

## Environment note

The Simulator cannot hold an HTTP/3 connection to Supabase; all of the above was
performed through `scripts/sim-supabase-proxy.mjs`, which forwards verbatim to
the real project over HTTPS and serves the Simulator plain HTTP. Sessions were
issued by real GoTrue and RLS was enforced by the real database — the proxy
substitutes nothing. Full diagnosis in
[`SUPABASE_DEVELOPMENT.md`](SUPABASE_DEVELOPMENT.md).

## To finish this pass

1. Fix DEF-01 so 12e is reachable, then screenshot it.
2. Run on an Android emulator — verify per-weight font families resolve.
3. Confirm keyboard avoidance where text entry raises the keyboard.
4. Reach the remaining state variants (empty cart, loading, network error, no
   driver) once they have real triggers rather than mock data.
