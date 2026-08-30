import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driverColors, driverFontSize, fontFamily, radius, spacing } from '@banhao/ui';

/**
 * T2.1 — bottom-anchored toast (Driver App Redesign §D / R-05d). Replaces
 * the inline red error text a scrolled rider never sees. One at a time: a
 * caller holding a single `message` string already gets that for free — a
 * second message simply replaces the first.
 *
 * Consumes `actionError` unchanged — no new error shape.
 */
export interface ToastProps {
  message: string | null;
  /** Called ~4s after `message` becomes non-null, per the design's hold time. */
  onHide?: () => void;
  testID?: string;
}

const HOLD_MS = 4000;

export function Toast({ message, onHide, testID = 'toast' }: ToastProps) {
  useEffect(() => {
    if (!message || !onHide) return undefined;
    const timer = setTimeout(onHide, HOLD_MS);
    return () => clearTimeout(timer);
  }, [message, onHide]);

  if (!message) return null;

  return (
    <View style={styles.toast} testID={testID}>
      <View style={styles.dot} />
      <Text style={styles.message} testID={`${testID}-message`}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: driverColors.surface.inverse,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: driverColors.state.danger },
  message: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: driverFontSize.body,
    color: driverColors.onPrimary.text,
  },
});
