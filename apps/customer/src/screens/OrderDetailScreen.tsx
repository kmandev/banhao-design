import { useCallback, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  BottomBar,
  Button,
  Card,
  ListRow,
  PriceRow,
  StateView,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import { formatBaht } from '../lib/money';
import { presentLoadError } from '../lib/loadError';
import { SHOP_PLACEHOLDER_GLYPH } from '../lib/catalogDisplay';
import {
  formatOrderPlacedAtLong,
  orderStateLabel,
  orderStateTone,
  paymentMethodDetailLabel,
} from '../lib/orderDisplay';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type DetailRoute = RouteProp<CustomerStackParamList, 'OrderDetail'>;

/**
 * C-19 รายละเอียดออเดอร์ — screen 19 of the design canvas
 * (`docs/design/BANHAO Customer App.dc.html`), reconciled against it in Phase
 * E-3B.4. Reached from C-16, which is the path every history card in that
 * canvas already specified (`go: go('orderDetail')`).
 *
 * Four cards, in the design's own order:
 *   1. state badge + `#orderNumber`, then shop glyph, name and placed-at
 *   2. `รายการอาหาร` — one row per line, `name ×qty` against its line total
 *   3. money — `ค่าอาหาร` / `ค่าส่ง` / `ค่าบริการ` / `ยอดรวม` / `ชำระโดย`
 *   4. `ที่อยู่จัดส่ง` — address, then `จุดสังเกต:` when one was recorded
 * and a `ให้คะแนนร้านนี้` primary action.
 *
 * Every Thai string here is transcribed from that canvas or from
 * `docs/design/BANHAO-UX-SPEC-V1.md` §10 (state copy, via `orderDisplay.ts`).
 * None is authored.
 *
 * ## No status timeline, deliberately
 *
 * The E-3B.1 version of this screen rendered `order_status_history` as a
 * `StatusTimeline`. Screen 19 has no timeline, and UX-SPEC §9.3's component
 * inventory assigns the Timeline to *"Customer tracking, admin order detail"* —
 * C-14 and A-04, not C-19. Two approved sources agree, so it is gone from
 * here. The data is still fetched and modelled (`OrderDetail.statusHistory`)
 * because C-14 needs exactly it once that screen is converted off its mock
 * states; that conversion is not this task.
 *
 * ## Proof of delivery (POD, Phase G7.4 / T3.4)
 *
 * A fifth card, shown only for a `DELIVERED` order with a photo on file. Its
 * fetch is deliberately independent of the main `orderDetail` load above —
 * `loadProof` below resolves to `null` without ever calling the repository
 * until the order is known to be `DELIVERED` — so a POD failure degrades only
 * that one card, never the receipt this screen exists to show. `null` (no
 * photo yet, retention lapsed, or the API's privacy-preserving `NOT_FOUND`;
 * see `apiDeliveryProof.ts`) is a normal outcome and renders nothing, per
 * UX-SPEC §10's "no state name, cause code, or error code is ever rendered to
 * a user" — the same discipline this screen already applies to order state.
 *
 * `photoLoadFailed` is shared by the thumbnail and the full-screen viewer —
 * one signed URL, one failure state. A URL that failed as a thumbnail would
 * fail identically full-screen, so there is no reason to track it twice; this
 * is also what stops the viewer from ever showing a silently blank image.
 */

export function OrderDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<DetailRoute>();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);

  const load = useCallback(
    () => repositories.orderDetail.getOrder(params.orderId),
    [params.orderId],
  );
  const state = useAsyncData(load, [params.orderId]);

  // Only set once the order is known to be DELIVERED — this is what keeps
  // the delivery-proof repository uncalled for every other state, rather than
  // called-and-then-ignored.
  const deliveredOrderId =
    state.status === 'success' && state.data?.state === 'DELIVERED' ? state.data.orderId : null;
  const loadProof = useCallback(
    () => (deliveredOrderId ? repositories.deliveryProof.getDeliveryProof(deliveredOrderId) : Promise.resolve(null)),
    [deliveredOrderId],
  );
  const podState = useAsyncData(loadProof, [deliveredOrderId]);

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
  const stateLabel = orderStateLabel(order.state);
  const placedAt = formatOrderPlacedAtLong(order.placedAt);
  const proof = podState.status === 'success' ? podState.data : null;
  const deliveredAt = proof ? formatOrderPlacedAtLong(proof.deliveredAt) : null;

  return (
    <>
      <Screen
        scroll
        testID="screen-order-detail"
        footer={
          // The design's primary action. Shown for a delivered order only: its
          // sample is a delivered one, and `OrderTrackingScreen` already
          // withholds its own rating action from cancelled orders, so this
          // follows shipped precedent rather than inventing a rule. No
          // substitute action is invented for the other states — the design
          // specifies none.
          order.state === 'DELIVERED' ? (
            <BottomBar>
              <Button
                label="ให้คะแนนร้านนี้"
                onPress={() => navigation.navigate('Rating', { orderId: order.orderId })}
                testID="button-rate-shop"
              />
            </BottomBar>
          ) : undefined
        }
      >
        <Card style={styles.summary}>
          <View style={styles.summaryTop}>
            {stateLabel ? <Badge label={stateLabel} tone={orderStateTone(order.state)} /> : null}
            <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
          </View>
          <View style={styles.shopRow}>
            <View style={styles.thumb}>
              <Text style={styles.glyph}>{SHOP_PLACEHOLDER_GLYPH}</Text>
            </View>
            <View style={styles.shopBody}>
              <Text style={styles.shopName} numberOfLines={1}>
                {order.restaurantNameSnapshot}
              </Text>
              {placedAt ? <Text style={styles.placedAt}>{placedAt}</Text> : null}
            </View>
          </View>
        </Card>

        <Card style={styles.items}>
          <Text style={styles.cardLabel}>รายการอาหาร</Text>
          {order.items.map((item) => (
            <ListRow
              key={item.id}
              testID={`order-item-${item.id}`}
              title={`${item.nameSnapshot} ×${item.quantity}`}
              subtitle={
                item.options.length > 0
                  ? item.options.map((option) => option.optionNameSnapshot).join(', ')
                  : undefined
              }
              trailing={formatBaht(item.lineTotalSatang)}
            />
          ))}
        </Card>

        <Card>
          <PriceRow label="ค่าอาหาร" amount={formatBaht(order.subtotalSatang)} />
          <PriceRow label="ค่าส่ง" amount={formatBaht(order.deliveryFeeSatang)} />
          <PriceRow label="ค่าบริการ" amount={formatBaht(order.serviceFeeSatang)} />
          {order.discountSatang > 0 ? (
            <PriceRow label="ส่วนลด" amount={`-${formatBaht(order.discountSatang)}`} discount />
          ) : null}
          <View style={styles.divider} />
          <PriceRow label="ยอดรวม" amount={formatBaht(order.grandTotalSatang)} emphasis />
          <View style={styles.paidWith}>
            <Text style={styles.paidWithLabel}>ชำระโดย</Text>
            <Text style={styles.paidWithValue}>{paymentMethodDetailLabel(order.paymentMethod)}</Text>
          </View>
        </Card>

        <Card style={styles.address}>
          <Text style={styles.cardLabel}>ที่อยู่จัดส่ง</Text>
          <Text style={styles.addressLine}>{order.deliveryAddressSnapshot}</Text>
          {order.deliveryLandmark ? (
            <Text style={styles.landmark}>จุดสังเกต: {order.deliveryLandmark}</Text>
          ) : null}
        </Card>

        {/*
          POD (Phase G7.4). Rendered only once a real photo has loaded — a
          `null` proof (not yet delivered, no photo, retention lapsed, or the
          API's own privacy-preserving NOT_FOUND) is a normal outcome and
          renders nothing, per UX-SPEC §10's "no state name, cause code, or
          error code is ever rendered to a user".
        */}
        {order.state === 'DELIVERED' && proof ? (
          <Card style={styles.pod} testID="pod-card">
            <Text style={styles.cardLabel}>หลักฐานการส่ง</Text>
            <Pressable
              testID="pod-thumbnail-button"
              onPress={() => setViewerOpen(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel="ดูรูปหลักฐานการส่งแบบเต็มจอ"
            >
              {photoLoadFailed ? (
                <View style={styles.podThumbFallback}>
                  <Text style={styles.podThumbFallbackText}>โหลดรูปไม่สำเร็จ</Text>
                </View>
              ) : (
                <Image
                  testID="pod-thumbnail"
                  source={{ uri: proof.photoUrl }}
                  style={styles.podThumb}
                  onError={() => setPhotoLoadFailed(true)}
                />
              )}
            </Pressable>
            {deliveredAt ? <Text style={styles.podTimestamp}>{deliveredAt}</Text> : null}
          </Card>
        ) : null}

        {/*
          A genuine POD fetch failure (network/API) — never rendered for the
          NOT_FOUND/no-photo case above, since that resolves to a `null` proof
          rather than an error (see `apiDeliveryProof.ts`). Scoped to this one
          card so the rest of the receipt stays visible either way.
        */}
        {order.state === 'DELIVERED' && podState.status === 'error' ? (
          <Card style={styles.pod} testID="pod-error-card">
            <Text style={styles.cardLabel}>หลักฐานการส่ง</Text>
            <Text style={styles.podErrorText}>{presentLoadError(podState.message).title}</Text>
            <Button
              label={presentLoadError(podState.message).actionLabel}
              onPress={podState.reload}
              variant="secondary"
              fullWidth={false}
              testID="button-retry-pod"
            />
          </Card>
        ) : null}
      </Screen>

      {proof ? (
        <Modal
          visible={viewerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setViewerOpen(false)}
          testID="pod-viewer-modal"
        >
          <View style={styles.viewerBackdrop}>
            <Pressable
              style={styles.viewerClose}
              onPress={() => setViewerOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="ปิด"
              testID="pod-viewer-close"
            >
              <Text style={styles.viewerCloseLabel}>ปิด</Text>
            </Pressable>
            {photoLoadFailed ? (
              <Text style={styles.viewerErrorText}>โหลดรูปไม่สำเร็จ</Text>
            ) : (
              <Image
                testID="pod-viewer-image"
                source={{ uri: proof.photoUrl }}
                style={styles.viewerImage}
                resizeMode="contain"
                onError={() => setPhotoLoadFailed(true)}
              />
            )}
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.md },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  orderNumber: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontFamily: fontFamily.regular, fontSize: 20 },
  shopBody: { flex: 1, gap: 2 },
  shopName: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  placedAt: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  /** The design's in-card section label — small, muted, letter-spaced. */
  cardLabel: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  items: { gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  paidWith: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  paidWithLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  paidWithValue: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  address: { gap: spacing.xs },
  addressLine: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textPrimary },
  landmark: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },

  /* ---------------------------------------------------- POD (Phase G7.4) */
  pod: { gap: spacing.sm },
  podThumb: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
  },
  podThumbFallback: {
    width: '100%',
    height: 180,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  podThumbFallbackText: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  podTimestamp: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  podErrorText: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },

  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.lg,
    zIndex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  viewerCloseLabel: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textInverse },
  viewerErrorText: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textInverse },
  viewerImage: { width: '100%', height: '80%' },
});
