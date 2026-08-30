/**
 * BANHAO design tokens.
 *
 * Every value is measured from the design artifacts, which remain the source of
 * truth — see docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md for the extraction table:
 *   design/customer/BANHAO Customer App.dc.html
 *   design/design-system/BANHAO Design System.dc.html
 *
 * Do not invent values here. If a screen needs a colour or size that isn't in
 * this file, check the design first.
 */

export const colors = {
  /** Brand orange — CTAs, active nav, brand mark. */
  primary: '#E4572E',
  /** Pressed/hover state for primary. */
  primaryPressed: '#C2431F',
  /** Tinted primary background, e.g. selected chips. */
  primarySoft: '#FDF3E6',

  textPrimary: '#1F1A16',
  /** The most-used colour in the design — secondary copy, meta rows. */
  textMuted: '#7A6E64',
  textSubtle: '#9A8C7E',
  textFaint: '#A2968A',
  textInverse: '#F5EFE7',

  /** App background. */
  surface: '#FBF7F1',
  /** Cards sit on white in the design. */
  surfaceRaised: '#FFFFFF',
  /** Inset areas: image placeholders, option rows. */
  surfaceSunken: '#EFE7DC',
  surfaceAlt: '#F3EDE4',
  surfaceAccent: '#F3E7D6',

  border: '#E9E0D5',
  borderStrong: '#E0D6C8',

  success: '#0F8B5F',
  successSoft: '#E7F4EE',
  warningSoft: '#FDF3E6',
  danger: '#D93A3A',

  /** Dark shell used by the design canvas chrome. */
  shellDark: '#211B16',
} as const;

/** Base-4 scale, per the Design System's "Spacing · ฐาน 4" section. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Radii present in the artifact; 16 is the most common (41 occurrences). */
export const radius = {
  sm: 9,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

/**
 * Type scale, in the sizes the design actually uses.
 * 13px is the most common (51 occurrences), so it is the body default.
 */
export const fontSize = {
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 16,
  xxl: 17,
  h3: 19,
  h2: 21,
  h1: 26,
} as const;

/**
 * IBM Plex Sans Thai — the design's typeface, bundled with the app.
 *
 * React Native does NOT synthesize weights from a single family: each weight is
 * registered under its own family name. Android in particular ignores
 * `fontWeight` when a custom `fontFamily` is set. So styles select a weight by
 * choosing a family here, not by setting `fontWeight`.
 *
 * Names match the exports of @expo-google-fonts/ibm-plex-sans-thai, whose TTF
 * files are bundled by Metro at build time — nothing is fetched at runtime.
 */
export const fontFamily = {
  regular: 'IBMPlexSansThai_400Regular',
  medium: 'IBMPlexSansThai_500Medium',
  semibold: 'IBMPlexSansThai_600SemiBold',
  bold: 'IBMPlexSansThai_700Bold',
} as const;

/**
 * Numeric weights, kept for reference against the design (which specifies
 * 400/500/600/700). Prefer `fontFamily` above in React Native styles — see the
 * note there.
 */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Shadows transcribed from the artifact's box-shadow declarations. */
export const shadows = {
  /** Bottom bars: `0 -6px 20px rgba(31,26,22,.06)` */
  bar: {
    shadowColor: '#1F1A16',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 8,
  },
  /** Raised sheets: `0 -8px 30px rgba(31,26,22,.16)` */
  sheet: {
    shadowColor: '#1F1A16',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.16,
    shadowRadius: 30,
    elevation: 16,
  },
  /** Floating elements: `0 4px 14px rgba(31,26,22,.2)` */
  raised: {
    shadowColor: '#1F1A16',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 6,
  },
} as const;

/** Minimum 44pt touch target — accessibility baseline (brief §18). */
export const sizes = {
  touchTarget: 44,
  inputHeight: 48,
  buttonHeight: 52,
  tabBarHeight: 60,
  avatarSm: 36,
  avatarMd: 48,
  avatarLg: 72,
} as const;

/**
 * Driver app semantic tokens — T2.1, `docs/design/BANHAO Driver App
 * Redesign.dc.html` §D. 33 semantic tokens in total: 17 map straight onto an
 * existing `colors` value (named in each comment below), 16 are new tints and
 * shades the redesign introduces. Strictly additive: `colors` above is
 * unchanged, and nothing here is used by the customer app.
 */
export const driverColors = {
  action: {
    primary: colors.primaryPressed, // existing — resting primary fill (5.07:1 on white, passes AA; colors.primary fails at 3.68:1)
    primaryPressed: '#8F3116', // new
  },
  brand: {
    accent: colors.primary, // existing
  },
  onPrimary: {
    text: colors.surfaceRaised, // existing
    muted: '#FBD9C9', // new
  },
  state: {
    online: colors.success, // existing
    onlineSurface: colors.successSoft, // existing
    pendingSurface: colors.warningSoft, // existing
    blockedSurface: colors.surfaceSunken, // existing
    danger: colors.danger, // existing
    dangerSurface: '#FBEAEA', // new
    dangerText: '#B23030', // new
  },
  onSuccess: {
    text: '#0A5C3F', // new
    body: '#25453A', // new
    meta: '#4A6B5C', // new
  },
  onDanger: {
    body: '#8F3A3A', // new
  },
  border: {
    default: colors.border, // existing
    strong: colors.borderStrong, // existing
    success: '#C8E3D6', // new
    pending: '#F0DFC4', // new
    neutral: '#C9BFB4', // new
    danger: '#F0C9C9', // new
  },
  text: {
    primary: colors.textPrimary, // existing
    secondary: '#4A4038', // new
    meta: colors.textMuted, // existing
    faint: colors.textSubtle, // existing
    inactive: '#8F7F70', // new
  },
  surface: {
    app: colors.surface, // existing
    card: colors.surfaceRaised, // existing
    inset: colors.surfaceAlt, // existing
    inverse: colors.shellDark, // existing
  },
  divider: {
    card: '#F0EAE1', // new
    hairline: '#F5F0E9', // new
  },
} as const;

/**
 * Driver app type scale — T2.1, same source as `driverColors` above. The
 * shared `fontSize` tops out at 13px body, tuned for a phone held still
 * indoors; the driver app steps every role up and never renders below
 * 12.5px, because it is read one-handed, outdoors, in a hurry.
 */
export const driverFontSize = {
  /** Privacy note, caption — floor. */
  caption: 12.5,
  /** Supporting copy, mono metadata. */
  supporting: 13.5,
  /** Body, secondary button label, list row. */
  body: 17,
  /** Primary button label. */
  primaryButtonLabel: 20,
  /** Card title, empty/error headline. */
  cardTitle: 21,
  /** State headline (e.g. กำลังรับงาน). */
  stateHeadline: 24,
  /** Screen title. */
  screenTitle: 26,
  /** Countdown — mono. */
  countdown: 30,
} as const;

export const theme = {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  fontFamily,
  shadows,
  sizes,
  driverColors,
  driverFontSize,
} as const;

export type Theme = typeof theme;
