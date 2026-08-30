import type { CSSProperties } from 'react';
import { colors, radius, spacing } from '@banhao/ui/theme';

/**
 * Shared inline style building blocks for the Merchant web foundation.
 *
 * `@banhao/ui`'s component tree (Button, Input, ...) is React Native and
 * cannot render on the DOM — only its theme tokens (`@banhao/ui/theme`) are
 * plain color/number constants and are reusable here. This is foundation UI,
 * not final visual design (per the M-1 brief); a real component library for
 * the web apps is out of scope for this phase.
 *
 * Font is deliberately system-ui, matching apps/admin/src/app/layout.tsx —
 * IBM Plex Sans Thai is currently bundled only for Expo (via
 * @expo-google-fonts/ibm-plex-sans-thai); adding a web font loader is a
 * separate, explicit decision, not a byproduct of this phase.
 */

export const page: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.surface,
  padding: spacing.xl,
  boxSizing: 'border-box',
};

export const card: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.lg,
  backgroundColor: colors.surfaceRaised,
  borderRadius: radius.xl,
  border: `1px solid ${colors.border}`,
  padding: spacing.xl,
  boxSizing: 'border-box',
};

export const title: CSSProperties = {
  color: colors.textPrimary,
  fontSize: 22,
  fontWeight: 700,
  margin: 0,
};

export const subtitle: CSSProperties = {
  color: colors.textMuted,
  fontSize: 14,
  margin: 0,
};

export const label: CSSProperties = {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: 600,
};

export const input: CSSProperties = {
  minHeight: 48,
  fontSize: 16,
  padding: `0 ${spacing.md}px`,
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
  color: colors.textPrimary,
  boxSizing: 'border-box',
  width: '100%',
};

export function button(disabled: boolean): CSSProperties {
  return {
    minHeight: 52,
    fontSize: 16,
    fontWeight: 600,
    borderRadius: radius.xl,
    border: 'none',
    backgroundColor: disabled ? colors.borderStrong : colors.primary,
    color: colors.textInverse,
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
  };
}

export const ghostButton: CSSProperties = {
  minHeight: 44,
  fontSize: 14,
  fontWeight: 500,
  borderRadius: radius.xl,
  border: 'none',
  backgroundColor: 'transparent',
  color: colors.textMuted,
  cursor: 'pointer',
  width: '100%',
};

export const errorText: CSSProperties = {
  color: colors.danger,
  fontSize: 13,
  margin: 0,
};

export const restaurantOption: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.xs,
  padding: spacing.lg,
  borderRadius: radius.lg,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%',
};
