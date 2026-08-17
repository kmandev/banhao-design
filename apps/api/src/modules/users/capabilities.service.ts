import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type {
  ActorCapabilities,
  MerchantMemberRole,
  MerchantMembership,
  PlatformStaffRole,
} from '../../common/types';

interface RestaurantMemberRow {
  restaurant_id: string;
  member_role: string;
}

interface RiderRow {
  id: string;
  status: string;
}

interface PlatformStaffRow {
  staff_role: string;
}

const MERCHANT_MEMBER_ROLES: readonly string[] = ['OWNER', 'MANAGER', 'STAFF'];
const PLATFORM_STAFF_ROLES: readonly string[] = ['OPERATOR', 'ADMIN'];

/** The only rider status that authorises anything (DEC-APP-004). */
const ACTIVE_RIDER_STATUS = 'APPROVED';

/** Raised when capability state could not be determined. Callers must fail closed. */
export class CapabilityResolutionError extends Error {}

/**
 * Resolves an authenticated user's capabilities from domain membership
 * (DEC-033 / DEC-APP-004).
 *
 * **Reads the database on every request, by design.** DEC-APP-004 explicitly
 * rejected both JWT claims and a synced `profiles.role` column: a claim goes
 * stale for the token's lifetime, which would leave a suspended rider or a
 * revoked merchant authorised until their token expired. Revocation has to take
 * effect on the next request, so the current row is the only acceptable answer.
 * No caching — that is a later optimisation and must not weaken revocation.
 *
 * **Runs on the service-role client**, so `auth.uid()` is null here. The
 * database's own `is_restaurant_member()` / `is_assigned_rider()` helpers bind
 * to `auth.uid()` and would therefore return false for every caller — they are
 * for RLS, not for this service. These are direct filtered reads instead.
 */
@Injectable()
export class CapabilitiesService {
  private readonly logger = new Logger(CapabilitiesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Every grant this user currently holds.
   *
   * `customer: true` is unconditional for an authenticated profile — DEC-033
   * makes Customer implicit, with no membership row. It is set here only once
   * all three membership reads have succeeded: a failed read must never be
   * mistaken for "no memberships", so any error throws instead.
   */
  async resolve(userId: string): Promise<ActorCapabilities> {
    const [merchant, rider, platformStaff] = await Promise.all([
      this.resolveMerchant(userId),
      this.resolveRider(userId),
      this.resolvePlatformStaff(userId),
    ]);

    return { customer: true, merchant, rider, platformStaff };
  }

  /** Active restaurant memberships. `revoked_at is null` is the grant. */
  private async resolveMerchant(userId: string): Promise<MerchantMembership[]> {
    const { data, error } = await this.supabase.admin
      .from('restaurant_members')
      .select('restaurant_id, member_role')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .returns<RestaurantMemberRow[]>();

    if (error) {
      this.fail('restaurant_members', userId, error.message);
    }

    return (data ?? []).flatMap((row) => {
      if (!MERCHANT_MEMBER_ROLES.includes(row.member_role)) {
        // The column is CHECK-constrained, so this means schema/code drift.
        // Drop the membership rather than trust a value we cannot interpret.
        this.logger.error(
          `Unknown member_role "${row.member_role}" for user ${userId}; ignoring membership`,
        );
        return [];
      }

      return [
        {
          restaurantId: row.restaurant_id,
          memberRole: row.member_role as MerchantMemberRole,
        },
      ];
    });
  }

  /**
   * Rider identity, only when APPROVED.
   *
   * SUSPENDED and DEACTIVATED must fail closed, as must every status before
   * approval — so this matches on the one status that grants, rather than
   * excluding the ones that don't. A new status added to the enum later is then
   * denied by default instead of silently authorised.
   */
  private async resolveRider(userId: string): Promise<{ riderId: string } | null> {
    const { data, error } = await this.supabase.admin
      .from('riders')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', ACTIVE_RIDER_STATUS)
      .maybeSingle<RiderRow>();

    if (error) {
      this.fail('riders', userId, error.message);
    }

    return data ? { riderId: data.id } : null;
  }

  /** Operator/admin grant. `revoked_at is null` is the grant. */
  private async resolvePlatformStaff(
    userId: string,
  ): Promise<{ staffRole: PlatformStaffRole } | null> {
    const { data, error } = await this.supabase.admin
      .from('platform_staff')
      .select('staff_role')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle<PlatformStaffRow>();

    if (error) {
      this.fail('platform_staff', userId, error.message);
    }

    if (!data) {
      return null;
    }

    if (!PLATFORM_STAFF_ROLES.includes(data.staff_role)) {
      this.logger.error(
        `Unknown staff_role "${data.staff_role}" for user ${userId}; denying staff capability`,
      );
      return null;
    }

    return { staffRole: data.staff_role as PlatformStaffRole };
  }

  /**
   * A membership read that failed tells us nothing about what the user may do.
   * Throwing is what makes the caller fail closed; returning an empty result
   * would silently downgrade a revoked-check into a granted-customer.
   */
  private fail(table: string, userId: string, message: string): never {
    this.logger.error(`Capability read failed on ${table} for ${userId}: ${message}`);
    throw new CapabilityResolutionError(`Could not resolve capabilities from ${table}`);
  }
}
