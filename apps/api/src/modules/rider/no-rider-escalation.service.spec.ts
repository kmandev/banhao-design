import {
  NoRiderEscalationService,
  NO_RIDER_NOTICE_SECONDS,
  NO_RIDER_DECISION_SECONDS,
} from './no-rider-escalation.service';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * DEC-022's no-rider escalation (Phase H final gap).
 *
 * Same stub shape as `dispatch.service.spec.ts`: a fake `supabase.admin.from()`
 * recording every filter and payload, so the guards can be asserted to be IN
 * the statements rather than checked afterwards in application code.
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
        maybeSingle: () => Promise.resolve(nextResult()),
        returns: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

function serviceWith(results: Result[]) {
  const { supabase, calls } = supabaseStub(results);
  return { subject: new NoRiderEscalationService(supabase), calls };
}

const DELIVERY_ID = 'delivery-1';
const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';

const NOW = new Date('2026-08-30T12:20:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function deliveryRow(createdAt: string) {
  return { id: DELIVERY_ID, created_at: createdAt, order_id: ORDER_ID };
}

describe('NoRiderEscalationService — thresholds', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('under 5 minutes: the query itself excludes the delivery — no escalation', async () => {
    // The `.lt('created_at', <5-min-ago threshold>)` filter is what keeps a
    // fresh search out of the candidate set; a stub that returns [] here
    // proves the service asks for exactly that, not merely that it later
    // ignores a too-young row.
    const { subject, calls } = serviceWith([{ data: [], error: null }]);

    const result = await subject.run();

    expect(result).toEqual({ escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 });
    const threshold = new Date(calls[0]?.lt.created_at as string);
    expect(NOW.getTime() - threshold.getTime()).toBe(NO_RIDER_NOTICE_SECONDS * 1000);
  });

  it('at/after 5 minutes: exactly one OrderNoRiderFound event is written, with the CUSTOMER recipient', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(5))], error: null }, // overdue search
      { data: [], error: null }, // not already escalated
      { data: { customer_id: CUSTOMER_ID }, error: null }, // recipient resolution
      { data: null, error: null }, // outbox insert
    ]);

    const result = await subject.run();

    expect(result.escalated).toBe(1);
    const insertCall = calls.find((c) => c.table === 'outbox' && c.op === 'insert');
    expect(insertCall?.payload).toMatchObject({
      aggregate_type: 'delivery',
      aggregate_id: DELIVERY_ID,
      event_type: 'OrderNoRiderFound',
    });
    const recipients = (
      insertCall?.payload as { payload: { recipients: { recipientId: string; recipientType: string }[] } }
    ).payload.recipients;
    expect(recipients).toEqual([{ recipientId: CUSTOMER_ID, recipientType: 'CUSTOMER' }]);
  });

  it('between 5 and 8 minutes, already escalated: no duplicate outbox row and no decision-point log', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(6))], error: null },
      { data: [{ aggregate_id: DELIVERY_ID }], error: null }, // already escalated
    ]);

    const result = await subject.run();

    expect(result).toEqual({ escalated: 0, decisionPointReached: 0, skipped: 1, failed: 0 });
    expect(calls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);
  });

  it('at/after 8 minutes, already escalated: the decision point is reached, still no duplicate event', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(8))], error: null },
      { data: [{ aggregate_id: DELIVERY_ID }], error: null },
    ]);

    const result = await subject.run();

    expect(result.decisionPointReached).toBe(1);
    expect(result.escalated).toBe(0);
    expect(calls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);
  });

  it('exposes the locked timing as named constants — 5 and 8 minutes', () => {
    expect(NO_RIDER_NOTICE_SECONDS).toBe(5 * 60);
    expect(NO_RIDER_DECISION_SECONDS).toBe(8 * 60);
  });
});

describe('NoRiderEscalationService — duplicate protection', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a repeated run against the same already-escalated delivery does not insert a second outbox row', async () => {
    const { subject: first } = serviceWith([
      { data: [deliveryRow(minutesAgo(5))], error: null },
      { data: [], error: null },
      { data: { customer_id: CUSTOMER_ID }, error: null },
      { data: null, error: null },
    ]);
    await first.run();

    const { subject: second, calls: secondCalls } = serviceWith([
      { data: [deliveryRow(minutesAgo(6))], error: null },
      { data: [{ aggregate_id: DELIVERY_ID }], error: null }, // the outbox now has this row
    ]);
    const result = await second.run();

    expect(result.escalated).toBe(0);
    expect(secondCalls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);
  });

  it('fails closed on a dedup-check read error — treats the candidate as already escalated rather than risk a duplicate', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(6))], error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    const result = await subject.run();

    expect(result.skipped).toBe(1);
    expect(result.escalated).toBe(0);
    expect(calls.some((c) => c.table === 'outbox' && c.op === 'insert')).toBe(false);
  });
});

describe('NoRiderEscalationService — rider assigned before timeout', () => {
  it('a delivery no longer RIDER_SEARCHING/RIDER_REASSIGNING is excluded by the query itself', async () => {
    const { subject, calls } = serviceWith([{ data: [], error: null }]);

    const result = await subject.run();

    expect(result).toEqual({ escalated: 0, decisionPointReached: 0, skipped: 0, failed: 0 });
    expect(calls[0]?.in.state).toEqual(['RIDER_SEARCHING', 'RIDER_REASSIGNING']);
  });
});

describe('NoRiderEscalationService — never auto-cancels', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('touches only deliveries (read) and outbox (insert) — never writes to deliveries or orders', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(9))], error: null },
      { data: [], error: null },
      { data: { customer_id: CUSTOMER_ID }, error: null },
      { data: null, error: null },
    ]);

    await subject.run();

    const writes = calls.filter((c) => c.op !== 'select');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: 'outbox', op: 'insert' });
    expect(calls.every((c) => !(c.table === 'deliveries' && c.op !== 'select'))).toBe(true);
    expect(calls.every((c) => !(c.table === 'orders' && c.op !== 'select'))).toBe(true);
  });
});

describe('NoRiderEscalationService — outbox contract, H-2 compatibility', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a row H-2\'s OutboxDispatchService can consume: recipients[] with recipientId/recipientType', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(5))], error: null },
      { data: [], error: null },
      { data: { customer_id: CUSTOMER_ID }, error: null },
      { data: null, error: null },
    ]);

    await subject.run();

    const insertCall = calls.find((c) => c.table === 'outbox' && c.op === 'insert');
    const payload = insertCall?.payload as { payload: unknown };
    expect(payload.payload).toEqual({
      recipients: [{ recipientId: CUSTOMER_ID, recipientType: 'CUSTOMER' }],
    });
  });

  it('still writes the outbox row even when the recipient cannot be resolved (H-2 handles empty recipients)', async () => {
    const { subject, calls } = serviceWith([
      { data: [deliveryRow(minutesAgo(5))], error: null },
      { data: [], error: null },
      { data: null, error: null }, // order not found
      { data: null, error: null },
    ]);

    const result = await subject.run();

    expect(result.escalated).toBe(1);
    const insertCall = calls.find((c) => c.table === 'outbox' && c.op === 'insert');
    expect((insertCall?.payload as { payload: { recipients: unknown[] } }).payload.recipients).toEqual(
      [],
    );
  });
});
