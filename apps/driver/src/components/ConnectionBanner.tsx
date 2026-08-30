import { StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, spacing } from '@banhao/ui';

/**
 * T2.1 — full-width strip for a read that has failed and not yet recovered
 * (Driver App Redesign §D / R-05e). "Silence must never look like calm":
 * rendered from the existing error view state, no connectivity library
 * added.
 */
export interface ConnectionBannerProps {
  visible: boolean;
  message?: string;
  testID?: string;
}

const DEFAULT_MESSAGE = 'เชื่อมต่อไม่ได้ — ข้อมูลอาจไม่เป็นปัจจุบัน';

export function ConnectionBanner({
  visible,
  message = DEFAULT_MESSAGE,
  testID = 'connection-banner',
}: ConnectionBannerProps) {
  if (!visible) return null;

  return (
    <View style={styles.banner} testID={testID}>
      <View style={styles.dot} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: driverColors.state.dangerSurface,
    borderBottomWidth: 1,
    borderBottomColor: driverColors.border.danger,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: driverColors.state.danger },
  message: {
    flex: 1,
    fontFamily: fontFamily.semibold,
    fontSize: driverFontSize.supporting,
    color: driverColors.state.dangerText,
  },
});
