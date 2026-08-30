'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import * as styles from '../../lib/styles';

/**
 * The 403 case: an authenticated user with zero active restaurant
 * memberships, or a stored restaurant scope this merchant no longer
 * belongs to. Deliberately does NOT sign the user out automatically —
 * membership can be granted after the fact (an owner adds them to a
 * restaurant), and a merchant who is correctly authenticated but not yet
 * provisioned should be able to just reload, not be forced to re-verify by
 * OTP.
 */
export default function UnauthorizedPage() {
  const router = useRouter();
  const { session, signOut } = useAuth();

  useEffect(() => {
    if (!session) router.replace('/login');
  }, [session, router]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>ไม่พบร้านอาหารที่คุณมีสิทธิ์จัดการ</h1>
        <p style={styles.subtitle}>คุณไม่มีสิทธิ์เข้าถึงร้านนี้ กรุณาติดต่อผู้ดูแลร้านของคุณ</p>
        <button type="button" style={styles.button(false)} onClick={() => router.replace('/')}>
          ลองอีกครั้ง
        </button>
        <button type="button" style={styles.ghostButton} onClick={() => signOut()}>
          ออกจากระบบ
        </button>
      </div>
    </div>
  );
}
