import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fontFamily, fontSize, radius, shadows, sizes, spacing } from '../theme/tokens';

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  onPress,
  style,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;

  if (!onPress) return content;

  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button">
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.cardPressed, style]}>{children}</View>
      )}
    </Pressable>
  );
}

/* ----------------------------------------------------------------- Badge */

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'primary';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}` as const]]}>
      <Text style={[styles.badgeText, styles[`badgeText_${tone}` as const]]}>{label}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({ glyph, size = sizes.avatarMd }: { glyph: string; size?: number }) {
  return (
    <View
      accessible={false}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 3 }]}
    >
      <Text style={{ fontFamily: fontFamily.regular, fontSize: size * 0.5 }}>{glyph}</Text>
    </View>
  );
}

/* ----------------------------------------------------------------- Input */

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Leading text such as the +66 dial prefix on the login screen. */
  prefix?: string;
}

export function Input({ label, error, prefix, style, ...rest }: InputProps) {
  return (
    <View style={styles.inputBlock}>
      {label ? <Text style={styles.inputLabel}>{label}</Text> : null}
      <View style={[styles.inputWrap, !!error && styles.inputWrapError]}>
        {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={label}
          {...rest}
        />
      </View>
      {error ? (
        <Text style={styles.inputError} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- Stepper */

/** Quantity control used on the item-options and cart screens. */
export function Stepper({
  value,
  onIncrease,
  onDecrease,
  min = 1,
  testID,
}: {
  value: number;
  onIncrease: () => void;
  onDecrease: () => void;
  min?: number;
  testID?: string;
}) {
  const canDecrease = value > min;

  return (
    <View style={styles.stepper} testID={testID}>
      <Pressable
        onPress={canDecrease ? onDecrease : undefined}
        disabled={!canDecrease}
        accessibilityRole="button"
        accessibilityLabel="ลดจำนวน"
        style={[styles.stepperBtn, !canDecrease && styles.stepperBtnDisabled]}
      >
        <Text style={styles.stepperGlyph}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue} accessibilityLabel={`จำนวน ${value}`}>
        {value}
      </Text>
      <Pressable
        onPress={onIncrease}
        accessibilityRole="button"
        accessibilityLabel="เพิ่มจำนวน"
        style={styles.stepperBtn}
      >
        <Text style={styles.stepperGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

/* --------------------------------------------------------- SectionHeader */

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}

/* -------------------------------------------------------------- PriceRow */

/**
 * A label/amount line in an order summary. `emphasis` renders the grand total;
 * `discount` renders in the design's green.
 */
export function PriceRow({
  label,
  amount,
  emphasis = false,
  discount = false,
}: {
  label: string;
  amount: string;
  emphasis?: boolean;
  discount?: boolean;
}) {
  return (
    <View style={styles.priceRow}>
      <Text
        style={[
          styles.priceLabel,
          emphasis && styles.priceLabelEmphasis,
          discount && styles.priceDiscount,
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.priceAmount,
          emphasis && styles.priceAmountEmphasis,
          discount && styles.priceDiscount,
        ]}
      >
        {amount}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------- BottomBar */

/** Sticky action bar. Matches the design's `0 -6px 20px rgba(31,26,22,.06)`. */
export function BottomBar({ children }: { children: React.ReactNode }) {
  return <View style={styles.bottomBar}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardPressed: { backgroundColor: colors.surfaceAlt },

  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold },
  badge_neutral: { backgroundColor: colors.surfaceAlt },
  badgeText_neutral: { color: colors.textMuted },
  badge_success: { backgroundColor: colors.successSoft },
  badgeText_success: { color: colors.success },
  badge_warning: { backgroundColor: colors.warningSoft },
  badgeText_warning: { color: '#8A6A14' },
  badge_primary: { backgroundColor: colors.primary },
  badgeText_primary: { color: colors.textInverse },

  avatar: {
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },

  inputBlock: { gap: spacing.sm },
  inputLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.base, color: colors.textMuted },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.inputHeight,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputWrapError: { borderColor: colors.danger },
  inputPrefix: { fontFamily: fontFamily.regular, fontSize: fontSize.xl, color: colors.textMuted },
  input: { flex: 1, fontFamily: fontFamily.regular, fontSize: fontSize.xl, color: colors.textPrimary, paddingVertical: spacing.md },
  inputError: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.danger },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  stepperBtn: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  stepperBtnDisabled: { opacity: 0.4 },
  stepperGlyph: { fontFamily: fontFamily.regular, fontSize: fontSize.h3, color: colors.textPrimary },
  stepperValue: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
    color: colors.textPrimary,
    minWidth: 24,
    textAlign: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.xxl,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },

  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  priceLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  priceLabelEmphasis: {
    color: colors.textPrimary,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
  },
  priceAmount: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  priceAmountEmphasis: { fontSize: fontSize.h3, fontFamily: fontFamily.bold },
  priceDiscount: { color: colors.success },

  bottomBar: {
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
    ...shadows.bar,
  },
});
