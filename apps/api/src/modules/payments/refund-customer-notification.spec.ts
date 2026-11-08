import { Logger } from '@nestjs/common';
import { notifyCustomerOfRefund } from './refund-customer-notification';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

function stub(results: Result[]) {
  const calls: { table: string; op: string; payload?: unknown; eq: Record<string, unknown> }[] = [];
  let i = 0;
  const next = () => results[i++] ?? { data: null, error: null };
  const admin = {
    from(table: string) {
      const call = { table, op: 'select', payload: undefined as unknown, eq: {} as Record<string, unknown> };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return Promise.resolve(next());
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        limit: () => builder,
        returns: () => Promise.resolve(next()),
        maybeSingle: () => Promise.resolve(next()),
      };
      return builder;
    },
  };
  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const logger = new Logger('test');

describe('notifyCustomerOfRefund (DEC-069 §1)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('writes one outbox event to the order\'s customer, with the order id so it opens the order', async () => {
    const { supabase, calls } = stub([
      { data: [], error: null }, // no existing event
      { data: { customer_id: 'cust-1' }, error: null },
      { data: null, error: null }, // insert
    ]);

    await notifyCustomerOfRefund(supabase, logger, 'RefundInitiated', 'refund-1', 'order-1');

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.table).toBe('outbox');
    expect(insert?.payload).toEqual({
      aggregate_type: 'refund',
      aggregate_id: 'refund-1',
      event_type: 'RefundInitiated',
      payload: { recipients: [{ recipientId: 'cust-1', recipientType: 'CUSTOMER' }], orderId: 'order-1' },
    });
  });

  it('writes nothing a second time for the same refund and event — a retried call or re-delivered webhook', async () => {
    const { supabase, calls } = stub([{ data: [{ id: 'outbox-9' }], error: null }]);

    await notifyCustomerOfRefund(supabase, logger, 'RefundSucceeded', 'refund-1', 'order-1');

    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    expect(calls[0]?.eq).toEqual({ aggregate_id: 'refund-1', event_type: 'RefundSucceeded' });
  });

  it('never throws when the write fails — the refund already happened', async () => {
    const { supabase } = stub([
      { data: [], error: null },
      { data: { customer_id: 'cust-1' }, error: null },
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expect(notifyCustomerOfRefund(supabase, logger, 'RefundInitiated', 'refund-1', 'order-1')).resolves.toBeUndefined();
  });

  it('never throws when the order cannot be read', async () => {
    const { supabase, calls } = stub([{ data: [], error: null }, { data: null, error: null }]);

    await expect(notifyCustomerOfRefund(supabase, logger, 'RefundInitiated', 'refund-1', 'order-1')).resolves.toBeUndefined();
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });
});
