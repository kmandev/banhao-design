import { LEGACY_EXPIRY_BATCH_SIZE, LegacyPaymentExpiryService } from './legacy-payment-expiry.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * D-01 legacy freeze — the tick-side caller of `expire_legacy_unpaid_orders()`.
 *
 * The freeze's own correctness (the no-snapshot predicate, the guarded
 * UPDATE, `FOR UPDATE SKIP LOCKED`, the SYSTEM history row, idempotency, and
 * that PAID/CANCELLED/snapshot-bearing orders are never touched) lives in the
 * database function and is proven against real PostgreSQL by
 * `supabase/tests/d01_commission_snapshot_test.sql`. This file proves the
 * wiring: the call shape, the bounded batch, the reported count, and that a
 * failure never throws out of the first tick phase.
 */
function stub(result: { data: unknown; error: { message: string } | null }) {
  const rpc = jest.fn().mockResolvedValue(result);
  const supabase = { admin: { rpc } } as unknown as SupabaseService;
  return { supabase, rpc };
}

describe('LegacyPaymentExpiryService.expireLegacyUnpaidOrders', () => {
  it('calls expire_legacy_unpaid_orders with the bounded batch size, and nothing else', async () => {
    const { supabase, rpc } = stub({ data: [], error: null });

    await new LegacyPaymentExpiryService(supabase).expireLegacyUnpaidOrders();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('expire_legacy_unpaid_orders', { p_batch_size: LEGACY_EXPIRY_BATCH_SIZE });
    expect(LEGACY_EXPIRY_BATCH_SIZE).toBe(25);
  });

  it('reports how many legacy orders the database froze this tick', async () => {
    const { supabase } = stub({
      data: [
        { order_id: 'order-1', from_state: 'PENDING_PAYMENT' },
        { order_id: 'order-2', from_state: 'CREATED' },
      ],
      error: null,
    });

    const result = await new LegacyPaymentExpiryService(supabase).expireLegacyUnpaidOrders();

    expect(result).toEqual({ expired: 2, failed: false });
  });

  it('reports zero when there is nothing left to freeze — a repeated tick is a no-op', async () => {
    const { supabase } = stub({ data: [], error: null });

    const result = await new LegacyPaymentExpiryService(supabase).expireLegacyUnpaidOrders();

    expect(result).toEqual({ expired: 0, failed: false });
  });

  it('never throws — a failed freeze pass is reported, so the payment phases behind it still run', async () => {
    const { supabase } = stub({ data: null, error: { message: 'function expire_legacy_unpaid_orders does not exist' } });

    await expect(new LegacyPaymentExpiryService(supabase).expireLegacyUnpaidOrders()).resolves.toEqual({
      expired: 0,
      failed: true,
    });
  });

  it('treats a non-array result as nothing frozen rather than guessing', async () => {
    const { supabase } = stub({ data: null, error: null });

    const result = await new LegacyPaymentExpiryService(supabase).expireLegacyUnpaidOrders();

    expect(result).toEqual({ expired: 0, failed: false });
  });
});
