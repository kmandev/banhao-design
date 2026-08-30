import { StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';

/**
 * T2.1 — icon, headline, one line of guidance (Driver App Redesign §D /
 * R-05a). Replaces an ad-hoc centred view. Not an error state: no retry, no
 * mono server message.
 */
export interface EmptyStateProps {
  icon: string;
  headline: string;
  detail?: string;
  testID?: string;
}

export function EmptyState({ icon, headline, detail, testID = 'empty-state' }: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconTile}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.headline}>{headline}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  iconTile: {
    width: 72,
    height: 72,
    borderRadius: radius.xxl,
    backgroundColor: driverColors.surface.inset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontFamily: fontFamily.regular, fontSize: 30 },
  headline: {
    fontFamily: fontFamily.bold,
    fontSize: driverFontSize.cardTitle,
    color: driverColors.text.primary,
    textAlign: 'center',
  },
  detail: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.body,
    color: driverColors.text.meta,
    textAlign: 'center',
  },
});
