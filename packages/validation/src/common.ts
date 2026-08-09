import { z } from 'zod';
import { ROLES } from '@banhao/types';

/**
 * Schemas shared by frontend and backend. Defining them once here is what stops
 * the four apps and the API from drifting apart on what "valid" means.
 */

export const roleSchema = z.enum(ROLES);

/**
 * Thai mobile number in E.164 form, e.g. +66812345678.
 *
 * Thai mobile numbers are 9 digits after the +66 country code (the leading 0 of
 * the local format is dropped). Phone OTP is the Phase 1 auth method — see
 * docs/ARCHITECTURE.md.
 */
export const thaiPhoneSchema = z
  .string()
  .regex(/^\+66[0-9]{9}$/, 'Phone must be in E.164 format, e.g. +66812345678');

export const uuidSchema = z.string().uuid();

/**
 * Money in satang. Integer only — never floating point (see @banhao/types Money).
 */
export const satangSchema = z.number().int().nonnegative();

export const displayNameSchema = z.string().trim().min(1).max(80);
