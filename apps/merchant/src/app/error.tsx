'use client';

import { useEffect } from 'react';
import * as styles from '../lib/styles';

/**
 * Next.js App Router's route-segment error boundary — the M-1 brief's "500"
 * case for a render/runtime failure. Deliberately does not claim anything
 * succeeded; `reset()` re-renders the segment rather than pretending the
 * error didn't happen.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>เกิดข้อผิดพลาด</h1>
        <p style={styles.subtitle}>ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง</p>
        <button type="button" style={styles.button(false)} onClick={reset}>
          ลองอีกครั้ง
        </button>
      </div>
    </div>
  );
}
