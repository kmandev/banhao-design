import { DispatchService } from './dispatch.service';
import type { DispatchStrategy } from './dispatch-strategy.interface';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * One broadcast dispatch round — DEC-020 with DEC-037's parameters.
 *
 * Same stub shape as the payment tick specs: a fake `supabase.admin.from()`
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
  ordered: boolean;
  payload?: Record<string, unknown>;
}

function supabaseStub(results: Result[]) {
  const calls: Recorded[] = [];
  let index = 0;
  const nextResult = (): Result => results[index++] ?? { data: null, error: null };

  const admin = {
    from(table: string) {
      const call: Recorded = { table, op: 'select', eq: {}, in: {}, lt: {}, ordered: false };
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
        not: () => builder,
        order: () => {
          call.ordered = true;
          return builder;
        },
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

function strategyStub(riderIds: string[]) {
  const selectCandidateRiderIds = jest.fn().mockResolvedValue(riderIds);
  return { strategy: { selectCandidateRiderIds } as DispatchStrategy, selectCandidateRiderIds };
}

const DELIVERY_A = 'delivery-a';
const DELIVERY_B = 'delivery-b';
const RIDER_A = 'rider-a';
const RIDER_B = 'rider-b';
const CREATED_AT = '2026-08-24T10:00:00.000Z';

/** `expiry sweep`, then `deliveries list`, then one result per offer INSERT. */
function results(deliveries: unknown, offerResults: Result[], expired: unknown = []): Result[] {
  return [{ data: expired, error: null }, { data: deliveries, error: null }, ...offerResults];
}

const OK: Result = { data: null, error: null };
const DUPLICATE: Result = { data: null, error: { message: 'duplicate key value', code: '23505' } };

describe('DispatchService.runDispatchRound — which deliveries are broadcast', () => {
  it('a delivery in RIDER_SEARCHING receives an offer, and the state filter is in the query', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result).toEqual({ deliveries: 1, offers: 1, expiredOffers: 0 });
    const list = calls.find((c) => c.table === 'deliveries' && c.op === 'select');
    expect(list?.in).toMatchObject({ state: ['RIDER_SEARCHING', 'RIDER_REASSIGNING'] });
  });

  it('a delivery in RIDER_REASSIGNING is dispatched by the same filter — DEC-021 returns it to broadcast', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    await new DispatchService(supabase, strategy).runDispatchRound();

    const list = calls.find((c) => c.table === 'deliveries' && c.op === 'select');
    expect(list?.in.state).toContain('RIDER_REASSIGNING');
  });

  it('an assigned or delivered delivery is never re-broadcast — it is excluded by the state filter, not by a later check', async () => {
    const { supabase, calls } = supabaseStub(results([], []));
    const { strategy, selectCandidateRiderIds } = strategyStub([RIDER_A]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result).toEqual({ deliveries: 0, offers: 0, expiredOffers: 0 });
    // Nothing to dispatch means no candidate read and no offer write at all.
    expect(selectCandidateRiderIds).not.toHaveBeenCalled();
    expect(calls.find((c) => c.table === 'rider_assignment_attempts' && c.op === 'insert')).toBeUndefined();
    const list = calls.find((c) => c.table === 'deliveries' && c.op === 'select');
    expect(list?.in.state).not.toContain('RIDER_ASSIGNED');
    expect(list?.in.state).not.toContain('DELIVERED');
  });

  it('no eligible rider means no offers, and the delivery stays searching for the next round', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], []),
    );
    const { strategy } = strategyStub([]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result).toEqual({ deliveries: 1, offers: 0, expiredOffers: 0 });
    expect(calls.find((c) => c.op === 'insert')).toBeUndefined();
    // No delivery UPDATE either: a round never assigns anyone.
    expect(calls.find((c) => c.table === 'deliveries' && c.op === 'update')).toBeUndefined();
  });
});

describe('DispatchService.runDispatchRound — the offers a round writes', () => {
  it('every eligible rider gets an offer for every searching delivery — broadcast, not a shortlist', async () => {
    const { supabase, calls } = supabaseStub(
      results(
        [
          { id: DELIVERY_A, created_at: CREATED_AT },
          { id: DELIVERY_B, created_at: CREATED_AT },
        ],
        [OK, OK, OK, OK],
      ),
    );
    const { strategy } = strategyStub([RIDER_A, RIDER_B]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result).toEqual({ deliveries: 2, offers: 4, expiredOffers: 0 });
    const inserts = calls.filter((c) => c.table === 'rider_assignment_attempts' && c.op === 'insert');
    expect(inserts).toHaveLength(4);
    expect(inserts.map((c) => [c.payload?.delivery_id, c.payload?.rider_id])).toEqual([
      [DELIVERY_A, RIDER_A],
      [DELIVERY_A, RIDER_B],
      [DELIVERY_B, RIDER_A],
      [DELIVERY_B, RIDER_B],
    ]);
  });

  it('an offer carries the DEC-037 60-second window, computed from its own offered_at', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    await new DispatchService(supabase, strategy).runDispatchRound();

    const insert = calls.find((c) => c.table === 'rider_assignment_attempts' && c.op === 'insert');
    const offeredAt = Date.parse(String(insert?.payload?.offered_at));
    const expiresAt = Date.parse(String(insert?.payload?.expires_at));

    expect(expiresAt - offeredAt).toBe(60_000);
    expect(insert?.payload?.outcome).toBe('PENDING');
  });

  it('the round number is deterministic from the clock, so a repeated tick collides instead of double-offering', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-24T10:02:30.000Z'));
    try {
      const { supabase, calls } = supabaseStub(
        results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK]),
      );
      const { strategy } = strategyStub([RIDER_A]);

      await new DispatchService(supabase, strategy).runDispatchRound();

      const insert = calls.find((c) => c.table === 'rider_assignment_attempts' && c.op === 'insert');
      // 2.5 minutes after creation -> the third 60-second round.
      expect(insert?.payload?.round_no).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a duplicate (delivery, rider, round) is absorbed as 23505 and not counted — the unique constraint is the authority', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [DUPLICATE, OK]),
    );
    const { strategy } = strategyStub([RIDER_A, RIDER_B]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    // Two attempted, one already existed: exactly one new offer, no error raised.
    expect(result.offers).toBe(1);
    // The duplicate was attempted by INSERT — never by a prior existence SELECT.
    const selects = calls.filter((c) => c.table === 'rider_assignment_attempts' && c.op === 'select');
    expect(selects).toHaveLength(0);
  });

  it('one rider\'s failed insert does not cost the other riders their offers', async () => {
    const { supabase } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [
        { data: null, error: { message: 'connection reset' } },
        OK,
      ]),
    );
    const { strategy } = strategyStub([RIDER_A, RIDER_B]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result.offers).toBe(1);
  });

  it('selects candidates once per round, not once per delivery — under DEC-037 the pool cannot depend on the delivery', async () => {
    const { supabase } = supabaseStub(
      results(
        [
          { id: DELIVERY_A, created_at: CREATED_AT },
          { id: DELIVERY_B, created_at: CREATED_AT },
        ],
        [OK, OK],
      ),
    );
    const { strategy, selectCandidateRiderIds } = strategyStub([RIDER_A]);

    await new DispatchService(supabase, strategy).runDispatchRound();

    expect(selectCandidateRiderIds).toHaveBeenCalledTimes(1);
    expect(selectCandidateRiderIds).toHaveBeenCalledWith();
  });
});

describe('DispatchService.runDispatchRound — offer expiry', () => {
  it('closed offers are marked EXPIRED by a guarded UPDATE with both conditions in the WHERE clause', async () => {
    const { supabase, calls } = supabaseStub(
      results([], [], [{ id: 'offer-1' }, { id: 'offer-2' }]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result.expiredOffers).toBe(2);
    const sweep = calls.find((c) => c.table === 'rider_assignment_attempts' && c.op === 'update');
    expect(sweep?.payload).toEqual({ outcome: 'EXPIRED' });
    expect(sweep?.eq).toMatchObject({ outcome: 'PENDING' });
    expect(sweep?.lt).toHaveProperty('expires_at');
  });

  it('a failed expiry sweep does not abort the round', async () => {
    const { supabase } = supabaseStub([
      { data: null, error: { message: 'connection reset' } },
      { data: [{ id: DELIVERY_A, created_at: CREATED_AT }], error: null },
      OK,
    ]);
    const { strategy } = strategyStub([RIDER_A]);

    const result = await new DispatchService(supabase, strategy).runDispatchRound();

    expect(result).toEqual({ deliveries: 1, offers: 1, expiredOffers: 0 });
  });
});

describe('DispatchService.runDispatchRound — domain isolation', () => {
  it('touches no payment, ledger, refund, reconciliation or settlement table, and no order table', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK], [{ id: 'offer-1' }]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    await new DispatchService(supabase, strategy).runDispatchRound();

    const tables = new Set(calls.map((c) => c.table));
    for (const forbidden of [
      'payments',
      'payment_attempts',
      'payment_events',
      'payment_transactions',
      'reconciliation_cases',
      'refunds',
      'ledger_entries',
      'ledger_groups',
      'settlements',
      'settlement_items',
      'orders',
      'order_status_history',
    ]) {
      expect(tables.has(forbidden)).toBe(false);
    }
    expect([...tables].sort()).toEqual(['deliveries', 'rider_assignment_attempts']);
  });

  it('computes no money — no payload written by a round mentions an earning or a fee', async () => {
    const { supabase, calls } = supabaseStub(
      results([{ id: DELIVERY_A, created_at: CREATED_AT }], [OK]),
    );
    const { strategy } = strategyStub([RIDER_A]);

    await new DispatchService(supabase, strategy).runDispatchRound();

    for (const call of calls) {
      const keys = Object.keys(call.payload ?? {});
      expect(keys).not.toContain('rider_earning_satang');
      expect(keys.filter((k) => k.includes('satang'))).toEqual([]);
    }
  });
});
