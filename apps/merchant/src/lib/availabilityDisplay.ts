/**
 * M-13 — the one merchant-facing error vocabulary this feature uses, matching
 * `orderBoardDisplay.ts`'s `orderActionErrorMessage` precedent: one function,
 * read by both the dialog and the header pill, so there is exactly one
 * Thai string per failure code rather than each surface writing its own.
 */
export function availabilityErrorMessage(cause: unknown): string {
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause ? (cause as { code: unknown }).code : null;

  switch (code) {
    case 'INVALID_TRANSITION':
      // The one transition M-13 explicitly does not implement
      // (PAUSED -> BUSY directly) lands here, alongside any other guard miss
      // from a concurrent change.
      return 'เปลี่ยนสถานะไม่สำเร็จ เพราะสถานะร้านเปลี่ยนไปแล้ว · ลองอีกครั้ง';
    case 'NOT_RESTAURANT_MEMBER':
    case 'FORBIDDEN':
      return 'ไม่มีสิทธิ์เปลี่ยนสถานะร้านนี้ · ติดต่อผู้ดูแลระบบ';
    case 'NOT_FOUND':
      return 'ไม่พบร้านนี้';
    case 'UNAUTHORIZED':
      return 'เซสชันหมดอายุ · เข้าสู่ระบบใหม่อีกครั้ง';
    default:
      return 'ทำรายการไม่สำเร็จ · ลองอีกครั้ง';
  }
}
