import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Input, colors, fontFamily, fontSize, spacing } from '@banhao/ui';
import { verifyOtpSchema } from '@banhao/validation';
import { Screen } from '../../components/Screen';
import { useAuth } from '../../hooks/useAuth';
import { isSupabaseConfigured } from '../../lib/supabase';
import type { AuthStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<AuthStackParamList, 'Otp'>;

const RESEND_SECONDS = 60;

/**
 * R-01 (second step) ยืนยัน OTP.
 *
 * On success the session changes and `RootNavigator` swaps to the rider tree —
 * this screen does not navigate itself.
 */
export function OtpScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const { verifyOtp, requestOtp } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const isValid = verifyOtpSchema.safeParse({ phone, token }).success;

  async function onVerify() {
    if (!isSupabaseConfigured) {
      setError('ยังไม่ได้ตั้งค่าการเชื่อมต่อ — ยืนยันรหัสไม่ได้');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await verifyOtp(phone, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Asks Supabase Auth for a new code. The countdown is reset only if the
   * request actually succeeded — resetting it on failure would tell the rider a
   * code is on its way when none was sent (the Customer App's DEF-02).
   */
  async function onResend() {
    if (!isSupabaseConfigured) {
      setError('ยังไม่ได้ตั้งค่าการเชื่อมต่อ — ขอรหัสใหม่ไม่ได้');
      return;
    }

    setError(null);
    setResending(true);

    try {
      await requestOtp(phone);
      setToken('');
      setSecondsLeft(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ขอรหัสใหม่ไม่สำเร็จ');
    } finally {
      setResending(false);
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
        disabled={secondsLeft > 0 || resending}
        loading={resending}
        onPress={onResend}
        testID="button-resend-otp"
      />

      <Button label="เปลี่ยนเบอร์" variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xxl, paddingBottom: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.h2, fontFamily: fontFamily.bold, color: colors.textPrimary },
  copy: { fontFamily: fontFamily.regular, fontSize: fontSize.lg, color: colors.textMuted },
});
