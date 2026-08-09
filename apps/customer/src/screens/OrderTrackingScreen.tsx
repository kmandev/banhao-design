import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  SectionHeader,
  StateView,
  StatusTimeline,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import type { OrderState } from '../mocks/types';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type TrackRoute = RouteProp<CustomerStackParamList, 'OrderTracking'>;

/**
 * The happy-path order states in order, with the customer-facing wording from
 * the Order State Machine table in docs/ARCHITECTURE.md.
 */
const TRACKING_STEPS: { state: OrderState; label: string; caption?: string }[] = [
  { state: 'NEW', label: 'ส่งออเดอร์ให้ร้านแล้ว' },
  { state: 'ACCEPTED', label: 'ร้านรับออเดอร์แล้ว' },
  { state: 'PREPARING', label: 'ร้านกำลังเตรียมอาหาร' },
  { state: 'READY', label: 'อาหารพร้อมแล้ว' },
  { state: 'DRIVER_ASSIGNED', label: 'ไรเดอร์กำลังไปรับอาหาร' },
  { state: 'DELIVERING', label: 'อาหารกำลังเดินทางมาหาคุณ' },
  { state: 'COMPLETED', label: 'ส่งสำเร็จ' },
];

/**
 * 14 ติดตามออเดอร์, plus two state variants from the design:
 *   🛵 ไม่มีไรเดอร์  → NO_DRIVER
 *   🚫 ออเดอร์ถูกยกเลิก → CANCELLED
 */
export function OrderTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<TrackRoute>();
  const state: OrderState = params?.state ?? 'DELIVERING';

  if (state === 'NO_DRIVER') {
    return (
      <Screen
        testID="screen-tracking-no-driver"
        footer={
          <BottomBar>
            <Button label="รอต่ออีกสักครู่" onPress={() => navigation.goBack()} />
            <Button label="ยกเลิกออเดอร์" variant="ghost" onPress={() => navigation.goBack()} />
          </BottomBar>
        }
      >
        <StateView
          kind="info"
          glyph="🛵"
          title="ยังหาไรเดอร์ไม่ได้"
          message="ตอนนี้ไรเดอร์ในพื้นที่ไม่ว่าง เรากำลังหาให้อยู่ ถ้ายกเลิกจะคืนเงินเต็มจำนวน"
          testID="state-no-driver"
        />
      </Screen>
    );
  }

  if (state === 'CANCELLED') {
    return (
      <Screen
        testID="screen-tracking-cancelled"
        footer={
          <BottomBar>
            <Button label="สั่งใหม่อีกครั้ง" onPress={() => navigation.navigate('Tabs')} />
            <Button
              label="ดูการคืนเงิน"
              variant="ghost"
              onPress={() => navigation.navigate('Refund')}
            />
          </BottomBar>
        }
      >
        <StateView
          kind="info"
          glyph="🚫"
          title="ออเดอร์ถูกยกเลิก"
          message="ออเดอร์นี้ถูกยกเลิกแล้ว หากชำระเงินไว้ ระบบจะดำเนินการคืนเงินให้"
          testID="state-cancelled"
        />
      </Screen>
    );
  }

  const currentIndex = TRACKING_STEPS.findIndex((s) => s.state === state);
  const steps = TRACKING_STEPS.map((step, i) => ({
    label: step.label,
    caption: step.caption,
    done: i < currentIndex,
    active: i === currentIndex,
  }));

  return (
    <Screen
      scroll
      testID="screen-order-tracking"
      footer={
        <BottomBar>
          <Button
            label="ให้คะแนนออเดอร์นี้"
            variant="secondary"
            onPress={() => navigation.navigate('Rating', { orderId: params?.orderId })}
            testID="button-rate-order"
          />
        </BottomBar>
      }
    >
      {/*
        Map placeholder. The tracking map prototype in design/tracking/ uses
        Leaflet with mock coordinates; a real map needs a provider decision
        (Q-018 — rural Buntharik coverage is unverified). See
        docs/CUSTOMER_APP_ASSETS.md.
      */}
      <View style={styles.map} accessibilityLabel="แผนที่ติดตามออเดอร์ (ตัวอย่าง)">
        <Text style={styles.mapGlyph}>🗺️</Text>
        <Text style={styles.mapNote}>แผนที่ตัวอย่าง — ยังไม่ได้เชื่อมผู้ให้บริการแผนที่</Text>
      </View>

      <Card style={styles.summary}>
        <Text style={styles.orderId}>ออเดอร์ #{params?.orderId ?? 'BH000125'}</Text>
        <Text style={styles.eta}>ถึงประมาณ 19:05 น.</Text>
      </Card>

      <SectionHeader title="สถานะออเดอร์" />
      <Card>
        <StatusTimeline steps={steps} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 180,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  mapGlyph: { fontFamily: fontFamily.regular, fontSize: 48 },
  mapNote: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  summary: { gap: spacing.xs },
  orderId: { fontSize: fontSize.xl, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  eta: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
});
