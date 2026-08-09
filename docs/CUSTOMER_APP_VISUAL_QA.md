# Customer App — Visual QA

Date: 2026-08-10 · Expo SDK 52 dev build
Devices: **iPhone 16 Pro** (402×874 pt) and **iPhone SE 3rd gen** (375×667 pt)

Everything below was executed — the app was built, launched, and driven on
simulators. Screens that could not be reached are labelled `UNVERIFIED`, not
inferred from source.

## Typography — now PASS

**IBM Plex Sans Thai is bundled and applied.** Weights 400/500/600/700 ship as
TTF assets inside `@expo-google-fonts/ibm-plex-sans-thai` and are packaged by
Metro at build time. Nothing is fetched from Google at runtime. Rendering is
held on the splash screen until fonts resolve, so no frame paints in the
fallback face.

Bundle grew 994 → **1012 modules** after adding the font assets.

### A false alarm worth recording

At moderate zoom the heading "สั่งอาหารในบุณฑริก" appeared to be missing its
ไม้เอก, reading as "สัง". At full magnification the mark is present — the
ไม้เอก sits directly above the ไม้หันอากาศ and the two merge visually when
downscaled.

Confirmed three ways before concluding:

1. Maximum-magnification crop of the running app —
   [`typography-thai-marks-zoom.png`](qa/customer-app/typography-thai-marks-zoom.png)
   shows both stacked marks.
2. The **exact bundled TTF files** rendered in a browser at all four weights —
   "สั่ง", "ที่", "ง่าย", "เข้าสู่" all correct at 400/500/600/700.
3. Body copy at weight 400 in the app ("รู้ราคาก่อนสั่งเสมอ") renders the same
   combination correctly.

**No mark-positioning defect exists.** Recorded because the initial reading was
wrong, and a false `MAJOR` would have been worse than the real finding.

## Screens verified by screenshot

| # | Screen | Device | Result |
|---|---|---|---|
| 01 | Splash | 16 Pro | **MATCH** — brand tile `#E4572E`, centred, spinner |
| 02 | Onboarding | 16 Pro | **MATCH** — design copy verbatim, safe areas respected, CTA pinned above home indicator |
| 03 | เข้าสู่ระบบ | 16 Pro **and SE** | **MATCH** — `+66` prefix, CTA correctly disabled until the number validates, dev-mode notice |
| 04 | ยืนยัน OTP | 16 Pro | **MATCH** — 6-digit field, error state (red border + red alert text), resend countdown elapsing to an enabled "ขอรหัสใหม่" |

Artifacts in [`docs/qa/customer-app/`](qa/customer-app/).

## Screens NOT verified — `UNVERIFIED`

**05, 06, 07, 08, 09, 10, 11, 12, 12b, 12c, 12d, 12e, 12f, 12g, 12h, 13, 14,
15, 16, 17, 18** — 22 screens, plus the 6 state variants behind them.

Reason: `RootNavigator` selects the customer tree from session state, and **no
Supabase project is configured**, so authentication cannot complete. Faking a
session would have produced screenshots that prove nothing about the real app
and would violate the instruction not to create a fake session.

They are covered by **29 automated smoke tests** that mount each screen and
assert its root renders, including every state variant. That is real evidence
of *not crashing*; it is **not** evidence of visual fidelity. Spacing, colour,
and typography on those screens remain unverified against the design artifact.

**Visual QA total: 4 / 31 verified.**

## Authentication QA — `NOT VERIFIED — Supabase environment not configured`

None of session persistence, logout, profile loading, invalid OTP, expired OTP,
or resend-OTP was tested against a real backend.

What *was* observed: the OTP screen's error path renders correctly when
verification fails, and the resend countdown completes and re-enables. Both are
UI behaviours, not backend verification.

## Difference classification

| Difference | Class | Status |
|---|---|---|
| Thai tone-mark stacking | **MATCH** | Verified three ways (above). Not a defect. |
| IBM Plex Sans Thai applied | **MATCH** | Bundled, loaded at startup, all four weights |
| Emoji used for shop/product imagery | **MATCH** | The design artifact itself uses emoji placeholders |
| PromptPay QR is a labelled placeholder | **MINOR (intentional)** | Needs a provider; Q-001 `OPEN`. A fake scannable code would be actively dangerous |
| Tracking map is a labelled placeholder | **MINOR (intentional)** | Needs a maps provider; Q-018 unverified |
| App icon / splash image not configured | **MINOR** | Expo defaults; needs brand assets that don't exist |
| 22 screens + 6 variants not visually compared | **UNVERIFIED** | Not classifiable without screenshots |

**MAJOR: none. BLOCKER: none** — among what could be inspected. Nothing is
claimed about the 22 unverified screens.

## Device checks

| Device | Result | Notes |
|---|---|---|
| iPhone 16 Pro (402×874) | **PASS** | Dynamic Island inset and home indicator respected; bottom CTA never overlaps |
| iPhone SE 3rd gen (375×667) | **PASS** | Login renders without clipping or overflow at the smallest current iPhone width; Thai wraps correctly |
| Android | **UNVERIFIED** | No Android SDK or emulator on this machine. ⚠️ Android is the platform most likely to differ: it ignores `fontWeight` with a custom `fontFamily`, which is why weights are selected by family name — but that mapping is untested there. |

Keyboard avoidance is implemented via `KeyboardAvoidingView` but **not visually
confirmed** — simulator text entry did not register on the phone field.

## To finish this pass

1. Configure a Supabase project (`EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`), enable the Phone provider, sign in, then
   screenshot the 22 remaining screens against the design canvas.
2. Run on an Android emulator — verify per-weight font families resolve.
3. Confirm keyboard avoidance on a device where text entry works.
