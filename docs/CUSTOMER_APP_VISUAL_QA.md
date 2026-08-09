# Customer App — Visual QA

Date: 2026-08-09 · Device: iPhone 16 Pro simulator (iOS, 402×874 pt) · Expo dev build

**This is a partial pass, and the limits are stated plainly below rather than
implied.** The app was genuinely built, launched, and driven on a simulator —
not only read as source — but not every screen could be reached visually.

## What was actually executed

```
Metro bundle:  iOS Bundled 6653ms apps/customer/index.ts (994 modules)
```

The app launches, renders, and navigates on a real simulator. Screens reached
and inspected by screenshot:

| # | Screen | Result | Notes |
|---|---|---|---|
| 01 | Splash | **MATCH** | Brand mark, `#E4572E` tile, centred layout, spinner. Shown while the session resolves, then replaced — verified in the navigation test too. |
| 02 | Onboarding | **MATCH** | Copy renders verbatim from the design: "สั่งอาหารในบุณฑริก ง่ายกว่าที่เคย" and "ร้านในบุณฑริกให้เลือกเพียบ / ค่าส่งเริ่มต้น 10 บาท รู้ราคาก่อนสั่งเสมอ". Safe-area top and home-indicator bottom both respected. CTA pinned to the bottom. |
| 03 | เข้าสู่ระบบ | **MATCH** | `+66` prefix renders inside the field; CTA correctly **disabled** until a valid Thai number is entered (validated by the shared `thaiPhoneSchema`); dev-mode notice shows because Supabase is unconfigured. |

Screenshot artifact: [`docs/qa/customer-app/03-login.png`](qa/customer-app/03-login.png)

## What could NOT be visually verified, and why

**Screens 04–18 and the payment sub-states were not reached on the simulator.**

Two blockers, both honest:

1. **No Supabase project is configured.** `RootNavigator` branches on session
   state, so the authenticated tree (Home, Search, Shop, Cart, Checkout,
   payment, tracking, Orders, Notifications, Profile) is unreachable without a
   real sign-in. Faking a session would have meant adding non-production code
   purely to make QA look complete, which is worse than reporting the gap.
2. **Simulator text entry did not register** on the phone field, so even the
   OTP screen (04) could not be reached by driving the UI. The field and its
   validation are exercised by tests instead.

These screens are covered by **28 automated smoke tests** that mount each one
and assert its root testID renders, including every state variant. That is
weaker evidence than a screenshot for *visual* fidelity — spacing, colour, and
typography on those screens remain **unverified against the design artifact**.

## Difference classification

Per brief §26. `MAJOR` and `BLOCKER` must be fixed before this step closes.

| Difference | Class | Status |
|---|---|---|
| IBM Plex Sans Thai not applied — the design specifies it, but no font files are vendored, so RN falls back to the system Thai face | **MINOR** | Open. Tracked in `docs/CUSTOMER_APP_ASSETS.md`. Thai text renders correctly and legibly; only the typeface differs. |
| Shop/product imagery uses emoji glyphs | **MATCH** | Not a difference — the design artifact itself uses emoji as image placeholders. |
| PromptPay QR is a labelled placeholder, not a scannable code | **MINOR (intentional)** | Generating a real QR requires a payment provider; Q-001 is `OPEN`. A fake scannable code would be worse than an obvious placeholder. |
| Tracking map is a labelled placeholder | **MINOR (intentional)** | Needs a maps provider; Q-018 (rural Buntharik coverage) is unverified. |
| Screens 04–18 not visually compared | **UNVERIFIED** | Not classifiable without a screenshot. See blockers above. |

**No MAJOR or BLOCKER differences were found among the screens that could be
inspected.** Nothing is claimed about the screens that could not be.

## Device and layout checks performed

- **Safe area** — top inset (Dynamic Island) and bottom home indicator both
  respected on every inspected screen, via the shared `Screen` component.
- **Bottom CTA** — pinned above the home indicator, not overlapping it.
- **Thai typography** — renders without clipping; multi-line Thai wraps
  correctly with the design's line heights.
- **Touch targets** — Button/Stepper/star controls are ≥44 pt (`sizes.touchTarget`).
- **Keyboard avoidance** — implemented via `KeyboardAvoidingView`, but **not
  visually confirmed**, since text entry did not register.

## To complete this pass

1. Configure a Supabase project (`EXPO_PUBLIC_SUPABASE_URL`,
   `EXPO_PUBLIC_SUPABASE_ANON_KEY`) and enable the Phone provider, then sign in
   and screenshot screens 04–18 and 12b–12h against the design canvas.
2. Vendor IBM Plex Sans Thai (see `docs/CUSTOMER_APP_ASSETS.md`) and re-check
   typography.
3. Re-run on a small device (e.g. iPhone SE) and on Android for layout
   differences — only iPhone 16 Pro was checked.
