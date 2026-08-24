import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  DISPATCHABLE_DELIVERY_STATES,
  DISPATCH_BATCH_SIZE,
  offerExpiryFor,
  roundNumberFor,
} from './dispatch-policy';
import { DISPATCH_STRATEGY, type DispatchStrategy } from './dispatch-strategy.interface';

/** `deliveries`, the columns one dispatch round needs. */
interface DispatchableDeliveryRow {
  id: string;
  created_at: string;
}

export interface DispatchRoundResult {
  /** Deliveries this round broadcast for. */
  deliveries: number;
  /** `rider_assignment_attempts` rows this round actually created. */
  offers: number;
  /** Offers whose 60-second window had closed and were marked `EXPIRED`. */
  expiredOffers: number;
}

/**
 * One broadcast dispatch round — Phase G-2, DEC-020 (broadcast → first accept)
 * with DEC-037's parameters.
 *
 * Runs from `POST /internal/tick` (`TickController`), alongside but
 * independently of the payment services, exactly as
 * `PaymentAttemptExpiryService` does. There is **no scheduler here**: DEC-APP-010
 * fixes one Cloudflare Worker cron at 60 seconds as the only one in the system,
 * and DEC-037's 60-second round interval was chosen to be that tick. One tick =
 * one round is therefore the whole of the scheduling design.
 *
 * ## Idempotency — the unique constraint is the sole authority
 *
 * A round writes offers with `INSERT`, never `SELECT`-then-`INSERT`:
 * `rider_assignment_attempts_delivery_rider_round_key` (`delivery_id`,
 * `rider_id`, `round_no`) decides whether an offer already exists, and a 23505
 * is absorbed as "already offered this round" (DEC-028, and the same discipline
 * `OrdersService.ensureDeliveryForAcceptedOrder` and the payment domain
 * already apply to their own natural keys). `round_no` is derived from the
 * clock (`roundNumberFor`), so two ticks racing inside the same 60-second
 * window compute the *same* round and collide instead of double-offering.
 *
 * ## What a round deliberately does NOT do
 *
 * It does not assign anyone — an offer is an invitation, and
 * `OfferAcceptanceService`'s guarded `UPDATE` on `deliveries` is the only thing
 * that ever sets `rider_id`. It does not rank, score, sort or filter by
 * distance (see `BroadcastDispatchStrategy`). It touches no order, payment,
 * ledger, refund, reconciliation or settlement row, and computes no money of
 * any kind — `deliveries.rider_earning_satang` is not written here and stays
 * `NULL` while BQ-029 is `OPEN`. It sends no notification: under DEC-APP-008 a
 * rider reads their own pending offers directly through the
 * `rider_assignment_attempts_select_own` RLS policy, which is why offer
 * persistence does not depend on Phase H.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(DISPATCH_STRATEGY) private readonly strategy: DispatchStrategy,
  ) {}

  /** Runs one round. Called once per tick; safe to call twice concurrently. */
  async runDispatchRound(): Promise<DispatchRoundResult> {
    const now = new Date();

    // Expiry first, so a rider who is about to be re-offered is not looking at
    // a stale PENDING row from the previous round while the new one arrives.
    const expiredOffers = await this.expireClosedOffers(now);

    const deliveries = await this.listDispatchableDeliveries();
    if (deliveries.length === 0) {
      // No candidate read at all when there is nothing to dispatch — a round
      // with no work must cost nothing.
      return { deliveries: 0, offers: 0, expiredOffers };
    }

    // Selected once per round, not once per delivery: under DEC-037 the pool
    // does not depend on the delivery (no radius, no proximity), so a second
    // read would return the same rows.
    const riderIds = await this.strategy.selectCandidateRiderIds();
    if (riderIds.length === 0) {
      return { deliveries: deliveries.length, offers: 0, expiredOffers };
    }

    let offers = 0;
    for (const delivery of deliveries) {
      offers += await this.offerDelivery(delivery, riderIds, now);
    }

    return { deliveries: deliveries.length, offers, expiredOffers };
  }

  /**
   * Marks every `PENDING` offer whose window has closed as `EXPIRED`.
   *
   * A guarded conditional `UPDATE` with both conditions in the `WHERE` clause —
   * `expires_at` is the authority on whether an offer is still live (DEC-037's
   * 60 seconds), and a row a rider accepted a moment ago is no longer `PENDING`
   * and is therefore untouched by this statement. `.lt` excludes nulls, so an
   * offer with no window (none is written by this service) is never expired by
   * accident.
   */
  private async expireClosedOffers(now: Date): Promise<number> {
    const { data, error } = await this.supabase.admin
      .from('rider_assignment_attempts')
      .update({ outcome: 'EXPIRED' })
      .eq('outcome', 'PENDING')
      .lt('expires_at', now.toISOString())
      .select('id')
      .returns<{ id: string }[]>();

    if (error) {
      // Non-fatal: expiry is bookkeeping, and an offer that stays PENDING past
      // its `expires_at` is still refused by the accept path, which re-checks
      // the window itself. The round continues.
      this.logger.error(`Offer expiry sweep failed: ${error.message}`);
      return 0;
    }

    return data?.length ?? 0;
  }

  /**
   * The deliveries still looking for a rider.
   *
   * `state IN ('RIDER_SEARCHING','RIDER_REASSIGNING')` matches
   * `deliveries_searching_idx` exactly. An assigned, delivered, failed or
   * abandoned delivery is not in this set and therefore can never be
   * re-broadcast — that guarantee lives in this filter, not in a later check.
   */
  private async listDispatchableDeliveries(): Promise<DispatchableDeliveryRow[]> {
    const { data, error } = await this.supabase.admin
      .from('deliveries')
      .select('id, created_at')
      .in('state', [...DISPATCHABLE_DELIVERY_STATES])
      .order('created_at', { ascending: true })
      .limit(DISPATCH_BATCH_SIZE)
      .returns<DispatchableDeliveryRow[]>();

    if (error) {
      this.logger.error(`Failed to list dispatchable deliveries: ${error.message}`);
      return [];
    }

    return data ?? [];
  }

  /** Writes this round's offers for one delivery. Returns how many rows were new. */
  private async offerDelivery(
    delivery: DispatchableDeliveryRow,
    riderIds: string[],
    now: Date,
  ): Promise<number> {
    const roundNo = roundNumberFor(delivery.created_at, now);
    const offeredAt = now.toISOString();
    const expiresAt = offerExpiryFor(now);

    let created = 0;
    for (const riderId of riderIds) {
      const { error } = await this.supabase.admin.from('rider_assignment_attempts').insert({
        delivery_id: delivery.id,
        rider_id: riderId,
        round_no: roundNo,
        offered_at: offeredAt,
        // DEC-037 / BQ-020 — 60 seconds, computed from this offer's own
        // `offered_at` so the window is exactly the one the rider is shown.
        expires_at: expiresAt,
        outcome: 'PENDING',
      });

      if (!error) {
        created++;
        continue;
      }

      if (isUniqueViolation(error)) {
        // Already offered to this rider in this round — a concurrent tick, or
        // this tick running twice. Absorbed, never a second row, never an error.
        continue;
      }

      // One rider failing must not cost the rest of the broadcast their offer;
      // the delivery stays searching and the next round retries.
      this.logger.error(
        `Offer insert failed for delivery ${delivery.id} rider ${riderId}: ${error.message}`,
      );
    }

    return created;
  }
}

/** Same shape as the order and payment domains' own helper — `23505`, however it surfaces. */
function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('duplicate key');
}
