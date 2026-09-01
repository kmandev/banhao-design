import type { HoursValidationCode } from '@banhao/validation';

/**
 * Thai copy for M-11 and M-12, keyed rather than inlined.
 *
 * DEC-APP-012 puts each app's user-facing strings in its own copy module,
 * keyed by state and error code, so a screen never holds a literal. Every
 * string below is transcribed from the design artifacts — none is composed
 * here, and the two destructive-copy rules are load-bearing:
 *
 *   - The removal action is `นำออกจากเมนู`, never `ลบ`. The database refuses a
 *     DELETE and history must keep pointing at the row, so copy that promised
 *     deletion would be a lie (M11-D06).
 *   - The hours failure copy does not claim the previous week survived.
 *     Delete-then-insert means a failure can leave zero rows, so
 *     "your previous hours are unchanged" would not be true in every outcome
 *     (M12-D08).
 */

export const menuCopy = {
  navMenu: 'เมนู',
  navRestaurant: 'ร้านของฉัน',

  pageTitle: 'เมนู',
  manageCategories: 'จัดการหมวดหมู่',
  addItem: '+ เพิ่มรายการอาหาร',
  addItemToCategory: '+ เพิ่มรายการในหมวดนี้',

  available: 'พร้อมขาย',
  unavailable: 'ปิดขายวันนี้',
  availabilityLabel: (name: string) => `สถานะการขาย: ${name}`,
  availabilityAnnouncement: (isAvailable: boolean) =>
    isAvailable ? 'พร้อมขายแล้ว' : 'ปิดขายวันนี้แล้ว',
  availabilityFailed: 'เปลี่ยนสถานะไม่สำเร็จ · ลองอีกครั้ง',

  optionCount: (count: number) => `${count} ตัวเลือก`,
  itemCount: (count: number) => `${count} รายการ`,
  categoryPosition: (position: number) => `ลำดับที่ ${position}`,
  summary: (items: number, unavailable: number) =>
    unavailable > 0
      ? `เมนู · ${items} รายการ · ปิดขายวันนี้ ${unavailable} รายการ`
      : `เมนู · ${items} รายการ`,

  // Page states — M-11 §09
  loading: 'กำลังโหลดเมนู',
  loadFailed: 'โหลดเมนูไม่สำเร็จ',
  loadFailedHint: 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง',
  forbidden: 'คุณไม่มีสิทธิ์ดูเมนูของร้านนี้',
  retry: 'ลองอีกครั้ง',
  emptyTitle: 'ยังไม่มีรายการอาหาร',
  emptyBody: 'เริ่มจากสร้างหมวดหมู่ เช่น อาหารจานเดียว แล้วเพิ่มรายการอาหารเข้าไป',
  emptyCta: '+ สร้างหมวดหมู่แรก',
  emptyCategory: 'ยังไม่มีรายการในหมวดหมู่นี้',

  // Item form — M-11 §04
  createItemTitle: 'เพิ่มรายการอาหาร',
  editItemTitle: 'แก้ไขรายการอาหาร',
  lastEdited: (time: string) => `แก้ไขล่าสุด ${time}`,
  fieldName: 'ชื่อรายการ',
  fieldDescription: 'รายละเอียด',
  fieldPrice: 'ราคา',
  fieldCategory: 'หมวดหมู่',
  fieldImage: 'รูปภาพ',
  fieldAvailability: 'สถานะการขาย',
  required: 'จำเป็น',
  optional: 'ไม่จำเป็น',
  imageEditOnly: 'บันทึกรายการก่อน แล้วจึงเพิ่มรูปภาพ',
  cancel: 'ยกเลิก',
  save: 'บันทึก',
  saving: 'กำลังบันทึก…',
  saved: 'บันทึกแล้ว',
  saveFailed: 'บันทึกไม่สำเร็จ · ลองอีกครั้ง',
  saveForbidden: 'คุณไม่มีสิทธิ์แก้ไขเมนูของร้านนี้',
  saveDisabledReason: 'กรอกข้อมูลที่จำเป็นก่อนบันทึก',

  // Discard guard — M-11 §04, shared with M-04's pattern
  discardTitle: 'ปิดหน้าต่างนี้โดยไม่บันทึก?',
  discardConfirm: 'ปิดโดยไม่บันทึก',

  // Validation — M-11 §05
  nameRequired: 'กรอกชื่อรายการ',
  priceRequired: 'กรอกราคา',
  pricePrecision: 'ราคาละเอียดได้ถึงสตางค์เท่านั้น',
  priceNegative: 'ราคาต้องไม่ติดลบ',
  categoryRequired: 'เลือกหมวดหมู่',
  categoryNameRequired: 'กรอกชื่อหมวดหมู่',
  optionsRequired: 'เพิ่มตัวเลือกอย่างน้อย 1 รายการ',

  // Categories — M-11 §07
  categoriesTitle: 'จัดการหมวดหมู่',
  addCategory: '+ เพิ่มหมวดหมู่',
  saveOrder: 'บันทึกลำดับ',
  moveUp: 'ย้ายขึ้น',
  moveDown: 'ย้ายลง',
  rename: 'เปลี่ยนชื่อ',
  moved: (name: string, position: number) => `ย้าย ${name} ไปลำดับที่ ${position}`,

  // Removal — M-11 §08. Never the word ลบ.
  removeItemTitle: (name: string) => `นำ “${name}” ออกจากเมนู`,
  removeItemBody: [
    'รายการนี้จะไม่แสดงในเมนูของลูกค้าอีก และไม่สามารถสั่งได้',
    'ออเดอร์ที่สั่งไปแล้วยังคงอยู่ในประวัติตามเดิม',
    'หากต้องการขายอีกครั้ง ให้เพิ่มรายการใหม่',
  ],
  removeConfirm: 'นำออกจากเมนู',
  removeCategoryBlocked: (count: number) => `ย้ายรายการออกก่อน · หมวดหมู่นี้ยังมี ${count} รายการ`,

  // Options — M-11 §06
  optionsTitle: (name: string) => `ตัวเลือกของ “${name}”`,
  addOptionGroup: '+ เพิ่มกลุ่มตัวเลือก',
  addOption: '+ เพิ่มตัวเลือก',
  presetRequiredOne: 'เลือก 1 อย่าง · จำเป็น',
  presetOptionalOne: 'เลือก 1 อย่าง · ไม่บังคับ',
  presetMultiple: 'เลือกได้หลายอย่าง',
  requiredGroupNote: 'ลูกค้าต้องเลือกก่อนสั่ง',
  optionGroupTitle: 'ชื่อกลุ่ม',
  optionLabel: 'ชื่อตัวเลือก',
  optionDelta: 'ราคาเพิ่ม',
  maxSelectable: 'เลือกได้สูงสุด',
  remove: 'นำออก',
} as const;

export const hoursCopy = {
  pageTitle: 'เวลาทำการ',
  timezoneNote: 'เวลาประเทศไทย · แสดงแบบ 24 ชั่วโมง',
  replaceWarning: 'การบันทึกจะแทนที่เวลาทำการทั้งสัปดาห์',

  open: 'เปิด',
  closed: 'ปิด',
  closedAllDay: 'ปิดทั้งวัน',
  today: 'วันนี้',
  todayClosed: 'วันนี้ร้านปิด',
  customerSeesThis: 'ลูกค้าเห็นเวลานี้ในหน้าร้านของคุณ',

  dayToggleLabel: (day: string) => `เปิดร้านวัน${day}`,
  dayAnnouncement: (day: string, isOpen: boolean) => `${day}: ${isOpen ? 'เปิด' : 'ปิด'}`,
  opensAt: 'เวลาเปิด',
  closesAt: 'เวลาปิด',
  intervalLabel: (index: number) => `ช่วงที่ ${index + 1}`,
  addInterval: 'เพิ่มช่วงเวลา',
  addIntervalLabel: (day: string) => `เพิ่มช่วงเวลาวัน${day}`,
  removeIntervalLabel: (day: string, index: number) => `ลบช่วงที่ ${index + 1} วัน${day}`,
  copyToAll: 'คัดลอกไปทุกวัน',
  copyToAllLabel: 'คัดลอกเวลานี้ไปทุกวัน',
  copiedAnnouncement: (count: number) => `คัดลอกเวลาไป ${count} วันแล้ว`,

  // Feedback states — M-12 §05
  loading: 'กำลังโหลดเวลาทำการ',
  emptyTitle: 'ยังไม่ได้ตั้งเวลาทำการ',
  emptyBody: 'ลูกค้าจะเห็นว่าร้านปิดจนกว่าคุณจะตั้งเวลา',
  emptyCta: 'ตั้งเวลาทำการ',
  saving: 'กำลังบันทึก…',
  saved: 'บันทึกเวลาทำการแล้ว',
  invalidTitle: 'ยังบันทึกไม่ได้',
  invalidCount: (count: number) => `มี ${count} ช่วงเวลาที่ยังไม่ถูกต้อง`,
  gotoInvalid: 'ไปที่ช่วงเวลาที่ผิด',
  // M12-D08: true in every outcome, including the one where the delete
  // succeeded and the insert did not.
  saveFailed: 'บันทึกไม่สำเร็จ',
  saveFailedHint: 'ตรวจสอบเวลาทำการแล้วลองอีกครั้ง',
  saveForbidden: 'คุณไม่มีสิทธิ์แก้ไขข้อมูลร้านนี้',
  loadFailed: 'โหลดเวลาทำการไม่สำเร็จ',
  retry: 'ลองอีกครั้ง',
  cancel: 'ยกเลิก',
  save: 'บันทึก',
  noChanges: 'ยังไม่มีการเปลี่ยนแปลง',
  discardTitle: 'ออกจากหน้านี้โดยไม่บันทึก?',
  discardConfirm: 'ออกโดยไม่บันทึก',
} as const;

/**
 * Thai day names, indexed by `day_of_week`.
 *
 * **Index 0 is อาทิตย์ (Sunday).** This array is the merchant app's half of
 * the mapping `apps/customer/src/screens/ShopScreen.tsx` already ships, and
 * getting it wrong shifts the whole week silently — which is exactly what
 * M12-Q-01 warned about before the convention was confirmed.
 *
 * Ordinary spoken forms, not the formal `วันจันทร์` prefix, matching the
 * operational register already used elsewhere in this app.
 */
export const THAI_DAY_NAMES = [
  'อาทิตย์',
  'จันทร์',
  'อังคาร',
  'พุธ',
  'พฤหัสบดี',
  'ศุกร์',
  'เสาร์',
] as const;

/** The M-12 §04 messages, keyed by the shared validator's codes. */
export const HOURS_VALIDATION_MESSAGES: Record<HoursValidationCode, string> = {
  MISSING_TIME: 'กรอกเวลาเปิดและเวลาปิด',
  CLOSES_BEFORE_OPENS: 'เวลาปิดต้องหลังเวลาเปิด',
  OVERNIGHT_UNSUPPORTED: 'ยังไม่รองรับร้านที่ปิดหลังเที่ยงคืน',
  EQUAL_TIMES: 'เวลาเปิดและเวลาปิดต้องไม่ตรงกัน',
  INVALID_TIME_FORMAT: 'กรอกเวลาในรูปแบบ 08:00',
  OVERLAPPING_INTERVALS: 'ช่วงเวลาซ้อนกัน · ตรวจสอบอีกครั้ง',
  DUPLICATE_INTERVAL: 'ช่วงเวลานี้ซ้ำกับช่วงก่อนหน้า',
};
