import { Injectable, Logger } from '@nestjs/common';
import type {
  RestaurantAvailabilityMode,
  RestaurantAvailabilityResponse,
  SetRestaurantAvailabilityInput,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import { uuidSchema } from '@banhao/validation';

/**
 * M-13 Merchant Availability (Normal / Busy / Paused) — the mode-change write
 * path.
 *
 * ## Storage
 *
 * `restaurants.availability_mode` / `busy_prep_minutes`
 * (`20260904000001_restaurant_availability_mode.sql`) — the AV-Q04/AV-Q03
 * decision lock's approved storage. Never `restaurants.status` (RLS trap: a
 * status-based mode would drop the restaurant out of
 * `restaurants_select_active`), never `temporarily_closed_until` (BQ-007's
 * semantic, untouched), never `restaurants.avg_prep_minutes` (AV-D01).
 *
 * ## Authorization
 *
 * `restaurantId` arrives only after `SupabaseAuthGuard`, `RolesGuard`
 * (`@Roles('MERCHANT')`) and `RestaurantScopeGuard` (`@RestaurantScope()`)
 * have all passed — this service does not re-check who the caller is, and it
 * writes through the service-role connection, following
 * `RestaurantProfileService` exactly. `restaurants` grants `select` only to
 * `authenticated`; every write stays behind this API.
 *
 * ## One database call, one transaction — DEC-068 C3-A
 *
 * The whole change — the lock, the transition guard, the `UPDATE` and the
 * `audit_logs` row — is `public.set_restaurant_availability()`
 * (`20261107000001`). A function body is one transaction, so there is no
 * window in which the mode has changed and the audit row has not been
 * written: if the audit `INSERT` fails, the `UPDATE` rolls back with it and
 * this service reports a failure. That reverses M-AV G-2, which wrote the
 * audit row afterwards and swallowed its failure; the Product Owner decided
 * (DEC-068 C3-A) that a mode change without its audit row must not succeed.
 * Nothing in this file catches that failure and carries on.
 *
 * The rules the function applies are unchanged from what this service used to
 * apply itself: resume always returns to NORMAL, never directly to BUSY
 * (`PAUSED → NORMAL → BUSY` is two calls); a repeated identical request is a
 * no-op with no `UPDATE` and no audit row (AC-12).
 *
 * ## Who may call it — DEC-068 C3
 *
 * Two entry points, each proving its own authority before getting here: the
 * merchant route (an active member of the restaurant, `MERCHANT` actor) and
 * the supervisor route (BANHAO staff `ADMIN` / `OPERATOR`, `OPERATOR` actor,
 * who must give a reason). The audit row records the actor, the role, the
 * merchant, the old and new mode, the time and the source.
 */

export type AvailabilityActor =
  | { actorType: 'MERCHANT'; userId: string; role: string }
  | { actorType: 'OPERATOR'; userId: string; role: string; reason: string };

/** `public.set_restaurant_availability()`'s result, as it arrives over RPC. */
interface AvailabilityRpcResult {
  result: 'CHANGED' | 'NOOP' | 'INVALID_TRANSITION' | 'NOT_FOUND';
  restaurantId?: string;
  availabilityMode?: RestaurantAvailabilityMode;
  busyPrepMinutes?: number | null;
  updatedAt?: string;
  currentMode?: RestaurantAvailabilityMode;
}

@Injectable()
export class RestaurantAvailabilityService {
  private readonly logger = new Logger(RestaurantAvailabilityService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async setAvailability(
    restaurantId: string,
    actor: AvailabilityActor,
    input: SetRestaurantAvailabilityInput,
  ): Promise<RestaurantAvailabilityResponse> {
    const targetMode = input.mode;
    const correlationId = uuidSchema.safeParse(getCorrelationId());

    const { data, error } = await this.supabase.admin.rpc('set_restaurant_availability', {
      p_restaurant_id: restaurantId,
      p_mode: targetMode,
      p_busy_prep_minutes: input.mode === 'BUSY' ? input.busyPrepMinutes : null,
      p_actor_id: actor.userId,
      p_actor_type: actor.actorType,
      p_actor_role: actor.role,
      p_reason: actor.actorType === 'OPERATOR' ? actor.reason : null,
      p_source: 'api',
      p_correlation_id: correlationId.success ? correlationId.data : null,
    });

    if (error) {
      // Includes the case DEC-068 C3-A is about: the audit row could not be
      // written, so the function raised and the change rolled back. The caller
      // is told it failed, and the mode is still what it was.
      this.logger.error(`Availability change failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Availability update failed' });
    }

    const outcome = data as AvailabilityRpcResult | null;

    switch (outcome?.result) {
      case 'CHANGED':
      case 'NOOP':
        return toResponse(outcome);
      case 'NOT_FOUND':
        throw new DomainError('NOT_FOUND', { message: 'Restaurant not found' });
      case 'INVALID_TRANSITION':
        throw new DomainError('INVALID_TRANSITION', {
          details: { currentMode: outcome.currentMode, targetMode },
        });
      default:
        this.logger.error(`Availability function returned an unrecognised result for restaurant ${restaurantId}`);
        throw new DomainError('INTERNAL_ERROR', { message: 'Availability update failed' });
    }
  }
}

function toResponse(outcome: AvailabilityRpcResult): RestaurantAvailabilityResponse {
  return {
    restaurantId: outcome.restaurantId as string,
    availabilityMode: outcome.availabilityMode as RestaurantAvailabilityMode,
    busyPrepMinutes: outcome.busyPrepMinutes ?? null,
    updatedAt: outcome.updatedAt as string,
  };
}
