import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Card,
  SectionHeader,
  StateView,
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  type BadgeTone,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import { formatBaht } from '../mocks/pricing';
import type { OrderState } from '../mocks/types';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * Customer-facing wording for each order state, taken from the Order State
 * Machine table in docs/ARCHITECTURE.md (the "ลูกค้าเห็น" column). The customer
 * never sees the raw state name.
 */
const ORDER_STATE_LABEL: Record<OrderState, { text: string; tone: BadgeTone }> = {
  NEW: { text: 'ส่งออเดอร์ให้ร้านแล้ว', tone: 'neutral' },
  ACCEPTED: { text: 'ร้านรับออเดอร์แล้ว', tone: 'warning' },
  PREPARING: { text: 'ร้านกำลังเตรียมอาหาร', tone: 'warning' },
  READY: { text: 'อาหารพร้อมแล้ว', tone: 'success' },
  DRIVER_ASSIGNED: { text: 'ไรเดอร์กำลังไปรับอาหาร', tone: 'primary' },
  PICKED_UP: { text: 'ไรเดอร์รับอาหารแล้ว', tone: 'primary' },
  DELIVERING: { text: 'อาหารกำลังเดินทางมาหาคุณ', tone: 'primary' },
  COMPLETED: { text: 'ส่งสำเร็จ', tone: 'success' },
  NO_DRIVER: { text: 'ยังหาไรเดอร์ไม่ได้', tone: 'warning' },
  PAYMENT_FAILED: { text: 'ชำระเงินไม่สำเร็จ', tone: 'warning' },
  REJECTED: { text: 'ร้านไม่สามารถรับออเดอร์ได้', tone: 'neutral' },
  CANCELLED: { text: 'ออเดอร์ถูกยกเลิก', tone: 'neutral' },
};

/** 16 ออเดอร์ของฉัน. */
export function OrdersScreen() {
  const navigation = useNavigation<Nav>();
  const state = useAsyncData(() => repositories.orders.listOrders());

  return (
    <Screen scroll testID="screen-orders">
      <SectionHeader title="ออเดอร์ของฉัน" />

      {state.status === 'loading' ? (
        <StateView kind="loading" title="กำลังโหลด…" />
      ) : state.status === 'error' ? (
        <StateView
          kind="error"
          glyph="📡"
          title="โหลดออเดอร์ไม่สำเร็จ"
          message={state.message}
          actionLabel="ลองใหม่"
          onAction={state.reload}
        />
      ) : state.data.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🧾"
          title="ยังไม่มีออเดอร์"
          message="เมื่อคุณสั่งอาหาร ออเดอร์จะแสดงที่นี่"
          testID="state-orders-empty"
        />
      ) : (
        state.data.map((order) => {
          const label = ORDER_STATE_LABEL[order.orderState];
          return (
            <Card
              key={order.id}
              onPress={() =>
                navigation.navigate('OrderTracking', {
                  orderId: order.id,
                  state: order.orderState,
                })
              }
              testID={`order-card-${order.id}`}
              style={styles.card}
            >
              <View style={styles.row}>
                <View style={styles.thumb}>
                  <Text style={styles.glyph}>{order.glyph}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.shop} numberOfLines={1}>
                    {order.shopName}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    #{order.id} · {order.placedAt}
                  </Text>
                  <Text style={styles.items} numberOfLines={1}>
                    {order.itemSummary}
                  </Text>
                </View>
                <Text style={styles.total}>{formatBaht(order.totalSatang)}</Text>
              </View>
              <View style={styles.footer}>
                <Badge label={label.text} tone={label.tone} />
                <Text style={styles.method}>
                  {order.paymentMethod === 'CASH' ? 'เงินสด' : 'พร้อมเพย์'}
                </Text>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 24 },
  body: { flex: 1, gap: 2 },
  shop: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  meta: { fontSize: fontSize.sm, color: colors.textSubtle },
  items: { fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textPrimary },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  method: { fontSize: fontSize.sm, color: colors.textMuted },
});
