import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

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

/** `profiles`, the one column this source needs. */
interface ProfileEmailRow {
  email: string | null;
}

/**
 * Reads `public.profiles.email` — DEC-056's collection slice, replacing the
 * previous placeholder binding (`NoPersistedCustomerEmailSource`, which
 * always returned `null` because no persisted source existed yet).
 *
 * Server-side and authoritative regardless of how the value was written:
 * the customer sets it through `PATCH /api/v1/me`
 * (`AuthController.updateMe` → `UsersService.updateEmail`), validated there
 * by `emailSchema`; this class only reads the column back, using the
 * service-role client (bypasses RLS, matching every other server-side read
 * in this codebase — `UsersService.findById` reads the same table the same
 * way). Never touches Supabase Auth, never reads a JWT claim (DEC-056
 * clauses 4, 10) — `userId` is the only input, supplied by
 * `PaymentsService` from the already-verified `AuthenticatedUser`.
 *
 * Returns `null` on a missing profile, a `NULL` column, or a query error —
 * every case collapses to the same "no authoritative email available"
 * outcome, and `PaymentsService.resolveAuthoritativeEmail` is what turns
 * that into a fail-closed `CUSTOMER_EMAIL_REQUIRED`. This method never
 * throws and never substitutes anything.
 */
@Injectable()
export class ProfileCustomerEmailSource implements CustomerEmailSource {
  private readonly logger = new Logger(ProfileCustomerEmailSource.name);

  constructor(private readonly supabase: SupabaseService) {}

  async resolve(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .maybeSingle<ProfileEmailRow>();

    if (error) {
      this.logger.error(`Failed to resolve customer email for ${userId}: ${error.message}`);
      return null;
    }

    return data?.email ?? null;
  }
}
