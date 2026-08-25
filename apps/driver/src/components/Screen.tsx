import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '@banhao/ui';

/**
 * Screen shell: safe-area insets, keyboard avoidance, and the app background.
 *
 * Same shell as `apps/customer/src/components/Screen.tsx`. It is duplicated
 * rather than lifted into `@banhao/ui` because the two apps' shells have not
 * yet been shown to want the same thing — the rider shell will likely grow a
 * persistent status strip (DEC-UX-006) the customer shell must never have.
 * Lifting it on the first shared use would be the abstraction this slice is
 * meant to avoid; if a third app wants it unchanged, that is the moment.
 */
export function Screen({
  children,
  scroll = false,
  edges = ['top', 'bottom'],
  contentStyle,
  footer,
  testID,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: readonly Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  /** Sticky bottom bar, rendered outside the scroll area. */
  footer?: React.ReactNode;
  testID?: string;
}) {
  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={edges} testID={testID}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
});
