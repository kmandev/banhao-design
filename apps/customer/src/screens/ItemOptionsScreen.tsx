import { useCallback, useMemo, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Badge,
  BottomBar,
  Button,
  ListRow,
  SectionHeader,
  StateView,
  Stepper,
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCart } from '../hooks/useCart';
import { repositories } from '../repositories';
import { formatBaht } from '../mocks/pricing';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type ItemRoute = RouteProp<CustomerStackParamList, 'ItemOptions'>;

/**
 * 08 เลือกตัวเลือกอาหาร — options, quantity, and a note.
 *
 * Required groups default to their first option so the CTA is never blocked by
 * an unmade choice the user hasn't seen yet.
 */
export function ItemOptionsScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<ItemRoute>();
  const { addLine } = useCart();

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const load = useCallback(
    () => repositories.catalog.getMenuItem(params.shopId, params.itemId),
    [params.shopId, params.itemId],
  );

  const state = useAsyncData(load, [params.shopId, params.itemId]);
  const item = state.status === 'success' ? state.data : null;

  const { optionLabels, optionsDelta } = useMemo(() => {
    if (!item?.optionGroups) return { optionLabels: [] as string[], optionsDelta: 0 };

    const labels: string[] = [];
    let delta = 0;

    for (const group of item.optionGroups) {
      const chosenId = selections[group.id] ?? (group.required ? group.options[0]?.id : undefined);
      const chosen = group.options.find((o) => o.id === chosenId);
      if (!chosen) continue;
      labels.push(
        chosen.priceDeltaSatang > 0
          ? `${chosen.label} +${chosen.priceDeltaSatang / 100}`
          : chosen.label,
      );
      delta += chosen.priceDeltaSatang;
    }

    return { optionLabels: labels, optionsDelta: delta };
  }, [item, selections]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-item-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen testID="screen-item-error">
        <StateView
          kind="error"
          glyph="🙈"
          title="ไม่พบเมนูนี้"
          actionLabel="กลับ"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const lineTotalSatang = (item.priceSatang + optionsDelta) * quantity;

  function onAddToCart() {
    if (!item) return;
    addLine({
      menuItemId: item.id,
      shopId: item.shopId,
      name: item.name,
      basePriceSatang: item.priceSatang,
      optionLabels,
      optionsDeltaSatang: optionsDelta,
      note: note.trim(),
      quantity,
    });
    navigation.navigate('Cart');
  }

  return (
    <Screen
      scroll
      testID="screen-item-options"
      footer={
        <BottomBar>
          <Button
            label="เพิ่มลงตะกร้า"
            trailing={formatBaht(lineTotalSatang)}
            onPress={onAddToCart}
            testID="button-add-to-cart"
          />
        </BottomBar>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroGlyph}>{item.glyph}</Text>
      </View>

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.price}>{formatBaht(item.priceSatang)}</Text>
        </View>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      </View>

      {item.optionGroups?.map((group) => {
        const activeId = selections[group.id] ?? (group.required ? group.options[0]?.id : undefined);

        return (
          <View key={group.id} style={styles.group}>
            <SectionHeader
              title={group.title}
              action={group.required ? <Badge label="ต้องเลือก" tone="primary" /> : undefined}
            />
            <View style={styles.options}>
              {group.options.map((option) => (
                <ListRow
                  key={option.id}
                  title={option.label}
                  trailing={
                    option.priceDeltaSatang > 0
                      ? `+${formatBaht(option.priceDeltaSatang)}`
                      : undefined
                  }
                  selected={activeId === option.id}
                  onPress={() => setSelections((prev) => ({ ...prev, [group.id]: option.id }))}
                  testID={`option-${group.id}-${option.id}`}
                />
              ))}
            </View>
          </View>
        );
      })}

      <View style={styles.group}>
        <SectionHeader title="หมายเหตุถึงร้าน" />
        <TextInput
          style={styles.note}
          placeholder="เช่น ไม่ใส่ผัก, ขอช้อนเพิ่ม"
          placeholderTextColor={colors.textFaint}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={200}
          accessibilityLabel="หมายเหตุถึงร้าน"
          testID="input-note"
        />
      </View>

      <View style={styles.quantityRow}>
        <Text style={styles.quantityLabel}>จำนวน</Text>
        <Stepper
          value={quantity}
          onIncrease={() => setQuantity((q) => q + 1)}
          onDecrease={() => setQuantity((q) => Math.max(1, q - 1))}
          testID="stepper-quantity"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 160,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAccent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  heroGlyph: { fontSize: 64 },
  header: { gap: spacing.sm, paddingVertical: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: {
    flex: 1,
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  price: { fontSize: fontSize.h3, fontWeight: fontWeight.bold, color: colors.textPrimary },
  description: { fontSize: fontSize.md, color: colors.textMuted, lineHeight: 20 },
  group: { gap: spacing.sm, paddingTop: spacing.lg },
  options: { gap: spacing.sm },
  note: {
    minHeight: 88,
    padding: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: fontSize.lg,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
  },
  quantityLabel: { fontSize: fontSize.xxl, fontWeight: fontWeight.semibold, color: colors.textPrimary },
});
