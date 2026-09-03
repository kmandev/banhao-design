'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { thaiPhoneSchema } from '@banhao/validation';
import { useAuth } from '../../hooks/useAuth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { copy } from '../../lib/copy';
import * as styles from '../../lib/styles';

/**
 * S-01, first half — phone entry.
 *
 * Identical in shape to the merchant app's own login, deliberately: phone OTP
 * is the Phase 1 auth method for every app, and this screen grants nothing. A
 * successful sign-in only establishes *who* someone is; whether they hold a
 * `platform_staff` grant is resolved by the server on the next request.
 *
 * An unconfigured Supabase project is a hard stop. There is no mock staff
 * identity in this app and a fabricated session is forbidden outright.
 */
export default function LoginPage() {
  const router = useRouter();
  const { session, requestOtp } = useAuth();
  const [localNumber, setLocalNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      setError(copy.notConfigured);
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
    <div style={styles.centred}>
      <form
        style={styles.card}
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <div>
          <h1 style={styles.title}>{copy.signInTitle}</h1>
          <p style={styles.subtitle}>{copy.console}</p>
        </div>

        <label style={styles.label} htmlFor="phone">
          {copy.phoneLabel}
        </label>
        <input
          id="phone"
          style={styles.input}
          inputMode="tel"
          autoComplete="tel"
          placeholder={copy.phonePlaceholder}
          value={localNumber}
          onChange={(event) => setLocalNumber(event.target.value.replace(/[^0-9]/g, ''))}
        />

        {error ? <p style={styles.errorText}>{error}</p> : null}

        <button type="submit" style={styles.button(submitting)} disabled={submitting}>
          {copy.requestOtp}
        </button>
      </form>
    </div>
  );
}
