import { useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, StyleSheet, Text, View } from 'react-native';
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
import { formatBaht } from '../lib/money';
import { presentLoadError } from '../lib/loadError';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import type { PaymentStartRefusal } from '../repositories/types';
import type { OrderState } from '../domain/order';
// Phase F screens, still on sample fee numbers. The cart stopped computing
// these at D-5 (DEC-D-01 — the app must not invent money), so the dependency on
// the design's illustrative figures is explicit here rather than hidden inside
// the cart hook. Real amounts arrive with the payment domain.
import { calculateTotals } from '../mocks/pricing';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * The order reference the ONLINE chain carries (Phase E-3E).
 *
 * `CheckoutScreen` puts a real `orderId`/`orderNumber` on `PromptPayQr` after
 * `POST /orders` succeeds; every screen below forwards the pair unchanged onto
 * the navigation edges that already existed, so C-13 can finally offer the
 * design's `ติดตามออเดอร์` action against the real order instead of a
 * fabricated state. Nothing here reads the id for anything else — these
 * screens still decide nothing about money (CON-002).
 *
 * Both fields stay optional the whole way: a retry re-enters `PromptPayQr`
 * with no params, and the CASH path never had an order at all. `undefined`
 * simply propagates, and the screen that would show a reference shows none.
 */
type OrderReference = { orderId?: string; orderNumber?: string };

/** The `{ orderId, orderNumber }` this screen was given, or an empty reference. */
function useOrderReference(
  route: RouteProp<
    CustomerStackParamList,
    'PromptPayQr' | 'PayChecking' | 'PaySuccess' | 'PayDuplicate' | 'PayFailed' | 'PayExpired'
  >,
): OrderReference {
  return { orderId: route.params?.orderId, orderNumber: route.params?.orderNumber };
}

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

/** How often the screens re-read the order while waiting for the server to confirm. A UI refresh rate, not a policy value. */
const PAYMENT_POLL_MS = 3000;

/**
 * Where an order stands from the payment screens' point of view, read from
 * the server's own `orders.state`. The app never decides a payment succeeded
 * (CON-002): `PAID` only appears after the provider's signed webhook.
 */
type PaymentOutcome = 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'CLOSED';

function paymentOutcomeOf(state: OrderState): PaymentOutcome {
  switch (state) {
    case 'CREATED':
    case 'PENDING_PAYMENT':
      return 'PENDING';
    case 'PAYMENT_EXPIRED':
      return 'EXPIRED';
    case 'PAYMENT_FAILED':
      return 'FAILED';
    case 'CANCELLED':
      // Cancelled while the QR was open: nothing here can say whether money
      // moved, so hand over to the order's own screen, which shows its state.
      return 'CLOSED';
    default:
      // PAID and everything after it.
      return 'PAID';
  }
}

/**
 * Re-reads the order until it leaves the pending states, then reports the
 * outcome once. Read failures are ignored and the next tick tries again, so a
 * dropped request never moves the customer to a wrong screen.
 */
function usePaymentOutcome(orderId: string | undefined, onOutcome: (outcome: PaymentOutcome) => void) {
  const callback = useRef(onOutcome);
  callback.current = onOutcome;

  useEffect(() => {
    if (!orderId) return undefined;
    let settled = false;

    const check = () => {
      repositories.orderDetail
        .getOrder(orderId)
        .then((order) => {
          if (settled || !order) return;
          const outcome = paymentOutcomeOf(order.state);
          if (outcome !== 'PENDING') {
            settled = true;
            callback.current(outcome);
          }
        })
        .catch(() => undefined);
    };

    const timer = setInterval(check, PAYMENT_POLL_MS);
    return () => {
      settled = true;
      clearInterval(timer);
    };
  }, [orderId]);
}

/** Moves to the screen for a settled outcome. `replace`, so Back cannot return to a dead QR. */
function routeForOutcome(navigation: Nav, outcome: PaymentOutcome, orderRef: OrderReference) {
  if (outcome === 'PAID') navigation.replace('PaySuccess', orderRef);
  else if (outcome === 'EXPIRED') navigation.replace('PayExpired', orderRef);
  else if (outcome === 'FAILED') navigation.replace('PayFailed', orderRef);
  else if (outcome === 'CLOSED' && orderRef.orderId) navigation.replace('OrderDetail', { orderId: orderRef.orderId });
}

function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso) - Date.now();
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 1000));
}

/**
 * 12 พร้อมเพย์ QR.
 *
 * Shows the provider's real QR and the amount the server will charge, both
 * from `POST /orders/:id/payment`, and the fee breakdown from the order row
 * itself — never the design's sample figures. The countdown runs to BANHAO's
 * own attempt expiry (`expiresAt`). While it is open the screen watches the
 * order, and moves on by itself once the server records the payment.
 */
export function PromptPayQrScreen() {
  const navigation = useNavigation<Nav>();
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PromptPayQr'>>());
  const { orderId } = orderRef;

  const payment = useAsyncData(
    () => (orderId ? repositories.payments.startPayment(orderId) : Promise.reject(new Error('NO_ORDER'))),
    [orderId],
  );
  const order = useAsyncData(
    () => (orderId ? repositories.orderDetail.getOrder(orderId) : Promise.resolve(null)),
    [orderId],
  );

  const expiresAt = payment.status === 'success' ? payment.data.expiresAt : null;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) return undefined;
    setSecondsLeft(secondsUntil(expiresAt));
    const timer = setInterval(() => setSecondsLeft(secondsUntil(expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    // The attempt has expired, so the code cannot be paid. This decides
    // nothing about money; it stops showing a QR that no longer works.
    if (secondsLeft === 0) navigation.replace('PayExpired', orderRef);
    // orderRef is rebuilt every render; the ids inside it are what matter.
  }, [secondsLeft, navigation, orderRef.orderId, orderRef.orderNumber]);

  usePaymentOutcome(orderId, (outcome) => routeForOutcome(navigation, outcome, orderRef));

  useEffect(() => {
    if (payment.status === 'error' && isRefusal(payment.message, 'ALREADY_PAID')) {
      navigation.replace('PayDuplicate', orderRef);
    }
  }, [payment.status]);

  if (payment.status === 'loading') {
    return (
      <Screen testID="screen-promptpay-qr">
        <StateView kind="loading" title="กำลังสร้าง QR" testID="state-qr-loading" />
      </Screen>
    );
  }

  if (payment.status === 'error') {
    return <PaymentStartFailure message={payment.message} orderId={orderId} onRetry={payment.reload} />;
  }

  const minutes = Math.floor((secondsLeft ?? 0) / 60);
  const seconds = String((secondsLeft ?? 0) % 60).padStart(2, '0');
  const detail = order.status === 'success' ? order.data : null;

  return (
    <Screen
      scroll
      testID="screen-promptpay-qr"
      footer={
        <BottomBar>
          <Button
            label="ฉันชำระเงินแล้ว"
            onPress={() => navigation.navigate('PayChecking', orderRef)}
            testID="button-paid"
          />
          <Button label="ยกเลิก" variant="ghost" onPress={() => navigation.goBack()} />
        </BottomBar>
      }
    >
      <SectionHeader title="สแกนเพื่อจ่าย" />

      <Card style={styles.qrCard}>
        {payment.data.qrImageUrl ? (
          <Image
            source={{ uri: payment.data.qrImageUrl }}
            style={styles.qrImage}
            resizeMode="contain"
            accessibilityLabel="QR พร้อมเพย์"
            testID="qr-image"
          />
        ) : null}

        <Text style={styles.amount} testID="qr-amount">
          {formatBaht(payment.data.amountSatang)}
        </Text>
        {secondsLeft !== null ? (
          <Text style={styles.countdown}>
            QR หมดอายุใน {minutes}:{seconds}
          </Text>
        ) : null}
      </Card>

      {detail ? (
        <Card testID="qr-breakdown">
          <PriceRow label="ราคาอาหาร" amount={formatBaht(detail.subtotalSatang)} />
          <PriceRow label="ค่าส่ง" amount={formatBaht(detail.deliveryFeeSatang)} />
          <PriceRow label="ค่าบริการ" amount={formatBaht(detail.serviceFeeSatang)} />
          <View style={styles.divider} />
          <PriceRow label="รวมทั้งหมด" amount={formatBaht(detail.grandTotalSatang)} emphasis />
        </Card>
      ) : null}

      <Text style={styles.hint}>
        เปิดแอปธนาคาร → สแกน QR → ยืนยันการโอน{'\n'}
        ระบบจะยืนยันให้อัตโนมัติเมื่อได้รับเงิน
      </Text>
    </Screen>
  );
}

/**
 * `useAsyncData` keeps only an error's message, and a `PaymentStartError`'s
 * message is its refusal code, so the refusal is read back from there.
 */
function isRefusal(message: string, refusal: PaymentStartRefusal): boolean {
  return message === refusal;
}

/** Why the QR could not be shown, worded for what the customer can do about it. */
function PaymentStartFailure({
  message,
  orderId,
  onRetry,
}: {
  message: string;
  orderId: string | undefined;
  onRetry: () => void;
}) {
  const navigation = useNavigation<Nav>();

  if (isRefusal(message, 'EMAIL_REQUIRED')) {
    return (
      <Screen testID="screen-promptpay-qr">
        <StateView
          kind="info"
          title="ใส่อีเมลสำหรับชำระเงินก่อน"
          message="ผู้ให้บริการชำระเงินต้องใช้อีเมลของคุณ ใส่ได้ที่หน้าบัญชี"
          actionLabel="ไปที่บัญชี"
          onAction={() => navigation.navigate('Tabs', { screen: 'Profile' })}
          testID="state-qr-email-required"
        />
      </Screen>
    );
  }

  if (isRefusal(message, 'NOT_PAYABLE') || !orderId) {
    return (
      <Screen testID="screen-promptpay-qr">
        <StateView
          kind="info"
          title="ออเดอร์นี้ชำระเงินไม่ได้แล้ว"
          message="ดูสถานะออเดอร์ได้ที่หน้าออเดอร์"
          actionLabel="ดูออเดอร์"
          onAction={() =>
            orderId ? navigation.replace('OrderDetail', { orderId }) : navigation.navigate('Tabs', { screen: 'Orders' })
          }
          testID="state-qr-not-payable"
        />
      </Screen>
    );
  }

  if (isRefusal(message, 'ALREADY_PAID')) {
    // The effect in PromptPayQrScreen is moving to PayDuplicate.
    return (
      <Screen testID="screen-promptpay-qr">
        <StateView kind="loading" title="กำลังตรวจสอบการชำระเงิน" />
      </Screen>
    );
  }

  const presentation = presentLoadError(message);
  return (
    <Screen testID="screen-promptpay-qr">
      <StateView
        kind="error"
        glyph={presentation.glyph}
        title={presentation.title}
        actionLabel={presentation.actionLabel}
        onAction={onRetry}
        testID="state-qr-error"
      />
    </Screen>
  );
}

/**
 * 12b กำลังตรวจสอบ — waiting for the server.
 *
 * Re-reads the order until the provider's webhook has moved it (CON-002), then
 * moves on. There is no button that decides the outcome, and no timeout: a
 * payment the bank is still processing is still pending, and the order's own
 * expiry is the server's to apply.
 */
export function PayCheckingScreen() {
  const navigation = useNavigation<Nav>();
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PayChecking'>>());

  usePaymentOutcome(orderRef.orderId, (outcome) => routeForOutcome(navigation, outcome, orderRef));

  return (
    <Screen
      testID="screen-pay-checking"
      footer={
        <BottomBar>
          <Button label="กลับไปหน้า QR" variant="ghost" onPress={() => navigation.goBack()} />
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
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PaySuccess'>>());

  return (
    <Screen
      testID="screen-pay-success"
      footer={
        <BottomBar>
          <Button
            label="ดูออเดอร์"
            onPress={() => navigation.navigate('OrderConfirmed', orderRef)}
          />
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
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PayFailed'>>());

  return (
    <Screen
      testID="screen-pay-failed"
      footer={
        <BottomBar>
          <Button label="ลองจ่ายอีกครั้ง" onPress={() => navigation.replace('PromptPayQr', orderRef)} />
          {/*
            Was `เปลี่ยนเป็นเงินสด`. DEC-016 disables Cash on Delivery in
            Phase 1, so a failed online payment must not offer cash as an
            alternative.

            The design canvas's own copy for this slot — `เปลี่ยนวิธีชำระเงิน`
            — cannot be used either: after DEC-016 there is no second payment
            method to change to. The Product Owner resolved that gap and
            approved `กลับไปแก้ออเดอร์` as the replacement copy for the
            unchanged `goCheckout` action, keeping the canvas's bordered
            secondary treatment for the slot.
          */}
          <Button
            label="กลับไปแก้ออเดอร์"
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
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PayExpired'>>());

  return (
    <Screen
      testID="screen-pay-expired"
      footer={
        <BottomBar>
          <Button label="ขอ QR ใหม่" onPress={() => navigation.replace('PromptPayQr', orderRef)} />
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
  const orderRef = useOrderReference(useRoute<RouteProp<CustomerStackParamList, 'PayDuplicate'>>());

  return (
    <Screen
      testID="screen-pay-duplicate"
      footer={
        <BottomBar>
          <Button
            label="ดูออเดอร์"
            onPress={() => navigation.navigate('OrderConfirmed', orderRef)}
          />
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
  const { subtotalSatang } = useCart();
  const totals = calculateTotals(subtotalSatang);

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
  const { subtotalSatang } = useCart();
  const totals = calculateTotals(subtotalSatang);

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
  qrImage: { width: 220, height: 220, borderRadius: radius.lg, backgroundColor: colors.surface },
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
