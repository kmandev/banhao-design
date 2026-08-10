# Customer App — Assets

What the Customer App needs, what exists, and what is deliberately a
placeholder. Per brief §20–21: real assets are used where they exist, and every
placeholder is documented rather than quietly shipped.

## Audit of `design/`

| Asset type | Present in repo? | Used by the app? |
|---|---|---|
| Shop / product photography | **No** | The design artifact itself uses emoji glyphs (🥗 🍜 🍗 🌶️) where photos would go, so the app does the same. This is fidelity to the design, not a placeholder. |
| Brand logo files | **No** | The design renders the mark as a 🏠 emoji on a `#E4572E` rounded tile. Reproduced exactly. See `assets/brand/README.md` — no logo files exist yet. |
| Icon set | **No** | The design uses emoji as icons throughout (tab bar: 🏠 🧾 🔔 👤). No icon library was added, per brief §21 — introducing one would deviate from the design. |
| Illustrations | **No** | None in the design. |
| QA screenshots | **Yes** — `assets/screenshots/` | Annotated review captures of screens 07 and 08. Reference material, not app assets. |

**No real asset was replaced by a placeholder.** Every glyph the app renders is
the glyph the design specifies.

## Fonts — RESOLVED

The design specifies **IBM Plex Sans Thai** at weights 400/500/600/700. All
four are now **bundled with the app**.

| Item | Detail |
|---|---|
| Package | `@expo-google-fonts/ibm-plex-sans-thai@0.4.1` + `expo-font@~13.0.4` |
| Files | Real `.ttf` files ship inside the package and are packaged by Metro at build time |
| Runtime fetch | **None.** Nothing is requested from Google at runtime |
| Loading | `useFonts` in `App.tsx`; the splash screen is held until fonts resolve, so no frame paints in the fallback face |
| Failure behaviour | On font error the app still starts in the platform face rather than hanging on the splash — a wrong typeface beats an unusable app |

**Weights are selected by family name, not `fontWeight`.** React Native
registers each weight as its own family, and Android ignores `fontWeight` when
a custom `fontFamily` is set. `packages/ui/src/theme/tokens.ts` therefore
exposes:

```ts
fontFamily.regular  // IBMPlexSansThai_400Regular
fontFamily.medium   // IBMPlexSansThai_500Medium
fontFamily.semibold // IBMPlexSansThai_600SemiBold
fontFamily.bold     // IBMPlexSansThai_700Bold
```

Any new text style must set one of these. A style with `fontSize` but no
`fontFamily` silently falls back to the system face.

Verified on iPhone 16 Pro and iPhone SE — see `docs/CUSTOMER_APP_VISUAL_QA.md`,
including a recorded false alarm about Thai tone-mark stacking that turned out
to be a magnification artefact, not a defect.

## Intentional placeholders

Both are labelled in the UI so they can never be mistaken for working features.

| Placeholder | Screen | Why | Blocked by |
|---|---|---|---|
| PromptPay QR box | 12 พร้อมเพย์ QR | Generating a real QR needs a payment provider. Rendering a fake scannable code would be actively worse — someone could try to pay it. | **Q-001** (provider), **DEC-015** |
| Tracking map box | 14 ติดตามออเดอร์ | Needs a maps provider and real coordinates. `design/tracking/tracking-map.html` is a Leaflet prototype with mock coordinates. | **Q-018** (rural Buntharik coverage unverified) |

Both render a glyph plus Thai text stating they are examples and not yet
connected.

## App icon and splash image

Not configured. `apps/customer/app.json` has no `icon` or `splash` entry, so
Expo's defaults apply. Producing these needs brand assets that do not exist yet
(`assets/brand/`). Required before any real build; not required for this step.
