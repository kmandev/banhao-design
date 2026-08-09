import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  Button,
  Card,
  Input,
  ListRow,
  SectionHeader,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '@banhao/ui';
import { Screen } from '../components/Screen';
import { useAuth } from '../hooks/useAuth';

/**
 * 18 บัญชีของฉัน.
 *
 * The only screen backed by a real backend: it reads and writes `profiles`
 * through Supabase with RLS enforced. Only display_name is editable — role,
 * id, and phone are rejected by column privileges and a database trigger
 * (supabase/migrations/20260809000003_harden_profiles_rls.sql), so this screen
 * does not offer them.
 */
export function ProfileScreen() {
  const { profile, profileError, session, updateDisplayName, signOut } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const displayName = profile?.displayName ?? 'ยังไม่ได้ตั้งชื่อ';
  const phone = profile?.phone ?? session?.user.phone ?? '—';

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

      <ListRow leading="📍" title="ที่อยู่จัดส่ง" subtitle="จัดการที่อยู่ของคุณ" />
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
  name: { fontSize: fontSize.h3, fontWeight: fontWeight.bold, color: colors.textPrimary },
  phone: { fontSize: fontSize.md, color: colors.textMuted },
  editCard: { gap: spacing.md },
  error: { fontSize: fontSize.sm, color: colors.danger },
  signOut: { marginTop: spacing.xl },
});
