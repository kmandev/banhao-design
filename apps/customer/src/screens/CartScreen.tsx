import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Card,
  PriceRow,
  SectionHeader,
  StateView,
  Stepper,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useCart, lineTotal } from '../hooks/useCart';
import { formatBaht, SAMPLE_DISCOUNT_CODE } from '../mocks/pricing';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 09 ตะกร้า, plus the 🧺 ตะกร้าว่าง state variant.
 */
export function CartScreen() {
  const navigation = useNavigation<Nav>();
  const { lines, itemCount, totals, increase, decrease, remove } = useCart();

  if (lines.length === 0) {
    return (
      <Screen testID="screen-cart-empty">
        <StateView
          kind="empty"
          glyph="🧺"
          title="ตะกร้าว่าง"
          message="ยังไม่มีอาหารในตะกร้า ลองเลือกร้านใกล้คุณดู"
          actionLabel="เลือกร้าน"
          onAction={() => navigation.navigate('Tabs')}
          testID="state-cart-empty"
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      testID="screen-cart"
      footer={
        <BottomBar>
          <Button
            label={`ยืนยันการสั่ง (${itemCount})`}
            trailing={formatBaht(totals.totalSatang)}
            onPress={() => navigation.navigate('Checkout')}
            testID="button-go-checkout"
          />
        </BottomBar>
      }
    >
      <SectionHeader title="ตะกร้า" />

      {lines.map((line) => (
        <Card key={line.lineId} style={styles.line} testID={`cart-line-${line.lineId}`}>
          <View style={styles.lineHeader}>
            <View style={styles.lineBody}>
              <Text style={styles.lineName}>{line.name}</Text>
              {line.optionLabels.length > 0 ? (
                <Text style={styles.lineOptions}>{line.optionLabels.join(' · ')}</Text>
              ) : null}
              {line.note ? <Text style={styles.lineNote}>หมายเหตุ: {line.note}</Text> : null}
            </View>
            <Text style={styles.lineTotal}>{formatBaht(lineTotal(line))}</Text>
          </View>

          <View style={styles.lineActions}>
            <Stepper
              value={line.quantity}
              onIncrease={() => increase(line.lineId)}
              onDecrease={() => decrease(line.lineId)}
              testID={`stepper-${line.lineId}`}
            />
            <Pressable
              onPress={() => remove(line.lineId)}
              accessibilityRole="button"
              accessibilityLabel={`ลบ ${line.name} ออกจากตะกร้า`}
              testID={`remove-${line.lineId}`}
            >
              <Text style={styles.remove}>ลบ</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <Card style={styles.summary}>
        <PriceRow label="ราคาอาหาร" amount={formatBaht(totals.subtotalSatang)} />
        <PriceRow label="ค่าส่ง" amount={formatBaht(totals.deliveryFeeSatang)} />
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
  line: { gap: spacing.md },
  lineHeader: { flexDirection: 'row', gap: spacing.md },
  lineBody: { flex: 1, gap: 3 },
  lineName: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  lineOptions: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  lineNote: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textSubtle, fontStyle: 'italic' },
  lineTotal: { fontSize: fontSize.xl, fontFamily: fontFamily.bold, color: colors.textPrimary },
  lineActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remove: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.danger, padding: spacing.sm },
  summary: { marginTop: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
});
