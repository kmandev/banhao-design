import { z } from 'zod';

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/cover/upload-url` request
 * body (M-11).
 *
 * `contentType` is deliberately just `z.string()` here, not a MIME enum — the
 * allow-list already lives in one place, `restaurantCoverObjectKey`'s
 * `ALLOWED_IMAGE_MIME_TYPES` (`apps/api/src/modules/storage/object-key.ts`).
 * Duplicating it into a zod enum would give the allow-list two sources of
 * truth that could drift; this schema only enforces "some non-empty string
 * was sent," and the service rejects an unsupported one with the same
 * `InvalidObjectKeyInputError` the key builder always raises.
 */
export const requestCoverUploadUrlSchema = z
  .object({
    contentType: z.string().min(1),
  })
  .strict();

export type RequestCoverUploadUrlInput = z.infer<typeof requestCoverUploadUrlSchema>;

/**
 * `POST /api/v1/merchant/restaurants/:restaurantId/cover/complete` request
 * body.
 *
 * The server never trusts `objectKey` as data — it re-derives the MIME type
 * from the key's own extension, recomputes the expected key from the
 * authenticated `restaurantId` and that MIME type, and only proceeds if the
 * two are byte-for-byte equal. See `RestaurantCoverService.completeUpload`.
 */
export const completeCoverUploadSchema = z
  .object({
    objectKey: z.string().min(1),
  })
  .strict();

export type CompleteCoverUploadInput = z.infer<typeof completeCoverUploadSchema>;
