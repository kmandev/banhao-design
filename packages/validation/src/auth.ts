import { z } from 'zod';
import { thaiPhoneSchema, displayNameSchema, roleSchema } from './common';

/**
 * Phase 1 authentication is Phone OTP via Supabase Auth.
 * These schemas are shaped so email/password and social login can be added
 * later without changing the existing ones.
 */

export const requestOtpSchema = z.object({
  phone: thaiPhoneSchema,
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: thaiPhoneSchema,
  token: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits'),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/**
 * The only self-service profile edit. `displayName` is the sole field, matching
 * the deployed grant (`grant update (display_name) on public.profiles`) — role,
 * phone and id are not writable by their owner at any layer.
 *
 * `.strict()` is load-bearing rather than tidy. Zod's default is to *strip*
 * unknown keys, so `{ role: 'ADMIN' }` would parse to `{}` and return 200: safe,
 * but silent. Rejecting instead means an attempt to write an authorization field
 * is reported as invalid and shows up in logs, rather than looking to the caller
 * like it might have worked.
 */
export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Role is deliberately NOT part of any client-writable schema.
 * Assigning a role is a backend/admin operation — a client must never be able
 * to declare its own role. Exported for admin-side use only.
 */
export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleSchema,
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
