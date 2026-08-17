import type { ZodError, ZodTypeAny, z } from 'zod';
import { DomainError } from '../errors/domain-error';

/**
 * Field-keyed validation messages, e.g. `{ recipientPhone: ['Phone must be…'] }`.
 *
 * Shaped for the client contract in V1.1 §10: a client reads `details` to place
 * inline field errors, so the key must be the field path and not prose. A
 * top-level (whole-object) issue is keyed `_` rather than dropped.
 */
export type ValidationDetails = Record<string, string[]>;

function toDetails(error: ZodError): ValidationDetails {
  const details: ValidationDetails = {};

  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_';
    (details[key] ??= []).push(issue.message);
  }

  return details;
}

/**
 * Parses `input` or throws `VALIDATION_FAILED` (400) carrying per-field detail.
 *
 * Centralised so every endpoint reports invalid input the same way. Zod's own
 * error is never allowed to escape: its shape is an implementation detail, and
 * the catalogue code is what clients branch on.
 */
export function parseOrThrow<TSchema extends ZodTypeAny>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new DomainError('VALIDATION_FAILED', {
      message: 'Request body failed validation',
      details: toDetails(result.error),
    });
  }

  return result.data;
}
