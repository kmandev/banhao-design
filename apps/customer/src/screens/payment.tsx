import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  PriceRow,
  SectionHeader,
  StateView,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useCart } from '../hooks/useCart';
import { formatBaht } from '../mocks/pricing';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * Payment screens — design group `การชำระเงิน` (12, 12b–12h).
 *
 * ⚠️ NO PAYMENT PROVIDER IS INTEGRATED. Q-001 is OPEN and DEC-015 restricts
 * provider access to the PaymentProvider abstraction in apps/api. Every screen
 * here renders a payment STATE from local navigation only — nothing charges,
 * confirms, or refunds anything.
 *
 * CON-002 is the reason these can never become real by adding client code:
 * only a signature-verified provider webhook may confirm a payment. A client
 * screen must never be the thing that decides a payment succeeded.
 */

const QR_TTL_SECONDS = 600; // 10 minutes — the EXPIRED timeout in docs/ARCHITECTURE.md.

/** 12 พร้อมเพย์ QR. */
export function PromptPayQrScreen() {
  const navigation = useNavigation<Nav>();
  const { totals } = useCart();
  const [secondsLeft, setSecondsLeft] = useState(QR_TTL_SECONDS);

  useEffect(() => {
    if (secondsLeft > 0) {
      const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
      return () => clearTimeout(timer);
    }

    // TTL reached zero. A QR that has expired cannot be paid, so EXPIRED is the
    // only honest next state — this decides nothing about money, it just stops
    // showing a code that no longer works. `replace` rather than `navigate` so
    // Back cannot return to a dead QR.
    navigation.replace('PayExpired');
    return undefined;
  }, [secondsLeft, navigation]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <Screen
      scroll
      testID="screen-promptpay-qr"
      footer={
        <BottomBar>
          <Button
            label="ฉันชำระเงินแล้ว"
            onPress={() => navigation.navigate('PayChecking')}
            testID="button-paid"
          />
          <Button
            label="ยกเลิก"
            variant="ghost"
            onPress={() => navigation.goBack()}
          />
        </BottomBar>
      }
    >
      <SectionHeader title="สแกนเพื่อจ่าย" />

      <Card style={styles.qrCard}>
        {/*
          Placeholder rather than a real QR: generating one requires a payment
          provider (Q-001, OPEN). Rendering a fake scannable code would be worse
          than an obvious placeholder — see docs/CUSTOMER_APP_ASSETS.md.
        */}
        <View style={styles.qrBox} accessibilityLabel="ตัวอย่าง QR พร้อมเพย์">
          <Text style={styles.qrGlyph}>📱</Text>
          <Text style={styles.qrNote}>ตัวอย่าง QR{'\n'}(ยังไม่ได้เชื่อมผู้ให้บริการ)</Text>
        </View>

        <Text style={styles.amount}>{formatBaht(totals.totalSatang)}</Text>
        <Text style={styles.countdown}>
          QR หมดอายุใน {minutes}:{seconds}
        </Text>
      </Card>

      <Card>
        <PriceRow label="ราคาอาหาร" amount={formatBaht(totals.subtotalSatang)} />
        <PriceRow label="ค่าส่ง" amount={formatBaht(totals.deliveryFeeSatang)} />
        <PriceRow label="ค่าบริการ" amount={formatBaht(totals.serviceFeeSatang)} />
        <View style={styles.divider} />
        <PriceRow label="รวมทั้งหมด" amount={formatBaht(totals.totalSatang)} emphasis />
      </Card>

      <Text style={styles.hint}>
        เปิดแอปธนาคาร → สแกน QR → ยืนยันการโอน{'\n'}
        ระบบจะยืนยันให้อัตโนมัติเมื่อได้รับเงิน
      </Text>
    </Screen>
  );
}

/** 12b กำลังตรวจสอบ — Payment state PROCESSING. */
export function PayCheckingScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-pay-checking"
      footer={
        <BottomBar>
          {/*
            These buttons exist so every payment state is reachable for review.
            In production the transition comes from a backend webhook (CON-002),
            never from a customer tapping a button.
          */}
          <Button label="จำลอง: สำเร็จ" onPress={() => navigation.navigate('PaySuccess')} />
          <Button
            label="จำลอง: ยืนยันไม่ได้"
            variant="secondary"
            onPress={() => navigation.navigate('PayFailed')}
          />
          <Button
            label="จำลอง: จ่ายซ้ำ"
            variant="ghost"
            onPress={() => navigation.navigate('PayDuplicate')}
          />
        </BottomBar>
      }
    >
      <StateView
        kind="loading"
        title="กำลังตรวจสอบการชำระเงิน"
        message="กำลังรอการยืนยันจากธนาคาร ไม่ต้องปิดหน้านี้"
        testID="state-pay-checking"
      />
    </Screen>
  );
}

/** 12c ชำระสำเร็จ — Payment state SUCCESS. */
export function PaySuccessScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-pay-success"
      footer={
        <BottomBar>
          <Button label="ดูออเดอร์" onPress={() => navigation.navigate('OrderConfirmed')} />
          <Button
            label="รายละเอียดการจ่าย"
            variant="ghost"
            onPress={() => navigation.navigate('PayDetail')}
          />
        </BottomBar>
      }
    >
      <StateView
        kind="success"
        glyph="✅"
        title="ชำระเงินสำเร็จ"
        message="เราได้รับเงินแล้ว กำลังส่งออเดอร์ให้ร้าน"
        testID="state-pay-success"
      />
    </Screen>
  );
}

/** 12d ยืนยันไม่ได้ — Payment state FAILED. */
export function PayFailedScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-pay-failed"
      footer={
        <BottomBar>
          <Button label="ลองจ่ายอีกครั้ง" onPress={() => navigation.navigate('PromptPayQr')} />
          <Button
            label="เปลี่ยนเป็นเงินสด"
            variant="secondary"
            onPress={() => navigation.navigate('Checkout')}
          />
        </BottomBar>
      }
    >
      <StateView
        kind="error"
        glyph="⚠️"
        title="ยังยืนยันการชำระเงินไม่ได้"
        message="ถ้าคุณโอนแล้ว เงินจะไม่หาย ระบบจะตรวจสอบอีกครั้งอัตโนมัติ"
        testID="state-pay-failed"
      />
    </Screen>
  );
}

/** 12e QR หมดอายุ — Payment state EXPIRED. */
export function PayExpiredScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-pay-expired"
      footer={
        <BottomBar>
          <Button label="ขอ QR ใหม่" onPress={() => navigation.navigate('PromptPayQr')} />
          <Button label="กลับไปแก้ออเดอร์" variant="ghost" onPress={() => navigation.navigate('Checkout')} />
        </BottomBar>
      }
    >
      <StateView
        kind="info"
        glyph="⏰"
        title="QR นี้หมดอายุแล้ว"
        message="QR มีอายุ 10 นาที กดขอ QR ใหม่เพื่อชำระเงินอีกครั้ง"
        testID="state-pay-expired"
      />
    </Screen>
  );
}

/**
 * 12f จ่ายซ้ำ / จ่ายแล้ว.
 *
 * The customer-facing form of REQ-003 (idempotency): a duplicate payment for
 * the same reference must not create a second charge.
 */
export function PayDuplicateScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <Screen
      testID="screen-pay-duplicate"
      footer={
        <BottomBar>
          <Button label="ดูออเดอร์" onPress={() => navigation.navigate('OrderConfirmed')} />
          <Button
            label="รายละเอียดการจ่าย"
            variant="ghost"
            onPress={() => navigation.navigate('PayDetail')}
          />
        </BottomBar>
      }
    >
      <StateView
        kind="info"
        glyph="🧾"
        title="ออเดอร์นี้ชำระเงินแล้ว"
        message="เราได้รับเงินสำหรับออเดอร์นี้เรียบร้อยแล้ว ไม่มีการเรียกเก็บซ้ำ"
        testID="state-pay-duplicate"
      />
    </Screen>
  );
}

/** 12g รายละเอียดการจ่าย. */
export function PayDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { totals } = useCart();

  return (
    <Screen
      scroll
      testID="screen-pay-detail"
      footer={
        <BottomBar>
          <Button
            label="ขอคืนเงิน"
            variant="secondary"
            onPress={() => navigation.navigate('Refund')}
            testID="button-request-refund"
          />
        </BottomBar>
      }
    >
      <SectionHeader title="รายละเอียดการจ่าย" />

      <Card>
        <DetailRow label="PAYMENT ID" value="PAY-BH000125" />
        <DetailRow label="ORDER" value="BH000125" />
        <DetailRow label="AMOUNT" value={formatBaht(totals.totalSatang)} />
        <DetailRow label="METHOD" value="PROMPTPAY" />
        <DetailRow label="STATUS" value="SUCCESS" />
        <DetailRow label="PROVIDER REF" value="····8F2A" />
      </Card>

      {/*
        The design is explicit that only a partial reference is shown — never a
        full account number, key, or provider secret.
      */}
      <Text style={styles.hint}>
        แสดงเฉพาะเลขอ้างอิงบางส่วน ไม่แสดงเลขบัญชีเต็มหรือข้อมูลลับของผู้ให้บริการ
      </Text>
    </Screen>
  );
}

/**
 * 12h การคืนเงิน.
 *
 * ⚠️ Q-020: no examined payment provider supports native PromptPay refunds.
 * The real mechanism is undecided, so this screen states the process rather
 * than promising an automatic refund the platform cannot currently perform.
 */
export function RefundScreen() {
  const navigation = useNavigation<Nav>();
  const { totals } = useCart();

  return (
    <Screen
      scroll
      testID="screen-refund"
      footer={
        <BottomBar>
          <Button label="กลับไปที่ออเดอร์" onPress={() => navigation.navigate('Tabs')} />
        </BottomBar>
      }
    >
      <SectionHeader title="การคืนเงิน" />

      <Card style={styles.refundCard}>
        <Text style={styles.refundAmount}>{formatBaht(totals.totalSatang)}</Text>
        <Text style={styles.refundStatus}>กำลังดำเนินการคืนเงิน</Text>
      </Card>

      <Card style={styles.steps}>
        <RefundStep label="ส่งคำขอไปที่ธนาคาร" done />
        <RefundStep label="ธนาคารกำลังดำเนินการ" active />
        <RefundStep label="เงินเข้าบัญชีแล้ว" />
      </Card>

      <Text style={styles.hint}>
        ทีมงานจะติดต่อกลับหากต้องการข้อมูลเพิ่มเติม{'\n'}
        หากมีคำถาม ติดต่อศูนย์ช่วยเหลือได้ตลอดเวลา
      </Text>
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function RefundStep({
  label,
  done = false,
  active = false,
}: {
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <View style={styles.stepRow}>
      <View
        style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}
      />
      <Text style={[styles.stepLabel, (done || active) && styles.stepLabelActive]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  qrCard: { alignItems: 'center', gap: spacing.md },
  qrBox: {
    width: 200,
    height: 200,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  qrGlyph: { fontFamily: fontFamily.regular, fontSize: 56 },
  qrNote: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  amount: { fontSize: fontSize.h1, fontFamily: fontFamily.bold, color: colors.textPrimary },
  countdown: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  hint: {
    fontFamily: fontFamily.regular, fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    paddingVertical: spacing.lg,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  detailLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted, letterSpacing: 1 },
  detailValue: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  refundCard: { alignItems: 'center', gap: spacing.xs },
  refundAmount: { fontSize: fontSize.h1, fontFamily: fontFamily.bold, color: colors.textPrimary },
  refundStatus: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  steps: { gap: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.borderStrong },
  stepDotDone: { backgroundColor: colors.success },
  stepDotActive: { backgroundColor: colors.primary },
  stepLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.textMuted },
  stepLabelActive: { color: colors.textPrimary, fontFamily: fontFamily.medium },
});
