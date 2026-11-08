import { Logger } from '@nestjs/common';
import { CREATED_ORDER_EXPIRY_MINUTES, StaleCreatedOrderExpiryService } from './stale-created-order-expiry.service';
import type { SupabaseService } from '../../supabase/supabase.service';

type Result = { data: unknown; error: { message: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'update' | 'insert';
  payload?: unknown;
  eq: Record<string, unknown>;
  lt: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

function stub(results: Result[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const next = () => results[i++] ?? { data: null, error: null };
  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, lt: {}, in: {} };
      calls.push(call);
      const builder: Record<string, unknown> = {
        select: () => builder,
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return Promise.resolve(next());
        },
        eq(column: string, value: unknown) {
          call.eq[column] = value;
          return builder;
        },
        lt(column: string, value: unknown) {
          call.lt[column] = value;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.in[column] = values;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        returns: () => Promise.resolve(next()),
      };
      return builder;
    },
  };
  return { service: new StaleCreatedOrderExpiryService({ admin } as unknown as SupabaseService), calls };
}

const NOW = new Date('2026-11-08T09:00:00Z');
const CUTOFF = '2026-11-08T08:45:00.000Z';

describe('StaleCreatedOrderExpiryService (DEC-069 §3)', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('uses the owner\'s fifteen minutes', () => {
    expect(CREATED_ORDER_EXPIRY_MINUTES).toBe(15);
  });

  it('reads only CREATED orders older than fifteen minutes, and does nothing when there are none', async () => {
    const { service, calls } = stub([{ data: [], error: null }]);

    await expect(service.run(NOW)).resolves.toEqual({ expired: 0, failed: false });
    expect(calls[0]?.eq).toEqual({ state: 'CREATED' });
    expect(calls[0]?.lt).toEqual({ created_at: CUTOFF });
    expect(calls).toHaveLength(1);
  });

  it('expires them with the state and age repeated in the WHERE, then writes a SYSTEM history row each', async () => {
    const { service, calls } = stub([
      { data: [{ id: 'o1' }, { id: 'o2' }], error: null }, // candidates
      { data: [{ id: 'o1' }], error: null }, // o2 moved to PENDING_PAYMENT meanwhile
      { data: null, error: null }, // history
    ]);

    await expect(service.run(NOW)).resolves.toEqual({ expired: 1, failed: false });

    const update = calls.find((c) => c.op === 'update');
    expect(update?.payload).toEqual({ state: 'PAYMENT_EXPIRED' });
    expect(update?.eq).toEqual({ state: 'CREATED' });
    expect(update?.lt).toEqual({ created_at: CUTOFF });
    expect(update?.in.id).toEqual(['o1', 'o2']);

    const history = calls.find((c) => c.table === 'order_status_history');
    expect(history?.payload).toEqual([
      expect.objectContaining({ order_id: 'o1', from_state: 'CREATED', to_state: 'PAYMENT_EXPIRED', actor_type: 'SYSTEM', actor_id: null }),
    ]);
  });

  it('never touches an order in any other state — no payment, no refund, no other table', async () => {
    const { service, calls } = stub([{ data: [{ id: 'o1' }], error: null }, { data: [{ id: 'o1' }], error: null }, { data: null, error: null }]);
    await service.run(NOW);

    expect(calls.every((c) => ['orders', 'order_status_history'].includes(c.table))).toBe(true);
  });

  it('never throws — a failed read reports failure and the tick goes on', async () => {
    const { service } = stub([{ data: null, error: { message: 'connection reset' } }]);

    await expect(service.run(NOW)).resolves.toEqual({ expired: 0, failed: true });
  });
});
