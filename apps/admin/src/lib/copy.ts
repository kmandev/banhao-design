/**
 * Operator-facing Thai copy for the Human Supervisor console.
 *
 * One keyed module per app, no i18n library for a single language — the
 * convention both the Admin and AI Operations design packages state, and the
 * one `apps/merchant/src/lib/menuCopy.ts` already follows.
 *
 * Every string here describes what actually happened. Nothing announces an
 * outcome the system did not produce: a resolved case says the case was
 * closed, never that the underlying problem was fixed.
 */
export const copy = {
  appName: 'BANHAO · ผู้ดูแล',
  console: 'ศูนย์ควบคุมโดยมนุษย์',

  // Auth (S-01)
  signInTitle: 'เข้าสู่ระบบเจ้าหน้าที่',
  phoneLabel: 'เบอร์โทรศัพท์',
  phonePlaceholder: '08X-XXX-XXXX',
  requestOtp: 'ขอรหัส OTP',
  otpTitle: 'ยืนยันรหัส OTP',
  otpLabel: 'รหัส 6 หลัก',
  verifyOtp: 'ยืนยัน',
  signOut: 'ออกจากระบบ',
  forbiddenTitle: 'ไม่มีสิทธิ์เข้าถึง',
  forbiddenBody: 'บัญชีนี้ไม่มีสิทธิ์เจ้าหน้าที่ กรุณาติดต่อผู้ดูแลระบบ',
  notConfigured: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase สำหรับแอปนี้',

  // Inbox (S-02)
  inboxTitle: 'กล่องงาน',
  inboxSubtitle: 'เรื่องที่ระบบอัตโนมัติทำต่อเองไม่ได้',
  inboxEmpty: 'ไม่มีเรื่องที่ต้องมีคนตัดสินใจ',
  columnSeverity: 'สถานะ',
  columnSubject: 'เรื่อง',
  columnReason: 'สาเหตุ',
  columnAge: 'ค้างมานาน',
  stateOpen: 'ต้องมีคนดู',
  stateResolved: 'ปิดแล้ว',
  countOpen: 'รอดำเนินการ',
  countResolved: 'ปิดแล้ว',
  windowNote: 'ตัวเลขนับเฉพาะรายการที่แสดงในหน้านี้',

  // Case detail (S-03)
  caseTitle: 'รายละเอียดเหตุการณ์',
  whatHappened: 'สิ่งที่เกิดขึ้น',
  evidence: 'หลักฐาน',
  subject: 'สถานะปัจจุบัน',
  subjectLive: 'อ่านจากระบบจริง ณ เวลาที่เปิดหน้านี้',
  subjectUnavailable: 'อ่านสถานะปัจจุบันไม่ได้',
  timeline: 'ไทม์ไลน์',
  blockedTitle: 'ยังไม่มีคำสั่งให้เลือกในหน้านี้',
  resolvedBy: 'ปิดเคสแล้ว',

  // Resolve (S-06)
  resolveTitle: 'ปิดเคส',
  outcomeLabel: 'ผลลัพธ์',
  outcomeResolved: 'แก้ไขเรียบร้อย',
  outcomeNoAction: 'ปิดโดยไม่ต้องทำอะไร',
  outcomeAwaitingPolicy: 'รอการตัดสินใจเชิงนโยบาย',
  reasonLabel: 'เหตุผล',
  reasonHint: 'บันทึกถาวรและแก้ไขไม่ได้ · ต้องระบุ',
  submit: 'บันทึกและปิดเคส',
  submitting: 'กำลังบันทึก…',
  alreadyResolved: 'เคสนี้ถูกปิดไปแล้ว',

  // Shared states
  loading: 'กำลังโหลด…',
  errorTitle: 'โหลดข้อมูลไม่สำเร็จ',
  retry: 'ลองใหม่',
  back: 'กลับ',
} as const;

/** `ESC-…` ids, as named by the AI Operations design package § 08. Unknown ids render as-is. */
export const escalationCopy: Readonly<Record<string, string>> = Object.freeze({
  'ESC-NORIDER': 'ไม่มีไรเดอร์รับงาน',
  'ESC-UNKNOWN': 'ระบบไม่รู้ว่าต้องทำอะไรต่อ',
  'ESC-DOMAIN-REJECT': 'คำสั่งถูกระบบปฏิเสธ',
  'ESC-RETRY-EXHAUSTED': 'ลองใหม่จนครบแล้วยังไม่สำเร็จ',
  'ESC-LOOP': 'ระบบทำซ้ำวนไม่จบ',
});

export function escalationLabel(id: string): string {
  return escalationCopy[id] ?? id;
}

/** "14 นาที" / "3 ชั่วโมง" / "2 วัน" — an age, never a threshold judgement. */
export function ageLabel(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));

  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds} วินาที`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} นาที`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชั่วโมง`;
  return `${Math.floor(seconds / 86400)} วัน`;
}
