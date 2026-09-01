import type { CSSProperties } from 'react';
import { colors, radius, spacing } from '@banhao/ui/theme';

/**
 * M-11 / M-12 style building blocks, on the same footing as `styles.ts`: the
 * shared `@banhao/ui` component tree is React Native and cannot render on the
 * DOM, so only its tokens are reusable. Nothing here introduces a colour,
 * radius or spacing step that is not already in `packages/ui/src/theme`.
 *
 * Every interactive target is at least 44px, and time inputs are 48px
 * (`sizes.inputHeight`) with 52px footer buttons (`sizes.buttonHeight`),
 * matching what both artifacts specify for a shop tablet.
 */

export const TOUCH_TARGET = 44;
export const INPUT_HEIGHT = 48;
export const BUTTON_HEIGHT = 52;

export const contentPage: CSSProperties = {
  width: '100%',
  maxWidth: 1360,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.lg,
};

export const sectionHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: spacing.sm,
  flexWrap: 'wrap',
  padding: `${spacing.sm}px 0`,
  borderBottom: `1px solid ${colors.border}`,
};

export const panel: CSSProperties = {
  backgroundColor: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: spacing.lg,
  boxSizing: 'border-box',
};

/**
 * The dish row. Wraps rather than truncating the layout at narrow widths — the
 * design's <768px rule turns rows into cards, and `flexWrap` plus a min-width
 * on the identity block is what produces that without a media query in a
 * styles module that cannot hold one.
 */
export const itemRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.md,
  flexWrap: 'wrap',
  padding: `${spacing.sm}px ${spacing.md}px`,
  borderBottom: `1px solid ${colors.border}`,
  minHeight: 64,
};

export const itemIdentity: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: '1 1 240px',
  minWidth: 0,
};

export const itemName: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: colors.textPrimary,
  // Thai vowel marks collide below 1.55.
  lineHeight: 1.55,
};

export const itemDescription: CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
  lineHeight: 1.6,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const price: CSSProperties = {
  fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 15,
  color: colors.textPrimary,
  whiteSpace: 'nowrap',
};

export const badge: CSSProperties = {
  fontSize: 12,
  padding: '2px 8px',
  borderRadius: radius.sm,
  backgroundColor: colors.surfaceAccent,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
};

export const iconButton: CSSProperties = {
  minWidth: TOUCH_TARGET,
  minHeight: TOUCH_TARGET,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surfaceRaised,
  color: colors.textMuted,
  cursor: 'pointer',
  fontSize: 14,
};

export const primaryButton: CSSProperties = {
  minHeight: BUTTON_HEIGHT,
  padding: `0 ${spacing.lg}px`,
  fontSize: 15,
  fontWeight: 600,
  borderRadius: radius.xl,
  border: 'none',
  backgroundColor: colors.primary,
  color: colors.textInverse,
  cursor: 'pointer',
};

export const secondaryButton: CSSProperties = {
  minHeight: BUTTON_HEIGHT,
  padding: `0 ${spacing.lg}px`,
  fontSize: 15,
  fontWeight: 500,
  borderRadius: radius.xl,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
  color: colors.textMuted,
  cursor: 'pointer',
};

export const dangerButton: CSSProperties = {
  ...primaryButton,
  backgroundColor: colors.danger,
};

export const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(31, 26, 22, 0.45)',
  zIndex: 40,
};

/** M-04's 520px right drawer, reused rather than a new overlay paradigm (M11-D04). */
export const drawer: CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(92vw, 520px)',
  backgroundColor: colors.surfaceRaised,
  borderLeft: `1px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  zIndex: 50,
  boxSizing: 'border-box',
};

export const drawerBody: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: spacing.lg,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.lg,
};

/** Sticky, so บันทึก is reachable without scrolling past the fields. */
export const drawerFooter: CSSProperties = {
  position: 'sticky',
  bottom: 0,
  display: 'flex',
  gap: spacing.sm,
  padding: spacing.lg,
  borderTop: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
};

export const dialog: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 'min(92vw, 480px)',
  maxHeight: '86vh',
  overflowY: 'auto',
  backgroundColor: colors.surfaceRaised,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.xl,
  padding: spacing.lg,
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.md,
  zIndex: 60,
  boxSizing: 'border-box',
};

export const fieldLabel: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.textPrimary,
  display: 'flex',
  gap: spacing.xs,
  alignItems: 'baseline',
};

export const textInput: CSSProperties = {
  minHeight: INPUT_HEIGHT,
  width: '100%',
  fontSize: 16,
  padding: `0 ${spacing.md}px`,
  borderRadius: radius.md,
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceRaised,
  color: colors.textPrimary,
  boxSizing: 'border-box',
};

export const fieldHint: CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  lineHeight: 1.6,
  margin: 0,
};

export const fieldError: CSSProperties = {
  fontSize: 12,
  color: colors.danger,
  lineHeight: 1.6,
  margin: 0,
};

/**
 * The availability switch. A real `<button role="switch">` — never a bare div
 * — sized 56×32 inside a 44px hit area (M-11 §11).
 */
export function switchTrack(on: boolean, pending: boolean): CSSProperties {
  return {
    width: 56,
    height: 32,
    borderRadius: 16,
    border: 'none',
    padding: 3,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: on ? 'flex-end' : 'flex-start',
    backgroundColor: on ? colors.success : colors.borderStrong,
    // Dims rather than disabling: the row stays interactive except the switch.
    opacity: pending ? 0.6 : 1,
    cursor: pending ? 'progress' : 'pointer',
  };
}

export const switchKnob: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  backgroundColor: colors.surfaceRaised,
};

export const switchHitArea: CSSProperties = {
  minHeight: TOUCH_TARGET,
  display: 'inline-flex',
  alignItems: 'center',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
};

/** Screen-reader-only, for live-region announcements. */
export const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};
