/**
 * Resolves a stored R2 object key to a browser-renderable URL.
 *
 * `restaurants.image_url` stores a bare object key (`restaurants/{id}/cover.jpg`),
 * not a URL — `RestaurantCoverService.completeUpload` deliberately returns the
 * key, not a resolved URL, matching M-11's own established response shape
 * (its doc comment contrasts this with M-12's menu-item-image endpoint, which
 * *does* return a resolved public URL). No app in this monorepo has rendered
 * an uploaded image before M-10, so there was no existing client-side
 * resolver to reuse.
 *
 * `R2_PUBLIC_URL` (`apps/api/.env.example`) is, by its own name and its
 * `StorageService.getPublicUrl` use, a public CDN base for objects meant to
 * be served straight to a browser — the same non-secret category as
 * `NEXT_PUBLIC_SUPABASE_URL`, not a credential. This mirrors that value to
 * the browser as `NEXT_PUBLIC_R2_PUBLIC_URL` so this app can build the same
 * URL `StorageService.getPublicUrl` builds server-side, without adding an API
 * round trip just to resolve a key that is already public.
 */

const R2_PUBLIC_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

/** Same allow-list as `apps/api/src/modules/storage/object-key.ts`. */
export const ALLOWED_COVER_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** `null` in, `null` out — no photo means no `<img>` is rendered (M-10 §09). */
export function resolveImageUrl(objectKeyOrUrl: string | null): string | null {
  if (!objectKeyOrUrl) return null;

  // Defensive only: every known source (the DB read, and
  // RestaurantCoverService.completeUpload's own response) is a bare object
  // key today, never a full URL. This guards against double-prefixing if
  // that ever changes without this function being updated to match.
  if (/^https?:\/\//.test(objectKeyOrUrl)) return objectKeyOrUrl;

  if (!R2_PUBLIC_URL) return null;
  return `${R2_PUBLIC_URL}/${objectKeyOrUrl}`;
}
