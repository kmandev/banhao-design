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
