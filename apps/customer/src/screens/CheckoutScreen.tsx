import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  ListRow,
  PriceRow,
  SectionHeader,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCart, lineTotalSatang, optionLabels } from '../hooks/useCart';
import { repositories } from '../repositories';
import { formatBaht } from '../lib/money';
import { presentLoadError } from '../lib/loadError';
import { optionsDeltaSatang } from '../domain/cart';
import { CartConflictError, type CartConflict } from '../domain/cartValidation';
import { SAMPLE_DISCOUNT_CODE, calculateTotals } from '../mocks/pricing';
import type { PaymentMethod } from '../mocks/types';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 10 ยืนยันการสั่ง — summary, address, and payment method.
 *
 * The CTA follows the design's own `payCta`:
 *   PromptPay → "ไปสแกนจ่าย ฿N"  → 12 QR
 *   Cash      → "ยืนยันสั่ง ฿N (เงินสด)" → 13 สั่งสำเร็จ
 *
 * The cash destination is DQ-01 in the implementation map — the design does not
 * show a cash-specific screen, so it goes straight to confirmation.
 *
 * NOTE: no order is created and no payment is taken. Q-001 is OPEN and
 * DEC-015 forbids provider integration here.
 */
export function CheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const { cart, subtotalSatang, refresh, remove } = useCart();
  const lines = cart?.lines ?? [];
  // Phase E/F screen, still on sample fee numbers. The cart no longer computes
  // these (DEC-D-01 — the app must not invent money), so the dependency on the
  // design's illustrative figures is now explicit here rather than hidden
  // inside the cart hook. Checkout's real totals arrive with the order.
  const totals = calculateTotals(subtotalSatang);
  const [method, setMethod] = useState<PaymentMethod>('PROMPTPAY');
  const [validating, setValidating] = useState(false);
  const [conflict, setConflict] = useState<CartConflict | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);

  /** Line names by cart item id, so a conflict can name the dish, not an id. */
  const nameByCartItemId = new Map(lines.map((line) => [line.id, line.name]));

  /**
   * Revalidates the cart server-side, then proceeds only if it passed.
   *
   * UX-SPEC § C-10: *"Server-side revalidation runs on press."* On press
   * specifically, not on mount — the customer can change the cart in another
   * tab, and the world can change underneath a checkout screen left open, so
   * validating at entry would prove nothing about the moment that matters.
   *
   * **Fails closed.** Only an accepted validation navigates onward. A conflict
   * renders its diff; a transport or system failure renders the shared error
   * state. Neither falls through to payment — an unreachable API must never
   * read as an accepted cart (V1.1 §15: *"a stale cart cannot become an
   * order"*).
   */
  async function onPlaceOrder() {
    if (validating) return;

    setValidating(true);
    setConflict(null);
    setSystemError(null);

    try {
      // The expectation is what the customer was actually shown: `cart.lines`
      // holds prices captured when the cart last loaded, not re-read now.
      // Re-deriving them at press time would compare the server against
      // itself and could never detect drift.
      await repositories.cartValidation.validate(
        lines.map((line) => ({
          cartItemId: line.id,
          expectedUnitPriceSatang: line.basePriceSatang + optionsDeltaSatang(line),
        })),
      );

      navigation.navigate(method === 'PROMPTPAY' ? 'PromptPayQr' : 'OrderConfirmed');
    } catch (cause) {
      if (cause instanceof CartConflictError) {
        setConflict(cause.conflict);
      } else {
        setSystemError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setValidating(false);
    }
  }

  /**
   * `รับทราบและไปต่อ` (UX-SPEC § 13).
   *
   * Acknowledging does not skip validation — it re-runs it. The cart is
   * reloaded first so the expectation carries the new prices, which then match
   * and the order proceeds. If the price moved again in between, validation
   * fails again, which is the correct outcome rather than a bypass.
   */
  async function onAcknowledgePriceChange() {
    setConflict(null);
    await refresh();
  }

  /** `นำออกจากตะกร้า` (UX-SPEC § 13) — removes exactly the refused lines. */
  async function onRemoveUnavailable(cartItemIds: string[]) {
    setConflict(null);
    for (const cartItemId of cartItemIds) {
      await remove(cartItemId);
    }
  }

  const addressState = useAsyncData(() => repositories.addresses.listAddresses());
  const defaultAddress =
    addressState.status === 'success'
      ? (addressState.data.find((a) => a.isDefault) ?? addressState.data[0])
      : undefined;

  const cta =
    method === 'PROMPTPAY'
      ? `ไปสแกนจ่าย ${formatBaht(totals.totalSatang)}`
      : `ยืนยันสั่ง ${formatBaht(totals.totalSatang)} (เงินสด)`;

  return (
    <Screen
      scroll
      testID="screen-checkout"
      footer={
        <BottomBar>
          <Button
            // UX-SPEC § 13, "Loading, action in flight": in-button spinner +
            // `กำลังดำเนินการ`, disabled. `Button` already renders exactly that
            // from `loading`, so no new control is introduced.
            label={validating ? 'กำลังดำเนินการ' : cta}
            loading={validating}
            onPress={() => void onPlaceOrder()}
            testID="button-place-order"
          />
        </BottomBar>
      }
    >
      {/*
        The revalidation diff. UX-SPEC § C-10 is explicit that a price change or
        unavailable item "returns the customer to a clearly-marked diff, not a
        generic failure", so each conflict names the affected dish and, for a
        price change, both the old and the new amount.
      */}
      {conflict?.kind === 'PRICE_CHANGED' ? (
        <Card style={styles.conflict} testID="checkout-price-changed">
          <Text style={styles.conflictTitle}>ราคามีการเปลี่ยนแปลง</Text>
          {conflict.changes.map((change) => (
            <View key={change.cartItemId} style={styles.conflictRow}>
              <Text style={styles.conflictItem}>
                {nameByCartItemId.get(change.cartItemId) ?? change.cartItemId}
              </Text>
              <Text style={styles.conflictPrices} testID={`price-diff-${change.cartItemId}`}>
                <Text style={styles.priceWas}>{formatBaht(change.wasSatang)}</Text>
                {` → ${formatBaht(change.nowSatang)}`}
              </Text>
            </View>
          ))}
          <Button
            label="รับทราบและไปต่อ"
            variant="secondary"
            onPress={() => void onAcknowledgePriceChange()}
            testID="button-acknowledge-price"
          />
        </Card>
      ) : null}

      {conflict?.kind === 'ITEM_UNAVAILABLE' ? (
        <Card style={styles.conflict} testID="checkout-item-unavailable">
          <Text style={styles.conflictTitle}>วันนี้หมด</Text>
          {conflict.items.map((item) => (
            <View key={item.cartItemId} style={styles.conflictRow}>
              <Text style={[styles.conflictItem, styles.conflictItemGone]}>
                {nameByCartItemId.get(item.cartItemId) ?? item.cartItemId}
              </Text>
            </View>
          ))}
          <Button
            label="นำออกจากตะกร้า"
            variant="secondary"
            onPress={() => void onRemoveUnavailable(conflict.items.map((i) => i.cartItemId))}
            testID="button-remove-unavailable"
          />
        </Card>
      ) : null}

      {/*
        A transport or system failure. Uses the same offline/server split every
        other screen uses, so an unreachable API reads as "could not check",
        never as an accepted cart.
      */}
      {systemError ? (
        <Card style={styles.conflict} testID="checkout-validation-error">
          <Text style={styles.conflictTitle}>{presentLoadError(systemError).title}</Text>
          <Button
            label={presentLoadError(systemError).actionLabel}
            variant="secondary"
            onPress={() => void onPlaceOrder()}
            testID="button-retry-validation"
          />
        </Card>
      ) : null}

      <SectionHeader title="ที่อยู่จัดส่ง" />
      <ListRow
        leading={defaultAddress?.glyph ?? '📍'}
        title={defaultAddress?.label ?? 'เลือกที่อยู่'}
        subtitle={defaultAddress?.line}
        trailing="เปลี่ยน"
        onPress={() => navigation.navigate('Address')}
        testID="row-address"
      />

      <SectionHeader title="รายการอาหาร" />
      <Card style={styles.items}>
        {lines.map((line) => {
          const labels = optionLabels(line);

          return (
            <View key={line.id} style={styles.itemRow}>
              <Text style={styles.itemQty}>{line.quantity}×</Text>
              <View style={styles.itemBody}>
                <Text style={styles.itemName}>{line.name}</Text>
                {labels.length > 0 ? (
                  <Text style={styles.itemOptions}>{labels.join(' · ')}</Text>
                ) : null}
              </View>
              <Text style={styles.itemPrice}>{formatBaht(lineTotalSatang(line))}</Text>
            </View>
          );
        })}
      </Card>

      <SectionHeader title="วิธีชำระเงิน" />
      <View style={styles.methods}>
        <ListRow
          leading="📱"
          title="พร้อมเพย์ QR"
          subtitle="สแกนจ่ายผ่านแอปธนาคาร"
          selected={method === 'PROMPTPAY'}
          onPress={() => setMethod('PROMPTPAY')}
          testID="method-promptpay"
        />
        <ListRow
          leading="💵"
          title="เงินสดปลายทาง"
          subtitle="จ่ายกับไรเดอร์เมื่อได้รับอาหาร"
          selected={method === 'CASH'}
          onPress={() => setMethod('CASH')}
          testID="method-cash"
        />
      </View>

      <SectionHeader title="สรุปค่าใช้จ่าย" />
      <Card>
        <PriceRow label="ราคาอาหาร" amount={formatBaht(totals.subtotalSatang)} />
        <PriceRow label="ค่าส่ง (1.2 กม.)" amount={formatBaht(totals.deliveryFeeSatang)} />
        <PriceRow label="ค่าบริการ" amount={formatBaht(totals.serviceFeeSatang)} />
        <PriceRow
          label={`ส่วนลด ${SAMPLE_DISCOUNT_CODE}`}
          amount={`−${formatBaht(totals.discountSatang)}`}
          discount
        />
        <View style={styles.divider} />
        <PriceRow label="รวมทั้งหมด" amount={formatBaht(totals.totalSatang)} emphasis />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  items: { gap: spacing.md },
  itemRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  itemQty: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textMuted },
  itemBody: { flex: 1, gap: 2 },
  itemName: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textPrimary },
  itemOptions: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  itemPrice: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  methods: { gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  conflict: {
    gap: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.warningSoft,
  },
  conflictTitle: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.md,
    color: colors.textPrimary,
  },
  conflictRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  conflictItem: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
  conflictItemGone: { color: colors.textMuted },
  conflictPrices: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm, color: colors.textPrimary },
  priceWas: { fontFamily: fontFamily.regular, color: colors.textMuted, textDecorationLine: 'line-through' },
});
