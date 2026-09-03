import type { CSSProperties } from 'react';
import { colors, radius, spacing } from '@banhao/ui/theme';

/**
 * Shared inline style building blocks for the Human Supervisor console.
 *
 * Same posture as `apps/merchant/src/lib/styles.ts`, and for the same reason:
 * `@banhao/ui`'s component tree is React Native and cannot render on the DOM,
 * so only its theme tokens are reused here. Font is system-ui, matching every
 * other web app in the repository — adding a web font loader is a separate,
 * explicit decision.
 *
 * Thai line-height is 1.6 throughout, per the Admin design package § 15: upper
 * and lower vowels collide below that, and this console is read by one tired
 * person late in the day.
 */

export const shell: CSSProperties = {
  minHeight: '100vh',
  backgroundColor: colors.surface,
  color: colors.textPrimary,
  lineHeight: 1.6,
  boxSizing: 'border-box',
};

export const centred: CSSProperties = {
  ...shell,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: spacing.xl,
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

export const panel: CSSProperties = {
  backgroundColor: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: spacing.lg,
  boxSizing: 'border-box',
};

export const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing.md,
  padding: `${spacing.md}px ${spacing.xl}px`,
  borderBottom: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
};

export const content: CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: spacing.xl,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.lg,
  boxSizing: 'border-box',
};

export const title: CSSProperties = { fontSize: 22, fontWeight: 700, margin: 0 };
export const sectionTitle: CSSProperties = { fontSize: 15, fontWeight: 700, margin: 0 };
export const subtitle: CSSProperties = { color: colors.textMuted, fontSize: 14, margin: 0 };
export const meta: CSSProperties = { color: colors.textSubtle, fontSize: 12, margin: 0 };
export const label: CSSProperties = { fontSize: 13, fontWeight: 600 };

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

export const th: CSSProperties = {
  textAlign: 'left',
  color: colors.textMuted,
  fontSize: 12,
  fontWeight: 600,
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderBottom: `1px solid ${colors.border}`,
  whiteSpace: 'nowrap',
};

export const td: CSSProperties = {
  padding: `${spacing.md}px`,
  borderBottom: `1px solid ${colors.border}`,
  verticalAlign: 'top',
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

export const textarea: CSSProperties = {
  ...input,
  minHeight: 96,
  padding: spacing.md,
  lineHeight: 1.6,
  fontFamily: 'inherit',
};

export function button(disabled: boolean): CSSProperties {
  return {
    minHeight: 48,
    fontSize: 15,
    fontWeight: 600,
    padding: `0 ${spacing.lg}px`,
    borderRadius: radius.xl,
    border: 'none',
    backgroundColor: disabled ? colors.borderStrong : colors.primary,
    color: colors.textInverse,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export const ghostButton: CSSProperties = {
  minHeight: 40,
  fontSize: 14,
  fontWeight: 500,
  padding: `0 ${spacing.md}px`,
  borderRadius: radius.xl,
  border: `1px solid ${colors.border}`,
  backgroundColor: 'transparent',
  color: colors.textMuted,
  cursor: 'pointer',
};

export const errorText: CSSProperties = { color: colors.danger, fontSize: 13, margin: 0 };

/**
 * A state chip. Status is carried by the label as well as the colour — the
 * Admin design package § 15 requires that no state is conveyed by colour alone.
 */
export function chip(tone: 'open' | 'resolved' | 'blocked'): CSSProperties {
  const palette = {
    open: { bg: colors.warningSoft, fg: colors.textPrimary },
    resolved: { bg: colors.successSoft, fg: colors.success },
    blocked: { bg: colors.surfaceSunken, fg: colors.textMuted },
  }[tone];

  return {
    display: 'inline-block',
    padding: `2px ${spacing.sm}px`,
    borderRadius: radius.sm,
    backgroundColor: palette.bg,
    color: palette.fg,
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
}

export const evidenceBlock: CSSProperties = {
  margin: 0,
  padding: spacing.md,
  backgroundColor: colors.surfaceAlt,
  borderRadius: radius.md,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  overflowX: 'auto',
  lineHeight: 1.5,
};
