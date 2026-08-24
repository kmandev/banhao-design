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
import { useCart, lineTotalSatang, optionLabels } from '../hooks/useCart';
import { formatBaht } from '../lib/money';
import { presentLoadError } from '../lib/loadError';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * UX-SPEC § C-09 copy for a fee whose amount is not yet knowable.
 *
 * A literal, not a formatted zero — `฿0` would be a claim about the price.
 */
const PENDING_FEE_LABEL = 'คำนวณเมื่อยืนยัน';

/**
 * 09 ตะกร้า, plus the 🧺 ตะกร้าว่าง state variant.
 *
 * ## Fee rows — DEC-D-01
 *
 * `ค่าส่ง` and `ค่าบริการ` render the literal string `คำนวณเมื่อยืนยัน`, and
 * there is no total row, because no total is knowable *at the cart screen*.
 * UX-SPEC § C-09: *"Fee lines appear here as server-provided amounts; if any
 * fee is not yet knowable, the row shows `คำนวณเมื่อยืนยัน` rather than a
 * number the app invented."* The delivery fee (DEC-035) and service fee
 * (DEC-036) are now resolved amounts, but resolution happens server-side at
 * order creation (Phase E), not here — this screen still has nothing to show.
 * Discount (BQ-030) remains OPEN regardless. `POST /cart/validate` — which
 * will supply the server-side subtotal — lands at D-6.
 *
 * The discount row is gone rather than blanked: `BANHAO7` was a design sample,
 * and no promotion mechanism exists to replace it with.
 */
export function CartScreen() {
  const navigation = useNavigation<Nav>();
  const { cart, loading, error, itemCount, subtotalSatang, increase, decrease, remove, refresh } =
    useCart();
  const lines = cart?.lines ?? [];

  // Only the initial fetch sets `loading` — a mutation reloads through
  // `mutate()` in useCart, which never touches it, so this cannot flash on
  // every tap of the stepper (requirement C: no state that can diverge from
  // what Supabase just confirmed).
  if (loading) {
    return (
      <Screen testID="screen-cart-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (error) {
    const presentation = presentLoadError(error);
    return (
      <Screen testID="screen-cart-error">
        <StateView
          kind="error"
          glyph={presentation.glyph}
          title={presentation.title}
          actionLabel={presentation.actionLabel}
          onAction={() => void refresh()}
        />
      </Screen>
    );
  }

  if (lines.length === 0) {
    return (
      <Screen testID="screen-cart-empty">
        <StateView
          kind="empty"
          glyph="🧺"
          // UX-SPEC § 13 copy, verbatim.
          title="ตะกร้ายังว่างอยู่"
          message="ยังไม่มีอาหารในตะกร้า ลองเลือกร้านใกล้คุณดู"
          actionLabel="เลือกอาหาร"
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
            // No trailing amount: the grand total is not knowable until the
            // server prices the fees (DEC-D-01). A subtotal shown here would
            // read as the amount payable, which it is not.
            onPress={() => navigation.navigate('Checkout')}
            testID="button-go-checkout"
          />
        </BottomBar>
      }
    >
      <SectionHeader title="ตะกร้า" />

      {lines.map((line) => {
        const labels = optionLabels(line);

        return (
          <Card key={line.id} style={styles.line} testID={`cart-line-${line.id}`}>
            <View style={styles.lineHeader}>
              <View style={styles.lineBody}>
                <Text style={styles.lineName}>{line.name}</Text>
                {labels.length > 0 ? (
                  <Text style={styles.lineOptions}>{labels.join(' · ')}</Text>
                ) : null}
                {line.note ? <Text style={styles.lineNote}>หมายเหตุ: {line.note}</Text> : null}
              </View>
              <Text style={styles.lineTotal}>{formatBaht(lineTotalSatang(line))}</Text>
            </View>

            <View style={styles.lineActions}>
              <Stepper
                value={line.quantity}
                onIncrease={() => void increase(line.id)}
                onDecrease={() => void decrease(line.id)}
                testID={`stepper-${line.id}`}
              />
              <Pressable
                onPress={() => void remove(line.id)}
                accessibilityRole="button"
                accessibilityLabel={`ลบ ${line.name} ออกจากตะกร้า`}
                testID={`remove-${line.id}`}
              >
                <Text style={styles.remove}>ลบ</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}

      <Card style={styles.summary} testID="cart-summary">
        <PriceRow label="ราคาอาหาร" amount={formatBaht(subtotalSatang)} />
        <PriceRow label="ค่าส่ง" amount={PENDING_FEE_LABEL} />
        <PriceRow label="ค่าบริการ" amount={PENDING_FEE_LABEL} />
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
});
