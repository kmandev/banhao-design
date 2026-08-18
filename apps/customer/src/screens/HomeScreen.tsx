import { useCallback, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CategoryChip,
  SectionHeader,
  ShopCard,
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
import { formatRating, formatShopMeta, SHOP_PLACEHOLDER_GLYPH } from '../lib/catalogDisplay';
import { presentLoadError } from '../lib/loadError';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 05 หน้าแรก, plus the UX-SPEC § 13 state variants: loading, offline, server
 * error, and empty (no restaurants in the district — distinct from a category
 * filter matching nothing, which is a local UI state with no spec'd copy).
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const load = useCallback(
    () =>
      Promise.all([repositories.catalog.listCategories(), repositories.catalog.listShops()]).then(
        ([categories, shops]) => ({ categories, shops }),
      ),
    [],
  );

  const state = useAsyncData(load);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-home-loading">
        <StateView kind="loading" title="กำลังโหลด…" testID="state-home-loading" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    // UX-SPEC § 13 distinguishes "offline" from a generic server failure;
    // useAsyncData only carries a message, so the split happens here.
    const presentation = presentLoadError(state.message);
    return (
      <Screen testID="screen-home-error">
        <StateView
          kind="error"
          glyph={presentation.glyph}
          title={presentation.title}
          actionLabel={presentation.actionLabel}
          onAction={state.reload}
          testID="state-home-error"
        />
      </Screen>
    );
  }

  const { categories, shops } = state.data;
  const visibleShops = selectedCategory
    ? shops.filter((s) => s.cuisine?.includes(selectedCategory) ?? false)
    : shops;

  // Two different emptiness, two different copies:
  //   shops.length === 0        → nothing in the district at all (UX-SPEC § 13)
  //   visibleShops.length === 0 → the chosen category filtered everything out
  // The second is a client-side filter with no spec'd copy of its own; the
  // existing "ไม่พบร้านในหมวดนี้" wording is kept as the documented
  // interpretation rather than reusing the district-empty copy for a
  // different situation.
  const noRestaurantsAtAll = shops.length === 0;

  return (
    <Screen scroll testID="screen-home">
      <View style={styles.header}>
        <Text style={styles.greeting}>สั่งอะไรดีวันนี้</Text>
        <Text style={styles.location}>📍 อ.บุณฑริก จ.อุบลราชธานี</Text>
      </View>

      <Pressable
        style={styles.searchBar}
        onPress={() => navigation.navigate('Search')}
        accessibilityRole="search"
        accessibilityLabel="ค้นหาร้านหรือเมนู"
        testID="home-search-bar"
      >
        <Text style={styles.searchIcon}>🔍</Text>
        <Text style={styles.searchPlaceholder}>ค้นหาร้านหรือเมนู</Text>
      </Pressable>

      <SectionHeader title="หมวดหมู่" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            icon={c.icon}
            name={c.name}
            selected={selectedCategory === c.name}
            onPress={() => setSelectedCategory((prev) => (prev === c.name ? null : c.name))}
          />
        ))}
      </ScrollView>

      <SectionHeader title="ร้านใกล้คุณ" />
      {noRestaurantsAtAll ? (
        <StateView
          kind="empty"
          glyph="🍽️"
          title="ยังไม่มีร้านในพื้นที่นี้"
          actionLabel="เปลี่ยนพื้นที่จัดส่ง"
          // C-20 (district/area selection) is not built yet — there is no
          // screen to navigate to. Reloading is the only existing mechanism
          // available; this label is the spec's wording, not a promise that
          // tapping it opens an area picker.
          onAction={state.reload}
          testID="state-home-empty"
        />
      ) : visibleShops.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🔍"
          title="ไม่พบร้านในหมวดนี้"
          message="ลองเลือกหมวดหมู่อื่นดู"
          testID="state-home-empty-category"
        />
      ) : (
        visibleShops.map((shop) => (
          <ShopCard
            key={shop.id}
            name={shop.name}
            glyph={SHOP_PLACEHOLDER_GLYPH}
            rating={formatRating(shop.ratingAvg) ?? undefined}
            // PC-Q-002: distance and delivery fee have no authoritative
            // source, so the meta line carries only what the catalog knows;
            // today's hours are appended per UX-SPEC § 5.3 ("open/closed with
            // today's hours").
            meta={[formatShopMeta(shop), shop.todayHours].filter(Boolean).join(' · ')}
            badge={{ label: shop.isOpen ? 'เปิดอยู่' : 'ปิดอยู่', tone: shop.isOpen ? 'success' : 'neutral' }}
            closed={!shop.isOpen}
            onPress={() => navigation.navigate('Shop', { shopId: shop.id })}
            testID={`shop-card-${shop.id}`}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, gap: spacing.xs },
  greeting: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
  location: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: spacing.md,
  },
  searchIcon: { fontFamily: fontFamily.regular, fontSize: fontSize.xl },
  searchPlaceholder: { fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.textFaint },
  chipRow: { gap: spacing.sm, paddingBottom: spacing.sm },
});
