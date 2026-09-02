import { Injectable, Logger } from '@nestjs/common';
import type {
  RestaurantProfileResponse,
  UpdateRestaurantProfileInput,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * M-10 Restaurant Profile — the descriptive-field write path.
 *
 * ## Why this exists
 *
 * `restaurants` grants `select` only to `authenticated`
 * (`20260811000011_rls_policies.sql`) — the M-10 design's own blocking
 * finding (§header, M10-C01). This service is the write side, following
 * `RestaurantCoverService` exactly: `restaurantId` arrives only after
 * `SupabaseAuthGuard`, `RolesGuard` (`@Roles('MERCHANT')`) and
 * `RestaurantScopeGuard` (`@RestaurantScope()`) have all passed, so this
 * service does not re-check who the caller is, and it writes through the
 * service-role connection — never a client-held RLS session.
 *
 * ## Authorization — M10-Q-05 resolved by existing precedent
 *
 * `RestaurantCoverController` gates its two routes with `@RestaurantScope()`
 * alone — any active `restaurant_members` row, regardless of `member_role`
 * (OWNER/MANAGER/STAFF), may replace the cover photo. M-10's design left
 * whether the *other* fields should narrow that to specific roles as an open
 * question (M10-Q-05) rather than deciding it. This implementation follows
 * the cover flow's own established precedent rather than inventing a new,
 * narrower permission rule for some fields and not others on the same page —
 * `@RestaurantScope()` is the only check, matching the one write path this
 * screen already had. Narrowing this to specific roles is a product decision
 * for a future change, not something this pass invents.
 *
 * ## What this never writes
 *
 * `merchant_id`, `status`, `temporarily_closed_until`,
 * `temporary_close_reason`, `lat`, `lng`, `location`, `zone_id`,
 * `rating_avg`, `rating_count`, `min_order_satang`, `service_radius_m`,
 * `avg_prep_minutes`, `image_url` and `cuisine` — none of them appear in
 * {@link UpdateRestaurantProfileInput}, so there is no code path here that
 * could write them even by accident. `image_url` keeps its own write path
 * (`RestaurantCoverService`), untouched by this one.
 */
@Injectable()
export class RestaurantProfileService {
  private readonly logger = new Logger(RestaurantProfileService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Replaces the whole editable field set in one request (M10-D08) — no
   * per-field save, matching M-12's own "one form, one save" precedent for
   * this app.
   *
   * Optional fields (`description`, `phone`, `addressLine`) are written as
   * `null` when the client sends an empty string: the columns are nullable
   * text with no format constraint (M10-C02), and an empty string is not a
   * meaningfully different stored value from "not set".
   */
  async updateProfile(
    restaurantId: string,
    input: UpdateRestaurantProfileInput,
  ): Promise<RestaurantProfileResponse> {
    const { data, error } = await this.supabase.admin
      .from('restaurants')
      .update({
        name: input.name,
        description: input.description === '' ? null : input.description,
        phone: input.phone === '' ? null : input.phone,
        address_line: input.addressLine === '' ? null : input.addressLine,
      })
      .eq('id', restaurantId)
      .select('id, name, description, phone, address_line, updated_at')
      .maybeSingle<{
        id: string;
        name: string;
        description: string | null;
        phone: string | null;
        address_line: string | null;
        updated_at: string;
      }>();

    if (error) {
      this.logger.error(`Restaurant profile update failed for ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Restaurant profile update failed' });
    }

    // Structurally shouldn't happen — RestaurantScopeGuard already proved
    // membership exists, and restaurant_members.restaurant_id foreign-keys
    // restaurants(id), so a membership cannot outlive its restaurant. Kept as
    // a defensive fallback for the theoretical race of a concurrent delete,
    // matching RestaurantCoverService's own fallback for the same case.
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Restaurant not found' });
    }

    return {
      restaurantId: data.id,
      name: data.name,
      description: data.description,
      phone: data.phone,
      addressLine: data.address_line,
      updatedAt: data.updated_at,
    };
  }
}
