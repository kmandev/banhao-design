import {
  ArrivalTimeoutEscalationService,
  ARRIVAL_TIMEOUT_ACTION,
} from './arrival-timeout-escalation.service';
import { ARRIVAL_TIMEOUT_SECONDS } from './arrival-timeout-policy';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-053 § 3's five-minute customer-arrival wait, as a tick phase — BQ-017
 * Slice #3.
 *
 * The stub records every statement's table, operation and filters, so the two
 * properties that matter most can be asserted directly rather than inferred:
 * that the phase **never issues an UPDATE**, and that it filters on
 * `arrived_at` rather than any earlier milestone.
 */

type Result = {
  data?: unknown;
  count?: number | null;
  error: { message: string; code?: string } | null;
};

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'count' | 'rpc';
  eq: Record<string, unknown>;
  lte: Record<string, unknown>;
  inFilters: Record<string, readonly unknown[]>;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: [], count: 0, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, lte: {}, inFilters: {} };
      calls.push(call);

      const builder: Record<string, unknown> = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          if (options?.count) {
            call.op = 'count';
          }
          return builder;
        },
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
        delete() {
          call.op = 'delete';
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          if (call.op === 'count') {
            return Promise.resolve(nextResult());
          }
          return builder;
        },
        lte(column: string, value: unknown) {
          call.lte[column] = value;
          return builder;
        },
        lt(column: string, value: unknown) {
          call.lte[column] = value;
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          call.inFilters[column] = values;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        returns: () => Promise.resolve(nextResult()),
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
    rpc(name: string) {
      calls.push({ table: name, op: 'rpc', eq: {}, lte: {}, inFilters: {} });
      return Promise.resolve(nextResult());
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const DELIVERY_ID = 'delivery-1';
const ORDER_ID = 'order-1';
const RIDER_ID = 'rider-1';

function arrivedAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

/** The overdue-delivery scan's result. */
function overdue(rows: Array<Record<string, unknown>>): Result {
  return { data: rows, error: null };
}

function deliveryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DELIVERY_ID,
    order_id: ORDER_ID,
    rider_id: RIDER_ID,
    arrived_at: arrivedAgo(ARRIVAL_TIMEOUT_SECONDS + 60),
    ...overrides,
  };
}

/** The already-escalated existence check's result. */
function escalatedIds(ids: string[]): Result {
  return { data: ids.map((entity_id) => ({ entity_id })), error: null };
}

/** The still-DELIVERING order read's result. */
function deliveringOrders(ids: string[]): Result {
  return { data: ids.map((id) => ({ id, state: 'DELIVERING' })), error: null };
}

function attemptCount(count: number): Result {
  return { data: null, count, error: null };
}

const EMPTY: Result = { data: [], error: null };
const OK: Result = { data: null, error: null };

/** The ordinary path: one eligible delivery, not yet escalated, order still DELIVERING. */
function eligiblePath(attempts = 2): Result[] {
  return [
    overdue([deliveryRow()]),
    escalatedIds([]),
    deliveringOrders([ORDER_ID]),
    attemptCount(attempts),
    OK, // audit_logs insert
  ];
}

describe('ArrivalTimeoutEscalationService — escalation only', () => {
  /**
   * The single most important property of this phase. DEC-053 § 2 makes the
   * operator the failure authority; a timer that could move a delivery would
   * make that authority advisory.
   */
  it('issues no UPDATE of any kind — automatic failure is impossible by construction', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  it('writes to audit_logs and nothing else', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    const writes = calls.filter((c) => c.op === 'insert');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.table).toBe('audit_logs');
  });

  it('touches no state, assignment, availability or financial table', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    for (const forbidden of [
      'rider_assignments',
      'rider_availability',
      'delivery_status_history',
      'order_status_history',
      'outbox',
      'notifications',
      'payments',
      'refunds',
      'ledger_entries',
      'ledger_entry_groups',
      'settlements',
      'release_rider_assignment',
    ]) {
      expect(calls.find((c) => c.table === forbidden)).toBeUndefined();
    }
  });

  it('records the escalation as SYSTEM/worker, with no cause and no amount', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    const audit = calls.find((c) => c.table === 'audit_logs' && c.op === 'insert');
    expect(audit?.payload).toMatchObject({
      actor_type: 'SYSTEM',
      actor_id: null,
      action: ARRIVAL_TIMEOUT_ACTION,
      entity_type: 'delivery',
      entity_id: DELIVERY_ID,
      source: 'worker',
    });

    // Neither an agent decision nor a human one.
    expect(audit?.payload?.['actor_type']).not.toBe('AI');
    expect(audit?.payload?.['actor_type']).not.toBe('OPERATOR');

    const serialised = JSON.stringify(audit?.payload);
    // No cause: DEC-053 § 2 reserves that choice for the operator.
    expect(serialised).not.toContain('causeCode');
    expect(serialised).not.toContain('failure_cause');
    // No money of any kind.
    for (const money of ['satang', 'refund', 'amount', 'fee', 'payout', 'compensation']) {
      expect(serialised.toLowerCase()).not.toContain(money);
    }
  });

  it('carries the triage context an operator needs, and says it is awaiting them', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath(1));

    await new ArrivalTimeoutEscalationService(supabase).run();

    const after = calls.find((c) => c.table === 'audit_logs' && c.op === 'insert')?.payload?.[
      'after'
    ] as Record<
      string,
      unknown
    >;

    expect(after).toMatchObject({
      orderId: ORDER_ID,
      deliveryState: 'ARRIVED',
      orderState: 'DELIVERING',
      waitSecondsRequired: ARRIVAL_TIMEOUT_SECONDS,
      contactAttempts: 1,
      contactAttemptsRequired: 2,
      awaitingOperatorResolution: true,
    });
    expect(typeof after['waitedSeconds']).toBe('number');
  });

  it('escalates even when the rider has recorded no contact attempts — attention is not resolution', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath(0));

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result.escalated).toBe(1);
    const after = calls.find((c) => c.table === 'audit_logs' && c.op === 'insert')?.payload?.[
      'after'
    ] as Record<
      string,
      unknown
    >;
    expect(after).toMatchObject({ contactAttempts: 0 });
  });
});

describe('ArrivalTimeoutEscalationService — the five-minute threshold', () => {
  it('anchors the scan on arrived_at, not on any earlier milestone', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    const scan = calls[0];
    expect(scan?.table).toBe('deliveries');
    expect(scan?.eq).toMatchObject({ state: 'ARRIVED' });
    expect(Object.keys(scan?.lte ?? {})).toEqual(['arrived_at']);
    // DEC-054's central hazard: the clock must not start at the shop.
    expect(Object.keys(scan?.lte ?? {})).not.toContain('picked_up_at');
    expect(Object.keys(scan?.lte ?? {})).not.toContain('assigned_at');
    expect(Object.keys(scan?.lte ?? {})).not.toContain('created_at');
  });

  it('uses a cutoff of exactly five minutes — not the 10 minutes BQ-017 illustrated', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());
    const before = Date.now();

    await new ArrivalTimeoutEscalationService(supabase).run();

    const cutoff = Date.parse(calls[0]?.lte?.['arrived_at'] as string);
    const elapsed = before - cutoff;
    expect(elapsed).toBeGreaterThanOrEqual(ARRIVAL_TIMEOUT_SECONDS * 1000 - 1000);
    expect(elapsed).toBeLessThan(ARRIVAL_TIMEOUT_SECONDS * 1000 + 5000);
    expect(ARRIVAL_TIMEOUT_SECONDS).toBe(300);
  });

  /**
   * The database applies the cutoff, so these three cases are expressed as
   * what the scan returns. A delivery inside the window is simply not in the
   * result set — proven at the SQL level in
   * `supabase/tests/delivery_arrival_timeout_test.sql`.
   */
  it('escalates nothing when the scan returns no overdue delivery', async () => {
    const { supabase, calls } = supabaseStub([EMPTY]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toEqual({ examined: 0, escalated: 0, skipped: 0, failed: 0 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  it('escalates a delivery that has waited well past the threshold', async () => {
    const { supabase } = supabaseStub([
      overdue([deliveryRow({ arrived_at: arrivedAgo(ARRIVAL_TIMEOUT_SECONDS * 4) })]),
      escalatedIds([]),
      deliveringOrders([ORDER_ID]),
      attemptCount(2),
      OK,
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result.escalated).toBe(1);
  });
});

describe('ArrivalTimeoutEscalationService — eligibility', () => {
  it('skips a delivery whose order is no longer DELIVERING', async () => {
    const { supabase, calls } = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([]),
      // The order read returns nothing: it is not DELIVERING any more.
      EMPTY,
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ examined: 1, escalated: 0, skipped: 1 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  it('filters the order read on DELIVERING, so an ended order can never qualify', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    const orderRead = calls.find((c) => c.table === 'orders');
    expect(orderRead?.eq).toMatchObject({ state: 'DELIVERING' });
    expect(orderRead?.op).toBe('select');
  });

  it('escalates only the eligible delivery when a batch mixes eligible and ineligible', async () => {
    const OTHER_DELIVERY = 'delivery-2';
    const OTHER_ORDER = 'order-2';
    const { supabase, calls } = supabaseStub([
      overdue([
        deliveryRow(),
        deliveryRow({ id: OTHER_DELIVERY, order_id: OTHER_ORDER }),
      ]),
      escalatedIds([]),
      // Only the first order is still DELIVERING.
      deliveringOrders([ORDER_ID]),
      attemptCount(2),
      OK,
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ examined: 2, escalated: 1, skipped: 1 });
    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.payload).toMatchObject({ entity_id: DELIVERY_ID });
  });
});

describe('ArrivalTimeoutEscalationService — idempotency', () => {
  it('does not re-escalate a delivery that already has an escalation row', async () => {
    const { supabase, calls } = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([DELIVERY_ID]),
      deliveringOrders([ORDER_ID]),
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ examined: 1, escalated: 0, skipped: 1 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });

  /**
   * The invariant Part 3 asks for: one eligible delivery produces one active
   * escalation however many ticks see it. Modelled as a real sequence — the
   * first tick writes, the second finds the row it wrote.
   */
  it('produces exactly one escalation across repeated ticks on the same delivery', async () => {
    const first = supabaseStub(eligiblePath());
    const second = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([DELIVERY_ID]), // the row the first tick wrote
      deliveringOrders([ORDER_ID]),
    ]);
    const third = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([DELIVERY_ID]),
      deliveringOrders([ORDER_ID]),
    ]);

    const results = [
      await new ArrivalTimeoutEscalationService(first.supabase).run(),
      await new ArrivalTimeoutEscalationService(second.supabase).run(),
      await new ArrivalTimeoutEscalationService(third.supabase).run(),
    ];

    expect(results.map((r) => r.escalated)).toEqual([1, 0, 0]);

    const allInserts = [...first.calls, ...second.calls, ...third.calls].filter(
      (c) => c.op === 'insert',
    );
    expect(allInserts).toHaveLength(1);
  });

  it('checks for existing escalations by (action, entity), scoped to this batch', async () => {
    const { supabase, calls } = supabaseStub(eligiblePath());

    await new ArrivalTimeoutEscalationService(supabase).run();

    const dedupe = calls.find((c) => c.table === 'audit_logs' && c.op === 'select');
    expect(dedupe?.eq).toMatchObject({
      action: ARRIVAL_TIMEOUT_ACTION,
      entity_type: 'delivery',
    });
    expect(dedupe?.inFilters).toMatchObject({ entity_id: [DELIVERY_ID] });
  });

  it('fails closed when the dedupe check errors — silence rather than duplicates', async () => {
    const { supabase, calls } = supabaseStub([
      overdue([deliveryRow()]),
      { data: null, error: { message: 'connection reset' } },
      deliveringOrders([ORDER_ID]),
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ escalated: 0, skipped: 1 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });
});

describe('ArrivalTimeoutEscalationService — never throws', () => {
  it('returns an empty result rather than throwing when the scan fails', async () => {
    const { supabase } = supabaseStub([{ data: null, error: { message: 'connection reset' } }]);

    await expect(new ArrivalTimeoutEscalationService(supabase).run()).resolves.toEqual({
      examined: 0,
      escalated: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it('counts an audit write failure rather than throwing, so later tick phases still run', async () => {
    const { supabase } = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([]),
      deliveringOrders([ORDER_ID]),
      attemptCount(2),
      { data: null, error: { message: 'connection reset' } },
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ examined: 1, escalated: 0, failed: 1 });
  });

  it('reports zero attempts rather than throwing when the count read fails', async () => {
    const { supabase, calls } = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([]),
      deliveringOrders([ORDER_ID]),
      { data: null, count: null, error: { message: 'connection reset' } },
      OK,
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result.escalated).toBe(1);
    const after = calls.find((c) => c.table === 'audit_logs' && c.op === 'insert')?.payload?.[
      'after'
    ] as Record<
      string,
      unknown
    >;
    expect(after).toMatchObject({ contactAttempts: 0 });
  });

  it('skips the round rather than throwing when the order read fails', async () => {
    const { supabase, calls } = supabaseStub([
      overdue([deliveryRow()]),
      escalatedIds([]),
      { data: null, error: { message: 'connection reset' } },
    ]);

    const result = await new ArrivalTimeoutEscalationService(supabase).run();

    expect(result).toMatchObject({ escalated: 0, skipped: 1 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
  });
});
