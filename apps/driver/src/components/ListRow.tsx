import { Pressable, StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, spacing } from '@banhao/ui';

/**
 * T2.1 — icon, title, subtitle, trailing badge or chevron (Driver App
 * Redesign §D). The offer entry on Home. 76px tall.
 */
export interface ListRowProps {
  icon?: string;
  title: string;
  subtitle?: string;
  /** Trailing content — a chevron glyph, or nothing. Ignored when `badge` is set. */
  trailing?: string;
  /**
   * A numeric count badge (T2.2 / DG-05), rendered in place of `trailing`
   * when present. Omit it — do not pass `0` — to fall back to `trailing`;
   * the zero-vs-omitted choice is the caller's, this component never treats
   * `0` specially.
   */
  badge?: number;
  onPress?: () => void;
  testID?: string;
}

const ROW_HEIGHT = 76;

export function ListRow({ icon, title, subtitle, trailing, badge, onPress, testID = 'list-row' }: ListRowProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      testID={testID}
    >
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <View style={styles.body}>
        <Text style={styles.title} testID={`${testID}-title`}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} testID={`${testID}-subtitle`}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {badge !== undefined ? (
        <View style={styles.badge} testID={`${testID}-badge`}>
          <Text style={styles.badgeLabel}>{badge}</Text>
        </View>
      ) : trailing ? (
        <Text style={styles.trailing} testID={`${testID}-trailing`}>
          {trailing}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  icon: { fontFamily: fontFamily.regular, fontSize: driverFontSize.cardTitle },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: fontFamily.semibold, fontSize: driverFontSize.body, color: driverColors.text.primary },
  subtitle: { fontFamily: fontFamily.regular, fontSize: driverFontSize.supporting, color: driverColors.text.meta },
  trailing: { fontFamily: fontFamily.regular, fontSize: driverFontSize.body, color: driverColors.text.faint },
  badge: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 9,
    backgroundColor: driverColors.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: { fontFamily: fontFamily.bold, fontSize: driverFontSize.supporting, color: driverColors.onPrimary.text },
});
