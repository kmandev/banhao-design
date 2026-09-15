import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/** How many legacy unpaid orders one tick freezes at most — the same bound every tick phase here uses. */
export const LEGACY_EXPIRY_BATCH_SIZE = 25;

export interface LegacyPaymentExpiryResult {
  /** Orders moved to `PAYMENT_EXPIRED` by this run. */
  expired: number;
  /** `true` when the freeze could not run this tick. Logged, never thrown (see class doc). */
  failed: boolean;
}

/**
 * D-01 legacy freeze (D-01-CUTOVER-1, D-01-ARCH-1/2/5).
 *
 * An order created before the order-time commission snapshot existed has no
 * `order_commission_snapshots` row and never can have one. No snapshot is
 * ever backfilled and no historical rate is recoverable. Under the D-01
 * regime such an order must not complete payment, so this phase moves every
 * `CREATED`/`PENDING_PAYMENT` order without a snapshot to `PAYMENT_EXPIRED`.
 *
 * The work is one statement in `expire_legacy_unpaid_orders()`
 * (20260915000001). The guarded UPDATE, the `FOR UPDATE SKIP LOCKED`
 * candidate lock, and the `SYSTEM` `order_status_history` row are written
 * together, so there is no crash window between state and history. This
 * class only calls it. The candidate predicate (no snapshot) is not something
 * PostgREST can express as a single guarded write, which is why the logic
 * lives in the database, following the `create_order()` /
 * `release_rider_assignment()` precedent of service-role-only SECURITY
 * INVOKER functions.
 *
 * ## Ordering
 *
 * `TickController` runs this phase FIRST, before `paymentEvents`. Within a
 * tick, every legacy order it can lock is frozen before any payment event is
 * claimed, so that event's guarded `PENDING_PAYMENT → PAID` transition
 * matches 0 rows and becomes `LATE_PAYMENT` (D-01-ARCH-8, no money posted).
 * A legacy order the payment processor wins first (a concurrent tick, or one
 * past this tick's batch bound) becomes `PAID` and is handled by
 * `COMMISSION_SNAPSHOT_MISSING` (D-01-ARCH-9). No cadence is changed and no
 * scheduler is added. It runs at the existing tick cadence (DEC-APP-010).
 *
 * ## Never throws
 *
 * `TickController.handle()` has no per-phase try/catch, and this phase runs
 * first, so a throw here would stop every payment, dispatch and notification
 * phase behind it. A failure is logged and reported as `failed: true`.
 * Skipping one freeze pass is economically safe, because the
 * COMMISSION_SNAPSHOT_MISSING path fails closed for any legacy order paid in
 * the meantime. Stalling the whole tick would not be safe.
 */
@Injectable()
export class LegacyPaymentExpiryService {
  private readonly logger = new Logger(LegacyPaymentExpiryService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async expireLegacyUnpaidOrders(): Promise<LegacyPaymentExpiryResult> {
    const { data, error } = await this.supabase.admin.rpc('expire_legacy_unpaid_orders', {
      p_batch_size: LEGACY_EXPIRY_BATCH_SIZE,
    });

    if (error) {
      this.logger.error(`expire_legacy_unpaid_orders failed: ${error.message}`);
      return { expired: 0, failed: true };
    }

    const rows = Array.isArray(data) ? (data as { order_id: string; from_state: string }[]) : [];

    for (const row of rows) {
      this.logger.warn(
        `order ${row.order_id} frozen ${row.from_state} → PAYMENT_EXPIRED: legacy unpaid order with no ` +
          `order-time commission snapshot (D-01-CUTOVER-1)`,
      );
    }

    return { expired: rows.length, failed: false };
  }
}
