import { StyleSheet, Text, View } from 'react-native';
import { Button, driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';

/**
 * T2.1 — icon, headline, one line of guidance, optional mono server message,
 * one primary retry (Driver App Redesign §D / R-03e, R-05e). Replaces four
 * ad-hoc centred views.
 */
export interface ErrorStateProps {
  icon?: string;
  headline: string;
  detail?: string;
  /** The raw server/error message, rendered in mono — never paraphrased. */
  serverMessage?: string;
  onRetry: () => void;
  retryLabel?: string;
  testID?: string;
  /**
   * Overrides the retry button's testID (default `${testID}-retry`) — for
   * screens migrating an existing retry control onto `ErrorState` that must
   * keep its pre-existing testID verbatim (T2.2).
   */
  retryTestID?: string;
}

export function ErrorState({
  icon = '⚠️',
  headline,
  detail,
  serverMessage,
  onRetry,
  retryLabel = 'ลองอีกครั้ง',
  testID = 'error-state',
  retryTestID,
}: ErrorStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.iconTile}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.headline}>{headline}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {serverMessage ? (
        <Text style={styles.serverMessage} testID={`${testID}-server-message`}>
          {serverMessage}
        </Text>
      ) : null}
      <Button label={retryLabel} size="lg" onPress={onRetry} testID={retryTestID ?? `${testID}-retry`} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  iconTile: {
    width: 64,
    height: 64,
    borderRadius: radius.xxl,
    backgroundColor: driverColors.state.dangerSurface,
    borderWidth: 1,
    borderColor: driverColors.border.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontFamily: fontFamily.regular, fontSize: 28 },
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
  serverMessage: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.supporting,
    color: driverColors.text.faint,
    backgroundColor: driverColors.surface.inset,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
});
