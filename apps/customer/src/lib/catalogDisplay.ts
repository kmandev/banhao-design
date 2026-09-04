/**
 * Presentation helpers for catalog data.
 *
 * These turn domain values into display strings. They are deliberately *not*
 * in the domain: a null rating is a fact about the data, while "ยังไม่มีคะแนน"
 * is a wording choice, and mixing the two is how invented values get in.
 *
 * The placeholder glyphs are the same idea. The design uses an emoji where a
 * photo will go (`design/customer/BANHAO Customer App.dc.html`), and the schema
 * stores `image_url`, not an emoji — so there is nothing to map. A single fixed
 * placeholder per entity is presentation, not fabricated data, and it is
 * replaced by real image rendering rather than by a "glyph" column.
 */

/** Stand-in where a shop photo will be rendered. */
export const SHOP_PLACEHOLDER_GLYPH = '🍽️';

/** Stand-in where a menu-item photo will be rendered. */
export const ITEM_PLACEHOLDER_GLYPH = '🍜';

/**
 * M-13. The preparation-time estimate in force right now, or null when there
 * is none to show.
 *
 * NORMAL reads `avgPrepMinutes` — null stays null (AV-E5: a restaurant with no
 * recorded normal prep time has no estimate to show, never a fabricated one).
 * BUSY reads `busyPrepMinutes` instead — never `avgPrepMinutes` (AV-D01: Busy
 * is never signalled by overwriting the restaurant's normal estimate, and this
 * reader mirrors that separation). PAUSED has no new order to estimate, so
 * this returns null regardless of either stored value — "One slot, one
 * number, whichever mode is in force" (M-13 design).
 *
 * This is a preparation-time estimate only. It must never be presented as a
 * delivery ETA or an arrival time (`domain/catalog.ts`'s own PC-Q-002 note).
 */
export function prepEstimateMinutes(shop: {
  availabilityMode: 'NORMAL' | 'BUSY' | 'PAUSED';
  avgPrepMinutes: number | null;
  busyPrepMinutes: number | null;
}): number | null {
  switch (shop.availabilityMode) {
    case 'BUSY':
      return shop.busyPrepMinutes;
    case 'PAUSED':
      return null;
    case 'NORMAL':
    default:
      return shop.avgPrepMinutes;
  }
}

/** `เวลาทำอาหารประมาณ 20 นาที`, or null when there is no estimate to show. */
export function formatPrepEstimate(shop: {
  availabilityMode: 'NORMAL' | 'BUSY' | 'PAUSED';
  avgPrepMinutes: number | null;
  busyPrepMinutes: number | null;
}): string | null {
  const minutes = prepEstimateMinutes(shop);
  if (minutes === null) return null;
  return `เวลาทำอาหารประมาณ ${minutes} นาที`;
}

/**
 * M-13. The shop-card badge — shared by `HomeScreen` and `SearchScreen` so the
 * two lists cannot disagree about what a card says.
 *
 * Paused gets its own label, never the ordinary "ปิดอยู่": customerRows' shop
 * card row is explicit that Paused reads "Visible but not orderable, marked
 * หยุดรับออเดอร์ชั่วคราว", reusing the existing unavailable-card treatment
 * (the `วันนี้หมด` pattern) rather than the hours-based closed badge.
 */
export function shopCardBadge(shop: {
  availabilityMode: 'NORMAL' | 'BUSY' | 'PAUSED';
  isOpen: boolean;
}): { label: string; tone: 'success' | 'neutral' } {
  if (shop.availabilityMode === 'PAUSED') {
    return { label: 'หยุดรับออเดอร์ชั่วคราว', tone: 'neutral' };
  }
  return { label: shop.isOpen ? 'เปิดอยู่' : 'ปิดอยู่', tone: shop.isOpen ? 'success' : 'neutral' };
}

/**
 * `4.8`, or null when the shop has never been rated.
 *
 * Returns null rather than `'0.0'` or `'-'`: an unrated shop and a shop rated
 * zero are different things, and the caller decides how to say so.
 */
export function formatRating(ratingAvg: number | null): string | null {
  if (ratingAvg === null) return null;
  return ratingAvg.toFixed(1);
}

/** `อาหารอีสาน · ⭐ 4.8 (326)`, omitting whatever is missing. */
export function formatShopMeta(shop: {
  cuisine: string | null;
  ratingAvg: number | null;
  ratingCount: number;
}): string {
  const parts: string[] = [];

  if (shop.cuisine) parts.push(shop.cuisine);

  const rating = formatRating(shop.ratingAvg);
  if (rating) parts.push(`⭐ ${rating} (${shop.ratingCount})`);

  return parts.join(' · ');
}
