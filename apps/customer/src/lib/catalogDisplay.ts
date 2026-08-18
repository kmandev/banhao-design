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
