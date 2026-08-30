import { StyleSheet, Text, View } from 'react-native';
import { Button, driverColors, driverFontSize, fontFamily, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { StateCard, type StateCardVariant } from '../components/StateCard';
import type { RiderStatus } from '../domain/riderProfile';

/**
 * R-02 สถานะการตรวจสอบ — what a rider who cannot yet work sees.
 *
 * ## The one rule this screen exists to enforce
 *
 * **DEC-UX-006: a non-approved rider sees no online toggle at all, not a
 * disabled one.** There is deliberately no `disabled` prop anywhere in this
 * file and no availability state is read on this path — the control is absent
 * from the tree, which is a stronger guarantee than a greyed-out button that a
 * later refactor could re-enable.
 *
 * ## What this screen must not become
 *
 * No onboarding, no document upload, no "submit for approval", no appeal, no
 * retry-approval action. Rider onboarding — what a rider submits, who approves
 * it, and the contractual relationship — is **BQ-022**, still `OPEN` and
 * `LEGAL_REVIEW_REQUIRED`. Building any of it here would answer a legal
 * question this app has no standing to answer. The only action offered is
 * signing out.
 *
 * ⚠️ **DQ-G7-01** — the copy for each non-approved status, and which strip
 * variant it wears, is not specified by the UX handoff. See
 * `docs/DRIVER_APP_DESIGN_QUESTIONS.md`. Every line below is deliberately
 * factual rather than reassuring or directive: it states what the server says
 * and stops, because telling a rider "your documents are being reviewed" or
 * "contact support" would be inventing a process nobody has decided.
 */

/** `null` means the signed-in user has no `riders` row at all. */
export type GateStatus = RiderStatus | null;

/**
 * Which of DEC-UX-006's four strip variants a non-approved status wears.
 *
 * The split is by *whether the rider is waiting on someone else* (`pending`)
 * or *cannot proceed as things stand* (`blocked`). `DOCUMENTS_REJECTED` sits
 * in `blocked` because nothing is in flight for it — but the resolution path
 * is BQ-022's, not this app's, which is exactly what DQ-G7-01 asks about.
 */
export function statusStripVariant(status: GateStatus): StateCardVariant {
  switch (status) {
    case 'REGISTERED':
    case 'DOCUMENTS_SUBMITTED':
    case 'PENDING_APPROVAL':
      return 'pending';
    case 'DOCUMENTS_REJECTED':
    case 'SUSPENDED':
    case 'DEACTIVATED':
      return 'blocked';
    default:
      // `null` — no rider record. Not pending anything, because nothing was
      // ever submitted.
      return 'blocked';
  }
}

/** Factual, non-directive copy. See the DQ note above. */
const STATUS_DETAIL: Record<NonNullable<GateStatus>, string> = {
  REGISTERED: 'บัญชีไรเดอร์ถูกสร้างแล้ว แต่ยังไม่ได้รับอนุมัติให้รับงาน',
  DOCUMENTS_SUBMITTED: 'ส่งเอกสารแล้ว ยังไม่ได้รับอนุมัติให้รับงาน',
  PENDING_APPROVAL: 'อยู่ระหว่างรอการอนุมัติ ยังรับงานไม่ได้',
  DOCUMENTS_REJECTED: 'เอกสารไม่ผ่านการตรวจสอบ ยังรับงานไม่ได้',
  SUSPENDED: 'บัญชีถูกระงับชั่วคราว ยังรับงานไม่ได้',
  DEACTIVATED: 'บัญชีถูกปิดใช้งาน ยังรับงานไม่ได้',
  // Present for exhaustiveness only — an APPROVED rider never reaches this
  // screen, because HomeScreen renders the availability control instead.
  APPROVED: 'บัญชีได้รับอนุมัติแล้ว',
};

const NO_RIDER_DETAIL = 'บัญชีนี้ยังไม่ได้ลงทะเบียนเป็นไรเดอร์';

/** R-02a/b headline text — the two DEC-UX-006 variants this screen ever wears. */
const VARIANT_HEADLINE: Record<'pending' | 'blocked', string> = {
  pending: 'รอตรวจสอบ',
  blocked: 'ยังรับงานไม่ได้',
};

export function StatusScreen({
  status,
  fullName,
  onSignOut,
}: {
  status: GateStatus;
  /** `null` when there is no rider record to take a name from. */
  fullName: string | null;
  onSignOut: () => void;
}) {
  const detail = status ? STATUS_DETAIL[status] : NO_RIDER_DETAIL;
  const variant = statusStripVariant(status);

  return (
    <Screen scroll testID="screen-status">
      <View style={styles.header}>
        <Text style={styles.title}>สถานะไรเดอร์</Text>
        {fullName ? <Text style={styles.name}>{fullName}</Text> : null}
      </View>

      <StateCard
        variant={variant}
        headline={VARIANT_HEADLINE[variant as 'pending' | 'blocked']}
        detail={detail}
        testID="rider-status-card"
      />

      <Text style={styles.note}>
        เมื่อบัญชีได้รับอนุมัติแล้ว ปุ่มเปิดรับงานจะปรากฏบนหน้านี้
      </Text>

      {/*
        No toggle in this tree — DEC-UX-006. The only control a rider who
        cannot work is offered is leaving.
      */}
      <Button label="ออกจากระบบ" variant="secondary" onPress={onSignOut} testID="button-sign-out" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.xs },
  title: { fontSize: driverFontSize.screenTitle, fontFamily: fontFamily.bold, color: driverColors.text.primary },
  name: { fontFamily: fontFamily.regular, fontSize: driverFontSize.body, color: driverColors.text.meta },
  note: {
    fontFamily: fontFamily.regular,
    fontSize: driverFontSize.supporting,
    color: driverColors.text.faint,
    paddingHorizontal: spacing.xs,
  },
});
