import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Input, colors, fontSize, fontWeight, spacing } from '@banhao/ui';
import { thaiPhoneSchema } from '@banhao/validation';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../hooks/useAuth';
import { isSupabaseConfigured } from '../../lib/supabase';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

/**
 * 03 เข้าสู่ระบบ — phone entry.
 *
 * Validation uses the shared schema from @banhao/validation so the client and
 * the backend agree on what a valid Thai number is (brief §12).
 */
export function LoginScreen({ navigation }: Props) {
  const { requestOtp } = useAuth();
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The field takes the familiar local format (081…); E.164 is assembled here.
  const e164 = `+66${localNumber.replace(/^0/, '')}`;
  const isValid = thaiPhoneSchema.safeParse(e164).success;

  async function onSubmit() {
    if (!isValid) {
      setError('กรุณากรอกเบอร์มือถือให้ถูกต้อง');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // Without credentials the app still runs on mock data, so proceed to the
      // OTP screen rather than blocking UI work behind a Supabase project.
      if (isSupabaseConfigured) {
        await requestOtp(e164);
      }
      navigation.navigate('Otp', { phone: e164 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งรหัสไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll testID="screen-login">
      <View style={styles.header}>
        <Text style={styles.title}>เข้าสู่ระบบ</Text>
        <Text style={styles.copy}>ใส่เบอร์มือถือเพื่อรับรหัสยืนยัน</Text>
      </View>

      <Input
        label="เบอร์มือถือ"
        prefix="+66"
        placeholder="81 234 5678"
        keyboardType="phone-pad"
        autoComplete="tel"
        maxLength={10}
        value={localNumber}
        onChangeText={(text) => {
          setLocalNumber(text.replace(/[^0-9]/g, ''));
          setError(null);
        }}
        error={error ?? undefined}
        testID="input-phone"
      />

      <Button
        label="ขอรหัส OTP"
        onPress={onSubmit}
        disabled={!isValid}
        loading={submitting}
        testID="button-request-otp"
      />

      {!isSupabaseConfigured ? (
        <Text style={styles.notice}>
          ยังไม่ได้ตั้งค่า Supabase — โหมดตัวอย่างสำหรับพัฒนา UI เท่านั้น
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.h2, fontWeight: fontWeight.bold, color: colors.textPrimary },
  copy: { fontSize: fontSize.lg, color: colors.textMuted },
  notice: {
    fontSize: fontSize.sm,
    color: colors.textSubtle,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
