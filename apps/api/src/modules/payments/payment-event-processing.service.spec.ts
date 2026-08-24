import { PaymentEventProcessingService } from './payment-event-processing.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * F-2b — same stub shape as `orders.service.spec.ts`'s transition tests and
 * `payments.service.spec.ts`'s F-1 tests: a fake `supabase.admin.from()`
 * that records every filter/payload a statement was built with and returns
 * queued results in call order, so a test can assert the guard is actually
 * IN the query, not merely checked afterward in application code.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {} };
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

const EVENT_ID = 'event-1';
const PROVIDER = 'null';
const PROVIDER_EVENT_ID = 'NULL-EVT-1';
const PROVIDER_PAYMENT_ID = 'NULL-payment-1';
const PAYMENT_ID = 'payment-1';
const ATTEMPT_ID = 'attempt-1';
const ORDER_ID = 'order-1';
const AMOUNT = 7500;

function claimedEvent(overrides: { raw_payload?: unknown; event_type?: string } = {}) {
  return {
    id: EVENT_ID,
    provider: PROVIDER,
    provider_event_id: PROVIDER_EVENT_ID,
    event_type: overrides.event_type ?? 'payment.succeeded',
    raw_payload: overrides.raw_payload ?? {
      simulated: true,
      eventType: 'payment.succeeded',
      providerEventId: PROVIDER_EVENT_ID,
      providerPaymentId: PROVIDER_PAYMENT_ID,
      amountSatang: AMOUNT,
    },
  };
}

function paymentRow(overrides: { state?: string; amount_satang?: number } = {}) {
  return {
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount_satang: overrides.amount_satang ?? AMOUNT,
    state: overrides.state ?? 'PENDING',
  };
}

const ATTEMPT_ROW = { id: ATTEMPT_ID, state: 'PENDING' };

describe('PaymentEventProcessingService.processOne — full success path', () => {
  it('resolves payment, records the transaction, transitions payment/attempt/order, and writes history', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim
      { data: paymentRow(), error: null }, // payments select
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: ATTEMPT_ROW, error: null }, // payment_attempts select
      { data: { id: 'txn-1' }, error: null }, // payment_transactions insert
      { data: null, error: null }, // payments -> SUCCESS
      { data: null, error: null }, // payment_attempts -> SUCCESS
      { data: { id: ORDER_ID }, error: null }, // orders -> PAID
      { data: null, error: null }, // order_status_history insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');

    const claimCall = calls.find((c) => c.table === 'payment_events' && c.op === 'update');
    expect(claimCall?.payload).toHaveProperty('processed_at');
    expect(claimCall?.eq).toMatchObject({ id: EVENT_ID, processed_at__is: null });

    const txInsert = calls.find((c) => c.table === 'payment_transactions');
    expect(txInsert?.payload).toMatchObject({
      payment_id: PAYMENT_ID,
      payment_attempt_id: ATTEMPT_ID,
      direction: 'IN',
      amount_satang: AMOUNT,
      provider_transaction_id: PROVIDER_EVENT_ID,
    });

    const paymentUpdate = calls.find(
      (c) => c.table === 'payments' && c.op === 'update' && c.payload?.state === 'SUCCESS',
    );
    expect(paymentUpdate?.eq).toMatchObject({ id: PAYMENT_ID });
    expect(paymentUpdate?.in).toMatchObject({ state: ['PENDING', 'PROCESSING'] });

    const attemptUpdate = calls.find((c) => c.table === 'payment_attempts' && c.op === 'update');
    expect(attemptUpdate?.eq).toMatchObject({ id: ATTEMPT_ID, state: 'PENDING' });

    const orderUpdate = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ state: 'PAID' });
    expect(orderUpdate?.payload).toHaveProperty('paid_at');
    expect(orderUpdate?.eq).toMatchObject({ id: ORDER_ID, state: 'PENDING_PAYMENT' });

    const historyInsert = calls.find((c) => c.table === 'order_status_history');
    expect(historyInsert?.payload).toEqual({
      order_id: ORDER_ID,
      from_state: 'PENDING_PAYMENT',
      to_state: 'PAID',
      actor_type: 'WEBHOOK',
      actor_id: null,
      reason: null,
      correlation_id: null,
    });
  });
});

describe('PaymentEventProcessingService.processOne — claiming', () => {
  it('an already-processed (or nonexistent) event is skipped with no further calls', async () => {
    const { supabase, calls } = supabaseStub([{ data: null, error: null }]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  it('two claim attempts on the same event: the second finds it already processed and skips', async () => {
    const { supabase } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      { data: null, error: null }, // second processOne's claim attempt: 0 rows
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const first = await service.processOne(EVENT_ID);
    const second = await service.processOne(EVENT_ID);

    expect(first).toBe('processed');
    expect(second).toBe('skipped');
  });
});

describe('PaymentEventProcessingService.processOne — resolution', () => {
  it('an unresolvable providerPaymentId opens UNMATCHED_EVENT without a payments lookup', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ raw_payload: {} }), error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.table === 'payments')).toBeUndefined();
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'UNMATCHED_EVENT',
      payment_event_id: EVENT_ID,
      payment_id: null,
      order_id: null,
    });
  });

  it('a providerPaymentId with no matching payment opens UNMATCHED_EVENT', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: null, error: null }, // payments select — not found
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toMatchObject({ kind: 'UNMATCHED_EVENT', payment_event_id: EVENT_ID });
  });
});

describe('PaymentEventProcessingService.processOne — amount validation', () => {
  it('a mismatched amount opens AMOUNT_MISMATCH and never reaches payment_attempts/payment_transactions', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // event amountSatang = 7500
      { data: paymentRow({ amount_satang: 8000 }), error: null }, // persisted amount differs
      { data: null, error: null }, // payment_id backfill
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'payment_attempts')).toBeUndefined();
    expect(calls.find((c) => c.table === 'payment_transactions')).toBeUndefined();
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'AMOUNT_MISMATCH',
      payment_event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });
  });

  it('a missing amountSatang in the payload is also treated as a mismatch, never assumed to match', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toMatchObject({ kind: 'AMOUNT_MISMATCH' });
  });
});

describe('PaymentEventProcessingService.processOne — payment.failed (PROCESSING --> FAILED)', () => {
  it('a normal failure event transitions payments and the current attempt to FAILED, moves no money, touches no order', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID, reason: 'insufficient_funds' } }), error: null }, // claim
      { data: paymentRow(), error: null }, // payments select
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: null, error: null }, // payments -> FAILED
      { data: ATTEMPT_ROW, error: null }, // payment_attempts select (current attempt)
      { data: null, error: null }, // payment_attempts -> FAILED
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');

    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(paymentUpdate?.payload).toMatchObject({ state: 'FAILED', failure_reason: 'insufficient_funds' });
    expect(paymentUpdate?.eq).toMatchObject({ id: PAYMENT_ID });
    expect(paymentUpdate?.in).toMatchObject({ state: ['PENDING', 'PROCESSING'] });

    const attemptUpdate = calls.find((c) => c.table === 'payment_attempts' && c.op === 'update');
    expect(attemptUpdate?.payload).toMatchObject({ state: 'FAILED', failure_reason: 'insufficient_funds' });
    expect(attemptUpdate?.eq).toMatchObject({ id: ATTEMPT_ID, state: 'PENDING' });

    expect(calls.find((c) => c.table === 'payment_transactions')).toBeUndefined();
    expect(calls.find((c) => c.table === 'orders')).toBeUndefined();
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });

  it('a failure event with no reason leaves failure_reason null, never undefined-coerced', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: null },
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    expect(paymentUpdate?.payload).toMatchObject({ failure_reason: null });
  });

  it('an unresolvable providerPaymentId on a failure event still opens UNMATCHED_EVENT, same as success', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: {} }), error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'payments')).toBeUndefined();
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toMatchObject({ kind: 'UNMATCHED_EVENT' });
  });

  it('idempotent retry: a payment already FAILED matches 0 rows on both guarded updates and is silently skipped, no error', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow({ state: 'FAILED' }), error: null },
      { data: null, error: null },
      { data: null, error: null }, // payments update -> 0 rows, already FAILED
      { data: { id: ATTEMPT_ID, state: 'FAILED' }, error: null },
      { data: null, error: null }, // attempt update -> 0 rows, already FAILED
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });

  it('race lost to the success path: a failure event arriving after SUCCESS never overwrites it (guarded UPDATE matches 0 rows)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: null, error: null }, // payments update -> 0 rows, IN (PENDING, PROCESSING) excludes SUCCESS
      { data: { id: ATTEMPT_ID, state: 'SUCCESS' }, error: null },
      { data: null, error: null }, // attempt update -> 0 rows, already SUCCESS not PENDING
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const paymentUpdate = calls.find((c) => c.table === 'payments' && c.op === 'update');
    // The guard itself is what protects SUCCESS — proven by asserting the
    // exact WHERE clause never includes SUCCESS as a matchable state.
    expect(paymentUpdate?.in.state).toEqual(['PENDING', 'PROCESSING']);
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });

  it('a payment with no attempts yet still transitions payments -> FAILED without erroring', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.failed', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: null }, // payments -> FAILED
      { data: null, error: null }, // payment_attempts select -> none found
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'payment_attempts' && c.op === 'update')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService.processOne — unrecognized event type (fail closed)', () => {
  it('an event type that is neither payment.succeeded nor payment.failed releases the claim for retry, never recorded as either', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.refunded', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: null, error: null }, // release update
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('skipped');
    expect(calls.find((c) => c.table === 'payments' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'payment_transactions')).toBeUndefined();
    const releaseCall = calls[calls.length - 1];
    expect(releaseCall?.table).toBe('payment_events');
    expect(releaseCall?.payload).toMatchObject({ processed_at: null });
    expect(releaseCall?.payload?.processing_error).toContain('Unrecognized');
  });
});

describe('PaymentEventProcessingService.processOne — late payment (DEC-029)', () => {
  it('the order having moved elsewhere (e.g. CANCELLED) opens LATE_PAYMENT and never writes history', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null }, // payments -> SUCCESS
      { data: null, error: null }, // payment_attempts -> SUCCESS
      { data: null, error: null }, // orders guarded update: 0 rows — not PENDING_PAYMENT anymore
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null }, // orders current-state read
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'LATE_PAYMENT',
      payment_event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });
  });

  it('does not force the order back to PAID — only the guarded UPDATE is ever attempted, not a second unconditional one', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null },
      { data: null, error: null },
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const orderUpdates = calls.filter((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdates).toHaveLength(1);
  });

  it('an order already correctly PAID (self-heal, no genuine late payment) opens no case at all', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // but it's already correctly PAID
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService.processOne — surplus payment (DEC-030)', () => {
  it('a genuinely new transaction against an already-SUCCESS payment records the transaction and opens SURPLUS_PAYMENT, touching nothing else', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: { id: ATTEMPT_ID, state: 'SUCCESS' }, error: null },
      { data: { id: 'txn-2' }, error: null }, // fresh transaction insert succeeds
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'payment_transactions')).toBeDefined();
    expect(calls.find((c) => c.table === 'payments' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'payment_attempts' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'orders')).toBeUndefined();
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'SURPLUS_PAYMENT',
      payment_event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });
  });

  it('a duplicate delivery of the SAME event is never classified as surplus (that is F-2a\'s job)', async () => {
    // The unique-violation-on-transaction-insert path represents a retry of
    // THIS SAME event (self-heal), never a distinct surplus — proven by the
    // fact that no SURPLUS_PAYMENT case is opened here despite the payment
    // already being SUCCESS by the time of the conflict.
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: null, error: null }, // payments -> SUCCESS (self-heal)
      { data: null, error: null }, // payment_attempts -> SUCCESS (self-heal)
      { data: { id: ORDER_ID }, error: null }, // orders -> PAID (self-heal)
      { data: null, error: null }, // order_status_history insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService.processOne — duplicate transaction / self-heal', () => {
  it('a provider_transaction_id conflict is handled safely, completing any remaining side effects without duplicating money', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const txInserts = calls.filter((c) => c.table === 'payment_transactions' && c.op === 'insert');
    expect(txInserts).toHaveLength(1); // the one attempt, which conflicted — never retried as a second insert
  });

  it('self-heal that is already fully complete (payment SUCCESS, order PAID) is a safe no-op', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: null, error: null }, // payments update -> 0 rows (already SUCCESS), no error either way
      { data: null, error: null }, // payment_attempts update -> 0 rows (already SUCCESS)
      { data: null, error: null }, // orders guarded update -> 0 rows (already PAID)
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // current-state read confirms it
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
    expect(calls.find((c) => c.table === 'order_status_history')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService.processOne — unexpected failure / retry safety', () => {
  it('an unexpected database error releases the claim and records processing_error, never marking it processed', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim succeeds
      { data: null, error: { message: 'connection reset' } }, // payments lookup fails unexpectedly
      { data: null, error: null }, // release update
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('skipped');
    const releaseCall = calls[calls.length - 1];
    expect(releaseCall?.table).toBe('payment_events');
    expect(releaseCall?.payload).toMatchObject({ processed_at: null });
    expect(releaseCall?.payload?.processing_error).toContain('connection reset');
  });

  it('a failure while releasing the claim is logged but does not throw out of processOne', async () => {
    const { supabase } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: null, error: { message: 'connection reset' } },
      { data: null, error: { message: 'also failed' } }, // release itself fails
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await expect(service.processOne(EVENT_ID)).resolves.toBe('skipped');
  });
});

describe('PaymentEventProcessingService.processPendingEvents', () => {
  it('processes each pending event id in order and aggregates processed/skipped counts', async () => {
    const { supabase } = supabaseStub([{ data: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }], error: null }]);
    const service = new PaymentEventProcessingService(supabase);
    const spy = jest
      .spyOn(service, 'processOne')
      .mockResolvedValueOnce('processed')
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('processed');

    const result = await service.processPendingEvents();

    expect(result).toEqual({ processed: 2, skipped: 1 });
    expect(spy).toHaveBeenNthCalledWith(1, 'e1');
    expect(spy).toHaveBeenNthCalledWith(2, 'e2');
    expect(spy).toHaveBeenNthCalledWith(3, 'e3');
  });

  it('returns zero counts (never throws) when listing pending events fails', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);
    const service = new PaymentEventProcessingService(supabase);

    await expect(service.processPendingEvents()).resolves.toEqual({ processed: 0, skipped: 0 });
  });

  it('returns zero counts when there is nothing pending, without calling processOne', async () => {
    const { supabase } = supabaseStub([{ data: [], error: null }]);
    const service = new PaymentEventProcessingService(supabase);
    const spy = jest.spyOn(service, 'processOne');

    const result = await service.processPendingEvents();

    expect(result).toEqual({ processed: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
