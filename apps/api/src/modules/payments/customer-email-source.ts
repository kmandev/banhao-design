import { Injectable } from '@nestjs/common';

/**
 * The seam for BANHAO's authoritative customer-payment-email lookup
 * (DEC-056).
 *
 * Deliberately separate from `PaymentProvider`: this is BANHAO's own
 * customer-data concern, never a provider concept, and DEC-055's own
 * abstraction discipline means the two must never be conflated — a provider
 * consumes the email `PaymentsService` resolves here, it never supplies or
 * decides it.
 *
 * `resolve` returns `null` when no authoritative email exists for this
 * customer — never a placeholder, never Supabase Auth, never a JWT claim
 * (DEC-056 clauses 1, 9, 10). `PaymentsService` fails closed on `null` (and
 * on anything that fails `emailSchema`), before calling any provider.
 */
export interface CustomerEmailSource {
  resolve(userId: string): Promise<string | null>;
}

/** DI token for the active customer-email source. */
export const CUSTOMER_EMAIL_SOURCE = Symbol('CUSTOMER_EMAIL_SOURCE');

/**
 * The bound implementation until the DEC-056 collection slice lands — an
 * explicit, documented architectural boundary, not a bug.
 *
 * No `profiles.email` column exists yet: DEC-056 clause 5 authorizes a
 * future, separately-instructed migration, and none has landed. This is what
 * `PaymentsModule` binds until that migration and its own collection slice
 * exist. It always returns `null`, which is the correct, honest answer
 * today — never a placeholder address, per DEC-056 clause 9 — so every
 * payment initiation fails closed (`CUSTOMER_EMAIL_REQUIRED`) rather than
 * silently proceeding with something invented.
 *
 * Replacing this binding is the entire next collection-slice task: a real
 * implementation reads `profiles.email` (once it exists) exactly as
 * `UsersService.findById` already reads `profiles.phone` today, server-side,
 * never from Supabase Auth or a JWT claim (DEC-056 clauses 4, 10).
 */
@Injectable()
export class NoPersistedCustomerEmailSource implements CustomerEmailSource {
  async resolve(_userId: string): Promise<string | null> {
    return null;
  }
}
