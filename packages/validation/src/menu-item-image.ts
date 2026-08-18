import { z } from 'zod';

/**
 * `POST /api/v1/merchant/menu-items/:menuItemId/image/upload-url` request
 * body (M-12).
 *
 * `contentType` is deliberately just `z.string()`, matching
 * `requestCoverUploadUrlSchema` (M-11) — the MIME allow-list lives in exactly
 * one place, `ALLOWED_IMAGE_MIME_TYPES` in
 * `apps/api/src/modules/storage/object-key.ts`, and duplicating it into a zod
 * enum would give it a second source of truth that could drift.
 */
export const requestMenuItemImageUploadUrlSchema = z
  .object({
    contentType: z.string().min(1),
  })
  .strict();

export type RequestMenuItemImageUploadUrlInput = z.infer<
  typeof requestMenuItemImageUploadUrlSchema
>;

/**
 * `POST /api/v1/merchant/menu-items/:menuItemId/image/complete` request body.
 *
 * The server never trusts `objectKey` as data — see
 * `parseMenuItemImageObjectKey` and `MenuItemImageService.completeUpload` for
 * why this key (unlike M-11's restaurant cover key) cannot simply be
 * recomputed and compared, and what replaces that check.
 */
export const completeMenuItemImageUploadSchema = z
  .object({
    objectKey: z.string().min(1),
  })
  .strict();

export type CompleteMenuItemImageUploadInput = z.infer<
  typeof completeMenuItemImageUploadSchema
>;
