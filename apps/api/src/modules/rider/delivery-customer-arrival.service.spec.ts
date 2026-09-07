import { DeliveryCustomerArrivalService } from './delivery-customer-arrival.service';
import { DeliveryArrivalService } from './delivery-arrival.service';
import { DomainError } from '../../common/errors/domain-error';
import type { AuthenticatedUser } from '../../common/types';
import type { SupabaseService } from '../../supabase/supabase.service';

/**
 * `POST /api/v1/rider/deliveries/:id/arrived-at-customer` — BQ-017 Slice #1,
 * DEC-054's `EN_ROUTE -> ARRIVED`.
 *
 * Same stub shape as `delivery-arrival.service.spec.ts`: it records the
 * filters/payload each statement was built with, so the guarded-UPDATE
 * discipline can be asserted directly (ownership + pre-state both inside the
 * `WHERE`, never a prior `SELECT` deciding the transition).
 */

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: 'select' | 'insert' | 'update';
  eq: Record<string, unknown>;
  payload?: Record<string, unknown>;
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
        maybeSingle: () => Promise.resolve(nextResult()),
        then: (resolve: (r: Result) => unknown) => Promise.resolve(nextResult()).then(resolve),
      };

      return builder;
    },
  };

  return { supabase: { admin } as unknown as SupabaseService, calls };
}

const RIDER_ID = 'rider-1';
const OTHER_RIDER_ID = 'rider-2';
const DELIVERY_ID = 'delivery-1';
const ORDER_ID = 'order-1';
const ARRIVED_AT = '2026-09-07T04:05:06.000Z';

function riderUser(riderId: string | null = RIDER_ID): AuthenticatedUser {
  return {
    id: 'user-1',
    phone: '+66812345678',
    capabilities: {
      customer: true,
      merchant: [],
      rider: riderId ? { riderId } : null,
      platformStaff: null,
    },
  };
}

const CLAIM_OK: Result = {
  data: {
    id: DELIVERY_ID,
    state: 'ARRIVED',
    rider_id: RIDER_ID,
    order_id: ORDER_ID,
    arrived_at: ARRIVED_AT,
  },
  error: null,
};
const CLAIM_NO_MATCH: Result = { data: null, error: null };
const OK: Result = { data: null, error: null };

function delivery(state: string, riderId: string | null, arrivedAt: string | null = null): Result {
  return {
    data: { id: DELIVERY_ID, state, rider_id: riderId, order_id: ORDER_ID, arrived_at: arrivedAt },
    error: null,
  };
}

async function expectDomainError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await promise.catch((error: DomainError) => expect(error.code).toBe(code));
}

describe('DeliveryCustomerArrivalService — successful customer arrival', () => {
  it('transitions EN_ROUTE -> ARRIVED via a single guarded UPDATE, stamping arrived_at in the same statement', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    const result = await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(
      riderUser(),
      DELIVERY_ID,
    );

    expect(result).toEqual({
      deliveryId: DELIVERY_ID,
      orderId: ORDER_ID,
      state: 'ARRIVED',
      arrivedAt: ARRIVED_AT,
      riderId: RIDER_ID,
    });

    const update = calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('deliveries');
    expect(update?.eq).toEqual({ id: DELIVERY_ID, state: 'EN_ROUTE', rider_id: RIDER_ID });

    // state and arrived_at are written together — no window where the delivery
    // is ARRIVED with a null anchor, and no second write to move it.
    expect(update?.payload).toMatchObject({ state: 'ARRIVED' });
    expect(typeof update?.payload?.['arrived_at']).toBe('string');
    expect(Object.keys(update?.payload ?? {}).sort()).toEqual(['arrived_at', 'state']);
  });

  it('appends exactly one history row, EN_ROUTE -> ARRIVED, attributed to the rider', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID);

    const historyInserts = calls.filter((c) => c.table === 'delivery_status_history');
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]?.op).toBe('insert');
    expect(historyInserts[0]?.payload).toMatchObject({
      delivery_id: DELIVERY_ID,
      from_state: 'EN_ROUTE',
      to_state: 'ARRIVED',
      actor_type: 'RIDER',
      actor_id: RIDER_ID,
    });
  });

  it('the guarded UPDATE alone decides the transition — no diagnostic SELECT runs on the happy path', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID);

    expect(calls.filter((c) => c.table === 'deliveries')).toHaveLength(1);
  });

  it('never touches the order — it stays DELIVERING (DEC-018)', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID);

    expect(calls.map((c) => c.table)).toEqual(['deliveries', 'delivery_status_history']);
  });

  it('touches no assignment, availability, payment, ledger or financial table', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID);

    for (const forbidden of [
      'orders',
      'order_status_history',
      'rider_assignments',
      'rider_availability',
      'payments',
      'refunds',
      'ledger_entries',
      'ledger_entry_groups',
      'outbox',
      'notifications',
      'audit_logs',
    ]) {
      expect(calls.find((c) => c.table === forbidden)).toBeUndefined();
    }
  });

  it('writes no failure field — no FAILED, failed_at, failure_cause or cause_code (that is Slice #2)', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID);

    const payloads = JSON.stringify(calls.map((c) => c.payload ?? {}));
    for (const forbidden of ['failed_at', 'failure_cause', 'cause_code', 'DELIVERY_FAILED']) {
      expect(payloads).not.toContain(forbidden);
    }
  });
});

describe('DeliveryCustomerArrivalService — ownership and state failures (diagnosed, never decided, by a SELECT)', () => {
  it('a nonexistent delivery is NOT_FOUND', async () => {
    const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, { data: null, error: null }]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'NOT_FOUND',
    );

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery assigned to another rider is NOT_ASSIGNED_RIDER (403), not NOT_FOUND', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      delivery('EN_ROUTE', OTHER_RIDER_ID),
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(RIDER_ID), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a delivery with no rider assigned at all is also NOT_ASSIGNED_RIDER, not a crash', async () => {
    const { supabase } = supabaseStub([CLAIM_NO_MATCH, delivery('RIDER_SEARCHING', null)]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'NOT_ASSIGNED_RIDER',
    );
  });

  /**
   * Every pre-`EN_ROUTE` state, so the customer-arrival transition can never be
   * reached from the merchant end of the journey — DEC-054's whole point.
   */
  it.each(['RIDER_ASSIGNED', 'AT_MERCHANT', 'PICKED_UP', 'RIDER_REASSIGNING'])(
    'a delivery still at %s is INVALID_TRANSITION — customer arrival is not merchant arrival',
    async (state) => {
      const { supabase, calls } = supabaseStub([CLAIM_NO_MATCH, delivery(state, RIDER_ID)]);

      await expectDomainError(
        new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
        'INVALID_TRANSITION',
      );

      expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
    },
  );

  it.each(['DELIVERED', 'FAILED', 'ABANDONED'])(
    'a delivery already terminal at %s is INVALID_TRANSITION',
    async (state) => {
      const { supabase } = supabaseStub([CLAIM_NO_MATCH, delivery(state, RIDER_ID)]);

      await expectDomainError(
        new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
        'INVALID_TRANSITION',
      );
    },
  );
});

describe('DeliveryCustomerArrivalService — duplicate arrival and concurrency', () => {
  it('a duplicate arrival is INVALID_TRANSITION, not a silent success', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      delivery('ARRIVED', RIDER_ID, ARRIVED_AT),
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );
  });

  it('a duplicate arrival never rewrites arrived_at — it issues no second UPDATE at all', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH,
      delivery('ARRIVED', RIDER_ID, ARRIVED_AT),
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    // Exactly one UPDATE was attempted — the guarded one, which matched
    // nothing. Nothing writes arrived_at on a losing path.
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'update')[0]?.eq).toMatchObject({ state: 'EN_ROUTE' });
  });

  it('the loser of a concurrent arrival fails cleanly and writes no second history row', async () => {
    const { supabase, calls } = supabaseStub([
      CLAIM_NO_MATCH, // this request's guarded UPDATE lost the race
      delivery('ARRIVED', RIDER_ID, ARRIVED_AT), // the winner already committed
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INVALID_TRANSITION',
    );

    expect(calls.filter((c) => c.table === 'delivery_status_history')).toHaveLength(0);
  });

  it('two concurrent arrivals produce exactly one successful transition and exactly one history row', async () => {
    // The winner: its guarded UPDATE matched.
    const winner = supabaseStub([CLAIM_OK, OK]);
    // The loser: same request, same delivery, but the row no longer matches
    // `state = 'EN_ROUTE'` by the time its UPDATE re-evaluates.
    const loser = supabaseStub([CLAIM_NO_MATCH, delivery('ARRIVED', RIDER_ID, ARRIVED_AT)]);

    const results = await Promise.allSettled([
      new DeliveryCustomerArrivalService(winner.supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      new DeliveryCustomerArrivalService(loser.supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    const historyRows = [...winner.calls, ...loser.calls].filter(
      (c) => c.table === 'delivery_status_history',
    );
    expect(historyRows).toHaveLength(1);
  });
});

describe('DeliveryCustomerArrivalService — transport failures', () => {
  it('a failed guarded UPDATE surfaces as INTERNAL_ERROR, never as a transition', async () => {
    const { supabase, calls } = supabaseStub([
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );

    expect(calls.find((c) => c.table === 'delivery_status_history')).toBeUndefined();
  });

  it('a failed diagnostic read surfaces as INTERNAL_ERROR rather than a guessed code', async () => {
    const { supabase } = supabaseStub([
      CLAIM_NO_MATCH,
      { data: null, error: { message: 'connection reset' } },
    ]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );
  });

  it('a delivery_status_history insert failure surfaces as INTERNAL_ERROR', async () => {
    const { supabase } = supabaseStub([CLAIM_OK, { data: null, error: { message: 'connection reset' } }]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(), DELIVERY_ID),
      'INTERNAL_ERROR',
    );
  });
});

describe('DeliveryCustomerArrivalService — rider identity', () => {
  it("fails closed if the route is ever wired without @Roles('RIDER'), and reads identity from the JWT capability alone", async () => {
    const { supabase, calls } = supabaseStub([]);

    await expectDomainError(
      new DeliveryCustomerArrivalService(supabase).arriveAtCustomer(riderUser(null), DELIVERY_ID),
      'FORBIDDEN',
    );

    expect(calls).toHaveLength(0);
  });
});

/**
 * DEC-054's central hazard: an implementer wiring DEC-053's timer to the
 * endpoint whose *name* matched the policy word would have started the
 * five-minute clock at the shop. These pin that the two transitions stayed
 * genuinely separate rather than converging.
 */
describe('customer arrival is not merchant arrival (DEC-054)', () => {
  it('merchant arrival still transitions RIDER_ASSIGNED -> AT_MERCHANT and writes no arrived_at', async () => {
    const { supabase, calls } = supabaseStub([
      { data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID }, error: null },
      OK,
    ]);

    const result = await new DeliveryArrivalService(supabase).arrive(riderUser(), DELIVERY_ID);

    expect(result.state).toBe('AT_MERCHANT');

    const update = calls.find((c) => c.op === 'update');
    expect(update?.eq).toEqual({ id: DELIVERY_ID, state: 'RIDER_ASSIGNED', rider_id: RIDER_ID });
    expect(update?.payload).toEqual({ state: 'AT_MERCHANT' });
    expect(update?.payload).not.toHaveProperty('arrived_at');
  });

  it('the two services guard different pre-states and produce different post-states', async () => {
    const merchant = supabaseStub([
      { data: { id: DELIVERY_ID, state: 'AT_MERCHANT', rider_id: RIDER_ID }, error: null },
      OK,
    ]);
    const customer = supabaseStub([CLAIM_OK, OK]);

    await new DeliveryArrivalService(merchant.supabase).arrive(riderUser(), DELIVERY_ID);
    await new DeliveryCustomerArrivalService(customer.supabase).arriveAtCustomer(
      riderUser(),
      DELIVERY_ID,
    );

    expect(merchant.calls.find((c) => c.op === 'update')?.eq?.['state']).toBe('RIDER_ASSIGNED');
    expect(customer.calls.find((c) => c.op === 'update')?.eq?.['state']).toBe('EN_ROUTE');

    expect(merchant.calls.find((c) => c.op === 'update')?.payload?.['state']).toBe('AT_MERCHANT');
    expect(customer.calls.find((c) => c.op === 'update')?.payload?.['state']).toBe('ARRIVED');
  });
});
