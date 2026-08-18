import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, sizes, spacing } from '../theme/tokens';
import { Badge, Card, type BadgeTone } from './primitives';
import { Button } from './Button';

/* ------------------------------------------------------------- ShopCard */

export interface ShopCardProps {
  name: string;
  /** The design represents shop imagery with an emoji glyph. */
  glyph: string;
  /**
   * Formatted rating, e.g. "4.8". Optional because `restaurants.rating_avg` is
   * nullable — an unrated shop shows no rating line at all rather than a
   * placeholder score.
   */
  rating?: string;
  /** e.g. "อาหารอีสาน · ⭐ 4.8 (326)" */
  meta: string;
  badge?: { label: string; tone: BadgeTone };
  /**
   * Closed right now. UX-SPEC § 5.3: "Closed restaurants are visibly dimmed
   * and remain tappable (a customer may want tomorrow's hours) but cannot be
   * ordered from." Unlike `MenuRow`'s `unavailable`, this does NOT withhold
   * `onPress` — the card stays a real button, only its appearance changes.
   */
  closed?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function ShopCard({
  name,
  glyph,
  rating,
  meta,
  badge,
  closed = false,
  onPress,
  testID,
}: ShopCardProps) {
  return (
    <Card onPress={onPress} testID={testID} style={[styles.shopCard, closed && styles.shopCardClosed]}>
      <View style={styles.shopThumb}>
        <Text style={styles.shopGlyph}>{glyph}</Text>
      </View>
      <View style={styles.shopBody}>
        <View style={styles.shopTitleRow}>
          <Text style={[styles.shopName, closed && styles.shopTextClosed]} numberOfLines={1}>
            {name}
          </Text>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </View>
        {rating ? (
          <Text style={[styles.shopRating, closed && styles.shopTextClosed]}>⭐ {rating}</Text>
        ) : null}
        <Text style={[styles.shopMeta, closed && styles.shopTextClosed]} numberOfLines={2}>
          {meta}
        </Text>
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------- MenuRow */

/** UX-SPEC § 5.3 / § 13 — the only wording for a sold-out item. */
export const UNAVAILABLE_LABEL = 'วันนี้หมด';

export function MenuRow({
  name,
  description,
  price,
  glyph,
  onPress,
  unavailable = false,
  testID,
}: {
  name: string;
  description?: string;
  price: string;
  glyph: string;
  onPress?: () => void;
  /**
   * Sold out today (`menu_items.is_available = false`).
   *
   * The row stays visible — hiding it would make the menu inconsistent with
   * what the customer saw yesterday (UX-SPEC § 5.3) — but becomes inert.
   */
  unavailable?: boolean;
  testID?: string;
}) {
  return (
    // Withholding onPress is the enforcement, not the dimming: Card renders a
    // plain View when it has no handler, so an unavailable row is not a
    // Pressable at all and cannot be tapped, long-pressed, or reached by an
    // accessibility activation. Opacity alone would only look disabled.
    <Card
      onPress={unavailable ? undefined : onPress}
      testID={testID}
      style={[styles.menuRow, unavailable && styles.menuRowUnavailable]}
    >
      <View style={styles.menuBody}>
        <Text style={[styles.menuName, unavailable && styles.menuTextUnavailable]}>{name}</Text>
        {description ? (
          <Text
            style={[styles.menuDesc, unavailable && styles.menuTextUnavailable]}
            numberOfLines={2}
          >
            {description}
          </Text>
        ) : null}
        <View style={styles.menuPriceRow}>
          <Text style={[styles.menuPrice, unavailable && styles.menuTextUnavailable]}>{price}</Text>
          {unavailable ? <Badge label={UNAVAILABLE_LABEL} tone="neutral" /> : null}
        </View>
      </View>
      <View style={[styles.menuThumb, unavailable && styles.menuThumbUnavailable]}>
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
      {selected ? <CheckMark /> : null}
    </Pressable>
  );
}

/**
 * The selected-state check, drawn rather than typed.
 *
 * U+2713 (`✓`) is not in IBM Plex Sans Thai, so iOS substituted a glyph from a
 * fallback face that reads as a square-root sign. Two borders rotated -45°
 * produce the mark the design shows with no dependency on font coverage.
 */
export function CheckMark({ color = colors.primary }: { color?: string }) {
  return (
    <View style={styles.check} accessibilityElementsHidden importantForAccessibility="no">
      <View style={[styles.checkStroke, { borderColor: color }]} />
    </View>
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
  // Dimmed, not disabled — the card stays tappable per UX-SPEC § 5.3.
  shopCardClosed: { opacity: 0.55 },
  shopTextClosed: { color: colors.textMuted },
  shopThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shopGlyph: { fontFamily: fontFamily.regular, fontSize: 30 },
  shopBody: { flex: 1, gap: 2 },
  shopTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  shopName: {
    flexShrink: 1,
    fontSize: fontSize.xl,
    fontFamily: fontFamily.semibold,
    color: colors.textPrimary,
  },
  shopRating: { fontFamily: fontFamily.regular, fontSize: fontSize.base, color: colors.textMuted },
  shopMeta: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle, lineHeight: 18 },

  menuRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  // Dimmed, but still legible — the customer needs to read what is sold out.
  menuRowUnavailable: { opacity: 0.55 },
  menuTextUnavailable: { color: colors.textMuted },
  menuThumbUnavailable: { opacity: 0.5 },
  menuPriceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuBody: { flex: 1, gap: 3 },
  menuName: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  menuDesc: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  menuPrice: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.textPrimary },
  menuThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuGlyph: { fontFamily: fontFamily.regular, fontSize: 26 },

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
  chipIcon: { fontFamily: fontFamily.regular, fontSize: 22 },
  chipLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  chipLabelSelected: { color: colors.primary, fontFamily: fontFamily.semibold },

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
  listLeading: { fontFamily: fontFamily.regular, fontSize: 22 },
  listBody: { flex: 1, gap: 2 },
  listTitle: { fontSize: fontSize.lg, color: colors.textPrimary, fontFamily: fontFamily.medium },
  listSubtitle: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  listTrailing: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  check: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  checkStroke: {
    width: 13,
    height: 7,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    borderBottomLeftRadius: 1,
    transform: [{ rotate: '-45deg' }],
    marginTop: -4,
  },

  stateView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  stateGlyph: { fontFamily: fontFamily.regular, fontSize: 48 },
  stateTitle: {
    fontSize: fontSize.h3,
    fontFamily: fontFamily.semibold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  stateMessage: {
    fontFamily: fontFamily.regular, fontSize: fontSize.md,
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
  timelineLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.textMuted },
  timelineLabelActive: { color: colors.textPrimary, fontFamily: fontFamily.semibold },
  timelineCaption: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle },
});
