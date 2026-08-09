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

## Fonts — the one genuine gap

The design specifies **IBM Plex Sans Thai** (weights 400/500/600/700), loaded
from Google Fonts in the `.dc.html` canvases:

```html
family=IBM+Plex+Sans+Thai:wght@400;500;600;700
```

**The font files are not vendored, and the app does not load them.**
`packages/ui/src/theme/tokens.ts` declares the family name, but React Native
falls back to the platform Thai face at runtime.

Consequence: Thai text renders correctly and legibly, but not in the designed
typeface. Classified **MINOR** in `docs/CUSTOMER_APP_VISUAL_QA.md`.

To close it:

1. Add `expo-font` and vendor the four weights under `apps/customer/assets/fonts/`.
2. Load them at startup and keep the splash visible until they resolve.
3. Confirm `fontFamily.sans` in the token file matches the loaded family name.

Not done in this step because it changes app startup behaviour (font loading
gates first render) and the brief scoped this step to UI implementation.

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
