/**
 * Design tokens extracted from the BANHAO Design System canvas
 * (design/design-system/BANHAO Design System.dc.html), which remains the
 * source of truth. Update these only when the canvas changes.
 *
 * Kept framework-agnostic (plain values) so React Native and Next.js can both
 * consume them without pulling in a styling library.
 */

export const colors = {
  /** Primary brand orange. */
  primary: '#E4572E',
  primaryHover: '#C2431F',

  /** Light surface, used across customer/merchant screens. */
  surface: '#FBF7F1',
  /** Dark surface, used by the design canvas shell. */
  surfaceDark: '#211B16',

  textPrimary: '#1F1A16',
  textMuted: '#7A6E64',
  textInverse: '#F5EFE7',

  success: '#0F8B5F',
  warning: '#8A6A14',
  danger: '#D93A3A',
  info: '#2E6FB7',
} as const;

/** Spacing scale, base 4 — per the design system's "Spacing · ฐาน 4" section. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 11,
  lg: 15,
  pill: 999,
} as const;

export const fonts = {
  /** Thai-first typeface used across all BANHAO surfaces. */
  sans: "'IBM Plex Sans Thai', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

export type Colors = typeof colors;
export type Spacing = typeof spacing;
