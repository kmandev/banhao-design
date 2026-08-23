import { useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  BottomBar,
  Button,
  Input,
  StateView,
  colors,
  fontFamily,
  fontSize,
  radius,
  spacing,
} from '@banhao/ui';
import { thaiPhoneSchema } from '@banhao/validation';
import { Screen } from '../components/Screen';
import { useAsyncData } from '../hooks/useAsyncData';
import { useAuth } from '../hooks/useAuth';
import { formatThaiPhone } from '../lib/phone';
import { repositories } from '../repositories';
import type { AddressPatchInput, AddressWriteInput } from '../repositories/types';
import type { Address } from '../mocks/types';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;
type FormRoute = RouteProp<CustomerStackParamList, 'AddressForm'>;

const LABEL_CHIPS = ['บ้าน', 'ที่ทำงาน', 'อื่นๆ'] as const;
type LabelChip = (typeof LABEL_CHIPS)[number];

const NAME_MIN_LENGTH = 2;
const ADDRESS_MIN_LENGTH = 10;
const LABEL_MAX_LENGTH = 60;
const LANDMARK_MAX_LENGTH = 60;
const INSTRUCTIONS_MAX_LENGTH = 120;
const INSTRUCTIONS_COUNTER_FROM = 100;

interface FormValues {
  labelChip: LabelChip | null;
  labelCustomText: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  landmark: string;
  instructions: string;
  isDefault: boolean;
}

const EMPTY_VALUES: FormValues = {
  labelChip: null,
  labelCustomText: '',
  recipientName: '',
  recipientPhone: '',
  addressLine: '',
  landmark: '',
  instructions: '',
  isDefault: false,
};

interface FormErrors {
  recipientName?: string;
  recipientPhone?: string;
  addressLine?: string;
}

/**
 * Accepts `0812345678`, `081-234-5678`, or `+66812345678`; rejects anything
 * else (design's validation table + `TESTS REQUIRED`). The result is always
 * checked against `thaiPhoneSchema` — the same schema the server enforces —
 * so this can reject a legitimate number formatted oddly but can never accept
 * one the API would refuse.
 */
function normalizeThaiPhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');

  if (hasPlus && digits.startsWith('66') && digits.length === 11) return `+${digits}`;
  if (!hasPlus && digits.startsWith('0') && digits.length === 10) return `+66${digits.slice(1)}`;
  return null;
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (values.recipientName.trim().length < NAME_MIN_LENGTH) {
    errors.recipientName = 'กรุณากรอกชื่อผู้รับ';
  }

  if (values.recipientPhone.trim().length === 0) {
    errors.recipientPhone = 'กรุณากรอกเบอร์โทร';
  } else {
    const normalized = normalizeThaiPhone(values.recipientPhone);
    if (!normalized || !thaiPhoneSchema.safeParse(normalized).success) {
      errors.recipientPhone = 'เบอร์โทรไม่ถูกต้อง ใส่เบอร์มือถือ 10 หลัก';
    }
  }

  if (values.addressLine.trim().length === 0) {
    errors.addressLine = 'กรุณากรอกที่อยู่';
  } else if (values.addressLine.trim().length < ADDRESS_MIN_LENGTH) {
    errors.addressLine = 'ใส่ที่อยู่ให้ครบ เช่น บ้านเลขที่ หมู่ ตำบล อำเภอ';
  }

  return errors;
}

function resolvedLabel(values: FormValues): string | null {
  if (values.labelChip === 'อื่นๆ') {
    const custom = values.labelCustomText.trim();
    return custom.length > 0 ? custom : null;
  }
  return values.labelChip;
}

function toWriteInput(values: FormValues, normalizedPhone: string): AddressWriteInput {
  const label = resolvedLabel(values);
  const landmark = values.landmark.trim();
  const instructions = values.instructions.trim();

  return {
    label: label ?? undefined,
    recipientName: values.recipientName.trim(),
    recipientPhone: normalizedPhone,
    addressLine: values.addressLine.trim(),
    landmark: landmark.length > 0 ? landmark : undefined,
    instructions: instructions.length > 0 ? instructions : undefined,
    isDefault: values.isDefault,
  };
}

/** DQ-04-05: PATCH sends changed fields only, diffed against the loaded row. */
function buildPatch(existing: Address, input: AddressWriteInput): AddressPatchInput {
  const patch: AddressPatchInput = {};

  if ((input.label ?? null) !== existing.rawLabel) patch.label = input.label ?? null;
  if (input.recipientName !== existing.recipientName) patch.recipientName = input.recipientName;
  if (input.recipientPhone !== existing.recipientPhone) patch.recipientPhone = input.recipientPhone;
  if (input.addressLine !== existing.addressLine) patch.addressLine = input.addressLine;
  if ((input.landmark ?? null) !== existing.landmark) patch.landmark = input.landmark ?? null;
  if ((input.instructions ?? null) !== existing.instructions) {
    patch.instructions = input.instructions ?? null;
  }
  if (input.isDefault !== existing.isDefault) patch.isDefault = input.isDefault;

  return patch;
}

/**
 * C-11a AddressFormScreen — create and edit share this one screen via
 * `route.params.mode` (DQ-04-05). Edit mode receives only `addressId`
 * (the design's own conceptual route), so it resolves the record from
 * `listAddresses()` rather than a dedicated single-address endpoint — the
 * list response already carries every raw field this form needs, and adding
 * a `getAddress(id)` endpoint would duplicate data the API already returns.
 */
export function AddressFormScreen() {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<FormRoute>();
  const { profile } = useAuth();
  const mode = params.mode;
  const addressId = params.mode === 'edit' ? params.addressId : undefined;

  const state = useAsyncData(() => repositories.addresses.listAddresses());

  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [existing, setExisting] = useState<Address | null>(null);
  const [existingCount, setExistingCount] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const initialSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: mode === 'edit' ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่ใหม่' });
  }, [navigation, mode]);

  useEffect(() => {
    if (state.status !== 'success' || initializedRef.current) return;
    initializedRef.current = true;

    setExistingCount(state.data.length);

    if (mode === 'create') {
      const next: FormValues = {
        ...EMPTY_VALUES,
        recipientName: profile?.displayName ?? '',
        recipientPhone: profile?.phone ? formatThaiPhone(profile.phone) : '',
        isDefault: state.data.length === 0,
      };
      setValues(next);
      return;
    }

    const found = state.data.find((address) => address.id === addressId) ?? null;
    setExisting(found);
    if (!found) return;

    const chip: LabelChip | null =
      found.rawLabel && (LABEL_CHIPS as readonly string[]).includes(found.rawLabel)
        ? (found.rawLabel as LabelChip)
        : found.rawLabel
          ? 'อื่นๆ'
          : null;

    const next: FormValues = {
      labelChip: chip,
      labelCustomText: chip === 'อื่นๆ' ? (found.rawLabel ?? '') : '',
      recipientName: found.recipientName,
      recipientPhone: formatThaiPhone(found.recipientPhone),
      addressLine: found.addressLine,
      landmark: found.landmark ?? '',
      instructions: found.instructions ?? '',
      isDefault: found.isDefault,
    };
    setValues(next);
    initialSnapshotRef.current = JSON.stringify(next);
    // Runs once, guarded by `initializedRef` — `mode`/`addressId`/`profile`
    // are stable for the lifetime of this screen.
  }, [state.status]);

  // DQ-04 handoff, "FORM STATE": unsaved-changes guard on back, edit mode only.
  useEffect(() => {
    if (mode !== 'edit') return undefined;

    return navigation.addListener('beforeRemove', (e) => {
      const isDirty =
        initialSnapshotRef.current !== null &&
        initialSnapshotRef.current !== JSON.stringify(values);
      if (!isDirty || saving) return;

      e.preventDefault();
      Alert.alert('ทิ้งการแก้ไข?', undefined, [
        { text: 'แก้ไขต่อ', style: 'cancel' },
        {
          text: 'ทิ้งการแก้ไข',
          style: 'destructive',
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
  }, [navigation, mode, values, saving]);

  if (state.status === 'loading') {
    return (
      <Screen testID="screen-address-form-loading">
        <StateView kind="loading" title="กำลังโหลด…" />
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen testID="screen-address-form-error">
        <StateView
          kind="error"
          glyph="📡"
          title="โหลดข้อมูลไม่สำเร็จ"
          message={state.message}
          actionLabel="ลองใหม่"
          onAction={state.reload}
        />
      </Screen>
    );
  }

  if (mode === 'edit' && !existing) {
    return (
      <Screen testID="screen-address-form-not-found">
        <StateView
          kind="empty"
          glyph="📍"
          title="ไม่พบที่อยู่นี้"
          actionLabel="กลับ"
          onAction={() => navigation.goBack()}
        />
      </Screen>
    );
  }

  const errors = submitted ? validate(values) : {};
  const requiredFilled =
    values.recipientName.trim().length > 0 &&
    values.recipientPhone.trim().length > 0 &&
    values.addressLine.trim().length > 0;

  const isDefaultLocked = mode === 'create' ? existingCount === 0 : (existing?.isDefault ?? false);
  const defaultHint =
    mode === 'create'
      ? isDefaultLocked
        ? 'ที่อยู่แรกของคุณจะเป็นที่อยู่หลักโดยอัตโนมัติ'
        : 'เลือกได้ว่าจะให้ที่อยู่นี้เป็นค่าเริ่มต้นหรือไม่'
      : isDefaultLocked
        ? 'ตั้งที่อยู่อื่นเป็นหลักเพื่อเปลี่ยน'
        : 'ใช้ที่อยู่นี้เป็นค่าเริ่มต้นตอนสั่งอาหาร';

  const canArchive = mode === 'edit' && existing ? !(existing.isDefault && existingCount > 1) : false;

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function onSubmit() {
    if (saving) return;
    setSubmitted(true);

    const currentErrors = validate(values);
    if (Object.keys(currentErrors).length > 0) return;

    const normalizedPhone = normalizeThaiPhone(values.recipientPhone);
    if (!normalizedPhone) return;

    const input = toWriteInput(values, normalizedPhone);

    setSaving(true);
    setApiError(null);

    try {
      if (mode === 'create') {
        const created = await repositories.addresses.createAddress(input);
        navigation.navigate('Address', { selectedId: created.id, toast: 'บันทึกที่อยู่แล้ว' });
        return;
      }

      if (!existing) return;
      const patch = buildPatch(existing, input);

      if (Object.keys(patch).length === 0) {
        navigation.navigate('Address', { selectedId: existing.id, toast: 'บันทึกการแก้ไขแล้ว' });
        return;
      }

      const updated = await repositories.addresses.updateAddress(existing.id, patch);
      navigation.navigate('Address', { selectedId: updated.id, toast: 'บันทึกการแก้ไขแล้ว' });
    } catch {
      setSaving(false);
      setApiError('บันทึกที่อยู่ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
  }

  function onPressDelete() {
    if (!existing || !canArchive) return;

    Alert.alert(
      'ลบที่อยู่นี้?',
      `ที่อยู่ "${existing.label}" จะถูกนำออกจากรายการของคุณ ออเดอร์ที่สั่งไปแล้วยังเก็บที่อยู่เดิมไว้ตามปกติ`,
      [
        { text: 'ยกเลิก', style: 'cancel' },
        { text: 'ลบที่อยู่', style: 'destructive', onPress: () => void onConfirmDelete() },
      ],
    );
  }

  async function onConfirmDelete() {
    if (!existing) return;
    setSaving(true);
    try {
      await repositories.addresses.archiveAddress(existing.id);
      navigation.navigate('Address', { toast: 'ลบที่อยู่แล้ว' });
    } catch {
      setSaving(false);
      Alert.alert('ลบที่อยู่ไม่สำเร็จ', 'กรุณาลองอีกครั้ง');
    }
  }

  return (
    <Screen
      scroll
      testID="screen-address-form"
      footer={
        <BottomBar>
          <Button
            label={mode === 'edit' ? 'บันทึกการแก้ไข' : 'บันทึกที่อยู่'}
            onPress={() => void onSubmit()}
            disabled={!requiredFilled}
            loading={saving}
            testID="button-save-address"
          />
        </BottomBar>
      }
    >
      {apiError ? (
        <View style={styles.errorBanner} testID="address-form-api-error">
          <Text style={styles.errorBannerText}>⚠️ {apiError}</Text>
          <Pressable onPress={() => void onSubmit()}>
            <Text style={styles.errorBannerRetry}>ลองใหม่</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.chipsLabel}>
          ชื่อที่อยู่ <Text style={styles.optional}>(ตัวเลือก)</Text>
        </Text>
        <View style={styles.chipsRow}>
          {LABEL_CHIPS.map((chip) => (
            <Pressable
              key={chip}
              onPress={() => set('labelChip', values.labelChip === chip ? null : chip)}
              testID={`address-label-chip-${chip}`}
              style={[styles.chip, values.labelChip === chip && styles.chipSelected]}
            >
              <Text style={[styles.chipText, values.labelChip === chip && styles.chipTextSelected]}>
                {chip}
              </Text>
            </Pressable>
          ))}
        </View>
        {values.labelChip === 'อื่นๆ' ? (
          <Input
            placeholder="เช่น บ้านแม่"
            value={values.labelCustomText}
            onChangeText={(t) => set('labelCustomText', t.slice(0, LABEL_MAX_LENGTH))}
            testID="input-address-label-custom"
          />
        ) : null}
      </View>

      <Input
        label="ผู้รับ *"
        placeholder="ชื่อผู้รับอาหาร"
        value={values.recipientName}
        onChangeText={(t) => set('recipientName', t)}
        error={errors.recipientName}
        testID="input-recipient-name"
      />

      <Input
        label="เบอร์โทร *"
        placeholder="08X-XXX-XXXX"
        keyboardType="phone-pad"
        value={values.recipientPhone}
        onChangeText={(t) => set('recipientPhone', t)}
        error={errors.recipientPhone}
        testID="input-recipient-phone"
      />

      <Input
        label="ที่อยู่ *"
        placeholder="บ้านเลขที่ หมู่ ตำบล อำเภอ จังหวัด"
        value={values.addressLine}
        onChangeText={(t) => set('addressLine', t)}
        error={errors.addressLine}
        multiline
        numberOfLines={3}
        style={styles.multiline}
        testID="input-address-line"
      />

      <Input
        label="จุดสังเกต (ตัวเลือก)"
        placeholder="เช่น ตรงข้ามตลาดสดบุณฑริก"
        value={values.landmark}
        onChangeText={(t) => set('landmark', t.slice(0, LANDMARK_MAX_LENGTH))}
        testID="input-landmark"
      />

      <View>
        <Input
          label="ข้อความถึงไรเดอร์ (ตัวเลือก)"
          placeholder="เช่น โทรก่อนถึง 5 นาที"
          value={values.instructions}
          onChangeText={(t) => set('instructions', t.slice(0, INSTRUCTIONS_MAX_LENGTH))}
          testID="input-instructions"
        />
        {values.instructions.length >= INSTRUCTIONS_COUNTER_FROM ? (
          <Text style={styles.counter}>
            {values.instructions.length}/{INSTRUCTIONS_MAX_LENGTH}
          </Text>
        ) : null}
      </View>

      <View style={[styles.defaultRow, isDefaultLocked && styles.defaultRowLocked]}>
        <View style={styles.defaultRowBody}>
          <Text style={styles.defaultRowTitle}>
            {mode === 'edit' && isDefaultLocked ? 'ที่อยู่หลัก' : 'ตั้งเป็นที่อยู่หลัก'}
          </Text>
          <Text style={styles.defaultRowHint}>{defaultHint}</Text>
        </View>
        <Switch
          value={values.isDefault}
          onValueChange={(v) => set('isDefault', v)}
          disabled={isDefaultLocked}
          trackColor={{ true: colors.primary, false: colors.borderStrong }}
          testID="switch-address-default"
        />
      </View>

      {mode === 'edit' && existing ? (
        canArchive ? (
          <Pressable onPress={onPressDelete} testID="button-delete-address" style={styles.deleteRow}>
            <Text style={styles.deleteLabel}>ลบที่อยู่นี้</Text>
          </Pressable>
        ) : (
          <Text style={styles.deleteBlockedNote} testID="address-delete-blocked-note">
            ตั้งที่อยู่อื่นเป็นค่าเริ่มต้นก่อนเพื่อลบที่อยู่นี้
          </Text>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  chipsLabel: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.textMuted },
  optional: { fontFamily: fontFamily.regular, color: colors.textSubtle },
  chipsRow: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textMuted },
  chipTextSelected: { color: colors.primaryPressed },
  multiline: { minHeight: 78, textAlignVertical: 'top' },
  counter: {
    alignSelf: 'flex-end',
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textFaint,
    marginTop: -spacing.xs,
  },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  defaultRowLocked: { opacity: 0.7 },
  defaultRowBody: { flex: 1 },
  defaultRowTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  defaultRowHint: { fontSize: fontSize.sm, fontFamily: fontFamily.regular, color: colors.textMuted, marginTop: 2 },
  deleteRow: { alignItems: 'center', paddingVertical: spacing.md },
  deleteLabel: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.danger },
  deleteBlockedNote: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textFaint,
    paddingVertical: spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#FFF1EE',
    borderWidth: 1,
    borderColor: '#F3CFC7',
  },
  errorBannerText: { flex: 1, fontSize: fontSize.base, fontFamily: fontFamily.regular, color: '#A6322A' },
  errorBannerRetry: { fontSize: fontSize.base, fontFamily: fontFamily.semibold, color: colors.primary },
});
