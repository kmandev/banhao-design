import { useCallback } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  Card,
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
import { presentLoadError } from '../lib/loadError';
import { formatBaht } from '../lib/money';
import { formatOrderPlacedAt, orderStateLabel } from '../lib/orderDisplay';
import type { CustomerStackParamList } from '../navigation/types';
import { repositories } from '../repositories';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type TrackRoute = RouteProp<CustomerStackParamList, 'OrderTracking'>;

/**
 * C-14 ติดตามออเดอร์ — a direct, RLS-scoped Supabase read.
 *
 * The order row is the source of the current state; the timeline contains
 * only rows already recorded in `order_status_history`. There is deliberately
 * no local state machine, ETA, rider data, map, transition, subscription, or
 * polling loop here. The database may currently have only `CREATED`; its
 * approved customer label is intentionally absent (UX-SPEC §10), so the
 * screen omits that unsupported label rather than leaking the identifier or
 * inventing copy.
 */
export function OrderTrackingScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<TrackRoute>();
  const load = useCallback(
    () => repositories.orderDetail.getOrder(params.orderId),
    [params.orderId],
  );
  const state = useAsyncData(load, [params.orderId]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-order-tracking-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    const presentation = presentLoadError(state.message);
    return (
      <Screen testID="screen-order-tracking-error">
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
      <Screen testID="screen-order-tracking-not-found">
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
  const currentStateLabel = orderStateLabel(order.state);
  const timelineSteps = order.statusHistory.flatMap((event) => {
    const label = orderStateLabel(event.toState);
    if (!label) return [];

    return [{
      label,
      caption: formatOrderPlacedAt(event.occurredAt) ?? undefined,
      // A timeline row is only rendered when it was actually recorded. The
      // current-state highlight compares server facts; it does not infer a
      // missing transition or manufacture future steps.
      done: event.toState !== order.state,
      active: event.toState === order.state,
    }];
  });

  return (
    <Screen scroll testID="screen-order-tracking">
      <Card style={styles.summary}>
        {/*
          UX-SPEC §5: on C-14 the current state is "in plain Thai as the
          largest text on screen" — so it is a headline here, not the small
          `Badge` C-16/C-19 use. Omitted entirely when §10 gives the state no
          approved wording; nothing substitutes for it.
        */}
        {currentStateLabel ? (
          <Text style={styles.stateHeadline} testID="tracking-state">
            {currentStateLabel}
          </Text>
        ) : null}
        {/*
          The preparation-time caption, in one slot with one number
          (M-AV design, AV-D03: the customer sees one estimate, never a
          before/after pair).

          The merchant's own answer for this order wins once it exists
          (M-05 §08, `orders.prep_minutes`) — it is the more specific fact,
          and it is what the kitchen actually committed to. Before the
          merchant has accepted there is no such answer, so the caption
          falls back to the estimate the customer was shown when they placed
          the order (AC-04 / DEC-042, `orders.customer_quoted_prep_minutes`),
          which is a snapshot on this order and never a live read of the
          restaurant's current mode. Both are omitted when null: an order
          accepted before M-05 shipped, or placed before AC-04 shipped, has
          none, and inventing one would be fabricating a fact nobody stated.

          "ประมาณ" is load-bearing on both. Neither is an ETA and neither may
          become one — no countdown, no arithmetic against the delivery time,
          no clock time, and never a live `restaurants.avg_prep_minutes`,
          which the catalog mappers already refuse to derive an ETA from.
        */}
        {order.prepMinutes !== null ? (
          <Text style={styles.prepCaption} testID="tracking-prep-minutes">
            ร้านใช้เวลาทำอาหารประมาณ {order.prepMinutes} นาที
          </Text>
        ) : order.customerQuotedPrepMinutes !== null ? (
          <Text style={styles.prepCaption} testID="tracking-quoted-prep-minutes">
            เวลาทำอาหารประมาณ {order.customerQuotedPrepMinutes} นาที
          </Text>
        ) : null}
        <Text style={styles.orderId} testID="tracking-order-id">
          #{order.orderNumber}
        </Text>
        <View style={styles.summaryFooter}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.restaurantNameSnapshot}
          </Text>
          <Text style={styles.total}>{formatBaht(order.grandTotalSatang)}</Text>
        </View>
      </Card>

      {/*
        The section is omitted entirely when nothing in the recorded history
        has approved customer copy — today that is every order, because
        `create_order()` writes only `CREATED` and UX-SPEC §10 gives `CREATED`
        no wording ("transient — no screen"). Omitting follows the precedent
        `OrdersScreen` sets for the state badge and `OrderDetailScreen` sets
        for the landmark line: the design supplies no empty-history copy for
        C-14, and §10 forbids inventing one or leaking the identifier.
      */}
      {timelineSteps.length > 0 ? (
        <>
          <SectionHeader title="สถานะออเดอร์" />
          <Card testID="tracking-status-timeline">
            <StatusTimeline steps={timelineSteps} />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs },
  /** The design's tracking headline is 25px; `h1` (26) is the nearest token. */
  stateHeadline: {
    fontSize: fontSize.h1,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  prepCaption: { fontSize: fontSize.md, fontFamily: fontFamily.medium, color: colors.textMuted },
  orderId: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textSubtle },
  summaryFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  shopName: { flex: 1, fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  total: { fontSize: fontSize.lg, fontFamily: fontFamily.bold, color: colors.textPrimary },
});
