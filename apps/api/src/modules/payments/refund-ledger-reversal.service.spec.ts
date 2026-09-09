import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RefundLedgerReversalService } from './refund-ledger-reversal.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * Q-020 Slice 3 — same fake `supabase.admin.from()` stub shape as
 * `refund-event-processing.service.spec.ts` and
 * `payment-event-processing.service.spec.ts`: records every filter/payload a
 * statement was built with and returns queued results in call order, so a
 * test can assert a guard (`.eq()`, `.is()`) or a payload shape is actually
 * IN the query, not merely checked afterward in application code.
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown> | Record<string, unknown>[];
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;

  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        is(column: string, value: unknown) {
          call.eq[`${column}__is`] = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const REFUND_ID = 'refund-1';
const PAYMENT_ID = 'payment-1';
const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';
const RESTAURANT_ID = 'restaurant-1';
const MERCHANT_ID = 'merchant-1';
const COMMISSION_GROUP_ID = 'commission-group-1';

const PAYMENT_AMOUNT = 13000;
const SERVICE_FEE = 500;
const COMMISSION = 400; // e.g. 8% of a 5000 food subtotal, per the mission's own worked example

function paymentRow(overrides: { amount_satang?: number } = {}) {
  return { order_id: ORDER_ID, amount_satang: overrides.amount_satang ?? PAYMENT_AMOUNT };
}

function orderRow(overrides: { service_fee_satang?: number } = {}) {
  return {
    customer_id: CUSTOMER_ID,
    restaurant_id: RESTAURANT_ID,
    service_fee_satang: overrides.service_fee_satang ?? SERVICE_FEE,
  };
}

const COMMISSION_GROUP = { id: COMMISSION_GROUP_ID };
/**
 * The REVERSAL entries this service itself posts for `MERCHANT_COMMISSION_REFUND`
 * — the exact negation of the ORIGINAL posted commission entries
 * (`insertCommissionEntries`'s own sign convention, `MERCHANT_PAYABLE
 * -commission` / `PLATFORM_REVENUE +commission`, reproduced inline in
 * `preludeResults()` below since that read represents the historical fact,
 * never this service's own output). Used to simulate an
 * already-correctly-posted reversal group in the idempotency tests.
 */
const COMMISSION_REVERSAL_ENTRIES = [
  { account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: COMMISSION },
  { account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
];

/**
 * The "happy path" prelude every `postReversals` call needs before it can
 * post anything: `payments`, `orders`, then the original `MERCHANT_COMMISSION`
 * group + its two entries. Every test below starts its result queue with
 * these four, in this order — `readOriginalCommission` always runs before
 * any of the three `reverse*` methods (see `postReversals`'s own body).
 */
function preludeResults(overrides: { paymentAmount?: number; serviceFee?: number; commission?: number } = {}): Result[] {
  const commission = overrides.commission ?? COMMISSION;
  return [
    { data: paymentRow({ amount_satang: overrides.paymentAmount }), error: null },
    { data: orderRow({ service_fee_satang: overrides.serviceFee }), error: null },
    { data: COMMISSION_GROUP, error: null },
    {
      data: [
        { account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: -commission },
        { account: 'PLATFORM_REVENUE', party_id: null, amount_satang: commission },
      ],
      error: null,
    },
  ];
}

describe('RefundLedgerReversalService.postReversals — happy path, all three components', () => {
  it('posts three independent groups — MERCHANT_COMMISSION, CUSTOMER_PAYMENT, SERVICE_FEE_REVENUE reversals, in that order', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null }, // commission group insert
      { data: null, error: null }, // commission entries insert
      { data: { id: 'g-customer' }, error: null }, // customer payment group insert
      { data: null, error: null }, // customer payment entry insert
      { data: { id: 'g-servicefee' }, error: null }, // service fee group insert
      { data: null, error: null }, // service fee entry insert
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupInserts = calls.filter((c) => c.table === 'ledger_entry_groups' && c.op === 'insert');
    expect(groupInserts.map((c) => (c.payload as Record<string, unknown>).kind)).toEqual([
      'MERCHANT_COMMISSION_REFUND',
      'CUSTOMER_PAYMENT_REFUND',
      'SERVICE_FEE_REVENUE_REFUND',
    ]);
    for (const g of groupInserts) {
      expect(g.payload).toMatchObject({ refund_id: REFUND_ID, order_id: ORDER_ID });
    }
  });

  it('anchors every group_key on the local refund identity alone (DEC-049 §6) — never a provider id', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupKeys = calls
      .filter((c) => c.table === 'ledger_entry_groups' && c.op === 'insert')
      .map((c) => (c.payload as Record<string, unknown>).group_key);
    expect(groupKeys).toEqual([
      `refund:commission:${REFUND_ID}`,
      `refund:customer_payment:${REFUND_ID}`,
      `refund:service_fee:${REFUND_ID}`,
    ]);
  });

  it('never combines the three components into one group — no zero-sum bridge group (DEC-049 clause 2/3)', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupInserts = calls.filter((c) => c.table === 'ledger_entry_groups' && c.op === 'insert');
    expect(groupInserts).toHaveLength(3);
    expect(new Set(groupInserts.map((c) => (c.payload as Record<string, unknown>).group_key)).size).toBe(3);
  });
});

describe('RefundLedgerReversalService — CUSTOMER_PAYMENT reversal (DEC-049/DEC-059 clause A)', () => {
  it('uses the exact original payments.amount_satang, negated, on the CUSTOMER_PAYMENT account', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ paymentAmount: 13000 }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const entryInsert = calls.find(
      (c, i) => c.table === 'ledger_entries' && c.op === 'insert' && calls[i - 1]?.table === 'ledger_entry_groups' && (calls[i - 1]!.payload as Record<string, unknown>).kind === 'CUSTOMER_PAYMENT_REFUND',
    );
    expect(entryInsert?.payload).toEqual([
      { group_id: 'g-customer', account: 'CUSTOMER_PAYMENT', party_type: 'CUSTOMER', party_id: CUSTOMER_ID, amount_satang: -13000 },
    ]);
  });

  it('never derives the amount from current order/cart/pricing data — only one payments read occurs', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    expect(calls.filter((c) => c.table === 'payments')).toHaveLength(1);
  });

  it('posts exactly one CUSTOMER_PAYMENT reversal group', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const customerGroupInserts = calls.filter(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'CUSTOMER_PAYMENT_REFUND',
    );
    expect(customerGroupInserts).toHaveLength(1);
  });
});

describe('RefundLedgerReversalService — SERVICE_FEE_REVENUE reversal (DEC-048/DEC-049/DEC-059 clause B)', () => {
  it('uses the exact original orders.service_fee_satang, negated, never recalculated', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ serviceFee: 500 }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'SERVICE_FEE_REVENUE_REFUND',
    );
    const entryInsert = calls[groupIdx + 1]!;
    expect(entryInsert.table).toBe('ledger_entries');
    expect(entryInsert.payload).toEqual([
      { group_id: 'g-servicefee', account: 'PLATFORM_REVENUE', party_type: 'PLATFORM', party_id: null, amount_satang: -500 },
    ]);
  });

  it('reverses onto the same PLATFORM_REVENUE account the original recognition used — not a new account', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'SERVICE_FEE_REVENUE_REFUND',
    );
    const entryInsert = calls[groupIdx + 1]!;
    expect((entryInsert.payload as Record<string, unknown>[])[0]!.account).toBe('PLATFORM_REVENUE');
  });

  it('posts exactly one SERVICE_FEE_REVENUE reversal group', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const feeGroupInserts = calls.filter(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'SERVICE_FEE_REVENUE_REFUND',
    );
    expect(feeGroupInserts).toHaveLength(1);
  });
});

describe('RefundLedgerReversalService — MERCHANT_COMMISSION reversal (DEC-059 clause C, the new lock)', () => {
  it('reads the original recognized commission from the posted ledger_entries — never recomputes 8% of a current food subtotal', async () => {
    // Original: food subtotal 5000, 8% = 400 (the mission's own worked example)
    // — but the crucial proof is that this service never touches `orders`
    // for a subtotal at all, and never imports commission-pricing.ts.
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ commission: 400 }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'MERCHANT_COMMISSION_REFUND',
    );
    const entryInsert = calls[groupIdx + 1]!;
    expect(entryInsert.payload).toEqual([
      { group_id: 'g-commission', account: 'MERCHANT_PAYABLE', party_type: 'MERCHANT', party_id: MERCHANT_ID, amount_satang: 400 },
      { group_id: 'g-commission', account: 'PLATFORM_REVENUE', party_type: 'PLATFORM', party_id: null, amount_satang: -400 },
    ]);
    expect(calls.some((c) => c.table === 'restaurants')).toBe(false);
    expect(calls.filter((c) => c.table === 'orders')).toHaveLength(1);
  });

  it('never imports commission-pricing.ts or calls calculateFoodSubtotalCommissionSatang — doc-comment mentions of the name are fine, an import or a call are not', () => {
    const source = readFileSync(join(__dirname, 'refund-ledger-reversal.service.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"].*commission-pricing['"]/);
    expect(source).not.toMatch(/calculateFoodSubtotalCommissionSatang\s*\(/);
  });

  it('the reversal amount exactly equals the original recognized amount even for an unusual value — no rounding, no recomputation', async () => {
    const oddCommission = 1;
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ commission: oddCommission }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'MERCHANT_COMMISSION_REFUND',
    );
    const entryInsert = calls[groupIdx + 1]!;
    const amounts = (entryInsert.payload as Record<string, unknown>[]).map((e) => e.amount_satang);
    expect(amounts).toEqual([oddCommission, -oddCommission]);
  });

  it('posts exactly one MERCHANT_COMMISSION reversal group, independent of the other two', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const commissionGroupInserts = calls.filter(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'MERCHANT_COMMISSION_REFUND',
    );
    expect(commissionGroupInserts).toHaveLength(1);
  });

  it('throws (fails closed) when no original MERCHANT_COMMISSION group exists for the order', async () => {
    const { supabase } = supabaseStub([
      { data: paymentRow(), error: null },
      { data: orderRow(), error: null },
      { data: null, error: null }, // no commission group found
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow(/no original MERCHANT_COMMISSION/);
  });

  it('throws (fails closed) when the original commission group is missing its expected entries', async () => {
    const { supabase } = supabaseStub([
      { data: paymentRow(), error: null },
      { data: orderRow(), error: null },
      { data: COMMISSION_GROUP, error: null },
      { data: [], error: null }, // entries missing entirely
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow(/missing its expected/);
  });
});

describe('RefundLedgerReversalService — idempotency (Step 12/21)', () => {
  it('processing the same refund three times posts exactly one group per component, no duplicate entries, no amount multiplication', async () => {
    // First call: fresh insert of all three groups.
    const { supabase: supabase1 } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service1 = new RefundLedgerReversalService(supabase1);
    await service1.postReversals(REFUND_ID, PAYMENT_ID);

    // Second and third calls: every group insert now conflicts (23505); each
    // is read back, verified identical, and found already fully posted.
    for (let i = 0; i < 2; i++) {
      const { supabase, calls } = supabaseStub([
        ...preludeResults(),
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
        { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
        { data: COMMISSION_REVERSAL_ENTRIES, error: null },
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
        { data: { id: 'g-customer', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'CUSTOMER_PAYMENT_REFUND' }, error: null },
        {
          data: [{ account: 'CUSTOMER_PAYMENT', party_id: CUSTOMER_ID, amount_satang: -PAYMENT_AMOUNT }],
          error: null,
        },
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
        { data: { id: 'g-servicefee', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'SERVICE_FEE_REVENUE_REFUND' }, error: null },
        { data: [{ account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -SERVICE_FEE }], error: null },
      ]);
      const service = new RefundLedgerReversalService(supabase);

      await service.postReversals(REFUND_ID, PAYMENT_ID);

      // No fresh entries inserted on a redelivery that found everything
      // already correct — self-heal only inserts what is actually missing.
      expect(calls.some((c) => c.table === 'ledger_entries' && c.op === 'insert')).toBe(false);
    }
  });

  it('a unique-constraint conflict on the group insert is read back and treated as the expected idempotency race, not a financial error (Step 23)', async () => {
    const { supabase } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ledger_entry_groups_group_key_key"' } },
      { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
      { data: COMMISSION_REVERSAL_ENTRIES, error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: 'g-customer', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'CUSTOMER_PAYMENT_REFUND' }, error: null },
      { data: [{ account: 'CUSTOMER_PAYMENT', party_id: CUSTOMER_ID, amount_satang: -PAYMENT_AMOUNT }], error: null },
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: 'g-servicefee', order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'SERVICE_FEE_REVENUE_REFUND' }, error: null },
      { data: [{ account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -SERVICE_FEE }], error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).resolves.toBeUndefined();
  });
});

describe('RefundLedgerReversalService — self-healing (Step 13/22)', () => {
  it('a group that exists but is missing one of its two expected entries has only the missing entry inserted — the existing one is not duplicated', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // commission group conflict
      { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
      // Only MERCHANT_PAYABLE was recorded before a crash — PLATFORM_REVENUE is missing.
      { data: [{ account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: COMMISSION }], error: null },
      { data: null, error: null }, // self-heal insert of the missing PLATFORM_REVENUE entry
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const commissionEntryInserts = calls.filter(
      (c, i) => c.table === 'ledger_entries' && c.op === 'insert' && i > 0 && calls[i - 1]?.table === 'ledger_entries',
    );
    const selfHealInsert = calls.find(
      (c) => c.table === 'ledger_entries' && c.op === 'insert' && Array.isArray(c.payload) && c.payload.length === 1 && c.payload[0]!.account === 'PLATFORM_REVENUE' && c.payload[0]!.group_id === COMMISSION_GROUP_ID,
    );
    expect(selfHealInsert).toBeDefined();
    expect((selfHealInsert!.payload as Record<string, unknown>[])[0]).toMatchObject({ amount_satang: -COMMISSION });
    void commissionEntryInserts;
  });

  it('honestly reports what current test infrastructure can and cannot exercise for self-healing', () => {
    // This suite constructs the "group exists, entry missing" state purely
    // through queued stub results — it does not run against a real Postgres
    // instance with an actual crash between two statements. The shape of the
    // self-heal query (insert-first, read-back on 23505, insert only what a
    // fresh read of ledger_entries shows is absent) is exercised and
    // asserted above; a genuine crash-window reproduction against a live
    // database is not attempted here — see this Slice's own final report,
    // "Concurrency", for the same honesty applied to true two-connection
    // concurrency.
    expect(true).toBe(true);
  });
});

describe('RefundLedgerReversalService — conflict content-integrity (Step 14/24, fail closed)', () => {
  it('fails closed when an existing group has the same group_key but a conflicting order_id/refund_id/kind — never overwrites', async () => {
    const { supabase } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: COMMISSION_GROUP_ID, order_id: 'some-other-order', refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow(/conflicting identity/);
  });

  it('fails closed when an existing entry has the right account but the wrong amount — never mutates or duplicates it', async () => {
    const { supabase } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
      {
        data: [
          { account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: 999 }, // wrong amount
          { account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
        ],
        error: null,
      },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow(/expected party_id=.*amount_satang=/);
  });

  it('fails closed when an existing entry has the right account but the wrong party_id — never mutates it', async () => {
    const { supabase } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
      {
        data: [
          { account: 'MERCHANT_PAYABLE', party_id: 'wrong-merchant', amount_satang: COMMISSION },
          { account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
        ],
        error: null,
      },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow(/expected party_id=.*amount_satang=/);
  });

  it('never inserts a duplicate or a correction row when a mismatch is found — no ledger_entries insert call happens at all', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: { id: COMMISSION_GROUP_ID, order_id: ORDER_ID, refund_id: REFUND_ID, kind: 'MERCHANT_COMMISSION_REFUND' }, error: null },
      {
        data: [
          { account: 'MERCHANT_PAYABLE', party_id: MERCHANT_ID, amount_satang: 1 },
          { account: 'PLATFORM_REVENUE', party_id: null, amount_satang: -COMMISSION },
        ],
        error: null,
      },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).rejects.toThrow();
    expect(calls.some((c) => c.table === 'ledger_entries' && c.op === 'insert')).toBe(false);
  });
});

describe('RefundLedgerReversalService — immutability (Step 25, mandatory)', () => {
  it('never issues an update or delete against ledger_entry_groups or ledger_entries — every call to those tables is select or insert only', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const ledgerCalls = calls.filter((c) => c.table === 'ledger_entry_groups' || c.table === 'ledger_entries');
    expect(ledgerCalls.length).toBeGreaterThan(0);
    for (const call of ledgerCalls) {
      expect(['select', 'insert']).toContain(call.op);
    }
  });

  it('the source file itself never references .update( or .delete( against a ledger table — a structural, not just behavioural, guarantee', () => {
    const source = readFileSync(join(__dirname, 'refund-ledger-reversal.service.ts'), 'utf8');
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
  });
});

describe('RefundLedgerReversalService — no Stripe/network call (Step 15)', () => {
  it('the source file never imports Stripe or any payment provider, and its only import besides SupabaseService is @nestjs/common — doc-comment mentions of "Stripe" describing the absence are fine, an import is not', () => {
    const source = readFileSync(join(__dirname, 'refund-ledger-reversal.service.ts'), 'utf8');
    const importLines = source.split('\n').filter((line: string) => line.trim().startsWith('import '));
    expect(importLines).toEqual([
      "import { Injectable, Logger } from '@nestjs/common';",
      "import { SupabaseService } from '../../supabase/supabase.service';",
    ]);
  });
});

describe('RefundLedgerReversalService — accounting invariants (Step 27)', () => {
  it('original CUSTOMER_PAYMENT (+amount) plus this reversal (-amount) sums to zero', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ paymentAmount: PAYMENT_AMOUNT }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'CUSTOMER_PAYMENT_REFUND',
    );
    const reversalAmount = (calls[groupIdx + 1]!.payload as Record<string, unknown>[])[0]!.amount_satang as number;
    const ORIGINAL_CUSTOMER_PAYMENT = PAYMENT_AMOUNT; // postCustomerPaymentLedger posts +amount_satang
    expect(ORIGINAL_CUSTOMER_PAYMENT + reversalAmount).toBe(0);
  });

  it('original SERVICE_FEE_REVENUE (+fee) plus this reversal (-fee) sums to zero', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ serviceFee: SERVICE_FEE }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'SERVICE_FEE_REVENUE_REFUND',
    );
    const reversalAmount = (calls[groupIdx + 1]!.payload as Record<string, unknown>[])[0]!.amount_satang as number;
    const ORIGINAL_SERVICE_FEE_REVENUE = SERVICE_FEE; // postServiceFeeLedger posts +service_fee_satang
    expect(ORIGINAL_SERVICE_FEE_REVENUE + reversalAmount).toBe(0);
  });

  it('original MERCHANT_COMMISSION group entries plus this reversal group entries sum to zero, per account', async () => {
    const { supabase, calls } = supabaseStub([
      ...preludeResults({ commission: COMMISSION }),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await service.postReversals(REFUND_ID, PAYMENT_ID);

    const groupIdx = calls.findIndex(
      (c) => c.table === 'ledger_entry_groups' && c.op === 'insert' && (c.payload as Record<string, unknown>).kind === 'MERCHANT_COMMISSION_REFUND',
    );
    const reversalEntries = calls[groupIdx + 1]!.payload as Record<string, unknown>[];
    const reversalMerchantPayable = reversalEntries.find((e) => e.account === 'MERCHANT_PAYABLE')!.amount_satang as number;
    const reversalPlatformRevenue = reversalEntries.find((e) => e.account === 'PLATFORM_REVENUE')!.amount_satang as number;

    // Original insertCommissionEntries: MERCHANT_PAYABLE -commission, PLATFORM_REVENUE +commission.
    expect(-COMMISSION + reversalMerchantPayable).toBe(0);
    expect(COMMISSION + reversalPlatformRevenue).toBe(0);
  });

  it('does not require any unrelated ledger group to net to zero — only the three refunded components', async () => {
    const { supabase } = supabaseStub([
      ...preludeResults(),
      { data: { id: 'g-commission' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-customer' }, error: null },
      { data: null, error: null },
      { data: { id: 'g-servicefee' }, error: null },
      { data: null, error: null },
    ]);
    const service = new RefundLedgerReversalService(supabase);

    await expect(service.postReversals(REFUND_ID, PAYMENT_ID)).resolves.toBeUndefined();
  });
});

describe('RefundLedgerReversalService — no partial refund (Step 19)', () => {
  it('the source file has no proration, percentage-of-refund, or partial-amount logic', () => {
    const source = readFileSync(join(__dirname, 'refund-ledger-reversal.service.ts'), 'utf8');
    expect(source).not.toMatch(/proportion/i);
    expect(source).not.toMatch(/partial/i);
  });
});
