'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { verifyOtpSchema } from '@banhao/validation';
import { useAuth } from '../../../hooks/useAuth';
import { isSupabaseConfigured } from '../../../lib/supabase';
import { Spinner } from '../../../components/Spinner';
import * as styles from '../../../lib/styles';

const RESEND_SECONDS = 60;

function OtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') ?? '';
  const { session, verifyOtp, requestOtp } = useAuth();

  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (session) router.replace('/');
  }, [session, router]);

  useEffect(() => {
    if (!phone) router.replace('/login');
  }, [phone, router]);

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
      // Session state updates asynchronously via onAuthStateChange; the
      // effect above redirects once `session` is set. Nothing to navigate
      // to here directly, and no route is pushed on failure.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The countdown resets only if the resend actually succeeded — resetting
   * it on failure would tell the merchant a code is on its way when none
   * was sent.
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

  if (!phone) return <Spinner />;

  return (
    <div style={styles.page}>
      <form
        style={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          onVerify();
        }}
      >
        <div>
          <h1 style={styles.title}>ยืนยัน OTP</h1>
          <p style={styles.subtitle}>ส่งรหัส 6 หลักไปที่ {phone}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="otp" style={styles.label}>
            รหัสยืนยัน
          </label>
          <input
            id="otp"
            data-testid="input-otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            value={token}
            onChange={(e) => {
              setToken(e.target.value.replace(/[^0-9]/g, ''));
              setError(null);
            }}
            style={styles.input}
          />
          {error ? (
            <p style={styles.errorText} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          data-testid="button-verify-otp"
          disabled={!isValid || submitting}
          style={styles.button(!isValid || submitting)}
        >
          {submitting ? 'กำลังยืนยัน…' : 'ยืนยัน'}
        </button>

        <button
          type="button"
          data-testid="button-resend-otp"
          disabled={secondsLeft > 0 || resending}
          onClick={onResend}
          style={styles.ghostButton}
        >
          {secondsLeft > 0 ? `ขอรหัสใหม่ใน ${secondsLeft} วินาที` : resending ? 'กำลังส่ง…' : 'ขอรหัสใหม่'}
        </button>

        <button type="button" style={styles.ghostButton} onClick={() => router.push('/login')}>
          เปลี่ยนเบอร์
        </button>
      </form>
    </div>
  );
}

export default function OtpPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <OtpForm />
    </Suspense>
  );
}
