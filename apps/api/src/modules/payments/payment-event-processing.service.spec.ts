import { BATCH_SIZE, PaymentEventProcessingService } from './payment-event-processing.service';
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

/**
 * DEC-043 commission-ledger fixtures. `SUBTOTAL_SATANG` is the order's food
 * subtotal (deliberately different from `AMOUNT`, the payment's grand total,
 * to prove the commission is derived from the former, never the latter):
 * ฿120 (12000 satang) × 8% = ฿9.60 → rounds to ฿10 (1000 satang).
 */
const RESTAURANT_ID = 'restaurant-1';
const MERCHANT_ID = 'merchant-1';
const SUBTOTAL_SATANG = 12000;
const COMMISSION_SATANG = 1000;
const LEDGER_GROUP_ID = 'ledger-group-1';

const COMMISSION_ORDER_ROW = { id: ORDER_ID, restaurant_id: RESTAURANT_ID, subtotal_satang: SUBTOTAL_SATANG };
const COMMISSION_RESTAURANT_ROW = { merchant_id: MERCHANT_ID };

/**
 * The four stub results `postCommissionLedger` consumes on a fresh post:
 * orders select, restaurants select, `ledger_entry_groups` insert (succeeds),
 * `ledger_entries` insert. Spread into a test's result queue at the point
 * `completeSuccessSideEffects` reaches the ledger step.
 */
function freshCommissionLedgerStubs(): Result[] {
  return [
    { data: COMMISSION_ORDER_ROW, error: null },
    { data: COMMISSION_RESTAURANT_ROW, error: null },
    { data: { id: LEDGER_GROUP_ID }, error: null },
    { data: null, error: null },
  ];
}

/**
 * The five stub results `postCommissionLedger` consumes when the group was
 * already posted by an earlier run: orders select, restaurants select,
 * `ledger_entry_groups` insert (conflicts — group already exists), the
 * self-heal re-select of that group, and the entries-existence check (finds
 * the entries already there, so `ledger_entries` is never inserted again).
 */
function alreadyPostedCommissionLedgerStubs(): Result[] {
  return [
    { data: COMMISSION_ORDER_ROW, error: null },
    { data: COMMISSION_RESTAURANT_ROW, error: null },
    { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    { data: { id: LEDGER_GROUP_ID }, error: null },
    { data: [{ id: 'entry-1' }, { id: 'entry-2' }], error: null },
  ];
}

/**
 * `docs/SETTLEMENT_MODEL.md` § 3.1 CUSTOMER_PAYMENT fixtures. Same
 * `CUSTOMER_ID` the H-3 outbox test already asserts as the recipient — the
 * order's own customer, read fresh by `postCustomerPaymentLedger` rather
 * than threaded through from a caller.
 */
const CUSTOMER_ID = 'customer-1';
const CUSTOMER_PAYMENT_ORDER_ROW = { id: ORDER_ID, customer_id: CUSTOMER_ID };
const CUSTOMER_PAYMENT_LEDGER_GROUP_ID = 'ledger-group-2';

/**
 * The three stub results `postCustomerPaymentLedger` consumes on a fresh
 * post: orders select (for `customer_id`), `ledger_entry_groups` insert
 * (succeeds), `ledger_entries` insert. Mirrors `freshCommissionLedgerStubs`
 * one entry shorter — no restaurant lookup, since the party is the customer,
 * not the merchant.
 */
function freshCustomerPaymentLedgerStubs(): Result[] {
  return [
    { data: CUSTOMER_PAYMENT_ORDER_ROW, error: null },
    { data: { id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID }, error: null },
    { data: null, error: null },
  ];
}

/**
 * The four stub results `postCustomerPaymentLedger` consumes when the group
 * was already posted by an earlier run: orders select, `ledger_entry_groups`
 * insert (conflicts), the self-heal re-select of that group, and the
 * entries-existence check (finds the entry already there).
 */
function alreadyPostedCustomerPaymentLedgerStubs(): Result[] {
  return [
    { data: CUSTOMER_PAYMENT_ORDER_ROW, error: null },
    { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    { data: { id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID }, error: null },
    { data: [{ id: 'cp-entry-1' }], error: null },
  ];
}

/**
 * DEC-047 SERVICE_FEE_REVENUE fixtures. `SERVICE_FEE_SATANG` is
 * deliberately distinct from `AMOUNT` (the grand total) and
 * `SUBTOTAL_SATANG` (the commission base), so a posting that accidentally
 * derived from either could not silently match the right answer — the
 * implementation must read `orders.service_fee_satang`.
 */
const SERVICE_FEE_SATANG = 500;
const SERVICE_FEE_ORDER_ROW = { id: ORDER_ID, service_fee_satang: SERVICE_FEE_SATANG };
const SERVICE_FEE_LEDGER_GROUP_ID = 'ledger-group-3';

/**
 * The three stub results `postServiceFeeLedger` consumes on a fresh post:
 * orders select (for `service_fee_satang`), `ledger_entry_groups` insert
 * (succeeds), `ledger_entries` insert. Mirrors `freshCustomerPaymentLedgerStubs`.
 */
function freshServiceFeeLedgerStubs(): Result[] {
  return [
    { data: SERVICE_FEE_ORDER_ROW, error: null },
    { data: { id: SERVICE_FEE_LEDGER_GROUP_ID }, error: null },
    { data: null, error: null },
  ];
}

/**
 * The four stub results `postServiceFeeLedger` consumes when the group was
 * already posted by an earlier run: orders select, `ledger_entry_groups`
 * insert (conflicts), the self-heal re-select of that group, and the
 * entries-existence check (finds the entry already there).
 */
function alreadyPostedServiceFeeLedgerStubs(): Result[] {
  return [
    { data: SERVICE_FEE_ORDER_ROW, error: null },
    { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
    { data: { id: SERVICE_FEE_LEDGER_GROUP_ID }, error: null },
    { data: [{ id: 'sf-entry-1' }], error: null },
  ];
}

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
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
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

    const groupInsert = calls.find((c) => c.table === 'ledger_entry_groups' && c.op === 'insert');
    expect(groupInsert?.payload).toMatchObject({
      group_key: `commission:${PAYMENT_ID}:${PROVIDER_EVENT_ID}`,
      order_id: ORDER_ID,
      kind: 'MERCHANT_COMMISSION',
    });

    const entriesInsert = calls.find((c) => c.table === 'ledger_entries' && c.op === 'insert');
    const entries = entriesInsert?.payload as unknown as Array<Record<string, unknown>>;
    expect(entries).toEqual([
      {
        group_id: LEDGER_GROUP_ID,
        account: 'MERCHANT_PAYABLE',
        party_type: 'MERCHANT',
        party_id: MERCHANT_ID,
        amount_satang: -COMMISSION_SATANG,
      },
      {
        group_id: LEDGER_GROUP_ID,
        account: 'PLATFORM_REVENUE',
        party_type: 'PLATFORM',
        party_id: null,
        amount_satang: COMMISSION_SATANG,
      },
    ]);
    expect(entries.reduce((sum, entry) => sum + (entry.amount_satang as number), 0)).toBe(0);

    // CUSTOMER_PAYMENT (SETTLEMENT_MODEL.md § 3.1) — its own group, posted
    // alongside commission, never inside it.
    const groupInserts = calls.filter((c) => c.table === 'ledger_entry_groups' && c.op === 'insert');
    const customerPaymentGroupInsert = groupInserts.find(
      (c) => c.payload?.kind === 'CUSTOMER_PAYMENT',
    );
    expect(customerPaymentGroupInsert?.payload).toMatchObject({
      group_key: `payment:${PAYMENT_ID}:${PROVIDER_EVENT_ID}`,
      order_id: ORDER_ID,
      kind: 'CUSTOMER_PAYMENT',
    });

    const entriesInserts = calls.filter((c) => c.table === 'ledger_entries' && c.op === 'insert');
    const customerPaymentEntriesInsert = entriesInserts.find((c) => {
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    expect(customerPaymentEntriesInsert?.payload).toEqual([
      {
        group_id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID,
        account: 'CUSTOMER_PAYMENT',
        party_type: 'CUSTOMER',
        party_id: CUSTOMER_ID,
        amount_satang: AMOUNT,
      },
    ]);
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
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
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

describe('PaymentEventProcessingService.processOne — unsupported event type (terminal, never retried)', () => {
  /**
   * The starvation fix's core behaviour change. Previously this exact
   * scenario asserted `result === 'skipped'` and a `processed_at: null`
   * release — i.e. "retry forever". That was the bug: `processPendingEvents`
   * always re-selects the same oldest `BATCH_SIZE` unprocessed rows, so a
   * released unsupported event at the head of the queue was reclaimed and
   * re-released every tick, starving every genuinely processable event
   * behind it. The correct behaviour is terminal: claimed once, marked with
   * an explanatory `processing_error`, and never returned to the pending set
   * again — proven below by asserting `processed_at` is never written back
   * to `null`.
   */
  it('an event type with no handler is marked processed with an explanatory processing_error, and the claim is never released', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.refunded', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: null, error: null }, // processing_error write (markUnsupportedEventType)
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    // Terminal, same as every other definitively-classified outcome in this
    // service (payment.failed, AMOUNT_MISMATCH, UNMATCHED_EVENT all also
    // return 'processed' without moving money) — never 'skipped', which
    // means "retry me".
    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'payments' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'payment_transactions')).toBeUndefined();
    expect(calls.find((c) => c.table === 'orders' && c.op === 'update')).toBeUndefined();
    // No reconciliation_cases row: UNMATCHED_EVENT means something different
    // ("no payment could be resolved"), and there is no `kind` for
    // "unsupported event type" without a migration this fix does not make.
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();

    const errorWrite = calls[calls.length - 1];
    expect(errorWrite?.table).toBe('payment_events');
    expect(errorWrite?.op).toBe('update');
    // The claim's own UPDATE already set processed_at; this write must not
    // touch it — writing it back to null is exactly the starvation bug.
    expect(errorWrite?.payload).not.toHaveProperty('processed_at');
    expect(errorWrite?.payload?.processing_error).toContain('Unsupported');
    expect(errorWrite?.payload?.processing_error).toContain('payment.refunded');
  });

  it.each(['payment.canceled', 'payment.expired', 'charge.refunded', 'some.future.event'])(
    '%s is treated the same way — terminal, not retried, not thrown',
    async (eventType) => {
      const { supabase, calls } = supabaseStub([
        { data: claimedEvent({ event_type: eventType, raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
        { data: paymentRow(), error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      const service = new PaymentEventProcessingService(supabase);

      const result = await service.processOne(EVENT_ID);

      expect(result).toBe('processed');
      // The claim's own UPDATE legitimately sets `processed_at` to a
      // timestamp — that write is expected and correct. What must never
      // happen is a SECOND write setting it back to `null` (a release).
      const release = calls.find(
        (c) => c.table === 'payment_events' && c.op === 'update' && c.payload?.processed_at === null,
      );
      expect(release).toBeUndefined();
    },
  );

  it('a write failure on the processing_error note is logged and swallowed, never thrown — throwing here would reintroduce starvation', async () => {
    const { supabase } = supabaseStub([
      { data: claimedEvent({ event_type: 'payment.refunded', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: null, error: { message: 'connection reset' } }, // processing_error write itself fails
    ]);
    const service = new PaymentEventProcessingService(supabase);

    // Must not throw and must still report 'processed' — the event was
    // already, correctly, terminally claimed; only the diagnostic note
    // failed to persist, which is best-effort and must not resurrect the
    // starvation this fix removes.
    await expect(service.processOne(EVENT_ID)).resolves.toBe('processed');
  });
});

/**
 * The starvation regression itself (Test C). `processPendingEvents` selects
 * the oldest `BATCH_SIZE` unprocessed rows every call — a real Postgres
 * `ORDER BY received_at ASC LIMIT BATCH_SIZE` re-evaluated fresh each tick.
 * Two calls to `processPendingEvents`, each against its own stub, model two
 * such ticks honestly:
 *
 *   tick 1 — the oldest BATCH_SIZE rows are ALL unsupported events (the
 *            exact starvation precondition: they fill the entire window)
 *   tick 2 — with those BATCH_SIZE rows now `processed_at IS NOT NULL`
 *            (proven by tick 1's own assertions below), the next-oldest
 *            unprocessed row a real query would return is the genuine
 *            `payment.succeeded` event
 *
 * Before the fix this never happened: tick 1's release-on-throw behaviour
 * left every one of those rows `processed_at IS NULL` again, so tick 2's
 * query would return the exact same BATCH_SIZE unsupported rows forever,
 * and the succeeded event — always newer, always outside the window — would
 * never be selected by any tick.
 */
describe('PaymentEventProcessingService — starvation regression (BATCH_SIZE unsupported events ahead of a valid one)', () => {
  it('BATCH_SIZE unsupported events do not remain pending, so the next tick reaches and fully completes a payment.succeeded event behind them', async () => {
    // Tick 1: the oldest BATCH_SIZE (25) rows are all unsupported.
    const unsupportedIds = Array.from({ length: BATCH_SIZE }, (_, i) => `unsupported-${i}`);
    const tick1Results: Result[] = [
      { data: unsupportedIds.map((id) => ({ id })), error: null }, // processPendingEvents' own SELECT
    ];
    for (let i = 0; i < unsupportedIds.length; i++) {
      tick1Results.push(
        { data: claimedEvent({ event_type: 'payment.refunded', raw_payload: { providerPaymentId: PROVIDER_PAYMENT_ID } }), error: null }, // claim
        { data: paymentRow(), error: null }, // payments select
        { data: null, error: null }, // payment_events.payment_id backfill
        { data: null, error: null }, // processing_error write
      );
    }
    const tick1 = supabaseStub(tick1Results);
    const service1 = new PaymentEventProcessingService(tick1.supabase);

    const tick1Summary = await service1.processPendingEvents();

    // All BATCH_SIZE handled as terminal — none skipped for retry. Proves
    // the previously-starving batch no longer perpetuates itself.
    expect(tick1Summary).toEqual({ processed: BATCH_SIZE, skipped: 0 });
    const anyReleasedBackToPending = tick1.calls.some(
      (c) => c.table === 'payment_events' && c.op === 'update' && c.payload?.processed_at === null,
    );
    expect(anyReleasedBackToPending).toBe(false);

    // Tick 2: with the 25 unsupported rows no longer `processed_at IS NULL`,
    // the next tick's query returns the genuinely valid event — which must
    // now run the FULL success path to completion (end state, not merely
    // "did not throw"), exactly matching the existing full-success-path test.
    const tick2 = supabaseStub([
      { data: [{ id: EVENT_ID }], error: null }, // processPendingEvents' own SELECT
      { data: claimedEvent(), error: null }, // claim
      { data: paymentRow(), error: null }, // payments select
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: ATTEMPT_ROW, error: null }, // payment_attempts select
      { data: { id: 'txn-1' }, error: null }, // payment_transactions insert
      { data: null, error: null }, // payments -> SUCCESS
      { data: null, error: null }, // payment_attempts -> SUCCESS
      { data: { id: ORDER_ID }, error: null }, // orders -> PAID
      { data: null, error: null }, // order_status_history insert
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service2 = new PaymentEventProcessingService(tick2.supabase);

    const tick2Summary = await service2.processPendingEvents();

    expect(tick2Summary).toEqual({ processed: 1, skipped: 0 });

    // End-to-end result, not merely "did not throw": payment SUCCESS, order
    // PAID, the money movement recorded, and the ledger posted.
    const txInsert = tick2.calls.find((c) => c.table === 'payment_transactions');
    expect(txInsert?.payload).toMatchObject({
      payment_id: PAYMENT_ID,
      amount_satang: AMOUNT,
      direction: 'IN',
    });

    const paymentUpdate = tick2.calls.find(
      (c) => c.table === 'payments' && c.op === 'update' && c.payload?.state === 'SUCCESS',
    );
    expect(paymentUpdate?.eq).toMatchObject({ id: PAYMENT_ID });

    const orderUpdate = tick2.calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ state: 'PAID' });
    expect(orderUpdate?.eq).toMatchObject({ id: ORDER_ID, state: 'PENDING_PAYMENT' });

    const commissionGroup = tick2.calls.find(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'MERCHANT_COMMISSION',
    );
    expect(commissionGroup).toBeDefined();
    const customerPaymentGroup = tick2.calls.find(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'CUSTOMER_PAYMENT',
    );
    expect(customerPaymentGroup).toBeDefined();
    const serviceFeeGroup = tick2.calls.find(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'SERVICE_FEE_REVENUE',
    );
    expect(serviceFeeGroup).toBeDefined();
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

  it('an order already correctly PAID (self-heal, no genuine late payment) opens no case at all, and recreates the missing history row (crash-window self-heal)', async () => {
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
      { data: null, error: null }, // order_status_history existence check: missing (the crash window)
      { data: null, error: null }, // order_status_history insert (recreated)
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();

    const historyInserts = calls.filter((c) => c.table === 'order_status_history' && c.op === 'insert');
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.payload).toMatchObject({
      order_id: ORDER_ID,
      from_state: 'PENDING_PAYMENT',
      to_state: 'PAID',
      actor_type: 'WEBHOOK',
    });

    // Commission ledger still posts on this self-heal path — the order is
    // genuinely, correctly PAID, so commission is owed exactly as if the
    // guarded UPDATE itself had won.
    expect(calls.find((c) => c.table === 'ledger_entry_groups' && c.op === 'insert')).toBeDefined();
    expect(calls.find((c) => c.table === 'ledger_entries' && c.op === 'insert')).toBeDefined();
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
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
  });
});

/**
 * Hardening: the SURPLUS_PAYMENT self-heal loss (the case-insert throws
 * after a genuinely fresh, distinct transaction was already recorded, then
 * the retry lands on the unique-violation path — which previously always
 * fell through to `completeSuccessSideEffects` without re-deriving that
 * this event was surplus, silently losing the reconciliation signal).
 */
describe('PaymentEventProcessingService.processOne — SURPLUS_PAYMENT self-heal recovery', () => {
  it('1. a retry through the unique-violation path recreates SURPLUS_PAYMENT when the earliest recorded transaction belongs to a DIFFERENT event', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // provider_event_id = PROVIDER_EVENT_ID
      { data: paymentRow({ state: 'SUCCESS' }), error: null }, // already SUCCESS — from a different, earlier event
      { data: null, error: null }, // payment_id backfill
      { data: ATTEMPT_ROW, error: null },
      // this event's own transaction already exists (recorded on a prior attempt, before the case-insert threw)
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      // the EARLIEST transaction for this payment belongs to a different provider_event_id — proof of genuine surplus
      { data: { provider_transaction_id: 'NULL-EVT-0' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert — recreated
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const caseInsert = calls.find((c) => c.table === 'reconciliation_cases');
    expect(caseInsert?.payload).toEqual({
      kind: 'SURPLUS_PAYMENT',
      payment_event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });
    // Never runs the money-moving side effects for a surplus — no attempt/order write.
    expect(calls.find((c) => c.table === 'payments' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'payment_attempts' && c.op === 'update')).toBeUndefined();
    expect(calls.find((c) => c.table === 'orders')).toBeUndefined();
    // Exactly one attempted transaction insert — never retried as a second insert.
    const txInserts = calls.filter((c) => c.table === 'payment_transactions' && c.op === 'insert');
    expect(txInserts).toHaveLength(1);
  });

  it('2. a successfully-opened SURPLUS_PAYMENT case is never duplicated — the payment_events claim guard alone prevents reprocessing', async () => {
    const { supabase, calls } = supabaseStub([
      // first call: claims and successfully recreates SURPLUS_PAYMENT
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: { provider_transaction_id: 'NULL-EVT-0' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert succeeds
      // second call (a duplicate delivery / a second tick re-listing the same id): claim finds it already processed
      { data: null, error: null },
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const first = await service.processOne(EVENT_ID);
    const second = await service.processOne(EVENT_ID);

    expect(first).toBe('processed');
    expect(second).toBe('skipped');
    const caseInserts = calls.filter((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(caseInserts).toHaveLength(1);
  });

  it('does not misclassify a legitimate self-heal as surplus: when the earliest recorded transaction IS this event\'s own, side effects still finish', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // provider_event_id = PROVIDER_EVENT_ID
      { data: paymentRow({ state: 'SUCCESS' }), error: null }, // SUCCESS — but from THIS event's own earlier partial run
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      // the EARLIEST transaction for this payment IS this event's own — not a surplus
      { data: { provider_transaction_id: PROVIDER_EVENT_ID }, error: null },
      { data: null, error: null }, // payments update -> 0 rows (already SUCCESS from the partial run)
      { data: null, error: null }, // payment_attempts update -> 0 rows (already SUCCESS)
      { data: { id: ORDER_ID }, error: null }, // orders -> PAID — finishing the incomplete step
      { data: null, error: null }, // order_status_history insert
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
    const orderUpdate = calls.find((c) => c.table === 'orders' && c.op === 'update');
    expect(orderUpdate?.payload).toMatchObject({ state: 'PAID' });
    const historyInsert = calls.find((c) => c.table === 'order_status_history');
    expect(historyInsert).toBeDefined();
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
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const txInserts = calls.filter((c) => c.table === 'payment_transactions' && c.op === 'insert');
    expect(txInserts).toHaveLength(1); // the one attempt, which conflicted — never retried as a second insert
  });

  it('self-heal that is already fully complete (payment SUCCESS, order PAID, history already recorded) is a safe no-op', async () => {
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
      { data: { id: 'history-1' }, error: null }, // order_status_history existence check: already recorded
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    expect(calls.find((c) => c.table === 'reconciliation_cases')).toBeUndefined();
    expect(calls.find((c) => c.table === 'order_status_history' && c.op === 'insert')).toBeUndefined();
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

describe('PaymentEventProcessingService — H-3 PaymentSucceeded outbox event', () => {
  it('writes CUSTOMER + MERCHANT recipients with the correct aggregate and event_type, only on the guarded-UPDATE winner', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim
      { data: paymentRow(), error: null }, // payments select
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: ATTEMPT_ROW, error: null }, // payment_attempts select
      { data: { id: 'txn-1' }, error: null }, // payment_transactions insert
      { data: null, error: null }, // payments -> SUCCESS
      { data: null, error: null }, // payment_attempts -> SUCCESS
      { data: { id: ORDER_ID, customer_id: 'customer-1', restaurant_id: 'restaurant-1' }, error: null }, // orders -> PAID
      { data: null, error: null }, // order_status_history insert
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
      { data: { merchant_id: 'merchant-1' }, error: null }, // restaurants (merchant owner)
      { data: { owner_user_id: 'merchant-owner-1' }, error: null }, // merchants (owner)
      { data: null, error: null }, // outbox insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const outboxInsert = calls.find((c) => c.table === 'outbox');
    expect(outboxInsert?.payload).toMatchObject({
      aggregate_type: 'order',
      aggregate_id: ORDER_ID,
      event_type: 'PaymentSucceeded',
    });
    const recipients = (outboxInsert?.payload as { payload: { recipients: unknown[] } }).payload.recipients;
    expect(recipients).toEqual([
      { recipientId: 'customer-1', recipientType: 'CUSTOMER' },
      { recipientId: 'merchant-owner-1', recipientType: 'MERCHANT' },
    ]);
  });

  it('a self-heal retry (order already correctly PAID from an earlier run) writes no second outbox event', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // claim
      { data: paymentRow({ state: 'SUCCESS' }), error: null }, // payments select — already SUCCESS
      { data: null, error: null }, // payment_events.payment_id backfill
      { data: ATTEMPT_ROW, error: null }, // payment_attempts select
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, // payment_transactions insert — already recorded
      { data: { provider_transaction_id: PROVIDER_EVENT_ID }, error: null }, // earliest transaction read — same event, self-heal branch
      { data: null, error: null }, // payments -> SUCCESS (no-op, already SUCCESS)
      { data: null, error: null }, // payment_attempts -> SUCCESS (no-op)
      { data: null, error: null }, // orders -> PAID guarded UPDATE: 0 rows, already PAID
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // currentOrder read
      { data: { id: 'history-1' }, error: null }, // order_status_history existence check — already present
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    // The guarded `orders` UPDATE never matched (already PAID), so
    // `completeSuccessSideEffects`'s success branch — the only place the
    // PaymentSucceeded outbox write happens — never ran.
    expect(calls.find((c) => c.table === 'outbox')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService — commission ledger (DEC-043)', () => {
  it('derives commission from the order food subtotal, never from the payment amount (grand total)', async () => {
    // AMOUNT (payment.amount_satang, the grand total) is 7500. SUBTOTAL_SATANG
    // (the order's food subtotal, what DEC-043's base actually is) is 12000 —
    // deliberately different and even larger, so a commission computed from
    // the wrong base could not accidentally match the right answer.
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const orderSelect = calls.find((c) => c.table === 'orders' && c.op === 'select');
    expect(orderSelect?.eq).toMatchObject({ id: ORDER_ID });

    const entriesInsert = calls.find((c) => c.table === 'ledger_entries' && c.op === 'insert');
    const entries = entriesInsert?.payload as unknown as Array<Record<string, unknown>>;
    const merchantEntry = entries.find((e) => e.account === 'MERCHANT_PAYABLE');
    const platformEntry = entries.find((e) => e.account === 'PLATFORM_REVENUE');

    // 12000 (subtotal) × 8% = 960 → rounds to 1000 (COMMISSION_SATANG) —
    // not 7500 × 8% = 600, which is what a wrong-base bug would produce.
    expect(merchantEntry?.amount_satang).toBe(-COMMISSION_SATANG);
    expect(platformEntry?.amount_satang).toBe(COMMISSION_SATANG);
    expect(Math.abs(merchantEntry?.amount_satang as number)).not.toBe(Math.round(AMOUNT * 0.08));
  });

  it('never runs for a SURPLUS_PAYMENT — a payment that never settles this order commits no commission', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: { id: ATTEMPT_ID, state: 'SUCCESS' }, error: null },
      { data: { id: 'txn-2' }, error: null }, // fresh, distinct transaction — genuine surplus
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('never runs for a LATE_PAYMENT — an order that moved on (e.g. CANCELLED) commits no commission', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows — not PENDING_PAYMENT anymore
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null }, // orders current-state read
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('idempotent: a genuine duplicate delivery of an already-fully-settled event posts no second ledger_entries row', async () => {
    // Same shape as "does not misclassify a legitimate self-heal as surplus"
    // but this time the order was ALREADY correctly PAID before this retry
    // (not "finishing an incomplete step") and the commission ledger group
    // was ALREADY fully posted by that earlier, successful run.
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null }, // a genuinely new payment_events row for the same real-world delivery
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null }, // payment_id backfill
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, // payment_transactions: already recorded
      { data: { provider_transaction_id: PROVIDER_EVENT_ID }, error: null }, // earliest transaction is this event's own — self-heal, not surplus
      { data: null, error: null }, // payments update -> 0 rows (already SUCCESS)
      { data: null, error: null }, // payment_attempts update -> 0 rows
      { data: null, error: null }, // orders guarded update -> 0 rows (already PAID)
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // currentOrder read
      { data: { id: 'history-1' }, error: null }, // order_status_history existence check — already recorded
      ...alreadyPostedCommissionLedgerStubs(),
      ...alreadyPostedCustomerPaymentLedgerStubs(),
      ...alreadyPostedServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');

    const groupInserts = calls.filter((c) => c.table === 'ledger_entry_groups' && c.op === 'insert');
    // Three independent groups (commission, customer payment, service fee),
    // each attempted once and each conflicting — neither retried as a
    // second insert.
    expect(groupInserts).toHaveLength(3);
    expect(groupInserts.filter((c) => c.payload?.kind === 'MERCHANT_COMMISSION')).toHaveLength(1);
    expect(groupInserts.filter((c) => c.payload?.kind === 'CUSTOMER_PAYMENT')).toHaveLength(1);
    expect(groupInserts.filter((c) => c.payload?.kind === 'SERVICE_FEE_REVENUE')).toHaveLength(1);

    // The decisive assertion: no second ledger_entries insert happened for
    // either group, so exactly one economic ledger group of each kind exists
    // with exactly its own entries — no duplicate commission, no duplicate
    // merchant payable, no duplicate platform revenue, no duplicate customer
    // payment.
    expect(calls.find((c) => c.table === 'ledger_entries' && c.op === 'insert')).toBeUndefined();
  });
});

describe('PaymentEventProcessingService — CUSTOMER_PAYMENT ledger (SETTLEMENT_MODEL.md § 3.1)', () => {
  it('posts +payment.amount_satang to the customer, in its own group, independent of the commission group', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    // postCommissionLedger and postCustomerPaymentLedger each do their own
    // independent `orders` read (neither depends on the other's), matching
    // this file's existing self-contained-read convention.
    const orderSelects = calls.filter((c) => c.table === 'orders' && c.op === 'select');
    expect(orderSelects.length).toBeGreaterThanOrEqual(2);

    const groupInsert = calls.find(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'CUSTOMER_PAYMENT',
    );
    expect(groupInsert?.payload).toEqual({
      group_key: `payment:${PAYMENT_ID}:${PROVIDER_EVENT_ID}`,
      order_id: ORDER_ID,
      kind: 'CUSTOMER_PAYMENT',
    });

    const entriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    expect(entriesInsert?.payload).toEqual([
      {
        group_id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID,
        account: 'CUSTOMER_PAYMENT',
        party_type: 'CUSTOMER',
        party_id: CUSTOMER_ID,
        // Positive — money entering, not an obligation. Exactly
        // payment.amount_satang (AMOUNT), never a recalculated total, never
        // the commission or rider-earning amount.
        amount_satang: AMOUNT,
      },
    ]);

    // Never inside the commission group's own entries.
    const commissionEntriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'MERCHANT_PAYABLE' || entry.account === 'PLATFORM_REVENUE');
    });
    const commissionAccounts = (commissionEntriesInsert?.payload as unknown as Array<Record<string, unknown>>).map(
      (e) => e.account,
    );
    expect(commissionAccounts).not.toContain('CUSTOMER_PAYMENT');
  });

  it('never runs for a SURPLUS_PAYMENT — a payment that never settles this order funds nothing', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: { id: ATTEMPT_ID, state: 'SUCCESS' }, error: null },
      { data: { id: 'txn-2' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('never runs for a LATE_PAYMENT — an order that moved on (e.g. CANCELLED) funds nothing', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('already-PAID self-heal recreates a missing CUSTOMER_PAYMENT entry when the group exists but the entry does not (crash window)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // already correctly PAID
      { data: { id: 'history-1' }, error: null }, // history already recorded
      ...alreadyPostedCommissionLedgerStubs(),
      { data: CUSTOMER_PAYMENT_ORDER_ROW, error: null }, // orders select for customer_id
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, // group insert conflicts — exists from the crashed run
      { data: { id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID }, error: null }, // self-heal re-select
      { data: [], error: null }, // entries existence check: MISSING — the crash window
      { data: null, error: null }, // entry insert (recreated)
      ...alreadyPostedServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const entriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    expect(entriesInsert?.payload).toEqual([
      {
        group_id: CUSTOMER_PAYMENT_LEDGER_GROUP_ID,
        account: 'CUSTOMER_PAYMENT',
        party_type: 'CUSTOMER',
        party_id: CUSTOMER_ID,
        amount_satang: AMOUNT,
      },
    ]);
  });

  it('idempotent: a genuine duplicate delivery of an already-fully-settled event posts no second CUSTOMER_PAYMENT entry (concurrency converges to exactly one)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: { provider_transaction_id: PROVIDER_EVENT_ID }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID, state: 'PAID' }, error: null },
      { data: { id: 'history-1' }, error: null },
      ...alreadyPostedCommissionLedgerStubs(),
      ...alreadyPostedCustomerPaymentLedgerStubs(),
      ...alreadyPostedServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');

    const customerPaymentGroupInserts = calls.filter(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'CUSTOMER_PAYMENT',
    );
    expect(customerPaymentGroupInserts).toHaveLength(1); // attempted once — conflicted, never retried

    const customerPaymentEntriesInserts = calls.filter((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    expect(customerPaymentEntriesInserts).toHaveLength(0); // entry already existed — never re-inserted
  });

  it('does not recalculate the order total — uses payment.amount_satang even when it differs from the order subtotal', async () => {
    // AMOUNT (payment.amount_satang, 7500) is deliberately different from
    // SUBTOTAL_SATANG (12000, the food subtotal DEC-043's commission uses) —
    // proving CUSTOMER_PAYMENT is never derived from subtotal, delivery fee,
    // service fee or discount, only from the payment's own recorded amount.
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const entriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    const entry = (entriesInsert?.payload as unknown as Array<Record<string, unknown>>)[0]!;
    expect(entry.amount_satang).toBe(AMOUNT);
    expect(entry.amount_satang).not.toBe(SUBTOTAL_SATANG);
    expect(entry.amount_satang).not.toBe(COMMISSION_SATANG);
  });
});

describe('PaymentEventProcessingService — SERVICE_FEE_REVENUE ledger (DEC-047)', () => {
  it('posts +orders.service_fee_satang to PLATFORM_REVENUE, in its own group, independent of commission and CUSTOMER_PAYMENT', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const groupInsert = calls.find(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'SERVICE_FEE_REVENUE',
    );
    expect(groupInsert?.payload).toEqual({
      group_key: `servicefee:${PAYMENT_ID}:${PROVIDER_EVENT_ID}`,
      order_id: ORDER_ID,
      kind: 'SERVICE_FEE_REVENUE',
    });

    const entriesInserts = calls.filter((c) => c.table === 'ledger_entries' && c.op === 'insert');
    const allEntries = entriesInserts.flatMap((c) => c.payload as unknown as Array<Record<string, unknown>>);
    const serviceFeeEntry = allEntries.find((e) => e.group_id === SERVICE_FEE_LEDGER_GROUP_ID);
    expect(serviceFeeEntry).toEqual({
      group_id: SERVICE_FEE_LEDGER_GROUP_ID,
      account: 'PLATFORM_REVENUE',
      party_type: 'PLATFORM',
      party_id: null,
      // Positive — money the platform earns, per DEC-047's sign convention.
      amount_satang: SERVICE_FEE_SATANG,
    });

    // Never inside the CUSTOMER_PAYMENT group's own entries.
    const customerPaymentEntriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'CUSTOMER_PAYMENT');
    });
    const customerPaymentAccounts = (
      customerPaymentEntriesInsert?.payload as unknown as Array<Record<string, unknown>>
    ).map((e) => e.account);
    expect(customerPaymentAccounts).not.toContain('PLATFORM_REVENUE');
  });

  it('reads the amount from orders.service_fee_satang, never hardcoded, never derived from grand_total_satang or the subtotal', async () => {
    // AMOUNT (payment.amount_satang, grand total) is 7500. SUBTOTAL_SATANG
    // (food subtotal, commission's base) is 12000. SERVICE_FEE_SATANG (the
    // order's own service-fee snapshot) is 500 — distinct from both, so a
    // posting derived from either the grand total or the subtotal could not
    // accidentally match.
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const serviceFeeOrderSelect = calls.find(
      (c) => c.table === 'orders' && c.op === 'select' && c.eq.id === ORDER_ID,
    );
    expect(serviceFeeOrderSelect).toBeDefined();

    const entriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.group_id === SERVICE_FEE_LEDGER_GROUP_ID);
    });
    const entry = (entriesInsert?.payload as unknown as Array<Record<string, unknown>>)[0]!;
    expect(entry.amount_satang).toBe(SERVICE_FEE_SATANG);
    expect(entry.amount_satang).not.toBe(AMOUNT);
    expect(entry.amount_satang).not.toBe(SUBTOTAL_SATANG);
    expect(entry.amount_satang).not.toBe(COMMISSION_SATANG);
  });

  it('never runs for a SURPLUS_PAYMENT — a payment that never settles this order earns no service-fee revenue', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: { id: ATTEMPT_ID, state: 'SUCCESS' }, error: null },
      { data: { id: 'txn-2' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('never runs for a LATE_PAYMENT — an order that moved on (e.g. CANCELLED) earns no service-fee revenue', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows
      { data: { id: ORDER_ID, state: 'CANCELLED' }, error: null },
      { data: null, error: null }, // reconciliation_cases insert
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    expect(calls.find((c) => c.table === 'ledger_entry_groups')).toBeUndefined();
    expect(calls.find((c) => c.table === 'ledger_entries')).toBeUndefined();
  });

  it('already-PAID self-heal recreates a missing SERVICE_FEE_REVENUE entry when the group exists but the entry does not (crash window)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null }, // orders guarded update: 0 rows
      { data: { id: ORDER_ID, state: 'PAID' }, error: null }, // already correctly PAID
      { data: { id: 'history-1' }, error: null }, // history already recorded
      ...alreadyPostedCommissionLedgerStubs(),
      ...alreadyPostedCustomerPaymentLedgerStubs(),
      { data: SERVICE_FEE_ORDER_ROW, error: null }, // orders select for service_fee_satang
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }, // group insert conflicts — exists from the crashed run
      { data: { id: SERVICE_FEE_LEDGER_GROUP_ID }, error: null }, // self-heal re-select
      { data: [], error: null }, // entries existence check: MISSING — the crash window
      { data: null, error: null }, // entry insert (recreated)
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');
    const entriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.group_id === SERVICE_FEE_LEDGER_GROUP_ID);
    });
    expect(entriesInsert?.payload).toEqual([
      {
        group_id: SERVICE_FEE_LEDGER_GROUP_ID,
        account: 'PLATFORM_REVENUE',
        party_type: 'PLATFORM',
        party_id: null,
        amount_satang: SERVICE_FEE_SATANG,
      },
    ]);
  });

  it('idempotent: a genuine duplicate delivery of an already-fully-settled event posts no second SERVICE_FEE_REVENUE entry (concurrency converges to exactly one)', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow({ state: 'SUCCESS' }), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      { data: { provider_transaction_id: PROVIDER_EVENT_ID }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID, state: 'PAID' }, error: null },
      { data: { id: 'history-1' }, error: null },
      ...alreadyPostedCommissionLedgerStubs(),
      ...alreadyPostedCustomerPaymentLedgerStubs(),
      ...alreadyPostedServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    const result = await service.processOne(EVENT_ID);

    expect(result).toBe('processed');

    const serviceFeeGroupInserts = calls.filter(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && c.payload?.kind === 'SERVICE_FEE_REVENUE',
    );
    expect(serviceFeeGroupInserts).toHaveLength(1); // attempted once — conflicted, never retried

    const serviceFeeEntriesInserts = calls.filter((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.group_id === SERVICE_FEE_LEDGER_GROUP_ID);
    });
    expect(serviceFeeEntriesInserts).toHaveLength(0); // entry already existed — never re-inserted
  });

  it('does not add to the merchant commission base — commission is unaffected by the service fee', async () => {
    const { supabase, calls } = supabaseStub([
      { data: claimedEvent(), error: null },
      { data: paymentRow(), error: null },
      { data: null, error: null },
      { data: ATTEMPT_ROW, error: null },
      { data: { id: 'txn-1' }, error: null },
      { data: null, error: null },
      { data: null, error: null },
      { data: { id: ORDER_ID }, error: null },
      { data: null, error: null },
      ...freshCommissionLedgerStubs(),
      ...freshCustomerPaymentLedgerStubs(),
      ...freshServiceFeeLedgerStubs(),
    ]);
    const service = new PaymentEventProcessingService(supabase);

    await service.processOne(EVENT_ID);

    const commissionEntriesInsert = calls.find((c) => {
      if (c.table !== 'ledger_entries' || c.op !== 'insert') return false;
      const payload = c.payload as unknown as Array<Record<string, unknown>>;
      return payload.some((entry) => entry.account === 'MERCHANT_PAYABLE' || entry.account === 'PLATFORM_REVENUE');
    });
    const commissionEntries = commissionEntriesInsert?.payload as unknown as Array<Record<string, unknown>>;
    const merchantEntry = commissionEntries.find((e) => e.account === 'MERCHANT_PAYABLE');
    const platformEntry = commissionEntries.find((e) => e.account === 'PLATFORM_REVENUE');

    // Unchanged from the commission-only fixtures: 8% of SUBTOTAL_SATANG
    // (12000), never inflated by SERVICE_FEE_SATANG (500).
    expect(merchantEntry?.amount_satang).toBe(-COMMISSION_SATANG);
    expect(platformEntry?.amount_satang).toBe(COMMISSION_SATANG);

    // No entry mixes the two groups: the commission group's own
    // ledger_entries insert never contains a group_id matching the
    // service-fee group.
    expect(commissionEntries.every((e) => e.group_id !== SERVICE_FEE_LEDGER_GROUP_ID)).toBe(true);
  });
});
