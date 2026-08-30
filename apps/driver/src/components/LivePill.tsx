import { StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';

/**
 * T2.1 — pulsing dot + "อัปเดตอยู่" (Driver App Redesign §D). Mounted only
 * while the caller's poll timer is alive, so it cannot outlive it — this
 * component owns no timer of its own, and no animation library is added
 * here; the dot renders static, which already satisfies
 * `AccessibilityInfo.isReduceMotionEnabled` without a separate branch.
 */
export interface LivePillProps {
  label?: string;
  testID?: string;
}

export function LivePill({ label = 'อัปเดตอยู่', testID = 'live-pill' }: LivePillProps) {
  return (
    <View style={styles.pill} testID={testID}>
      <View style={styles.dot} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: driverColors.state.onlineSurface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: driverColors.state.online },
  label: {
    fontFamily: fontFamily.semibold,
    fontSize: driverFontSize.supporting,
    color: driverColors.onSuccess.text,
  },
});
