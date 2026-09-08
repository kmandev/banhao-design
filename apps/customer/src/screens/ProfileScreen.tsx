import { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Input,
  ListRow,
  SectionHeader,
  colors,
  fontFamily,
  fontSize,
  spacing,
} from '@banhao/ui';
import { emailSchema } from '@banhao/validation';
import { Screen } from '../components/Screen';
import { useAuth } from '../hooks/useAuth';
import { formatThaiPhone } from '../lib/phone';
import type { CustomerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerStackParamList>;

/**
 * 18 บัญชีของฉัน.
 *
 * The only screen backed by a real backend. `display_name` reads and writes
 * `profiles` directly through Supabase with RLS enforced — role, id, and
 * phone are rejected by column privileges and a database trigger
 * (supabase/migrations/20260809000003_harden_profiles_rls.sql), so this
 * screen does not offer them.
 *
 * The payment email (DEC-056) is the one other field this screen edits, and
 * it writes through the NestJS API (`PATCH /api/v1/me`, `useAuth.updateEmail`)
 * rather than direct-to-Supabase — DEC-APP-008 routes profile writes other
 * than `display_name` through the API, and this is where the server-side
 * `emailSchema` validation actually runs. Collected here, at the customer's
 * own moment of choosing, never at phone-OTP signup — DEC-056 clause 2 — and
 * never required to use any other part of the app.
 */
export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { profile, profileError, session, updateDisplayName, updateEmail, signOut } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [editingEmail, setEditingEmail] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaveError, setEmailSaveError] = useState<string | null>(null);

  const displayName = profile?.displayName ?? 'ยังไม่ได้ตั้งชื่อ';
  // Display only. The stored identity keeps its E.164 form.
  const phone = formatThaiPhone(profile?.phone ?? session?.user.phone) || '—';

  const draftEmailValid = emailSchema.safeParse(draftEmail).success;

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await updateDisplayName(draftName.trim());
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEmail() {
    // The button is disabled unless draftEmailValid, but re-checked here too
    // (DEC-056 clause 3): an invalid or empty draft must never reach the API
    // as an attempt to clear the email, only ever as "nothing submitted".
    if (!draftEmailValid) return;

    setSavingEmail(true);
    setEmailSaveError(null);
    try {
      await updateEmail(draftEmail.trim());
      setEditingEmail(false);
    } catch (err) {
      setEmailSaveError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingEmail(false);
    }
  }

  function onSignOut() {
    Alert.alert('ออกจากระบบ', 'ต้องการออกจากระบบใช่หรือไม่', [
      { text: 'ยกเลิก', style: 'cancel' },
      { text: 'ออกจากระบบ', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen scroll testID="screen-profile">
      <SectionHeader title="บัญชีของฉัน" />

      <Card style={styles.identity}>
        <Avatar glyph="👤" size={72} />
        <View style={styles.identityBody}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.phone}>{phone}</Text>
        </View>
      </Card>

      {profileError ? (
        <Text style={styles.error} accessibilityRole="alert">
          โหลดโปรไฟล์ไม่สำเร็จ: {profileError}
        </Text>
      ) : null}

      {editing ? (
        <Card style={styles.editCard}>
          <Input
            label="ชื่อที่แสดง"
            value={draftName}
            onChangeText={setDraftName}
            maxLength={80}
            autoFocus
            error={saveError ?? undefined}
            testID="input-display-name"
          />
          <Button label="บันทึก" onPress={onSave} loading={saving} testID="button-save-name" />
          <Button label="ยกเลิก" variant="ghost" onPress={() => setEditing(false)} />
        </Card>
      ) : (
        <ListRow
          leading="✏️"
          title="แก้ไขชื่อที่แสดง"
          onPress={() => {
            setDraftName(profile?.displayName ?? '');
            setSaveError(null);
            setEditing(true);
          }}
          testID="row-edit-name"
        />
      )}

      {editingEmail ? (
        <Card style={styles.editCard} testID="card-edit-email">
          <Text style={styles.emailHint}>
            ใช้สำหรับดำเนินการชำระเงินและการติดต่อเรื่องการชำระเงิน/การคืนเงินเท่านั้น
          </Text>
          <Input
            label="อีเมลสำหรับชำระเงิน"
            value={draftEmail}
            onChangeText={setDraftEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            error={emailSaveError ?? (draftEmail.length > 0 && !draftEmailValid ? 'รูปแบบอีเมลไม่ถูกต้อง' : undefined)}
            testID="input-payment-email"
          />
          <Button
            label="บันทึก"
            onPress={onSaveEmail}
            loading={savingEmail}
            disabled={!draftEmailValid}
            testID="button-save-email"
          />
          <Button label="ยกเลิก" variant="ghost" onPress={() => setEditingEmail(false)} />
        </Card>
      ) : (
        <ListRow
          leading="📧"
          title="อีเมลสำหรับชำระเงิน"
          subtitle={profile?.email ?? 'ยังไม่ได้ตั้งค่า'}
          onPress={() => {
            setDraftEmail(profile?.email ?? '');
            setEmailSaveError(null);
            setEditingEmail(true);
          }}
          testID="row-edit-payment-email"
        />
      )}

      <ListRow
        leading="📍"
        title="ที่อยู่จัดส่ง"
        subtitle="จัดการที่อยู่ของคุณ"
        onPress={() => navigation.navigate('Address')}
        testID="row-profile-address"
      />
      <ListRow leading="🧾" title="ประวัติการสั่ง" />
      <ListRow leading="❓" title="ศูนย์ช่วยเหลือ" />

      <View style={styles.signOut}>
        <Button
          label="ออกจากระบบ"
          variant="secondary"
          onPress={onSignOut}
          testID="button-sign-out"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  identityBody: { flex: 1, gap: spacing.xs },
  name: { fontSize: fontSize.h3, fontFamily: fontFamily.bold, color: colors.textPrimary },
  phone: { fontFamily: fontFamily.regular, fontSize: fontSize.md, color: colors.textMuted },
  editCard: { gap: spacing.md },
  emailHint: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  error: { fontFamily: fontFamily.regular, fontSize: fontSize.sm, color: colors.danger },
  signOut: { marginTop: spacing.xl },
});
