import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fontFamily, fontSize, radius, sizes, spacing } from '../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/**
 * Touch-target override — driver app (T2.1, Driver App Redesign §D
 * "Touch targets and spacing"): `lg` 60px the one primary action per screen,
 * `md` 56px secondary/destructive-adjacent, `sm` 52px low-emphasis. `sm`
 * equals the existing default height, so it exists for callers that want to
 * name the size explicitly rather than rely on the default.
 */
export type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE_HEIGHT: Record<ButtonSize, number> = {
  sm: sizes.buttonHeight,
  md: 56,
  lg: 60,
};

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /**
   * Touch-target height. Omitted by default so every existing caller keeps
   * today's height (`sizes.buttonHeight`, 52) exactly — see `ButtonSize`.
   */
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Rendered before the label, e.g. the emoji glyphs the design uses. */
  icon?: string;
  /** Right-aligned text, e.g. the price on the design's cart CTA. */
  trailing?: string;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Primary action control. Mirrors the pill CTAs in the Customer App design
 * (`border-radius:16px`, solid `#E4572E`, white 15–16px semibold label).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size,
  disabled = false,
  loading = false,
  icon,
  trailing,
  fullWidth = true,
  style,
  testID,
}: ButtonProps) {
  const isInactive = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={isInactive ? undefined : onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        fullWidth && styles.fullWidth,
        // Omitted entirely when `size` is unset, so the base minHeight from
        // `styles.base` (sizes.buttonHeight) is the only one ever applied —
        // today's default is untouched.
        size ? { minHeight: SIZE_HEIGHT[size] } : null,
        pressed && !isInactive && styles[`${variant}Pressed` as const],
        isInactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.textInverse : colors.primary} />
      ) : (
        <View style={styles.content}>
          {icon ? <Text style={styles.icon}>{icon}</Text> : null}
          <Text style={[styles.label, styles[`${variant}Label` as const]]}>{label}</Text>
          {trailing ? (
            <Text style={[styles.trailing, styles[`${variant}Label` as const]]}>{trailing}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: sizes.buttonHeight,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  fullWidth: { alignSelf: 'stretch' },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { fontFamily: fontFamily.regular, fontSize: fontSize.xl },
  label: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold },
  trailing: { fontSize: fontSize.lg, fontFamily: fontFamily.bold },

  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryLabel: { color: colors.textInverse },

  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryPressed: { backgroundColor: colors.surfaceAlt },
  secondaryLabel: { color: colors.textPrimary },

  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: colors.surfaceAlt },
  ghostLabel: { color: colors.textMuted },

  // 0.5 keeps the label legible while clearly reading as inactive.
  disabled: { opacity: 0.5 },
});
