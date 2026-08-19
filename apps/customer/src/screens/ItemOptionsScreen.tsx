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
  fontFamily,
  fontSize,
  radius,
  spacing,
  UNAVAILABLE_LABEL,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCart } from '../hooks/useCart';
import { repositories, MixedRestaurantError } from '../repositories';
import { formatBaht } from '../lib/money';
import { ITEM_PLACEHOLDER_GLYPH } from '../lib/catalogDisplay';
import { presentLoadError } from '../lib/loadError';
import { isRequiredGroup } from '../domain/catalog';
import type { MenuOptionGroup } from '../domain/catalog';

/**
 * The option a required group starts on.
 *
 * Deliberately the first **available** option, not `options[0]`: pre-selecting
 * a sold-out choice would let an unavailable option satisfy a required group
 * and silently price the line (PC-Q-001). A group whose every option is sold
 * out selects nothing, which is the honest outcome — the customer has no valid
 * choice to make.
 */
function defaultSelectionFor(group: MenuOptionGroup): string | undefined {
  if (!isRequiredGroup(group)) return undefined;
  return group.options.find((option) => option.isAvailable)?.id;
}
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
  const { addItem, canModify } = useCart();

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(
    () => repositories.catalog.getMenuItem(params.shopId, params.itemId),
    [params.shopId, params.itemId],
  );

  const state = useAsyncData(load, [params.shopId, params.itemId]);
  const item = state.status === 'success' ? state.data : null;

  const { chosenOptionIds, optionsDelta } = useMemo(() => {
    if (!item?.optionGroups) return { chosenOptionIds: [] as string[], optionsDelta: 0 };

    const ids: string[] = [];
    let delta = 0;

    for (const group of item.optionGroups) {
      const chosenId = selections[group.id] ?? defaultSelectionFor(group);
      const chosen = group.options.find((o) => o.id === chosenId);
      // An unavailable option contributes nothing to the line total, even if a
      // stale selection somehow names one (PC-Q-001).
      if (!chosen || !chosen.isAvailable) continue;
      ids.push(chosen.id);
      delta += chosen.priceDeltaSatang;
    }

    return { chosenOptionIds: ids, optionsDelta: delta };
  }, [item, selections]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-item-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    const presentation = presentLoadError(state.message);
    return (
      <Screen testID="screen-item-error">
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

  if (!item) {
    return (
      <Screen testID="screen-item-error">
        <StateView
          kind="empty"
          glyph="🙈"
          title="ไม่พบเมนูนี้"
          actionLabel="กลับ"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const lineTotalSatang = (item.priceSatang + optionsDelta) * quantity;

  /**
   * Saves the configured line to the persisted cart (Phase D / D-5).
   *
   * Only identities are sent — `menuItemId` and the chosen `menu_options.id`
   * values. The name, price and option labels are deliberately not passed:
   * `cart_items` has no columns for them, and the cart re-reads all three from
   * the live catalog so it can never show a price it captured earlier.
   */
  async function onAddToCart() {
    if (!item || !item.isAvailable) return;

    try {
      await addItem({
        shopId: item.shopId,
        menuItemId: item.id,
        quantity,
        note: note.trim(),
        menuOptionIds: chosenOptionIds,
      });
      navigation.navigate('Cart');
    } catch (cause) {
      // DEC-017 — the C-09 "start a new cart?" dialog is D-8 work. Until it
      // exists this must not navigate to a cart that did not receive the item,
      // so the failure is surfaced inline rather than silently swallowed.
      setAddError(
        cause instanceof MixedRestaurantError
          ? 'ตะกร้ามีอาหารจากร้านอื่นอยู่'
          : 'เพิ่มลงตะกร้าไม่สำเร็จ ลองอีกครั้ง',
      );
    }
  }

  return (
    <Screen
      scroll
      testID="screen-item-options"
      footer={
        <BottomBar>
          <Button
            // Step 8 direct-entry safety: the whole item can be unavailable
            // (not just one of its options) — reachable via a stale nav
            // param, a deep link, or a search result. ShopScreen and
            // SearchScreen already keep an unavailable item from being
            // navigated to at all, but this is the one place that holds
            // regardless of how the screen was reached.
            //
            // DEC-D-03: a signed-out customer has no cart to add to — every
            // cart policy keys on `auth.uid()` — so the action names what is
            // actually missing instead of failing on tap.
            label={
              !item.isAvailable
                ? UNAVAILABLE_LABEL
                : canModify
                  ? 'เพิ่มลงตะกร้า'
                  : 'เข้าสู่ระบบเพื่อสั่ง'
            }
            trailing={item.isAvailable ? formatBaht(lineTotalSatang) : undefined}
            disabled={!item.isAvailable || !canModify}
            onPress={() => void onAddToCart()}
            testID="button-add-to-cart"
          />
        </BottomBar>
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroGlyph}>{ITEM_PLACEHOLDER_GLYPH}</Text>
      </View>

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.price}>{formatBaht(item.priceSatang)}</Text>
        </View>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      </View>

      {item.optionGroups?.map((group) => {
        const required = isRequiredGroup(group);
        const activeId = selections[group.id] ?? defaultSelectionFor(group);

        return (
          <View key={group.id} style={styles.group}>
            <SectionHeader
              title={group.title}
              action={required ? <Badge label="ต้องเลือก" tone="primary" /> : undefined}
            />
            <View style={styles.options}>
              {group.options.map((option) => (
                <ListRow
                  key={option.id}
                  title={option.label}
                  // Sold-out options stay listed rather than vanishing, so the
                  // menu reads the same as it did yesterday (UX-SPEC § 5.3).
                  trailing={
                    option.isAvailable
                      ? option.priceDeltaSatang > 0
                        ? `+${formatBaht(option.priceDeltaSatang)}`
                        : undefined
                      : UNAVAILABLE_LABEL
                  }
                  selected={option.isAvailable && activeId === option.id}
                  // No handler at all when unavailable — inert by structure,
                  // not merely by appearance.
                  onPress={
                    option.isAvailable
                      ? () => setSelections((prev) => ({ ...prev, [group.id]: option.id }))
                      : undefined
                  }
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

      {addError ? (
        <Text style={styles.addError} testID="item-add-error">
          {addError}
        </Text>
      ) : null}

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
  heroGlyph: { fontFamily: fontFamily.regular, fontSize: 64 },
  header: { gap: spacing.sm, paddingVertical: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: {
    flex: 1,
    fontSize: fontSize.h2,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  price: { fontSize: fontSize.h3, fontFamily: fontFamily.bold, color: colors.textPrimary },
  description: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted, lineHeight: 20 },
  group: { gap: spacing.sm, paddingTop: spacing.lg },
  options: { gap: spacing.sm },
  note: {
    minHeight: 88,
    padding: spacing.lg,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fontFamily.regular, fontSize: fontSize.lg,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
  },
  quantityLabel: { fontSize: fontSize.xxl, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  addError: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.md,
    color: colors.danger,
    paddingTop: spacing.lg,
  },
});
