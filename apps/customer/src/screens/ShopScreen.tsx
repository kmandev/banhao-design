import { useCallback, useState } from 'react';
import { useNavigation, type RouteProp, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Badge,
  BottomBar,
  Button,
  MenuRow,
  StateView,
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
type ShopRoute = RouteProp<CustomerStackParamList, 'Shop'>;

/**
 * 07 หน้าร้าน, plus the 🌙 ร้านปิด state variant when `shop.isOpen` is false.
 */
export function ShopScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<ShopRoute>();
  const { itemCount, totals } = useCart();
  const [section, setSection] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([
        repositories.catalog.getShop(params.shopId),
        repositories.catalog.listMenu(params.shopId),
      ]).then(([shop, menu]) => ({ shop, menu })),
    [params.shopId],
  );

  const state = useAsyncData(load, [params.shopId]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-shop-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error' || !state.data.shop) {
    return (
      <Screen testID="screen-shop-error">
        <StateView
          kind="error"
          glyph="📡"
          title="โหลดร้านไม่สำเร็จ"
          message={state.status === 'error' ? state.message : 'ไม่พบร้านนี้'}
          actionLabel="ลองใหม่"
          onAction={state.status === 'error' ? state.reload : () => navigation.goBack()}
        />
      </Screen>
    );
  }

  const { shop, menu } = state.data;

  // 🌙 ร้านปิด — the design shows a dedicated closed state, not a disabled menu.
  if (!shop.isOpen) {
    return (
      <Screen testID="screen-shop-closed">
        <StateView
          kind="info"
          glyph="🌙"
          title="ร้านปิดอยู่"
          message={`${shop.name}\n${shop.openingHours}`}
          actionLabel="ดูร้านอื่น"
          onAction={() => navigation.goBack()}
          testID="state-shop-closed"
        />
      </Screen>
    );
  }

  const sections = [...new Set(menu.map((m) => m.section))];
  const visibleMenu = section ? menu.filter((m) => m.section === section) : menu;

  return (
    <Screen
      scroll
      testID="screen-shop"
      footer={
        itemCount > 0 ? (
          <BottomBar>
            <Button
              label={`ดูตะกร้า (${itemCount})`}
              trailing={formatBaht(totals.totalSatang)}
              onPress={() => navigation.navigate('Cart')}
              testID="button-view-cart"
            />
          </BottomBar>
        ) : null
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroGlyph}>{shop.glyph}</Text>
      </View>

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{shop.name}</Text>
          <Badge label="เปิดอยู่" tone="success" />
        </View>
        <Text style={styles.meta}>
          ⭐ {shop.rating} ({shop.reviewCount} รีวิว) · {shop.cuisine}
        </Text>
        <View style={styles.statRow}>
          <Stat label="ระยะทาง" value={`${shop.distanceKm} กม.`} />
          <Stat label="เวลาส่ง" value={`${shop.etaMinutes} นาที`} />
          <Stat label="ค่าส่ง" value={formatBaht(shop.deliveryFeeSatang)} />
        </View>
        <Text style={styles.hours}>🕐 {shop.openingHours}</Text>
        <Text style={styles.address}>📍 {shop.addressLine}</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRow}
      >
        {sections.map((s) => (
          <Pressable
            key={s}
            onPress={() => setSection((prev) => (prev === s ? null : s))}
            accessibilityRole="button"
            accessibilityState={{ selected: section === s }}
            style={[styles.tab, section === s && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, section === s && styles.tabLabelActive]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {visibleMenu.map((item) => (
        <MenuRow
          key={item.id}
          name={item.name}
          description={item.description}
          price={formatBaht(item.priceSatang)}
          glyph={item.glyph}
          onPress={() =>
            navigation.navigate('ItemOptions', { shopId: shop.id, itemId: item.id })
          }
          testID={`menu-row-${item.id}`}
        />
      ))}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 140,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAccent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  heroGlyph: { fontSize: 56 },
  header: { gap: spacing.sm, paddingVertical: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    flexShrink: 1,
    fontSize: fontSize.h2,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  meta: { fontSize: fontSize.md, color: colors.textMuted },
  statRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.sm,
  },
  stat: { gap: 2 },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.textPrimary },
  hours: { fontSize: fontSize.sm, color: colors.textMuted },
  address: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
  tabRow: { gap: spacing.sm, paddingBottom: spacing.md },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  tabLabel: { fontSize: fontSize.base, color: colors.textMuted },
  tabLabelActive: { color: colors.textInverse, fontWeight: fontWeight.semibold },
});
