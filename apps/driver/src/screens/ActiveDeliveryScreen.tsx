import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, colors, fontFamily, fontSize, radius, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useActiveDelivery } from '../hooks/useActiveDelivery';
import { DELIVERY_STEPS, currentStep } from '../domain/riderDelivery';
import type { RiderActiveDelivery } from '../domain/riderDelivery';
import type { RiderOrderDetail } from '../domain/riderOrder';
import type { RiderStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RiderStackParamList>;

/**
 * R-06 งานที่กำลังทำ — the rider's active delivery (Phase G-7.2).
 *
 * The screen the approved Driver App redesign marks as `FUTURE · G-7.2` and
 * deliberately did not draw further, because "three of the four transitions
 * have endpoints today; the fourth does not" (DG-04). Both halves of DG-04 are
 * now closed: `POST /rider/deliveries/:id/delivered` exists, and the delivery
 * id and state are read from `deliveries` under the existing
 * `deliveries_select_rider` policy rather than from `rider_order_view`, which
 * projects neither.
 *
 * ## The four steps
 *
 * `DELIVERY_STEPS` is the single source of both the progression list and the
 * primary action, so a state can never render a step number that disagrees
 * with the button beneath it. The button calls the API command for the step
 * the **server's** state says the rider is on — `currentStep(delivery.state)`,
 * never a locally advanced counter.
 *
 * ## The fourth step goes through POD
 *
 * Steps 1–3 call their API command directly. Step 4 does **not**: a completion
 * requires a proof photo (DEC-038, resolving BQ-018 as mandatory), so
 * `ส่งสำเร็จ` navigates into `ProofCamera` and the POD leg owns capture,
 * upload and confirmation from there. This screen never calls
 * `markDelivered` — `useActiveDelivery.runStep` cannot even express it.
 *
 * A rider who abandons the POD leg comes back to this screen with the delivery
 * exactly as it was: still `EN_ROUTE`, still theirs, still open.
 *
 * ## What is deliberately not here
 *
 * **No money** — BQ-029 is `OPEN` and every rider domain type in this app
 * is money-free. **No map** — `deliveryAddressSnapshot` and `deliveryLandmark`
 * are what the rider navigates by, and no map library exists in this app. **No
 * cancel/release control** — that is `POST /deliveries/:id/cancel`, DEC-021,
 * and it has no approved rider-facing copy yet. **No customer phone action** —
 * the number is displayed (it is in `rider_order_view`), but a dialer intent is
 * not wired in this slice.
 */
export function ActiveDeliveryScreen() {
  const navigation = useNavigation<Nav>();
  const { view, refresh, busy, actionError, runStep } = useActiveDelivery();

  return (
    <Screen scroll testID="screen-active-delivery">
      <View style={styles.header}>
        <Text style={styles.title}>งานที่กำลังทำ</Text>
      </View>

      {actionError ? (
        <Text style={styles.actionError} testID="delivery-action-error">
          {actionError}
        </Text>
      ) : null}

      {view.status === 'loading' ? (
        <View style={styles.centred} testID="active-delivery-loading">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>กำลังโหลดงานที่กำลังทำ…</Text>
        </View>
      ) : null}

      {view.status === 'error' ? (
        <View style={styles.centred} testID="active-delivery-error">
          <Text style={styles.errorTitle}>โหลดงานที่กำลังทำไม่สำเร็จ</Text>
          <Text style={styles.muted}>{view.message}</Text>
          <Button label="ลองอีกครั้ง" onPress={refresh} testID="button-retry-active-delivery" />
        </View>
      ) : null}

      {view.status === 'empty' ? (
        <View style={styles.centred} testID="active-delivery-empty">
          <Text style={styles.errorTitle}>ไม่มีงานที่กำลังทำ</Text>
          <Text style={styles.muted}>เมื่อคุณรับงานจากหน้างานที่เสนอ งานจะแสดงที่นี่</Text>
          <Button label="รีเฟรช" variant="ghost" onPress={refresh} testID="button-refresh-active-delivery" />
        </View>
      ) : null}

      {view.status === 'ready' ? (
        <ActiveDeliveryBody
          delivery={view.delivery}
          order={view.order}
          busy={busy}
          onStep={(action) => {
            // Step 4 needs a photo, so it opens the POD leg rather than
            // calling the API — see this file's header.
            if (action === 'delivered') {
              navigation.navigate('ProofCamera', { deliveryId: view.delivery.deliveryId });
              return;
            }
            void runStep(view.delivery.deliveryId, action);
          }}
        />
      ) : null}
    </Screen>
  );
}

function ActiveDeliveryBody({
  delivery,
  order,
  busy,
  onStep,
}: {
  delivery: RiderActiveDelivery;
  order: RiderOrderDetail | null;
  busy: boolean;
  onStep: (action: import('../domain/riderDelivery').DeliveryAction) => void;
}) {
  const step = currentStep(delivery.state);

  return (
    <View style={styles.body} testID="active-delivery-body">
      <View style={styles.card}>
        <Text style={styles.cardTitle} testID="delivery-step-title">
          {step ? `ขั้นที่ ${step.index} จาก ${DELIVERY_STEPS.length} · ${step.title}` : 'กำลังจัดสรรงานใหม่'}
        </Text>
        <Text style={styles.cardDetail} testID="delivery-state">
          สถานะงาน {delivery.state}
        </Text>
        {order ? (
          <Text style={styles.cardDetail} testID="delivery-order-number">
            ออเดอร์ {order.orderNumber}
          </Text>
        ) : null}
      </View>

      <View style={styles.card} testID="delivery-steps">
        {DELIVERY_STEPS.map((s) => (
          <Text
            key={s.action}
            style={[
              styles.stepRow,
              step && s.index < step.index ? styles.stepDone : null,
              step && s.index === step.index ? styles.stepCurrent : null,
            ]}
            testID={`delivery-step-${s.action}`}
          >
            {s.index}. {s.title}
          </Text>
        ))}
      </View>

      {order ? (
        <View style={styles.card} testID="delivery-dropoff">
          <Text style={styles.sectionLabel}>จุดส่ง</Text>
          <Text style={styles.metaValue}>{order.recipientNameSnapshot}</Text>
          <Text style={styles.cardDetail}>{order.deliveryAddressSnapshot}</Text>
          {order.deliveryLandmark ? (
            <Text style={styles.cardDetail}>จุดสังเกต: {order.deliveryLandmark}</Text>
          ) : null}
          <Text style={styles.cardDetail}>โทร {order.recipientPhoneSnapshot}</Text>
          <Text style={styles.sectionLabel}>ร้าน</Text>
          <Text style={styles.cardDetail}>{order.restaurantNameSnapshot}</Text>
        </View>
      ) : (
        // Stated rather than faked — the redesign's DD-04. No placeholder
        // address, no dash.
        <Text style={styles.muted} testID="delivery-order-unavailable">
          ยังโหลดรายละเอียดร้านและจุดส่งไม่ได้ กดรีเฟรชเพื่อลองอีกครั้ง
        </Text>
      )}

      {step ? (
        <Button
          label={step.label}
          loading={busy}
          onPress={() => onStep(step.action)}
          testID={`button-delivery-${step.action}`}
        />
      ) : (
        <Text style={styles.muted} testID="delivery-no-action">
          งานนี้กำลังถูกจัดสรรใหม่ ยังทำรายการต่อไม่ได้
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.sm, gap: spacing.sm },
  title: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
  body: { gap: spacing.md },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  muted: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.xl, color: colors.textPrimary },
  actionError: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.md,
    color: colors.danger,
    paddingHorizontal: spacing.xs,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  cardTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.lg, color: colors.textPrimary },
  cardDetail: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  sectionLabel: { fontFamily: fontFamily.medium, fontSize: fontSize.sm, color: colors.textSubtle },
  metaValue: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  stepRow: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  stepDone: { color: colors.textSubtle },
  stepCurrent: { fontFamily: fontFamily.semibold, color: colors.textPrimary },
  completed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  completedMark: { fontSize: fontSize.h1, fontFamily: fontFamily.bold, color: colors.primary },
  completedTitle: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
});
