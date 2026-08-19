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
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCart } from '../hooks/useCart';
import { repositories } from '../repositories';
import { formatBaht } from '../lib/money';
import {
  formatShopMeta,
  ITEM_PLACEHOLDER_GLYPH,
  SHOP_PLACEHOLDER_GLYPH,
} from '../lib/catalogDisplay';
import { formatNextOpening, windowsForDay } from '../lib/openingHours';
import { presentLoadError } from '../lib/loadError';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type ShopRoute = RouteProp<CustomerStackParamList, 'Shop'>;

/** index 0 = Sunday, matching `restaurant_hours.day_of_week`. */
const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

/**
 * 07 หน้าร้าน — identity, menu, and (when closed) a persistent banner.
 *
 * UX-SPEC § 5.3: "If the restaurant is closed, one non-dismissable banner
 * explains it and the primary action becomes ดูเวลาเปิดร้าน." The menu stays
 * fully visible and browsable underneath — a customer may want tomorrow's
 * hours, and nothing here pretends the restaurant is accepting orders; that
 * enforcement belongs to the order/checkout phase, not this catalog read.
 */
export function ShopScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<ShopRoute>();
  const { itemCount } = useCart();
  const [section, setSection] = useState<string | null>(null);
  const [showAllHours, setShowAllHours] = useState(false);

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

  if (state.status === 'error') {
    const presentation = presentLoadError(state.message);
    return (
      <Screen testID="screen-shop-error">
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

  if (!state.data.shop) {
    return (
      <Screen testID="screen-shop-error">
        <StateView
          kind="empty"
          glyph="🙈"
          title="ไม่พบร้านนี้"
          actionLabel="กลับ"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const { shop, menu } = state.data;

  const sections = [...new Set(menu.map((m) => m.categoryName))].filter(Boolean);
  const visibleMenu = section ? menu.filter((m) => m.categoryName === section) : menu;

  return (
    <Screen
      scroll
      testID="screen-shop"
      footer={
        itemCount > 0 ? (
          <BottomBar>
            <Button
              label={`ดูตะกร้า (${itemCount})`}
              // No amount: the order total is not knowable until the server
              // prices the fees (DEC-D-01), and a subtotal on a button reads
              // as the amount payable.
              onPress={() => navigation.navigate('Cart')}
              testID="button-view-cart"
            />
          </BottomBar>
        ) : null
      }
    >
      <View style={styles.hero}>
        <Text style={styles.heroGlyph}>{SHOP_PLACEHOLDER_GLYPH}</Text>
      </View>

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{shop.name}</Text>
          <Badge label={shop.isOpen ? 'เปิดอยู่' : 'ปิดอยู่'} tone={shop.isOpen ? 'success' : 'neutral'} />
        </View>
        <Text style={styles.meta}>{formatShopMeta(shop)}</Text>
        {/*
          PC-Q-002 — the ระยะทาง / เวลาส่ง / ค่าส่ง stat row is intentionally not
          rendered. Distance needs the deferred geo domain, delivery fee needs
          `delivery_fee_bands` (deferred, BQ-026 OPEN), and prep time is not a
          delivery ETA. Restore this row once those sources exist; do not fill
          it with placeholders (V1.1 rule #10 — money is never invented by the
          client).
        */}
        {shop.todayHours ? <Text style={styles.hours}>🕐 {shop.todayHours}</Text> : null}
        {shop.addressLine ? <Text style={styles.address}>📍 {shop.addressLine}</Text> : null}
      </View>

      {!shop.isOpen ? (
        // UX-SPEC § 5.3 — a single non-dismissable banner, not a screen
        // replacement. The menu below stays fully visible and browsable.
        <View style={styles.closedBanner} testID="banner-shop-closed">
          <Text style={styles.closedBannerTitle}>
            🌙 ร้านปิดอยู่
            {formatNextOpening(shop.hours, new Date())
              ? ` · ${formatNextOpening(shop.hours, new Date())}`
              : ''}
          </Text>
          <Pressable
            onPress={() => setShowAllHours((prev) => !prev)}
            accessibilityRole="button"
            testID="button-view-hours"
          >
            <Text style={styles.closedBannerAction}>ดูเวลาเปิดร้าน</Text>
          </Pressable>
          {showAllHours ? (
            <View style={styles.hoursTable} testID="shop-all-hours">
              {WEEKDAY_LABELS.map((label, dayOfWeek) => {
                const windows = windowsForDay(shop.hours, dayOfWeek);
                return (
                  <View key={dayOfWeek} style={styles.hoursRow}>
                    <Text style={styles.hoursDay}>{label}</Text>
                    <Text style={styles.hoursWindows}>
                      {windows.length > 0
                        ? windows
                            .map((w) => `${w.opensAt.slice(0, 5)} - ${w.closesAt.slice(0, 5)}`)
                            .join(', ')
                        : 'ปิด'}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

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
          description={item.description ?? undefined}
          price={formatBaht(item.priceSatang)}
          glyph={ITEM_PLACEHOLDER_GLYPH}
          // PC-Q-001: a sold-out item stays in its category, greyed and
          // labelled `วันนี้หมด`, but is not tappable. MenuRow drops the
          // handler entirely when unavailable; the guard below is the second
          // line of defence, so neither alone is load-bearing.
          unavailable={!item.isAvailable}
          onPress={() => {
            if (!item.isAvailable) return;
            navigation.navigate('ItemOptions', { shopId: shop.id, itemId: item.id });
          }}
          testID={`menu-row-${item.id}`}
        />
      ))}
    </Screen>
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
  heroGlyph: { fontFamily: fontFamily.regular, fontSize: 56 },
  header: { gap: spacing.sm, paddingVertical: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    flexShrink: 1,
    fontSize: fontSize.h2,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
  },
  meta: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  // Retained for the PC-Q-002 stat row above, which is deferred, not deleted.
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
  statLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.xs, color: colors.textMuted },
  statValue: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  hours: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  address: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 20 },
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
  tabLabel: { fontFamily: fontFamily.regular, fontSize: fontSize.base, color: colors.textMuted },
  tabLabelActive: { color: colors.textInverse, fontFamily: fontFamily.semibold },
  closedBanner: {
    borderRadius: radius.lg,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  closedBannerTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.md, color: colors.textPrimary },
  closedBannerAction: { fontFamily: fontFamily.semibold, fontSize: fontSize.sm, color: colors.textPrimary, textDecorationLine: 'underline' },
  hoursTable: { gap: spacing.xs, paddingTop: spacing.xs },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between' },
  hoursDay: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textMuted },
  hoursWindows: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.textPrimary },
});
