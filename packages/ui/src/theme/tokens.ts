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

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * IBM Plex Sans Thai is the design's typeface. The font files are not vendored
 * yet — see docs/CUSTOMER_APP_ASSETS.md. Until then React Native falls back to
 * the platform default, which is a known visual difference, not an oversight.
 */
export const fontFamily = {
  sans: 'IBMPlexSansThai',
  mono: 'IBMPlexMono',
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

export const theme = {
  colors,
  spacing,
  radius,
  fontSize,
  fontWeight,
  fontFamily,
  shadows,
  sizes,
} as const;

export type Theme = typeof theme;
