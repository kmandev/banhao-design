import { Injectable, Logger } from '@nestjs/common';
import type { RiderLocationRequest, RiderLocationResponse } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/** `rider_availability`, what a location write returns. */
interface AvailabilityRow {
  rider_id: string;
  location_updated_at: string | null;
}

/**
 * `POST /api/v1/rider/location` — the rider's current position.
 *
 * Exists because DEC-037 makes *"a valid recorded location"* part of dispatch
 * eligibility while `20260811000011_rls_policies.sql` grants a rider
 * `update (is_online)` and nothing more: without this endpoint every
 * `rider_availability.location` stays null and the broadcast pool is empty.
 * This is the minimum capability that closes that gap, and nothing more.
 *
 * ## Privacy — deliberately the narrowest possible surface
 *
 * `rider_availability` is the schema's own *"most privacy-sensitive table"*.
 * This service writes **latest position only**: three columns on one row, no
 * history table, no append log, no retention or purge mechanism, and no
 * staleness rule (none is decided — DEC-037 records that the eligibility
 * predicate is "has a location", not "has a fresh one"). Q-012 (PDPA lawful
 * basis and retention) and DBQ-005 gate location *history*, and this endpoint
 * creates none, so it neither answers nor pre-empts them.
 *
 * ## Why a rider cannot write another rider's location
 *
 * Structurally, not by a check: the rider id is never accepted from the
 * request. There is no rider id in the path, and `riderLocationRequestSchema`
 * is `.strict()`, so a body carrying one is rejected outright. The id comes
 * from `user.capabilities.rider.riderId`, resolved from the database against a
 * verified JWT on every request (DEC-033 / DEC-APP-004), and is the `WHERE`
 * clause of the write.
 */
@Injectable()
export class RiderLocationService {
  private readonly logger = new Logger(RiderLocationService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async updateLocation(
    riderId: string,
    location: RiderLocationRequest,
  ): Promise<RiderLocationResponse> {
    const locationUpdatedAt = new Date().toISOString();

    // `location` itself is never written: it is `generated always as … stored`
    // from this pair, so Postgres derives the geography point (and therefore
    // eligibility) from the coordinates alone. Writing it would be rejected,
    // and computing it here would duplicate the schema's own definition.
    const patch = {
      last_lat: location.lat,
      last_lng: location.lng,
      location_updated_at: locationUpdatedAt,
    };

    const updated = await this.updateExisting(riderId, patch);
    if (updated) {
      return { riderId: updated.rider_id, locationUpdatedAt };
    }

    // No row yet — a rider who has never been online. `rider_id` is the primary
    // key, so a concurrent first write collides on it; that 23505 is absorbed
    // and the update is retried, rather than a `SELECT` deciding which of the
    // two paths to take. `is_online` is deliberately absent from the insert:
    // it keeps its column default (false), because reporting a position is not
    // a statement that the rider is available for work.
    const { error: insertError } = await this.supabase.admin
      .from('rider_availability')
      .insert({ rider_id: riderId, ...patch });

    if (insertError && !isUniqueViolation(insertError)) {
      this.logger.error(`rider_availability insert failed for ${riderId}: ${insertError.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Location update failed' });
    }

    if (!insertError) {
      return { riderId, locationUpdatedAt };
    }

    const retried = await this.updateExisting(riderId, patch);
    if (!retried) {
      this.logger.error(`rider_availability row vanished mid-write for ${riderId}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Location update failed' });
    }

    return { riderId: retried.rider_id, locationUpdatedAt };
  }

  /** The one write, scoped to the caller's own row by primary key. */
  private async updateExisting(
    riderId: string,
    patch: Record<string, unknown>,
  ): Promise<AvailabilityRow | null> {
    const { data, error } = await this.supabase.admin
      .from('rider_availability')
      .update(patch)
      .eq('rider_id', riderId)
      .select('rider_id, location_updated_at')
      .maybeSingle<AvailabilityRow>();

    if (error) {
      this.logger.error(`rider_availability update failed for ${riderId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Location update failed' });
    }

    return data ?? null;
  }
}

/** Same shape as the order and payment domains' own helper — `23505`, however it surfaces. */
function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
