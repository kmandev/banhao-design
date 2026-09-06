import { PaymentReconciliationService } from './payment-reconciliation.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `docs/SETTLEMENT_MODEL.md` § 11.1. Same stub shape as
 * `payment-event-processing.service.spec.ts`: a fake `supabase.admin.from()`
 * that records every filter a statement was built with and returns queued
 * results in call order. `PaymentReconciliationService` awaits every read
 * sequentially (no `Promise.all`), so the queue order below is exactly the
 * source order of the `.from()` calls in `reconcileForward`/`reconcileOrphans`.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
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
        insert() {
          call.op = 'insert';
          return builder;
        },
        update() {
          call.op = 'update';
          return builder;
        },
        delete() {
          call.op = 'delete';
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

const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';
const PAYMENT_ID = 'payment-1';
const PROVIDER_TXN_ID = 'NULL-EVT-1';
const AMOUNT = 7500;
const GROUP_KEY = `payment:${PAYMENT_ID}:${PROVIDER_TXN_ID}`;
const GROUP_ID = 'ledger-group-1';
const ENTRY_ID = 'entry-1';
const SUCCEEDED_AT = '2026-09-05T12:00:00.000Z';

function successPaymentRow(overrides: Partial<{ id: string; order_id: string; amount_satang: number; succeeded_at: string | null }> = {}) {
  return {
    id: overrides.id ?? PAYMENT_ID,
    order_id: overrides.order_id ?? ORDER_ID,
    amount_satang: overrides.amount_satang ?? AMOUNT,
    succeeded_at: overrides.succeeded_at === undefined ? SUCCEEDED_AT : overrides.succeeded_at,
  };
}

function transactionRow(
  overrides: Partial<{ id: string; payment_id: string; amount_satang: number; provider_transaction_id: string; occurred_at: string }> = {},
) {
  return {
    id: overrides.id ?? 'txn-1',
    payment_id: overrides.payment_id ?? PAYMENT_ID,
    amount_satang: overrides.amount_satang ?? AMOUNT,
    provider_transaction_id: overrides.provider_transaction_id ?? PROVIDER_TXN_ID,
    occurred_at: overrides.occurred_at ?? '2026-09-05T12:00:00.000Z',
  };
}

function groupRow(overrides: Partial<{ id: string; group_key: string; order_id: string | null; kind: string }> = {}) {
  return {
    id: overrides.id ?? GROUP_ID,
    group_key: overrides.group_key ?? GROUP_KEY,
    order_id: overrides.order_id === undefined ? ORDER_ID : overrides.order_id,
    kind: overrides.kind ?? 'CUSTOMER_PAYMENT',
  };
}

function entryRow(
  overrides: Partial<{ id: string; group_id: string; account: string; party_type: string | null; party_id: string | null; amount_satang: number }> = {},
) {
  return {
    id: overrides.id ?? ENTRY_ID,
    group_id: overrides.group_id ?? GROUP_ID,
    account: overrides.account ?? 'CUSTOMER_PAYMENT',
    party_type: overrides.party_type === undefined ? 'CUSTOMER' : overrides.party_type,
    party_id: overrides.party_id === undefined ? CUSTOMER_ID : overrides.party_id,
    amount_satang: overrides.amount_satang ?? AMOUNT,
  };
}

describe('PaymentReconciliationService.reconcileForward', () => {
  it('MATCH: exactly one CUSTOMER_PAYMENT entry, correct amount and identity', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [successPaymentRow()], error: null }, // payments
      { data: [transactionRow()], error: null }, // payment_transactions
      { data: [], error: null }, // reconciliation_cases — none
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null }, // orders
      { data: [groupRow()], error: null }, // ledger_entry_groups
      { data: [entryRow()], error: null }, // ledger_entries
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results, scannedPaymentCount } = await service.reconcileForward(200);

    expect(scannedPaymentCount).toBe(1);
    expect(results).toEqual([
      {
        status: 'MATCH',
        paymentId: PAYMENT_ID,
        providerTransactionId: PROVIDER_TXN_ID,
        orderId: ORDER_ID,
        expectedGroupKey: GROUP_KEY,
        paymentAmountSatang: AMOUNT,
        ledgerAmountSatang: AMOUNT,
        customerId: CUSTOMER_ID,
        ledgerGroupId: GROUP_ID,
        ledgerEntryIds: [ENTRY_ID],
        detail: null,
      },
    ]);

    // Exact group_key lookup — never a fuzzy match by order_id or amount alone.
    const groupsSelect = calls.find((c) => c.table === 'ledger_entry_groups');
    expect(groupsSelect?.in).toEqual({ group_key: [GROUP_KEY] });

    // Strictly read-only — never insert/update/delete anywhere.
    expect(calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('MISSING_CUSTOMER_PAYMENT_LEDGER: no ledger_entry_groups row for the reconstructed key, no grace window configured', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [], error: null }, // ledger_entry_groups — none found
      // no ledger_entries call — groupIds is empty
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: 'MISSING_CUSTOMER_PAYMENT_LEDGER', paymentId: PAYMENT_ID });
  });

  it('IN_FLIGHT: no ledger group yet, but the payment is younger than the caller-supplied graceWindowMs', async () => {
    const recentSucceededAt = new Date(Date.now() - 5_000).toISOString(); // 5s old
    const { supabase } = supabaseStub([
      { data: [successPaymentRow({ succeeded_at: recentSucceededAt })], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200, 60_000); // 60s grace window

    expect(results[0]?.status).toBe('IN_FLIGHT');
  });

  it('MISSING_CUSTOMER_PAYMENT_LEDGER: no ledger group, and the payment is OLDER than the caller-supplied graceWindowMs', async () => {
    const oldSucceededAt = new Date(Date.now() - 120_000).toISOString(); // 120s old
    const { supabase } = supabaseStub([
      { data: [successPaymentRow({ succeeded_at: oldSucceededAt })], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200, 60_000); // 60s grace window, payment is older

    expect(results[0]?.status).toBe('MISSING_CUSTOMER_PAYMENT_LEDGER');
  });

  it('LEGACY_NOT_APPLICABLE: no ledger group, payment succeeded before the caller-supplied cutoverAt', async () => {
    const preCutoverSucceededAt = '2026-01-01T00:00:00.000Z';
    const cutoverAt = new Date('2026-09-01T00:00:00.000Z');
    const { supabase } = supabaseStub([
      { data: [successPaymentRow({ succeeded_at: preCutoverSucceededAt })], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200, undefined, cutoverAt);

    expect(results[0]?.status).toBe('LEGACY_NOT_APPLICABLE');
  });

  it('no cutoverAt and no graceWindowMs supplied: every unmatched payment is reported MISSING outright (the honest, unconfigured default)', async () => {
    const brandNewSucceededAt = new Date().toISOString();
    const { supabase } = supabaseStub([
      { data: [successPaymentRow({ succeeded_at: brandNewSucceededAt })], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results[0]?.status).toBe('MISSING_CUSTOMER_PAYMENT_LEDGER');
  });

  it('PAYMENT_LEDGER_AMOUNT_MISMATCH: payment_transactions.amount_satang != CUSTOMER_PAYMENT.amount_satang', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow({ amount_satang: AMOUNT })], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow({ amount_satang: AMOUNT + 1 })], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results[0]).toMatchObject({
      status: 'PAYMENT_LEDGER_AMOUNT_MISMATCH',
      paymentAmountSatang: AMOUNT,
      ledgerAmountSatang: AMOUNT + 1,
    });
  });

  it('PAYMENT_LEDGER_IDENTITY_MISMATCH: ledger_entry_groups.order_id disagrees with payments.order_id', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow({ order_id: 'a-different-order' })], error: null },
      { data: [entryRow()], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results[0]).toMatchObject({ status: 'PAYMENT_LEDGER_IDENTITY_MISMATCH' });
    expect(results[0]?.detail).toContain('order_id');
  });

  it('PAYMENT_LEDGER_IDENTITY_MISMATCH: CUSTOMER_PAYMENT.party_id disagrees with orders.customer_id', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow({ party_id: 'a-different-customer' })], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results[0]).toMatchObject({ status: 'PAYMENT_LEDGER_IDENTITY_MISMATCH' });
    expect(results[0]?.detail).toContain('party');
  });

  it('DUPLICATE_CUSTOMER_PAYMENT: more than one CUSTOMER_PAYMENT entry under one group', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow({ id: 'entry-1' }), entryRow({ id: 'entry-2' })], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    expect(results[0]).toMatchObject({
      status: 'DUPLICATE_CUSTOMER_PAYMENT',
      ledgerEntryIds: ['entry-1', 'entry-2'],
    });
  });

  it('SURPLUS_PAYMENT exclusion: the earliest transaction is the eligible one; a later surplus transaction on the same payment_id never becomes eligible', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      {
        // ordered ascending by occurred_at — the genuine, earlier transaction first
        data: [
          transactionRow({ id: 'txn-genuine', provider_transaction_id: PROVIDER_TXN_ID, occurred_at: '2026-09-05T12:00:00.000Z' }),
          transactionRow({ id: 'txn-surplus', provider_transaction_id: 'NULL-EVT-2', occurred_at: '2026-09-05T12:05:00.000Z' }),
        ],
        error: null,
      },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow()], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileForward(200);

    // Exactly one result for this payment_id — the surplus transaction was
    // never separately eligible, and the genuine one matches by its own
    // (earlier) provider_transaction_id, never the surplus one's.
    expect(results).toHaveLength(1);
    expect(results[0]?.providerTransactionId).toBe(PROVIDER_TXN_ID);
    expect(results[0]?.status).toBe('MATCH');
    const groupsSelect = calls.find((c) => c.table === 'ledger_entry_groups');
    expect(groupsSelect?.in.group_key).toEqual([`payment:${PAYMENT_ID}:${PROVIDER_TXN_ID}`]);
  });

  it('LATE_PAYMENT exclusion: a payment with an open LATE_PAYMENT reconciliation_cases row is excluded from the eligible set entirely, never reported MISSING', async () => {
    const { supabase } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [{ payment_id: PAYMENT_ID, kind: 'LATE_PAYMENT' }], error: null },
      { data: [], error: null }, // orders — queried for the (now-empty) order_id set
      // no ledger_entry_groups / ledger_entries calls — eligible set is empty
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results, scannedPaymentCount } = await service.reconcileForward(200);

    expect(scannedPaymentCount).toBe(1); // the payment WAS scanned...
    expect(results).toHaveLength(0); // ...but produced no row at all — not MISSING, not MATCH
  });

  it('non-SUCCESS payment exclusion: only payments.state = SUCCESS is ever read', async () => {
    const { supabase, calls } = supabaseStub([{ data: [], error: null }]);
    const service = new PaymentReconciliationService(supabase);

    await service.reconcileForward(200);

    const paymentsSelect = calls.find((c) => c.table === 'payments');
    expect(paymentsSelect?.eq).toEqual({ state: 'SUCCESS' });
  });

  it('deterministic repeated scan: the same input state produces the identical classification both times', async () => {
    const buildStub = () =>
      supabaseStub([
        { data: [successPaymentRow()], error: null },
        { data: [transactionRow()], error: null },
        { data: [], error: null },
        { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
        { data: [groupRow()], error: null },
        { data: [entryRow()], error: null },
      ]);

    const first = await new PaymentReconciliationService(buildStub().supabase).reconcileForward(200);
    const second = await new PaymentReconciliationService(buildStub().supabase).reconcileForward(200);

    expect(first.results).toEqual(second.results);
  });

  it('never invokes insert/update/delete under any classification outcome', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow({ amount_satang: AMOUNT + 1 })], error: null }, // a mismatch — still must not write
    ]);
    const service = new PaymentReconciliationService(supabase);

    await service.reconcileForward(200);

    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });
});

describe('PaymentReconciliationService.reconcileOrphans', () => {
  it('ORPHAN_CUSTOMER_PAYMENT: a CUSTOMER_PAYMENT group whose order has no SUCCESS payment at all', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [groupRow()], error: null }, // ledger_entry_groups (kind = CUSTOMER_PAYMENT)
      { data: [], error: null }, // payments — none SUCCESS for this order_id
      { data: [entryRow()], error: null }, // ledger_entries
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results, scannedOrphanGroupCount } = await service.reconcileOrphans(200);

    expect(scannedOrphanGroupCount).toBe(1);
    expect(results).toEqual([
      {
        status: 'ORPHAN_CUSTOMER_PAYMENT',
        paymentId: null,
        providerTransactionId: null,
        orderId: ORDER_ID,
        expectedGroupKey: GROUP_KEY,
        paymentAmountSatang: null,
        ledgerAmountSatang: AMOUNT,
        customerId: CUSTOMER_ID,
        ledgerGroupId: GROUP_ID,
        ledgerEntryIds: [ENTRY_ID],
        detail: `CUSTOMER_PAYMENT group for order_id ${ORDER_ID} has no SUCCESS payment.`,
      },
    ]);

    const groupsSelect = calls.find((c) => c.table === 'ledger_entry_groups');
    expect(groupsSelect?.eq).toEqual({ kind: 'CUSTOMER_PAYMENT' });
    expect(calls.every((c) => c.op === 'select')).toBe(true);
  });

  it('not orphaned when a SUCCESS payment exists for the group\'s order_id', async () => {
    const { supabase } = supabaseStub([
      { data: [groupRow()], error: null },
      { data: [successPaymentRow()], error: null }, // a real SUCCESS payment backs this order
      { data: [entryRow()], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results } = await service.reconcileOrphans(200);

    expect(results).toHaveLength(0);
  });

  it('scans only kind = CUSTOMER_PAYMENT groups, never commission or rider-earning groups', async () => {
    const { supabase, calls } = supabaseStub([{ data: [], error: null }]);
    const service = new PaymentReconciliationService(supabase);

    await service.reconcileOrphans(200);

    const groupsSelect = calls.find((c) => c.table === 'ledger_entry_groups');
    expect(groupsSelect?.eq).toEqual({ kind: 'CUSTOMER_PAYMENT' });
  });
});

describe('PaymentReconciliationService.reconcile', () => {
  it('merges the forward and orphan passes into one result list', async () => {
    const { supabase } = supabaseStub([
      // forward pass — no SUCCESS payments at all
      { data: [], error: null },
      // orphan pass — one orphan
      { data: [groupRow({ order_id: 'orphan-order' })], error: null },
      { data: [], error: null },
      { data: [entryRow({ party_id: 'orphan-customer' })], error: null },
    ]);
    const service = new PaymentReconciliationService(supabase);

    const { results, scannedPaymentCount, scannedOrphanGroupCount } = await service.reconcile();

    expect(scannedPaymentCount).toBe(0);
    expect(scannedOrphanGroupCount).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('ORPHAN_CUSTOMER_PAYMENT');
  });

  it('never invokes insert/update/delete across the combined scan', async () => {
    const { supabase, calls } = supabaseStub([
      { data: [successPaymentRow()], error: null },
      { data: [transactionRow()], error: null },
      { data: [], error: null },
      { data: [{ id: ORDER_ID, customer_id: CUSTOMER_ID }], error: null },
      { data: [groupRow()], error: null },
      { data: [entryRow()], error: null },
      { data: [], error: null }, // orphan pass — no CUSTOMER_PAYMENT groups
    ]);
    const service = new PaymentReconciliationService(supabase);

    await service.reconcile();

    expect(calls.every((c) => c.op === 'select')).toBe(true);
  });
});
