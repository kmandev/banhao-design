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
 * ## Transition guard — ADR-003, in the WHERE clause
 *
 * The decision lock's explicit, approved rule: resume always returns to
 * NORMAL, never directly to BUSY (`PAUSED → NORMAL → BUSY` is two calls, not
 * one). NORMAL is reachable from any mode (it is the universal reset/resume).
 * BUSY is reachable only from NORMAL or BUSY itself (re-choosing a value
 * while already Busy). PAUSED is reachable from NORMAL, BUSY, or PAUSED
 * itself (a repeated pause is idempotent, AC-12). This is enforced as a
 * guarded conditional `UPDATE ... WHERE availability_mode = ANY(...)` —
 * never a `SELECT`-then-check-then-`UPDATE` — matching every other guarded
 * transition in this codebase (`OrdersService`'s accept/start-preparing/etc).
 *
 * ## Idempotency — AC-12
 *
 * A request that would not change anything (same mode, same busy minutes)
 * short-circuits before the `UPDATE`: it returns the current row unchanged
 * and writes no audit row. "A repeated identical mode change is idempotent —
 * same mode, no error, no duplicate audit row" is the design's own acceptance
 * criterion, verbatim.
 *
 * ## Audit
 *
 * One `audit_logs` row per real change, `actor_type = 'MERCHANT'` — a
 * merchant mode change is never `SYSTEM`, never `OPERATOR` (M-13 seams
 * table). No `availability_set_by` column exists (the decision lock withdrew
 * it): `audit_logs.actor_id` already carries who made this change, and BQ-013
 * — the only feature that would introduce a second setter — is deferred out
 * of this phase entirely.
 */

interface RestaurantAvailabilityRow {
  id: string;
  availability_mode: RestaurantAvailabilityMode;
  busy_prep_minutes: number | null;
  updated_at: string;
}

/** Which current modes a target mode may be entered from. NORMAL is universal (resume/reset); PAUSED → BUSY is explicitly not implemented. */
const ALLOWED_FROM: Record<RestaurantAvailabilityMode, RestaurantAvailabilityMode[]> = {
  NORMAL: ['NORMAL', 'BUSY', 'PAUSED'],
  BUSY: ['NORMAL', 'BUSY'],
  PAUSED: ['NORMAL', 'BUSY', 'PAUSED'],
};

@Injectable()
export class RestaurantAvailabilityService {
  private readonly logger = new Logger(RestaurantAvailabilityService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async setAvailability(
    restaurantId: string,
    actorUserId: string,
    input: SetRestaurantAvailabilityInput,
  ): Promise<RestaurantAvailabilityResponse> {
    const targetMode = input.mode;
    const targetBusyPrepMinutes = input.mode === 'BUSY' ? input.busyPrepMinutes : null;

    const current = await this.fetchCurrent(restaurantId);
    if (!current) {
      throw new DomainError('NOT_FOUND', { message: 'Restaurant not found' });
    }

    // AC-12: a repeated identical mode change is a no-op — no UPDATE, no
    // audit row, just the current state returned.
    if (current.availability_mode === targetMode && current.busy_prep_minutes === targetBusyPrepMinutes) {
      return toResponse(current);
    }

    const allowedFrom = ALLOWED_FROM[targetMode];
    if (!allowedFrom.includes(current.availability_mode)) {
      // PAUSED -> BUSY is the one transition M-13 explicitly does not
      // implement (§11: "If merchant wants Busy after Pause:
      // PAUSED -> NORMAL -> BUSY"). Any other unreachable combination fails
      // the same way, with the same code.
      throw new DomainError('INVALID_TRANSITION', {
        details: { currentMode: current.availability_mode, targetMode },
      });
    }

    const { data, error } = await this.supabase.admin
      .from('restaurants')
      .update({
        availability_mode: targetMode,
        busy_prep_minutes: targetBusyPrepMinutes,
      })
      .eq('id', restaurantId)
      // ADR-003: the transition guard rides in the same WHERE clause as the
      // write, never a separate check. A concurrent change that already
      // moved the row out of the allowed source set makes this UPDATE match
      // 0 rows rather than silently overwriting a mode another session just
      // set — the same "stale-state" contract OrdersService documents for
      // its own guarded transitions.
      .in('availability_mode', allowedFrom)
      .select('id, availability_mode, busy_prep_minutes, updated_at')
      .maybeSingle<RestaurantAvailabilityRow>();

    if (error) {
      this.logger.error(`Availability update failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Availability update failed' });
    }

    if (!data) {
      // The guard matched 0 rows: either a concurrent change moved the mode
      // out of the allowed source set between our read and this write (AC-13
      // — the two sessions converge on whichever write actually landed, and
      // this caller's stale attempt is reported rather than silently
      // dropped), or the restaurant was deleted. Re-read to tell the two
      // apart with the correct code, rather than guessing.
      const recheck = await this.fetchCurrent(restaurantId);
      if (!recheck) {
        throw new DomainError('NOT_FOUND', { message: 'Restaurant not found' });
      }
      throw new DomainError('INVALID_TRANSITION', {
        details: { currentMode: recheck.availability_mode, targetMode },
      });
    }

    await this.recordAudit(restaurantId, actorUserId, current, data);

    return toResponse(data);
  }

  private async fetchCurrent(restaurantId: string): Promise<RestaurantAvailabilityRow | null> {
    const { data, error } = await this.supabase.admin
      .from('restaurants')
      .select('id, availability_mode, busy_prep_minutes, updated_at')
      .eq('id', restaurantId)
      .maybeSingle<RestaurantAvailabilityRow>();

    if (error) {
      this.logger.error(`Availability read failed for restaurant ${restaurantId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Availability read failed' });
    }

    return data;
  }

  /**
   * One `audit_logs` row, `actor_type = 'MERCHANT'`. Never throws — matching
   * every other audit-write call site in this codebase (`AiAuditService`):
   * the mode change already committed, and an audit-write failure must not
   * turn a successful transition into a reported failure.
   */
  private async recordAudit(
    restaurantId: string,
    actorUserId: string,
    before: RestaurantAvailabilityRow,
    after: RestaurantAvailabilityRow,
  ): Promise<void> {
    const correlationId = uuidSchema.safeParse(getCorrelationId());

    const { error } = await this.supabase.admin.from('audit_logs').insert({
      actor_type: 'MERCHANT',
      actor_id: actorUserId,
      action: 'MerchantAvailabilityChanged',
      entity_type: 'restaurant',
      entity_id: restaurantId,
      before: {
        availabilityMode: before.availability_mode,
        busyPrepMinutes: before.busy_prep_minutes,
      },
      after: {
        availabilityMode: after.availability_mode,
        busyPrepMinutes: after.busy_prep_minutes,
      },
      reason: null,
      correlation_id: correlationId.success ? correlationId.data : null,
      source: 'api',
    });

    if (error) {
      this.logger.error(`audit_logs write failed for restaurant ${restaurantId} availability change: ${error.message}`);
    }
  }
}

function toResponse(row: RestaurantAvailabilityRow): RestaurantAvailabilityResponse {
  return {
    restaurantId: row.id,
    availabilityMode: row.availability_mode,
    busyPrepMinutes: row.busy_prep_minutes,
    updatedAt: row.updated_at,
  };
}
