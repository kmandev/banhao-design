import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { Input, MenuRow, SectionHeader, ShopCard, StateView, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import { formatBaht } from '../mocks/pricing';
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
          glyph="📡"
          title="ค้นหาไม่สำเร็จ"
          message={state.message}
          actionLabel="ลองใหม่"
          onAction={state.reload}
        />
      ) : state.data.shops.length === 0 && state.data.items.length === 0 ? (
        <StateView
          kind="empty"
          glyph="🙈"
          title="ไม่พบผลลัพธ์"
          message={`ไม่พบร้านหรือเมนูที่ตรงกับ "${query}"`}
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
                  glyph={shop.glyph}
                  rating={shop.rating}
                  meta={`ร้าน · ${shop.distanceKm} กม. · ${shop.etaMinutes} นาที`}
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
                  description={item.description}
                  price={formatBaht(item.priceSatang)}
                  glyph={item.glyph}
                  onPress={() =>
                    navigation.navigate('ItemOptions', { shopId: item.shopId, itemId: item.id })
                  }
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
