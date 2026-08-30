import Link from 'next/link';
import * as styles from '../lib/styles';

export default function NotFound() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>ไม่พบหน้านี้</h1>
        <p style={styles.subtitle}>ลิงก์อาจไม่ถูกต้องหรือหน้านี้ถูกย้ายแล้ว</p>
        <Link href="/" style={{ textAlign: 'center' }}>
          <span style={styles.button(false)}>กลับหน้าหลัก</span>
        </Link>
      </div>
    </div>
  );
}
