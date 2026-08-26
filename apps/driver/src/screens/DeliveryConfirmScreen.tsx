import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useProofSubmission } from '../hooks/useProofSubmission';
import type { RiderStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RiderStackParamList>;
type Route = RouteProp<RiderStackParamList, 'DeliveryConfirm'>;

/**
 * P-06 through P-09 — confirm, in flight, failed, and delivered (POD UX
 * design §C).
 *
 * One route, four renderings, because they are four states of a single
 * question — *has the server accepted this delivery yet* — and moving between
 * them by navigation would let the back gesture return a rider to a confirm
 * screen for a delivery that is already closed.
 *
 * ## ส่งสำเร็จ appears only after a 200
 *
 * The success state is gated on `completedAt`, which the hook sets **only**
 * from the delivered command's own response (`deliveries.delivered_at`), never
 * from a local clock and never optimistically. During the sequence the CTA is
 * inert and the copy says so: `ยังไม่ถือว่าส่งสำเร็จ จนกว่าระบบจะตอบรับ`.
 *
 * ## Failure keeps the photo and keeps the job open
 *
 * A failure at any of the three steps leaves the delivery exactly as it was
 * and the photo on the device. The retry copy distinguishes the two cases
 * honestly: once the bytes are in R2 it says `รูปที่ถ่ายไว้ยังอยู่ในเครื่อง
 * ไม่ต้องถ่ายใหม่`, because the retry genuinely sends the command alone.
 *
 * ## On success the stack resets
 *
 * `กลับหน้าหลัก` calls `popToTop`, so back cannot return to a confirm screen
 * for a closed delivery. The active-delivery screen re-reads on focus and
 * finds nothing, which is correct: `DELIVERED` is terminal and outside
 * `ACTIVE_DELIVERY_STATES`.
 */
export function DeliveryConfirmScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { deliveryId, photo } = params;
  const { stage, submitting, error, photoUploaded, completedAt, submit, reset } =
    useProofSubmission();

  // P-09 — reached only on a successful command response.
  if (completedAt) {
    return (
      <Screen scroll testID="screen-delivery-confirm">
        <View style={styles.success} testID="delivery-completed">
          <Text style={styles.successMark}>✓</Text>
          <Text style={styles.successTitle}>ส่งสำเร็จ</Text>
          <Text style={styles.muted}>ปิดเรียบร้อย ระบบบันทึกรูปหลักฐานไว้แล้ว</Text>
          <Text style={styles.metaValue} testID="delivery-completed-at">
            เวลาส่งสำเร็จ {formatTime(completedAt)}
          </Text>
          <Text style={styles.muted}>คุณพร้อมรับงานใหม่แล้ว</Text>
          <Button
            label="กลับหน้าหลัก"
            onPress={() => navigation.popToTop()}
            testID="button-back-home"
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll testID="screen-delivery-confirm">
      <Text style={styles.title}>ยืนยันการส่ง</Text>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>รูปหลักฐาน</Text>
        <View style={styles.thumbRow}>
          <Image
            source={{ uri: photo.uri }}
            style={styles.thumb}
            resizeMode="cover"
            accessible
            accessibilityRole="image"
            accessibilityLabel="รูปหลักฐานการส่งที่ถ่ายไว้"
            testID="proof-thumbnail"
          />
          <View style={styles.thumbMeta}>
            <Text style={styles.metaValue}>รูปหลักฐานพร้อมแล้ว</Text>
            <Text style={styles.muted}>ถ่ายเมื่อ {formatTime(photo.capturedAt)}</Text>
          </View>
        </View>

        <Button
          label="ถ่ายใหม่"
          variant="ghost"
          // Disabled mid-flight: replacing the photo while its bytes are being
          // uploaded would leave an object in R2 that no key ever references.
          disabled={submitting}
          onPress={() => {
            reset();
            navigation.replace('ProofCamera', { deliveryId });
          }}
          testID="button-retake-from-confirm"
        />
      </View>

      {stage === 'presigning' || stage === 'uploading' || stage === 'confirming' ? (
        <View style={styles.progress} testID="proof-submitting">
          <ActivityIndicator color={colors.primary} />
          <Text
            style={styles.metaValue}
            accessibilityLiveRegion="polite"
            testID="proof-submitting-stage"
          >
            {STAGE_COPY[stage]}
          </Text>
          <Text style={styles.muted}>อย่าปิดแอปจนกว่าจะเสร็จ</Text>
          <Text style={styles.muted}>ยังไม่ถือว่าส่งสำเร็จ จนกว่าระบบจะตอบรับ</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.failure} testID="proof-error">
          <Text style={styles.failureTitle}>ส่งรูปไม่สำเร็จ</Text>
          <Text style={styles.muted}>{error}</Text>
          <Text style={styles.muted}>ยังไม่ได้ยืนยันการส่ง งานนี้ยังเปิดอยู่</Text>
          <Text style={styles.muted} testID="proof-retry-hint">
            {photoUploaded
              ? 'รูปที่ถ่ายไว้ยังอยู่ในเครื่อง ไม่ต้องถ่ายใหม่'
              : 'เมื่อสัญญาณกลับมา กดลองส่งอีกครั้ง'}
          </Text>
        </View>
      ) : null}

      <Text style={styles.warning}>กดยืนยันแล้วงานนี้จะปิดและแก้ไขรูปไม่ได้</Text>

      <Button
        label={error ? 'ลองส่งอีกครั้ง' : 'ส่งสำเร็จ'}
        loading={submitting}
        disabled={submitting}
        onPress={() => void submit(deliveryId, photo)}
        testID="button-confirm-delivered"
      />
    </Screen>
  );
}

const STAGE_COPY: Record<string, string> = {
  presigning: 'กำลังเตรียมอัปโหลด',
  uploading: 'กำลังส่งรูปหลักฐาน',
  confirming: 'กำลังยืนยันการส่ง',
};

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString('th-TH');
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.h2,
    color: colors.textPrimary,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  sectionLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSubtle },
  thumbRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.border },
  thumbMeta: { flex: 1, gap: spacing.xs },
  metaValue: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  muted: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  progress: { gap: spacing.sm, paddingVertical: spacing.md, alignItems: 'center' },
  failure: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceRaised,
  },
  failureTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg, color: colors.danger },
  warning: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle },
  success: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  successMark: { fontSize: fontSize.h1, fontFamily: fontFamily.bold, color: colors.primary },
  successTitle: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
});
