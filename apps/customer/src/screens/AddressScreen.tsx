import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { BottomBar, Button, ListRow, SectionHeader, StateView, spacing } from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 11 ที่อยู่จัดส่ง — selection only.
 *
 * The design shows selectable addresses but no add/edit form (DQ-04), so this
 * screen does not invent one.
 */
export function AddressScreen() {
  const navigation = useNavigation<Nav>();
  const state = useAsyncData(() => repositories.addresses.listAddresses());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-address-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen testID="screen-address-error">
        <StateView
          kind="error"
          glyph="📡"
          title="โหลดที่อยู่ไม่สำเร็จ"
          message={state.message}
          actionLabel="ลองใหม่"
          onAction={state.reload}
        />
      </Screen>
    );
  }

  if (state.data.length === 0) {
    return (
      <Screen testID="screen-address-empty">
        <StateView
          kind="empty"
          glyph="📍"
          title="ยังไม่มีที่อยู่"
          message="เพิ่มที่อยู่จัดส่งเพื่อสั่งอาหาร"
        />
      </Screen>
    );
  }

  const activeId = selectedId ?? state.data.find((a) => a.isDefault)?.id ?? state.data[0]?.id;

  return (
    <Screen
      scroll
      testID="screen-address"
      footer={
        <BottomBar>
          <Button
            label="ใช้ที่อยู่นี้"
            onPress={() => navigation.goBack()}
            testID="button-confirm-address"
          />
        </BottomBar>
      }
    >
      <SectionHeader title="เลือกที่อยู่จัดส่ง" />
      <View style={styles.list}>
        {state.data.map((address) => (
          <ListRow
            key={address.id}
            leading={address.glyph}
            title={address.label}
            subtitle={address.line}
            selected={activeId === address.id}
            onPress={() => setSelectedId(address.id)}
            testID={`address-${address.id}`}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
