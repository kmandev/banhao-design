import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';

/**
 * T2.1 — the component library's replacement for `StatusStrip` (Driver App
 * Redesign §D). `StatusStrip` is deleted as of T2.2, which migrated its two
 * callers (`HomeScreen`'s availability panel, `StatusScreen`) onto this.
 *
 * DEC-UX-006 stays a structural property rather than a conditional prop:
 * `action` is only ever rendered for `online` / `offline`. A `pending` or
 * `blocked` card renders no action slot at all, regardless of what a caller
 * passes, so a non-approved rider can never end up with a control in the
 * tree.
 */

export type StateCardVariant = 'online' | 'offline' | 'pending' | 'blocked';

const CAN_HOST_ACTION: Record<StateCardVariant, boolean> = {
  online: true,
  offline: true,
  pending: false,
  blocked: false,
};

/**
 * T2.2 — the status dot Home's frames draw beside the headline
 * (Redesign §C2, R-03a/b). Only `online`/`offline` carry one: `pending` and
 * `blocked` use an icon-in-circle in the design instead, which StateCard
 * does not model — the dot is the simpler, already-tokenised piece of that
 * treatment, so only it is added here.
 */
const DOT_COLOR: Partial<Record<StateCardVariant, string>> = {
  online: driverColors.state.online,
  offline: driverColors.text.faint,
};

export interface StateCardProps {
  variant: StateCardVariant;
  headline: string;
  detail: string;
  /** Optional mono metadata line, e.g. a recorded-position timestamp. */
  meta?: string;
  /** Rendered only for `online` / `offline` — see the DEC-UX-006 note above. */
  action?: ReactNode;
  /** Dims the card while an action from the caller is in flight. */
  busy?: boolean;
  testID?: string;
}

export function StateCard({
  variant,
  headline,
  detail,
  meta,
  action,
  busy = false,
  testID = 'state-card',
}: StateCardProps) {
  const dotColor = DOT_COLOR[variant];

  return (
    <View style={[styles.card, styles[variant], busy && styles.busy]} testID={testID}>
      <View style={styles.headlineRow}>
        {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} testID={`${testID}-dot`} /> : null}
        <Text style={[styles.headline, styles[`${variant}Text` as const]]} testID={`${testID}-headline`}>
          {headline}
        </Text>
      </View>
      <Text style={[styles.detail, styles[`${variant}Body` as const]]} testID={`${testID}-detail`}>
        {detail}
      </Text>
      {meta ? (
        <Text style={styles.meta} testID={`${testID}-meta`}>
          {meta}
        </Text>
      ) : null}
      {CAN_HOST_ACTION[variant] && action ? (
        <View testID={`${testID}-action`}>{action}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.xxl,
    borderWidth: 1,
  },
  busy: { opacity: 0.75 },

  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 14, height: 14, borderRadius: 7 },

  online: { backgroundColor: driverColors.state.onlineSurface, borderColor: driverColors.state.online },
  offline: { backgroundColor: driverColors.surface.card, borderColor: driverColors.border.strong },
  pending: { backgroundColor: driverColors.state.pendingSurface, borderColor: driverColors.border.pending },
  blocked: { backgroundColor: driverColors.state.blockedSurface, borderColor: driverColors.border.neutral },

  headline: { fontFamily: fontFamily.bold, fontSize: driverFontSize.stateHeadline },
  onlineText: { color: driverColors.onSuccess.text },
  offlineText: { color: driverColors.text.primary },
  pendingText: { color: driverColors.text.primary },
  blockedText: { color: driverColors.text.secondary },

  detail: { fontFamily: fontFamily.regular, fontSize: driverFontSize.body },
  onlineBody: { color: driverColors.onSuccess.body },
  offlineBody: { color: driverColors.text.secondary },
  pendingBody: { color: driverColors.text.secondary },
  blockedBody: { color: driverColors.text.meta },

  meta: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.supporting,
    color: driverColors.text.meta,
  },
});
