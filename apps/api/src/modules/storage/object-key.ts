import { randomUUID } from 'node:crypto';
import { uuidSchema } from '@banhao/validation';

/**
 * Restaurant cover image keys (Phase D · R2 storage foundation).
 *
 * This is the *only* thing in the storage module that knows what a
 * "restaurant" or a "cover" is — `StorageService` itself is entity-agnostic,
 * so a future menu-gallery or delivery-proof key builder can sit next to this
 * one without either touching `StorageService` or coupling it to R2.
 *
 * Every object key this module can produce is server-templated from a
 * validated UUID and an allow-listed MIME type. Nothing here accepts an
 * arbitrary string from a caller — that is what makes "never accept an
 * object key from the client" true by construction rather than by convention.
 */

/**
 * Supported cover-image formats. Extensions are looked up from the verified
 * MIME type, never trusted from a client-supplied filename.
 */
export const ALLOWED_IMAGE_MIME_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type AllowedImageMimeType = keyof typeof ALLOWED_IMAGE_MIME_TYPES;

export function isAllowedImageMimeType(mimeType: string): mimeType is AllowedImageMimeType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_MIME_TYPES, mimeType);
}

/**
 * The reverse of `ALLOWED_IMAGE_MIME_TYPES` — extension back to MIME type.
 *
 * Exists so a caller that only has a *key* (e.g. a client-submitted
 * `objectKey` at upload-complete time, M-11) can recover the MIME type that
 * would have produced it, and then re-derive the canonical key from trusted
 * inputs to check the two match — never by trusting the submitted key
 * directly. Built once from the same map `restaurantCoverObjectKey` uses, so
 * the two can never independently drift out of sync.
 */
const MIME_TYPE_BY_EXTENSION: Record<string, AllowedImageMimeType> = Object.fromEntries(
  Object.entries(ALLOWED_IMAGE_MIME_TYPES).map(([mime, ext]) => [ext, mime]),
) as Record<string, AllowedImageMimeType>;

export function mimeTypeForExtension(extension: string): AllowedImageMimeType | undefined {
  return MIME_TYPE_BY_EXTENSION[extension];
}

/** Thrown for a restaurant id that isn't a UUID, or a MIME type not in the allow-list. */
export class InvalidObjectKeyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidObjectKeyInputError';
  }
}

/**
 * `restaurants/{restaurantId}/cover.{ext}` — deterministic and 1:1 with the
 * restaurant, so a re-upload naturally overwrites the previous cover with no
 * orphaned object left behind.
 *
 * `restaurantId` must already be a value the caller resolved from an
 * authorized server-side context (the future merchant endpoint, per Step 12)
 * — this function only shapes the key, it does not check who owns the
 * restaurant. Validating it is a UUID here is a format guard, not an
 * authorization check.
 */
export function restaurantCoverObjectKey(restaurantId: string, mimeType: string): string {
  const parsedId = uuidSchema.safeParse(restaurantId);
  if (!parsedId.success) {
    throw new InvalidObjectKeyInputError(`restaurantId must be a UUID, got: ${restaurantId}`);
  }

  if (!isAllowedImageMimeType(mimeType)) {
    throw new InvalidObjectKeyInputError(
      `Unsupported MIME type for a restaurant cover image: ${mimeType}. ` +
        `Allowed: ${Object.keys(ALLOWED_IMAGE_MIME_TYPES).join(', ')}`,
    );
  }

  const ext = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  return `restaurants/${parsedId.data}/cover.${ext}`;
}

/**
 * `menu-items/{menuItemId}/{uuid}.{ext}` (M-12).
 *
 * Unlike a restaurant cover, this key is **not fully deterministic** — a menu
 * item may hold many images over its lifetime (one active at a time; see
 * `docs` on replacement), so the key needs a component that changes between
 * uploads. That component is a server-generated `crypto.randomUUID()`, never
 * a client-supplied filename.
 *
 * `menuItemId` must already be a value the caller resolved from an authorized
 * server-side context (`MenuItemImageService`, which confirms the caller is a
 * member of the item's owning restaurant *before* calling this) — same
 * division of responsibility as `restaurantCoverObjectKey`: this function only
 * shapes the key, it does not check who owns the item.
 */
export function menuItemImageObjectKey(menuItemId: string, mimeType: string): string {
  const parsedId = uuidSchema.safeParse(menuItemId);
  if (!parsedId.success) {
    throw new InvalidObjectKeyInputError(`menuItemId must be a UUID, got: ${menuItemId}`);
  }

  if (!isAllowedImageMimeType(mimeType)) {
    throw new InvalidObjectKeyInputError(
      `Unsupported MIME type for a menu item image: ${mimeType}. ` +
        `Allowed: ${Object.keys(ALLOWED_IMAGE_MIME_TYPES).join(', ')}`,
    );
  }

  const ext = ALLOWED_IMAGE_MIME_TYPES[mimeType];
  return `menu-items/${parsedId.data}/${randomUUID()}.${ext}`;
}

/** A `menu-items/{menuItemId}/{uuid}.{ext}` key, already confirmed structurally valid. */
export interface ParsedMenuItemImageKey {
  menuItemId: string;
  mimeType: AllowedImageMimeType;
}

/**
 * Structurally validates a client-submitted menu-item-image key, **without**
 * trusting it — the inverse problem `restaurantCoverObjectKey` doesn't have.
 *
 * A restaurant cover key is fully deterministic, so M-11's `completeUpload`
 * can recompute the *exact* expected key from trusted inputs alone and demand
 * byte-for-byte equality. This key contains a server-generated random UUID
 * that cannot be recomputed — nothing observed at complete-time can reproduce
 * it — so equality-by-recomputation is not an available check here.
 *
 * What replaces it: this parser proves the key is *exactly* the documented
 * shape (literal `menu-items/` prefix, a UUID equal to the one the caller
 * already resolved and authorized, another UUID, an allow-listed extension,
 * nothing else — no extra segments, no leading slash, no trailing slash, no
 * query string, no traversal). A key that parses is therefore one only two
 * things could have produced: this exact function (with a genuine
 * `menuItemId`), or a 122-bit guess. Structural validity alone is not treated
 * as proof of upload — `MenuItemImageService.completeUpload` still requires
 * `StorageService.exists()` to return true before writing anything, exactly
 * mirroring M-11's own "existence is the real proof" model. The two checks
 * together (structural shape + real existence) are what make the missing
 * recompute-and-compare step safe to omit; see that service's own comment for
 * the full reasoning.
 *
 * Returns `null` for anything that fails any part of the shape check — the
 * caller cannot distinguish *why* a key was rejected from the return value
 * alone, deliberately: a path-traversal attempt, a foreign menu item's key,
 * and a garbled string all deserve the same generic answer.
 */
export function parseMenuItemImageObjectKey(
  key: string,
  expectedMenuItemId: string,
): ParsedMenuItemImageKey | null {
  const expectedId = uuidSchema.safeParse(expectedMenuItemId);
  if (!expectedId.success) return null;

  const PREFIX = 'menu-items/';
  if (!key.startsWith(PREFIX)) return null;

  const rest = key.slice(PREFIX.length);
  const segments = rest.split('/');
  if (segments.length !== 2) return null;

  const [menuItemSegment, filename] = segments;
  if (menuItemSegment !== expectedId.data || !filename) return null;

  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return null;

  const uuidPart = filename.slice(0, dotIndex);
  const extension = filename.slice(dotIndex + 1);

  if (!uuidSchema.safeParse(uuidPart).success) return null;

  const mimeType = mimeTypeForExtension(extension);
  if (!mimeType) return null;

  return { menuItemId: menuItemSegment, mimeType };
}
