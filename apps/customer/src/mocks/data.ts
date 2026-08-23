/**
 * Mock data for the Customer App.
 *
 * Every value here is transcribed from the design artifact
 * (design/customer/BANHAO Customer App.dc.html) so the UI matches what was
 * designed. These are DESIGN SAMPLES, not real business data — the shop names
 * even carry "(ตัวอย่าง)" in the design itself.
 *
 * Nothing in this file may be imported by a UI component directly. Screens go
 * through the repositories in src/repositories/, so swapping in a real API
 * later touches one layer rather than every screen. See brief §13.
 */

import type { Category, Shop, MenuItem, OrderSummary, AppNotification, Address } from './types';

export const categories: Category[] = [
  { id: 'tam-sang', icon: '🍜', name: 'ตามสั่ง' },
  { id: 'fried-chicken', icon: '🍗', name: 'ไก่ทอด' },
  { id: 'noodles', icon: '🍲', name: 'ก๋วยเตี๋ยว' },
  { id: 'rice-curry', icon: '🍛', name: 'ข้าวราดแกง' },
  { id: 'drinks', icon: '🥤', name: 'เครื่องดื่ม' },
  { id: 'dessert', icon: '🍰', name: 'ของหวาน' },
  { id: 'somtam', icon: '🥗', name: 'ส้มตำ' },
];

export const shops: Shop[] = [
  {
    id: 'shop-somtam-pathongdee',
    name: 'ส้มตำป้าทองดี (ตัวอย่าง)',
    glyph: '🥗',
    rating: '4.8',
    reviewCount: 326,
    cuisine: 'อาหารอีสาน',
    distanceKm: 1.1,
    etaMinutes: '15–20',
    deliveryFeeSatang: 1000,
    badge: { label: 'ส่งฟรี', tone: 'success' },
    isOpen: true,
    openingHours: 'เปิด 09:00–20:00 ทุกวัน',
    addressLine: 'ใกล้ตลาดสดบุณฑริก ต.บุณฑริก อ.บุณฑริก (ที่อยู่ตัวอย่าง)',
  },
  {
    id: 'shop-noodle-lung-nuad',
    name: 'ก๋วยเตี๋ยวลุงหนวด (ตัวอย่าง)',
    glyph: '🍜',
    rating: '4.7',
    reviewCount: 214,
    cuisine: 'ก๋วยเตี๋ยว',
    distanceKm: 0.6,
    etaMinutes: '10–15',
    deliveryFeeSatang: 1000,
    badge: { label: 'ขายดี', tone: 'primary' },
    isOpen: true,
    openingHours: 'เปิด 08:00–17:00 ทุกวัน',
    addressLine: 'ถ.ราษฎร์บำรุง อ.บุณฑริก (ที่อยู่ตัวอย่าง)',
  },
  {
    id: 'shop-grilled-chicken-je-muay',
    name: 'ไก่ย่างเจ๊หมวย (ตัวอย่าง)',
    glyph: '🍗',
    rating: '4.6',
    reviewCount: 158,
    cuisine: 'ของทอด',
    distanceKm: 1.8,
    etaMinutes: '—',
    deliveryFeeSatang: 1000,
    badge: { label: 'ปิดอยู่', tone: 'neutral' },
    isOpen: false,
    openingHours: 'เปิดพรุ่งนี้ 10:00',
    addressLine: 'อ.บุณฑริก (ที่อยู่ตัวอย่าง)',
  },
  {
    id: 'shop-krua-pa-noi',
    name: 'ครัวป้าน้อยตำแซ่บ (ตัวอย่าง)',
    glyph: '🌶️',
    rating: '4.5',
    reviewCount: 92,
    cuisine: 'อาหารตามสั่ง',
    distanceKm: 2.3,
    etaMinutes: '20–25',
    deliveryFeeSatang: 1500,
    isOpen: true,
    openingHours: 'เปิด 10:00–19:00 ทุกวัน',
    addressLine: 'อ.บุณฑริก (ที่อยู่ตัวอย่าง)',
  },
];

/** Menu grouped by shop id. Prices are in satang (integer) — never floats. */
export const menuByShop: Record<string, MenuItem[]> = {
  'shop-somtam-pathongdee': [
    {
      id: 'menu-somtam-thai-kaikem',
      shopId: 'shop-somtam-pathongdee',
      name: 'ส้มตำไทยไข่เค็ม',
      description: 'ตำไทยรสกลมกล่อม ใส่ไข่เค็มแท้',
      priceSatang: 6000,
      glyph: '🥗',
      section: 'แนะนำ',
    },
    {
      id: 'menu-pad-kaprao-moo',
      shopId: 'shop-somtam-pathongdee',
      name: 'ผัดกะเพราหมูสับ',
      description: 'ผัดไฟแรง กะเพราใบใหญ่ เสิร์ฟพร้อมข้าวสวย',
      priceSatang: 5000,
      glyph: '🍳',
      section: 'แนะนำ',
      optionGroups: [
        {
          id: 'meat',
          title: 'เลือกเนื้อสัตว์',
          required: true,
          options: [
            { id: 'pork', label: 'หมู', priceDeltaSatang: 0 },
            { id: 'chicken', label: 'ไก่', priceDeltaSatang: 0 },
            { id: 'beef', label: 'เนื้อ', priceDeltaSatang: 1000 },
          ],
        },
        {
          id: 'spicy',
          title: 'ระดับความเผ็ด',
          required: true,
          options: [
            { id: 'none', label: 'ไม่เผ็ด', priceDeltaSatang: 0 },
            { id: 'mild', label: 'เผ็ดน้อย', priceDeltaSatang: 0 },
            { id: 'hot', label: 'เผ็ดมาก', priceDeltaSatang: 0 },
          ],
        },
        {
          id: 'egg',
          title: 'ไข่',
          required: false,
          options: [
            { id: 'fried', label: 'ไข่ดาว', priceDeltaSatang: 1000 },
            { id: 'omelette', label: 'ไข่เจียว', priceDeltaSatang: 1500 },
            { id: 'no-egg', label: 'ไม่ใส่ไข่', priceDeltaSatang: 0 },
          ],
        },
      ],
    },
    {
      id: 'menu-tam-sua',
      shopId: 'shop-somtam-pathongdee',
      name: 'ตำซั่วปูปลาร้า',
      description: 'เส้นขนมจีน ปูนา ปลาร้าแท้',
      priceSatang: 6500,
      glyph: '🦀',
      section: 'ส้มตำ',
    },
    {
      id: 'menu-sticky-rice',
      shopId: 'shop-somtam-pathongdee',
      name: 'ข้าวเหนียวนึ่งใหม่',
      priceSatang: 1000,
      glyph: '🍚',
      section: 'อาหารจานเดียว',
    },
    {
      id: 'menu-sugarcane',
      shopId: 'shop-somtam-pathongdee',
      name: 'น้ำอ้อยสด',
      priceSatang: 2000,
      glyph: '🥤',
      section: 'เครื่องดื่ม',
    },
    {
      id: 'menu-grilled-chicken-madan',
      shopId: 'shop-somtam-pathongdee',
      name: 'ไก่ย่างไม้มะดัน',
      description: 'ย่างเตาถ่าน หอมสมุนไพร',
      priceSatang: 8000,
      glyph: '🍗',
      section: 'แนะนำ',
    },
  ],
};

export const addresses: Address[] = [
  {
    id: 'addr-home',
    label: 'บ้าน',
    glyph: '🏠',
    line: '88 หมู่ 4 บ้านบุณฑริก ต.บุณฑริก อ.บุณฑริก (ตัวอย่าง)',
    isDefault: true,
    rawLabel: 'บ้าน',
    recipientName: 'สมหญิง ใจดี',
    recipientPhone: '+66812345678',
    addressLine: '88 หมู่ 4 บ้านบุณฑริก ต.บุณฑริก อ.บุณฑริก (ตัวอย่าง)',
    landmark: null,
    instructions: null,
    lat: null,
    lng: null,
  },
  {
    id: 'addr-work',
    label: 'ที่ทำงาน',
    glyph: '🏢',
    line: 'สำนักงานเทศบาล อ.บุณฑริก (ตัวอย่าง)',
    isDefault: false,
    rawLabel: 'ที่ทำงาน',
    recipientName: 'สมหญิง ใจดี',
    recipientPhone: '+66812345678',
    addressLine: 'สำนักงานเทศบาล อ.บุณฑริก (ตัวอย่าง)',
    landmark: null,
    instructions: null,
    lat: null,
    lng: null,
  },
];

export const orders: OrderSummary[] = [
  {
    id: 'BH000125',
    shopName: 'ส้มตำป้าทองดี (ตัวอย่าง)',
    glyph: '🥗',
    orderState: 'DELIVERING',
    placedAt: '18:40',
    itemSummary: 'ส้มตำไทยไข่เค็ม, ผัดกะเพราหมูสับ',
    totalSatang: 13000,
    paymentMethod: 'PROMPTPAY',
  },
  {
    id: 'BH000118',
    shopName: 'ก๋วยเตี๋ยวลุงหนวด (ตัวอย่าง)',
    glyph: '🍜',
    orderState: 'COMPLETED',
    placedAt: 'เมื่อวาน 12:15',
    itemSummary: 'ก๋วยเตี๋ยวหมูน้ำตก',
    totalSatang: 7000,
    paymentMethod: 'CASH',
  },
  {
    id: 'BH000104',
    shopName: 'ครัวป้าน้อยตำแซ่บ (ตัวอย่าง)',
    glyph: '🌶️',
    orderState: 'CANCELLED',
    placedAt: '7 ส.ค. 19:02',
    itemSummary: 'ตำซั่วปูปลาร้า',
    totalSatang: 8500,
    paymentMethod: 'PROMPTPAY',
  },
];

export const notifications: AppNotification[] = [
  {
    id: 'notif-1',
    glyph: '🛵',
    title: 'ไรเดอร์กำลังไปส่ง',
    body: 'ออเดอร์ #BH000125 กำลังเดินทางมาหาคุณ',
    time: '18:52',
    read: false,
  },
  {
    id: 'notif-2',
    glyph: '✅',
    title: 'ร้านรับออเดอร์แล้ว',
    body: 'ส้มตำป้าทองดี กำลังเตรียมอาหารให้คุณ',
    time: '18:42',
    read: false,
  },
  {
    id: 'notif-3',
    glyph: '🎉',
    title: 'ส่วนลด BANHAO7',
    body: 'ลด ฿10 เมื่อสั่งขั้นต่ำ ฿100 วันนี้เท่านั้น',
    time: 'เมื่อวาน',
    read: true,
  },
];
