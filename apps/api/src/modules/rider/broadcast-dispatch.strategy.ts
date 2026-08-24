import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { DispatchStrategy } from './dispatch-strategy.interface';

/** `riders`, the id of one approved rider. */
interface ApprovedRiderRow {
  id: string;
}

/** `rider_availability`, one online rider with a recorded position. */
interface AvailableRiderRow {
  rider_id: string;
}

/** The only rider status that may be dispatched to — the same constant `CapabilitiesService` authorises with. */
const ACTIVE_RIDER_STATUS = 'APPROVED';

/**
 * Broadcast dispatch (DEC-020, Model C) with DEC-037's Phase 1 eligibility
 * rule: **`APPROVED` + online + a valid recorded location.**
 *
 * ## What this class deliberately does not do
 *
 * No radius. No `ST_DWithin`. No distance. No `ORDER BY`. No ranking, scoring,
 * fairness weighting, tie-break or route optimisation. The whole district is
 * one pool — DEC-020's own rationale ("with 8–12 riders the whole district is
 * one pool"), made explicit by DEC-037 after BQ-022's working-area half was
 * decided as *no numeric radius*.
 *
 * ⚠️ `rider_availability` carries a PostGIS `location` column and a GIST index
 * over it, and `restaurants` carries `service_radius_m`. **Neither authorises a
 * proximity filter here.** The index exists for a decision that has not been
 * taken; using it would invent BQ-008's answer, which DEC-E-04 already refused
 * to do on the customer side. `location` is read for one purpose only: to know
 * whether the rider has a position at all.
 *
 * ## Why two reads rather than one join
 *
 * PostgREST can embed `riders` inside `rider_availability`, but the embed is a
 * *left* join by default — a filter on the embedded resource shapes what comes
 * back inside each row rather than reliably removing the parent row, which
 * would silently widen the pool to non-approved riders. Two filtered reads,
 * intersected here, cannot be misread that way. The pool is district-sized
 * (8–12 riders, DEC-031), so this is two small indexed reads per round.
 */
@Injectable()
export class BroadcastDispatchStrategy implements DispatchStrategy {
  private readonly logger = new Logger(BroadcastDispatchStrategy.name);

  constructor(private readonly supabase: SupabaseService) {}

  async selectCandidateRiderIds(): Promise<string[]> {
    // Online riders that actually have a position. `.not('location', 'is', null)`
    // is the "valid location" half of DEC-037 — `location` is generated from
    // `last_lat`/`last_lng` and is null unless both are present, so this one
    // predicate covers the pair without trusting either column separately.
    const { data: available, error: availableError } = await this.supabase.admin
      .from('rider_availability')
      .select('rider_id')
      .eq('is_online', true)
      .not('location', 'is', null)
      .returns<AvailableRiderRow[]>();

    if (availableError) {
      // A failed read tells us nothing about who is eligible. An empty pool is
      // the fail-closed answer: no offers is always safe, offering to a rider
      // who may be suspended is not.
      this.logger.error(`rider_availability read failed: ${availableError.message}`);
      return [];
    }

    const onlineRiderIds = (available ?? []).map((row) => row.rider_id);
    if (onlineRiderIds.length === 0) {
      return [];
    }

    // Approval is re-checked against `riders` rather than assumed from the
    // availability row: `rider_availability` has no status column, and DEC-APP-004's
    // whole point is that a revoked grant must take effect on the next read.
    // Matching the one granting status (rather than excluding the denying ones)
    // means a status added later is denied by default.
    const { data: approved, error: approvedError } = await this.supabase.admin
      .from('riders')
      .select('id')
      .eq('status', ACTIVE_RIDER_STATUS)
      .in('id', onlineRiderIds)
      .returns<ApprovedRiderRow[]>();

    if (approvedError) {
      this.logger.error(`riders read failed: ${approvedError.message}`);
      return [];
    }

    return (approved ?? []).map((row) => row.id);
  }
}
