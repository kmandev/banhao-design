'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useStaff } from '../hooks/useStaff';
import { copy } from '../lib/copy';
import * as styles from '../lib/styles';

/**
 * The console frame, and the client half of the access gate.
 *
 * "Client half" is the important word. This component decides what to
 * *render*; it decides nothing about access. Every endpoint behind it
 * re-resolves the `platform_staff` grant per request and refuses on its own, so
 * a user who bypassed this component entirely would still get `FORBIDDEN` from
 * the API. That separation is deliberate — the Admin design package § 12 puts
 * it as "the UI hides what the role cannot do; the endpoint refuses regardless".
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { status, identity, reload } = useStaff();

  useEffect(() => {
    if (status === 'signed-out') router.replace('/login');
  }, [status, router]);

  if (status === 'loading' || status === 'signed-out') {
    return (
      <div style={styles.centred}>
        <p style={styles.subtitle}>{copy.loading}</p>
      </div>
    );
  }

  if (status === 'forbidden') {
    return (
      <div style={styles.centred}>
        <div style={styles.card}>
          <h1 style={styles.title}>{copy.forbiddenTitle}</h1>
          <p style={styles.subtitle}>{copy.forbiddenBody}</p>
          <button type="button" style={styles.ghostButton} onClick={() => void signOut()}>
            {copy.signOut}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={styles.centred}>
        <div style={styles.card}>
          <h1 style={styles.title}>{copy.errorTitle}</h1>
          {/* An error is not a refusal: a failed capability read must not be
              rendered as "you have no access", which would send a real
              operator away from a queue they are entitled to work. */}
          <button type="button" style={styles.ghostButton} onClick={reload}>
            {copy.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div>
          <strong>{copy.appName}</strong>
          <span style={{ ...styles.meta, marginLeft: 8 }}>{copy.console}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={styles.meta} data-testid="staff-role">
            สิทธิ์: {identity?.staffRole}
          </span>
          <button type="button" style={styles.ghostButton} onClick={() => void signOut()}>
            {copy.signOut}
          </button>
        </div>
      </header>
      <main style={styles.content}>{children}</main>
    </div>
  );
}
