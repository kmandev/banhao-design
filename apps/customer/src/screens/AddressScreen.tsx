import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  StateView,
  SectionHeader,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
  CheckMark,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { repositories } from '../repositories';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type AddressRoute = RouteProp<CustomerStackParamList, 'Address'>;

const TOAST_MS = 2000;

/**
 * 11 ที่อยู่จัดส่ง.
 *
 * Selection is untouched from before DQ-04. The three deltas the approved
 * design calls for (DQ-04-01, handoff "SCREENS & ROUTES") are: the dashed
 * button gets a real destination, each row gains a `แก้ไข` action, and the
 * default row gets a `ค่าเริ่มต้น` badge.
 */
export function AddressScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<AddressRoute>();
  const state = useAsyncData(() => repositories.addresses.listAddresses());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // `AddressFormScreen` returns via `navigate('Address', { selectedId, toast })`
  // rather than `goBack()`, so this screen (already mounted, further down the
  // stack) picks the new params up here instead of re-mounting.
  useEffect(() => {
    if (params?.selectedId) setSelectedId(params.selectedId);
    if (params?.toast) {
      setToast(params.toast);
      const timer = setTimeout(() => setToast(null), TOAST_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [params?.selectedId, params?.toast]);

  // Refetch on every return to this screen (design: "pop, refetch, reselect")
  // — skipping the very first focus, which `useAsyncData`'s own mount effect
  // already covers, so entering the screen does not fetch twice.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      state.reload();
    }, []),
  );

  function goToCreate() {
    navigation.navigate('AddressForm', { mode: 'create' });
  }

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
          actionLabel="+ เพิ่มที่อยู่ใหม่"
          onAction={goToCreate}
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
          {toast ? (
            <View style={styles.toast} testID="address-toast">
              <Text style={styles.toastText}>✓ {toast}</Text>
            </View>
          ) : null}
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
        {state.data.map((address) => {
          const selected = activeId === address.id;
          return (
            <Pressable
              key={address.id}
              onPress={() => setSelectedId(address.id)}
              testID={`address-${address.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.row, selected && styles.rowSelected]}
            >
              <Text style={styles.rowLeading}>{address.glyph}</Text>
              <View style={styles.rowBody}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>{address.label}</Text>
                  {address.isDefault ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>ค่าเริ่มต้น</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.rowSubtitle} numberOfLines={2}>
                  {address.line}
                </Text>
              </View>
              <View style={styles.rowTrailing}>
                {selected ? <CheckMark /> : null}
                <Pressable
                  onPress={() =>
                    navigation.navigate('AddressForm', { mode: 'edit', addressId: address.id })
                  }
                  testID={`address-edit-${address.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`แก้ไขที่อยู่ ${address.label}`}
                  hitSlop={8}
                >
                  <Text style={styles.editAction}>แก้ไข</Text>
                </Pressable>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={goToCreate}
        testID="button-add-address"
        accessibilityRole="button"
        style={styles.addRow}
      >
        <Text style={styles.addRowLabel}>+ เพิ่มที่อยู่ใหม่</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  rowSelected: { borderColor: colors.primary },
  rowLeading: { fontSize: fontSize.xxl },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  rowSubtitle: { fontSize: fontSize.sm, color: colors.textMuted, fontFamily: fontFamily.regular },
  rowTrailing: { alignItems: 'flex-end', gap: spacing.sm },
  editAction: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.primary },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAccent,
  },
  badgeText: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: '#8A6B2E' },
  addRow: {
    marginTop: spacing.md,
    height: 52,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRowLabel: { fontSize: fontSize.lg, fontFamily: fontFamily.semibold, color: colors.textMuted },
  toast: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  toastText: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.textInverse },
});
