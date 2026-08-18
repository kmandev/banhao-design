/**
 * The home screen's food-category chips.
 *
 * ## PC-Q-003 — UNRESOLVED. Read before changing this file.
 *
 * This is a **presentation taxonomy**, not database data, and it is deliberately
 * static. There is no global category table anywhere in the 40-table schema.
 *
 * `menu_categories` is **not** the same concept: it is a menu section scoped to
 * one restaurant by `restaurant_id` (`ตามสั่ง` at shop A is a different row from
 * `ตามสั่ง` at shop B). Mapping it onto these chips would invent a taxonomy the
 * database does not have, and `restaurants.cuisine` is free text with no icons.
 *
 * So `listCategories()` is served from here rather than from Supabase, and the
 * limitation is isolated to this one module instead of being hidden inside a
 * query that looks live. When PC-Q-003 is decided — a real table, a derived
 * list, or dropping the chips from C-05 — this file is the only thing that
 * changes.
 */

export interface Category {
  id: string;
  icon: string;
  name: string;
}

export const CATEGORY_TAXONOMY: readonly Category[] = [
  { id: 'tam-sang', icon: '🍜', name: 'ตามสั่ง' },
  { id: 'fried-chicken', icon: '🍗', name: 'ไก่ทอด' },
  { id: 'noodles', icon: '🍲', name: 'ก๋วยเตี๋ยว' },
  { id: 'rice-curry', icon: '🍛', name: 'ข้าวราดแกง' },
  { id: 'drinks', icon: '🥤', name: 'เครื่องดื่ม' },
  { id: 'dessert', icon: '🍰', name: 'ของหวาน' },
  { id: 'somtam', icon: '🥗', name: 'ส้มตำ' },
];
