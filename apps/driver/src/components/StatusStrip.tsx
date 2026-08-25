import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';

/**
 * The rider's operational status — DEC-UX-006's persistent, non-collapsible
 * strip.
 *
 * The handoff names four variants: **offline · online · pending approval ·
 * suspended**. Those are the four this component renders, and it renders one
 * of them always — there is no collapsed or hidden state, which is the whole
 * point of the decision: a rider must never have to go looking for whether
 * they are receiving work.
 *
 * ⚠️ **DQ-G7-01.** `riders.status` has seven values and this strip has four,
 * so six non-approved statuses (plus "no rider record at all") have to land in
 * `pending` or `blocked`, and the handoff does not say which goes where. The
 * mapping lives in `statusStripVariant` below, with its reasoning stated; the
 * open question is recorded in `docs/DRIVER_APP_DESIGN_QUESTIONS.md`. The
 * *behaviour* is not in question — DEC-UX-006 is explicit that any
 * non-approved rider sees no toggle — only which of two non-approved labels
 * each status wears.
 */

export type StatusStripVariant = 'online' | 'offline' | 'pending' | 'blocked';

const VARIANT_LABEL: Record<StatusStripVariant, string> = {
  online: 'กำลังรับงาน',
  offline: 'ปิดรับงาน',
  pending: 'รอตรวจสอบ',
  blocked: 'ยังรับงานไม่ได้',
};

const VARIANT_GLYPH: Record<StatusStripVariant, string> = {
  online: '🟢',
  offline: '⚪',
  pending: '🕓',
  blocked: '🚫',
};

export function StatusStrip({
  variant,
  detail,
  testID = 'status-strip',
}: {
  variant: StatusStripVariant;
  /** One line of context under the label. Never optional in practice — a bare status explains nothing. */
  detail: string;
  testID?: string;
}) {
  return (
    <View style={[styles.strip, styles[variant]]} testID={testID}>
      <Text style={styles.glyph}>{VARIANT_GLYPH[variant]}</Text>
      <View style={styles.body}>
        <Text style={styles.label} testID={`${testID}-label`}>
          {VARIANT_LABEL[variant]}
        </Text>
        <Text style={styles.detail} testID={`${testID}-detail`}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
  },
  online: { backgroundColor: colors.successSoft, borderColor: colors.success },
  offline: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  pending: { backgroundColor: colors.warningSoft, borderColor: colors.borderStrong },
  blocked: { backgroundColor: colors.surfaceSunken, borderColor: colors.borderStrong },

  glyph: { fontFamily: fontFamily.regular, fontSize: fontSize.h3 },
  body: { flex: 1, gap: spacing.xs },
  label: { fontFamily: fontFamily.semibold, fontSize: fontSize.xl, color: colors.textPrimary },
  detail: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
});
