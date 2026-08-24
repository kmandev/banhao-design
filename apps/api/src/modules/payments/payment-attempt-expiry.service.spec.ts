import { PaymentAttemptExpiryService } from './payment-attempt-expiry.service';
import { PaymentEventProcessingService } from './payment-event-processing.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Payment-attempt (QR) expiry — the next Phase F step after F-2b (DEC-029).
 * Same stub shape as `payment-event-processing.service.spec.ts`: a fake
 * `supabase.admin.from()` that records every filter/payload a statement was
 * built with and returns queued results in call order, so a test can assert
 * the guard is actually IN the query, not merely checked afterward in
 * application code.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  lt: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {}, lt: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        lt(column: string, value: unknown) {
          call.lt[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          call.eq[`${column}__is`] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const ATTEMPT_ID = 'attempt-1';
const PAYMENT_ID = 'payment-1';

describe('PaymentAttemptExpiryService.processOne — the current attempt', () => {
  it('1. an expired PENDING attempt is expired, and its current parent payment becomes EXPIRED', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: ATTEMPT_ID, payment_id: PAYMENT_ID }, error: null }, // claim
      { data: { id: ATTEMPT_ID }, error: null }, // current-attempt lookup: this one IS current
      { data: null, error: null }, // payments -> EXPIRED
    ]);
    const service = new PaymentAttemptExpiryService(supabase);

    const result = await service.processOne(ATTEMPT_ID);

    expect(result).toBe('expired');

    const claimCall = calls.find((c) => c.table === 'payment_attempts' && c.op === 'update');
    expect(claimCall?.payload).toEqual({ state: 'EXPIRED' });
    expect(claimCall?.eq).toMatchObject({ id: ATTEMPT_ID, state: 'PENDING' });
    expect(claimCall?.lt).toHaveProperty('expires_at');

    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(paymentUpdate?.payload).toEqual({ state: 'EXPIRED' });
    expect(paymentUpdate?.eq).toMatchObject({ id: PAYMENT_ID });
    expect(paymentUpdate?.in).toMatchObject({ state: ['PENDING', 'PROCESSING'] });
  });

  it('7. a historical (non-current) attempt expires without expiring the parent payment', async () => {
    const OTHER_CURRENT_ATTEMPT_ID = 'attempt-2';
    const { supabase, calls } = supabaseStub([
      { data: { id: ATTEMPT_ID, payment_id: PAYMENT_ID }, error: null }, // claim (a historical attempt)
      { data: { id: OTHER_CURRENT_ATTEMPT_ID }, error: null }, // current attempt is a DIFFERENT, later one
    ]);
    const service = new PaymentAttemptExpiryService(supabase);

    const result = await service.processOne(ATTEMPT_ID);

    expect(result).toBe('expired');
    expect(calls.find((c) => c.table === 'payments')).toBeUndefined();
  });
});

describe('PaymentAttemptExpiryService.processOne — claiming / races', () => {
  it('2. a not-yet-expired attempt is left untouched (guarded UPDATE matches 0 rows)', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const service = new PaymentAttemptExpiryService(supabase);

    const result = await service.processOne(ATTEMPT_ID);

    expect(result).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  it('3/4/5/6/11. a SUCCESS/EXPIRED/FAILED/CANCELLED attempt (already resolved by F-2b or a prior tick) is untouched', async () => {
    // The guarded UPDATE's `WHERE state = 'PENDING'` cannot match a row in
    // any of these states, regardless of which one — the stub returning
    // `null` for the claim update is exactly what a 0-row match looks like,
    // proving the race-loser-skips-silently behavior required whether F-2b
    // already won (SUCCESS) or a previous tick already ran (EXPIRED).
    for (const _terminalState of ['SUCCESS', 'EXPIRED', 'FAILED', 'CANCELLED']) {
      const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
      const service = new PaymentAttemptExpiryService(supabase);

      const result = await service.processOne(ATTEMPT_ID);

      expect(result).toBe('skipped');
      expect(calls).toHaveLength(1);
      expect(calls.find((c) => c.table === 'payments')).toBeUndefined();
    }
  });

  it('10. idempotent rerun: processing the same attempt id twice never errors and only expires the payment once', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: ATTEMPT_ID, payment_id: PAYMENT_ID }, error: null }, // first run claims it
      { data: { id: ATTEMPT_ID }, error: null },
      { data: null, error: null }, // payments -> EXPIRED
      { data: null, error: null }, // second run: already EXPIRED, claim matches 0 rows
    ]);
    const service = new PaymentAttemptExpiryService(supabase);

    const first = await service.processOne(ATTEMPT_ID);
    const second = await service.processOne(ATTEMPT_ID);

    expect(first).toBe('expired');
    expect(second).toBe('skipped');
    expect(calls.filter((c) => c.table === 'payments' && c.op === 'update')).toHaveLength(1);
  });
});

describe('PaymentAttemptExpiryService.processOne — payment guard', () => {
  it('8. a payment already SUCCESS is never overwritten, even if its attempt somehow still claims (guarded UPDATE, not a prior read)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: ATTEMPT_ID, payment_id: PAYMENT_ID }, error: null },
      { data: { id: ATTEMPT_ID }, error: null },
      { data: null, error: null }, // payments update: state IN (PENDING, PROCESSING) excludes SUCCESS -> 0 rows, no error
    ]);
    const service = new PaymentAttemptExpiryService(supabase);

    await service.processOne(ATTEMPT_ID);

    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    // The guard itself is what protects SUCCESS — proven by asserting the
    // exact WHERE clause never includes SUCCESS as a matchable state.
    expect(paymentUpdate?.in.state).toEqual(['PENDING', 'PROCESSING']);
  });
});

describe('PaymentAttemptExpiryService.processOne — order safety', () => {
  it('9. expiring an attempt/payment performs no order mutation whatsoever', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: ATTEMPT_ID, payment_id: PAYMENT_ID }, error: null },
      { data: { id: ATTEMPT_ID }, error: null },
      { data: null, error: null },
    ]);
    const service = new PaymentAttemptExpiryService(supabase);

    await service.processOne(ATTEMPT_ID);

    expect(calls.find((c) => c.table === 'orders')).toBeUndefined();
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });
});

describe('PaymentAttemptExpiryService.processExpiredAttempts', () => {
  it('lists expired candidates and aggregates expired/skipped counts', async () => {
    const { supabase } = supabaseStub([{ data: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], error: null }]);
    const service = new PaymentAttemptExpiryService(supabase);
    const spy = jest
      .spyOn(service, 'processOne')
      .mockResolvedValueOnce('expired')
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('expired');

    const result = await service.processExpiredAttempts();

    expect(result).toEqual({ expired: 2, skipped: 1 });
    expect(spy).toHaveBeenNthCalledWith(1, 'a1');
    expect(spy).toHaveBeenNthCalledWith(2, 'a2');
    expect(spy).toHaveBeenNthCalledWith(3, 'a3');
  });

  it('the candidate list itself is filtered to PENDING and expires_at in the past', async () => {
    const { supabase, calls } = supabaseStub([{ data: [], error: null }]);
    const service = new PaymentAttemptExpiryService(supabase);

    await service.processExpiredAttempts();

    const listCall = calls.find((c) => c.table === 'payment_attempts' && c.op === 'select');
    expect(listCall?.eq).toMatchObject({ state: 'PENDING' });
    expect(listCall?.lt).toHaveProperty('expires_at');
  });

  it('returns zero counts (never throws) when listing expired attempts fails', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const service = new PaymentAttemptExpiryService(supabase);

    await expect(service.processExpiredAttempts()).resolves.toEqual({ expired: 0, skipped: 0 });
  });

  it('returns zero counts when nothing is expired, without calling processOne', async () => {
    const { supabase } = supabaseStub([{ data: [], error: null }]);
    const service = new PaymentAttemptExpiryService(supabase);
    const spy = jest.spyOn(service, 'processOne');

    const result = await service.processExpiredAttempts();

    expect(result).toEqual({ expired: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});

/**
 * 12. Late webhook after expiry. `PaymentEventProcessingService`'s own
 * classification logic (F-2b) is exercised here UNMODIFIED — this proves
 * only that it still functions correctly when the payment/attempt rows it
 * reads were put into `EXPIRED` by this new job, which is a state
 * `PaymentEventProcessingService` never itself produces.
 *
 * IMPORTANT — a real gap this test surfaces rather than papers over: F-2b's
 * `orders PENDING_PAYMENT -> PAID` guarded update depends only on the
 * order's own state, never on the payment's. Because
 * `PaymentAttemptExpiryService` (by design, per this task's explicit
 * boundary) never touches `orders`, an order left by pure QR expiry is
 * STILL `PENDING_PAYMENT` — so a late webhook in that exact scenario
 * succeeds normally (the order transitions to PAID) rather than opening a
 * `LATE_PAYMENT` case. `LATE_PAYMENT` is reachable only when the order has
 * ALSO independently left `PENDING_PAYMENT` (e.g. cancelled) by the time
 * the late webhook is processed — modeled below. This is flagged in the
 * implementation report as a newly discovered follow-up, not fixed here:
 * fixing it would mean changing F-2b's classification logic or having this
 * job touch orders, both explicitly out of this task's scope.
 */
describe('Compatibility with PaymentEventProcessingService.processOne — late payment after expiry (DEC-029)', () => {
  const EVENT_ID = 'event-1';
  const PROVIDER = 'null';
  const PROVIDER_EVENT_ID = 'NULL-EVT-1';
  const PROVIDER_PAYMENT_ID = 'NULL-payment-1';
  const ORDER_ID = 'order-1';
  const AMOUNT = 7500;

  it('a webhook arriving for an EXPIRED payment, on an order that has also independently left PENDING_PAYMENT, still opens LATE_PAYMENT', async () => {
    const claimedEvent = {
      id: EVENT_ID,
      provider: PROVIDER,
      provider_event_id: PROVIDER_EVENT_ID,
      raw_payload: {
        providerPaymentId: PROVIDER_PAYMENT_ID,
        amountSatang: AMOUNT,
      },
    };
    // The payment/attempt are EXPIRED here — exactly what
    // PaymentAttemptExpiryService produces — proving F-2b's own,
    // unmodified logic still classifies correctly against that state.
    const expiredPaymentRow = { id: PAYMENT_ID, order_id: ORDER_ID, amount_satang: AMOUNT, state: 'EXPIRED' };
    const expiredAttemptRow = { id: ATTEMPT_ID, state: 'EXPIRED' };

    const { supabase, calls } = supabaseStub([
      { data: claimedEvent, error: null }, // claim
      { data: expiredPaymentRow, error: null }, // payments select
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: expiredAttemptRow, error: null }, // payment_attempts select
      { data: { id: 'txn-1' }, error: null }, // payment_transactions insert
      { data: null, error: null }, // payments update -> 0 rows (not PENDING/PROCESSING)
      { data: null, error: null }, // payment_attempts update -> 0 rows (not PENDING)
      { data: null, error: null }, // orders guarded update -> 0 rows (not PENDING_PAYMENT anymore)
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null }, // orders current-state read
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'LATE_PAYMENT',
      payment_event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });
  });
});
