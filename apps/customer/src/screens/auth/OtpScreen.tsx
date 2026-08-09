import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Input, colors, fontSize, fontWeight, spacing } from '@banhao/ui';
import { verifyOtpSchema } from '@banhao/validation';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../hooks/useAuth';
import { isSupabaseConfigured } from '../../lib/supabase';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

const RESEND_SECONDS = 60;

/**
 * 04 ยืนยัน OTP.
 *
 * On success the auth state changes and RootNavigator swaps to the customer
 * tree — this screen does not navigate itself.
 */
export function OtpScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const { verifyOtp } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const isValid = verifyOtpSchema.safeParse({ phone, token }).success;

  async function onVerify() {
    setError(null);
    setSubmitting(true);

    try {
      if (isSupabaseConfigured) {
        await verifyOtp(phone, token);
      } else {
        setError('ยังไม่ได้ตั้งค่า Supabase — ยืนยันรหัสจริงไม่ได้ในโหมดตัวอย่าง');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll testID="screen-otp">
      <View style={styles.header}>
        <Text style={styles.title}>ยืนยัน OTP</Text>
        <Text style={styles.copy}>ส่งรหัส 6 หลักไปที่ {phone}</Text>
      </View>

      <Input
        label="รหัสยืนยัน"
        placeholder="000000"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        maxLength={6}
        value={token}
        onChangeText={(text) => {
          setToken(text.replace(/[^0-9]/g, ''));
          setError(null);
        }}
        error={error ?? undefined}
        testID="input-otp"
      />

      <Button
        label="ยืนยัน"
        onPress={onVerify}
        disabled={!isValid}
        loading={submitting}
        testID="button-verify-otp"
      />

      <Button
        label={secondsLeft > 0 ? `ขอรหัสใหม่ใน ${secondsLeft} วินาที` : 'ขอรหัสใหม่'}
        variant="ghost"
        disabled={secondsLeft > 0}
        onPress={() => setSecondsLeft(RESEND_SECONDS)}
      />

      <Button label="เปลี่ยนเบอร์" variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.h2, fontWeight: fontWeight.bold, color: colors.textPrimary },
  copy: { fontSize: fontSize.lg, color: colors.textMuted },
});
