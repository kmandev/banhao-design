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
  fontSize,
  fontWeight,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCart } from '../hooks/useCart';
import { repositories } from '../repositories';
import { formatBaht, SAMPLE_DISCOUNT_CODE } from '../mocks/pricing';
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
  const { lines, totals } = useCart();
  const [method, setMethod] = useState<PaymentMethod>('PROMPTPAY');

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
            label={cta}
            onPress={() =>
              navigation.navigate(method === 'PROMPTPAY' ? 'PromptPayQr' : 'OrderConfirmed')
            }
            testID="button-place-order"
          />
        </BottomBar>
      }
    >
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
        {lines.map((line) => (
          <View key={line.lineId} style={styles.itemRow}>
            <Text style={styles.itemQty}>{line.quantity}×</Text>
            <View style={styles.itemBody}>
              <Text style={styles.itemName}>{line.name}</Text>
              {line.optionLabels.length > 0 ? (
                <Text style={styles.itemOptions}>{line.optionLabels.join(' · ')}</Text>
              ) : null}
            </View>
            <Text style={styles.itemPrice}>
              {formatBaht((line.basePriceSatang + line.optionsDeltaSatang) * line.quantity)}
            </Text>
          </View>
        ))}
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
  itemQty: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textMuted },
  itemBody: { flex: 1, gap: 2 },
  itemName: { fontSize: fontSize.md, color: colors.textPrimary },
  itemOptions: { fontSize: fontSize.sm, color: colors.textMuted },
  itemPrice: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  methods: { gap: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
});
