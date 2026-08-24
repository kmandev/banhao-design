import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/** How many timed-out `payment_attempts` one tick expires at most. */
const BATCH_SIZE = 25;

/** `payment_attempts`, the columns an expired row needs for cascading. */
interface ExpiredAttemptRow {
  id: string;
  payment_id: string;
}

/**
 * Payment attempt (QR) expiry — the next Phase F step after F-2b — DEC-029,
 * `docs/PAYMENT_LIFECYCLE.md` §3.
 *
 * Runs from `POST /internal/tick` (`TickController`), alongside but
 * independently of `PaymentEventProcessingService`. A `payment_attempts` row
 * carries its own `expires_at` (set at creation — 10 minutes, `payments.service.ts`);
 * once it passes with no successful webhook, the attempt — and, when it is
 * still the payment's current one, the payment — moves to `EXPIRED`. The
 * order is deliberately left untouched: per the state table's pairing
 * column, `EXPIRED` payment pairs with an order still in `PENDING_PAYMENT`
 * — DEC-029 leaves whether/how to resolve that further as an `OPEN` policy
 * question, and inventing one here would be exactly the kind of
 * undocumented decision this codebase's own conventions forbid.
 *
 * ## Claiming — the guarded UPDATE is the sole concurrency authority
 *
 * `processOne` claims an attempt with a single conditional
 * `UPDATE … SET state = 'EXPIRED' WHERE id = … AND state = 'PENDING' AND
 * expires_at < now()`, matching `PaymentEventProcessingService`'s own
 * discipline (never a prior `SELECT` to decide). This is exactly what makes
 * it safe to race against that service: if a webhook already moved the
 * attempt to `SUCCESS` (or any other terminal state), this `UPDATE` matches
 * 0 rows and the attempt is left alone. Symmetrically, if this service wins
 * first, `PaymentEventProcessingService.completeSuccessSideEffects`'s own
 * guards (`state IN ('PENDING', 'PROCESSING')` / `state = 'PENDING'`) mean a
 * later webhook simply cannot re-open an already-`EXPIRED` attempt or
 * payment — it falls through to that service's existing `LATE_PAYMENT`
 * handling untouched by this class.
 *
 * ## What this service deliberately does NOT do
 *
 * No order mutation of any kind — no `orders` UPDATE, no
 * `order_status_history` write, no cancellation. No new attempt is created
 * ("regenerate QR after expiry" is a distinct, not-yet-decided piece of
 * work — see `PaymentsService`). No ledger, settlement, refund, outbox or
 * audit-log writes, for the same DEC-025/Q-020 reasons
 * `PaymentEventProcessingService` already documents.
 */
@Injectable()
export class PaymentAttemptExpiryService {
  private readonly logger = new Logger(PaymentAttemptExpiryService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Claims and expires up to `BATCH_SIZE` timed-out attempts. Called once per tick. */
  async processExpiredAttempts(): Promise<{ expired: number; skipped: number }> {
    const nowIso = new Date().toISOString();

    const { data: candidates, error } = await this.supabase.admin
      .from('payment_attempts')
      .select('id')
      .eq('state', 'PENDING')
      .lt('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(BATCH_SIZE)
      .returns<{ id: string }[]>();

    if (error) {
      this.logger.error(`Failed to list expired payment_attempts: ${error.message}`);
      return { expired: 0, skipped: 0 };
    }

    let expired = 0;
    let skipped = 0;

    for (const row of candidates ?? []) {
      const outcome = await this.processOne(row.id);
      if (outcome === 'expired') {
        expired++;
      } else {
        skipped++;
      }
    }

    return { expired, skipped };
  }

  /**
   * Claims one attempt by id. Returns `'skipped'` for an attempt that is no
   * longer `PENDING`, not yet past `expires_at`, or nonexistent — every case
   * is a legitimate skip (most commonly: `PaymentEventProcessingService`
   * already won the race), never an error.
   */
  async processOne(attemptId: string): Promise<'expired' | 'skipped'> {
    const nowIso = new Date().toISOString();

    const { data: claimed, error: claimError } = await this.supabase.admin
      .from('payment_attempts')
      .update({ state: 'EXPIRED' })
      .eq('id', attemptId)
      .eq('state', 'PENDING')
      .lt('expires_at', nowIso)
      .select('id, payment_id')
      .maybeSingle<ExpiredAttemptRow>();

    if (claimError) {
      this.logger.error(`Failed to expire payment_attempt ${attemptId}: ${claimError.message}`);
      return 'skipped';
    }

    if (!claimed) {
      return 'skipped';
    }

    await this.expireParentPaymentIfCurrent(claimed);
    return 'expired';
  }

  /**
   * Expires the parent `payments` row only when the just-expired attempt is
   * still that payment's current one (highest `attempt_no`) — a historical,
   * superseded attempt expiring must never speak for the payment.
   */
  private async expireParentPaymentIfCurrent(attempt: ExpiredAttemptRow): Promise<void> {
    const { data: current, error: currentError } = await this.supabase.admin
      .from('payment_attempts')
      .select('id')
      .eq('payment_id', attempt.payment_id)
      .order('attempt_no', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (currentError) {
      this.logger.error(
        `Failed to determine the current attempt for payment ${attempt.payment_id}: ${currentError.message}`,
      );
      return;
    }

    if (current?.id !== attempt.id) {
      return;
    }

    const { error: paymentError } = await this.supabase.admin
      .from('payments')
      .update({ state: 'EXPIRED' })
      .eq('id', attempt.payment_id)
      .in('state', ['PENDING', 'PROCESSING']);

    if (paymentError) {
      this.logger.error(`payments EXPIRED transition failed for ${attempt.payment_id}: ${paymentError.message}`);
    }
  }
}
