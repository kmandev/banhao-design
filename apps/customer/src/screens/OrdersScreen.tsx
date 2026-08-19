import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  Card,
  SectionHeader,
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
  formatOrderPlacedAt,
  orderStateLabel,
  orderStateTone,
  paymentMethodLabel,
  summariseItems,
} from '../lib/orderDisplay';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 16 ออเดอร์ของฉัน — C-16, real Supabase order history as of Phase E-3B.3.
 *
 * The card structure is unchanged from the mock-backed version; only its data
 * source and its destination moved. The destination change restores design
 * intent rather than inventing it: every history card in the design canvas
 * carries `go: go('orderDetail')` (`docs/design/BANHAO Customer App.dc.html`),
 * so C-16 → C-19 is what the design always specified. It could not be
 * implemented until now because the previous fixture ids (`BH000125`) were
 * order *numbers*, and C-19 reads by order id.
 *
 * State copy and badge tones come from `lib/orderDisplay.ts`, which transcribes
 * UX-SPEC §10 — the superseded 12-state map that used to live in this file is
 * gone, per the roadmap's own instruction to "replace the 12 mock order states
 * with the §10 vocabulary (DEC-019)".
 */
export function OrdersScreen() {
  const navigation = useNavigation<Nav>();
  const state = useAsyncData(() => repositories.orders.listOrders());

  return (
    <Screen scroll testID="screen-orders">
      <SectionHeader title="ออเดอร์ของฉัน" />

      {state.status === 'loading' ? (
        <StateView kind="loading" title="กำลังโหลด…" />
      ) : state.status === 'error' ? (
        // UX-SPEC §13 copy, via the shared classifier the catalog screens use —
        // offline and server failure read differently and must not be merged.
        <StateView
          kind="error"
          glyph={presentLoadError(state.message).glyph}
          title={presentLoadError(state.message).title}
          actionLabel={presentLoadError(state.message).actionLabel}
          onAction={state.reload}
          testID="state-orders-error"
        />
      ) : state.data.length === 0 ? (
        // UX-SPEC §13, "Empty — no orders | C-16": `ยังไม่มีประวัติการสั่ง`,
        // action `สั่งอาหาร`. The previous wording predates that table.
        <StateView
          kind="empty"
          glyph="🧾"
          title="ยังไม่มีประวัติการสั่ง"
          actionLabel="สั่งอาหาร"
          onAction={() => navigation.navigate('Tabs')}
          testID="state-orders-empty"
        />
      ) : (
        state.data.map((order) => {
          const label = orderStateLabel(order.state);
          const placedAt = formatOrderPlacedAt(order.placedAt);
          return (
            <Card
              key={order.orderId}
              onPress={() => navigation.navigate('OrderDetail', { orderId: order.orderId })}
              testID={`order-card-${order.orderId}`}
              style={styles.card}
            >
              <View style={styles.row}>
                <View style={styles.thumb}>
                  <Text style={styles.glyph}>{SHOP_PLACEHOLDER_GLYPH}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.shop} numberOfLines={1}>
                    {order.restaurantNameSnapshot}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    #{order.orderNumber}
                    {placedAt ? ` · ${placedAt}` : ''}
                  </Text>
                  {order.items.length > 0 ? (
                    <Text style={styles.items} numberOfLines={1}>
                      {summariseItems(order.items)}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.total}>{formatBaht(order.grandTotalSatang)}</Text>
              </View>
              <View style={styles.footer}>
                {/* No badge when the design has no approved wording for the
                    state — §10 forbids rendering the identifier itself. */}
                {label ? <Badge label={label} tone={orderStateTone(order.state)} /> : <View />}
                <Text style={styles.method}>{paymentMethodLabel(order.paymentMethod)}</Text>
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
  glyph: { fontFamily: fontFamily.regular, fontSize: 24 },
  body: { flex: 1, gap: 2 },
  shop: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle },
  items: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  total: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.textPrimary },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  method: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
});
