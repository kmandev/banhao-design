import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { Input, MenuRow, SectionHeader, ShopCard, StateView, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import { formatBaht } from '../lib/money';
import {
  formatPrepEstimate,
  formatRating,
  formatShopMeta,
  ITEM_PLACEHOLDER_GLYPH,
  shopCardBadge,
  SHOP_PLACEHOLDER_GLYPH,
} from '../lib/catalogDisplay';
import { presentLoadError } from '../lib/loadError';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 06 ค้นหา — searches shops and menu items together.
 *
 * Ordering is shops-then-items; the design does not specify ranking (DQ-05).
 */
export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');

  const state = useAsyncData(() => repositories.catalog.search(query), [query]);

  const hasQuery = query.trim().length > 0;

  return (
    <Screen scroll testID="screen-search">
      <View style={styles.searchWrap}>
        <Input
          placeholder="ค้นหาร้านหรือเมนู"
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          accessibilityLabel="ค้นหาร้านหรือเมนู"
          testID="input-search"
        />
      </View>

      {!hasQuery ? (
        <StateView
          kind="info"
          glyph="🔍"
          title="ค้นหาร้านหรือเมนู"
          message="พิมพ์ชื่อร้าน หรือชื่ออาหารที่อยากกิน"
          testID="state-search-idle"
        />
      ) : state.status === 'loading' ? (
        <StateView kind="loading" title="กำลังค้นหา…" />
      ) : state.status === 'error' ? (
        <StateView
          kind="error"
          glyph={presentLoadError(state.message).glyph}
          title={presentLoadError(state.message).title}
          actionLabel={presentLoadError(state.message).actionLabel}
          onAction={state.reload}
        />
      ) : state.data.shops.length === 0 && state.data.items.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🙈"
          // UX-SPEC § 13 C-06 empty state, verbatim.
          title="ไม่พบร้านหรืออาหารที่ค้นหา"
          actionLabel="ดูร้านทั้งหมด"
          // "All shops" is the Home listing this screen was pushed over.
          onAction={() => navigation.goBack()}
          testID="state-search-empty"
        />
      ) : (
        <>
          {state.data.shops.length > 0 ? (
            <>
              <SectionHeader title="ร้าน" />
              {state.data.shops.map((shop) => (
                <ShopCard
                  key={shop.id}
                  name={shop.name}
                  glyph={SHOP_PLACEHOLDER_GLYPH}
                  rating={formatRating(shop.ratingAvg) ?? undefined}
                  // PC-Q-002: distance and delivery fee have no authoritative
                  // source; today's hours are appended per UX-SPEC § 5.3.
                  // M-13 adds the in-force preparation estimate.
                  meta={[formatShopMeta(shop), formatPrepEstimate(shop), shop.todayHours]
                    .filter(Boolean)
                    .join(' · ')}
                  badge={shopCardBadge(shop)}
                  closed={!shop.isOrderable}
                  onPress={() => navigation.navigate('Shop', { shopId: shop.id })}
                />
              ))}
            </>
          ) : null}

          {state.data.items.length > 0 ? (
            <>
              <SectionHeader title="เมนู" />
              {state.data.items.map((item) => (
                <MenuRow
                  key={item.id}
                  name={item.name}
                  description={item.description ?? undefined}
                  price={formatBaht(item.priceSatang)}
                  glyph={ITEM_PLACEHOLDER_GLYPH}
                  // PC-Q-001: search can now return sold-out items (RLS no
                  // longer hides them). UX-SPEC is silent on search-result
                  // treatment specifically, so this reuses C-07's rule — stay
                  // visible, stay unreachable — rather than inventing a new
                  // one. Same double guard as ShopScreen: MenuRow withholds
                  // onPress, and the handler re-checks.
                  unavailable={!item.isAvailable}
                  onPress={() => {
                    if (!item.isAvailable) return;
                    navigation.navigate('ItemOptions', { shopId: item.shopId, itemId: item.id });
                  }}
                />
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingTop: spacing.md, paddingBottom: spacing.sm },
});
