'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { thaiPhoneSchema } from '@banhao/validation';
import { useAuth } from '../../hooks/useAuth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { consumeSessionExpired } from '../../lib/restaurantScope';
import * as styles from '../../lib/styles';

/**
 * Phone entry — first half of Phone OTP sign-in (DEC-016's Phase 1 auth
 * method). Validation uses the shared schema from @banhao/validation, so
 * this app and the backend agree on what a valid Thai number is — same
 * approach as apps/driver/src/screens/auth/LoginScreen.tsx.
 *
 * Unlike the Customer App, an unconfigured Supabase project is a hard stop:
 * there is no mock merchant and no mock restaurant membership in this app,
 * so proceeding would only lead to a screen that cannot work.
 */
export default function LoginPage() {
  const router = useRouter();
  const { session, requestOtp } = useAuth();
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    setSessionExpired(consumeSessionExpired());
  }, []);

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  // The field takes the familiar local format (081…); E.164 is assembled here.
  const e164 = `+66${localNumber.replace(/^0/, '')}`;
  const isValid = thaiPhoneSchema.safeParse(e164).success;

  async function onSubmit() {
    if (!isValid) {
      setError('กรุณากรอกเบอร์มือถือให้ถูกต้อง');
      return;
    }

    if (!isSupabaseConfigured) {
      setError('ยังไม่ได้ตั้งค่าการเชื่อมต่อ — เข้าสู่ระบบไม่ได้');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await requestOtp(e164);
      router.push(`/login/otp?phone=${encodeURIComponent(e164)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งรหัสไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <form
        style={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div>
          <h1 style={styles.title}>เข้าสู่ระบบร้านค้า</h1>
          <p style={styles.subtitle}>ใส่เบอร์มือถือเพื่อรับรหัสยืนยัน</p>
        </div>

        {sessionExpired ? (
          <p style={styles.errorText} data-testid="session-expired-banner">
            เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง
          </p>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="phone" style={styles.label}>
            เบอร์มือถือ
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={styles.subtitle}>+66</span>
            <input
              id="phone"
              data-testid="input-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="812345678"
              maxLength={9}
              value={localNumber}
              onChange={(e) => {
                setLocalNumber(e.target.value.replace(/[^0-9]/g, ''));
                setError(null);
              }}
              style={styles.input}
            />
          </div>
          {error ? (
            <p style={styles.errorText} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          data-testid="button-request-otp"
          disabled={!isValid || submitting}
          style={styles.button(!isValid || submitting)}
        >
          {submitting ? 'กำลังส่ง…' : 'ขอรหัส OTP'}
        </button>
      </form>
    </div>
  );
}
