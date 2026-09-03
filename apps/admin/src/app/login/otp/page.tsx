'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../hooks/useAuth';
import { copy } from '../../../lib/copy';
import * as styles from '../../../lib/styles';

/**
 * S-01, second half — OTP verification.
 *
 * The code is verified by Supabase, never by this screen: a client that decided
 * an OTP was correct would be deciding authentication, which is exactly the
 * failure mode CON-002 forbids in the payment domain and the same reasoning
 * applies here.
 */
function OtpForm() {
  const router = useRouter();
  const params = useSearchParams();
  const phone = params.get('phone') ?? '';
  const { verifyOtp } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (token.length !== 6) {
      setError('กรอกรหัส 6 หลัก');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await verifyOtp(phone, token);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      style={styles.card}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div>
        <h1 style={styles.title}>{copy.otpTitle}</h1>
        <p style={styles.subtitle}>{phone}</p>
      </div>

      <label style={styles.label} htmlFor="otp">
        {copy.otpLabel}
      </label>
      <input
        id="otp"
        style={styles.input}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={token}
        onChange={(event) => setToken(event.target.value.replace(/[^0-9]/g, ''))}
      />

      {error ? <p style={styles.errorText}>{error}</p> : null}

      <button type="submit" style={styles.button(submitting)} disabled={submitting}>
        {copy.verifyOtp}
      </button>
    </form>
  );
}

export default function OtpPage() {
  return (
    <div style={styles.centred}>
      <Suspense fallback={<p style={styles.subtitle}>{copy.loading}</p>}>
        <OtpForm />
      </Suspense>
    </div>
  );
}
