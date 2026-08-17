import { z } from 'zod';
import { thaiPhoneSchema } from './common';

/**
 * Delivery address schemas, shared by the API and (from Phase C) the customer
 * app, so both agree on what "valid" means.
 *
 * Every field below exists in `public.addresses` (migration
 * `20260811000001_identity_domain.sql`). Two columns that the table does carry
 * are deliberately **not** exposed here:
 *
 * - `zone_id` — reserved for the deferred geo domain; a client has no basis to
 *   choose one, so it is not client-settable through this API.
 * - `archived_at` — removal is `DELETE /me/addresses/:id`, which archives.
 *   Letting a PATCH write it would give the same operation two spellings.
 */

/** `จุดสังเกต` — a first-class field in Thai addressing, not an afterthought. */
const landmarkSchema = z.string().trim().min(1).max(200);

const addressLineSchema = z.string().trim().min(1).max(500);
const recipientNameSchema = z.string().trim().min(1).max(120);
const labelSchema = z.string().trim().min(1).max(60);
const instructionsSchema = z.string().trim().min(1).max(500);

/**
 * Coordinates are optional, but must arrive as a pair.
 *
 * The table's `location` column is generated from both, and a lone latitude
 * describes nothing — accepting one without the other would store a value no
 * consumer can use. GPS denial is a supported path (V1.1 §20): an address with
 * a landmark and no coordinates is complete and orderable.
 */
const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

const coordinatePairRule = <T extends { lat?: number | null; lng?: number | null }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  const hasLat = value.lat !== undefined && value.lat !== null;
  const hasLng = value.lng !== undefined && value.lng !== null;

  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lat and lng must be provided together',
      path: [hasLat ? 'lng' : 'lat'],
    });
  }
};

export const createAddressSchema = z
  .object({
    label: labelSchema.optional(),
    recipientName: recipientNameSchema,
    recipientPhone: thaiPhoneSchema,
    addressLine: addressLineSchema,
    landmark: landmarkSchema.optional(),
    instructions: instructionsSchema.optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine(coordinatePairRule);

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

/**
 * Partial update. `.strict()` matters as much as the field list: an unknown key
 * is rejected rather than ignored, so an attempt to smuggle `userId`,
 * `archivedAt` or `zoneId` through this endpoint fails loudly instead of
 * silently doing nothing.
 */
export const updateAddressSchema = z
  .object({
    label: labelSchema.nullable().optional(),
    recipientName: recipientNameSchema.optional(),
    recipientPhone: thaiPhoneSchema.optional(),
    addressLine: addressLineSchema.optional(),
    landmark: landmarkSchema.nullable().optional(),
    instructions: instructionsSchema.nullable().optional(),
    lat: latSchema.nullable().optional(),
    lng: lngSchema.nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided',
        path: [],
      });
      return;
    }

    // Only enforce pairing when the update touches coordinates at all —
    // a patch that never mentions them leaves the stored pair as it is.
    if ('lat' in value || 'lng' in value) {
      coordinatePairRule(value, ctx);
    }
  });

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
