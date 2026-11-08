import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-069 §3 — an order still `CREATED` this long after it was placed is
 * expired. Fifteen minutes: longer than the ten-minute payment QR, so it never
 * cuts off a customer about to pay. The owner's number, not a tuning knob.
 */
export const CREATED_ORDER_EXPIRY_MINUTES = 15;

/** How many orders one tick expires. A bound on work, not a policy value. */
const BATCH_SIZE = 25;

export interface StaleCreatedOrderExpiryResult {
  expired: number;
  failed: boolean;
}

/**
 * Expires orders abandoned before a payment was ever started.
 *
 * In the app `CREATED` lasts a moment: Checkout creates the order and the QR
 * screen moves it to `PENDING_PAYMENT` at once. An order abandoned in between
 * (app killed, network lost) used to stay `CREATED` forever; the payment
 * expiry sweeps only look at `PENDING_PAYMENT`. No money is involved — no
 * payment exists for a `CREATED` order — so the outcome is simply
 * `PAYMENT_EXPIRED`, the same state an unpaid QR ends in.
 *
 * ADR-003: one guarded `UPDATE` with the state and the age in its `WHERE`.
 * `PaymentsService.createPayment` moves `CREATED → PENDING_PAYMENT` under the
 * same `state = 'CREATED'` guard, so whichever runs first wins and the other
 * matches no row. Each expired order gets a `SYSTEM` history row.
 *
 * Never throws: a failure here must not stop the tick's later phases.
 */
@Injectable()
export class StaleCreatedOrderExpiryService {
  private readonly logger = new Logger(StaleCreatedOrderExpiryService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async run(now: Date = new Date()): Promise<StaleCreatedOrderExpiryResult> {
    const cutoff = new Date(now.getTime() - CREATED_ORDER_EXPIRY_MINUTES * 60_000).toISOString();

    try {
      const { data: candidates, error: readError } = await this.supabase.admin
        .from('orders')
        .select('id')
        .eq('state', 'CREATED')
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE)
        .returns<{ id: string }[]>();
      if (readError) throw new Error(`candidate read failed: ${readError.message}`);
      if (!candidates || candidates.length === 0) return { expired: 0, failed: false };

      const { data: expired, error: updateError } = await this.supabase.admin
        .from('orders')
        .update({ state: 'PAYMENT_EXPIRED' })
        .in(
          'id',
          candidates.map((row) => row.id),
        )
        .eq('state', 'CREATED')
        .lt('created_at', cutoff)
        .select('id')
        .returns<{ id: string }[]>();
      if (updateError) throw new Error(`expiry update failed: ${updateError.message}`);

      const rows = expired ?? [];
      if (rows.length > 0) {
        const { error: historyError } = await this.supabase.admin.from('order_status_history').insert(
          rows.map((row) => ({
            order_id: row.id,
            from_state: 'CREATED',
            to_state: 'PAYMENT_EXPIRED',
            actor_type: 'SYSTEM',
            actor_id: null,
            reason: `No payment started within ${CREATED_ORDER_EXPIRY_MINUTES} minutes (DEC-069)`,
          })),
        );
        if (historyError) {
          // The orders are expired; only their history line is missing. Logged, not retried.
          this.logger.error(`order_status_history insert failed for expired CREATED orders: ${historyError.message}`);
        }
      }

      return { expired: rows.length, failed: false };
    } catch (cause) {
      this.logger.error(`Stale CREATED order expiry failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      return { expired: 0, failed: true };
    }
  }
}
