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
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 05 หน้าแรก, plus the design's two state variants:
 *   ⏳ กำลังโหลด  → loading
 *   📡 เน็ตมีปัญหา → error, with a retry action
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
    return (
      <Screen testID="screen-home-error">
        <StateView
          kind="error"
          glyph="📡"
          title="เน็ตมีปัญหา"
          message="เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง"
          actionLabel="ลองใหม่"
          onAction={state.reload}
          testID="state-home-error"
        />
      </Screen>
    );
  }

  const { categories, shops } = state.data;
  const visibleShops = selectedCategory
    ? shops.filter((s) => s.cuisine.includes(selectedCategory))
    : shops;

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
      {visibleShops.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🔍"
          title="ไม่พบร้านในหมวดนี้"
          message="ลองเลือกหมวดหมู่อื่นดู"
        />
      ) : (
        visibleShops.map((shop) => (
          <ShopCard
            key={shop.id}
            name={shop.name}
            glyph={shop.glyph}
            rating={shop.rating}
            meta={`${shop.cuisine} · ${shop.distanceKm} กม. · ${shop.etaMinutes} นาที`}
            badge={shop.badge}
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
