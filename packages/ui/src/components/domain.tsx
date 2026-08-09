import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, fontSize, fontWeight, sizes, spacing } from '../theme/tokens';
import { Badge, Card, type BadgeTone } from './primitives';
import { Button } from './Button';

/* ------------------------------------------------------------- ShopCard */

export interface ShopCardProps {
  name: string;
  /** The design represents shop imagery with an emoji glyph. */
  glyph: string;
  rating: string;
  /** e.g. "อาหารอีสาน · 1.1 กม. · 15–20 นาที · ค่าส่ง ฿10" */
  meta: string;
  badge?: { label: string; tone: BadgeTone };
  onPress?: () => void;
  testID?: string;
}

export function ShopCard({ name, glyph, rating, meta, badge, onPress, testID }: ShopCardProps) {
  return (
    <Card onPress={onPress} testID={testID} style={styles.shopCard}>
      <View style={styles.shopThumb}>
        <Text style={styles.shopGlyph}>{glyph}</Text>
      </View>
      <View style={styles.shopBody}>
        <View style={styles.shopTitleRow}>
          <Text style={styles.shopName} numberOfLines={1}>
            {name}
          </Text>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </View>
        <Text style={styles.shopRating}>⭐ {rating}</Text>
        <Text style={styles.shopMeta} numberOfLines={2}>
          {meta}
        </Text>
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------- MenuRow */

export function MenuRow({
  name,
  description,
  price,
  glyph,
  onPress,
  testID,
}: {
  name: string;
  description?: string;
  price: string;
  glyph: string;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Card onPress={onPress} testID={testID} style={styles.menuRow}>
      <View style={styles.menuBody}>
        <Text style={styles.menuName}>{name}</Text>
        {description ? (
          <Text style={styles.menuDesc} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <Text style={styles.menuPrice}>{price}</Text>
      </View>
      <View style={styles.menuThumb}>
        <Text style={styles.menuGlyph}>{glyph}</Text>
      </View>
    </Card>
  );
}

/* --------------------------------------------------------- CategoryChip */

export function CategoryChip({
  icon,
  name,
  selected = false,
  onPress,
}: {
  icon: string;
  name: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={styles.chipIcon}>{icon}</Text>
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{name}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------------- ListRow */

/** Generic navigable row used by Profile and Address screens. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  selected,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  leading?: string;
  trailing?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [
        styles.listRow,
        selected && styles.listRowSelected,
        pressed && !!onPress && styles.listRowPressed,
      ]}
    >
      {leading ? <Text style={styles.listLeading}>{leading}</Text> : null}
      <View style={styles.listBody}>
        <Text style={styles.listTitle}>{title}</Text>
        {subtitle ? <Text style={styles.listSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={styles.listTrailing}>{trailing}</Text> : null}
      {selected ? <Text style={styles.listCheck}>✓</Text> : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------ StateView */

export type StateKind = 'loading' | 'empty' | 'error' | 'success' | 'info';

/**
 * The design's dedicated state screens (⏳ กำลังโหลด, 📡 เน็ตมีปัญหา,
 * 🧺 ตะกร้าว่าง, 🛵 ไม่มีไรเดอร์, 🚫 ออเดอร์ถูกยกเลิก) all share this shape:
 * a large glyph, a title, supporting copy, and an optional action.
 */
export function StateView({
  kind,
  glyph,
  title,
  message,
  actionLabel,
  onAction,
  testID,
}: {
  kind: StateKind;
  glyph?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.stateView} testID={testID}>
      {kind === 'loading' ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : (
        <Text style={styles.stateGlyph}>{glyph ?? 'ℹ️'}</Text>
      )}
      <Text style={styles.stateTitle} accessibilityRole="header">
        {title}
      </Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.stateAction}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" fullWidth={false} />
        </View>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------- StatusTimeline */

/** Order tracking steps (design screen 14). */
export function StatusTimeline({
  steps,
}: {
  steps: { label: string; caption?: string; done: boolean; active: boolean }[];
}) {
  return (
    <View style={styles.timeline}>
      {steps.map((step, i) => (
        <View key={step.label} style={styles.timelineRow}>
          <View style={styles.timelineGutter}>
            <View
              style={[
                styles.timelineDot,
                step.done && styles.timelineDotDone,
                step.active && styles.timelineDotActive,
              ]}
            />
            {i < steps.length - 1 ? (
              <View style={[styles.timelineLine, step.done && styles.timelineLineDone]} />
            ) : null}
          </View>
          <View style={styles.timelineBody}>
            <Text style={[styles.timelineLabel, step.active && styles.timelineLabelActive]}>
              {step.label}
            </Text>
            {step.caption ? <Text style={styles.timelineCaption}>{step.caption}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shopCard: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  shopThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopGlyph: { fontSize: 30 },
  shopBody: { flex: 1, gap: 2 },
  shopTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shopName: {
    flexShrink: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  shopRating: { fontSize: fontSize.base, color: colors.textMuted },
  shopMeta: { fontSize: fontSize.sm, color: colors.textSubtle, lineHeight: 18 },

  menuRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  menuBody: { flex: 1, gap: 3 },
  menuName: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  menuDesc: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  menuPrice: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textPrimary },
  menuThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlyph: { fontSize: 26 },

  chip: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 72,
  },
  chipSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipIcon: { fontSize: 22 },
  chipLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  chipLabelSelected: { color: colors.primary, fontWeight: fontWeight.semibold },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.touchTarget + 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  listRowPressed: { backgroundColor: colors.surfaceAlt },
  listLeading: { fontSize: 22 },
  listBody: { flex: 1, gap: 2 },
  listTitle: { fontSize: fontSize.lg, color: colors.textPrimary, fontWeight: fontWeight.medium },
  listSubtitle: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  listTrailing: { fontSize: fontSize.md, color: colors.textMuted },
  listCheck: { fontSize: fontSize.xl, color: colors.primary, fontWeight: fontWeight.bold },

  stateView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  stateGlyph: { fontSize: 48 },
  stateTitle: {
    fontSize: fontSize.h3,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateMessage: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  stateAction: { marginTop: spacing.sm },

  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineGutter: { alignItems: 'center', width: 24 },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.borderStrong,
    marginTop: 4,
  },
  timelineDotDone: { backgroundColor: colors.success },
  timelineDotActive: { backgroundColor: colors.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 4 },
  timelineLineDone: { backgroundColor: colors.success },
  timelineBody: { flex: 1, paddingBottom: spacing.xl, gap: 2 },
  timelineLabel: { fontSize: fontSize.lg, color: colors.textMuted },
  timelineLabelActive: { color: colors.textPrimary, fontWeight: fontWeight.semibold },
  timelineCaption: { fontSize: fontSize.sm, color: colors.textSubtle },
});
