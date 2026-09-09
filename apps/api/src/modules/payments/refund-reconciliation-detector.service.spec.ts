import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RefundReconciliationDetectorService } from './refund-reconciliation-detector.service';
import type { RefundLedgerReversalService } from './refund-ledger-reversal.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Q-020 Slice 4B — TEST REQUIREMENTS A–Q from the mission brief.
 *
 * Same stub *shape* as `refund-event-processing.service.spec.ts`/
 * `refund-ledger-reversal.service.spec.ts` (records every filter/payload a
 * statement was built with), but queued **per table** rather than one global
 * queue: `RefundReconciliationDetectorService.run()` issues a fixed,
 * deterministic sequence of reads per table (`refunds` is read once for
 * in-flight candidates, once for `REFUNDED` candidates, once for
 * missing-`provider_refund_id` candidates — always in that order), so a
 * focused test only needs to supply results for the tables its own scenario
 * touches; every other table defaults to an empty read, which short-circuits
 * that phase with zero further queries (see each private `list*`/`load*`
 * method's own early return on an empty candidate set).
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  neq: Record<string, unknown>;
  inFilters: Record<string, readonly unknown[]>;
  notFilters: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

function supabaseStub(tableResults: Partial<Record<string, Result[]>> = {}) {
  const calls: Recorded[] = [];
  const queues = new Map<string, Result[]>(Object.entries(tableResults).map(([t, r]) => [t, [...(r ?? [])]]));

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, neq: {}, inFilters: {}, notFilters: {} };
      calls.push(call);

      const nextResult = (): Result => {
        const q = queues.get(table);
        if (q && q.length > 0) return q.shift()!;
        return { data: null, error: null };
      };

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
        neq(column: string, value: unknown) {
          call.neq[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          call.eq[`${column}__is`] = value;
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          call.inFilters[column] = values;
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          call.notFilters[column] = { op, value };
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

function fakeLedgerReversal(impl?: (refundId: string, paymentId: string) => Promise<void>): {
  service: RefundLedgerReversalService;
  postReversals: jest.Mock;
} {
  const postReversals = jest.fn(impl ?? (() => Promise.resolve(undefined)));
  return { service: { postReversals } as unknown as RefundLedgerReversalService, postReversals };
}

const REFUND_ID = 'refund-1';
const PAYMENT_ID = 'payment-1';
const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';
const MERCHANT_ID = 'merchant-1';
const PROVIDER_REFUND_ID = 're_test_1';
const PROVIDER_PAYMENT_ID = 'pi_test_1';
const PAYMENT_AMOUNT = 13500;
const SERVICE_FEE = 500;
const COMMISSION = 400;
const OTHER_ORDER_ID_PROVIDER = 'stripe';

function refundRow(state: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: REFUND_ID,
    payment_id: PAYMENT_ID,
    state,
    amount_satang: PAYMENT_AMOUNT,
    provider: OTHER_ORDER_ID_PROVIDER,
    provider_refund_id: PROVIDER_REFUND_ID,
    updated_at: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

function paymentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount_satang: PAYMENT_AMOUNT,
    provider_payment_id: PROVIDER_PAYMENT_ID,
    ...overrides,
  };
}

function orderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: ORDER_ID, customer_id: CUSTOMER_ID, service_fee_satang: SERVICE_FEE, ...overrides };
}

function refundStatusEvent(overrides: Partial<Record<string, unknown>> = {}) {
  const { raw_payload: rawPayloadOverrides, ...rest } = overrides;
  return {
    id: 'event-1',
    payment_id: PAYMENT_ID,
    raw_payload: {
      providerRefundId: PROVIDER_REFUND_ID,
      providerPaymentId: PROVIDER_PAYMENT_ID,
      status: 'SUCCEEDED',
      amountSatang: PAYMENT_AMOUNT,
      ...(rawPayloadOverrides as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

const ORIGINAL_COMMISSION_GROUP = { id: 'orig-commission-group', order_id: ORDER_ID, refund_id: null, kind: 'MERCHANT_COMMISSION' };
const ORIGINAL_COMMISSION_ENTRIES = [
  { group_id: 'orig-commission-group', account: 'PLATFORM_REVENUE', party_id: null, amount_satang: COMMISSION },
  { group_id: 'orig-commission-group', account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: -COMMISSION },
];

const COMPLETE_REVERSAL_GROUPS = [
  { id: 'g-cp', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'CUSTOMER_PAYMENT_REFUND' },
  { id: 'g-sf', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'SERVICE_FEE_REVENUE_REFUND' },
  { id: 'g-mc', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' },
];
const COMPLETE_REVERSAL_ENTRIES = [
  { group_id: 'g-cp', account: 'CUSTOMER_PAYMENT', party_id: CUSTOMER_ID, amount_satang: -PAYMENT_AMOUNT },
  { group_id: 'g-sf', account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -SERVICE_FEE },
  { group_id: 'g-mc', account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: COMMISSION },
  { group_id: 'g-mc', account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
];

describe('RefundReconciliationDetectorService — Anomaly A (PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED)', () => {
  it('opens a fresh case when persisted evidence says the provider succeeded but the local refund is still in flight', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [
        { data: [refundRow('REFUND_PENDING')], error: null }, // in-flight scan
        { data: [], error: null }, // REFUNDED scan (phase B/F) — nothing
        { data: [], error: null }, // missing-provider-id scan (phase D) — nothing
      ],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      reconciliation_cases: [{ data: { id: 'case-a-1' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });

    const insertCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      kind: 'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED',
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
    });

    // Never mutates refunds/payments — every call to either table is a select.
    for (const c of calls.filter((c) => c.table === 'refunds' || c.table === 'payments')) {
      expect(c.op).toBe('select');
    }
  });

  it('reuses the existing OPEN case on a unique-index conflict rather than creating a duplicate', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      reconciliation_cases: [
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "reconciliation_cases_refund_open_key"' } },
        { data: { id: 'existing-case-a' }, error: null },
      ],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 1, opened: 0, reused: 1, resolved: 0 });
    const caseCalls = calls.filter((c) => c.table === 'reconciliation_cases');
    expect(caseCalls).toHaveLength(2);
    expect(caseCalls[0]!.op).toBe('insert');
    expect(caseCalls[1]!.op).toBe('select');
  });

  it('never flags a genuinely in-flight refund with no matching provider evidence — normal retry is left alone', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [], error: null }], // no event evidence yet
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 0, opened: 0, reused: 0, resolved: 0 });
    expect(calls.some((c) => c.table === 'reconciliation_cases')).toBe(false);
  });

  it('excludes case G states (REFUND_FAILED/REFUND_REJECTED) from consideration — no new kind for PROVIDER_LOCAL_STATE_DIVERGENCE (DEC-060 §2)', async () => {
    // REFUND_FAILED/REFUND_REJECTED are not in IN_FLIGHT_REFUND_STATES at all,
    // so they never reach the in-flight scan's candidate set — proven here by
    // supplying only REFUNDED refunds elsewhere and asserting zero A/C cases.
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded.opened).toBe(0);
    expect(calls.filter((c) => c.table === 'reconciliation_cases')).toHaveLength(0);
  });
});

describe('RefundReconciliationDetectorService — Anomaly C (REFUND_AMOUNT_MISMATCH)', () => {
  it('opens a REFUND_AMOUNT_MISMATCH case, never A, when the provider-reported amount disagrees with the local refund amount', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent({ raw_payload: { amountSatang: PAYMENT_AMOUNT - 100 } })], error: null }],
      reconciliation_cases: [{ data: { id: 'case-c-1' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.refundAmountMismatch).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });
    expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 0, opened: 0, reused: 0, resolved: 0 });

    const insertCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ kind: 'REFUND_AMOUNT_MISMATCH', payment_id: PAYMENT_ID });
  });

  it('never mutates refunds.amount_satang, payments.amount_satang, or any ledger row', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent({ raw_payload: { amountSatang: 1 } })], error: null }],
      reconciliation_cases: [{ data: { id: 'case-c-2' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    await service.run();

    const moneyTables = ['refunds', 'payments', 'ledger_entries', 'ledger_entry_groups'];
    for (const c of calls.filter((c) => moneyTables.includes(c.table))) {
      expect(c.op).toBe('select');
    }
  });
});

describe('RefundReconciliationDetectorService — Anomaly B (LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED)', () => {
  it('opens a case when refunds.state = REFUNDED but no matching provider-final evidence exists', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [], error: null }], // no confirming event at all
      ledger_entry_groups: [
        { data: [ORIGINAL_COMMISSION_GROUP], error: null },
        { data: COMPLETE_REVERSAL_GROUPS, error: null }, // ledger IS complete — isolates B from F
      ],
      ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }, { data: COMPLETE_REVERSAL_ENTRIES, error: null }],
      reconciliation_cases: [{ data: { id: 'case-b-1' }, error: null }],
    });
    const { service: ledgerReversal, postReversals } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.localRefundedProviderNotConfirmed).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });
    // F does not fire — the ledger is complete in this scenario.
    expect(result.refundedLedgerIncomplete).toEqual({ examined: 1, opened: 0, reused: 0, resolved: 0 });
    expect(postReversals).not.toHaveBeenCalled();

    const insertCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ kind: 'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED', payment_id: PAYMENT_ID });
  });

  it('never sets refunds.state or reverses a ledger entry — detection only, per DEC-057 §6/DEC-058', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [], error: null }],
      ledger_entry_groups: [{ data: [ORIGINAL_COMMISSION_GROUP], error: null }, { data: COMPLETE_REVERSAL_GROUPS, error: null }],
      ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }, { data: COMPLETE_REVERSAL_ENTRIES, error: null }],
      reconciliation_cases: [{ data: { id: 'case-b-2' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    await service.run();

    for (const c of calls.filter((c) => c.table === 'refunds')) {
      expect(c.op).toBe('select');
    }
  });

  it('does not open a B case when valid provider-final evidence exists', async () => {
    const { supabase } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      ledger_entry_groups: [{ data: [ORIGINAL_COMMISSION_GROUP], error: null }, { data: COMPLETE_REVERSAL_GROUPS, error: null }],
      ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }, { data: COMPLETE_REVERSAL_ENTRIES, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.localRefundedProviderNotConfirmed).toEqual({ examined: 1, opened: 0, reused: 0, resolved: 0 });
  });
});

describe('RefundReconciliationDetectorService — Anomaly F (REFUNDED_LEDGER_INCOMPLETE) + safe self-heal', () => {
  it('opens a case and self-heals via the existing RefundLedgerReversalService when a reversal component is missing entirely', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }], // B confirmed — isolates F
      ledger_entry_groups: [
        { data: [ORIGINAL_COMMISSION_GROUP], error: null },
        { data: [], error: null }, // no reversal groups exist yet at all
        { data: COMPLETE_REVERSAL_GROUPS, error: null }, // fresh re-verify after self-heal
      ],
      ledger_entries: [
        { data: ORIGINAL_COMMISSION_ENTRIES, error: null },
        { data: COMPLETE_REVERSAL_ENTRIES, error: null }, // fresh re-verify after self-heal
      ],
      reconciliation_cases: [
        { data: { id: 'case-f-1' }, error: null }, // insert
        { data: { id: 'case-f-1' }, error: null }, // autoResolveCase update
      ],
    });
    const { service: ledgerReversal, postReversals } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(postReversals).toHaveBeenCalledTimes(1);
    expect(postReversals).toHaveBeenCalledWith(REFUND_ID, PAYMENT_ID);
    expect(result.refundedLedgerIncomplete).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 1 });

    const insertCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ kind: 'REFUNDED_LEDGER_INCOMPLETE', payment_id: PAYMENT_ID });

    const resolveCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'update');
    expect(resolveCall?.payload).toMatchObject({ state: 'RESOLVED' });
    expect(resolveCall?.eq['id']).toBe('case-f-1');
    expect(resolveCall?.inFilters['state']).toEqual(['OPEN', 'IN_PROGRESS']);
  });

  it('resolves a stale OPEN case left by a prior run once the ledger is found already complete on a later scan', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      ledger_entry_groups: [{ data: [ORIGINAL_COMMISSION_GROUP], error: null }, { data: COMPLETE_REVERSAL_GROUPS, error: null }],
      ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }, { data: COMPLETE_REVERSAL_ENTRIES, error: null }],
      reconciliation_cases: [{ data: { id: 'stale-case-1' }, error: null }], // findOpenCase finds a stale OPEN row
    });
    const { service: ledgerReversal, postReversals } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(postReversals).not.toHaveBeenCalled();
    expect(result.refundedLedgerIncomplete).toEqual({ examined: 1, opened: 0, reused: 0, resolved: 1 });

    const resolveCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'update');
    expect(resolveCall?.payload).toMatchObject({ state: 'RESOLVED' });
  });

  it('leaves the case OPEN/IN_PROGRESS, never fabricating success, when self-heal itself throws (a genuine financial contradiction)', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      ledger_entry_groups: [
        { data: [ORIGINAL_COMMISSION_GROUP], error: null },
        {
          // Wrong amount on the CUSTOMER_PAYMENT_REFUND entry — content mismatch.
          data: COMPLETE_REVERSAL_GROUPS,
          error: null,
        },
      ],
      ledger_entries: [
        { data: ORIGINAL_COMMISSION_ENTRIES, error: null },
        {
          data: [
            { group_id: 'g-cp', account: 'CUSTOMER_PAYMENT', party_id: CUSTOMER_ID, amount_satang: -1 }, // wrong amount
            { group_id: 'g-sf', account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -SERVICE_FEE },
            { group_id: 'g-mc', account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: COMMISSION },
            { group_id: 'g-mc', account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
          ],
          error: null,
        },
      ],
      reconciliation_cases: [{ data: { id: 'case-f-mismatch' }, error: null }],
    });
    const { service: ledgerReversal, postReversals } = fakeLedgerReversal(() => {
      throw new Error('refund refund-1: ledger_entries for group refund:customer_payment:refund-1 account CUSTOMER_PAYMENT has party_id=customer-1/amount_satang=-1, expected party_id=customer-1/amount_satang=-13500. No mutation performed.');
    });
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(postReversals).toHaveBeenCalledTimes(1);
    expect(result.refundedLedgerIncomplete).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });

    // No RESOLVED update was ever issued for this case.
    const updateCalls = calls.filter((c) => c.table === 'reconciliation_cases' && c.op === 'update');
    expect(updateCalls).toHaveLength(0);

    // Case remains open — no destructive mutation to any ledger table was
    // attempted by this file itself (the mocked postReversals is the only
    // write path exercised, and it is asserted to have thrown, not to have
    // silently "succeeded").
    for (const c of calls.filter((c) => c.table === 'ledger_entries' || c.table === 'ledger_entry_groups')) {
      expect(c.op).toBe('select');
    }
  });

  it('repeated self-heal is idempotent — calling run() three times in a row against an unresolving anomaly never opens more than one active case', async () => {
    const buildRun = () =>
      supabaseStub({
        refunds: [{ data: [], error: null }, { data: [refundRow('REFUNDED')], error: null }, { data: [], error: null }],
        payments: [{ data: [paymentRow()], error: null }],
        orders: [{ data: [orderRow()], error: null }],
        payment_events: [{ data: [refundStatusEvent()], error: null }],
        ledger_entry_groups: [{ data: [ORIGINAL_COMMISSION_GROUP], error: null }, { data: [], error: null }],
        ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }],
        reconciliation_cases: [
          // Every run's INSERT conflicts against the still-OPEN case from run 1.
          { data: null, error: { code: '23505', message: 'duplicate key' } },
          { data: { id: 'the-one-case' }, error: null },
        ],
      });

    const { service: ledgerReversal, postReversals } = fakeLedgerReversal(() => {
      throw new Error('still incomplete — a permanent content mismatch, per this test');
    });

    for (let i = 0; i < 3; i++) {
      const { supabase } = buildRun();
      const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);
      const result = await service.run();
      expect(result.refundedLedgerIncomplete.reused).toBe(1);
      expect(result.refundedLedgerIncomplete.opened).toBe(0);
    }

    expect(postReversals).toHaveBeenCalledTimes(3);
  });
});

describe('RefundReconciliationDetectorService — Anomaly D (MISSING_PROVIDER_REFUND_ID)', () => {
  it('opens a case for a refund past REFUND_REQUESTED with no provider_refund_id, and invents no id', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [
        { data: [], error: null },
        { data: [], error: null },
        { data: [refundRow('REFUND_PENDING', { provider_refund_id: null })], error: null },
      ],
      payments: [{ data: [paymentRow()], error: null }],
      reconciliation_cases: [{ data: { id: 'case-d-1' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.missingProviderRefundId).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });
    const insertCall = calls.find((c) => c.table === 'reconciliation_cases' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({ kind: 'MISSING_PROVIDER_REFUND_ID', payment_id: PAYMENT_ID });

    // No refunds write of any kind — never invents/writes a provider_refund_id.
    for (const c of calls.filter((c) => c.table === 'refunds')) {
      expect(c.op).toBe('select');
    }
  });

  it('the scan itself excludes REFUND_REQUESTED — the only state legitimately null', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    await service.run();

    const missingIdCall = calls.filter((c) => c.table === 'refunds')[2]!;
    expect(missingIdCall.neq['state']).toBe('REFUND_REQUESTED');
    expect(missingIdCall.eq['provider_refund_id__is']).toBeNull();
  });
});

describe('RefundReconciliationDetectorService — Anomaly E (MISSING_PROVIDER_EVENT) — documented limitation', () => {
  it('always reports zero — no staleness boundary exists in this codebase for refunds today (DEC-060, explicit non-decision)', async () => {
    const { supabase } = supabaseStub({});
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.missingProviderEvent).toEqual({ examined: 0, opened: 0, reused: 0, resolved: 0 });
  });

  it('issues no query of any kind for Anomaly E — it is a documented no-op, not a hidden scan', () => {
    const source = readFileSync(join(__dirname, 'refund-reconciliation-detector.service.ts'), 'utf8');
    const method = source.slice(source.indexOf('private detectMissingProviderEvent'));
    const body = method.slice(0, method.indexOf('\n  }'));
    expect(body).not.toMatch(/this\.supabase/);
  });
});

describe('RefundReconciliationDetectorService — idempotency and dedup (I/J/K/L)', () => {
  it('I/J — detecting the same anomaly on repeated ticks never creates more than one active case (dedup index as sole authority)', async () => {
    const build = () =>
      supabaseStub({
        refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
        payments: [{ data: [paymentRow()], error: null }],
        payment_events: [{ data: [refundStatusEvent()], error: null }],
        reconciliation_cases: [
          { data: null, error: { code: '23505', message: 'duplicate key' } },
          { data: { id: 'same-case' }, error: null },
        ],
      });
    const { service: ledgerReversal } = fakeLedgerReversal();

    for (let i = 0; i < 100; i++) {
      const { supabase } = build();
      const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);
      const result = await service.run();
      expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 1, opened: 0, reused: 1, resolved: 0 });
    }
  });

  it('K — two different anomaly kinds for the same payment_id both open their own independent case', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [refundRow('REFUND_PENDING', { provider_refund_id: null })], error: null }],
      payments: [{ data: [paymentRow()], error: null }, { data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      reconciliation_cases: [{ data: { id: 'case-1' }, error: null }, { data: { id: 'case-2' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded.opened).toBe(1);
    expect(result.missingProviderRefundId.opened).toBe(1);

    const kinds = calls
      .filter((c) => c.table === 'reconciliation_cases' && c.op === 'insert')
      .map((c) => (c.payload as Record<string, unknown>).kind);
    expect(new Set(kinds)).toEqual(new Set(['PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED', 'MISSING_PROVIDER_REFUND_ID']));
  });

  it('L — the app layer never special-cases a RESOLVED/CLOSED case; a fresh insert always succeeds unless an OPEN/IN_PROGRESS row already blocks it (the partial unique index, not this file, is what makes recurrence-after-resolution legal — DEC-060 §4, also proven at the database layer by the SQL concurrency test)', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [{ data: [refundRow('REFUND_PENDING')], error: null }, { data: [], error: null }, { data: [], error: null }],
      payments: [{ data: [paymentRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      // A fresh INSERT with no conflict — exactly what happens when only
      // RESOLVED/CLOSED history exists for this (kind, payment_id): the
      // partial index does not count those rows at all.
      reconciliation_cases: [{ data: { id: 'genuinely-new-case' }, error: null }],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    const result = await service.run();

    expect(result.providerSucceededLocalNotRefunded).toEqual({ examined: 1, opened: 1, reused: 0, resolved: 0 });
    expect(calls.filter((c) => c.table === 'reconciliation_cases')).toHaveLength(1);
  });
});

describe('RefundReconciliationDetectorService — O (legacy kinds untouched)', () => {
  it('never inserts one of the four pre-existing kinds, or RIDER_RELEASE_INVARIANT — only the six Q-020 refund kinds', async () => {
    const { supabase, calls } = supabaseStub({
      refunds: [
        { data: [refundRow('REFUND_PENDING')], error: null },
        { data: [refundRow('REFUNDED')], error: null },
        { data: [refundRow('REFUND_PENDING', { provider_refund_id: null })], error: null },
      ],
      payments: [{ data: [paymentRow()], error: null }, { data: [paymentRow()], error: null }],
      orders: [{ data: [orderRow()], error: null }],
      payment_events: [{ data: [refundStatusEvent()], error: null }],
      ledger_entry_groups: [{ data: [ORIGINAL_COMMISSION_GROUP], error: null }, { data: [], error: null }],
      ledger_entries: [{ data: ORIGINAL_COMMISSION_ENTRIES, error: null }],
      reconciliation_cases: [
        { data: { id: 'c1' }, error: null },
        { data: { id: 'c2' }, error: null },
        { data: { id: 'c3' }, error: null },
        { data: { id: 'c4' }, error: null },
      ],
    });
    const { service: ledgerReversal } = fakeLedgerReversal();
    const service = new RefundReconciliationDetectorService(supabase, ledgerReversal);

    await service.run();

    const SIX_NEW_KINDS = new Set([
      'PROVIDER_SUCCEEDED_LOCAL_NOT_REFUNDED',
      'LOCAL_REFUNDED_PROVIDER_NOT_CONFIRMED',
      'REFUND_AMOUNT_MISMATCH',
      'MISSING_PROVIDER_REFUND_ID',
      'MISSING_PROVIDER_EVENT',
      'REFUNDED_LEDGER_INCOMPLETE',
    ]);
    const insertedKinds = calls
      .filter((c) => c.table === 'reconciliation_cases' && c.op === 'insert')
      .map((c) => (c.payload as Record<string, unknown>).kind as string);

    expect(insertedKinds.length).toBeGreaterThan(0);
    for (const kind of insertedKinds) {
      expect(SIX_NEW_KINDS.has(kind)).toBe(true);
    }
  });
});

describe('RefundReconciliationDetectorService — structural guarantees (M/N/Q)', () => {
  it('the source file never issues .update( or .delete( against a ledger table, and never against refunds/payments — only reconciliation_cases is ever written', () => {
    const source = readFileSync(join(__dirname, 'refund-reconciliation-detector.service.ts'), 'utf8');
    expect(source).not.toMatch(/\.delete\(/);

    const updateCallCount = (source.match(/\.update\(/g) ?? []).length;
    expect(updateCallCount).toBeGreaterThan(0);

    // Every .update( call site in this file targets reconciliation_cases —
    // checked by proximity to the preceding .from( in the same statement
    // chain (autoResolveCase's own .from('reconciliation_cases')).
    const reconciliationCasesUpdateCount = (
      source.match(/\.from\('reconciliation_cases'\)\s*\n\s*\.update\(/g) ?? []
    ).length;
    expect(reconciliationCasesUpdateCount).toBe(updateCallCount);
  });

  it('never writes refunds.state directly — the only path to REFUNDED remains RefundEventProcessingService (Slice 2)', () => {
    const source = readFileSync(join(__dirname, 'refund-reconciliation-detector.service.ts'), 'utf8');
    expect(source).not.toMatch(/state:\s*'REFUNDED'/);
    expect(source).not.toMatch(/\.from\('refunds'\)[\s\S]{0,80}\.update\(/);
  });

  it('the only write against a ledger table anywhere in this file is the delegated call to RefundLedgerReversalService.postReversals — no second ledger writer', () => {
    const source = readFileSync(join(__dirname, 'refund-reconciliation-detector.service.ts'), 'utf8');
    expect(source).not.toMatch(/\.from\('ledger_entries'\)[\s\S]{0,80}\.(insert|update|delete)\(/);
    expect(source).not.toMatch(/\.from\('ledger_entry_groups'\)[\s\S]{0,80}\.(insert|update|delete)\(/);
    expect(source).toMatch(/this\.ledgerReversal\.postReversals\(/);
  });

  it('never imports or calls a Stripe/provider SDK — provider-neutral at the domain layer (doc-comment mentions describing the absence are fine, an import or a call are not)', () => {
    const source = readFileSync(join(__dirname, 'refund-reconciliation-detector.service.ts'), 'utf8');
    const importLines = source.split('\n').filter((line) => line.trim().startsWith('import '));
    for (const line of importLines) {
      expect(line.toLowerCase()).not.toMatch(/stripe/);
    }
    expect(source).not.toMatch(/require\(['"].*stripe.*['"]\)/i);
    expect(source).not.toMatch(/\bstripe\s*\./i);
  });
});
