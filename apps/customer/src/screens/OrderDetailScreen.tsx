import { useCallback } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  ListRow,
  PriceRow,
  SectionHeader,
  StateView,
  StatusTimeline,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import { formatBaht } from '../lib/money';
import { presentLoadError } from '../lib/loadError';
import type { OrderState } from '../domain/order';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type DetailRoute = RouteProp<CustomerStackParamList, 'OrderDetail'>;

/**
 * Real order detail (Phase E-3B.1) — a new screen, not a rewiring of the
 * design's screen 14 (`OrderTrackingScreen`).
 *
 * `OrderTrackingScreen` is built entirely around the design's mock 12-state
 * machine (`NEW`/`ACCEPTED`/`READY`/`DRIVER_ASSIGNED`/`COMPLETED`/
 * `NO_DRIVER`) and a hand-authored ETA string — CLAUDE.md forbids those state
 * names in new work, and it carries none of the items/options/money data this
 * task requires (docs/CUSTOMER_APP_IMPLEMENTATION_MAP.md lists no design
 * screen for an itemised historical order). Rewriting it to serve both the
 * old mock flow and this one would be exactly the "broadly rewritten
 * architecture" the brief says to stop for; adding a screen composed only of
 * already-approved primitives (`Card`, `SectionHeader`, `StatusTimeline`,
 * `PriceRow`, `ListRow`, `StateView`) is the smaller, safer change.
 *
 * State labels are the approved customer-facing copy from
 * `docs/design/BANHAO-UX-SPEC-V1.md` §10 ("One state value, four
 * vocabularies") — transcribed, not invented. `CREATED` has no copy there
 * ("transient — no screen"); it is included anyway because a customer can
 * still land here in the instant before the first real transition, and a
 * blank state would be worse.
 *
 * **Not wired from any existing screen.** `PromptPayQrScreen` and
 * `OrderConfirmedScreen` are both design-locked (CLAUDE.md: "the design
 * artifact is the source of truth… do not re-design"), and the design's own
 * footer for the QR screen has exactly two buttons. Reachable today by
 * `navigation.navigate('OrderDetail', { orderId })` and by direct test
 * rendering; wiring a tap-through is left for whoever resolves that design
 * question, not guessed here.
 */

const ORDER_STATE_LABEL: Record<OrderState, string> = {
  CREATED: 'กำลังสร้างออเดอร์',
  PENDING_PAYMENT: 'รอชำระเงิน',
  PAID: 'ส่งให้ร้านแล้ว · รอร้านรับออเดอร์',
  MERCHANT_ACCEPTED: 'ร้านรับออเดอร์แล้ว',
  PREPARING: 'ร้านกำลังทำอาหาร',
  READY_FOR_PICKUP: 'อาหารพร้อมแล้ว',
  PICKED_UP: 'ไรเดอร์รับอาหารแล้ว',
  DELIVERING: 'กำลังไปส่ง',
  DELIVERED: 'จัดส่งสำเร็จ',
  CANCELLED: 'ออเดอร์ถูกยกเลิก',
  // Exception states remain PROPOSED (docs/ORDER_LIFECYCLE.md §3) — the
  // customer-facing copy for these three is not yet approved anywhere, so
  // the state name is what renders rather than a fabricated phrase.
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  MERCHANT_REJECTED: 'MERCHANT_REJECTED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
};

export function OrderDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<DetailRoute>();

  const load = useCallback(
    () => repositories.orderDetail.getOrder(params.orderId),
    [params.orderId],
  );
  const state = useAsyncData(load, [params.orderId]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-order-detail-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    const presentation = presentLoadError(state.message);
    return (
      <Screen testID="screen-order-detail-error">
        <StateView
          kind="error"
          glyph={presentation.glyph}
          title={presentation.title}
          actionLabel={presentation.actionLabel}
          onAction={state.reload}
        />
      </Screen>
    );
  }

  if (!state.data) {
    return (
      <Screen testID="screen-order-detail-not-found">
        <StateView
          kind="empty"
          glyph="🧾"
          title="ไม่พบออเดอร์นี้"
          actionLabel="กลับ"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const order = state.data;
  const timelineSteps = order.statusHistory.map((event, i) => ({
    label: ORDER_STATE_LABEL[event.toState] ?? event.toState,
    caption: event.reason ?? undefined,
    done: i < order.statusHistory.length - 1,
    active: i === order.statusHistory.length - 1,
  }));

  return (
    <Screen
      scroll
      testID="screen-order-detail"
      footer={
        <BottomBar>
          <Button label="โหลดสถานะล่าสุด" variant="ghost" onPress={state.reload} testID="button-refresh-order" />
        </BottomBar>
      }
    >
      <Card style={styles.summary}>
        <Text style={styles.orderNumber}>ออเดอร์ #{order.orderNumber}</Text>
        <Text style={styles.stateLabel}>{ORDER_STATE_LABEL[order.state] ?? order.state}</Text>
      </Card>

      <SectionHeader title="สถานะออเดอร์" />
      <Card>
        {timelineSteps.length > 0 ? (
          <StatusTimeline steps={timelineSteps} />
        ) : (
          <Text style={styles.empty}>ยังไม่มีประวัติสถานะ</Text>
        )}
      </Card>

      <SectionHeader title="รายการอาหาร" />
      <Card style={styles.items}>
        {order.items.map((item) => (
          <ListRow
            key={item.id}
            testID={`order-item-${item.id}`}
            title={`${item.nameSnapshot} × ${item.quantity}`}
            subtitle={
              item.options.length > 0
                ? item.options.map((o) => o.optionNameSnapshot).join(', ')
                : undefined
            }
            trailing={formatBaht(item.lineTotalSatang)}
          />
        ))}
      </Card>

      <SectionHeader title="ที่อยู่จัดส่ง" />
      <Card style={styles.address}>
        <Text style={styles.recipient}>{order.recipientNameSnapshot}</Text>
        <Text style={styles.phone}>{order.recipientPhoneSnapshot}</Text>
        <Text style={styles.addressLine}>{order.deliveryAddressSnapshot}</Text>
      </Card>

      <SectionHeader title="สรุปยอด" />
      <Card>
        <PriceRow label="ราคาอาหาร" amount={formatBaht(order.subtotalSatang)} />
        <PriceRow label="ค่าส่ง" amount={formatBaht(order.deliveryFeeSatang)} />
        <PriceRow label="ค่าบริการ" amount={formatBaht(order.serviceFeeSatang)} />
        {order.discountSatang > 0 ? (
          <PriceRow label="ส่วนลด" amount={`-${formatBaht(order.discountSatang)}`} discount />
        ) : null}
        <View style={styles.divider} />
        <PriceRow label="รวมทั้งหมด" amount={formatBaht(order.grandTotalSatang)} emphasis />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs },
  orderNumber: { fontSize: fontSize.xl, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  stateLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  empty: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  items: { gap: spacing.sm },
  address: { gap: 2 },
  recipient: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  phone: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  addressLine: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
