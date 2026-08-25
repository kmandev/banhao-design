import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, spacing } from '@banhao/ui';

/**
 * Shown while the persisted Supabase session is read, and while fonts load.
 *
 * `RootNavigator` swaps it out as soon as auth resolves, so it has no
 * navigation of its own.
 */
export function SplashScreen() {
  return (
    <View style={styles.container} testID="screen-splash">
      <View style={styles.mark}>
        <Text style={styles.markGlyph}>🛵</Text>
      </View>
      <Text style={styles.brand}>BANHAO</Text>
      <Text style={styles.subtitle}>บ้านเฮา · ไรเดอร์</Text>
      <ActivityIndicator style={styles.spinner} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  markGlyph: { fontFamily: fontFamily.regular, fontSize: 34 },
  brand: {
    fontSize: fontSize.h1,
    fontFamily: fontFamily.bold,
    letterSpacing: 4,
    color: colors.textPrimary,
  },
  subtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  spinner: { marginTop: spacing.xl },
});
